import type { RepositoryReport } from './repository-scan';
import { ApiError } from './http';
import { validRange,satisfies } from 'semver';

/** Reject unsupported projects before reserving paid execution or preparing a patch. */
export function assertRepairManifest(content:string,packageName:string,version:string){
  let manifest;
  try{manifest=JSON.parse(content);}catch{throw new ApiError(422,'Root package.json must contain valid JSON.');}
  const sections=['dependencies','devDependencies'].filter(section=>Object.hasOwn(manifest?.[section]||{},packageName));
  if(sections.length!==1)throw new ApiError(422,'Choose one direct dependency in root package.json. Transitive-only and ambiguous dependencies require a manual update.');
  const declared=manifest[sections[0]][packageName];
  if(typeof declared!=='string'||!validRange(declared)||!satisfies(version,declared))throw new ApiError(422,'The resolved dependency must match a supported semver range in root package.json.');
  if(typeof manifest.scripts?.test!=='string'||!manifest.scripts.test.trim()||/no test specified/i.test(manifest.scripts.test))
    throw new ApiError(422,'Commit a real npm test script before preparing a tested repair.');
}

/** A report handoff must not silently repair newer code or a different package. */
export function assertRepairSource(
  report: RepositoryReport,
  snapshot: { repository: { full_name: string }; commit: string },
  packageName: string,
  version: string,
) {
  const source = report.repositoryScan;
  if (!source || source.repository.toLowerCase() !== snapshot.repository.full_name.toLowerCase() ||
      source.commit !== snapshot.commit) {
    throw new ApiError(409, 'The repository changed since this report. Run a fresh repository scan before preparing its repair.');
  }
  const path = `package-lock.json:node_modules/${packageName}`;
  const matching = report.findings.some(f => f.evidence.some(e => e.kind === 'advisory' &&
    e.url?.startsWith('https://osv.dev/vulnerability/') && e.dependency?.ecosystem === 'npm' &&
    e.dependency.name === packageName && e.dependency.version === version && e.dependency.path === path));
  if (!matching) throw new ApiError(422, 'This report has no matching root npm dependency finding. Open a supported finding or prepare a separate proposal.');
}
