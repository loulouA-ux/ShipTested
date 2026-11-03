import {it,expect} from 'vitest';
import {refreshRepositoryAdvisories} from '../src/lib/server/repository-report-refresh';
import type {RepositoryReport} from '../src/lib/server/repository-scan';
const original:RepositoryReport={id:'00000000-0000-4000-8000-000000000001',createdAt:'2026-10-28T00:00:00Z',mode:'live',durationMs:1,status:'Incomplete',dependencies:[{name:'example',version:'1.0.0',ecosystem:'npm',path:'package-lock.json:node_modules/example'}],findings:[],checks:[{name:'package-lock.json — OSV advisories',state:'incomplete',detail:'lookup failed'},{name:'Repository manifest coverage',state:'incomplete',detail:'yarn omitted'}],sources:[],explanations:[],policy:'test',repositoryScan:{repository:'owner/repo',commit:'a'.repeat(40),scannerVersion:'0.1.0',manifests:['package-lock.json'],omitted:['yarn.lock']}};
it('creates a revision preserving original, pinned source and non-OSV gaps',async()=>{
 const before=JSON.stringify(original);
 const r=await refreshRepositoryAdvisories(original,async d=>{
  expect(d).toEqual(original.dependencies);
  return {findings:[],complete:true,totalDependencies:1,queriedDependencies:1,matchedAdvisories:0,retrievedAdvisories:0,issues:[]};
 });
 expect(JSON.stringify(original)).toBe(before);expect(r.id).not.toBe(original.id);expect(r.repositoryScan.commit).toBe(original.repositoryScan.commit);expect(r.repositoryScan.advisoryRefresh?.previousReportId).toBe(original.id);expect(r.checks[0].state).toBe('complete');expect(r.status).toBe('Incomplete');expect(r.repositoryScan.omitted).toEqual(['yarn.lock']);
});
it('rejects an unmatched manifest identity',async()=>{
 const r=structuredClone(original);r.repositoryScan.manifests=[];
 await expect(refreshRepositoryAdvisories(r)).rejects.toThrow('identity');
});
