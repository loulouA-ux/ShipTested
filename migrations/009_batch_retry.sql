-- Preserve requested access independently of repository visibility for stable retries.
ALTER TABLE sc_scan_jobs ADD COLUMN IF NOT EXISTS requested_private_access boolean;
UPDATE sc_scan_jobs SET requested_private_access=private_repository WHERE requested_private_access IS NULL;
ALTER TABLE sc_scan_jobs ALTER COLUMN requested_private_access SET DEFAULT false;
ALTER TABLE sc_scan_jobs ALTER COLUMN requested_private_access SET NOT NULL;
