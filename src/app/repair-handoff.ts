import type {Finding, ScanReport} from '@/lib/types';

/** Preserve scan provenance; never infer a repository from a package name. */
export function repairHandoff(report: ScanReport, finding: Finding) {
 const dependency=finding.evidence.find(e=>e.dependency?.ecosystem==='npm')?.dependency;
 if(!dependency)return null;
 const source=(report as ScanReport & {repositoryScan?:{repository:string}}).repositoryScan;
 const repository=source?.repository;
 const path=dependency.path||'';
 const manifest=path.includes(':')?path.slice(0,path.indexOf(':')):undefined;
 const packagePath=path.includes(':')?path.slice(path.indexOf(':')+1):path;
 const supported=(!repository||!manifest||manifest==='package-lock.json')&&packagePath===`node_modules/${dependency.name}`;
 const params=new URLSearchParams({package:dependency.name});
 if(repository&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  params.set('repository',repository);params.set('report',report.id);
 }
 return {href:`/repairs?${params}`,repository,dependency,supported};
}
