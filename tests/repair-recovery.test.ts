import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {canRecoverRepair,recoverInterruptedRepair,approvalHash} from '../src/lib/server/repair-execution';
import type {Query} from '../src/lib/server/db';
import type {RepairPlan} from '../src/lib/repair/plan';
const db=new PGlite(),query:Query=async(sql,params=[]) => (await db.query(sql,params)).rows as Record<string,unknown>[];
const actor={id:'owner',workspaceId:'workspace',role:'member' as const};
beforeAll(()=>db.exec(readFileSync('migrations/001_core.sql','utf8')));afterAll(()=>db.close());
async function stalled(state='running',age="16 minutes"){
 const id=randomUUID();await query("INSERT INTO sc_repairs(id,owner_id,workspace_id,state,snapshot,plan,updated_at) VALUES($1,$2,$3,$4,'{}',$5::jsonb,now()-$6::interval)",[id,actor.id,actor.workspaceId,state,JSON.stringify({planHash:'a'.repeat(64)}),age]);return id;
}
it('records interruption once, without cleanup success, execution or allowance reset',async()=>{
 const id=await stalled();const result=await recoverInterruptedRepair(query,actor,id);
 expect(result.state).toBe('failed');expect(result.result.cleanupComplete).toBe(false);expect(result.result.status).toBe('incomplete');
 expect(()=>approvalHash({planHash:'a'.repeat(64)} as RepairPlan,result.result)).toThrow();
 expect(await query('SELECT event_type FROM sc_repair_events WHERE repair_id=$1',[id])).toEqual([{event_type:'verification_failed'}]);
 await expect(recoverInterruptedRepair(query,actor,id)).rejects.toMatchObject({status:409});
 expect(await query('SELECT * FROM sc_quotas')).toEqual([]);
});
it('cannot interrupt a recent run, finished repair or another owner',async()=>{
 await expect(recoverInterruptedRepair(query,actor,await stalled('running','1 minute'))).rejects.toMatchObject({status:409});
 await expect(recoverInterruptedRepair(query,actor,await stalled('verified'))).rejects.toMatchObject({status:409});
 await expect(recoverInterruptedRepair(query,{...actor,id:'other'},await stalled())).rejects.toMatchObject({status:404});
 expect(canRecoverRepair({state:'running',updated_at:'invalid'})).toBe(false);
});
it('does not overwrite a worker completing between read and recovery',async()=>{
 const id=await stalled();let read=false;
 const racing:Query=async(sql,params,opts)=>{
  const rows=await query(sql,params,opts);
  if(!read&&sql.startsWith('SELECT')){read=true;await query("UPDATE sc_repairs SET state='verified' WHERE id=$1",[id]);}
  return rows;
 };
 await expect(recoverInterruptedRepair(racing,actor,id)).rejects.toMatchObject({status:409});
 expect((await query('SELECT state FROM sc_repairs WHERE id=$1',[id]))[0].state).toBe('verified');
 expect(await query('SELECT event_type FROM sc_repair_events WHERE repair_id=$1',[id])).toEqual([]);
});
