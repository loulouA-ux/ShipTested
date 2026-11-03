import { z } from 'zod';
import { database } from '@/lib/server/db';
import { requireApiActor } from '@/lib/server/api-tokens';
import { assertOrigin,body,json,failure,ApiError } from '@/lib/server/http';
import { refusePublicDemo } from '@/lib/server/public-demo';
import { resolveRepository,repositoryName } from '@/lib/server/repository-manifests';
import { ScanJobs } from '@/lib/server/scan-jobs';
import { Store } from '@/lib/server/store';
export const runtime='nodejs';
export async function POST(request:Request) {
  const denied=refusePublicDemo();if(denied)return denied;
  try {
    assertOrigin(request);
    const query=database(),actor=await requireApiActor(request,query,true);
    const parsed=z.object({repository:z.string().min(1).max(250),privateAccess:z.boolean().default(false),requestKey:z.string().uuid()}).strict().safeParse(await body(request,2000));
    if(!parsed.success)throw new ApiError(400,'Provide a GitHub repository and unique request key.');
    const jobs=new ScanJobs(query);
    const previous=await jobs.submitted(actor,parsed.data.requestKey,repositoryName(parsed.data.repository),parsed.data.privateAccess);
    if(previous)return json({id:previous.id,state:previous.state,statusUrl:`/api/repository-scans/${previous.id}`,reportUrl:previous.report_id?`/reports/${previous.report_id}`:null},202);
    await new Store(query).quota('repository-discovery:'+actor.id,20,60000);
    const source=await resolveRepository(actor,parsed.data.repository,parsed.data.privateAccess);
    const job=await new ScanJobs(query).enqueue(actor,{repository:source.repository,commit:source.commit,tree:source.tree,private:source.private,privateAccess:parsed.data.privateAccess,requestKey:parsed.data.requestKey});
    return json({id:job.id,state:job.state,statusUrl:`/api/repository-scans/${job.id}`,reportUrl:job.report_id?`/reports/${job.report_id}`:null},202);
  } catch(error) {return failure(error);}
}
