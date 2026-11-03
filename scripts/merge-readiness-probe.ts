/** Read-only contract probe for an already approved synthetic fixture handoff. */
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {z} from 'zod';
import {database} from '../src/lib/server/db';
import {approvalHash} from '../src/lib/server/repair-execution';
import {inspectGitHubMerge} from '../src/lib/server/repair-merge';
import type {RepairPlan} from '../src/lib/repair/plan';
import type {RepairRun} from '../src/lib/repair/runner';
import type {RepositorySnapshot} from '../src/lib/server/github-repositories';
if(process.env.SHIPTESTED_LOCAL_POSTGRES!=='1')throw Error('Use the isolated local acceptance database.');
const id=z.string().uuid().parse(process.argv[2]);
const [row]=await database()('SELECT owner_id,workspace_id,state,plan,result,snapshot,publication_commit,pr_url FROM sc_repairs WHERE id=$1',[id]);
if(!row||row.state!=='published')throw Error('An already published synthetic repair handoff is required.');
const snapshot=row.snapshot as RepositorySnapshot;
if(!['chilu18/shipcheck-repair-fixture','chilu18/shipcheck-demo-fixture'].includes(snapshot.repository.full_name))throw Error('Only existing synthetic acceptance fixtures are supported.');
const plan=row.plan as RepairPlan,result=row.result as RepairRun;
const url=z.string().url().parse(row.pr_url),prefix=`https://github.com/${snapshot.repository.full_name}/pull/`;
const number=Number(url.slice(prefix.length));
if(!url.startsWith(prefix)||!Number.isSafeInteger(number)||number<1||url!==prefix+number)throw Error('Unexpected fixture PR URL.');
// The token remains in process memory. It is never printed, stored or sent to another host.
const token=execFileSync('gh',['auth','token','--hostname','github.com'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
let reads=0;
const readOnly:typeof fetch=async(input,init)=>{
 if(init?.method&&init.method!=='GET')throw Error('Remote writes are prohibited by this probe.');
 if(new URL(String(input)).origin!=='https://api.github.com')throw Error('Unexpected provider origin.');
 reads++;return fetch(input,init);
};
const ready=await inspectGitHubMerge({id,plan,result,snapshot,head:z.string().regex(/^[a-f0-9]{40}$/).parse(row.publication_commit),number,url,patchHash:approvalHash(plan,result)},{id:String(row.owner_id),workspaceId:String(row.workspace_id),role:'member'},token,readOnly);
const evidence={checkedAt:new Date().toISOString(),scope:'Read-only GitHub API contract probe using existing CLI access. Customer App authorization and a real merge are not exercised.',repository:snapshot.repository.full_name,pr:url,reads,remoteWrites:0,ready:ready.ready,reasons:ready.reasons,headSha:ready.headSha,checks:ready.checks};
mkdirSync('test-results/merge',{recursive:true});writeFileSync('test-results/merge/live-readiness.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
