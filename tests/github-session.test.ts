import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import type { Query } from "../src/lib/server/db";
import { beginGitHubOAuth } from "../src/lib/server/github-oauth";
import { saveOAuthTransaction, consumeOAuthTransaction, createGitHubSession } from "../src/lib/server/github-session";
import { requireActor, revokeSession } from "../src/lib/server/session";
const db = new PGlite();
const query: Query = async (s,p=[]) => (await db.query(s,p)).rows as Record<string,unknown>[];
beforeAll(async()=>{for(const path of ['001_core','002_hosted_jobs','003_workspaces','004_team_sharing','009_batch_retry'])await db.exec(readFileSync(`migrations/${path}.sql`,'utf8'));});
afterAll(()=>db.close()); afterEach(()=>vi.unstubAllEnvs());
const config={clientId:"test",clientSecret:"test",origin:"https://example.com"};
describe("GitHub database sessions",()=>{
 it("atomically consumes the transaction once, without letting another browser consume it",async()=>{
  const f=beginGitHubOAuth(config);await saveOAuthTransaction(query,f.transaction);
  await expect(consumeOAuthTransaction(query,f.transaction.state,"a".repeat(64))).rejects.toThrow();
  const outcomes=await Promise.allSettled([consumeOAuthTransaction(query,f.transaction.state,f.browserToken),consumeOAuthTransaction(query,f.transaction.state,f.browserToken)]);
  expect(outcomes.filter(o=>o.status==="fulfilled")).toHaveLength(1);
  expect(outcomes.filter(o=>o.status==="rejected")).toHaveLength(1);
 });
 it("rejects expired flows",async()=>{
  const f=beginGitHubOAuth(config,Date.now()-700000);await saveOAuthTransaction(query,f.transaction);
  await expect(consumeOAuthTransaction(query,f.transaction.state,f.browserToken)).rejects.toThrow();
 });
 it("denies noninvited users before creating a paid member session",async()=>{
  vi.stubEnv("SHIPCHECK_GITHUB_MEMBER_IDS","123");
  await expect(createGitHubSession(query,{githubId:"999",login:"stranger"})).rejects.toMatchObject({status:403});
 });
 it("uses numeric identity and isolated workspace and respects revocation",async()=>{
  vi.stubEnv("SHIPCHECK_GITHUB_MEMBER_IDS","123,456");
  const a=await createGitHubSession(query,{githubId:"123",login:"peter"});
  const b=await createGitHubSession(query,{githubId:"456",login:"another"});
  expect(a.actor.id).toBe("github:123");expect(a.actor.workspaceId).not.toBe(b.actor.workspaceId);
  const req=new Request("https://example.com",{headers:{cookie:`shipcheck_session=${a.token}`}});
  expect(await requireActor(req,query)).toEqual(a.actor);
  vi.stubEnv("SHIPCHECK_GITHUB_MEMBER_IDS","456");
  await expect(requireActor(req,query)).rejects.toMatchObject({status:401});
  vi.stubEnv("SHIPCHECK_GITHUB_MEMBER_IDS","123,456");
  await revokeSession(req,query);await expect(requireActor(req,query)).rejects.toMatchObject({status:401});
 });
 it('provisions open registration only when enabled and never resets allowance at sign-in',async()=>{
  vi.stubEnv('SHIPTESTED_OPEN_REGISTRATION','1');
  const session=await createGitHubSession(query,{githubId:'789',login:'new-customer'});
  expect((await query('SELECT role FROM sc_workspace_members WHERE workspace_id=$1',[session.actor.workspaceId]))[0].role).toBe('owner');
  await query('UPDATE sc_scan_allowances SET reserved=2 WHERE workspace_id=$1',[session.actor.workspaceId]);
  await createGitHubSession(query,{githubId:'789',login:'renamed-customer'});
  expect((await query('SELECT scan_limit,reserved FROM sc_scan_allowances WHERE workspace_id=$1',[session.actor.workspaceId]))[0]).toEqual({scan_limit:5,reserved:2});
  await query("UPDATE sc_github_accounts SET disabled=true WHERE github_id='789'");
  await expect(requireActor(new Request('https://example.com',{headers:{cookie:`shipcheck_session=${session.token}`}}),query)).rejects.toMatchObject({status:401});
 });
});
