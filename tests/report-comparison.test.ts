import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {compareRepositoryReports} from '../src/lib/report-comparison';
import {previousReportComparison} from '../src/lib/server/report-comparison';
import type {RepositoryReport} from '../src/lib/server/repository-scan';
import type {Query} from '../src/lib/server/db';
const report=(ids:string[]):RepositoryReport=>({id:randomUUID(),mode:'live',createdAt:new Date().toISOString(),durationMs:1,status:'Checks passed',dependencies:[],findings:ids.map(id=>({id,title:id,severity:'high',description:'advisory',action:'review',evidence:[{kind:'advisory',location:'lockfile',excerpt:'Matched exact dependency',url:`https://osv.dev/vulnerability/${id}`,dependency:{name:'example',version:'1.0.0',ecosystem:'npm',path:'package-lock.json:node_modules/example'}}]})),checks:[{name:'OSV advisories',state:'complete',detail:'lookup complete'}],sources:[],explanations:[],policy:'test',repositoryScan:{repository:'team/app',commit:'a'.repeat(40),scannerVersion:'test',manifests:['package-lock.json'],omitted:[]}});
describe('repeat scan evidence',()=>{
  it('counts stable associations across changed finding IDs and package versions',()=>{
    const before=report(['old','same']),after=report(['same','new']);
    after.findings[0].id='different-id';after.findings[0].evidence[0].dependency!.version='2.0.0';
    expect(compareRepositoryReports(before,after)).toMatchObject({added:1,unchanged:1,noLongerObserved:1,resolved:1,coverageComparable:true});
  });
  it.each(['incomplete','snapshot'] as const)('does not resolve missing findings when current coverage is %s',state=>{
    const before=report(['old']),after=report([]);after.checks[0].state=state;
    expect(compareRepositoryReports(before,after)).toMatchObject({resolved:null,coverageComparable:false,noLongerObserved:1});
  });
  it('does not infer resolution when manifests disappear, are omitted or previous coverage was incomplete',()=>{
    const before=report(['old']);
    for(const change of [
      {manifests:['different/package-lock.json'],omitted:[]},
      {manifests:['package-lock.json'],omitted:['yarn.lock']},
    ]){const after=report([]);Object.assign(after.repositoryScan,change);expect(compareRepositoryReports(before,after).resolved).toBeNull();}
    before.checks[0].state='incomplete';expect(compareRepositoryReports(before,report([])).resolved).toBeNull();
  });
  it('rejects different repositories',()=>{
    const after=report([]);after.repositoryScan.repository='other/app';expect(()=>compareRepositoryReports(report([]),after)).toThrow();
  });
});
const db=new PGlite(),q:Query=async(sql,params=[]) => (await db.query(sql,params)).rows as Record<string,unknown>[];
beforeAll(async()=>{for(const file of readdirSync('migrations').filter(f=>/^\d+_[a-z_]+\.sql$/.test(f)).sort())await db.exec(readFileSync(`migrations/${file}`,'utf8'));});
afterAll(()=>db.close());
it('finds only earlier reports owned by the same account in the same workspace',async()=>{
  const actor={id:'first',workspaceId:'workspace',role:'member' as const};
  const before=report(['old']),after=report([]),hidden=report(['private']);
  const save=async(r:RepositoryReport,owner:string,workspace:string,date:string)=>q('INSERT INTO sc_scans(id,owner_id,workspace_id,report,created_at) VALUES($1,$2,$3,$4::jsonb,$5)',[r.id,owner,workspace,JSON.stringify(r),date]);
  await save(before,actor.id,actor.workspaceId,'2026-11-01T00:00:00Z');
  await save(hidden,'other',actor.workspaceId,'2026-11-01T01:00:00Z');
  await save({...hidden,id:randomUUID()},actor.id,'other-workspace','2026-11-01T02:00:00Z');
  await save(after,actor.id,actor.workspaceId,'2026-11-02T00:00:00Z');
  expect((await previousReportComparison(q,actor,after.id))?.previousReportId).toBe(before.id);
  expect(await previousReportComparison(q,actor,before.id)).toBeNull();
  await expect(previousReportComparison(q,{...actor,id:'other'},after.id)).rejects.toMatchObject({status:404});
});
