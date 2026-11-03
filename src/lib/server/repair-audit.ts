import {randomUUID} from "node:crypto";
import type {Query} from "./db";
import type {Actor} from "./store";
export type RepairAuditEvent="proposal_created"|"verification_started"|"verification_passed"|"verification_failed"|"patch_approved"|"publication_commit_created"|"draft_pr_created"|"draft_pr_reconciled"|"merge_approved"|"merge_requested"|"merge_uncertain"|"merge_failed"|"merge_confirmed";
// The state mutation and its event either both commit or both roll back.
// Callers supply only explicit hashes, IDs, states and counts; never raw source,
// provider errors, tokens or headers. No update/delete API is exposed for events.
export async function auditRepairMutation(query:Query,actor:Actor,id:string,event:RepairAuditEvent,mutation:string,params:unknown[],details:Record<string,string|number|boolean>={}){
 const n=params.length;
 return query(`WITH changed AS (${mutation}) INSERT INTO sc_repair_events(id,repair_id,actor_id,workspace_id,event_type,details) SELECT $${n+1},id,$${n+2},$${n+3},$${n+4},$${n+5}::jsonb FROM changed WHERE id=$${n+6}::uuid RETURNING repair_id AS id`,[...params,randomUUID(),actor.id,actor.workspaceId,event,JSON.stringify(details),id]);
}
export async function repairAuditEvents(query:Query,actor:Actor,id:string){
 return query("SELECT e.id,e.event_type,e.actor_id,e.created_at,e.details FROM sc_repair_events e JOIN sc_repairs r ON r.id=e.repair_id WHERE r.id=$1 AND r.owner_id=$2 AND r.workspace_id=$3 AND e.workspace_id=$3 ORDER BY e.sequence ASC",[id,actor.id,actor.workspaceId]);
}
