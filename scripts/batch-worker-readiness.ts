/** Read-only: no lease, job consumption, scan submission or allowance writes. */
import {database} from '../src/lib/server/db';
import {listRepositories} from '../src/lib/server/github-repositories';
import {readFileSync} from 'node:fs';
import {githubMemberAllowed} from '../src/lib/server/github-session';
import {activeMembership} from '../src/lib/server/team-access';
async function main(){
 if(!process.env.SHIPTESTED_WORKER_DB_HOST||new URL(process.env.DATABASE_URL||'').hostname!==process.env.SHIPTESTED_WORKER_DB_HOST||process.env.SHIPTESTED_PUBLIC_DEMO!=='0')throw Error('Pin and explicitly enable the acceptance worker target.');
 const q=database();const columns=await q("SELECT column_name FROM information_schema.columns WHERE table_name='sc_scan_jobs' AND column_name='requested_private_access'");
 if(columns.length!==1)throw Error('Migration 009 is required.');
 const [account]=await q('SELECT disabled FROM sc_github_accounts WHERE github_id=$1',['7957943']);
 if(!githubMemberAllowed('7957943')||!account||account.disabled||!await activeMembership(q,'github:7957943','github:7957943'))throw Error('Batch owner access is not active.');
 const plan=JSON.parse(readFileSync('.private/heysalad-batch-plan.json','utf8'));
 const repositories=await listRepositories({id:'github:7957943',workspaceId:'github:7957943',role:'member'});
 const names=new Set(repositories.map(r=>r.full_name.toLowerCase()));
 const missing=plan.entries.filter((e:{repository:string})=>!names.has(e.repository));
 console.log(JSON.stringify({readOnly:true,ready:missing.length===0,authorized:repositories.length,selected:plan.entries.length,missing:missing.length,jobs:await q('SELECT state,count(*)::int AS count FROM sc_scan_jobs GROUP BY state'),allowance:await q("SELECT scan_limit,reserved FROM sc_scan_allowances WHERE workspace_id='github:7957943' AND period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date")}));
 if(missing.length)process.exitCode=1;
}
main().catch(()=>{console.error('Worker readiness failed; check target, schema and read-only App authorization. No jobs consumed.');process.exitCode=1;});
