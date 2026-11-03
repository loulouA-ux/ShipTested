import { brandEnv } from "../brand-env";
import { createSign,createHash } from "node:crypto";
import { z } from "zod";
import { boundedJson } from "../providers";
import { ApiError } from "./http";
import type { Actor } from "./store";
import { validateSnapshot } from "../repair/sandbox";
const repoSchema=z.object({id:z.number().int().positive(),name:z.string(),full_name:z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),default_branch:z.string().min(1),private:z.boolean()});
export type GitHubRepository=z.infer<typeof repoSchema>;
// Server-admin grants bind installation IDs to app actors. Never accept a client-supplied installation ID.
export function installationFor(actor:Actor){
 const grants=z.record(z.string(),z.number().int().positive()).parse(JSON.parse(brandEnv("GITHUB_INSTALLATIONS")||"{}"));
 if(!Object.hasOwn(grants,actor.id))throw new ApiError(403,"No repository installation is connected to this account.");
 return grants[actor.id];
}
function appJwt(){
 const id=process.env.GITHUB_APP_ID,key=process.env.GITHUB_APP_PRIVATE_KEY;
 if(!id||!key)throw new ApiError(503,"GitHub repository integration is not configured.");
 const now=Math.floor(Date.now()/1000);
 const value=[{alg:"RS256",typ:"JWT"},{iat:now-60,exp:now+540,iss:id}].map(v=>Buffer.from(JSON.stringify(v)).toString("base64url")).join(".");
 return value+"."+createSign("RSA-SHA256").update(value).sign(key,"base64url");
}
export class GitHubRequestError extends Error {constructor(public status:number){super('GitHub request failed.');}}
export async function githubRequest(path:string,token:string,init:RequestInit={},fetcher:typeof fetch=fetch,apiVersion='2022-11-28'){
 if(!path.startsWith("/")||path.startsWith("//")||path.includes("\\"))throw Error("Invalid GitHub API path.");
 let status:number|undefined;
 try{return await boundedJson("https://api.github.com"+path,{...init,headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":apiVersion,"User-Agent":"ShipTested","Content-Type":"application/json",Authorization:`Bearer ${token}`}},async(input,options)=>{const response=await fetcher(input,options);status=response.status;return response;});}
 catch(error){if(status!==undefined&&(status<200||status>=300))throw new GitHubRequestError(status);throw error;}
}
export async function installationToken(actor:Actor,repositoryId?:number,write=false,fetcher:typeof fetch=fetch,readPullRequests=false,selectedInstallationId?:number){
 if(write&&!repositoryId)throw Error("Write access must be scoped to one repository.");
 let installationId:number,repositoryIds:number[]|undefined;
 if(brandEnv('CUSTOMER_REPOSITORIES')==='1'){
  const {authorizedRepositoryGrant}=await import('./repository-connections');const {database}=await import('./db');
  const grant=await authorizedRepositoryGrant(database(),actor,fetcher,repositoryId,selectedInstallationId);installationId=grant.installationId;
  if(repositoryId&&!grant.repositoryIds.includes(repositoryId))throw new ApiError(404,'Repository is not authorized for your account.');
  if(write&&repositoryId&&!grant.writableRepositoryIds.includes(repositoryId))throw new ApiError(403,'Your GitHub account cannot write to this repository.');
  repositoryIds=repositoryId?[repositoryId]:grant.repositoryIds;
  if(!repositoryIds.length)throw new ApiError(403,'No repositories are authorized for this account.');
 }else{installationId=installationFor(actor);repositoryIds=repositoryId?[repositoryId]:undefined;}
 const result=z.object({token:z.string().min(1)}).parse(await githubRequest(`/app/installations/${installationId}/access_tokens`,appJwt(),{method:"POST",body:JSON.stringify({...(repositoryIds?{repository_ids:repositoryIds}:{}),permissions:write?{contents:"write",pull_requests:"write"}:{contents:"read",...(readPullRequests?{pull_requests:"read"}:{})}})},fetcher));
 return result.token;
}
export const MAX_CONNECTED_REPOSITORIES=500;
export async function listRepositories(actor:Actor,fetcher:typeof fetch=fetch){
 if(brandEnv('CUSTOMER_REPOSITORIES')==='1'){
  const {authorizedRepositoryGrants}=await import('./repository-connections');const {database}=await import('./db');
  const grants=await authorizedRepositoryGrants(database(),actor,fetcher);const all:GitHubRepository[]=[];
  for(const grant of grants){const token=await installationToken(actor,undefined,false,fetcher,false,grant.installationId);all.push(...await listTokenRepositories(token,fetcher));}
  if(all.length>MAX_CONNECTED_REPOSITORIES||new Set(all.map(r=>r.id)).size!==all.length)throw new ApiError(409,'Repository access changed or exceeds the workspace limit.');return all;
 }
 return listTokenRepositories(await installationToken(actor,undefined,false,fetcher),fetcher);
}
async function listTokenRepositories(token:string,fetcher:typeof fetch){
 const schema=z.object({total_count:z.number().int().min(0),repositories:z.array(repoSchema).max(100)});
 const repositories:GitHubRepository[]=[],seen=new Set<number>();
 let expected:number|undefined;
 for(let page=1;page<=Math.ceil(MAX_CONNECTED_REPOSITORIES/100);page++){
  const result=schema.parse(await githubRequest(`/installation/repositories?per_page=100&page=${page}`,token,{},fetcher));
  if(result.total_count>MAX_CONNECTED_REPOSITORIES)throw new ApiError(422,`Select at most ${MAX_CONNECTED_REPOSITORIES} repositories in the GitHub App installation.`);
  if(expected!==undefined&&result.total_count!==expected)throw new ApiError(409,'Repository access changed during listing. Try again.');
  expected=result.total_count;
  for(const repo of result.repositories){
   if(seen.has(repo.id))throw new ApiError(409,'Repository access changed during listing. Try again.');
   seen.add(repo.id);repositories.push(repo);
  }
  if(repositories.length===expected)return repositories;
  if(repositories.length>expected||result.repositories.length<100)throw new ApiError(409,'Repository access changed during listing. Try again.');
 }
 throw new ApiError(422,'Repository listing exceeds the supported limit.');
}
export type RepositorySnapshot={repository:GitHubRepository;commit:string;tree:string;files:Record<string,string>};
export async function repositorySnapshot(actor:Actor,repositoryId:number,fetcher:typeof fetch=fetch):Promise<RepositorySnapshot>{
 const repositories=await listRepositories(actor,fetcher);
 const repo=repositories.find(r=>r.id===repositoryId);if(!repo)throw new ApiError(404,"Repository is not authorised.");
 const token=await installationToken(actor,repo.id,false,fetcher);
 const path=`/repos/${repo.full_name}`;
 const commit=z.object({sha:z.string().regex(/^[a-f0-9]{40}$/),commit:z.object({tree:z.object({sha:z.string().regex(/^[a-f0-9]{40}$/)})})}).parse(await githubRequest(`${path}/commits/${encodeURIComponent(repo.default_branch)}`,token,{},fetcher));
 const tree=z.object({truncated:z.boolean(),tree:z.array(z.object({path:z.string(),mode:z.string(),type:z.string(),sha:z.string().regex(/^[a-f0-9]{40}$/),size:z.number().optional()}))}).parse(await githubRequest(`${path}/git/trees/${commit.commit.tree.sha}?recursive=1`,token,{},fetcher));
 if(tree.truncated||tree.tree.length>600)throw new ApiError(422,"Repository exceeds bounded snapshot limits.");
 const blobs=tree.tree.filter(e=>e.type!=="tree");
 if(blobs.length>300||blobs.some(e=>e.type!=="blob"||!["100644","100755"].includes(e.mode)))throw new ApiError(422,"Snapshot requires at most 300 regular files; symlinks and submodules are unsupported.");
 if(blobs.reduce((n,e)=>n+(e.size??2_000_001),0)>2_000_000)throw new ApiError(422,"Repository exceeds 2 MB snapshot limit.");
 const files:Record<string,string>={};
 // Validate names before fetching contents; do not forward configuration/secrets to compute.
 validateSnapshot(Object.fromEntries(blobs.map(e=>[e.path,""])));
 for(const entry of blobs){
  const blob=z.object({encoding:z.literal("base64"),content:z.string()}).parse(await githubRequest(`${path}/git/blobs/${entry.sha}`,token,{},fetcher));
  const bytes=Buffer.from(blob.content,"base64");
  if(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")!==entry.sha)throw Error("Repository blob integrity mismatch.");
  const value=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
  if(value.includes("\0"))throw new ApiError(422,"Binary files are unsupported in the initial repair snapshot.");
  files[entry.path]=value;
 }
 validateSnapshot(files);
 return {repository:repo,commit:commit.sha,tree:commit.commit.tree.sha,files};
}
