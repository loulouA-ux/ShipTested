import {beforeAll,beforeEach,afterAll,afterEach,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import type {Query} from '../src/lib/server/db';
import {BillingStore} from '../src/lib/server/billing-store';
import {provisionPersonalWorkspace} from '../src/lib/server/workspaces';
import {billingConfig} from '../src/lib/server/billing';
const db=new PGlite();const query:Query=async(sql,p=[])=>(await db.query(sql,p)).rows as Record<string,unknown>[];
const store=new BillingStore(query),owner={id:'github:1',workspaceId:'github:1',role:'member' as const};
beforeAll(async()=>{for(const f of ['001_core','002_hosted_jobs','003_workspaces','004_team_sharing','005_billing','007_api_tokens','008_repository_connections','009_batch_retry'])await db.exec(readFileSync(`migrations/${f}.sql`,'utf8'));});
beforeEach(async()=>{await db.exec('TRUNCATE sc_workspaces CASCADE; DELETE FROM sc_scan_allowances; DELETE FROM sc_billing_events; DELETE FROM sc_sessions;');await provisionPersonalWorkspace(query,'1');await store.account(owner);await query("UPDATE sc_billing_accounts SET customer_id='cus_fixture' WHERE workspace_id=$1",[owner.workspaceId]);});
afterAll(()=>db.close());afterEach(()=>vi.unstubAllEnvs());
it('refuses live keys unless explicitly activated and validates server configuration',()=>{
  vi.stubEnv('STRIPE_SECRET_KEY','rk_live_fixture');vi.stubEnv('STRIPE_TEAM_PRICE_ID','price_fixture');vi.stubEnv('SHIPTESTED_APP_ORIGIN','https://example.com');vi.stubEnv('SHIPTESTED_BILLING_LIVE','0');
  expect(()=>billingConfig()).toThrow('not been activated');
  vi.stubEnv('STRIPE_SECRET_KEY','rk_test_fixture');expect(billingConfig().live).toBe(false);
  vi.stubEnv('SHIPTESTED_SCANS_PER_SEAT','-1');expect(()=>billingConfig()).toThrow('allowance');
});
it('deduplicates events and fences concurrent reconciliation',async()=>{
  await Promise.all([store.recordEvent('evt_1','cus_fixture','invoice.paid'),store.recordEvent('evt_1','cus_fixture','invoice.paid')]);
  expect((await store.account(owner)).revision).toBe(1);
  const claims=await Promise.all([store.claim(),store.claim()]);expect(claims.filter(Boolean)).toHaveLength(1);
  const job=claims.find(Boolean)!;
  await store.reconcile(owner.workspaceId,String(job.lease_token),Number(job.revision),{subscriptionId:'sub_1',status:'active',seats:3,scansPerSeat:5});
  expect((await query('SELECT plan,seat_limit FROM sc_workspaces'))[0]).toEqual({plan:'team',seat_limit:3});
  expect((await query('SELECT scan_limit FROM sc_scan_allowances'))[0].scan_limit).toBe(15);
  await expect(store.reconcile(owner.workspaceId,String(job.lease_token),1,{subscriptionId:null,status:'canceled',seats:0,scansPerSeat:5})).rejects.toMatchObject({status:409});
});
it('retains a new event arriving during reconciliation for the next provider lookup',async()=>{
  const job=(await store.claim())!;
  await store.recordEvent('evt_2','cus_fixture','customer.subscription.updated');
  await store.reconcile(owner.workspaceId,String(job.lease_token),Number(job.revision),{subscriptionId:'sub_1',status:'active',seats:2,scansPerSeat:5});
  expect(await store.claim()).not.toBeNull();
});
it('payment failure removes paid seats, revokes member sessions and does not reset used scans',async()=>{
  await query("UPDATE sc_workspaces SET plan='team',seat_limit=3,seats_used=2");
  await query("INSERT INTO sc_workspace_members(workspace_id,actor_id,role) VALUES($1,'github:2','member')",[owner.workspaceId]);
  await query("INSERT INTO sc_sessions(token_hash,actor_id,workspace_id,credential_hash,expires_at) VALUES('token','github:2',$1,'github-oauth',now()+interval '1 day')",[owner.workspaceId]);
  await query('UPDATE sc_scan_allowances SET scan_limit=15,reserved=12');
  const job=(await store.claim())!;
  await store.reconcile(owner.workspaceId,String(job.lease_token),Number(job.revision),{subscriptionId:'sub_1',status:'past_due',seats:3,scansPerSeat:5});
  expect((await query('SELECT plan,seat_limit,seats_used FROM sc_workspaces'))[0]).toEqual({plan:'free',seat_limit:1,seats_used:1});
  expect(await query('SELECT * FROM sc_sessions')).toHaveLength(0);
  expect(await query('SELECT * FROM sc_workspace_members')).toHaveLength(1);
  expect((await query('SELECT scan_limit,reserved FROM sc_scan_allowances'))[0]).toEqual({scan_limit:12,reserved:12});
});
it('does not allow another member to create or read billing accounts',async()=>{
  await expect(store.account({...owner,id:'github:2'})).rejects.toMatchObject({status:403});
});
