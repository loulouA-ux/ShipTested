import { brandEnv } from "../brand-env";
import {auditRepairMutation} from "./repair-audit";
import {z} from "zod";
import type {Query} from "./db";
import {ApiError} from "./http";
import {Store,type Actor} from "./store";
import {getRepair} from "./repairs";
import {githubRequest,installationToken,listRepositories,type RepositorySnapshot} from "./github-repositories";
import {contentHash,structuredHash,rejectDeprecatedTarget,type RepairPlan} from "../repair/plan";
import {verifyRepair,type RepairRun,type SandboxFactory} from "../repair/runner";
import {vercelSandboxFactory} from "../repair/sandbox";
import {matchingDraft} from './matching-draft';
export function approvalHash(plan:RepairPlan,result:RepairRun){
 if(!result.artifactChecks?.baseline||!result.artifactChecks.patched)throw new ApiError(409,"Dependency file integrity evidence is required. Prepare and verify a fresh repair.");
 if(!result.scans?.after||result.scans.after.findings.length||result.scans.after.lockfileHash!==contentHash(result.lockfileAfter||""))throw new ApiError(409,"Complete dependency scan evidence is required for approval.");
 if(result.status!=="passed"||!result.cleanupComplete||!result.lockfileAfter||result.planHash!==plan.planHash)throw new ApiError(409,"Repair is not verified for approval.");
 try{rejectDeprecatedTarget(result.lockfileAfter,plan.packageName);}catch{throw new ApiError(409,"The proposed dependency release is deprecated or invalid. Prepare a fresh repair.");}
 return structuredHash({planHash:plan.planHash,manifest:plan.manifestAfter,lockfile:result.lockfileAfter,result});
}
export function repairRunLimits(env:Record<string,string|undefined>=process.env){
 const read=(name:string)=>{
  const raw=brandEnv(name,env)??"1";
  if(!/^[1-5]$/.test(raw))throw new ApiError(503,"Repair run allowance must be an integer between 1 and 5.");
  return Number(raw);
 };
 return {daily:read("REPAIR_DAILY_RUNS"),total:read("REPAIR_TOTAL_RUNS")};
}
export async function reserveRepairRun(query:Query,limit:number){
 // Lifetime allowance has a fixed window. Failed/abandoned reservations are not refunded.
 // This caps executions, not currency; reconcile provider billing before increasing it.
 const reservations=await query("INSERT INTO sc_quotas(bucket,window_start,used) VALUES('repair-runs-total',0,1) ON CONFLICT(bucket,window_start) DO UPDATE SET used=sc_quotas.used+1 WHERE sc_quotas.used < $1 RETURNING used",[limit]);
 if(!reservations.length)throw new ApiError(429,"Initial repair run allowance reached. Review spend before increasing it.");
}
export async function executeRepair(query:Query,actor:Actor,id:string,factory?:SandboxFactory,fetcher:typeof fetch=fetch){
 const limits=repairRunLimits();
 const make=factory||vercelSandboxFactory(); // Configuration gate before quota/state mutation.
 const row=await getRepair(query,actor,id), snapshot=row.snapshot as RepositorySnapshot,plan=row.plan as RepairPlan;
 if(row.state!=="proposed")throw new ApiError(409,"Repair has already started.");
 if(!(await listRepositories(actor,fetcher)).some(r=>r.id===snapshot.repository.id))throw new ApiError(403,"Repository access was revoked.");
 await new Store(query).quota("repair-runs-global",limits.daily,86400000);
 await reserveRepairRun(query,limits.total);
 const [claimed]=await auditRepairMutation(query,actor,id,"verification_started","UPDATE sc_repairs SET state='running',updated_at=now() WHERE id=$1 AND owner_id=$2 AND workspace_id=$3 AND state='proposed' RETURNING id",[id,actor.id,actor.workspaceId]);
 if(!claimed)throw new ApiError(409,"Repair has already started.");
 try{
  const result=await verifyRepair(plan,snapshot.files,make,fetcher);
  const saved=await auditRepairMutation(query,actor,id,result.status==="passed"?"verification_passed":"verification_failed","UPDATE sc_repairs SET state=$2,result=$3::jsonb,updated_at=now() WHERE id=$1 AND owner_id=$4 AND workspace_id=$5 AND state='running' RETURNING id",[id,result.status==="passed"?"verified":"failed",JSON.stringify(result),actor.id,actor.workspaceId],{evidenceHash:structuredHash(result),cleanupComplete:result.cleanupComplete});
  if(!saved.length)throw new ApiError(409,"Verification state changed. Inspect the saved repair; no execution will be repeated.");
  return {id,state:result.status==="passed"?"verified":"failed",result,approvalHash:result.status==="passed"?approvalHash(plan,result):null};
 }catch(error){
  await auditRepairMutation(query,actor,id,"verification_failed","UPDATE sc_repairs SET state='failed',updated_at=now() WHERE id=$1 AND owner_id=$2 AND workspace_id=$3 AND state='running' RETURNING id",[id,actor.id,actor.workspaceId],{reasonCode:"execution_failed"});
  if(error instanceof ApiError)throw error;
  throw new ApiError(502,"Repair execution failed. Review evidence before retrying.");
 }
}
export const interruptedRepairDelayMs=15*60*1000;
export function canRecoverRepair(row:{state?:unknown;updated_at?:unknown},now=Date.now()){
 return row.state==='running'&&typeof row.updated_at!=='undefined'&&now-new Date(String(row.updated_at)).getTime()>=interruptedRepairDelayMs;
}
/** Record an abandoned request without repeating paid work or claiming cleanup. */
export async function recoverInterruptedRepair(query:Query,actor:Actor,id:string){
 const row=await getRepair(query,actor,id);
 if(!canRecoverRepair(row))throw new ApiError(409,"Only verification stalled for at least 15 minutes can be recorded as interrupted.");
 const previous=row.result as Partial<RepairRun>|null;
 const result:RepairRun={...previous,planHash:(row.plan as RepairPlan).planHash,status:'incomplete',baseline:previous?.baseline||[],patched:previous?.patched||[],cleanupComplete:false,errors:[...(previous?.errors||[]),'Verification was interrupted. Inspect provider compute and cleanup before preparing a fresh proposal.']};
 const saved=await auditRepairMutation(query,actor,id,'verification_failed',"UPDATE sc_repairs SET state='failed',result=$4::jsonb,updated_at=now() WHERE id=$1 AND owner_id=$2 AND workspace_id=$3 AND state='running' AND updated_at<=now()-interval '15 minutes' RETURNING id",[id,actor.id,actor.workspaceId,JSON.stringify(result)],{reasonCode:'worker_interrupted',cleanupComplete:false});
 if(!saved.length)throw new ApiError(409,"Repair state changed. Reload the saved evidence.");
 return {id,state:'failed',result};
}
const shaSchema=z.object({sha:z.string().regex(/^[a-f0-9]{40}$/)});
export async function publishRepair(query:Query,actor:Actor,id:string,approvedHash:string,fetcher:typeof fetch=fetch,expectedExistingDraft?:string){
 const row=await getRepair(query,actor,id),plan=row.plan as RepairPlan,result=row.result as RepairRun,snapshot=row.snapshot as RepositorySnapshot;
 if(row.state!=="verified"||!result||approvalHash(plan,result)!==approvedHash)throw new ApiError(409,"Approve the current verified patch before creating a PR.");
 if(!(await listRepositories(actor,fetcher)).some(r=>r.id===snapshot.repository.id))throw new ApiError(403,"Repository access was revoked.");
 const readToken=await installationToken(actor,snapshot.repository.id,false,fetcher,true),base=`/repos/${snapshot.repository.full_name}`;
 const head=shaSchema.parse(await githubRequest(`${base}/commits/${encodeURIComponent(snapshot.repository.default_branch)}`,readToken,{},fetcher));
 if(head.sha!==plan.baseCommit)throw new ApiError(409,"Base branch changed. Propose and verify a fresh repair.");
 const existing=await matchingDraft(snapshot,plan,result.lockfileAfter!,readToken,fetcher);
 if(expectedExistingDraft&&existing?.html_url!==expectedExistingDraft)throw new ApiError(409,'The expected matching draft is unavailable. No new pull request was created.');
 if(existing){
  const saved=await auditRepairMutation(query,actor,id,'patch_approved',"UPDATE sc_repairs SET state='published',pr_url=$4,publication_commit=$5,updated_at=now() WHERE id=$1 AND owner_id=$2 AND workspace_id=$3 AND state='verified' RETURNING id",[id,actor.id,actor.workspaceId,existing.html_url,existing.head.sha],{approvalHash:approvedHash,planHash:plan.planHash,baseCommit:plan.baseCommit,existingDraft:true,url:existing.html_url,commit:existing.head.sha});
  if(!saved.length)throw new ApiError(409,'Repair state changed. Reload its saved evidence.');
  return {id,state:'published',url:existing.html_url,reused:true};
 }
 const token=await installationToken(actor,snapshot.repository.id,true,fetcher);
 const [claimed]=await auditRepairMutation(query,actor,id,"patch_approved","UPDATE sc_repairs SET state='publishing',updated_at=now() WHERE id=$1 AND owner_id=$2 AND workspace_id=$3 AND state='verified' RETURNING id",[id,actor.id,actor.workspaceId],{approvalHash:approvedHash,planHash:plan.planHash,baseCommit:plan.baseCommit});
 if(!claimed)throw new ApiError(409,"PR handoff already started.");
 // Keep publishing state on unknown outcome. Never blindly retry writes or create duplicate PRs.
 const tree=shaSchema.parse(await githubRequest(`${base}/git/trees`,token,{method:"POST",body:JSON.stringify({base_tree:snapshot.tree,tree:[{path:"package.json",mode:"100644",type:"blob",content:plan.manifestAfter},{path:"package-lock.json",mode:"100644",type:"blob",content:result.lockfileAfter}]})},fetcher));
 const commit=shaSchema.parse(await githubRequest(`${base}/git/commits`,token,{method:"POST",body:JSON.stringify({message:`Fix ${plan.packageName} dependency: ${plan.fromVersion} to ${plan.toVersion}`,tree:tree.sha,parents:[plan.baseCommit]})},fetcher));
 await auditRepairMutation(query,actor,id,"publication_commit_created","UPDATE sc_repairs SET publication_commit=$2,updated_at=now() WHERE id=$1 AND state='publishing' RETURNING id",[id,commit.sha],{commit:commit.sha});
 const branch=`codex/shipcheck-repair-${id}`;
 await githubRequest(`${base}/git/refs`,token,{method:"POST",body:JSON.stringify({ref:`refs/heads/${branch}`,sha:commit.sha})},fetcher);
 const pr=z.object({html_url:z.string().url()}).parse(await githubRequest(`${base}/pulls`,token,{method:"POST",body:JSON.stringify({title:`Fix ${plan.packageName}: ${plan.fromVersion} → ${plan.toVersion}`,head:branch,base:snapshot.repository.default_branch,draft:true,body:`Proposes a dependency upgrade based on OSV evidence.\n\n${plan.sourceUrls.join("\n")}\n\nBaseline and patched sandbox commands exited successfully; post-repair dependency lookup passed. This is not a guarantee of application security. Review the diff and CI before merging.\n\nApproved patch: ${approvedHash}\nSource commit: ${plan.baseCommit}\n\nNo automatic merge or deployment is performed.`})},fetcher));
 if(!pr.html_url.startsWith(`https://github.com/${snapshot.repository.full_name}/pull/`))throw Error("Unexpected PR URL.");
 await auditRepairMutation(query,actor,id,"draft_pr_created","UPDATE sc_repairs SET state='published',pr_url=$2,updated_at=now() WHERE id=$1 RETURNING id",[id,pr.html_url],{url:pr.html_url,commit:commit.sha});
 return {id,state:"published",url:pr.html_url};
}

// Recover an accepted PR response using reads only. Never retry GitHub writes.
export async function reconcileRepair(query:Query,actor:Actor,id:string,fetcher:typeof fetch=fetch){
 const row=await getRepair(query,actor,id);
 if(row.state!=="publishing")throw new ApiError(409,"Only an uncertain publication can be reconciled.");
 const snapshot=row.snapshot as RepositorySnapshot;
 if(typeof row.publication_commit!=="string"||!/^[a-f0-9]{40}$/.test(row.publication_commit))throw new ApiError(409,"No confirmed publication commit. Inspect the repository before proposing again.");
 if(!(await listRepositories(actor,fetcher)).some(r=>r.id===snapshot.repository.id))throw new ApiError(403,"Repository access was revoked.");
 const token=await installationToken(actor,snapshot.repository.id,false,fetcher,true);
 const branch=`codex/shipcheck-repair-${id}`,owner=snapshot.repository.full_name.split("/")[0];
 const matches=z.array(z.object({html_url:z.string().url(),draft:z.boolean(),state:z.string(),merged_at:z.string().nullable(),head:z.object({sha:z.string(),ref:z.string(),repo:z.object({id:z.number()}).nullable()}),base:z.object({ref:z.string(),repo:z.object({id:z.number()})})})).parse(await githubRequest(`/repos/${snapshot.repository.full_name}/pulls?state=all&head=${encodeURIComponent(owner+":"+branch)}&per_page=2`,token,{},fetcher));
 if(matches.length!==1)throw new ApiError(409,"No unique existing PR was found. No GitHub writes were repeated.");
 const pr=matches[0];
 if(pr.head.sha!==row.publication_commit||pr.head.ref!==branch||pr.head.repo?.id!==snapshot.repository.id||pr.base.repo.id!==snapshot.repository.id||pr.base.ref!==snapshot.repository.default_branch||pr.state!=="open"||!pr.draft||pr.merged_at!==null||!pr.html_url.startsWith(`https://github.com/${snapshot.repository.full_name}/pull/`))throw new ApiError(409,"Existing PR differs from the approved handoff. Manual review is required.");
 const updated=await auditRepairMutation(query,actor,id,"draft_pr_reconciled","UPDATE sc_repairs SET state='published',pr_url=$2,updated_at=now() WHERE id=$1 AND owner_id=$3 AND workspace_id=$4 AND state='publishing' RETURNING id",[id,pr.html_url,actor.id,actor.workspaceId],{url:pr.html_url,commit:row.publication_commit});
 if(!updated.length)throw new ApiError(409,"Repair state changed during reconciliation.");
 return {id,state:"published",url:pr.html_url};
}
