import {refusePublicDemo} from '@/lib/server/public-demo';
import {repairAuditEvents} from "@/lib/server/repair-audit";
import {database} from "@/lib/server/db";
import {requireActor} from "@/lib/server/session";
import {getRepair} from "@/lib/server/repairs";
import {executeRepair,publishRepair,approvalHash,reconcileRepair,canRecoverRepair,recoverInterruptedRepair} from "@/lib/server/repair-execution";
import {assertOrigin,body,json,failure,ApiError} from "@/lib/server/http";
import {validateScanId} from "@/lib/server/scan-id";
import type {RepairPlan} from "@/lib/repair/plan";
import type {RepairRun} from "@/lib/repair/runner";
import type {RepositorySnapshot} from "@/lib/server/github-repositories";
export const runtime="nodejs";export const maxDuration=800;
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){
  const denied=refusePublicDemo();if(denied)return denied;
try{
 const query=database(),actor=await requireActor(request,query),id=validateScanId((await context.params).id),row=await getRepair(query,actor,id);
 const plan=row.plan as RepairPlan,result=row.result as RepairRun|null;
 let hash:string|null=null;
 if(row.state==="verified"&&result)try{hash=approvalHash(plan,result);}catch{ /* Preserve older evidence for review without authorizing publication. */ }
 const auditTrail=await repairAuditEvents(query,actor,id);
 const reusedDraft=auditTrail.some(event=>(event.details as Record<string,unknown>)?.existingDraft===true);
 return json({id,state:row.state,plan,result,repository:(row.snapshot as RepositorySnapshot).repository,url:row.pr_url,approvalHash:hash,canRecover:canRecoverRepair(row),reusedDraft,auditTrail});
}catch(e){return failure(e);}}
export async function POST(request:Request,context:Context){
  const denied=refusePublicDemo();if(denied)return denied;
try{
 assertOrigin(request);const query=database(),actor=await requireActor(request,query),id=validateScanId((await context.params).id);
 const data=await body(request,2000) as {action?:unknown;approvalHash?:unknown};
 if(data?.action==="reconcile")return json(await reconcileRepair(query,actor,id));
 if(data?.action==="recover")return json(await recoverInterruptedRepair(query,actor,id));
 if(data?.action==="verify")return json(await executeRepair(query,actor,id));
 if(data?.action==="approve"&&typeof data.approvalHash==="string"&&/^[a-f0-9]{64}$/.test(data.approvalHash))return json(await publishRepair(query,actor,id,data.approvalHash));
 throw new ApiError(400,"Choose verification or approve the exact verified patch.");
}catch(e){return failure(e);}}
