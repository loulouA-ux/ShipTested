import {describe,it,expect} from 'vitest';
import {queryOsvEvidence} from '../packages/core/src/osv';
import {scan} from '../packages/core/src/index';
const dep={name:'example',version:'1.0.0',ecosystem:'npm' as const,path:'node_modules/example'};
function provider(count:number,fail=''){
 return (async(u:Parameters<typeof fetch>[0])=>{
  const url=String(u);
  if(url.endsWith('/querybatch'))return Response.json({results:[{vulns:Array.from({length:count},(_,i)=>({id:`GHSA-test-${i}`}))}]});
  const id=url.split('/').at(-1)!;
  return id===fail?new Response('',{status:503}):Response.json({id,summary:'Verified advisory',database_specific:{severity:'HIGH'}});
 }) as typeof fetch;
}
describe('bounded OSV evidence',()=>{
 it('retains and completes more than twelve verified advisories',async()=>{
  const r=await queryOsvEvidence([dep],provider(15));expect(r.findings).toHaveLength(15);expect(r.complete).toBe(true);expect(r.queriedDependencies).toBe(1);
 });
 it('retains successful findings when one detail request fails',async()=>{
  const r=await queryOsvEvidence([dep],provider(3,'GHSA-test-1'));expect(r.findings).toHaveLength(2);expect(r.complete).toBe(false);expect(r.issues).toContain('advisory_lookup_failed');
 });
 it('reports a hard detail budget without discarding findings',async()=>{
  const r=await queryOsvEvidence([dep],provider(201));expect(r.findings).toHaveLength(200);expect(r.complete).toBe(false);expect(r.issues).toContain('advisory_limit');
 });
 it('retains first batch evidence when the next batch fails',async()=>{
  let calls=0;const f=(async(u:Parameters<typeof fetch>[0])=>String(u).endsWith('/querybatch')?(++calls===1?Response.json({results:Array.from({length:100},()=>({vulns:[{id:'GHSA-test-0'}]}))}):new Response('',{status:503})):Response.json({id:'GHSA-test-0'})) as typeof fetch;
  const r=await queryOsvEvidence(Array.from({length:101},(_,i)=>({...dep,name:`example${i}`})),f);expect(r.findings).toHaveLength(100);expect(r.complete).toBe(false);expect(r.queriedDependencies).toBe(100);
 });
 it('never treats pagination or a response length mismatch as complete',async()=>{
  const paged=await queryOsvEvidence([dep],(async()=>Response.json({results:[{next_page_token:'more'}]})) as typeof fetch);expect(paged.complete).toBe(false);
  const short=await queryOsvEvidence([dep],(async()=>Response.json({results:[]})) as typeof fetch);expect(short.complete).toBe(false);expect(short.queriedDependencies).toBe(0);
 });
 it('preserves caller cancellation and a non-clean verdict with lookup gaps',async()=>{
  const c=new AbortController();c.abort();const r=await queryOsvEvidence([dep],provider(1),{signal:c.signal});expect(r.complete).toBe(false);expect(r.issues).toContain('deadline');
  const report=await scan({filename:'package-lock.json',lockfile:JSON.stringify({lockfileVersion:3,packages:{'node_modules/example':{version:'1.0.0'}}})},{fetcher:provider(1,'GHSA-test-0')});expect(report.status).toBe('Incomplete');expect(report.checks.find(c=>c.name==='OSV advisories')?.detail).toContain('advisory_lookup_failed');
 });
});

it('repository deadline keeps already verified findings and marks remaining manifests omitted',async()=>{
 const {scanRepository}=await import('../src/lib/server/repository-scan');
 const c=new AbortController();let calls=0;
 const result=await scanRepository({repository:'owner/repo',commit:'a'.repeat(40),tree:'b'.repeat(40),private:false,files:{'a/package-lock.json':'{}','b/package-lock.json':'{}'},omitted:[]},c.signal,async()=>{
  calls++;c.abort();return {id:crypto.randomUUID(),mode:'live',createdAt:new Date().toISOString(),durationMs:1,status:'Review required',dependencies:[dep],findings:[],checks:[{name:'OSV advisories',state:'complete',detail:'one lookup'}],sources:[],explanations:[],policy:'test'};
 });
 expect(calls).toBe(1);expect(result.dependencies).toHaveLength(1);expect(result.repositoryScan.omitted).toEqual(['b/package-lock.json']);expect(result.status).toBe('Incomplete');
});
