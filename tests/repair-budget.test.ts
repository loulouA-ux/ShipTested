import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {readFileSync} from "node:fs";
import type {Query} from "../src/lib/server/db";
import {reserveRepairRun} from "../src/lib/server/repair-execution";
const db=new PGlite();
const query:Query=async(sql,params=[]) => (await db.query(sql,params)).rows as Record<string,unknown>[];
beforeAll(async()=>{await db.exec(readFileSync("migrations/001_core.sql","utf8"));
for(const f of ['002_hosted_jobs','003_workspaces','004_team_sharing','009_batch_retry'])await db.exec(readFileSync(`migrations/${f}.sql`,'utf8'));});
afterAll(()=>db.close());
describe("persistent total repair allowance",()=>{
 it("admits only one concurrent reservation and does not reset with daily windows",async()=>{
  const results=await Promise.allSettled(Array.from({length:8},()=>reserveRepairRun(query,1)));
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(results.filter(r=>r.status==="rejected")).toHaveLength(7);
  await query("DELETE FROM sc_quotas WHERE bucket='repair-runs-global'");
  await expect(reserveRepairRun(query,1)).rejects.toMatchObject({status:429});
  expect(await query("SELECT used FROM sc_quotas WHERE bucket='repair-runs-total'")).toEqual([{used:1}]);
 });
});
