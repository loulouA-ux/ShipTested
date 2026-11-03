import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {createGitHubSession} from '../src/lib/server/github-session';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ScanJobs } from '../src/lib/server/scan-jobs';
import type { Query } from '../src/lib/server/db';
import type { Actor } from '../src/lib/server/store';
import { Store } from '../src/lib/server/store';
import { runRepositoryJob } from '../src/lib/server/repository-worker';
import { scanRepository, type RepositoryReport } from '../src/lib/server/repository-scan';
const db = new PGlite();
const query: Query = async (sql, params = []) => (await db.query(sql, params)).rows as Record<string, unknown>[];
const jobs = new ScanJobs(query);
const actor: Actor = {id:'peter',workspaceId:'team',role:'member'};
const input = () => ({requestKey:randomUUID(),repository:'heysalad-ai/nicedeck',commit:'a'.repeat(40),tree:'b'.repeat(40),private:false});
beforeAll(async () => {
  for(const file of ['001_core','002_hosted_jobs','003_workspaces','004_team_sharing','009_batch_retry'])await db.exec(readFileSync(`migrations/${file}.sql`,'utf8'));
  await query("INSERT INTO sc_workspaces(id,owner_id,name) VALUES('team','peter','Test workspace')");
  await db.exec(readFileSync('migrations/002_hosted_jobs.sql','utf8'));
  await db.exec(readFileSync('migrations/002_hosted_jobs.sql','utf8'));
});
beforeEach(async () => {
  await db.exec('DELETE FROM sc_scan_jobs; DELETE FROM sc_scan_allowances; DELETE FROM sc_scans;');
  await query("INSERT INTO sc_scan_allowances(workspace_id,period_start,scan_limit) VALUES('team',date_trunc('month',now() AT TIME ZONE 'UTC')::date,3)");
});
afterAll(() => db.close());
it('reserves no more than the allowance under competing submissions', async () => {
  const results = await Promise.allSettled(Array.from({length:8},() => jobs.enqueue(actor,input())));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(3);
  expect((await query('SELECT reserved FROM sc_scan_allowances'))[0].reserved).toBe(3);
  expect((await query('SELECT count(*)::int AS count FROM sc_scan_jobs'))[0].count).toBe(3);
});
it('retries the same request without consuming additional allowance', async () => {
  const req=input();
  const results=await Promise.all(Array.from({length:5},()=>jobs.enqueue(actor,req)));
  expect(new Set(results.map(r=>r.id)).size).toBe(1);
  expect((await query('SELECT reserved FROM sc_scan_allowances'))[0].reserved).toBe(1);
  expect(await query("SELECT * FROM sc_workspace_events WHERE subject_id=$1 AND event_type='scan_queued'",[results[0].id])).toHaveLength(1);
  expect((await jobs.enqueue(actor,{...req,commit:'b'.repeat(40)})).commit_sha).toBe(req.commit);
  await expect(jobs.enqueue(actor,{...req,privateAccess:true})).rejects.toMatchObject({status:409});
});
it('isolates both owner and workspace and refuses unprovisioned workspaces', async () => {
  const row=await jobs.enqueue(actor,input());
  await expect(jobs.get({...actor,id:'louise'},String(row.id))).rejects.toMatchObject({status:404});
  await expect(jobs.get({...actor,workspaceId:'other'},String(row.id))).rejects.toMatchObject({status:404});
  await expect(jobs.enqueue({...actor,workspaceId:'other'},input())).rejects.toMatchObject({status:429});
});
it('only cancels queued owned jobs and preserves accounting', async () => {
  const row=await jobs.enqueue(actor,input());
  await expect(jobs.cancelQueued({...actor,id:'louise'},String(row.id))).rejects.toMatchObject({status:404});
  expect((await jobs.cancelQueued(actor,String(row.id))).state).toBe('cancelled');
  await expect(jobs.cancelQueued(actor,String(row.id))).rejects.toMatchObject({status:409});
  expect((await query('SELECT reserved FROM sc_scan_allowances'))[0].reserved).toBe(1);
});
it('rejects malformed source and request identity before reserving', async () => {
  await expect(jobs.enqueue(actor,{...input(),repository:'https://evil.example/repo'})).rejects.toMatchObject({status:400});
  await expect(jobs.enqueue(actor,{...input(),commit:'main'})).rejects.toMatchObject({status:400});
  expect((await query('SELECT reserved FROM sc_scan_allowances'))[0].reserved).toBe(0);
});
it('claims once and fences expired workers when recovering a job', async () => {
  await jobs.enqueue(actor,input());
  const claims=await Promise.all([jobs.claim(),jobs.claim()]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const first=claims.find(Boolean)!;
  await query("UPDATE sc_scan_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[first.id]);
  const second=(await jobs.claim())!;
  expect(second.id).toBe(first.id);
  expect(second.attempts).toBe(2);
  expect(second.lease_token).not.toBe(first.lease_token);
  await expect(jobs.finish(String(first.id),String(first.lease_token),{failureCode:'scan_failed'})).rejects.toMatchObject({status:409});
  expect((await jobs.finish(String(second.id),String(second.lease_token),{failureCode:'provider_unavailable'})).state).toBe('failed');
  expect(await jobs.claim()).toBeNull();
});
it('bounds recovery to three attempts then records failure',async()=>{
  await jobs.enqueue(actor,input());
  for(let i=0;i<3;i++){
    const job=(await jobs.claim())!;
    expect(job.attempts).toBe(i+1);
    await query("UPDATE sc_scan_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[job.id]);
  }
  expect(await jobs.claim()).toBeNull();
  expect(await jobs.expireExhausted()).toHaveLength(1);
  expect((await query('SELECT state,failure_code FROM sc_scan_jobs'))[0]).toMatchObject({state:'failed',failure_code:'retry_exhausted'});
});
it('persists the report and completes its job atomically with owner isolation',async()=>{
  const req=input();await jobs.enqueue(actor,req);
  const report=await scanRepository({repository:req.repository,commit:req.commit,tree:req.tree,private:false,files:{},omitted:['uv.lock']});
  const result=await runRepositoryJob(query,{
    fetchManifests:async()=>({repository:req.repository,commit:req.commit,tree:req.tree,private:false,files:{},omitted:[]}),
    scanRepository:async()=>report,
  });
  expect(result.state).toBe('completed');
  const saved=await new Store(query).getScan(actor,report.id) as RepositoryReport;
  expect(saved.repositoryScan.commit).toBe(req.commit);
  expect(saved.status).toBe('Incomplete');
  await expect(new Store(query).getScan({...actor,id:'other'},report.id)).rejects.toMatchObject({status:404});
  expect((await query('SELECT report_id,state FROM sc_scan_jobs'))[0]).toEqual({report_id:report.id,state:'completed'});
});
it('does not save a report from a stale worker or a different source commit',async()=>{
  const req=input();await jobs.enqueue(actor,req);const job=(await jobs.claim())!;
  const report=await scanRepository({repository:req.repository,commit:'c'.repeat(40),tree:req.tree,private:false,files:{},omitted:[]});
  await expect(jobs.saveReport(String(job.id),String(job.lease_token),report)).rejects.toMatchObject({status:409});
  report.repositoryScan.commit=req.commit;
  await query("UPDATE sc_scan_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[job.id]);
  await expect(jobs.saveReport(String(job.id),String(job.lease_token),report)).rejects.toMatchObject({status:409});
  expect((await query('SELECT count(*)::int AS count FROM sc_scans'))[0].count).toBe(0);
});

it('records state transitions atomically and refuses stale workers without extra audit events',async()=>{
 const row=await jobs.enqueue(actor,input());const claim=await jobs.claim();
 await jobs.finish(String(row.id),String(claim!.lease_token),{failureCode:'scan_failed'});
 await expect(jobs.finish(String(row.id),String(claim!.lease_token),{failureCode:'scan_failed'})).rejects.toMatchObject({status:409});
 const events=await query('SELECT event_type FROM sc_workspace_events WHERE subject_id=$1 ORDER BY sequence',[row.id]);
 expect(events.map(e=>e.event_type)).toEqual(['scan_queued','scan_started','scan_failed']);
 const cancelled=await jobs.enqueue(actor,input());await jobs.cancelQueued(actor,String(cancelled.id));
 expect((await query('SELECT event_type FROM sc_workspace_events WHERE subject_id=$1 ORDER BY sequence',[cancelled.id])).map(e=>e.event_type)).toEqual(['scan_queued','scan_cancelled']);
});

afterEach(()=>vi.unstubAllEnvs());
it('does not fetch code for disabled accounts or persist results after mid-scan revocation',async()=>{
 vi.stubEnv('SHIPTESTED_OPEN_REGISTRATION','1');
 const session=await createGitHubSession(query,{githubId:'900001',login:'synthetic-worker-test'});
 const req=input();await jobs.enqueue(session.actor,req);
 await query("UPDATE sc_github_accounts SET disabled=true WHERE github_id='900001'");
 const fetchManifests=vi.fn().mockResolvedValue({repository:req.repository,commit:req.commit,tree:req.tree,private:false,files:{},omitted:[]});
 expect((await runRepositoryJob(query,{fetchManifests,scanRepository})).state).toBe('failed');expect(fetchManifests).not.toHaveBeenCalled();
 await query("UPDATE sc_github_accounts SET disabled=false WHERE github_id='900001'");
 const second=await jobs.enqueue(session.actor,{...req,requestKey:randomUUID()});
 const scanThenRevoke:typeof scanRepository=async(snapshot,signal)=>{
   const report=await scanRepository(snapshot,signal);
   await query("UPDATE sc_github_accounts SET disabled=true WHERE github_id='900001'");return report;
 };
 expect((await runRepositoryJob(query,{fetchManifests,scanRepository:scanThenRevoke})).state).toBe('failed');
 expect((await jobs.get(session.actor,String(second.id))).report_id).toBeNull();
});

it('retries the original submission without resolving a moving default branch',async()=>{
 const req={...input(),privateAccess:true};const row=await jobs.enqueue(actor,req);
 expect((await jobs.submitted(actor,req.requestKey,req.repository,true))?.id).toBe(row.id);
 await expect(jobs.submitted(actor,req.requestKey,'other/repository',true)).rejects.toMatchObject({status:409});
 await expect(jobs.submitted(actor,req.requestKey,req.repository,false)).rejects.toMatchObject({status:409});
 expect(await jobs.submitted({...actor,id:'other'},req.requestKey,req.repository,true)).toBeUndefined();
 expect((await query('SELECT reserved FROM sc_scan_allowances'))[0].reserved).toBe(1);
});
it('keeps authenticated reads for public repositories when explicitly requested',async()=>{
 const req={...input(),privateAccess:true};await jobs.enqueue(actor,req);
 let authenticated=false;
 await runRepositoryJob(query,{
  fetchManifests:async(_actor,source)=>{authenticated=source.authenticatedAccess===true;expect(source.private).toBe(false);return {...source,files:{},omitted:[]};},
  scanRepository,
 });
 expect(authenticated).toBe(true);
});
it('records bounded discovery rejection as unsupported without storing provider text',async()=>{
 const {ApiError}=await import('../src/lib/server/http');
 await jobs.enqueue(actor,input());
 const scan=vi.fn();
 await runRepositoryJob(query,{fetchManifests:async()=>{throw new ApiError(422,'Private provider detail must not be stored');},scanRepository:scan});
 expect(scan).not.toHaveBeenCalled();
 expect(await query('SELECT state,failure_code FROM sc_scan_jobs')).toEqual([{state:'failed',failure_code:'unsupported_repository'}]);
});
