import { describe, expect, it } from 'vitest';
import { assertRepairSource,assertRepairManifest } from '../src/lib/server/repair-source';
import type { RepositoryReport } from '../src/lib/server/repository-scan';
const commit = 'a'.repeat(40);
const report = {
  repositoryScan: { repository: 'team/app', commit },
  findings: [{ evidence: [{ kind: 'advisory', url: 'https://osv.dev/vulnerability/GHSA-example',
    dependency: { name: 'lodash', version: '4.17.20', ecosystem: 'npm', path: 'package-lock.json:node_modules/lodash' } }] }],
} as RepositoryReport;
const snapshot = { repository: { full_name: 'team/app' }, commit };
it('rejects unsupported repair inputs before paid verification',()=>{
  const valid={dependencies:{lodash:'^4.17.20'},scripts:{test:'node test.cjs'}};
  expect(()=>assertRepairManifest(JSON.stringify(valid),'lodash','4.17.20')).not.toThrow();
  for(const manifest of [{...valid,scripts:{}},{...valid,scripts:{test:'echo "Error: no test specified" && exit 1'}},{...valid,dependencies:{}},{...valid,devDependencies:valid.dependencies},{...valid,dependencies:{lodash:'workspace:*'}}]){
    expect(()=>assertRepairManifest(JSON.stringify(manifest),'lodash','4.17.20')).toThrow();
  }
});
describe('report-bound repair source', () => {
  it('accepts only the same repository, pinned commit and direct finding', () => {
    expect(() => assertRepairSource(report, snapshot, 'lodash', '4.17.20')).not.toThrow();
  });
  it.each([
    { ...snapshot, commit: 'b'.repeat(40) },
    { ...snapshot, repository: { full_name: 'team/other' } },
  ])('rejects changed source before a repair is created', current => {
    expect(() => assertRepairSource(report, current, 'lodash', '4.17.20')).toThrow();
  });
  it('rejects a different package or installed version', () => {
    expect(() => assertRepairSource(report, snapshot, 'other', '4.17.20')).toThrow();
    expect(() => assertRepairSource(report, snapshot, 'lodash', '4.17.21')).toThrow();
  });
  it.each(['apps/web/package-lock.json:node_modules/lodash', 'package-lock.json:node_modules/parent/node_modules/lodash'])('rejects unsupported project/dependency path %s', path => {
    const nested = structuredClone(report);nested.findings[0].evidence[0].dependency!.path = path;
    expect(() => assertRepairSource(nested, snapshot, 'lodash', '4.17.20')).toThrow();
  });
  it('rejects a manifest-only or non-advisory report', () => {
    expect(() => assertRepairSource({ ...report, repositoryScan: undefined } as unknown as RepositoryReport, snapshot, 'lodash', '4.17.20')).toThrow();
    const other = structuredClone(report);other.findings[0].evidence[0].kind = 'code';
    expect(() => assertRepairSource(other, snapshot, 'lodash', '4.17.20')).toThrow();
  });
});
