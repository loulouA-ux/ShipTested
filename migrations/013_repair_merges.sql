-- Keep publication evidence immutable while recording a separately approved merge.
CREATE TABLE IF NOT EXISTS sc_repair_merges (
 repair_id uuid PRIMARY KEY REFERENCES sc_repairs(id),
 actor_id text NOT NULL, workspace_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('requesting','pending','uncertain','failed','merged')),
 attempt_id uuid NOT NULL, approval_hash text NOT NULL, head_sha text NOT NULL, base_sha text NOT NULL,
 request_id uuid, merge_commit text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sc_repair_events DROP CONSTRAINT IF EXISTS sc_repair_events_event_type_check;
ALTER TABLE sc_repair_events ADD CONSTRAINT sc_repair_events_event_type_check CHECK(event_type IN (
 'proposal_created','verification_started','verification_passed','verification_failed','patch_approved',
 'publication_commit_created','draft_pr_created','draft_pr_reconciled',
 'merge_approved','merge_requested','merge_uncertain','merge_failed','merge_confirmed'
));
