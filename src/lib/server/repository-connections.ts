import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import type {Query} from './db';
import type {Actor} from './store';
import {ApiError} from './http';
import {TeamAccess} from './team-access';
import {brandEnv} from '../brand-env';
import {boundedJson} from '../providers';
import {githubRequest,MAX_CONNECTED_REPOSITORIES} from './github-repositories';
import {beginGitHubOAuth,validateGitHubTransaction} from './github-oauth';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const connectionCookie='shiptested_repository_flow';
export function repositoryConnectionOrigin(){return config().origin;}
export function repositoryInstallUrl(){config();const slug=process.env.GITHUB_APP_SLUG;if(!slug||! /^[a-z0-9-]{1,100}$/.test(slug))throw new ApiError(503,'Repository installation link is not configured.');return `https://github.com/apps/${slug}/installations/new`;}
function config(){
 if(brandEnv('CUSTOMER_REPOSITORIES')!=='1')throw new ApiError(503,'Customer repository connections are not enabled on this deployment.');
 const clientId=process.env.GITHUB_APP_CLIENT_ID,clientSecret=process.env.GITHUB_APP_CLIENT_SECRET,origin=brandEnv('APP_ORIGIN'),key=process.env.SHIPTESTED_CONNECTION_ENCRYPTION_KEY;
 if(!clientId||!clientSecret||!origin||!key||!/^[a-f0-9]{64}$/.test(key))throw new ApiError(503,'Repository connection is not configured.');
 const url=new URL(origin);if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(url.protocol==='http:'&&url.hostname==='127.0.0.1')))throw new ApiError(503,'Repository callback origin is invalid.');
 return {clientId,clientSecret,origin:url.origin,key:Buffer.from(key,'hex'),callback:url.origin+'/api/github/connect/callback'};
}
const aad=(actor:Actor)=>Buffer.from(JSON.stringify([actor.workspaceId,actor.id]));
function encrypt(token:string,actor:Actor){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',config().key,iv);cipher.setAAD(aad(actor));const content=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),content]).toString('base64');}
function decrypt(value:string,actor:Actor){try{const bytes=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',config().key,bytes.subarray(0,12));decipher.setAAD(aad(actor));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');}catch{throw new ApiError(401,'Reconnect your GitHub repository access.');}}
function githubActor(actor:Actor){if(!/^github:[1-9][0-9]*$/.test(actor.id))throw new ApiError(403,'Sign in with GitHub before connecting repositories.');}
export async function beginRepositoryConnection(q:Query,actor:Actor){
 githubActor(actor);await new TeamAccess(q).role(actor);const c=config(),flow=beginGitHubOAuth(c);
 const url=new URL(flow.authorizationUrl);url.searchParams.set('redirect_uri',c.callback);url.searchParams.delete('scope'); // GitHub App permissions come from installation, not OAuth scopes.
 await q('DELETE FROM sc_repository_connect_flows WHERE expires_at<=now()');
 await q('INSERT INTO sc_repository_connect_flows(state_hash,workspace_id,actor_id,verifier,browser_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[digest(flow.transaction.state),actor.workspaceId,actor.id,flow.transaction.verifier,flow.transaction.browserHash,new Date(flow.transaction.expiresAt).toISOString()]);
 return {url:url.toString(),browserToken:flow.browserToken,origin:c.origin};
}
export async function completeRepositoryConnection(q:Query,actor:Actor,state:string,browserToken:string,code:string,fetcher:typeof fetch=fetch){
 githubActor(actor);await new TeamAccess(q).role(actor);const c=config();
 if(!/^[a-f0-9]{64}$/.test(state)||!/^[a-f0-9]{64}$/.test(browserToken)||!code||code.length>512)throw new ApiError(400,'Repository connection expired. Start again.');
 const [row]=await q('DELETE FROM sc_repository_connect_flows WHERE state_hash=$1 AND workspace_id=$2 AND actor_id=$3 AND browser_hash=$4 AND expires_at>now() RETURNING verifier,browser_hash,expires_at',[digest(state),actor.workspaceId,actor.id,digest(browserToken)]);
 const verifier=validateGitHubTransaction(row?{state,verifier:String(row.verifier),browserHash:String(row.browser_hash),expiresAt:new Date(String(row.expires_at)).getTime()}:null,state,browserToken);
 const result=z.object({access_token:z.string().min(1).max(2048),token_type:z.string().refine(v=>v.toLowerCase()==='bearer'),expires_in:z.number().int().positive().optional()}).parse(await boundedJson('https://github.com/login/oauth/access_token',{method:'POST',redirect:'error',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,code,code_verifier:verifier,redirect_uri:c.callback})},fetcher));
 const identity=z.object({id:z.number().int().positive().safe()}).parse(await githubRequest('/user',result.access_token,{},fetcher));
 if(actor.id!==`github:${identity.id}`)throw new ApiError(403,'Authorize the same GitHub account you used to sign in.');
 const expiresAt=new Date(Date.now()+Math.min(result.expires_in??3600,3600)*1000).toISOString();
 const saved=await q(`WITH ranked AS (
 SELECT m.actor_id,m.role,w.plan,w.seat_limit,
 row_number() OVER(ORDER BY CASE WHEN m.role='owner' THEN 0 ELSE 1 END,m.created_at,m.actor_id) AS seat
 FROM sc_workspace_members m JOIN sc_workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1
 ), connection AS (INSERT INTO sc_repository_connections(workspace_id,actor_id,encrypted_token,expires_at)
 SELECT $1,$2,$3,$4 FROM ranked WHERE actor_id=$2 AND seat<=seat_limit AND (plan='team' OR role='owner')
 ON CONFLICT(workspace_id,actor_id) DO UPDATE SET encrypted_token=excluded.encrypted_token,expires_at=excluded.expires_at RETURNING actor_id)
 INSERT INTO sc_workspace_events(workspace_id,actor_id,event_type,subject_id) SELECT $1,$2,'repository_access_authorized',actor_id FROM connection RETURNING sequence`,[actor.workspaceId,actor.id,encrypt(result.access_token,actor),expiresAt],{serializable:true});
 if(!saved.length)throw new ApiError(403,'Workspace membership is required.');
}
async function connection(q:Query,actor:Actor){
 githubActor(actor);await new TeamAccess(q).role(actor);
 const [row]=await q('SELECT encrypted_token,expires_at,installation_id FROM sc_repository_connections WHERE workspace_id=$1 AND actor_id=$2 AND expires_at>now()',[actor.workspaceId,actor.id]);
 if(!row)throw new ApiError(403,'Connect or renew GitHub repository access in Workspace settings.');
 return {token:decrypt(String(row.encrypted_token),actor),expiresAt:row.expires_at,installationId:row.installation_id===null?null:Number(row.installation_id)};
}
/** Merge as the connected human, never with an installation token or admin grant. */
export async function repositoryMergeToken(q:Query,actor:Actor,repositoryId:number,fetcher:typeof fetch=fetch){
 const grant=await authorizedRepositoryGrant(q,actor,fetcher,repositoryId);
 if(!grant.writableRepositoryIds.includes(repositoryId))throw new ApiError(403,'Your GitHub account cannot merge changes in this repository.');
 const c=await connection(q,actor);
 const identity=z.object({id:z.number().int().positive().safe()}).parse(await githubRequest('/user',c.token,{},fetcher));
 if(actor.id!==`github:${identity.id}`)throw new ApiError(403,'Reconnect the same GitHub account before merging.');
 return c.token;
}
const installation=z.object({id:z.number().int().positive().safe(),app_id:z.number().int().positive().safe(),account:z.object({login:z.string().max(100)}),suspended_at:z.string().nullable()});
async function userInstallations(token:string,fetcher:typeof fetch){
 const result=z.object({total_count:z.number().int().nonnegative(),installations:z.array(installation)}).parse(await githubRequest('/user/installations?per_page=100',token,{},fetcher));
 if(result.total_count>100||result.installations.length!==result.total_count)throw new ApiError(422,'Installation listing exceeds the supported limit.');
 return result.installations.filter(i=>String(i.app_id)===process.env.GITHUB_APP_ID&&!i.suspended_at);
}
export async function connectionStatus(q:Query,actor:Actor,fetcher:typeof fetch=fetch){
 const c=await connection(q,actor),installations=await userInstallations(c.token,fetcher);
 const saved=await q('SELECT installation_id FROM sc_repository_installations WHERE workspace_id=$1 AND actor_id=$2',[actor.workspaceId,actor.id]);
 const selectedIds=saved.map(r=>Number(r.installation_id)).filter(id=>installations.some(i=>i.id===id));
 return {expiresAt:c.expiresAt,selected:selectedIds[0]??null,selectedIds,installations:installations.map(i=>({id:i.id,account:i.account.login}))};
}
export async function selectInstallation(q:Query,actor:Actor,id:number,fetcher:typeof fetch=fetch){
 if(!Number.isSafeInteger(id)||id<1)throw new ApiError(400,'Invalid installation.');
 const c=await connection(q,actor);if(!(await userInstallations(c.token,fetcher)).some(i=>i.id===id))throw new ApiError(403,'This installation is not authorized for your account.');
 const saved=await q(`WITH selected AS (INSERT INTO sc_repository_installations(workspace_id,actor_id,installation_id) SELECT workspace_id,actor_id,$3 FROM sc_repository_connections WHERE workspace_id=$1 AND actor_id=$2 AND expires_at>now() AND (SELECT count(*) FROM sc_repository_installations WHERE workspace_id=$1 AND actor_id=$2)<20 ON CONFLICT DO NOTHING RETURNING actor_id)
 INSERT INTO sc_workspace_events(workspace_id,actor_id,event_type,subject_id) SELECT $1,$2,'repository_installation_selected',$3::text FROM selected RETURNING sequence`,[actor.workspaceId,actor.id,id],{serializable:true});
 if(!saved.length){const existing=await q('SELECT installation_id FROM sc_repository_installations WHERE workspace_id=$1 AND actor_id=$2 AND installation_id=$3',[actor.workspaceId,actor.id,id]);if(!existing.length)throw new ApiError(409,'Connect at most 20 GitHub namespaces per workspace, or renew expired access.');}
}
export async function disconnectRepositories(q:Query,actor:Actor){
 await new TeamAccess(q).role(actor);
 await q(`WITH removed AS (DELETE FROM sc_repository_connections WHERE workspace_id=$1 AND actor_id=$2 RETURNING actor_id)
 INSERT INTO sc_workspace_events(workspace_id,actor_id,event_type,subject_id) SELECT $1,$2,'repository_access_disconnected',actor_id FROM removed`,[actor.workspaceId,actor.id]);
}
/** Recheck GitHub user access for every minted installation token, including org repos. */
async function grantFor(q:Query,actor:Actor,installationId:number,fetcher:typeof fetch=fetch){
 const c=await connection(q,actor);
 if(!(await userInstallations(c.token,fetcher)).some(i=>i.id===installationId))throw new ApiError(403,'Select an authorized GitHub installation.');
 const ids:number[]=[],writable:number[]=[];let expected:number|undefined;
 for(let page=1;page<=Math.ceil(MAX_CONNECTED_REPOSITORIES/100);page++){
  const result=z.object({total_count:z.number().int().min(0).max(MAX_CONNECTED_REPOSITORIES),repositories:z.array(z.object({id:z.number().int().positive().safe(),permissions:z.object({push:z.boolean().optional(),admin:z.boolean().optional()}).optional()})).max(100)}).parse(await githubRequest(`/user/installations/${installationId}/repositories?per_page=100&page=${page}`,c.token,{},fetcher));
  if(expected!==undefined&&expected!==result.total_count)throw new ApiError(409,'Repository access changed. Try again.');expected=result.total_count;
  for(const repo of result.repositories){if(ids.includes(repo.id))throw new ApiError(409,'Repository access changed. Try again.');ids.push(repo.id);if(repo.permissions?.push||repo.permissions?.admin)writable.push(repo.id);}
  if(ids.length===expected)return {installationId,repositoryIds:ids,writableRepositoryIds:writable};
  if(result.repositories.length<100)break;
 }
 throw new ApiError(409,'Repository access listing is incomplete.');
}

export async function authorizedRepositoryGrants(q:Query,actor:Actor,fetcher:typeof fetch=fetch){
 await connection(q,actor);
 const selected=await q('SELECT installation_id FROM sc_repository_installations WHERE workspace_id=$1 AND actor_id=$2 ORDER BY installation_id',[actor.workspaceId,actor.id]);
 if(!selected.length)throw new ApiError(403,'Choose at least one GitHub namespace in Workspace settings.');
 if(selected.length>20)throw new ApiError(422,'Connect at most 20 GitHub namespaces per workspace.');
 const grants=[];for(const row of selected)grants.push(await grantFor(q,actor,Number(row.installation_id),fetcher));
 if(grants.reduce((n,g)=>n+g.repositoryIds.length,0)>MAX_CONNECTED_REPOSITORIES)throw new ApiError(422,`Select at most ${MAX_CONNECTED_REPOSITORIES} repositories across your connected namespaces.`);
 return grants;
}
export async function authorizedRepositoryGrant(q:Query,actor:Actor,fetcher:typeof fetch=fetch,repositoryId?:number,installationId?:number){
 const grants=await authorizedRepositoryGrants(q,actor,fetcher);
 const matches=grants.filter(g=>installationId?g.installationId===installationId:repositoryId?g.repositoryIds.includes(repositoryId):true);
 if(matches.length!==1)throw new ApiError(repositoryId?404:403,'Choose a repository from an authorized GitHub namespace.');return matches[0];
}
export async function removeInstallation(q:Query,actor:Actor,id:number){
 await new TeamAccess(q).role(actor);
 await q(`WITH removed AS (DELETE FROM sc_repository_installations WHERE workspace_id=$1 AND actor_id=$2 AND installation_id=$3 RETURNING installation_id),
 legacy AS (UPDATE sc_repository_connections SET installation_id=NULL WHERE workspace_id=$1 AND actor_id=$2 AND installation_id=$3)
 INSERT INTO sc_workspace_events(workspace_id,actor_id,event_type,subject_id) SELECT $1,$2,'repository_namespace_removed',installation_id::text FROM removed`,[actor.workspaceId,actor.id,id]);
}
