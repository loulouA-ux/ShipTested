import {describe,it,expect} from "vitest";
import {verifyRepair,type SandboxFactory} from "../src/lib/repair/runner";
import {contentHash,repairPlanHash,type RepairPlan} from "../src/lib/repair/plan";
import {validateSnapshot,sandboxCommands} from "../src/lib/repair/sandbox";
const manifest=JSON.stringify({dependencies:{lodash:"4.17.20"},scripts:{test:"node test.js"}});
const after=JSON.stringify({dependencies:{lodash:"4.17.21"},scripts:{test:"node test.js"}});
const unsigned={schemaVersion:1 as const,baseCommit:"a".repeat(40),packageName:"lodash",fromVersion:"4.17.20",toVersion:"4.17.21",section:"dependencies" as const,advisoryIds:["GHSA-test"],sourceUrls:["https://osv.dev/vulnerability/GHSA-test"],manifestBefore:manifest,manifestAfter:after,manifestHash:contentHash(manifest),limitations:[]};
const plan:RepairPlan={...unsigned,planHash:repairPlanHash(unsigned)};
const files={"package.json":manifest,"package-lock.json":JSON.stringify({lockfileVersion:3,packages:{"":{dependencies:{lodash:"4.17.20"}},"node_modules/lodash":{version:"4.17.20"}}}),"test.js":"console.log('test')"};
const clean=(async(url,init)=>new Response(JSON.stringify(String(url).includes("/vulns/")?{id:"GHSA-test",summary:"Fixture advisory"}:{results:JSON.parse(String(init?.body)).queries.map((q:{version:string})=>q.version==="4.17.20"?{vulns:[{id:"GHSA-test"}]}:{})}))) as typeof fetch;
function fixture(opts:{testFail?:boolean;cleanupFail?:boolean;wrongLock?:boolean;deprecated?:boolean;mutation?:{phase:"baseline"|"patched";command:"install"|"test"|"build";file:"package.json"|"package-lock.json"};readFail?:boolean}={}){
 const events:string[]=[];
 const factory:SandboxFactory=async phase=>{
  let contents:Record<string,string>={};
  return {
   async writeFiles(files){contents={...files};events.push(phase+":write");},async network(p){events.push(phase+":"+p);},
   async run(command){
    events.push(phase+":"+command);
    if(command==="lockfile")contents["package-lock.json"]=JSON.stringify({lockfileVersion:3,packages:{"":{dependencies:{lodash:"4.17.21"}},"node_modules/lodash":{version:opts.wrongLock?"4.17.20":"4.17.21",deprecated:opts.deprecated?"Bad release":undefined}}});
    if(opts.mutation?.phase===phase&&opts.mutation.command===command)contents[opts.mutation.file]+="\n";
    return {command,exitCode:opts.testFail&&command==="test"?1:0,output:"bounded output"};
   },
   async readFile(path){if(opts.readFail)throw Error("Dependency file read failed.");return contents[path];},
   async stop(){events.push(phase+":stop");if(opts.cleanupFail)throw Error("cleanup");}
  };
 };return {factory,events};
}
describe("isolated repair verification",()=>{
 it("denies network before tests and cleans both runs",async()=>{const f=fixture();const r=await verifyRepair(plan,files,f.factory,clean);expect(r.status).toBe("passed");expect(r.artifactChecks).toEqual({baseline:true,patched:true});expect(r.scans?.before.findings).toHaveLength(1);expect(r.scans?.after?.findings).toHaveLength(0);expect(r.scans?.before.dependencyCount).toBe(1);for(const p of ["baseline","patched"]){expect(f.events.indexOf(p+":deny-all")).toBeLessThan(f.events.indexOf(p+":test"));expect(f.events).toContain(p+":stop");}});
 it("verifies a plan after database JSON field reordering",async()=>{
  const reordered=Object.fromEntries(Object.entries(plan).reverse()) as RepairPlan;
  const f=fixture();expect((await verifyRepair(reordered,files,f.factory,clean)).status).toBe("passed");
 });
 it("refuses stale advisory evidence before starting paid sandboxes",async()=>{
  const f=fixture();const noFindings=(async()=>new Response(JSON.stringify({results:[{}]}))) as typeof fetch;
  await expect(verifyRepair(plan,files,f.factory,noFindings)).rejects.toThrow("no longer confirms");expect(f.events).toEqual([]);
 });
 it("rejects a tampered plan before any sandbox",async()=>{const f=fixture();await expect(verifyRepair({...plan,toVersion:"9.0.0"},files,f.factory,clean)).rejects.toThrow("changed");expect(f.events).toEqual([]);});
 it("rejects a deprecated generated target even when tests pass",async()=>{const f=fixture({deprecated:true});const r=await verifyRepair(plan,files,f.factory,clean);expect(r.status).toBe("failed");expect(r.errors.join()).toContain("deprecated");expect(r.cleanupComplete).toBe(true);});
 it("fails tests without skipping cleanup",async()=>{const f=fixture({testFail:true});const r=await verifyRepair(plan,files,f.factory,clean);expect(r.status).toBe("failed");expect(f.events).toContain("baseline:stop");expect(f.events).toContain("patched:stop");});
 it("fails if cleanup fails",async()=>{const f=fixture({cleanupFail:true});expect((await verifyRepair(plan,files,f.factory,clean)).cleanupComplete).toBe(false);});
 it("rejects a lockfile that did not apply the patch",async()=>{const f=fixture({wrongLock:true});const r=await verifyRepair(plan,files,f.factory,clean);expect(r.status).toBe("failed");expect(r.errors.join()).toContain("does not resolve");});
 it("retains the after scan when tests fail without allowing approval",async()=>{
  const f=fixture({testFail:true});const r=await verifyRepair(plan,files,f.factory,clean);
  expect(r.status).toBe("failed");expect(r.scans?.after?.findings).toEqual([]);
  expect(r.artifactChecks).toEqual({baseline:true,patched:true});
 });
 it.each((["baseline","patched"] as const).flatMap(phase=>(["install","test","build"] as const).flatMap(command=>(["package.json","package-lock.json"] as const).map(file=>({phase,command,file})))))("rejects changed dependency files: $phase $command $file",async mutation=>{
  const withBuild=JSON.stringify({...JSON.parse(manifest),scripts:{test:"node test.js",build:"node build.js"}});
  const buildAfter=JSON.stringify({...JSON.parse(after),scripts:{test:"node test.js",build:"node build.js"}});
  const u={...unsigned,manifestBefore:withBuild,manifestAfter:buildAfter,manifestHash:contentHash(withBuild)};
  const p={...u,planHash:repairPlanHash(u)};
  const f=fixture({mutation});const r=await verifyRepair(p,{...files,"package.json":withBuild},f.factory,clean);
  expect(r.status).toBe("failed");expect(r.artifactChecks?.[mutation.phase]).toBe(false);
  expect(r.errors.join()).toContain("dependency files changed");
  if(mutation.phase==="patched")expect(r.scans?.after).toBeUndefined();
  expect(f.events).toContain("baseline:stop");expect(f.events).toContain("patched:stop");
 });
 it("fails closed and cleans up when dependency files cannot be read",async()=>{
  const f=fixture({readFail:true});const r=await verifyRepair(plan,files,f.factory,clean);
  expect(r.status).toBe("failed");expect(r.artifactChecks).toEqual({baseline:false,patched:false});
  expect(r.scans?.after).toBeUndefined();expect(f.events).toContain("baseline:stop");expect(f.events).toContain("patched:stop");
 });
 it("rejects unsafe snapshot paths and credentials",()=>{for(const path of ["../outside",".env.local",".npmrc","node_modules/pkg/a.js",".git/config"]){expect(()=>validateSnapshot({[path]:"x"})).toThrow();}expect(()=>validateSnapshot({"src/test.js":"ok"})).not.toThrow();expect(sandboxCommands.install).toContain("--ignore-scripts");});
});
