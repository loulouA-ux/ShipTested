import type { Query } from './db';
import { ScanJobs } from './scan-jobs';
import { fetchManifests } from './repository-manifests';
import { scanRepository } from './repository-scan';
import {activeMembership} from './team-access';
import {ApiError} from './http';
import {githubMemberAllowed} from './github-session';

async function requireJobOwner(query:Query,workspaceId:string,ownerId:string){
  if(!ownerId.startsWith('github:'))return; // Legacy operator jobs retain their existing access path.
  const githubId=ownerId.slice(7);
  const [account]=await query('SELECT disabled FROM sc_github_accounts WHERE github_id=$1',[githubId]);
  if(!githubMemberAllowed(githubId)||!account||account.disabled||!await activeMembership(query,workspaceId,ownerId))throw Error('Job owner access revoked.');
}

export async function runRepositoryJob(query:Query,dependencies={fetchManifests,scanRepository}) {
  const jobs=new ScanJobs(query);
  await jobs.expireExhausted();
  const job=await jobs.claim();
  if(!job)return {processed:false};
  const id=String(job.id),token=String(job.lease_token);
  try {
    await requireJobOwner(query,String(job.workspace_id),String(job.owner_id));
    const snapshot=await dependencies.fetchManifests({id:String(job.owner_id),workspaceId:String(job.workspace_id),role:'member'},
      {repository:String(job.repository),commit:String(job.commit_sha),tree:String(job.tree_sha),private:Boolean(job.private_repository),authenticatedAccess:Boolean(job.requested_private_access)});
    const report=await dependencies.scanRepository(snapshot,AbortSignal.timeout(180000));
    await requireJobOwner(query,String(job.workspace_id),String(job.owner_id));
    await jobs.saveReport(id,token,report);
    return {processed:true,id,state:'completed',reportId:report.id};
  } catch (error) {
    // Do not put provider bodies, tokens or source content into errors or operational logs.
    try {await jobs.finish(id,token,{failureCode:error instanceof ApiError&&error.status===422?'unsupported_repository':'scan_failed'});} catch {return {processed:true,id,state:'lease_lost'};}
    return {processed:true,id,state:'failed'};
  }
}
