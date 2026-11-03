import { scan, verdict, maskSecrets, MemoryCache, type Report } from '@heysalad/shiptested';
import type { ManifestSnapshot } from './repository-manifests';

const advisoryCache=new MemoryCache(512);

export type RepositoryReport = Report & { repositoryScan: {
  repository:string; commit:string; scannerVersion:string;
  manifests:string[]; omitted:string[]; advisoryRefresh?:{previousReportId:string;refreshedAt:string};
}};

export async function scanRepository(snapshot:ManifestSnapshot,signal?:AbortSignal,scanner:typeof scan=scan):Promise<RepositoryReport> {
  const start=Date.now();
  const report:RepositoryReport={id:crypto.randomUUID(),mode:'live',createdAt:new Date().toISOString(),durationMs:0,status:'Incomplete',dependencies:[],findings:[],checks:[],sources:[],explanations:[],policy:'shiptested-v0.1: high findings block; incomplete coverage cannot pass; other findings require review.',repositoryScan:{repository:snapshot.repository,commit:snapshot.commit,scannerVersion:'0.1.0+unreleased',manifests:[],omitted:[...snapshot.omitted]}};
  for(const [path,content] of Object.entries(snapshot.files)) {
    if(signal?.aborted){
      report.repositoryScan.omitted.push(path);
      report.checks.push({name:`${path} — scan`,state:'incomplete',detail:'Repository time budget exhausted; earlier verified findings are retained.'});
      continue;
    }
    try {
      const result=await scanner({filename:path.split('/').at(-1)!,lockfile:content},{signal,timeoutMs:120000,osv:{cache:advisoryCache}});
      report.repositoryScan.manifests.push(path);
      report.dependencies.push(...result.dependencies.map(d=>({...d,path:`${path}:${d.path}`})));
      report.findings.push(...result.findings.map(f=>({...f,id:`${path}:${f.id}`,evidence:f.evidence.map(e=>({...e,location:`${path}: ${e.location}`,dependency:e.dependency?{...e.dependency,path:`${path}:${e.dependency.path}`}:undefined}))})));
      report.checks.push(...result.checks.map(c=>({...c,name:`${path} — ${c.name}`})));
    } catch {
      report.repositoryScan.omitted.push(path);
      report.checks.push({name:`${path} — scan`,state:'incomplete',detail:'Manifest could not be scanned; no clean result is implied.'});
    }
  }
  report.checks.push({name:'Repository manifest coverage',state:report.repositoryScan.omitted.length||!report.repositoryScan.manifests.length?'incomplete':'complete',detail:!Object.keys(snapshot.files).length&&!snapshot.omitted.length?'No supported dependency manifest was found. Commit package-lock.json v2/v3 or exact requirements.txt pins to enable dependency checks. Source code and other ecosystems were not audited.':`Scanned ${report.repositoryScan.manifests.length} supported manifests; ${report.repositoryScan.omitted.length} omitted. Only exact dependencies in these files were checked.`});
  report.checks.push({name:'Source-code and Git-history audit',state:'not-in-scope',detail:'Repository code was not executed. General source-code analysis, Git history, and dependencies absent from supplied manifests are not covered.'});
  report.status=verdict(report.findings,report.checks);report.durationMs=Date.now()-start;
  return JSON.parse(maskSecrets(JSON.stringify(report))) as RepositoryReport;
}
