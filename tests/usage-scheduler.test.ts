import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {Query} from '../src/lib/server/db';
import {workspaceUsage} from '../src/lib/server/usage';
import {requireScheduler} from '../src/lib/server/scheduler';
import {observeWorker} from '../src/lib/server/worker-telemetry';
const db=new PGlite();const query:Query=async(sql,p=[])=>(await db.query(sql,p)).rows as Record<string,unknown>[];
beforeAll(async()=>{for(const f of ['001_core','002_hosted_jobs','003_workspaces','004_team_sharing','006_worker_runs','009_batch_retry'])await db.exec(readFileSync(`migrations/${f}.sql`,'utf8'));});
afterAll(()=>db.close());afterEach(()=>vi.unstubAllEnvs());
it('scopes metrics to own scans for members and workspace totals for owners',async()=>{
  await query("INSERT INTO sc_workspaces(id,owner_id,name,plan,seat_limit,seats_used) VALUES('team','owner','Team','team',3,3)");
  for(const [id,role] of [['owner','owner'],['member','member'],['other','member']])await query('INSERT INTO sc_workspace_members(workspace_id,actor_id,role) VALUES($1,$2,$3)',['team',id,role]);
  await query("INSERT INTO sc_scan_allowances(workspace_id,period_start,scan_limit,reserved) VALUES('team',date_trunc('month',now() AT TIME ZONE 'UTC')::date,15,3)");
  for(const [id,state] of [['owner','queued'],['member','failed'],['other','cancelled']])await query("INSERT INTO sc_scan_jobs(id,workspace_id,owner_id,request_key,repository,commit_sha,period_start,state) VALUES($1,'team',$2,$3,'owner/repo',$4,date_trunc('month',now() AT TIME ZONE 'UTC')::date,$5)",[randomUUID(),id,randomUUID(),'a'.repeat(40),state]);
  const member=await workspaceUsage(query,{id:'member',workspaceId:'team',role:'member'});
  expect(member.outcomes).toEqual([{state:'failed',count:1}]);expect(member.scope).toBe('your scans');expect(member.remaining).toBe(12);
  const owner=await workspaceUsage(query,{id:'owner',workspaceId:'team',role:'member'});
  expect(owner.outcomes).toHaveLength(3);expect(owner.scope).toBe('workspace');expect(owner.averageDurationMs).toBeNull();
  await expect(workspaceUsage(query,{id:'intruder',workspaceId:'team',role:'member'})).rejects.toMatchObject({status:403});
});
it('scheduler fails closed and does not accept missing or partial credentials',()=>{
  vi.stubEnv('CRON_SECRET','');expect(()=>requireScheduler(new Request('https://example.com'))).toThrow('not configured');
  vi.stubEnv('CRON_SECRET','a'.repeat(48));
  expect(()=>requireScheduler(new Request('https://example.com'))).toThrow('required');
  expect(()=>requireScheduler(new Request('https://example.com',{headers:{authorization:'Bearer '+'b'.repeat(48)}}))).toThrow('required');
  expect(()=>requireScheduler(new Request('https://example.com',{headers:{authorization:'Bearer '+'a'.repeat(48)}}))).not.toThrow();
});
it('records worker completion and failure without persisting exception content',async()=>{
  await observeWorker(query,'scan',async()=>({processed:false}));
  await expect(observeWorker(query,'billing',async()=>{throw Error('private provider diagnostic');})).rejects.toThrow();
  const rows=await query('SELECT kind,state,processed,finished_at,duration_ms FROM sc_worker_runs ORDER BY started_at');
  expect(rows.map(r=>r.state)).toEqual(['completed','failed']);
  expect(rows.every(r=>r.finished_at&&Number(r.duration_ms)>=0)).toBe(true);
  expect(JSON.stringify(rows)).not.toContain('private provider');
});
