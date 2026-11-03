# Approved repair merges

This extends the saved, verified repair handoff with a separate human-approved squash merge. It does not enable automatic merge, mark a draft ready, update a branch, bypass repository rules, delete branches, roll back production, or deploy an application.

## Acceptance criteria fixed before implementation

- Exact verified patch, owned repair, same PR/repository/base/head. Changed files, commits, repository, draft status and stale base must block a remote write. Proof: server/database tests and provider contract fixtures.
- Current GitHub user write permission, active workspace membership and selected-repository connection are required. Feature defaults off. Proof: connection/auth tests and negative API checks.
- Fresh successful CI and clean GitHub mergeability are required. Pending, failing, incomplete or unknown evidence and outstanding requested changes block. GitHub evaluates protections with rule bypass explicitly disabled. Proof: provider contract tests and a read-only live fixture probe.
- Separate explicit approval binds the repair, actor/workspace, PR, patch, head, base and squash method. Concurrent approval sends at most one provider write. Proof: database integration tests.
- Accepted/pending, rejected, merged and uncertain outcomes remain distinct. Recovery reads status without retrying a write. Each attempt has its own ID to fence stale reconciliation. Proof: integration and browser recovery tests.
- UI names the target branch and commit, presents checks and explains deployment consequences. Proof: browser assertions, desktop/mobile screenshots in both themes and accessibility checks.
- Relevant static/build/unit/browser checks pass before review. No live merge is included without approval of a specific fixture and patch. Proof: dated verification results.

## Configuration and use

Apply `013_repair_merges.sql` and `014_merge_approval_tickets.sql` through the existing migration workflow in a reviewed development environment. Both `SHIPTESTED_MERGE_ENABLED=1` and `SHIPTESTED_CUSTOMER_REPOSITORIES=1` are necessary. Leave merging off in production until provider acceptance and release approval. Operator keys and legacy admin-mapped installation grants cannot merge.

The GitHub App user authorization must already have the permissions needed to read contents, PRs, commit statuses and checks, and write contents. No permission or grant is expanded by this implementation. Missing permissions fail closed. The short-lived connected user token is used directly, so GitHub evaluates the human's repository permissions. The app installation token is not used to merge.

After an exact-patch draft handoff, mark the PR ready for review on GitHub and satisfy repository checks/reviews. In the saved repair, choose **Check merge readiness**, inspect the exact target/head and current checks, select the separate merge approval checkbox, then choose **Approve and squash merge**. Readiness is fetched again before submission. Approval does not persist across a refresh. Each ready preview issues a single-use, five-minute ticket bound to the reviewed fingerprint. A consumed or expired ticket cannot submit another merge. Tickets issued before a definitive rejection are invalid for a retry; a new readiness check and approval are required. Ticket consumption precedes the atomic merge/audit claim; a failed claim never restores the ticket.

Version one supports a single verified repair commit based on the unchanged default branch, exactly two modified dependency-file blobs, and squash merging. At least one current-head GitHub check/status must succeed; all reported checks/statuses must be successful, neutral or skipped. Neutral/skipped results alone are insufficient. Unsupported, missing, truncated or ambiguous evidence blocks. Ordinary GitHub protections remain authoritative; this is not a separate implementation of all possible branch rules.

The request uses the asynchronous GitHub API with the exact `sha`, `merge_method=squash`, `merge_action=direct_merge` and `bypass_rules=false`. Stack membership is checked twice and any stack is rejected: GitHub’s async endpoint can include downstack PRs. Queue-required or stacked workflows are outside this first version. They must be handled on GitHub; this feature does not enable an automatic future merge. A base-branch read is a point-in-time check; the API atomically binds the head, not the base. GitHub evaluates its branch/ruleset requirements when executing the request.

`requesting`, `pending` or `uncertain` states only offer **Check merge status**. Timeouts, malformed responses, conflicting submissions and persistence failures never trigger an automatic repeat. An uncertain write without a request UUID can be confirmed by reading the matching merged PR; if it is still open, the state stays uncertain for manual investigation. A definitive provider rejection permits a new explicit approval after fresh readiness. Confirmation reads after an accepted request cannot turn it into a safely retryable rejection.

Status reconciliation remains available after the merge feature is switched off, provided customer repository access is still connected. Turning the flag off does not cancel an accepted GitHub request. A read-only confirmation records the exact matching PR head and merge commit; it does not establish deployment success. No raw provider error bodies or tokens are persisted in the audit trail.

## Provider acceptance boundary

The existing private synthetic fixture draft can be probed without writes:

```sh
node --env-file=.private/local-runtime/runtime.env --import tsx scripts/merge-readiness-probe.ts REPAIR_UUID
```

The script accepts only the two existing synthetic fixture repositories, reads the local handoff and uses existing GitHub CLI access. A transport guard rejects every non-GET request and non-GitHub origin. It is a live read-contract probe, not acceptance of customer App authorization or of a real merge. It does not enable the feature, submit a GitHub review, create a passing status, mark ready or replenish compute allowances.

A real merge acceptance needs a separately approved fixture whose exact repair head has genuine passing CI and any required reviews. The current fixture is still a draft with no checks; bypassing those blockers would invalidate the acceptance. No live merge or deployment is authorized by this document.

## References

- [GitHub asynchronous merge API](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request-asynchronously): accepted and enqueued responses do not establish a completed merge; `bypass_rules` defaults false and is explicitly sent false here.
- [GitHub check runs](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference) and [commit statuses](https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference).
- [Official GitHub OpenAPI contract](https://github.com/github/rest-api-description): response shapes used for the asynchronous pending/merged/failed contract tests.
