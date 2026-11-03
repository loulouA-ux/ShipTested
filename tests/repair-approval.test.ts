import {describe,it,expect,vi,beforeEach} from "vitest";
import {approvalHash,publishRepair,repairRunLimits} from "../src/lib/server/repair-execution";
import {contentHash,type RepairPlan} from "../src/lib/repair/plan";
import type {RepairRun} from "../src/lib/repair/runner";
import type {Query} from "../src/lib/server/db";
const github=vi.hoisted(()=>({request:vi.fn(),token:vi.fn(),repos:vi.fn()}));
vi.mock("../src/lib/server/github-repositories",()=>({githubRequest:github.request,installationToken:github.token,listRepositories:github.repos}));
const actor={id:"github:123",workspaceId:"github:123",role:"member" as const};
const plan={planHash:"a".repeat(64),manifestAfter:'{"dependencies":{"lodash":"4.17.21"}}',baseCommit:"b".repeat(40),packageName:"lodash",fromVersion:"4.17.20",toVersion:"4.17.21",sourceUrls:["https://osv.dev/vulnerability/GHSA-test"]} as RepairPlan;
const scan={checkedAt:"2026-10-25T21:00:00Z",dependencyCount:1,lockfileHash:contentHash('{"lockfileVersion":3}'),findings:[]};
const result:RepairRun={artifactChecks:{baseline:true,patched:true},scans:{before:scan,after:scan},planHash:plan.planHash,status:"passed",cleanupComplete:true,baseline:[],patched:[],errors:[],lockfileAfter:'{"lockfileVersion":3}'};
const row={state:"verified",plan,result,snapshot:{repository:{id:1,full_name:"owner/demo",default_branch:"main"},tree:"c".repeat(40)}};
const query:Query=async(text)=>text.startsWith("SELECT")?[row]:[{id:"repair"}];
beforeEach(()=>{vi.clearAllMocks();github.repos.mockResolvedValue([{id:1}]);github.token.mockResolvedValue("test-token");github.request.mockImplementation(async(path:string)=>path.includes("/commits/main")?{sha:plan.baseCommit}:path.includes("/pulls?")?[]:path.endsWith("/pulls")?{html_url:"https://github.com/owner/demo/pull/1"}:{sha:"d".repeat(40)});});
describe("human approval boundary",()=>{
 it("binds approval to the complete lockfile and command evidence",()=>{const h=approvalHash(plan,result);expect(()=>approvalHash(plan,{...result,lockfileAfter:"changed"})).toThrow("scan evidence");expect(approvalHash(plan,{...result,baseline:[{command:"test",exitCode:0,output:"different"}]})).not.toBe(h);});
 it("preserves exact approval across nested database JSON key reordering",()=>{
  const reordered=JSON.parse(JSON.stringify(result,(_key,value)=>value&&typeof value==="object"&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value));
  expect(approvalHash(plan,reordered)).toBe(approvalHash(plan,result));
 });
 it("blocks previously verified deprecated targets from approval",()=>{
  const lockfileAfter=JSON.stringify({packages:{"node_modules/lodash":{version:"4.17.21",deprecated:"Bad release"}}});
  const withDeprecated={...result,lockfileAfter,scans:{before:scan,after:{...scan,lockfileHash:contentHash(lockfileAfter)}}};
  expect(()=>approvalHash(plan,withDeprecated)).toThrow("deprecated");
 });
 it("rejects failed or incomplete verification",()=>{expect(()=>approvalHash(plan,{...result,status:"failed"})).toThrow();expect(()=>approvalHash(plan,{...result,cleanupComplete:false})).toThrow();});
 it("rejects legacy and changed-file evidence before publication",()=>{
  expect(()=>approvalHash(plan,{...result,artifactChecks:undefined})).toThrow("integrity evidence");
  expect(()=>approvalHash(plan,{...result,artifactChecks:{baseline:true,patched:false}})).toThrow("integrity evidence");
 });
 it("never writes without the exact approval hash",async()=>{await expect(publishRepair(query,actor,"id","wrong")).rejects.toMatchObject({status:409});expect(github.request).not.toHaveBeenCalled();});
 it("does not publish when approval logging fails",async()=>{
  const failing:Query=async(sql)=>{if(sql.startsWith("SELECT"))return [row];throw Error("Audit storage unavailable");};
  await expect(publishRepair(failing,actor,"id",approvalHash(plan,result))).rejects.toThrow("Audit storage unavailable");
  expect(github.request.mock.calls.every(call=>!call[2]?.method||call[2].method==="GET")).toBe(true);
 });
 it("rejects a moved base before writing",async()=>{github.request.mockResolvedValue({sha:"f".repeat(40)});await expect(publishRepair(query,actor,"id",approvalHash(plan,result))).rejects.toMatchObject({status:409});expect(github.request).toHaveBeenCalledTimes(1);});
 it("writes only two files to a new branch and draft PR",async()=>{
  const r=await publishRepair(query,actor,"id",approvalHash(plan,result));expect(r.url).toContain("/pull/1");
  const calls=github.request.mock.calls;
  const tree=JSON.parse(calls.find(c=>c[0].endsWith("/git/trees"))![2].body);
  expect(tree.tree.map((e:{path:string})=>e.path)).toEqual(["package.json","package-lock.json"]);
  const pr=JSON.parse(calls.find(c=>c[0].endsWith("/pulls"))![2].body);expect(pr.draft).toBe(true);expect(pr.head).toBe("codex/shipcheck-repair-id");
  expect(calls.some(c=>c[0].includes("/merge"))).toBe(false);
 });
 it('refuses new publication when approval was limited to an existing draft',async()=>{
  await expect(publishRepair(query,actor,'id',approvalHash(plan,result),fetch,'https://github.com/owner/demo/pull/2')).rejects.toMatchObject({status:409});
  expect(github.request.mock.calls.every(c=>!c[2]?.method||c[2].method==='GET')).toBe(true);
  expect(github.token.mock.calls.every(c=>c[2]===false)).toBe(true);
 });
});

describe("bounded repair allowances",()=>{
 it("defaults to one total and one daily run",()=>{expect(repairRunLimits({})).toEqual({daily:1,total:1});});
 it.each(["0","-1","6","1000","NaN","Infinity","1.5","","1e0"])("rejects invalid allowance %s",value=>{
  expect(()=>repairRunLimits({SHIPCHECK_REPAIR_DAILY_RUNS:value})).toThrow("allowance");
  expect(()=>repairRunLimits({SHIPCHECK_REPAIR_TOTAL_RUNS:value})).toThrow("allowance");
 });
});

describe("uncertain PR outcome recovery",()=>{
 const commit="d".repeat(40);
 const pending={...row,state:"publishing",publication_commit:commit};
 const existing={html_url:"https://github.com/owner/demo/pull/2",draft:true,state:"open",merged_at:null,head:{sha:commit,ref:"codex/shipcheck-repair-id",repo:{id:1}},base:{ref:"main",repo:{id:1}}};
 function storage(){const writes:string[]=[];const q:Query=async(sql)=>{if(sql.startsWith("SELECT"))return [pending];writes.push(sql);return [{id:"id"}];};return {q,writes};}
 it("recovers the exact draft using only GitHub GET calls",async()=>{
  const {reconcileRepair}=await import("../src/lib/server/repair-execution");const db=storage();github.request.mockResolvedValue([existing]);
  expect(await reconcileRepair(db.q,actor,"id")).toMatchObject({state:"published",url:existing.html_url});
  expect(github.token).toHaveBeenCalledWith(actor,1,false,expect.any(Function),true);
  expect(github.request.mock.calls.every(c=>!c[2]?.method||c[2]?.method==="GET")).toBe(true);
  expect(db.writes).toHaveLength(1);
 });
 it.each([[],[existing,existing],[{...existing,head:{...existing.head,sha:"e".repeat(40)}}],[{...existing,draft:false}],[{...existing,base:{ref:"other",repo:{id:1}}}],[{...existing,merged_at:"2026-10-25T00:00:00Z"}]].map(candidate=>({candidate})))("leaves ambiguous or changed remote state untouched: %j",async ({candidate})=>{
  const {reconcileRepair}=await import("../src/lib/server/repair-execution");const db=storage();github.request.mockResolvedValue(candidate);
  await expect(reconcileRepair(db.q,actor,"id")).rejects.toMatchObject({status:409});expect(db.writes).toEqual([]);
 });
});
