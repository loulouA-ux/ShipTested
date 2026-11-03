# HeySalad batch scanning

## Capacity and activation status — 28 October 2026

The isolated hosted-acceptance workspace `github:7957943` has 500 attempts for October 2026 UTC, with one existing reservation and 499 remaining. This is a current-month test allowance, not a permanent entitlement. Peter approved retaining the acceptance database; Neon now shows expiry **Never**.

The separate **ShipTested HeySalad Read Only** App (5504276), installation 176025952, is installed on exactly the approved 215 `heysalad-ai` repositories (79 private), with Contents/read and Metadata/read. The saved UI selection was compared against the plan: no missing or extra repositories. Identity OAuth remains `read:user`.

The batch API is deployed on the protected preview at `shipcheck-8m6sb5sdm-hey-salad-inc.vercel.app`, reached through the stable branch alias. Migration 009 is applied to the verified acceptance branch. Authenticated live dry-run: **215 authorized, zero missing, zero submitted, 499 remaining, ready=true**. Read-only worker readiness passes; all four existing database jobs are completed, with none queued/running. The CLI is built locally, not published to npm. Existing local changes remain uncommitted.

**Temporary worker prepared:** Peter selected this Mac. The manual launcher `.private/mac-worker.sh` passes live read-only readiness checks and remains stopped. Actual scan execution has not been tested. No scans were submitted or consumed. Only 215 repositories were inventoried; no other organizations are included and no live 300-repository scan is claimed.

## Preparing a batch

Build from this checkout with `npm run build:packages`. The published 0.1.0 CLI does not contain this command.

Supply a JSON array of explicit repository selections:

```json
[
  {"repository":"heysalad-ai/example","privateAccess":true}
]
```

For a large organization batch, use `privateAccess:true` for public repositories too, **after** authorizing those repositories in the existing GitHub App. This selects authenticated, read-only installation access at discovery and worker fetch time; it does not make a public repository private or grant access. Anonymous public GitHub requests are not an adequate transport for hundreds of repositories.

Configure `SHIPTESTED_API_ORIGIN` to the intended hosted service. Plan generation requires no API token and submits no work:

```sh
node packages/cli/dist/index.js batch plan repositories.json batch-plan.json
```

A 215-repository plan for the current HeySalad inventory is prepared under `.private/heysalad-batch-plan.json`. It selects authenticated access for every entry and requires the GitHub App authorization described above. The plan contains no token. Treat repository names and job IDs as private operational data.

Plans accept 1–500 unique repositories. They contain immutable per-entry request keys and an explicit origin. Do not edit, recreate or delete a plan after submitting any of it. Use a new plan only for an intentionally new scan cycle. The `.github` organization repository is valid; unsupported dependency formats are still reported as incomplete.

## Submit and resume

Use a privately configured scan-capable `SHIPTESTED_API_TOKEN` belonging to the intended workspace/account. Do not put it in command arguments, URLs or Git. Use the same account and workspace for the entire batch. The CLI requires application authentication independently of Vercel deployment protection. This command does not bypass Vercel protection; use a properly authenticated transport or an approved hosted endpoint before submission. Do not disable protection to make this work.

```sh
node packages/cli/dist/index.js batch submit batch-plan.json
node packages/cli/dist/index.js batch status batch-plan.json
```

Submission is sequential with at least four seconds between attempts, below the existing 20-per-minute discovery limit. Every acknowledgement is saved atomically. A network, authorization, provider, quota or service error stops submission. Resume the same command with the same plan after fixing the cause; accepted entries are skipped and uncertain entries reuse their request keys. The server returns the originally pinned job even if the default branch moved. Completed/failed/cancelled entries are not resubmitted automatically.

A `.lock` file prevents two processes submitting the same plan simultaneously. After a process is killed, verify it has stopped before removing its stale `.lock` file. Never delete the plan itself to recover a lock.

`batch status` refreshes each accepted job and saves its state, failure code and private report path. A successful submission exit means queued acceptance, not completed analysis. A completed job is not a clean verdict: open the report to inspect findings and coverage. Failed and unsupported repositories must not be counted as clean.

## Worker and database

The existing `scripts/hosted-worker.ts` processes one job per cycle with leases, fencing, bounded retries, an explicit database-host pin and a stop time within 24 hours. It needs the same GitHub authorization as submission. It does not execute repository code. Use a trusted persistent host and private configuration; observe job backlog, provider limits and worker telemetry. A local terminal that exits or sleeps is not an always-on service.

Before deploying this version, apply `migrations/009_batch_retry.sql` to the intended database after the existing migrations. It records requested authenticated access independently of repository visibility. Deploy the API and worker together so retry handling and authenticated public fetches agree. Migration 009 has now been applied to the explicitly verified acceptance branch; see activation evidence below.

The operator-only command below sets a current-month test limit of 301–500 for an existing free workspace with the specified GitHub owner, preserves reserved attempts, never lowers an existing allowance, and writes a workspace audit event. It requires `DATABASE_URL` plus a matching `SHIPTESTED_WORKER_DB_HOST`. It does not configure billing or change repository permissions.

```sh
node --env-file=.env.hosted-acceptance --import tsx scripts/set-test-capacity.ts github:7957943 github:7957943 500 --apply
```

Peter approved retaining the isolated acceptance branch and its expiry was removed. Do not move this setup to another database implicitly. Month-boundary test allowances must be deliberately provisioned; this one-off grant does not change the default five-scan free plan.

## Acceptance

See `tests/batch.test.ts` (350 submissions, restart/lost response, input limits and terminal states), `tests/github-repositories.test.ts` and `tests/repository-connections.test.ts` (500-repository listing/access boundaries), `tests/test-capacity.test.ts` (owner-scoped allowance with preserved usage), and `tests/scan-jobs.test.ts` (original-source retries and authenticated public fetch selection). Live 300-plus-repository throughput is not proven by these fixtures.

GitHub documents a maximum of 500 explicitly selected repositories per installation access token: https://docs.github.com/en/rest/apps/apps?apiVersion=2026-03-10#create-an-installation-access-token-for-an-app . This limit does not authorize any repository that the installation cannot already access.

## Protected preview operator commands — activation follow-up

The local CLI now supports `SHIPTESTED_VERCEL_TRANSPORT=1`. This opt-in transport is pinned to the exact approved branch preview and invokes the signed-in Vercel CLI with a temporary mode-0600 curl configuration. It retains the separate ShipTested bearer token, refuses redirects and removes temporary credentials after each request. Deployment protection stays enabled. The prepared `.private/batch-client.env` holds the private operator configuration; do not copy it into source control or shell arguments.

From the repository root, inspect without submitting:

```sh
node --env-file=.private/batch-client.env packages/cli/dist/index.js usage
node --env-file=.private/batch-client.env packages/cli/dist/index.js batch dry-run .private/heysalad-batch-plan.json
node --env-file=.private/batch-client.env packages/cli/dist/index.js batch status .private/heysalad-batch-plan.json
```

Only after authorization and worker readiness, Peter can deliberately start or resume with the same command and same plan:

```sh
node --env-file=.private/batch-client.env packages/cli/dist/index.js batch submit .private/heysalad-batch-plan.json
```

No submission is performed by setup or dry-run. Dry-run reports `ready` only for repository access and current allowance; it does not prove that a worker is running. There are 215 inventoried repositories (79 private), not 300. Do not extend this selection to another organization implicitly.

The original App, `shipcheck-heysalad-dev-repairs` (5472303), requires write permissions and must not be used for this read-only batch. The separate App `shiptested-heysalad-read-only` (5504276), owned by chilu18, has only contents/read and metadata/read. Its API identity and downloaded signing key were verified together. Identity OAuth remains separate and unchanged at read:user. Preview uses an explicit operator-approved actor/installation mapping; self-service customer repository authorization remains disabled and is not claimed as accepted.

Migration 009 was applied only to Neon project `odd-math-86003251`, branch `br-crimson-silence-b77lzznj` (`hosted-workflow-acceptance`), endpoint `ep-calm-firefly-b7vxyree`. The column is non-null; allowance stayed 500/1. Peter subsequently approved retaining this isolated branch, and Neon showed expiry Never. The production main branch was not changed.

`scripts/batch-worker-readiness.ts` performs read-only schema, App access, queue and allowance checks. It never claims jobs. Peter selected this Mac as the temporary worker host; no always-on service or scan execution is implied by a successful readiness check. The bounded worker still requires an explicit stop time within 24 hours.

## Temporary Mac worker — prepared, stopped

Use this checkout and the existing private environment files. `.private/mac-worker.sh` is executable only by its owner, uses a clean environment, pins the acceptance database via the existing worker configuration, restricts member admission to GitHub ID 7957943, and disables billing. No login item, launch agent, background service or automatic startup is installed.

Safe readiness check (also the default when no argument is supplied):

```sh
.private/mac-worker.sh check
```

When Peter deliberately chooses to start scanning, keep the Mac plugged in with its lid open. In terminal one, start the worker:

```sh
.private/mac-worker.sh start
```

This first repeats the read-only readiness check, then runs the existing worker in the foreground with an eight-hour deadline and `caffeinate -i` to prevent idle sleep. An existing `.private/mac-worker.lock` blocks duplicate launches through this launcher. Use Ctrl-C to stop. If a crash leaves a stale lock, verify no worker remains before removing that empty directory. The worker does not automatically restart after interruption or reboot. A lid close or loss of network can still interrupt work.

In terminal two, use the documented `batch submit` command to start/resume the same plan, and `batch status` to inspect it. The start command consumes queued acceptance jobs; it was **not run** during preparation. The acceptance database is shared with the existing acceptance jobs, so the worker is not a batch-only queue consumer.

Preparation verification: shell syntax and invalid-command rejection passed; TypeScript check passed; live readiness found 215 authorized repositories, no missing selection, active account/membership, all four existing jobs completed, allowance500/reserved1. No worker process was running. Full scan execution remains deliberately untested.

## Authorized empty-repository skips — 28 October 2026

The first submission stopped on GitHub's HTTP409 `Git Repository is empty.` response for `heysalad-ai/chrome`, after five accepted scans. Peter explicitly authorized skipping empty repositories and resuming. A read-only App check of all210 unsubmitted repositories confirmed eight empty repositories: `1`, `chrome`, `donzo`, `heysalad-agents`, `irene-platform`, `reimagined-potato`, `securemcp`, and `voice` (all under `heysalad-ai`).

The original plan retains all215 entries and request keys. These eight entries now have `state: skipped`, `skipReason: empty_repository`, and `skipCheckedAt`; no job IDs or allowance reservations were created for them. The preflight checked database request keys before marking skips so an already-accepted but unacknowledged job could not be skipped. A private before-edit backup is retained. Skips remain skipped when resuming this plan even if those repositories later acquire commits; a new scan cycle requires deliberate operator action.

The local CLI validates skip evidence, excludes skips from submission and required allowance, and reports them separately in status/results. Other errors still stop submission. Five jobs were already accepted and202 remained at resume; this is207 possible scans plus8 skips, not215 completed scans. Monitoring uses database state without competing for the submission plan lock. Full355 tests, package build, and TypeScript checks passed for this change.

## Live batch dashboard

Open `/batches` on the protected branch preview and sign in as the batch owner (`chilu18` for this batch). The page displays all215 selected repositories, including8 verified empty skips and repositories not yet accepted by the submission API. It refreshes every5seconds while visible, supports repository search and state filters, and links completed jobs to their private reports. Completion is distinct from the report verdict. Refresh failures retain the last successful data with an explicit stale warning; authentication loss removes private rows.

Migration010 adds `sc_batch_plans`, a private selection manifest. The operator registered only repository names, stable request keys and verified skip annotations from the existing plan. Registration does not submit jobs or reserve allowance. `/api/batches` returns the latest manifest for the authenticated workspace AND owner, joining current job/report state with the same scope. Request keys and credentials are never returned to the browser. Waiting means not accepted by the API; it does not imply the submission process is still running. This dashboard does not start, retry or cancel scans.

## Response-size failure correction — 28 October 2026

The second submission stop was reproduced on `heysalad-ai/wiki-documents`: the GitHub REST commit response included file diffs and exceeded the generic1MB JSON limit. Discovery now resolves the default-branch Git ref, then fetches the compact Git commit object, validating both identities. Pinned worker reads use the same compact Git commit API. Tree discovery has an explicit8MB response budget (GitHub documents up to7MB for recursive trees); the existing10000-entry,20-manifest,500KB-per-file and2MB-total-content limits remain. Other provider responses remain bounded to1MB. The repository deadline is now preserved alongside per-request timeouts.

Read-only reproduction of the four original failures found the same1MB limit on tree responses. With the corrected reader, `videobase-stripe-server` (6489 entries) and `open-webui` (4767 entries) pass manifest discovery. `videobase-image-bridge` (10992 entries) and `cartbase` (15564 entries) exceed the existing10000-entry bound. These four terminal jobs were not retried or relabeled. Future explicit422 discovery rejections are recorded as `unsupported_repository`, without storing provider bodies.

The fix was deployed only to Preview; the Mac worker was gracefully restarted with its original11:35:47 London deadline. Peter authorized resuming the remaining170 entries with the original plan, all215 request keys preserved and eight verified empty skips retained. The CLI now reports the affected repository and HTTP status for HTTP submission errors without exposing raw provider details.

### Advisory coverage correction (28 October 2026)

The original strict OSV lookup discarded all findings when any batch exceeded twelve distinct advisories or a later lookup failed. Live reproduction on saved exact dependencies confirmed successful OSV responses followed by this advisory-budget exception. Repository worker version0.1.1 now uses evidence-preserving lookup: up to5,000 exact packages,200 distinct advisory-detail requests and2,000 findings per manifest; concurrency3;120-second per-manifest budget within the existing180-second repository budget. Validated findings survive partial failures, with queried/retrieved counts and explicit gap codes. Strict `queryOsv` callers retain their previous all-or-nothing contract. Advisory cache remains memory-only and bounded, with original retrieval dates and one-hour expiry.

The Mac worker was gracefully replaced at a job boundary while the original submission process continued. Empty skips, request keys, failed jobs and allowance accounting were preserved. A separate authorized correction pass refreshes32 historical reports from already-recorded exact dependencies, stores new report revisions, preserves original records and atomically updates only the matching completed job's report pointer. It creates no jobs or allowance reservations. The private process metadata is `.private/advisory-refresh-run.json`, with progress/log/exit files alongside it. The correction and worker retain the11:35 London deadline. The existing monitor covers both processes.

This does not manufacture complete coverage: absent supported manifests, unpinned dependencies, unsupported ecosystems/lockfiles, oversized files and discovery bounds still remain explicit gaps. High-severity advisory matches produce Blocked even if other coverage is incomplete; they do not prove application-level exploitability. Source-code execution/audit and Git history are outside this scanner's scope.

### Protected transport resume at agent404

At04:57:24 London the submitter exited64 with146 entries acknowledged and61 pending. Preview request logs show the preceding POSTs returned202; no API rejection for the next attempt was recorded. Read-only resolution of agent404 and authenticated protected-alias checks succeeded. The original transport exception was masked, so a timeout/deployment-switch trigger cannot be proven retrospectively.

The CLI now allows60seconds for the Vercel transport (curl remains45seconds, process55seconds), instead of aborting the wrapper at30seconds. Safe transport error categories identify timeout, connection, command or response failures without printing stderr/credentials. Batch submission retries only classified transient transport failures or HTTP502/503/504, at most three attempts with5/15second backoff, always using the saved request key. Permanent/unknown errors stop; jobs with IDs and skipped entries are untouched. No protection change or server/production deployment is needed for this CLI fix.
