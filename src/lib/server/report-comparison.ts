import type { Query } from './db';
import { Store, type Actor } from './store';
import type { RepositoryReport } from './repository-scan';
import { compareRepositoryReports } from '../report-comparison';
export async function previousReportComparison(query: Query, actor: Actor, id: string) {
  const report = await new Store(query).getScan(actor, id) as RepositoryReport;
  if (!report.repositoryScan) return null;
  const [previous] = await query(`SELECT report FROM sc_scans
    WHERE workspace_id=$1 AND owner_id=$2 AND id<>$3
      AND lower(report->'repositoryScan'->>'repository')=lower($4)
      AND (created_at,id)<(SELECT created_at,id FROM sc_scans WHERE id=$3 AND workspace_id=$1 AND owner_id=$2)
    ORDER BY created_at DESC,id DESC LIMIT 1`, [actor.workspaceId, actor.id, id, report.repositoryScan.repository]);
  return previous ? compareRepositoryReports(previous.report as RepositoryReport, report) : null;
}
