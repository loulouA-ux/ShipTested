import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import type {Query} from "../src/lib/server/db";
import {listRepairs,getRepair} from "../src/lib/server/repairs";
const db=new PGlite();
const query:Query=async(sql,params=[]) => (await db.query(sql,params)).rows as Record<string,unknown>[];
const actor={id:"github:1",workspaceId:"github:1",role:"member" as const};
beforeAll(async()=>{await db.exec(readFileSync("migrations/001_core.sql","utf8"));
for(const f of ['002_hosted_jobs','003_workspaces','004_team_sharing','009_batch_retry'])await db.exec(readFileSync(`migrations/${f}.sql`,'utf8'));});
afterAll(()=>db.close());
describe("saved repair ownership",()=>{
 it("lists only the newest 25 owned workspace summaries without source contents",async()=>{
  for(let i=0;i<27;i++)await query("INSERT INTO sc_repairs(id,owner_id,workspace_id,state,snapshot,plan,created_at) VALUES($1,$2,$3,'proposed',$4::jsonb,$5::jsonb,$6)",[randomUUID(),actor.id,actor.workspaceId,JSON.stringify({repository:{full_name:"team/repo"},files:{"private.js":"private source"}}),JSON.stringify({packageName:`package-${i}`,manifestBefore:"private manifest"}),new Date(1700000000000+i*1000).toISOString()]);
  const hidden=randomUUID();
  await query("INSERT INTO sc_repairs(id,owner_id,workspace_id,state,snapshot,plan) VALUES($1,'github:2','github:2','proposed','{}','{}')",[hidden]);
  const rows=await listRepairs(query,actor);
  expect(rows).toHaveLength(25);expect(rows[0].package_name).toBe("package-26");expect(rows[24].package_name).toBe("package-2");
  expect(Object.keys(rows[0]).sort()).toEqual(["id","state","package_name","repository_name","created_at"].sort());
  expect(await listRepairs(query,{...actor,workspaceId:"wrong"})).toEqual([]);
  await expect(getRepair(query,actor,hidden)).rejects.toMatchObject({status:404});
  await expect(getRepair(query,{...actor,workspaceId:"wrong"},String(rows[0].id))).rejects.toMatchObject({status:404});
  const own=await getRepair(query,actor,String(rows[0].id));expect(own.plan).toMatchObject({packageName:"package-26"});
 });
});
