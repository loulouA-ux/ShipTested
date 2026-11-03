import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import type {Query} from "../src/lib/server/db";
import {auditRepairMutation,repairAuditEvents} from "../src/lib/server/repair-audit";
const db=new PGlite();const query:Query=async(sql,params=[]) => (await db.query(sql,params)).rows as Record<string,unknown>[];
const actor={id:"github:1",workspaceId:"github:1",role:"member" as const};
beforeAll(async()=>{await db.exec(readFileSync("migrations/001_core.sql","utf8"));
for(const f of ['002_hosted_jobs','003_workspaces','004_team_sharing','009_batch_retry'])await db.exec(readFileSync(`migrations/${f}.sql`,'utf8'));});afterAll(()=>db.close());
async function proposal(){const id=randomUUID();await auditRepairMutation(query,actor,id,"proposal_created","INSERT INTO sc_repairs(id,owner_id,workspace_id,state,snapshot,plan) VALUES($1,$2,$3,'proposed',$4::jsonb,'{}') RETURNING id",[id,actor.id,actor.workspaceId,JSON.stringify({files:{"private.js":"private source"}})],{planHash:"a".repeat(64)});return id;}
describe("repair audit trail",()=>{
 it("persists ordered actor/evidence events without source and isolates owners/workspaces",async()=>{
  const id=await proposal();await auditRepairMutation(query,actor,id,"verification_started","UPDATE sc_repairs SET state='running' WHERE id=$1 AND state='proposed' RETURNING id",[id]);
  const events=await repairAuditEvents(query,actor,id);expect(events.map(e=>e.event_type)).toEqual(["proposal_created","verification_started"]);expect(events[0].actor_id).toBe(actor.id);expect(events[0].created_at).toBeTruthy();expect(JSON.stringify(events)).not.toContain("private source");
  expect(await repairAuditEvents(query,{...actor,id:"github:2"},id)).toEqual([]);expect(await repairAuditEvents(query,{...actor,workspaceId:"other"},id)).toEqual([]);
 });
 it("does not append an event when a transition loses its state claim",async()=>{
  const id=await proposal();await auditRepairMutation(query,actor,id,"patch_approved","UPDATE sc_repairs SET state='publishing' WHERE id=$1 AND state='verified' RETURNING id",[id]);expect(await repairAuditEvents(query,actor,id)).toHaveLength(1);
 });
 it("rolls back the mutation when the audit insert fails",async()=>{
  const id=await proposal();await expect(auditRepairMutation(query,actor,id,"invalid" as never,"UPDATE sc_repairs SET state='running' WHERE id=$1 RETURNING id",[id])).rejects.toThrow();
  const [row]=await query("SELECT state FROM sc_repairs WHERE id=$1",[id]);expect(row.state).toBe("proposed");expect(await repairAuditEvents(query,actor,id)).toHaveLength(1);
 });
});
