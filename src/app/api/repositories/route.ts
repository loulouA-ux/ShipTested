import {refusePublicDemo} from '@/lib/server/public-demo';
import { database } from "@/lib/server/db";
import { requireApiActor } from "@/lib/server/api-tokens";
import { listRepositories } from "@/lib/server/github-repositories";
import { json,failure } from "@/lib/server/http";
import { Store } from "@/lib/server/store";
export const runtime="nodejs";
export async function GET(request:Request){
  const denied=refusePublicDemo();if(denied)return denied;
try{const query=database(),actor=await requireApiActor(request,query);await new Store(query).quota(`repositories:${actor.id}`,20,60000);return json({repositories:await listRepositories(actor)});}catch(e){return failure(e);}}
