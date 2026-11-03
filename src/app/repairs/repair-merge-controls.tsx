"use client";
import {useEffect,useRef,useState} from 'react';
import {GitMerge,RefreshCw} from 'lucide-react';
import type {MergeReadiness,MergeRecord} from '@/lib/server/repair-merge';
import {notifySessionExpired} from '../session-expired';
import styles from './repairs.module.css';

export default function RepairMergeControls({id,onSaved}:{id:string;onSaved:()=>Promise<void>}){
 const [preview,setPreview]=useState<MergeReadiness|null>(null),[approved,setApproved]=useState(false),[busy,setBusy]=useState('Loading merge status…'),[error,setError]=useState('');
 const lock=useRef(false),generation=useRef(0);
 async function request(data?:unknown,statusOnly=false){
  const r=await fetch(`/api/repairs/${encodeURIComponent(id)}/merge${statusOnly?'?status=1':''}`,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{cache:'no-store'});
  const result=await r.json();if(r.status===401)notifySessionExpired();
  if(!r.ok)throw Error(r.status===401?'Sign in again to review merge status.':result.error||'Merge readiness is unavailable. No merge will be repeated automatically.');
  return result;
 }
 useEffect(()=>{
  const sequence=++generation.current;setPreview(null);setApproved(false);setError('');lock.current=true;
  void request(undefined,true).then(data=>{if(sequence===generation.current)setPreview(data);}).catch(e=>{if(sequence===generation.current)setError(e.message);}).finally(()=>{if(sequence===generation.current){lock.current=false;setBusy('');}});
  return()=>{generation.current++;};
 },[id]);
 async function run(action:'preview'|'approve'|'reconcile'){
  if(lock.current)return;lock.current=true;const sequence=generation.current;
  setBusy(action==='preview'?'Checking the current PR, permissions and GitHub checks…':action==='approve'?'Submitting your approved merge…':'Reading the existing merge status…');setError('');setApproved(false);
  try{
   const data=await request(action==='preview'?undefined:action==='approve'?{action:'approve',approvalHash:preview?.approvalHash,confirmMerge:true}:{action:'reconcile'});
   if(sequence!==generation.current)return;
   setPreview(action==='preview'?data:{enabled:preview?.enabled??false,ready:false,method:'squash',reasons:[],record:data as MergeRecord});
   if(action!=='preview')await onSaved();
  }catch(e){
   if(sequence!==generation.current)return;setError(e instanceof Error?e.message:'Merge check failed.');
   // Discard readiness after any attempted action. Reload local status, never repeat writes.
   setPreview(null);
   try{const data=await request(undefined,true);if(sequence===generation.current)setPreview(data);}catch{ /* The error and saved server state remain available for a later read. */ }
  }finally{lock.current=false;if(sequence===generation.current)setBusy('');}
 }
 const record=preview?.record,unresolved=record&&['requesting','pending','uncertain'].includes(record.state);
 return <section className="repair-panel" aria-label="Merge verified repair">
  <h2>{record?.state==='merged'?'Repair merged':'Merge verified repair'}</h2>
  <p>A merge needs a separate approval after draft publication. GitHub reviews and branch protections still apply. Merging may trigger your repository’s deployment pipeline.</p>
  {busy&&<p role="status">{busy}</p>}
  {error&&<p role="alert">{error} No merge request will repeat automatically.</p>}
  {!preview&&!busy&&<button className="button" onClick={()=>void run('preview')}><RefreshCw size={16} aria-hidden="true" className="action-icon"/>Retry readiness check</button>}
  {record?.state==='merged'?<><p>The approved PR head was confirmed merged on GitHub. Deployment status has not been checked.</p><p>Approved head: <code className={styles.hash}>{record.head_sha}</code></p><p>Merge commit: <code className={styles.hash}>{record.merge_commit}</code></p></>:unresolved?<>
   <p>{record.state==='pending'?'GitHub accepted the request and is processing it. A completed merge is not confirmed.':'The merge outcome is unconfirmed. Check GitHub status before taking another action.'}</p>
   <button className="button" disabled={!!busy} onClick={()=>void run('reconcile')}><RefreshCw size={16} aria-hidden="true" className="action-icon"/>Check merge status</button>
  </>:<>
   {record?.state==='failed'&&<p>GitHub rejected the previous merge attempt. Resolve the cause and refresh readiness before approving again.</p>}
   {preview&&!preview.enabled?<p>Merging is not enabled here. Open the PR to review and merge on GitHub.</p>:preview&&<>
    <button className="button" disabled={!!busy} onClick={()=>void run('preview')}><RefreshCw size={16} aria-hidden="true" className="action-icon"/>{preview.headSha?'Refresh merge readiness':'Check merge readiness'}</button>
    {preview.headSha&&<dl className={styles.facts}><div><dt>Merge method</dt><dd>Squash</dd></div><div><dt>Target branch</dt><dd>{preview.targetBranch}</dd></div><div><dt>Approved PR head</dt><dd><code>{preview.headSha}</code></dd></div><div><dt>Verified base</dt><dd><code>{preview.baseSha}</code></dd></div></dl>}
    {!!preview.reasons.length&&<ul>{preview.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>}
    {!!preview.checks?.length&&<details open><summary>Current GitHub checks</summary><ul>{preview.checks.map((check,i)=><li key={i}>{check.name} · {check.state}</li>)}</ul></details>}
    {preview.ready&&preview.approvalHash&&<>
     <p>GitHub currently reports this exact PR head as ready. Permissions, patch contents and readiness will be checked again when you approve. This approval expires after five minutes and can be used once.</p>
     <label><input type="checkbox" checked={approved} disabled={!!busy} onChange={e=>setApproved(e.target.checked)}/> I approve merging this exact PR head into the target branch and understand it may trigger deployment.</label>
     <p><button className="button primary" disabled={!approved||!!busy} onClick={()=>void run('approve')}><GitMerge size={16} aria-hidden="true" className="action-icon"/>Approve and squash merge</button></p>
    </>}
   </>}
  </>}
 </section>;
}
