import {auditRepairMutation} from "./repair-audit";
import {randomUUID} from "node:crypto";
import type {Query} from "./db";
import {Store,type Actor} from "./store";
import {ApiError} from "./http";
import {repositorySnapshot} from "./github-repositories";
import {parseManifest} from "../parser";
import {queryOsv} from "../providers";
import {proposeDependencyRepair} from "../repair/plan";
import {maskSecrets} from "../scanner";
import {assertRepairSource,assertRepairManifest} from './repair-source';
import type {RepositoryReport} from './repository-scan';
export async function proposeRepositoryRepair(query:Query,actor:Actor,repositoryId:number,packageName:string,sourceReportId?:string){
 const sourceReport=sourceReportId?await new Store(query).getScan(actor,sourceReportId) as RepositoryReport:undefined;
 await new Store(query).quota(`repair-propose:${actor.id}`,5,86400000);
 const snapshot=await repositorySnapshot(actor,repositoryId);
 for(const value of Object.values(snapshot.files))if(maskSecrets(value)!==value)throw new ApiError(422,"Possible credential detected in source; remove it before sandbox testing.");
 const manifest=snapshot.files["package.json"],lock=snapshot.files["package-lock.json"];
 if(!manifest||!lock)throw new ApiError(422,"Root package.json and package-lock.json are required.");
 const parsed=parseManifest("package-lock.json",lock);
 if(parsed.warnings.length)throw new ApiError(422,"Lockfile contains unresolved dependencies.");
 const dependency=parsed.dependencies.find(d=>d.name===packageName&&d.path===`node_modules/${packageName}`);
 if(!dependency)throw new ApiError(422,"Selected direct dependency is not resolved in the lockfile.");
 assertRepairManifest(manifest,packageName,dependency.version);
 if(sourceReport)assertRepairSource(sourceReport,snapshot,packageName,dependency.version);
 const findings=await queryOsv([dependency]);
 const ids=findings.flatMap(f=>f.evidence.filter(e=>e.kind==="advisory"&&e.url?.startsWith("https://osv.dev/vulnerability/")).map(e=>e.url!.split("/").at(-1)!));
 const plan=await proposeDependencyRepair({baseCommit:snapshot.commit,manifest,packageName,currentVersion:dependency.version,advisoryIds:ids});
 const id=randomUUID();
 await auditRepairMutation(query,actor,id,"proposal_created","INSERT INTO sc_repairs(id,owner_id,workspace_id,state,snapshot,plan) VALUES($1,$2,$3,'proposed',$4::jsonb,$5::jsonb) RETURNING id",[id,actor.id,actor.workspaceId,JSON.stringify({...snapshot,...(sourceReportId?{sourceReportId}:{})}),JSON.stringify(plan)],{planHash:plan.planHash,baseCommit:plan.baseCommit,repositoryId,...(sourceReportId?{sourceReportId}:{})});
 return {id,state:"proposed",repository:snapshot.repository,plan};
}
export async function getRepair(query:Query,actor:Actor,id:string){
 const [row]=await query("SELECT id,state,snapshot,plan,result,pr_url,publication_commit,created_at,updated_at FROM sc_repairs WHERE id=$1 AND owner_id=$2 AND workspace_id=$3",[id,actor.id,actor.workspaceId]);
 if(!row)throw new ApiError(404,"Repair not found.");return row;
}

export async function listRepairs(query:Query,actor:Actor){
 return query("SELECT id,state,plan->>'packageName' AS package_name,snapshot->'repository'->>'full_name' AS repository_name,created_at FROM sc_repairs WHERE owner_id=$1 AND workspace_id=$2 ORDER BY created_at DESC,id DESC LIMIT 25",[actor.id,actor.workspaceId]);
}
