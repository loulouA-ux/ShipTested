import {z} from 'zod';
import {refusePublicDemo} from '@/lib/server/public-demo';
import {database} from '@/lib/server/db';
import {requireActor} from '@/lib/server/session';
import {assertOrigin,body,json,failure,ApiError} from '@/lib/server/http';
import {validateScanId} from '@/lib/server/scan-id';
import {repairMergeReadiness,repairMergeStatus,approveRepairMerge,reconcileRepairMerge} from '@/lib/server/repair-merge';
export const runtime='nodejs';
export const maxDuration=120;
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){
 const denied=refusePublicDemo();if(denied)return denied;
 try{const id=validateScanId((await context.params).id),q=database(),actor=await requireActor(request,q);return json(await (new URL(request.url).searchParams.get('status')==='1'?repairMergeStatus(q,actor,id):repairMergeReadiness(q,actor,id)));}catch(e){return failure(e);}
}
export async function POST(request:Request,context:Context){
 const denied=refusePublicDemo();if(denied)return denied;
 try{
  assertOrigin(request);const id=validateScanId((await context.params).id),q=database(),actor=await requireActor(request,q);
  const data=z.discriminatedUnion('action',[
   z.object({action:z.literal('approve'),approvalHash:z.string().regex(/^[a-f0-9]{64}$/),confirmMerge:z.literal(true)}).strict(),
   z.object({action:z.literal('reconcile')}).strict(),
  ]).safeParse(await body(request,1000));
  if(!data.success)throw new ApiError(400,'Explicitly approve the exact merge preview or check an existing merge request.');
  return json(data.data.action==='approve'?await approveRepairMerge(q,actor,id,data.data.approvalHash):await reconcileRepairMerge(q,actor,id));
 }catch(e){return failure(e);}
}
