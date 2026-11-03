import {open,readFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {hostedTransport,PreviewTransportError} from './transport.js';
import {HostedClient} from '@heysalad/shiptested/hosted';
export const MAX_BATCH_REPOSITORIES=500;
export class BatchTransportError extends Error {
 constructor(repository:string,reason:string){super(`Batch stopped at ${repository}: protected preview ${reason}. Progress is saved; resume with the same plan.`);}
}
export class BatchHttpError extends Error {
 constructor(repository:string,status:string){super(`Batch stopped at ${repository} (HTTP ${status}). Progress is saved; resume with the same plan.`);}
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type BatchEntry={repository:string;privateAccess:boolean;requestKey:string;id?:string;state?:string;reportUrl?:string|null;failureCode?:string|null;skipReason?:'empty_repository';skipCheckedAt?:string};
export type BatchPlan={version:1;origin:string;createdAt:string;entries:BatchEntry[]};
export function normalizeRepository(value:string){
 let name=value.trim();
 if(name.startsWith('https://')){const url=new URL(name);if(url.hostname!=='github.com'||url.port||url.username||url.password||url.search||url.hash)throw Error('Use a plain GitHub repository URL.');name=url.pathname.replace(/^\//,'').replace(/\/$/,'');}
 name=name.replace(/\.git$/,'');
 if(['.','..'].includes(name.split('/')[1])||!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/.test(name)||name.length>250)throw Error('Use owner/repository.');
 return name.toLowerCase();
}
export function createPlan(input:unknown,origin:string):BatchPlan{
 // Reuse the client's origin checks without needing any real credential.
 const canonical=new HostedClient(origin,'st_'+'0'.repeat(64)).origin;
 if(!Array.isArray(input)||input.length<1||input.length>MAX_BATCH_REPOSITORIES)throw Error('Provide 1–500 repository entries.');
 const seen=new Set<string>();
 const entries=input.map((entry:unknown)=>{
  if(!entry||typeof entry!=='object'||!('repository' in entry)||typeof entry.repository!=='string'||!('privateAccess' in entry)||typeof entry.privateAccess!=='boolean')throw Error('Each entry needs repository and explicit privateAccess.');
  const repository=normalizeRepository(entry.repository);if(seen.has(repository))throw Error('Duplicate repository.');seen.add(repository);
  return {repository,privateAccess:entry.privateAccess,requestKey:randomUUID()};
 });
 return {version:1,origin:canonical,createdAt:new Date().toISOString(),entries};
}
export function validatePlan(input:unknown):BatchPlan{
 const p=input as BatchPlan;
 if(!p||p.version!==1||typeof p.origin!=='string'||typeof p.createdAt!=='string')throw Error('Invalid batch plan.');
 createPlan(p.entries,p.origin);
 const keys=new Set<string>();
 for(const e of p.entries){
  if(!uuid.test(e.requestKey)||keys.has(e.requestKey)||(e.id!==undefined&&!uuid.test(e.id)))throw Error('Invalid batch identity.');keys.add(e.requestKey);
  if(e.state==='skipped'?(e.id!==undefined||e.skipReason!=='empty_repository'||typeof e.skipCheckedAt!=='string'||!Number.isFinite(Date.parse(e.skipCheckedAt))):(e.skipReason!==undefined||e.skipCheckedAt!==undefined))throw Error('Invalid skipped entry.');
  if(e.repository!==normalizeRepository(e.repository))throw Error('Batch repository must be canonical.');
 }
 return p;
}
export async function savePlan(path:string,plan:BatchPlan,exclusive=false){
 const target=exclusive?path:path+'.'+randomUUID()+'.tmp';
 const file=await open(target,'wx',0o600);
 try{await file.writeFile(JSON.stringify(plan,null,2)+'\n');await file.sync();}finally{await file.close();}
 if(!exclusive)await rename(target,path);
}
export type BatchClient=Pick<HostedClient,'scanRepository'|'job'>;
/** Each request key is already on disk before any submission. Stop on uncertain response. */
export async function submitBatch(plan:BatchPlan,client:BatchClient,save:()=>Promise<void>,wait:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))){
 validatePlan(plan);
 let submitted=0;
 for(const entry of plan.entries){
  if(entry.id||entry.state==='skipped')continue;
  // Pace retries too, so restarting cannot immediately exceed the discovery window.
  await wait(4000);
  let result:Awaited<ReturnType<BatchClient['scanRepository']>>|undefined;
  for(let attempt=0;attempt<3;attempt++){
   try{result=await client.scanRepository(entry.repository,entry.privateAccess,entry.requestKey);break;}
   catch(error){
    const transient=error instanceof PreviewTransportError?error.retryable:error instanceof Error&&/^ShipTested request failed \(HTTP (502|503|504)\)/.test(error.message);
    if(!transient||attempt===2)throw error;
    // Replay only this saved identity, even when the server accepted a lost response.
    await wait(attempt===0?5000:15000);
   }
  }
  if(!result)throw Error('Missing submission response.');
  if(typeof result.id!=='string'||!uuid.test(result.id)||!['queued','running','completed','failed','cancelled'].includes(String(result.state)))throw Error('Invalid submission response; resume with the same plan.');
  entry.id=result.id;entry.state=String(result.state);await save();submitted++;
 }
 return {submitted,total:plan.entries.length,accepted:plan.entries.filter(e=>e.id).length,skipped:plan.entries.filter(e=>e.state==='skipped').length,meaning:'Accepted into the queue; not a security verdict.'};
}
export async function refreshBatch(plan:BatchPlan,client:BatchClient,save:()=>Promise<void>,wait:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))){
 validatePlan(plan);
 for(const entry of plan.entries){
  if(!entry.id)continue;
  await wait(250);
  const result=await client.job(entry.id);
  if(result.id!==entry.id||normalizeRepository(String(result.repository))!==entry.repository||!['queued','running','completed','failed','cancelled'].includes(String(result.state)))throw Error('Job identity mismatch.');
  if(result.reportUrl!==null&&result.reportUrl!==undefined&&!/^\/reports\/[a-f0-9-]{36}$/.test(String(result.reportUrl)))throw Error('Invalid report link.');
  entry.state=String(result.state);entry.reportUrl=result.reportUrl?String(result.reportUrl):null;
  entry.failureCode=typeof result.failureCode==='string'?result.failureCode:null;await save();
 }
 return plan.entries.reduce<Record<string,number>>((counts,e)=>{const state=e.state??'not-submitted';counts[state]=(counts[state]??0)+1;return counts;},{});
}
export async function batchCommand(args:string[]){
 const [action,path,output,...extra]=args;
 if(!path||extra.length||!['plan','submit','status','dry-run'].includes(action)||(action==='plan'?!output:!!output))throw Error('Usage: batch plan <repositories.json> <plan.json> | batch submit <plan.json> | batch status <plan.json> | batch dry-run <plan.json>');
 const origin=process.env.SHIPTESTED_API_ORIGIN;if(!origin)throw Error('Configure SHIPTESTED_API_ORIGIN.');
 if(action==='plan'){
  const data=await readFile(path,'utf8');if(data.length>200000)throw Error('Repository list is too large.');
  const plan=createPlan(JSON.parse(data),origin);await savePlan(output,plan,true);
  return {planned:plan.entries.length,plan:output,submitted:0};
 }
 // Fail closed if another process is handling the same plan. Never auto-break a stale lock.
 const lock=await open(path+'.lock','wx',0o600);
 try{
  await lock.writeFile(String(process.pid));
  const raw=await readFile(path,'utf8');if(raw.length>1000000)throw Error('Plan is too large.');
  const plan=validatePlan(JSON.parse(raw));
  const client=new HostedClient(origin,process.env.SHIPTESTED_API_TOKEN??'',hostedTransport(origin),process.env.SHIPTESTED_VERCEL_TRANSPORT==='1'?60000:30000);
  if(client.origin!==plan.origin)throw Error('Plan belongs to a different API origin.');
  if(action==='dry-run'){
   const usage=await client.usage(),listing=await client.repositories();
   if(!Array.isArray(listing.repositories))throw Error('Invalid repository listing.');
   const authorized=new Set(listing.repositories.map((r:Record<string,unknown>)=>String(r.full_name).toLowerCase()));
   const missing=plan.entries.filter(e=>e.privateAccess&&!authorized.has(e.repository));
   return {planned:plan.entries.length,submitted:0,accepted:plan.entries.filter(e=>e.id).length,skipped:plan.entries.filter(e=>e.state==='skipped').length,authorized:plan.entries.length-missing.length,missing:missing.map(e=>e.repository),remaining:usage.remaining,ready:missing.length===0&&Number(usage.remaining)>=plan.entries.filter(e=>!e.id&&e.state!=='skipped').length};
  }
  const save=()=>savePlan(path,plan);
  try{return action==='submit'?await submitBatch(plan,client,save):await refreshBatch(plan,client,save);}
  catch(error){
   const status=error instanceof Error?/^ShipTested request failed \(HTTP ([45][0-9]{2})\)/.exec(error.message)?.[1]:undefined;
   const pending=plan.entries.find(e=>!e.id&&e.state!=='skipped');
   if(action==='submit'&&error instanceof PreviewTransportError&&pending)throw new BatchTransportError(pending.repository,error.reason);
   if(action==='submit'&&status&&pending)throw new BatchHttpError(pending.repository,status);
   throw error;
  }
 }finally{await lock.close();await unlink(path+'.lock');}
}
