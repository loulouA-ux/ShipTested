import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {brandEnv} from '../brand-env';
import {structuredHash,type RepairPlan} from '../repair/plan';
import type {RepairRun} from '../repair/runner';
import type {Query} from './db';
import type {Actor} from './store';
import {ApiError} from './http';
import {getRepair} from './repairs';
import {approvalHash} from './repair-execution';
import {auditRepairMutation,repairAuditEvents} from './repair-audit';
import {githubRequest,GitHubRequestError,type RepositorySnapshot} from './github-repositories';
import {repositoryMergeToken} from './repository-connections';
import {gitBlobHash} from './matching-draft';

const sha=z.string().regex(/^[a-f0-9]{40}$/);
const pullSchema=z.object({number:z.number().int().positive(),html_url:z.string().url(),state:z.string(),draft:z.boolean(),merged:z.boolean(),merge_commit_sha:sha.nullable(),mergeable:z.boolean().nullable(),mergeable_state:z.string(),head:z.object({sha,repo:z.object({id:z.number()}).nullable()}),base:z.object({sha,ref:z.string(),repo:z.object({id:z.number()})})});
type Source={id:string;plan:RepairPlan;result:RepairRun;snapshot:RepositorySnapshot;head:string;number:number;url:string;patchHash:string};
export type MergeRecord={state:'requesting'|'pending'|'uncertain'|'failed'|'merged';attempt_id:string;approval_hash:string;head_sha:string;base_sha:string;request_id:string|null;merge_commit:string|null};
export type MergeReadiness={enabled:boolean;ready:boolean;reasons:string[];headSha?:string;baseSha?:string;targetBranch?:string;method:'squash';approvalHash?:string;checks?:{name:string;state:string}[];record?:MergeRecord|null};
export const mergeEnabled=()=>brandEnv('MERGE_ENABLED')==='1'&&brandEnv('CUSTOMER_REPOSITORIES')==='1';

export async function getRepairMerge(query:Query,actor:Actor,id:string){
 await getRepair(query,actor,id);
 const [record]=await query('SELECT state,attempt_id,approval_hash,head_sha,base_sha,request_id,merge_commit FROM sc_repair_merges WHERE repair_id=$1 AND actor_id=$2 AND workspace_id=$3',[id,actor.id,actor.workspaceId]);
 return record as MergeRecord|undefined;
}
async function source(query:Query,actor:Actor,id:string):Promise<Source>{
 const row=await getRepair(query,actor,id);
 if(row.state!=='published')throw new ApiError(409,'Publish and review the verified repair PR before checking a merge.');
 const plan=row.plan as RepairPlan,result=row.result as RepairRun,snapshot=row.snapshot as RepositorySnapshot;
 if(!result)throw new ApiError(409,'Verification evidence is missing. Prepare and verify a fresh repair.');
 const patchHash=approvalHash(plan,result);
 const audit=await repairAuditEvents(query,actor,id);
 if(!audit.some(e=>e.event_type==='patch_approved'&&(e.details as Record<string,unknown>)?.approvalHash===patchHash))throw new ApiError(409,'The published repair lacks exact-patch approval evidence.');
 const head=sha.safeParse(row.publication_commit);
 const prefix=`https://github.com/${snapshot.repository.full_name}/pull/`,url=String(row.pr_url);
 const number=url.startsWith(prefix)?Number(url.slice(prefix.length)):NaN;
 if(!head.success||!Number.isSafeInteger(number)||number<1||url!==prefix+number)throw new ApiError(409,'The saved PR handoff is incomplete. Review it on GitHub.');
 return {id,plan,result,snapshot,head:head.data,number,url,patchHash};
}
function assertPull(p:z.infer<typeof pullSchema>,s:Source){
 const repo=s.snapshot.repository;
 if(p.number!==s.number||p.html_url!==s.url||p.head.sha!==s.head||p.head.repo?.id!==repo.id||p.base.repo.id!==repo.id||p.base.ref!==repo.default_branch)throw new ApiError(409,'The PR target or approved head changed. Prepare and verify a fresh repair.');
}
async function assertUnstacked(s:Source,token:string,fetcher:typeof fetch){
 const stacks=z.array(z.unknown()).max(1).parse(await githubRequest(`/repos/${s.snapshot.repository.full_name}/stacks?pull_request=${s.number}&per_page=1`,token,{},fetcher,'2026-03-10'));
 if(stacks.length)throw new ApiError(409,'Stacked PRs require separate review on GitHub. This approval covers one repair PR only.');
}

/** Read-only provider preflight. Caller supplies the authenticated human's token. */
export async function inspectGitHubMerge(s:Source,actor:Actor,token:string,fetcher:typeof fetch=fetch):Promise<MergeReadiness>{
 const repo=s.snapshot.repository,base=`/repos/${repo.full_name}`;
 const metadata=z.object({id:z.number(),full_name:z.string(),archived:z.boolean(),disabled:z.boolean(),allow_squash_merge:z.boolean(),permissions:z.object({push:z.boolean()})}).parse(await githubRequest(base,token,{},fetcher));
 if(metadata.id!==repo.id||metadata.full_name.toLowerCase()!==repo.full_name.toLowerCase()||!metadata.permissions.push)throw new ApiError(403,'Your current GitHub account cannot merge into this repository.');
 const p=pullSchema.parse(await githubRequest(`${base}/pulls/${s.number}`,token,{},fetcher));assertPull(p,s);
 await assertUnstacked(s,token,fetcher);
 if(p.state!=='open'||p.merged)throw new ApiError(409,'This PR is no longer open. Check its existing merge status.');
 if(p.base.sha!==s.plan.baseCommit)throw new ApiError(409,'The base branch changed. Prepare and verify a fresh repair.');
 const current=z.object({sha}).parse(await githubRequest(`${base}/commits/${encodeURIComponent(repo.default_branch)}`,token,{},fetcher));
 if(current.sha!==s.plan.baseCommit)throw new ApiError(409,'The base branch changed. Prepare and verify a fresh repair.');
 const commit=z.object({sha,parents:z.array(z.object({sha}))}).parse(await githubRequest(`${base}/git/commits/${s.head}`,token,{},fetcher));
 if(commit.sha!==s.head||commit.parents.length!==1||commit.parents[0].sha!==s.plan.baseCommit)throw new ApiError(409,'Only the single verified repair commit can be merged here.');
 const files=z.array(z.object({filename:z.string(),sha,status:z.string()})).max(100).parse(await githubRequest(`${base}/pulls/${s.number}/files?per_page=100`,token,{},fetcher));
 const expected=new Map([['package.json',gitBlobHash(s.plan.manifestAfter)],['package-lock.json',gitBlobHash(s.result.lockfileAfter!)]]);
 if(files.length!==2||new Set(files.map(f=>f.filename)).size!==2||files.some(f=>f.status!=='modified'||expected.get(f.filename)!==f.sha))throw new ApiError(409,'The PR no longer contains exactly the verified dependency patch.');
 const runs=z.object({total_count:z.number().int().nonnegative().max(100),check_runs:z.array(z.object({id:z.number(),name:z.string().max(200),head_sha:sha,status:z.string(),conclusion:z.string().nullable()})).max(100)}).parse(await githubRequest(`${base}/commits/${s.head}/check-runs?filter=latest&per_page=100`,token,{},fetcher));
 const statuses=z.object({sha,total_count:z.number().int().nonnegative().max(100),statuses:z.array(z.object({context:z.string().max(200),state:z.enum(['error','failure','pending','success'])})).max(100)}).parse(await githubRequest(`${base}/commits/${s.head}/status?per_page=100`,token,{},fetcher));
 if(runs.total_count!==runs.check_runs.length||statuses.total_count!==statuses.statuses.length||statuses.sha!==s.head||runs.check_runs.some(c=>c.head_sha!==s.head))throw new ApiError(409,'CI evidence is incomplete or belongs to another commit.');
 const reviews=z.array(z.object({id:z.number(),user:z.object({id:z.number()}).nullable(),state:z.string()})).max(100).parse(await githubRequest(`${base}/pulls/${s.number}/reviews?per_page=100`,token,{},fetcher));
 if(reviews.length===100)throw new ApiError(409,'Review discovery is incomplete. Review this PR on GitHub.');
 const decisions=new Map<number,string>();
 for(const r of [...reviews].sort((a,b)=>a.id-b.id))if(r.user&&['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(r.state))decisions.set(r.user.id,r.state);
 const checks=[...runs.check_runs.map(c=>({name:c.name,state:c.status==='completed'?(c.conclusion??'unknown'):c.status})),...statuses.statuses.map(c=>({name:c.context,state:c.state}))];
 const reasons:string[]=[];
 if(metadata.archived||metadata.disabled)reasons.push('This repository is archived or disabled.');
 if(!metadata.allow_squash_merge)reasons.push('Squash merging is disabled for this repository.');
 if(p.draft)reasons.push('Mark the draft ready for review on GitHub, then check again.');
 if(p.mergeable!==true||p.mergeable_state!=='clean')reasons.push('GitHub has not confirmed this PR is clean and mergeable. Resolve required reviews, conflicts, checks or queue requirements on GitHub.');
 if(!checks.some(c=>c.state==='success'))reasons.push('At least one successful GitHub check or status is required for the approved head.');
 if(checks.some(c=>!['success','neutral','skipped'].includes(c.state)))reasons.push('A GitHub check or status is pending, failed or unknown.');
 if([...decisions.values()].includes('CHANGES_REQUESTED'))reasons.push('A reviewer has outstanding requested changes.');
 const latest=pullSchema.parse(await githubRequest(`${base}/pulls/${s.number}`,token,{},fetcher));assertPull(latest,s);
 if(latest.base.sha!==p.base.sha||latest.draft!==p.draft||latest.state!==p.state||latest.merged!==p.merged||latest.mergeable!==p.mergeable||latest.mergeable_state!==p.mergeable_state)throw new ApiError(409,'PR readiness changed during the check. Refresh before approving.');
 await assertUnstacked(s,token,fetcher);
 const hash=structuredHash({repairId:s.id,actor:actor.id,workspace:actor.workspaceId,repositoryId:repo.id,number:s.number,head:s.head,base:s.plan.baseCommit,patchHash:s.patchHash,method:'squash'});
 return {enabled:true,ready:reasons.length===0,reasons,headSha:s.head,baseSha:s.plan.baseCommit,targetBranch:repo.default_branch,method:'squash',...(reasons.length?{}:{approvalHash:hash}),checks};
}

export async function repairMergeReadiness(query:Query,actor:Actor,id:string,fetcher:typeof fetch=fetch):Promise<MergeReadiness>{
 await getRepair(query,actor,id);
 if(!mergeEnabled())return {enabled:false,ready:false,method:'squash',reasons:['Merging is not enabled here. Review and merge on GitHub.']};
 const record=await getRepairMerge(query,actor,id);
 if(record&&record.state!=='failed')return {enabled:true,ready:false,method:'squash',reasons:[],record};
 const s=await source(query,actor,id),token=await repositoryMergeToken(query,actor,s.snapshot.repository.id,fetcher);
 return {...await inspectGitHubMerge(s,actor,token,fetcher),record:record??null};
}
export async function repairMergeStatus(q:Query,actor:Actor,id:string):Promise<MergeReadiness>{
 const record=await getRepairMerge(q,actor,id);
 return {enabled:mergeEnabled(),ready:false,method:'squash',reasons:[],record:record??null};
}
const outcome=z.discriminatedUnion('status',[
 z.object({status:z.literal('pending'),details:z.object({uuid:z.string().uuid(),expected_head_sha:sha,merge_method:z.literal('squash'),merge_action:z.literal('direct_merge')})}),
 z.object({status:z.literal('merged'),details:z.object({sha})}),
 z.object({status:z.literal('failed'),details:z.object({})}),
 z.object({status:z.literal('enqueued'),details:z.object({})}),
]);
async function saveOutcome(q:Query,actor:Actor,id:string,record:MergeRecord,state:MergeRecord['state'],requestId:string|null=null,commit:string|null=null){
 const event=state==='merged'?'merge_confirmed':state==='failed'?'merge_failed':state==='pending'?'merge_requested':'merge_uncertain';
 await auditRepairMutation(q,actor,id,event,"UPDATE sc_repair_merges SET state=$4,request_id=COALESCE($5::uuid,request_id),merge_commit=$6,updated_at=now() WHERE repair_id=$1 AND actor_id=$2 AND workspace_id=$3 AND attempt_id=$7 AND state IN ('requesting','pending','uncertain') RETURNING repair_id AS id",[id,actor.id,actor.workspaceId,state,requestId,commit,record.attempt_id],{attemptId:record.attempt_id,headSha:record.head_sha,baseSha:record.base_sha,...(requestId?{requestId}:{}),...(commit?{mergeCommit:commit}:{})});
 return (await getRepairMerge(q,actor,id))!;
}
async function confirmedMerged(s:Source,token:string,fetcher:typeof fetch){
 const p=pullSchema.parse(await githubRequest(`/repos/${s.snapshot.repository.full_name}/pulls/${s.number}`,token,{},fetcher));assertPull(p,s);
 return p.merged&&p.state==='closed'&&p.merge_commit_sha?p.merge_commit_sha:null;
}
export async function approveRepairMerge(q:Query,actor:Actor,id:string,hash:string,fetcher:typeof fetch=fetch){
 if(!mergeEnabled())throw new ApiError(403,'Merging is not enabled here.');
 const s=await source(q,actor,id),token=await repositoryMergeToken(q,actor,s.snapshot.repository.id,fetcher);
 const ready=await inspectGitHubMerge(s,actor,token,fetcher);
 if(!ready.ready||ready.approvalHash!==hash)throw new ApiError(409,ready.reasons.join(' ')||'Approve the current PR head and target before merging.');
 const record:MergeRecord={state:'requesting',attempt_id:randomUUID(),approval_hash:hash,head_sha:s.head,base_sha:s.plan.baseCommit,request_id:null,merge_commit:null};
 const claimed=await auditRepairMutation(q,actor,id,'merge_approved',`INSERT INTO sc_repair_merges(repair_id,actor_id,workspace_id,state,approval_hash,head_sha,base_sha,attempt_id)
 SELECT id,$2,$3,'requesting',$4,$5,$6,$7 FROM sc_repairs WHERE id=$1 AND owner_id=$2 AND workspace_id=$3 AND state='published' AND publication_commit=$5
 ON CONFLICT(repair_id) DO UPDATE SET state='requesting',attempt_id=excluded.attempt_id,approval_hash=excluded.approval_hash,head_sha=excluded.head_sha,base_sha=excluded.base_sha,request_id=NULL,merge_commit=NULL,updated_at=now()
 WHERE sc_repair_merges.state='failed' AND sc_repair_merges.actor_id=$2 AND sc_repair_merges.workspace_id=$3 RETURNING repair_id AS id`,[id,actor.id,actor.workspaceId,hash,s.head,s.plan.baseCommit,record.attempt_id],{attemptId:record.attempt_id,approvalHash:hash,headSha:s.head,baseSha:s.plan.baseCommit,method:'squash'});
 if(!claimed.length)throw new ApiError(409,'A merge attempt already exists. Check its status; do not repeat the merge request.');
 let submitting=true;
 try{
  // The new API explicitly disables rule bypass, including for repository admins.
  const response=await githubRequest(`/repos/${s.snapshot.repository.full_name}/pulls/${s.number}/merge-async`,token,{method:'PUT',body:JSON.stringify({sha:s.head,merge_method:'squash',merge_action:'direct_merge',bypass_rules:false})},fetcher,'2026-03-10');
  submitting=false;
  const result=outcome.parse(response);
  if(result.status==='pending'){
   if(result.details.expected_head_sha!==s.head)throw Error('Unexpected merge head.');
   return await saveOutcome(q,actor,id,record,'pending',result.details.uuid);
  }
  if(result.status==='failed')return await saveOutcome(q,actor,id,record,'failed');
  if(result.status==='merged'){
   const commit=await confirmedMerged(s,token,fetcher);
   if(commit!==result.details.sha)throw Error('Merge confirmation differs.');
   return await saveOutcome(q,actor,id,record,'merged',null,commit);
  }
  // Queues are outside this first direct-merge workflow. Never label enqueued as merged.
  return await saveOutcome(q,actor,id,record,'uncertain');
 }catch(error){
  const definite=submitting&&error instanceof GitHubRequestError&&[400,403,404,422].includes(error.status);
  await saveOutcome(q,actor,id,record,definite?'failed':'uncertain');
  throw new ApiError(502,definite?'GitHub rejected the merge. Review permissions and protections, then refresh readiness before a new approval.':'Merge outcome is unconfirmed. Check merge status; the write will not be repeated.');
 }
}

/** Reconcile by reads only, even when the feature flag is subsequently disabled. */
export async function reconcileRepairMerge(q:Query,actor:Actor,id:string,fetcher:typeof fetch=fetch){
 const s=await source(q,actor,id),record=await getRepairMerge(q,actor,id);
 if(!record||!['requesting','pending','uncertain'].includes(record.state))throw new ApiError(409,'No unresolved merge request needs reconciliation.');
 const token=await repositoryMergeToken(q,actor,s.snapshot.repository.id,fetcher);
 const commit=await confirmedMerged(s,token,fetcher);
 if(commit)return saveOutcome(q,actor,id,record,'merged',record.request_id,commit);
 if(!record.request_id)return saveOutcome(q,actor,id,record,'uncertain');
 const result=outcome.parse(await githubRequest(`/repos/${s.snapshot.repository.full_name}/pulls/${s.number}/merge-async/${record.request_id}`,token,{},fetcher,'2026-03-10'));
 if(result.status==='failed')return saveOutcome(q,actor,id,record,'failed',record.request_id);
 if(result.status==='pending'&&result.details.expected_head_sha===record.head_sha&&result.details.uuid===record.request_id)return record;
 // A merged response must agree with the PR itself; a later explicit read can confirm it.
 return saveOutcome(q,actor,id,record,'uncertain',record.request_id);
}
