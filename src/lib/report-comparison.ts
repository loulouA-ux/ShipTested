import type { RepositoryReport } from './server/repository-scan';
export type ReportComparison = {
  previousReportId: string; previousCreatedAt: string; previousCommit: string;
  added: number; unchanged: number; noLongerObserved: number; resolved: number | null;
  coverageComparable: boolean;
};
function advisoryKeys(report: RepositoryReport) {
  const keys = new Set<string>();
  for (const finding of report.findings) for (const evidence of finding.evidence) {
    const dependency = evidence.dependency;
    if (evidence.kind !== 'advisory' || !dependency || !evidence.url?.startsWith('https://osv.dev/vulnerability/')) continue;
    keys.add(JSON.stringify([evidence.url, dependency.ecosystem, dependency.name, dependency.path]));
  }
  return keys;
}
/** Compare advisory/package/path associations, not volatile finding IDs or versions. */
export function compareRepositoryReports(previous: RepositoryReport, current: RepositoryReport): ReportComparison {
  if (previous.repositoryScan.repository.toLowerCase() !== current.repositoryScan.repository.toLowerCase()) throw Error('Repository comparison requires the same repository.');
  const before = advisoryKeys(previous), after = advisoryKeys(current);
  const complete = (report: RepositoryReport) => report.mode === 'live' && report.repositoryScan.omitted.length === 0 &&
    report.repositoryScan.manifests.length > 0 && report.checks.length > 0 &&
    report.checks.every(c => c.state === 'complete' || c.state === 'not-in-scope');
  const manifests = (report: RepositoryReport) => JSON.stringify([...report.repositoryScan.manifests].sort());
  const coverageComparable = complete(previous) && complete(current) && manifests(previous) === manifests(current);
  const noLongerObserved = [...before].filter(key => !after.has(key)).length;
  return { previousReportId: previous.id, previousCreatedAt: previous.createdAt,
    previousCommit: previous.repositoryScan.commit, added: [...after].filter(key => !before.has(key)).length,
    unchanged: [...after].filter(key => before.has(key)).length, noLongerObserved,
    resolved: coverageComparable ? noLongerObserved : null, coverageComparable };
}
