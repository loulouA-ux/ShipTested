import type {Query} from './db';
/** Trusted operator only. Current UTC month, no billing/seat/permission changes. */
export async function setTestCapacity(q:Query,workspace:string,owner:string,limit:number){
 if(!workspace||!/^github:[1-9][0-9]*$/.test(owner)||!Number.isInteger(limit)||limit<301||limit>500)throw Error('Invalid test capacity target.');
 const rows=await q(`WITH target AS (
 SELECT w.id FROM sc_workspaces w JOIN sc_workspace_members m ON m.workspace_id=w.id
 WHERE w.id=$1 AND w.owner_id=$2 AND m.actor_id=$2 AND m.role='owner' AND w.plan='free'
 ), changed AS (
 INSERT INTO sc_scan_allowances(workspace_id,period_start,scan_limit)
 SELECT id,date_trunc('month',now() AT TIME ZONE 'UTC')::date,$3 FROM target
 ON CONFLICT(workspace_id,period_start) DO UPDATE SET scan_limit=GREATEST(sc_scan_allowances.scan_limit,excluded.scan_limit)
 RETURNING workspace_id,period_start,scan_limit,reserved
 ), audit AS (
 INSERT INTO sc_workspace_events(workspace_id,actor_id,event_type,subject_id)
 SELECT workspace_id,$2,'test_capacity_set',period_start::text||':'||scan_limit::text FROM changed
 ) SELECT * FROM changed`,[workspace,owner,limit],{serializable:true});
 if(rows.length!==1)throw Error('Expected one existing free workspace owned by the specified GitHub account.');
 return rows[0];
}
