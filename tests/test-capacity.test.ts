import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {setTestCapacity} from '../src/lib/server/test-capacity';
import type {Query} from '../src/lib/server/db';
const db=new PGlite();const q:Query=async(sql,args=[]) => (await db.query(sql,args)).rows as Record<string,unknown>[];
beforeAll(async()=>{for(const f of ['001_core','002_hosted_jobs','003_workspaces','004_team_sharing'])await db.exec(readFileSync(`migrations/${f}.sql`,'utf8'));
 await q("INSERT INTO sc_workspaces(id,owner_id,name) VALUES('personal','github:123','Test'),('other','github:456','Other')");
 await q("INSERT INTO sc_workspace_members(workspace_id,actor_id,role) VALUES('personal','github:123','owner'),('other','github:456','owner')");
 await q("INSERT INTO sc_scan_allowances(workspace_id,period_start,scan_limit,reserved) VALUES('personal',date_trunc('month',now() AT TIME ZONE 'UTC')::date,5,1)");
});
afterAll(()=>db.close());
it('sets 500 capacity only for the confirmed owner without resetting usage, billing or membership',async()=>{
 expect(await setTestCapacity(q,'personal','github:123',500)).toMatchObject({scan_limit:500,reserved:1});
 expect(await setTestCapacity(q,'personal','github:123',350)).toMatchObject({scan_limit:500,reserved:1});
 expect(await q("SELECT plan,seat_limit FROM sc_workspaces WHERE id='personal'")).toEqual([{plan:'free',seat_limit:1}]);
 expect(await q("SELECT * FROM sc_scan_allowances WHERE workspace_id='other'")).toHaveLength(0);
 expect(await q("SELECT * FROM sc_workspace_events WHERE event_type='test_capacity_set'")).toHaveLength(2);
});
it('refuses a different owner and out-of-bounds capacity',async()=>{
 await expect(setTestCapacity(q,'personal','github:456',500)).rejects.toThrow();
 await expect(setTestCapacity(q,'personal','github:123',501)).rejects.toThrow();
});
it('admits 350 distinct jobs through real SQL reservations and refuses job 351',async()=>{
 const {ScanJobs}=await import('../src/lib/server/scan-jobs');const {randomUUID}=await import('node:crypto');
 await db.exec(readFileSync('migrations/009_batch_retry.sql','utf8'));
 await q("INSERT INTO sc_workspaces(id,owner_id,name) VALUES('batch','github:777','Batch test')");
 await q("INSERT INTO sc_workspace_members(workspace_id,actor_id,role) VALUES('batch','github:777','owner')");
 await setTestCapacity(q,'batch','github:777',350);
 const jobs=new ScanJobs(q),actor={id:'github:777',workspaceId:'batch',role:'member' as const};
 const input=(i:number)=>({repository:`heysalad-ai/fixture${i}`,commit:'a'.repeat(40),tree:'b'.repeat(40),private:true,requestKey:randomUUID()});
 const ids=new Set();for(let i=0;i<350;i++)ids.add((await jobs.enqueue(actor,input(i))).id);
 expect(ids.size).toBe(350);
 await expect(jobs.enqueue(actor,input(351))).rejects.toMatchObject({status:429});
 expect(await q("SELECT scan_limit,reserved FROM sc_scan_allowances WHERE workspace_id='batch'")).toEqual([{scan_limit:350,reserved:350}]);
});
