-- Each explicit readiness preview issues a short-lived, single-use approval.
ALTER TABLE sc_repair_merges ADD COLUMN IF NOT EXISTS approval_issued_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS sc_repair_merge_approvals (
 approval_hash text PRIMARY KEY,
 repair_id uuid NOT NULL REFERENCES sc_repairs(id), actor_id text NOT NULL, workspace_id text NOT NULL,
 fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes', consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS sc_merge_approval_expiry ON sc_repair_merge_approvals(actor_id,workspace_id,expires_at);
