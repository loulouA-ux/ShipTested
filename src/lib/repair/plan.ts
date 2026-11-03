import { createHash } from "node:crypto";
import { valid, validRange, satisfies, gt, compare, prerelease } from "semver";
import { z } from "zod";
import { boundedJson } from "../providers";

const advisorySchema = z.object({
  id:z.string().regex(/^[A-Za-z0-9._-]+$/), withdrawn:z.string().optional(),
  affected:z.array(z.object({package:z.object({name:z.string(),ecosystem:z.string()}),
    ranges:z.array(z.object({type:z.string(),events:z.array(z.object({fixed:z.string().optional()}))})).optional()})),
});
export type RepairPlan = {
  schemaVersion:1; baseCommit:string; packageName:string; fromVersion:string; toVersion:string;
  section:"dependencies"|"devDependencies"; advisoryIds:string[]; sourceUrls:string[];
  manifestBefore:string; manifestAfter:string; manifestHash:string; planHash:string;
  limitations:string[];
};
export function contentHash(value:string){return createHash("sha256").update(value).digest("hex");}
// JSON persistence may reorder object keys at any depth. Arrays and string
// contents retain their exact order/content so evidence changes remain bound.
export function structuredHash(value:unknown){
  return contentHash(JSON.stringify(value,(_key,item)=>item&&typeof item==="object"&&!Array.isArray(item)
    ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item));
}
export function repairPlanHash(plan:Omit<RepairPlan,"planHash">){return structuredHash(plan);}
const registryReleaseSchema=z.object({name:z.string(),version:z.string(),deprecated:z.union([z.string(),z.boolean()]).optional()});
export function rejectDeprecatedTarget(lockfile:string,packageName:string){
  const target=JSON.parse(lockfile).packages?.[`node_modules/${packageName}`];
  if(target?.deprecated)throw Error("The proposed dependency release is deprecated. Prepare a fresh repair.");
}
const packagePattern=/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
export async function proposeDependencyRepair(input:{baseCommit:string;manifest:string;packageName:string;currentVersion:string;advisoryIds:string[]},fetcher:typeof fetch=fetch):Promise<RepairPlan>{
  if(!/^[a-f0-9]{40}$/.test(input.baseCommit))throw Error("A pinned Git commit is required.");
  if(Buffer.byteLength(input.manifest)>200000)throw Error("Manifest exceeds repair limit.");
  if(!packagePattern.test(input.packageName)||!valid(input.currentVersion))throw Error("Exact npm dependency required.");
  if(!input.advisoryIds.length||input.advisoryIds.length>12||input.advisoryIds.some(id=>!/^[A-Za-z0-9._-]+$/.test(id)))throw Error("Bounded advisory evidence required.");
  const manifest=JSON.parse(input.manifest);
  const sections=(["dependencies","devDependencies"] as const).filter(s=>Object.hasOwn(manifest[s]||{},input.packageName));
  if(sections.length!==1)throw Error("Repair requires one unambiguous direct dependency.");
  const section=sections[0];
  // The lockfile supplies the actual installed version; the manifest must permit it.
  // Aliases, URLs, workspaces and tags need their own resolution/provenance checks.
  const declared=manifest[section][input.packageName];
  if(typeof declared!=="string"||!declared.trim()||!validRange(declared)||!satisfies(input.currentVersion,declared))throw Error("Locked dependency does not match a supported manifest range.");
  const candidates=new Set<string>();
  for(const id of input.advisoryIds){
    const a=advisorySchema.parse(await boundedJson(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`,{},fetcher));
    if(a.id!==id||a.withdrawn)throw Error("Advisory unavailable or withdrawn.");
    const matching=a.affected.filter(p=>p.package.ecosystem==="npm"&&p.package.name===input.packageName);
    if(!matching.length)throw Error("Advisory does not match this dependency.");
    for(const p of matching)for(const r of p.ranges||[])if(r.type==="SEMVER")for(const e of r.events)if(e.fixed&&valid(e.fixed)&&gt(e.fixed,input.currentVersion))candidates.add(e.fixed);
  }
  // Query both exact versions; a fixed event alone is not proof that other advisories are cleared.
  const query=async(version:string)=>{
    const result=z.object({vulns:z.array(z.object({id:z.string()})).optional(),next_page_token:z.string().optional()}).parse(await boundedJson("https://api.osv.dev/v1/query",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({package:{name:input.packageName,ecosystem:"npm"},version})},fetcher));
    if(result.next_page_token)throw Error("OSV returned incomplete repair evidence.");
    return (result.vulns||[]).map(v=>v.id);
  };
  const before=await query(input.currentVersion);
  if(input.advisoryIds.some(id=>!before.includes(id)))throw Error("Selected advisory does not affect the pinned version.");
  const release=async(version:string)=>{
    const metadata=registryReleaseSchema.parse(await boundedJson(`https://registry.npmjs.org/${encodeURIComponent(input.packageName)}/${encodeURIComponent(version)}`,{},fetcher));
    if(metadata.name!==input.packageName||!valid(metadata.version)||(version!=="latest"&&metadata.version!==version))throw Error("Registry metadata does not match the proposed dependency.");
    return metadata;
  };
  let target:string|undefined;
  for(const version of [...candidates].sort(compare).slice(0,5)){
    if(prerelease(version))continue;
    if((await release(version)).deprecated)continue;
    const after=await query(version);
    if(after.length===0){target=version;break;}
  }
  // A fixed-event release may be deprecated. Check one published stable fallback,
  // still requiring an exact-version OSV lookup rather than trusting the tag.
  if(!target){
    const latest=await release("latest");
    if(!latest.deprecated&&!prerelease(latest.version)&&gt(latest.version,input.currentVersion)&&(await query(latest.version)).length===0)target=latest.version;
  }
  if(!target)throw Error("No verified advisory-free candidate within the repair budget.");
  manifest[section][input.packageName]=target;
  const manifestAfter=JSON.stringify(manifest,null,2)+"\n";
  const data={schemaVersion:1 as const,baseCommit:input.baseCommit,packageName:input.packageName,fromVersion:input.currentVersion,toVersion:target,section,advisoryIds:[...new Set(input.advisoryIds)].sort(),sourceUrls:[...new Set(input.advisoryIds)].sort().map(id=>`https://osv.dev/vulnerability/${id}`),manifestBefore:input.manifest,manifestAfter,manifestHash:contentHash(input.manifest),limitations:["OSV evidence is a point-in-time lookup, not a security guarantee.","Lockfile regeneration and isolated baseline/patched tests are required before approval.","Major-version changes may require application changes; test failures block handoff."]};
  return {...data,planHash:repairPlanHash(data)};
}
