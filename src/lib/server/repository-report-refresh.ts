import {queryOsvEvidence,verdict,maskSecrets,type OsvEvidence} from '@heysalad/shiptested';
import type {RepositoryReport} from './repository-scan';

/** Recheck recorded exact dependency evidence, never execute code or resolve new versions.
 * Returns a new revision; the caller must preserve the original and fence publication.
 */
export async function refreshRepositoryAdvisories(original:RepositoryReport,lookup:typeof queryOsvEvidence=queryOsvEvidence,signal?:AbortSignal):Promise<RepositoryReport>{
 const report=structuredClone(original),started=Date.now();
 report.id=crypto.randomUUID();report.createdAt=new Date().toISOString();
 let refreshed=0;
 for(const check of report.checks){
  if(check.state!=='incomplete'||!check.name.endsWith(' — OSV advisories'))continue;
  const manifest=check.name.slice(0,-' — OSV advisories'.length);
  if(!report.repositoryScan.manifests.includes(manifest))throw Error('Manifest identity mismatch.');
  const dependencies=report.dependencies.filter(d=>d.path.startsWith(`${manifest}:`));
  if(!dependencies.length)continue;
  const result:OsvEvidence=await lookup(dependencies,fetch,{signal});
  // Merge by stable finding ID, retaining original non-advisory evidence.
  const findings=new Map(report.findings.map(f=>[f.id,f]));
  for(const finding of result.findings)findings.set(`${manifest}:${finding.id}`,{...finding,id:`${manifest}:${finding.id}`});
  report.findings=[...findings.values()];
  check.state=result.complete?'complete':'incomplete';
  check.detail=`Advisories refreshed ${report.createdAt}: queried ${result.queriedDependencies}/${result.totalDependencies} recorded exact packages; retrieved ${result.retrievedAdvisories}/${result.matchedAdvisories} matched advisories; retained ${result.findings.length} findings.${result.issues.length?` Coverage gaps: ${result.issues.join(', ')}.`:''} Applicability requires human review.`;
  refreshed++;
 }
 if(!refreshed)throw Error('No recorded advisory evidence to refresh.');
 report.checks.push({name:'Advisory evidence refresh',state:'complete',detail:`Rechecked recorded exact dependencies only; original repository snapshot and coverage gaps retained. Original report: ${original.id}. No new repository job or allowance reservation.`});
 report.repositoryScan.advisoryRefresh={previousReportId:original.id,refreshedAt:report.createdAt};
 report.status=verdict(report.findings,report.checks);report.durationMs=Date.now()-started;
 return JSON.parse(maskSecrets(JSON.stringify(report))) as RepositoryReport;
}
