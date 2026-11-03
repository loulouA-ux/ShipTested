import {refusePublicDemo} from '@/lib/server/public-demo';
import {z} from "zod";
import {database} from "@/lib/server/db";
import {requireActor} from "@/lib/server/session";
import {assertOrigin,body,json,failure,ApiError} from "@/lib/server/http";
import {proposeRepositoryRepair,listRepairs} from "@/lib/server/repairs";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:Request){
  const denied=refusePublicDemo();if(denied)return denied;
try{
 assertOrigin(request);const query=database(),actor=await requireActor(request,query);
 const input=z.object({repositoryId:z.number().int().positive(),packageName:z.string().min(1).max(150),sourceReportId:z.string().uuid().optional()}).strict().safeParse(await body(request,2000));
 if(!input.success)throw new ApiError(400,"Choose a repository and dependency.");
 return json(await proposeRepositoryRepair(query,actor,input.data.repositoryId,input.data.packageName,input.data.sourceReportId),201);
}catch(e){return failure(e);}}

export async function GET(request:Request){
  const denied=refusePublicDemo();if(denied)return denied;
try{
 const query=database(),actor=await requireActor(request,query);
 return json({repairs:await listRepairs(query,actor)});
}catch(e){return failure(e);}}
