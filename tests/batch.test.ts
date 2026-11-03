import {it,expect,vi} from 'vitest';
import {createPlan,submitBatch,refreshBatch,validatePlan} from '../packages/cli/src/batch';
import {randomUUID} from 'node:crypto';
const origin='https://preview.example.com';
const inputs=(n:number)=>Array.from({length:n},(_,i)=>({repository:`heysalad-ai/repo${i}`,privateAccess:true}));
it('plans 500 repositories without a network client and rejects oversized/duplicate/unsafe input',()=>{
 expect(createPlan(inputs(500),origin).entries).toHaveLength(500);
 for(const entries of [[],inputs(501),[...inputs(1),...inputs(1)],[{repository:'https://evil.example/repo',privateAccess:false}],[{repository:'owner/repo'}]])expect(()=>createPlan(entries,origin)).toThrow();
 expect(()=>createPlan(inputs(1),'https://user:secret@example.com')).toThrow();
});
it('submits 350 sequentially with pacing and durable acknowledgement for each',async()=>{
 const plan=createPlan(inputs(350),origin),wait=vi.fn(async()=>{}),save=vi.fn(async()=>{});
 const client={scanRepository:vi.fn(async()=>({id:randomUUID(),state:'queued'})),job:vi.fn()};
 expect(await submitBatch(plan,client,save,wait)).toMatchObject({submitted:350,accepted:350});
 expect(save).toHaveBeenCalledTimes(350);expect(wait).toHaveBeenCalledTimes(350);expect(wait).toHaveBeenCalledWith(4000);
 await submitBatch(plan,client,save,wait);expect(client.scanRepository).toHaveBeenCalledTimes(350);
});
it('resumes after a lost response with the persisted key and skips acknowledged jobs',async()=>{
 const plan=createPlan(inputs(3),origin),keys=plan.entries.map(e=>e.requestKey),accepted=new Map<string,string>();let lose=true;
 const client={scanRepository:vi.fn(async(_r:string,_p:boolean,key?:string)=>{const id=accepted.get(key!)??randomUUID();accepted.set(key!,id);if(key===keys[1]&&lose){lose=false;throw Error('lost response');}return {id,state:'queued'};}),job:vi.fn()};
 const save=vi.fn(async()=>{}),wait=async()=>{};
 await expect(submitBatch(plan,client,save,wait)).rejects.toThrow('lost response');
 const restored=validatePlan(JSON.parse(JSON.stringify(plan)));await submitBatch(restored,client,save,wait);
 expect(accepted.size).toBe(3);expect(client.scanRepository.mock.calls.map(c=>c[2])).toEqual([keys[0],keys[1],keys[1],keys[2]]);
});
it('status records failed and completed jobs without equating completion with a clean result',async()=>{
 const plan=createPlan(inputs(2),origin);plan.entries.forEach(e=>e.id=randomUUID());
 const client={scanRepository:vi.fn(),job:vi.fn(async(id:string)=>({id,repository:plan.entries.find(e=>e.id===id)!.repository,state:id===plan.entries[0].id?'completed':'failed',reportUrl:id===plan.entries[0].id?'/reports/'+randomUUID():null,failureCode:'unsupported_repository'}))};
 expect(await refreshBatch(plan,client,async()=>{},async()=>{})).toEqual({completed:1,failed:1});expect(client.scanRepository).not.toHaveBeenCalled();
});
it('accepts the GitHub organization metadata repository but rejects dot traversal',()=>{
 expect(createPlan([{repository:'heysalad-ai/.github',privateAccess:true}],origin).entries[0].repository).toBe('heysalad-ai/.github');
 for(const repository of ['owner/.','owner/..','owner/../other'])expect(()=>createPlan([{repository,privateAccess:true}],origin)).toThrow();
});

it('preserves verified empty skips across resume and status without submitting them',async()=>{
 const plan=createPlan(inputs(2),origin),keys=plan.entries.map(e=>e.requestKey);
 Object.assign(plan.entries[0],{state:'skipped',skipReason:'empty_repository',skipCheckedAt:new Date().toISOString()});
 const restored=validatePlan(JSON.parse(JSON.stringify(plan)));
 const client={scanRepository:vi.fn(async()=>({id:randomUUID(),state:'queued'})),job:vi.fn(async(id:string)=>({id,repository:restored.entries[1].repository,state:'completed'}))};
 expect(await submitBatch(restored,client,async()=>{},async()=>{})).toMatchObject({submitted:1,accepted:1,skipped:1});
 expect(client.scanRepository.mock.calls).toHaveLength(1);expect(restored.entries.map(e=>e.requestKey)).toEqual(keys);
 expect(await refreshBatch(restored,client,async()=>{},async()=>{})).toEqual({skipped:1,completed:1});
});
it('rejects skipped entries with an accepted job or without verified empty evidence',()=>{
 for(const fields of [{state:'skipped'},{state:'skipped',skipReason:'network_error',skipCheckedAt:new Date().toISOString()},{state:'skipped',skipReason:'empty_repository',skipCheckedAt:new Date().toISOString(),id:randomUUID()}]){
  const plan=createPlan(inputs(1),origin);Object.assign(plan.entries[0],fields);expect(()=>validatePlan(plan)).toThrow('Invalid skipped entry');
 }
});

it('replays transient protected transport failures using the same identity and saves once',async()=>{
 const {PreviewTransportError}=await import('../packages/cli/src/transport');
 const plan=createPlan([{repository:'owner/repo',privateAccess:true}],'https://example.com');const key=plan.entries[0].requestKey,id=randomUUID();let calls=0;
 const client={scanRepository:vi.fn(async(_r:string,_p:boolean,k?:string)=>{expect(k).toBe(key);if(++calls<3)throw new PreviewTransportError('timeout',true);return {id,state:'queued'};}),job:vi.fn()};
 const save=vi.fn(),wait=vi.fn(async(_ms:number)=>{});await submitBatch(plan,client,save,wait);
 expect(client.scanRepository).toHaveBeenCalledTimes(3);expect(save).toHaveBeenCalledTimes(1);expect(plan.entries[0].id).toBe(id);expect(wait.mock.calls.map(c=>c[0])).toEqual([4000,5000,15000]);
});
it('does not retry authentication failures and stops after three transient attempts',async()=>{
 const {PreviewTransportError}=await import('../packages/cli/src/transport');
 for(const [error,count] of [[Error('ShipTested request failed (HTTP 401).'),1],[new PreviewTransportError('timeout',true),3]] as const){
  const plan=createPlan([{repository:'owner/repo',privateAccess:true}],'https://example.com');const client={scanRepository:vi.fn(async()=>{throw error;}),job:vi.fn()},save=vi.fn();
  await expect(submitBatch(plan,client,save,async()=>{})).rejects.toBe(error);expect(client.scanRepository).toHaveBeenCalledTimes(count);expect(save).not.toHaveBeenCalled();expect(plan.entries[0].id).toBeUndefined();
 }
});
