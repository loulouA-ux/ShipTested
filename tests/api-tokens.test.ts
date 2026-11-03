import {beforeAll,beforeEach,afterAll,afterEach,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import type {Query} from '../src/lib/server/db';
import {createGitHubSession} from '../src/lib/server/github-session';
import {createApiToken,listApiTokens,revokeApiToken,requireApiActor} from '../src/lib/server/api-tokens';
const db=new PGlite();
const query:Query=async(sql,params=[])=>(await db.query(sql,params)).rows as Record<string,unknown>[];
const owner={id:'github:1',workspaceId:'github:1',role:'member' as const};
const request=(token:string)=>new Request('https://example.com/api/usage',{headers:{Authorization:`Bearer ${token}`}});
beforeAll(async()=>{for(const file of ['001_core','002_hosted_jobs','003_workspaces','004_team_sharing','007_api_tokens','009_batch_retry'])await db.exec(readFileSync(`migrations/${file}.sql`,'utf8'));});
beforeEach(async()=>{await db.exec('TRUNCATE sc_workspaces CASCADE; DELETE FROM sc_sessions; DELETE FROM sc_github_accounts; DELETE FROM sc_scan_allowances;');vi.stubEnv('SHIPTESTED_OPEN_REGISTRATION','1');await createGitHubSession(query,{githubId:'1',login:'owner'});});
afterAll(()=>db.close());afterEach(()=>vi.unstubAllEnvs());
it('stores only hashes and enforces read-only scope',async()=>{
  const token=await createApiToken(query,owner,'Agent',false);
  expect(JSON.stringify(await query('SELECT * FROM sc_api_tokens'))).not.toContain(token.token);
  expect(JSON.stringify(await listApiTokens(query,owner))).not.toContain(token.token);
  expect(await requireApiActor(request(token.token),query)).toEqual(owner);
  await expect(requireApiActor(request(token.token),query,true)).rejects.toMatchObject({status:403});
  const scan=await createApiToken(query,owner,'Scanner',true);
  expect(await requireApiActor(request(scan.token),query,true)).toEqual(owner);
});
it('enforces expiry, revocation and actor isolation',async()=>{
  const token=await createApiToken(query,owner,'Agent',true);
  await expect(revokeApiToken(query,{...owner,id:'github:2'},token.id)).rejects.toMatchObject({status:404});
  await revokeApiToken(query,owner,token.id);
  await expect(requireApiActor(request(token.token),query)).rejects.toMatchObject({status:401});
  const expired=await createApiToken(query,owner,'Expired',true);
  await query("UPDATE sc_api_tokens SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);
  await expect(requireApiActor(request(expired.token),query)).rejects.toMatchObject({status:401});
});
it('revokes access when account disabled or workspace membership removed',async()=>{
  const token=await createApiToken(query,owner,'Agent',true);
  await query("UPDATE sc_github_accounts SET disabled=true WHERE github_id='1'");
  await expect(requireApiActor(request(token.token),query)).rejects.toMatchObject({status:401});
  await query("UPDATE sc_github_accounts SET disabled=false WHERE github_id='1'");
  await query('DELETE FROM sc_workspace_members WHERE workspace_id=$1',[owner.workspaceId]);
  await expect(requireApiActor(request(token.token),query)).rejects.toMatchObject({status:401});
});
it('cannot create a token after membership disappears between preflight and insert',async()=>{
 let checked=false;
 const interrupted:Query=async(sql,params,options)=>{
  const rows=await query(sql,params,options);
  if(!checked){checked=true;await query('DELETE FROM sc_workspace_members WHERE workspace_id=$1',[owner.workspaceId]);}
  return rows;
 };
 await expect(createApiToken(interrupted,owner,'Racing request',true)).rejects.toMatchObject({status:403});
 expect(await query('SELECT id FROM sc_api_tokens')).toEqual([]);
 expect(await query("SELECT sequence FROM sc_workspace_events WHERE event_type='api_token_created'")).toEqual([]);
});
