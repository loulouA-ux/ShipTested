import {beforeAll,beforeEach,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {Query} from '../src/lib/server/db';
import {repairMergeReadiness,approveRepairMerge,reconcileRepairMerge,getRepairMerge,repairMergeStatus} from '../src/lib/server/repair-merge';
import {approvalHash} from '../src/lib/server/repair-execution';
import {contentHash,type RepairPlan} from '../src/lib/repair/plan';
import type {RepairRun} from '../src/lib/repair/runner';
import {gitBlobHash} from '../src/lib/server/matching-draft';
const credentials=vi.hoisted(()=>({token:vi.fn()}));
vi.mock('../src/lib/server/repository-connections',()=>({repositoryMergeToken:credentials.token}));
const db=new PGlite(),q:Query=async(sql,params=[])=>(await db.query(sql,params)).rows as Record<string,unknown>[];
const actor={id:'github:1',workspaceId:'github:1',role:'member' as const};
const head='a'.repeat(40),base='b'.repeat(40),merged='c'.repeat(40),uuid='630b9d5e-3f2a-4f7e-8b0c-2d5f9a8c1e42';
const plan={planHash:'d'.repeat(64),baseCommit:base,manifestAfter:'{"dependencies":{"demo":"1.2.6"}}',packageName:'demo'} as RepairPlan;
const lockfileAfter='{"lockfileVersion":3}';
const scan={checkedAt:'2026-11-03T00:00:00Z',dependencyCount:1,lockfileHash:contentHash(lockfileAfter),findings:[]};
const result:RepairRun={planHash:plan.planHash,status:'passed',baseline:[],patched:[],cleanupComplete:true,errors:[],artifactChecks:{baseline:true,patched:true},lockfileAfter,scans:{before:scan,after:scan}};
let id:string,writes:{path:string;init:RequestInit}[],readCount:number;
let overrides:Record<string,unknown>,remoteMerged:boolean,writeResult:unknown,writeError:number|Error|null;
const path='/repos/team/demo',prPath=path+'/pulls/1';
function pull(){return {number:1,html_url:'https://github.com/team/demo/pull/1',state:remoteMerged?'closed':'open',draft:false,merged:remoteMerged,merge_commit_sha:remoteMerged?merged:null,mergeable:true,mergeable_state:'clean',head:{sha:head,repo:{id:123}},base:{sha:base,ref:'main',repo:{id:123}}};}
function pending(){return {status:'pending',details:{uuid,expected_head_sha:head,merge_method:'squash',merge_action:'direct_merge'}};}
const fetcher:typeof fetch=async(input,init={})=>{
 const url=new URL(String(input)),p=url.pathname;readCount++;
 expect(init.headers).toMatchObject({Authorization:'Bearer synthetic-user-token'});
 if(init.method==='PUT'){
  writes.push({path:p,init});
  expect(p).toBe(prPath+'/merge-async');expect(init.headers).toMatchObject({'X-GitHub-Api-Version':'2026-03-10'});
  expect(JSON.parse(String(init.body))).toEqual({sha:head,merge_method:'squash',merge_action:'direct_merge',bypass_rules:false});
  if(writeError instanceof Error)throw writeError;
  if(writeError)return Response.json({message:'sensitive provider detail'},{status:writeError});
  return Response.json(writeResult,{status:202});
 }
 if(p in overrides){const value=typeof overrides[p]==='function'?overrides[p]():overrides[p];if(value instanceof Response)return value;return Response.json(value);}
 if(p===path)return Response.json({id:123,full_name:'team/demo',permissions:{push:true},archived:false,disabled:false,allow_squash_merge:true});
 if(p===prPath)return Response.json(pull());
 if(p===path+'/stacks'){expect(url.searchParams.get('pull_request')).toBe('1');return Response.json([]);}
 if(p===path+'/commits/main')return Response.json({sha:base});
 if(p===path+'/git/commits/'+head)return Response.json({sha:head,parents:[{sha:base}]});
 if(p===prPath+'/files')return Response.json([{filename:'package.json',status:'modified',sha:gitBlobHash(plan.manifestAfter)},{filename:'package-lock.json',status:'modified',sha:gitBlobHash(lockfileAfter)}]);
 if(p===path+'/commits/'+head+'/check-runs')return Response.json({total_count:1,check_runs:[{id:1,name:'CI',head_sha:head,status:'completed',conclusion:'success'}]});
 if(p===path+'/commits/'+head+'/status')return Response.json({sha:head,total_count:0,statuses:[]});
 if(p===prPath+'/reviews')return Response.json([]);
 if(p===prPath+'/merge-async/'+uuid)return Response.json(pending());
 throw Error('Unexpected GitHub request: '+p);
};
beforeAll(async()=>{for(const f of ['001_core','013_repair_merges','014_merge_approval_tickets'])await db.exec(readFileSync(`migrations/${f}.sql`,'utf8'));});
beforeEach(async()=>{
 vi.clearAllMocks();vi.stubEnv('SHIPTESTED_MERGE_ENABLED','1');vi.stubEnv('SHIPTESTED_CUSTOMER_REPOSITORIES','1');
 credentials.token.mockResolvedValue('synthetic-user-token');
 id=randomUUID();writes=[];readCount=0;overrides={};remoteMerged=false;writeResult=pending();writeError=null;
 await q("INSERT INTO sc_repairs(id,owner_id,workspace_id,state,snapshot,plan,result,pr_url,publication_commit) VALUES($1,$2,$3,'published',$4::jsonb,$5::jsonb,$6::jsonb,$7,$8)",[id,actor.id,actor.workspaceId,JSON.stringify({repository:{id:123,full_name:'team/demo',default_branch:'main'}}),JSON.stringify(plan),JSON.stringify(result),'https://github.com/team/demo/pull/1',head]);
 await q("INSERT INTO sc_repair_events(id,repair_id,actor_id,workspace_id,event_type,details) VALUES($1,$2,$3,$4,'patch_approved',$5::jsonb)",[randomUUID(),id,actor.id,actor.workspaceId,JSON.stringify({approvalHash:approvalHash(plan,result)})]);
});
afterEach(()=>vi.unstubAllEnvs());afterAll(()=>db.close());
async function approve(){const ready=await repairMergeReadiness(q,actor,id,fetcher);expect(ready.ready).toBe(true);return approveRepairMerge(q,actor,id,ready.approvalHash!,fetcher);}
async function states(){return q('SELECT event_type,details FROM sc_repair_events WHERE repair_id=$1 ORDER BY sequence',[id]);}

describe('merge approval and provider contract',()=>{
 it('previews without a remote write and records one separately approved pending request',async()=>{
  const ready=await repairMergeReadiness(q,actor,id,fetcher);expect(ready).toMatchObject({ready:true,headSha:head,baseSha:base,targetBranch:'main',method:'squash'});expect(writes).toHaveLength(0);expect(await getRepairMerge(q,actor,id)).toBeUndefined();
  const record=await approveRepairMerge(q,actor,id,ready.approvalHash!,fetcher);expect(record).toMatchObject({state:'pending',request_id:uuid,head_sha:head,merge_commit:null});expect(writes).toHaveLength(1);
  expect((await states()).map(r=>r.event_type)).toEqual(['patch_approved','merge_approved','merge_requested']);
  expect(JSON.stringify(await states())).not.toContain('synthetic-user-token');
 });
 it('is off by default and refuses admin-mapped legacy repository access',async()=>{
  vi.stubEnv('SHIPTESTED_MERGE_ENABLED','');expect(await repairMergeReadiness(q,actor,id,fetcher)).toMatchObject({enabled:false,ready:false});
  await expect(approveRepairMerge(q,actor,id,'e'.repeat(64),fetcher)).rejects.toMatchObject({status:403});
  vi.stubEnv('SHIPTESTED_MERGE_ENABLED','1');vi.stubEnv('SHIPTESTED_CUSTOMER_REPOSITORIES','0');
  await expect(approveRepairMerge(q,actor,id,'e'.repeat(64),fetcher)).rejects.toMatchObject({status:403});expect(readCount).toBe(0);
 });
 it('rejects another account/workspace, missing exact approval and revoked GitHub access',async()=>{
  await expect(repairMergeReadiness(q,{...actor,id:'github:2'},id,fetcher)).rejects.toMatchObject({status:404});
  await expect(repairMergeReadiness(q,{...actor,workspaceId:'other'},id,fetcher)).rejects.toMatchObject({status:404});
  credentials.token.mockRejectedValueOnce(new Error('Access revoked'));
  await expect(repairMergeReadiness(q,actor,id,fetcher)).rejects.toThrow('Access revoked');
  await q("UPDATE sc_repair_events SET details='{}' WHERE repair_id=$1",[id]);
  await expect(repairMergeReadiness(q,actor,id,fetcher)).rejects.toThrow('exact-patch approval');expect(writes).toHaveLength(0);
 });
 it('rejects stale, forged or changed approvals without reserving a merge',async()=>{
  const ready=await repairMergeReadiness(q,actor,id,fetcher);
  await expect(approveRepairMerge(q,actor,id,'e'.repeat(64),fetcher)).rejects.toMatchObject({status:409});
  overrides[prPath]={...pull(),head:{sha:'f'.repeat(40),repo:{id:123}}};
  await expect(approveRepairMerge(q,actor,id,ready.approvalHash!,fetcher)).rejects.toMatchObject({status:409});
  expect(await getRepairMerge(q,actor,id)).toBeUndefined();expect(writes).toHaveLength(0);
 });
 it('concurrent approvals send only one merge request',async()=>{
  const ready=await repairMergeReadiness(q,actor,id,fetcher);
  const results=await Promise.allSettled([approveRepairMerge(q,actor,id,ready.approvalHash!,fetcher),approveRepairMerge(q,actor,id,ready.approvalHash!,fetcher)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(writes).toHaveLength(1);
 });
 it('does not write when the atomic approval audit cannot be persisted',async()=>{
  const ready=await repairMergeReadiness(q,actor,id,fetcher);
  const broken:Query=async(sql,params)=>{if(sql.includes("'merge_approved'"))throw Error('Storage unavailable');return q(sql,params);};
  // Event name is a parameter; reject the complete mutation to simulate storage loss.
  const noAudit:Query=async(sql,params)=>{if(sql.startsWith('WITH changed'))throw Error('Storage unavailable');return broken(sql,params);};
  await expect(approveRepairMerge(noAudit,actor,id,ready.approvalHash!,fetcher)).rejects.toThrow('Storage unavailable');expect(writes).toHaveLength(0);
 });
});
describe('fresh readiness rejection paths',()=>{
 it.each([
  ['draft',()=>{overrides[prPath]={...pull(),draft:true};}],
  ['unknown mergeability',()=>{overrides[prPath]={...pull(),mergeable:null,mergeable_state:'unknown'};}],
  ['GitHub protection block',()=>{overrides[prPath]={...pull(),mergeable_state:'blocked'};}],
  ['squash disabled',()=>{overrides[path]={id:123,full_name:'team/demo',permissions:{push:true},archived:false,disabled:false,allow_squash_merge:false};}],
  ['requested changes',()=>{overrides[prPath+'/reviews']=[{id:1,user:{id:2},state:'CHANGES_REQUESTED'}];}],
  ['pending check',()=>{overrides[path+'/commits/'+head+'/check-runs']={total_count:1,check_runs:[{id:1,name:'CI',head_sha:head,status:'in_progress',conclusion:null}]};}],
  ['failed status',()=>{overrides[path+'/commits/'+head+'/status']={sha:head,total_count:1,statuses:[{context:'deploy',state:'failure'}]};}],
  ['no checks',()=>{overrides[path+'/commits/'+head+'/check-runs']={total_count:0,check_runs:[]};}],
 ] as const)('blocks %s without issuing a merge',async(_name,change)=>{
  change();const ready=await repairMergeReadiness(q,actor,id,fetcher);expect(ready.ready).toBe(false);expect(ready.approvalHash).toBeUndefined();expect(ready.reasons.length).toBeGreaterThan(0);
  await expect(approveRepairMerge(q,actor,id,'e'.repeat(64),fetcher)).rejects.toMatchObject({status:409});expect(writes).toHaveLength(0);
 });
 it.each([
  ['moved base',()=>{overrides[path+'/commits/main']={sha:'f'.repeat(40)};}],
  ['stacked PR',()=>{overrides[path+'/stacks']=[{number:1}];}],
  ['fork',()=>{overrides[prPath]={...pull(),head:{sha:head,repo:{id:456}}};}],
  ['retargeted PR',()=>{overrides[prPath]={...pull(),base:{sha:base,ref:'release',repo:{id:123}}};}],
  ['extra commit',()=>{overrides[path+'/git/commits/'+head]={sha:head,parents:[{sha:'f'.repeat(40)}]};}],
  ['changed patch',()=>{overrides[prPath+'/files']=[{filename:'package.json',status:'modified',sha:gitBlobHash('changed')}];}],
  ['incomplete CI',()=>{overrides[path+'/commits/'+head+'/check-runs']={total_count:2,check_runs:[]};}],
  ['other commit CI',()=>{overrides[path+'/commits/'+head+'/status']={sha:'f'.repeat(40),total_count:0,statuses:[]};}],
  ['lost push permission',()=>{overrides[path]={id:123,full_name:'team/demo',permissions:{push:false},archived:false,disabled:false,allow_squash_merge:true};}],
 ] as const)('rejects %s evidence',async(_name,change)=>{change();await expect(repairMergeReadiness(q,actor,id,fetcher)).rejects.toThrow();expect(writes).toHaveLength(0);});
 it('does not let a comment erase an outstanding change request; a dismissal does',async()=>{
  overrides[prPath+'/reviews']=[{id:1,user:{id:2},state:'CHANGES_REQUESTED'},{id:2,user:{id:2},state:'COMMENTED'}];
  expect((await repairMergeReadiness(q,actor,id,fetcher)).ready).toBe(false);
  overrides[prPath+'/reviews']=[{id:1,user:{id:2},state:'CHANGES_REQUESTED'},{id:3,user:{id:2},state:'DISMISSED'}];
  expect((await repairMergeReadiness(q,actor,id,fetcher)).ready).toBe(true);
 });
 it('rechecks CI after preview and before approval',async()=>{
  const ready=await repairMergeReadiness(q,actor,id,fetcher);
  overrides[path+'/commits/'+head+'/check-runs']={total_count:1,check_runs:[{id:1,name:'CI',head_sha:head,status:'completed',conclusion:'failure'}]};
  await expect(approveRepairMerge(q,actor,id,ready.approvalHash!,fetcher)).rejects.toMatchObject({status:409});expect(writes).toHaveLength(0);
 });
});
describe('uncertain merge and read-only reconciliation',()=>{
 it('keeps pending distinct from merged and confirms the exact head with reads only',async()=>{
  await approve();expect((await repairMergeReadiness(q,actor,id,fetcher)).record?.state).toBe('pending');
  expect((await reconcileRepairMerge(q,actor,id,fetcher)).state).toBe('pending');remoteMerged=true;
  vi.stubEnv('SHIPTESTED_MERGE_ENABLED','0');
  expect(await reconcileRepairMerge(q,actor,id,fetcher)).toMatchObject({state:'merged',merge_commit:merged,head_sha:head});expect(writes).toHaveLength(1);
  expect((await repairMergeStatus(q,actor,id)).record?.state).toBe('merged');
 });
 it.each([new Error('timeout with sensitive details'),409,500])('keeps %s uncertain and never repeats the write',async(error)=>{
  writeError=error;await expect(approve()).rejects.toThrow('unconfirmed');
  expect((await getRepairMerge(q,actor,id))?.state).toBe('uncertain');
  expect((await reconcileRepairMerge(q,actor,id,fetcher)).state).toBe('uncertain');
  await expect(approveRepairMerge(q,actor,id,'e'.repeat(64),fetcher)).rejects.toMatchObject({status:409});expect(writes).toHaveLength(1);
  remoteMerged=true;expect((await reconcileRepairMerge(q,actor,id,fetcher)).state).toBe('merged');
 });
 it('records an explicit provider rejection and allows only a fresh approved attempt',async()=>{
  writeError=403;await expect(approve()).rejects.toThrow('GitHub rejected');expect((await getRepairMerge(q,actor,id))?.state).toBe('failed');
  const previous=(await getRepairMerge(q,actor,id))!;writeError=null;const next=await approve();expect(next.state).toBe('pending');expect(next.attempt_id).not.toBe(previous.attempt_id);expect(writes).toHaveLength(2);
 });
 it('does not replay the same approval after a definitive rejection',async()=>{
  const ready=await repairMergeReadiness(q,actor,id,fetcher);writeError=403;
  await expect(approveRepairMerge(q,actor,id,ready.approvalHash!,fetcher)).rejects.toMatchObject({status:502});
  await expect(approveRepairMerge(q,actor,id,ready.approvalHash!,fetcher)).rejects.toMatchObject({status:409});
  expect(writes).toHaveLength(1);
 });
 it('rotates preview tickets and rejects expired approval without a write',async()=>{
  const first=await repairMergeReadiness(q,actor,id,fetcher),second=await repairMergeReadiness(q,actor,id,fetcher);
  expect(first.approvalHash).not.toBe(second.approvalHash);
  await q("UPDATE sc_repair_merge_approvals SET expires_at=now()-interval '1 second' WHERE repair_id=$1",[id]);
  await expect(approveRepairMerge(q,actor,id,first.approvalHash!,fetcher)).rejects.toMatchObject({status:409});expect(writes).toHaveLength(0);
 });
 it('invalidates other previews issued before a rejection, including another tab',async()=>{
  const first=await repairMergeReadiness(q,actor,id,fetcher),otherTab=await repairMergeReadiness(q,actor,id,fetcher);writeError=403;
  await expect(approveRepairMerge(q,actor,id,first.approvalHash!,fetcher)).rejects.toMatchObject({status:502});writeError=null;
  await expect(approveRepairMerge(q,actor,id,otherTab.approvalHash!,fetcher)).rejects.toMatchObject({status:409});expect(writes).toHaveLength(1);
  expect((await approve()).state).toBe('pending');expect(writes).toHaveLength(2);
 });
 it('treats confirmation read failure after an accepted write as uncertain, not a safe retry',async()=>{
  const ready=await repairMergeReadiness(q,actor,id,fetcher);writeResult={status:'merged',details:{sha:merged}};
  let reads=0;overrides[prPath]=()=>{if(++reads>2)return Response.json({message:'private provider detail'},{status:403});return pull();};
  await expect(approveRepairMerge(q,actor,id,ready.approvalHash!,fetcher)).rejects.toThrow('unconfirmed');
  expect((await getRepairMerge(q,actor,id))?.state).toBe('uncertain');expect(writes).toHaveLength(1);
 });
 it('records final async rejection without automatically retrying',async()=>{
  await approve();overrides[prPath+'/merge-async/'+uuid]={status:'failed',details:{message:'Rule rejected'}};
  expect((await reconcileRepairMerge(q,actor,id,fetcher)).state).toBe('failed');expect(writes).toHaveLength(1);
 });
 it('does not label a queued or malformed response as merged',async()=>{
  writeResult={status:'enqueued',details:{}};expect((await approve()).state).toBe('uncertain');expect(writes).toHaveLength(1);
 });
 it('rejects a changed head during reconciliation instead of confirming a different merge',async()=>{
  await approve();remoteMerged=true;overrides[prPath]={...pull(),head:{sha:'f'.repeat(40),repo:{id:123}}};
  await expect(reconcileRepairMerge(q,actor,id,fetcher)).rejects.toMatchObject({status:409});expect((await getRepairMerge(q,actor,id))?.state).toBe('pending');expect(writes).toHaveLength(1);
 });
 it('a stale reconciliation cannot overwrite a newer attempt',async()=>{
  await approve();const previous=(await getRepairMerge(q,actor,id))!;
  const concurrent:typeof fetch=async(input,init)=>{
   if(new URL(String(input)).pathname.endsWith('/merge-async/'+uuid)){
    await q("UPDATE sc_repair_merges SET state='failed' WHERE repair_id=$1",[id]);
    await approve();return Response.json({status:'failed',details:{}});
   }
   return fetcher(input,init);
  };
  expect((await reconcileRepairMerge(q,actor,id,concurrent)).state).toBe('pending');
  expect((await getRepairMerge(q,actor,id))?.attempt_id).not.toBe(previous.attempt_id);expect(writes).toHaveLength(2);
 });
});
