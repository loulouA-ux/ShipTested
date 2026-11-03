CREATE INDEX IF NOT EXISTS sc_scans_repository_history ON sc_scans
 (workspace_id,owner_id,(lower(report->'repositoryScan'->>'repository')),created_at DESC,id DESC);
