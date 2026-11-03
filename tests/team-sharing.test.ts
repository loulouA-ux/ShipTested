import {beforeAll,beforeEach,afterAll,it,expect,vi,afterEach} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {Query} from '../src/lib/server/db';
import {TeamAccess} from '../src/lib/server/team-access';
import {ReportSharing} from '../src/lib/server/report-sharing';
import {Store} from '../src/lib/server/store';
import {BillingStore} from '../src/lib/server/billing-store';
import {createApiToken,requireApiActor} from '../src/lib/server/api-tokens';
import {ScanJobs} from '../src/lib/server/scan-jobs';
import {createGitHubSession} from '../src/lib/server/github-session';
import {switchWorkspace,requireActor} from '../src/lib/server/session';
import {scanRepository} from '../src/lib/server/repository-scan';
const db=new PGlite();
const query:Query=async(sql,params=[])=>(await db.query(sql,params)).rows as Record<string,unknown>[];
const teams=new TeamAccess(query),shares=new ReportSharing(query);
const owner={id:'github:1',workspaceId:'github:1',role:'member' as const};
beforeAll(async()=>{for(const file of ['001_core','002_hosted_jobs','003_workspaces','004_team_sharing','005_billing','007_api_tokens','008_repository_connections','009_batch_retry'])await db.exec(readFileSync(`migrations/${file}.sql`,'utf8'));});
beforeEach(async()=>{
  await db.exec('TRUNCATE sc_workspaces CASCADE; DELETE FROM sc_report_shares; DELETE FROM sc_scan_jobs; DELETE FROM sc_scans; DELETE FROM sc_sessions; DELETE FROM sc_scan_allowances; DELETE FROM sc_github_accounts;');
  vi.stubEnv('SHIPTESTED_OPEN_REGISTRATION','1');
  await createGitHubSession(query,{githubId:'1',login:'owner'});
  await query("UPDATE sc_workspaces SET plan='team',seat_limit=2 WHERE id=$1",[owner.workspaceId]);
});
afterAll(()=>db.close());afterEach(()=>vi.unstubAllEnvs());
it('binds invitations to verified identities, enforces seats and revokes active access',async()=>{
  vi.stubEnv('SHIPTESTED_OPEN_REGISTRATION','1');
  await createGitHubSession(query,{githubId:'1',login:'owner'});
  const second=await createGitHubSession(query,{githubId:'2',login:'member'});
  await query("UPDATE sc_workspaces SET plan='free' WHERE id=$1",[owner.workspaceId]);
  await expect(teams.invite(owner,'2')).rejects.toMatchObject({status:409});
  await query("UPDATE sc_workspaces SET plan='team',seat_limit=2 WHERE id=$1",[owner.workspaceId]);
  const invite=await teams.invite(owner,'2');
  await expect(teams.accept({...owner,id:'github:3'},invite.token)).rejects.toMatchObject({status:409});
  expect(await teams.accept(second.actor,invite.token)).toBe(owner.workspaceId);
  const request=new Request('https://example.com',{headers:{cookie:`shipcheck_session=${second.token}`}});
  await switchWorkspace(request,query,owner.workspaceId);
  expect((await requireActor(request,query)).workspaceId).toBe(owner.workspaceId);
  await expect(teams.invite({...owner,id:'github:2'},'3')).rejects.toMatchObject({status:403});
  await expect(teams.remove(owner,owner.id)).rejects.toMatchObject({status:404});
  await teams.remove(owner,'github:2');
  await expect(requireActor(request,query)).rejects.toMatchObject({status:401});
  expect((await query('SELECT seats_used FROM sc_workspaces WHERE id=$1',[owner.workspaceId]))[0].seats_used).toBe(1);
});
it('concurrent invitations cannot oversubscribe the remaining seat',async()=>{
  const a=await teams.invite(owner,'4'),b=await teams.invite(owner,'5');
  const result=await Promise.allSettled([teams.accept({...owner,id:'github:4'},a.token),teams.accept({...owner,id:'github:5'},b.token)]);
  expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((await query('SELECT seats_used FROM sc_workspaces WHERE id=$1',[owner.workspaceId]))[0].seats_used).toBe(2);
});
it('rejects revoked and expired invites without admitting members',async()=>{
  const revoked=await teams.invite(owner,'6');await teams.revokeInvite(owner,revoked.id);
  await expect(teams.accept({...owner,id:'github:6'},revoked.token)).rejects.toMatchObject({status:409});
  const expired=await teams.invite(owner,'7');
  await query("UPDATE sc_workspace_invites SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);
  await expect(teams.accept({...owner,id:'github:7'},expired.token)).rejects.toMatchObject({status:409});
  expect(await teams.list(owner)).toHaveLength(1);
});
it('shares only explicitly owned reports and stores hashes, with immediate revocation',async()=>{
  const report=await scanRepository({repository:'owner/repo',commit:'a'.repeat(40),tree:'b'.repeat(40),private:true,files:{},omitted:[]});
  report.id=randomUUID();await new Store(query).saveScan(owner,report);
  await expect(shares.create({...owner,id:'github:2'},report.id)).rejects.toMatchObject({status:404});
  const share=await shares.create(owner,report.id);
  expect(JSON.stringify(await query('SELECT * FROM sc_report_shares'))).not.toContain(share.token);
  expect((await shares.read(share.token)).id).toBe(report.id);
  await expect(shares.revoke({...owner,id:'github:2'},share.id)).rejects.toMatchObject({status:404});
  await shares.revoke(owner,share.id);
  await expect(shares.read(share.token)).rejects.toMatchObject({status:404});
  const expiring=await shares.create(owner,report.id);
  await query("UPDATE sc_report_shares SET expires_at=now()-interval '1 second' WHERE id=$1",[expiring.id]);
  await expect(shares.read(expiring.token)).rejects.toMatchObject({status:404});
  const history=await teams.history(owner);
  expect(history.some(e=>e.event_type==='report_share_revoked')).toBe(true);
  expect(JSON.stringify(history)).not.toContain(share.token);
  await query('DELETE FROM sc_workspace_events');
  expect(await teams.history(owner)).toHaveLength(history.length);
});

it('disables shared links when their owner is disabled or loses an entitled seat',async()=>{
  const member=await createGitHubSession(query,{githubId:'2',login:'member'});
  const invite=await teams.invite(owner,'2');await teams.accept(member.actor,invite.token);
  const actor={...member.actor,workspaceId:owner.workspaceId};
  const report=await scanRepository({repository:'owner/repo',commit:'a'.repeat(40),tree:'b'.repeat(40),private:true,files:{},omitted:[]});
  report.id=randomUUID();await new Store(query).saveScan(actor,report);
  const share=await shares.create(actor,report.id);expect((await shares.read(share.token)).id).toBe(report.id);
  await query("UPDATE sc_github_accounts SET disabled=true WHERE github_id='2'");
  await expect(shares.read(share.token)).rejects.toMatchObject({status:404});
  await query("UPDATE sc_github_accounts SET disabled=false WHERE github_id='2'");
  await query("UPDATE sc_workspaces SET seat_limit=1 WHERE id=$1",[owner.workspaceId]);
  await expect(shares.read(share.token)).rejects.toMatchObject({status:404});
  await query("UPDATE sc_workspaces SET seat_limit=2,plan='free' WHERE id=$1",[owner.workspaceId]);
  await expect(shares.read(share.token)).rejects.toMatchObject({status:404});
});

it.each(['owner','billing'])('%s removal permanently revokes old credentials and jobs even after rejoining',async(mode)=>{
 const member=await createGitHubSession(query,{githubId:'2',login:'member'});
 const invite=await teams.invite(owner,'2');await teams.accept(member.actor,invite.token);
 const actor={...member.actor,workspaceId:owner.workspaceId},jobs=new ScanJobs(query);
 const api=await createApiToken(query,actor,'Old agent',true);
 const personal=await createApiToken(query,member.actor,'Personal agent',true);
 const report=await scanRepository({repository:'owner/repo',commit:'a'.repeat(40),tree:'b'.repeat(40),private:true,files:{},omitted:[]});report.id=randomUUID();await new Store(query).saveScan(actor,report);
 const share=await shares.create(actor,report.id);
 const job=await jobs.enqueue(actor,{repository:'owner/repo',commit:'a'.repeat(40),tree:'b'.repeat(40),private:false,requestKey:randomUUID()});
 const lease=await jobs.claim();
 await query("INSERT INTO sc_repository_connections(workspace_id,actor_id,encrypted_token,expires_at) VALUES($1,$2,'synthetic-ciphertext',now()+interval '1 hour')",[actor.workspaceId,actor.id]);
 await query("INSERT INTO sc_repository_connect_flows(state_hash,workspace_id,actor_id,verifier,browser_hash,expires_at) VALUES('synthetic-state',$1,$2,'synthetic-verifier','synthetic-browser',now()+interval '1 hour')",[actor.workspaceId,actor.id]);
 if(mode==='owner')await teams.remove(owner,actor.id);
 else{const billing=new BillingStore(query);await billing.account(owner);await query("UPDATE sc_billing_accounts SET customer_id='cus_test' WHERE workspace_id=$1",[owner.workspaceId]);const claim=(await billing.claim())!;await billing.reconcile(owner.workspaceId,String(claim.lease_token),Number(claim.revision),{subscriptionId:null,status:'canceled',seats:0,scansPerSeat:5});}
 expect((await jobs.get(actor,String(job.id))).state).toBe('cancelled');
 await expect(jobs.finish(String(job.id),String(lease!.lease_token),{failureCode:'scan_failed'})).rejects.toMatchObject({status:409});
 expect(await query('SELECT * FROM sc_repository_connections WHERE actor_id=$1',[actor.id])).toHaveLength(0);
 expect(await query('SELECT * FROM sc_repository_connect_flows WHERE actor_id=$1',[actor.id])).toHaveLength(0);
 await query("UPDATE sc_workspaces SET plan='team',seat_limit=2 WHERE id=$1",[owner.workspaceId]);
 const again=await teams.invite(owner,'2');await teams.accept(member.actor,again.token);
 await expect(shares.read(share.token)).rejects.toMatchObject({status:404});
 await expect(requireApiActor(new Request('https://example.test',{headers:{Authorization:`Bearer ${api.token}`}}),query)).rejects.toMatchObject({status:401});
 expect((await requireApiActor(new Request('https://example.test',{headers:{Authorization:`Bearer ${personal.token}`}}),query)).workspaceId).toBe(member.actor.workspaceId);
 expect((await query('SELECT reserved FROM sc_scan_allowances WHERE workspace_id=$1',[actor.workspaceId]))[0].reserved).toBe(1);
});
it('does not mint a report share after membership is removed during preflight',async()=>{
 const report=await scanRepository({repository:'owner/repo',commit:'a'.repeat(40),tree:'b'.repeat(40),private:true,files:{},omitted:[]});
 report.id=randomUUID();await new Store(query).saveScan(owner,report);
 let checked=false;
 const interrupted:Query=async(sql,params,options)=>{
  const rows=await query(sql,params,options);
  if(!checked){checked=true;await query('DELETE FROM sc_workspace_members WHERE workspace_id=$1',[owner.workspaceId]);}
  return rows;
 };
 await expect(new ReportSharing(interrupted).create(owner,report.id)).rejects.toMatchObject({status:403});
 expect(await query('SELECT id FROM sc_report_shares')).toEqual([]);
});
