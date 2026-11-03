import {z} from "zod";
import {advisoryMetadata} from "./advisory-metadata.js";
import {maskSecrets} from "./scanner.js";
import type {Dependency,Finding} from "./types.js";
import {boundedJson} from "./transport.js";
export const advisorySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._-]+$/),
  summary: z.string().optional(),
  details: z.string().optional(),
  withdrawn: z.string().optional(),
  database_specific:z.object({severity:z.string().optional()}).optional(),
  severity:z.array(z.object({type:z.string(),score:z.string()})).optional(),
  affected:z.array(z.object({package:z.object({name:z.string(),ecosystem:z.string()}).optional(),ranges:z.array(z.object({type:z.string(),events:z.array(z.object({introduced:z.string().optional(),fixed:z.string().optional(),last_affected:z.string().optional(),limit:z.string().optional()}))})).optional()})).optional(),
});
async function queryBatch(
  dependencies: Dependency[],
  fetcher: typeof fetch = fetch,
  opts: OsvOptions = {},
): Promise<Finding[]> {
  if (!dependencies.length) return [];
  const batch = z
    .object({
      results: z.array(
        z.object({
          vulns: z
            .array(z.object({ id: z.string().regex(/^[A-Za-z0-9._-]+$/) }))
            .optional(),
          next_page_token: z.string().optional(),
        }),
      ),
    })
    .parse(
      await boundedJson(
        "https://api.osv.dev/v1/querybatch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queries: dependencies.map((d) => ({
              package: { name: d.name, ecosystem: d.ecosystem },
              version: d.version,
            })),
          }),
        },
        fetcher,
      ),
    );
  if (
    batch.results.length !== dependencies.length ||
    batch.results.some((r) => r.next_page_token)
  )
    throw new Error("OSV returned partial results.");
  const ids = [
    ...new Set(batch.results.flatMap((r) => r.vulns?.map((v) => v.id) ?? [])),
  ];
  if (ids.length > 12)
    throw new Error("OSV advisory budget exceeded; narrow the manifest.");
  const retrieved = new Map<string,string>();
  const details = new Map<string, z.infer<typeof advisorySchema>>();
  // OSV performs ecosystem-aware matching for the exact version. Do not reinterpret PyPI ranges with semver.
  for (let i = 0; i < ids.length; i += 3)
    await Promise.all(
      ids.slice(i, i + 3).map(async (id) => {
        const result = await getAdvisory(id,{...opts,fetcher});
        const a=result.advisory;
        retrieved.set(id,result.retrievedAt);
        details.set(id, a);
      }),
    );
  return batch.results.flatMap((r, i) =>
    (r.vulns ?? []).flatMap((v) => {
      const a = details.get(v.id)!;
      if (a.withdrawn) return [];
      const d = dependencies[i];
      return [
        {
          id: `${a.id}:${d.name}@${d.version}`,
          title: maskSecrets(a.summary ?? a.id),
          ...advisoryMetadata(a,d),
          description: `OSV reports ${d.name}@${d.version} as affected. Application-level exploitability has not been checked; severity comes only from advisory metadata.`,
          action:
            "Read the advisory, identify a supported fixed version, update the lockfile and test the application. No changes have been applied.",
          evidence: [
            {
              kind: "advisory" as const,
              dependency: { ...d },
              location: `${d.path} · ${d.name}@${d.version}`,
              excerpt: maskSecrets(
                (a.details ?? "See the linked advisory.").slice(0, 1800),
              ),
              url: `https://osv.dev/vulnerability/${a.id}`,
              retrievedAt: retrieved.get(a.id)!,
            },
          ],
        },
      ];
    }),
  );
}

export type CacheEntry = {value:unknown;retrievedAt:string;expiresAt:number};
export interface Cache { get(key:string):CacheEntry|undefined; set(key:string,value:CacheEntry):void; }
export class MemoryCache implements Cache {
 private entries=new Map<string,CacheEntry>();
 constructor(private maxEntries=256){}
 get(key:string){const value=this.entries.get(key);if(value&&value.expiresAt>Date.now())return structuredClone(value);this.entries.delete(key);}
 set(key:string,value:CacheEntry){if(this.entries.size>=this.maxEntries){const first=this.entries.keys().next().value;if(first)this.entries.delete(first);}this.entries.set(key,structuredClone(value));}
}
export type OsvOptions={signal?:AbortSignal;baseUrl?:string;cache?:Cache;fetcher?:typeof fetch};
function checkedFetch(opts:OsvOptions,fetcher:typeof fetch){
 if(opts.baseUrl&&opts.baseUrl!=='https://api.osv.dev')throw Error('Only https://api.osv.dev is allowed.');
 return ((url:Parameters<typeof fetch>[0],init?:RequestInit)=>fetcher(url,{...init,signal:opts.signal&&init?.signal?AbortSignal.any([opts.signal,init.signal]):opts.signal||init?.signal})) as typeof fetch;
}
export async function getAdvisory(id:string,opts:OsvOptions={}){
 if(!/^[A-Za-z0-9._-]{1,160}$/.test(id))throw Error('Invalid advisory ID.');
 opts.signal?.throwIfAborted();const fetcher=checkedFetch(opts,opts.fetcher||fetch);
 const key=`https://api.osv.dev/v1/vulns/${id}`,entry=opts.cache?.get(key);
 const cached=entry&&entry.expiresAt>Date.now()?entry:undefined;
 const value=cached||{value:await boundedJson(key,{},fetcher),retrievedAt:new Date().toISOString(),expiresAt:Date.now()+3600000};
 const advisory=advisorySchema.parse(value.value);if(advisory.id!==id)throw Error('Advisory identity mismatch.');
 if(!cached)opts.cache?.set(key,value);
 return {advisory:JSON.parse(maskSecrets(JSON.stringify(advisory))) as typeof advisory,retrievedAt:value.retrievedAt,untrusted:true as const};
}
export async function queryOsv(dependencies:Dependency[],fetcher:typeof fetch=fetch,opts:OsvOptions={}):Promise<Finding[]>{
 if(dependencies.length>5000)throw Error('OSV package limit exceeded.');
 const safe=checkedFetch(opts,fetcher),findings:Finding[]=[];
 for(let i=0;i<dependencies.length;i+=100){opts.signal?.throwIfAborted();findings.push(...await queryBatch(dependencies.slice(i,i+100),safe,opts));if(new Set(findings.flatMap(f=>f.evidence.map(e=>e.url))).size>12)throw Error('OSV advisory budget exceeded; narrow the manifest.');}
 return findings;
}

export type OsvEvidence = {
 findings:Finding[]; complete:boolean; queriedDependencies:number; totalDependencies:number;
 matchedAdvisories:number; retrievedAdvisories:number; issues:string[];
};
/** Partial evidence is useful, but must never be represented as complete coverage.
 * Bounded to 5,000 packages, 200 distinct detail requests and 2,000 findings.
 * The strict queryOsv API remains available to callers requiring all-or-nothing evidence.
 */
export async function queryOsvEvidence(dependencies:Dependency[],fetcher:typeof fetch=fetch,opts:OsvOptions={}):Promise<OsvEvidence>{
 if(dependencies.length>5000)throw Error('OSV package limit exceeded.');
 const safe=checkedFetch(opts,fetcher),issues=new Set<string>(),findings:Finding[]=[];
 const attempted=new Set<string>(),matched=new Set<string>();
 const details=new Map<string,Awaited<ReturnType<typeof getAdvisory>>>();
 let queriedDependencies=0;
 for(let offset=0;offset<dependencies.length;offset+=100){
  if(opts.signal?.aborted){issues.add('deadline');break;}
  const batchDependencies=dependencies.slice(offset,offset+100);
  let results:{vulns?:{id:string}[];next_page_token?:string}[];
  try{
   const batch=z.object({results:z.array(z.object({vulns:z.array(z.object({id:z.string().regex(/^[A-Za-z0-9._-]{1,160}$/)})).optional(),next_page_token:z.string().optional()}))}).parse(await boundedJson('https://api.osv.dev/v1/querybatch',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({queries:batchDependencies.map(d=>({package:{name:d.name,ecosystem:d.ecosystem},version:d.version}))})
   },safe));
   if(batch.results.length!==batchDependencies.length){issues.add('query_response_mismatch');continue;}
   results=batch.results;queriedDependencies+=batchDependencies.length;
  }catch{issues.add(opts.signal?.aborted?'deadline':'package_lookup_failed');continue;}
  if(results.some(r=>r.next_page_token))issues.add('pagination');
  const ids=[...new Set(results.flatMap(r=>r.vulns?.map(v=>v.id)??[]))];
  for(const id of ids)matched.add(id);
  const pending=ids.filter(id=>!attempted.has(id));
  const selected=pending.slice(0,Math.max(0,200-attempted.size));
  if(selected.length<pending.length)issues.add('advisory_limit');
  for(let i=0;i<selected.length;i+=3){
   if(opts.signal?.aborted){issues.add('deadline');break;}
   await Promise.all(selected.slice(i,i+3).map(async id=>{
    attempted.add(id);
    try{details.set(id,await getAdvisory(id,{...opts,fetcher:safe}));}
    catch{issues.add(opts.signal?.aborted?'deadline':'advisory_lookup_failed');}
   }));
  }
  results.forEach((r,i)=>{
   for(const v of r.vulns??[]){
    const evidence=details.get(v.id);if(!evidence)continue;
    const a=evidence.advisory;if(a.withdrawn)continue;
    if(findings.length>=2000){issues.add('finding_limit');break;}
    const d=batchDependencies[i];
    findings.push({id:`${a.id}:${d.name}@${d.version}`,title:maskSecrets(a.summary??a.id),...advisoryMetadata(a,d),
     description:`OSV reports ${d.name}@${d.version} as affected. Application-level exploitability has not been checked; severity comes only from advisory metadata.`,
     action:'Read the advisory, identify a supported fixed version, update the lockfile and test the application. No changes have been applied.',
     evidence:[{kind:'advisory',dependency:{...d},location:`${d.path} · ${d.name}@${d.version}`,excerpt:maskSecrets((a.details??'See the linked advisory.').slice(0,1800)),url:`https://osv.dev/vulnerability/${a.id}`,retrievedAt:evidence.retrievedAt}]
    });
   }
  });
 }
 return {findings,complete:issues.size===0&&queriedDependencies===dependencies.length,queriedDependencies,totalDependencies:dependencies.length,matchedAdvisories:matched.size,retrievedAdvisories:details.size,issues:[...issues]};
}
