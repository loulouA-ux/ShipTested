# Hosted workflow implementation and evidence ledger

Goal: GitHub account → authorised repository → bounded scan → private saved report → team review → usage accounting and paid capacity.

## Acceptance gates (registered before implementation)

1. Identity and access: two accounts cannot read each other's private repositories, jobs or reports; tests exercise forged workspace IDs, revoked sessions and missing membership.
2. Repository ingestion: only GitHub API hosts, immutable commit snapshots, bounded supported files, no repository code execution; fixtures cover invalid URLs, private access denial, monorepos and incomplete coverage.
3. Durable jobs: queued/running/completed/failed/cancelled states; idempotent submissions, bounded retries, cancellation and recovery after worker failure; database integration tests.
4. Reports: stable authenticated URL survives a new session; source commit, scanner version and coverage visible; explicit expiring/revocable share link; anonymous and cross-account negative tests.
5. Usage: atomic allowance reservation and idempotent accounting under concurrent submissions; durable terminal outcomes; failed and partial scans distinguished from clean results.
6. Teams and audit: verified membership and role checks; invite/revoke lifecycle; append-only history for scan, share and decision actions; no secrets in event payloads.
7. Billing: server-selected plans/prices, verified idempotent webhook lifecycle, customer portal, failed-payment handling and entitlement enforcement; Stripe test-mode lifecycle evidence before activation.
8. Metrics: account-scoped usage and outcomes plus restricted operational metrics; provider cost marked estimated unless metered; no private source in analytics.
9. Clients: website, authenticated CLI and MCP use the same hosted allowance and access boundary; existing local/self-hosted usage remains possible.
10. Release: typecheck, relevant database/unit tests, builds, browser journey at desktop/mobile and independent-account access checks; production migration and deployment verified separately.

## Delivery order

- PR 1: durable jobs, usage and provenance foundations.
- PR 2: GitHub ingestion, worker execution and private report journey.
- PR 3: workspace memberships, report sharing and audit events.
- PR 4: usage dashboard, operational metrics and authenticated clients.
- PR 5: subscription checkout, webhook reconciliation and quota enforcement.
- PR 6: self-hosting/licensing documentation, browser acceptance and deployment.

## Existing licence and rights

The root and published packages currently carry MIT licences. Preserve existing copyright and licence notices. Existing releases remain available under their supplied licence; do not claim exclusivity or remove Louise's attribution.

MIT permits commercial hosted services and commercial redistribution with its notice conditions. A future network-copyleft approach (such as AGPL for appropriate new server code) needs an explicit scope and rights review before changing any licence. Do not substitute a custom noncommercial restriction and call it open source. No licence change has been made in this milestone.

References: https://opensource.org/license/mit and https://www.gnu.org/licenses/agpl-3.0.html

## Current evidence

Latest acceptance audit: 27 October 2026, 23:59 London time. The checkpoint sections below are chronological; older statements such as "not deployed" describe that checkpoint, not the latest branch.

| Gate | Current evidence | Still needed for completion |
| --- | --- | --- |
| 1. Identity/access | Local session and membership tests; protected hosted API isolation with synthetic identities | Actual second-account browser isolation (Peter browser login now verified) |
| 2. Repository ingestion | Actual GitHub/OSV public-repository scan, pinned commit and bounded manifests; private authorization implementation tested with fixtures | Real GitHub App owner/collaborator installation and revocation acceptance |
| 3. Durable jobs | Database lease/idempotency/cancellation tests; actual hosted worker completed a queued job | Always-on hosted scheduling and supervised failure/recovery acceptance |
| 4. Reports | Private report persisted and retrieved through deployed API; cross-account denial verified; sharing tests pass | Actual shared-report lifecycle (Peter sign-out/sign-in persistence now verified) |
| 5. Usage | Atomic reservation tests, actual hosted single-reservation check, eight live seat-race checks | Paid provider lifecycle and month-boundary hosted acceptance |
| 6. Teams/audit | Database invitation, removal, revocation and audit tests; atomic credential issuance regression tests | Independent-account hosted team journey |
| 7. Billing | Checkout/webhook/reconciliation implementation and database/SDK tests | US Stripe reconnection, private test configuration, checkout/portal/renewal/failure/cancellation acceptance |
| 8. Metrics | Account-scoped dashboard and operational telemetry implemented/tested; actual worker telemetry recorded | Hosted account dashboard walkthrough and recurring worker monitoring; cost metering remains unavailable |
| 9. Clients | Authenticated SDK/CLI/local MCP built and package-tested | Managed-client hosted acceptance, reviewed package release; published 0.1.0 does not include these additions |
| 10. Release | 339 unit/database tests, typecheck/build, prior browser regression coverage; draft PR 18 and protected preview | Final browser acceptance, review/integration, persistent service/database provisioning, production migration and explicitly reviewed activation |

External configuration audit: Preview OAuth secret is now configured; Preview still lacks `GITHUB_APP_CLIENT_SECRET`, `SHIPTESTED_CONNECTION_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_TEAM_PRICE_ID` and `STRIPE_WEBHOOK_SECRET`. Only presence was inspected; no credential values were displayed. Stripe connector still requires reauthentication. The disposable Neon branch expires 28 October at 23:09 GMT. Production remains demo-only. Overall completion is not yet proven.

### Foundation checkpoint

- Added idempotent allowance reservations, actor/workspace isolation, immutable commit identities, queued cancellation, worker leases, fencing and three-attempt recovery.
- Migration runner now includes ordered idempotent schema files. Migration 002 has only been exercised in local PGlite; no hosted database migration has run.
- Verified: 14 tests across `scan-jobs.test.ts` and existing `storage.test.ts`; `npx tsc --noEmit`; `npm run build`; `git diff --check`.
- No HTTP endpoint exposes these jobs yet. No worker is scheduled and no subscription or payment is activated.
- Reservation policy in this foundation counts accepted attempts, including cancellation; billing/refund policy must be connected explicitly before charging customers.

### Repository execution checkpoint

- Added GitHub URL normalisation, anonymous public-repository reads and server-bound private installation checks; pinned commit/tree identity and Git blob integrity validation; bounded manifest-only retrieval. No repository code executes.
- Supported manifest aggregation preserves per-file findings and reports skipped or unsupported formats as incomplete. Saved provenance includes repository, commit, scanner version and file coverage.
- Added authenticated enqueue/status/cancel routes, a trusted one-shot worker, and atomic fenced report persistence. Existing private report routes can read the result under the same actor/workspace boundary.
- Verified: 293 unit/database tests; typecheck; production build. Public-demo API guard now exercises 22 handlers, including all three new handlers, with no external calls.
- Live GitHub + OSV evidence: nicedeck at `2bb5203218e88f2993ec0d96dcd997d3ba86e96e`, two requirements files, four direct dependencies, zero returned findings. Local report: `../outputs/nicedeck-hosted-pipeline-2026-10-27/report.json`. This is not a hosted customer report or a whole-repository security audit.
- Still required: UI integration, scheduled worker hosting, provisioning, team lifecycle, sharing, metrics, paid entitlements and full hosted acceptance. Production remains demo-only.

### Customer scan UI and personal workspace checkpoint

- GitHub URL input, private installation option, remaining allowance, queued cancellation, polling and report links are connected to the new API routes. A job ID in the URL restores status after reload; a lost submission response reuses its request key in the mounted form.
- Reports display repository/commit provenance and scanned/omitted files. GitHub OAuth provisions a personal workspace, owner membership and five free scans without resetting usage at sign-in. Open registration requires `SHIPTESTED_OPEN_REGISTRATION=1`; this flag has not been activated on a hosted deployment.
- Verified: 294 unit/database tests, typecheck and production build; eight focused browser checks, then the strengthened two-test repository flow (including private report navigation and reload) passed. Browser APIs are fixtures; this proves UI behavior, not hosted account integration. Mobile screenshot inspected; captures retained in `../outputs/hosted-workflow-ui/`.
- Peter selected **GBP 3 per seat per month** for Team. Working allowance assumption: five repository scans per seat per month, configurable, overages disabled, AI and sandbox execution excluded. Payments remain unconfigured/test-only until verified.
- Remaining: actual scheduled worker and hosted migration, team invitations/roles and shared access, revocable report sharing, billing lifecycle, metrics dashboard, authenticated hosted CLI/MCP, and end-to-end hosted acceptance. Public production is unchanged.

### Team access and explicit report sharing checkpoint

- Targeted seven-day invitations bind to numeric GitHub identities. Only owners manage invitations/removals; accepting consumes an available Team seat atomically. Switching workspaces validates membership. Removal deletes active workspace sessions; each subsequent GitHub session check revalidates membership.
- Report owners can create/revoke seven-day read-only links. Tokens are stored hashed and are carried in the browser fragment/POST body, not ordinary request URLs. Report evidence remains owner-private until explicitly shared. Team membership alone does not expose another member's reports.
- Added workspace settings, seat display, invitation acceptance and audit history; shared-report rendering omits mutation actions. Audit rows omit tokens and are protected against ordinary UPDATE/DELETE statements by database rules (not tamper-proof against a database administrator).
- Verified: 298 unit/database tests, typecheck and build; five focused browser tests and a final three-test sharing run pass. Captures: `../outputs/hosted-workflow-sharing/`. Browser responses are fixtures; database tests exercise real PGlite/Postgres semantics.
- Not deployed. Billing must reconcile Team plan and seat limits before real customers can invite teammates. Hosted lifecycle, client authentication, metrics and billing gates remain open.

### Billing backend checkpoint

- Added Stripe SDK 23.0.1 (registry-verified version), owner-only checkout/portal routes, a bounded raw-body signature-verified webhook and a trusted reconciliation worker.
- Configured Price must be active, GBP 300 minor units per licensed seat per month and match test/live mode. Live keys are rejected without explicit `SHIPTESTED_BILLING_LIVE=1`. No automatic tax or overages are enabled.
- Signed events only mark a known customer for reconciliation. The worker fetches current subscription state, requires active status and a paid latest invoice for paid seats, and uses a lease/revision to retain events that arrive during processing. Duplicate webhook IDs do not duplicate grants.
- Payment failure/cancellation returns the workspace to free limits, preserves used scans, and removes excess seats/sessions with audit events. Membership access independently checks the current plan and seat ranking. Checkout creation uses a workspace lease, provider idempotency, existing-subscription checks and reuse of an open matching checkout.
- Verified locally: 306 unit/database tests, including real SDK signature checks, event deduplication, lease fencing, seat downgrade and preserved usage; typecheck and build. No Stripe account checkout has been executed, no webhook endpoint configured and no charge enabled.
- External gate: Stripe connector returned reauthentication required. Peter has been asked to reconnect it and choose the billing business account. Credentials must remain private. Remaining configuration: restricted test API key, GBP 3 monthly Price, endpoint secret, customer portal settings and worker scheduling. Live tax/business configuration must be settled before paid activation.
- Provider references read via Stripe CLI: https://docs.stripe.com/billing/subscriptions/overview and https://docs.stripe.com/webhooks . The skill's `/references/billing` URL returned 404; the official subscription guide was used instead.

### Usage UI and scheduler entry points checkpoint

- Added `/usage`: allowance consumption, outcome counts, saved-report verdicts, seven-day activity, scanner duration and test-mode billing actions. Members see their own outcome metrics; workspace owners/admins see workspace totals. Hosting/provider costs remain explicitly unmetered.
- Added separate private scheduler endpoints for scans and billing, with constant-time bearer checks and fail-closed missing-secret behavior. Their runtime budgets are separate. Worker telemetry records execution state/duration without exception contents. No schedule has been activated.
- Verified: 309 unit/database tests, typecheck and production build; browser usage/billing flow with mocked APIs passed and mobile rendering inspected. Captures in `../outputs/hosted-workflow-usage/`.
- Peter selected **HeySalad US** as the billing account, retaining GBP 3 per seat pricing. Stripe connector still requires reauthentication. Vercel CLI access is confirmed; local GitHub/database configuration is present. Local Stripe and scheduler credentials are absent (values were not displayed).
- Next deployment gate: configure a private scheduler secret, apply migrations to an explicitly identified development database, verify the complete authenticated workflow on a protected deployment, then review production activation separately. Do not infer a deployed scheduler from the existence of its routes.

### Authenticated library, CLI and local MCP checkpoint

- Added 30-day workspace-bound tokens, hashed at rest and shown once. Owners of tokens can revoke them; every request rechecks account admission, disabled status and active workspace membership. Read-only tokens cannot enqueue/cancel scans. Tokens do not authenticate billing, invitation or token-administration routes.
- `/team` now provides token creation and revocation, with masked display and explicit copy. Workspace switching remounts the controls and discards the displayed secret. No secrets are placed in URLs.
- The core `HostedClient` uses an explicitly configured origin, refuses redirects, bounds responses and validates report/job IDs. CLI commands `repo`, `job`, `report` and `usage` require private `SHIPTESTED_API_ORIGIN` / `SHIPTESTED_API_TOKEN` configuration. A successful `repo` command means queued acceptance, not a passing verdict.
- Local MCP exposes `scan_repository`, `get_scan_job`, `get_saved_report` and `get_workspace_usage` only with that same explicit configuration. Scan calls require a stable UUID request key. The anonymous remote MCP does not expose account tools. All scans enter the existing allowance-controlled queue.
- Verification: 315 unit/database tests, typecheck and production build passed. Tests cover token hashing, expiry, revocation, disabled users, scope restrictions, origin pinning, response bounds and in-memory MCP protocol calls. Browser checks use synthetic API fixtures; they do not prove deployed authentication.
- These additions are not deployed and package version 0.1.0 has not been republished. Migration 007 remains pending on a verified development database. Hosted acceptance, private repository onboarding, Stripe test checkout and scheduling remain open. Stripe still requires reconnection; selected business is HeySalad US, price GBP 3 per seat monthly.

### Access revocation and audit completeness checkpoint

- Shared-report reads now recheck the owner's currently entitled workspace seat, GitHub admission and disabled-account state. Membership-row existence alone no longer keeps a link alive after a downgrade or account suspension.
- Hosted queue submission, cancellation, each worker claim, terminal outcome and retry exhaustion write audit events in the same SQL statement as their state changes. Saved reports and finding decisions also write workspace events; decision reasons/source content are not duplicated into the audit table. Legacy non-workspace identities retain their prior storage behavior.
- Verified: 317 unit/database tests, typecheck and production build. Tests cover disabled owners, lost seats, idempotent queue audit entries and stale workers producing no extra terminal audit event; review events retain the original verdict.
- Added `HOSTED-OPERATIONS.md` and `OPEN-SOURCE-AND-RIGHTS.md`, plus hosted environment placeholders. Existing MIT notices remain intact. These documents distinguish published packages from branch-only functionality and identify future rights/terms decisions rather than claiming legal approval.
- Neon console inspection found only the existing main branch before development setup; no migrations were applied to that branch.

### Actual Neon database and live pipeline acceptance

- Created `hosted-workflow-acceptance`, a schema-only child of the existing Neon database, with no copied customer rows. UI branch identity: `br-crimson-silence-b77lzznj`; it expires 28 October 2026 at 23:09 GMT. Compute shown as 0.25 CU. Private connection configuration is gitignored, mode 0600; no credentials were displayed or committed.
- Confirmed zero reports/sessions before testing and applied migrations 001–007 successfully to that branch only. Main was not migrated.
- Ran `scripts/hosted-acceptance.ts` against actual Neon with synthetic account identities and live public GitHub/OSV requests. Nicedeck commit `2bb5203218e88f2993ec0d96dcd997d3ba86e96e`: four pinned dependencies, zero known advisory findings, scoped verdict Checks passed. This is not a source-code/exploitability assessment.
- Passed: idempotent allowance reservation, durable queue/worker/report persistence, cross-account job/report denial, fresh-session retrieval, explicit share revocation, read-only/revoked token denial and atomic lifecycle audit. One allowance unit consumed. Evidence: `../outputs/hosted-acceptance/database-pipeline.json`; branch screenshot: `../outputs/hosted-acceptance/neon-branch.png`.
- This proves the database/live pipeline boundary, not browser OAuth or hosted HTTP acceptance. No actual customer identity, Stripe purchase or live paid activation was used. The acceptance branch is disposable; its report IDs are not production report URLs.

### Worker revocation and protected preview configuration

- Queued GitHub jobs now check account admission/disabled state as well as membership before fetching manifests and again before saving results. Tests prove a disabled owner triggers no fetch and disabling an owner during scanning prevents report persistence.
- Verified: 318 unit/database tests and typecheck. Vercel project API confirms all previews require team sign-in; production branch is main.
- Configured only `codex/hosted-workflow` Preview environment overrides for the isolated Neon branch, scheduler secret, closed registration, test/member admission and fixed branch origin. Production environment unchanged. No schedule activated; the temporary database expires on 28 October at 23:09 GMT.

### Protected hosted HTTP acceptance

- Deployment `shipcheck-238ntsi63-hey-salad-inc.vercel.app` is READY at commit `5b36c6d`; Vercel target is Preview, not Production. Stable branch alias: `shipcheck-git-codex-hosted-workflow-hey-salad-inc.vercel.app`.
- `scripts/hosted-http-acceptance.ts` passed through the authenticated Vercel CLI into the actual deployed API, isolated Neon database and live GitHub/OSV pipeline. It verified unauthenticated API denial, queued/idempotent submission, cross-account job/report denial, scheduler authentication, deployed worker completion, report retrieval and exactly one allowance reservation. All temporary agent tokens were revoked in cleanup.
- Evidence: `../outputs/hosted-acceptance/http-pipeline.json`. These are synthetic test identities; this is not browser OAuth acceptance. The worker was invoked explicitly once, not scheduled.
- Actual browser check reached `/sign-in` on the protected branch alias. Clicking GitHub returned `GitHub sign-in is not configured.` Prepared a separate Hosted Preview OAuth registration with an exact callback and no wildcard; waiting for Peter's action-time approval and private client-secret generation. Existing local OAuth app unchanged.
- The temporary database expires on 28 October at 23:09 GMT; this deployment is acceptance infrastructure, not a customer launch. Remaining: real browser OAuth, private GitHub App customer onboarding, recurring worker hosting, Stripe test lifecycle, broader browser/independent-account checks and reviewed production activation.

### Authorized repository listing expansion

- Replaced the 100-repository rejection with fixed-path pagination for up to 200 repositories within the already-authorized GitHub App installation. Tokens still request read-only contents; installations above 200 are rejected explicitly. Changed totals, duplicated IDs and prematurely short pages fail rather than silently omitting repositories.
- Focused repository/manifest tests pass (16 tests), including a full 200-repository fixture and negative pagination cases; typecheck passes. This increases connected repository listing capacity, not scan allowance or batch-scan throughput.
- Self-service customer onboarding remains unimplemented: an installation ID supplied by a browser is not sufficient proof of access. GitHub's setup-URL documentation recommends GitHub App user authorization and checking the user's associated installations. The existing administrator-approved mapping remains until that flow, revocation checks and secret storage are implemented and verified.
- Source checked: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url . This is a separate authorization flow from identity-only OAuth; it must not silently broaden the prepared Hosted Preview login registration.
- Broad browser verification found an older test mocked a signed-in session but left the newly added usage endpoint returning a real 401. Its fixture now consistently models unavailable usage (503) alongside unavailable history. Real repository API 401s also notify the existing shared session-expiry controls; a new browser test confirms Sign out disappears after expiry. Metrics wording now describes incomplete checks without broad security language.
- Final verification: 324 unit/database tests; build and typecheck; all 66 pre-existing browser tests passed, then all three repository-flow browser tests passed including the new expiry case (67 distinct browser tests covered). Browser snapshots generated by the regression suite were copied to `../outputs/hosted-browser-regression/`; historical tracked review screenshots were preserved.

### Customer repository authorization implementation

- Added a separate GitHub App user-authorization flow with one-time browser/account/workspace-bound state and PKCE. The callback verifies the GitHub identity matches the signed-in account before persisting access.
- User tokens are AES-GCM encrypted with account/workspace authenticated data, locally valid for at most one hour, never returned to the browser and removed on disconnect. Refresh tokens are not stored; renewal is explicit. Identity-only OAuth remains separate.
- `/team` supports choosing repository installation in GitHub, authorizing access, selecting a verified installation and disconnecting. The server rechecks the user's current GitHub installation/repository access before each installation-token issuance and scopes tokens to that intersection. Read-only collaborators cannot request repair write access.
- The whole customer connection path is gated by `SHIPTESTED_CUSTOMER_REPOSITORIES`; it is disabled on the hosted deployment pending credentials, exact provider callback configuration and live owner/collaborator acceptance. Legacy administrator mappings remain in use while disabled. No GitHub permission changes were made.
- Verified: 329 unit/database tests, typecheck, build, and five focused browser checks. Tests include state replay, wrong browser/account, ciphertext moved across accounts, expiry, forged installation IDs, revocation, scoped installation tokens and read-only write denial. Screenshot retained in `../outputs/hosted-repository-connection/`. Migration 008 is applied only to the isolated acceptance branch; no production migration or activation.

### Membership revocation and concurrent billing acceptance

- Removed members now have workspace API tokens and report shares revoked, encrypted repository connections and pending connection flows removed, and queued/running scans cancelled with audit events. Re-invitation cannot revive old access; other workspaces and consumed scan allowance remain unchanged.
- Real concurrent invitation acceptance versus billing downgrade exposed inconsistent membership in 3 of 8 synthetic Neon runs. Membership acceptance/removal and billing reconciliation now use Serializable transactions with bounded retries only for database-confirmed serialization/deadlock aborts. All 8 repeated live database cases preserve seat/member consistency after the fix. Evidence: `../outputs/hosted-acceptance/seat-concurrency.json`; repeatable harness: `scripts/hosted-seat-race.ts` (requires explicit disposable host pin).
- Verification: 333 unit/database tests, TypeScript and production build passed. No production data changes.
- Registered identity-only GitHub OAuth application `ShipTested by HeySalad — Hosted Preview` (application 3970250) under chilu18 with the exact protected-preview callback and wildcard/device flow disabled. Public client ID is configured only for Preview branch `codex/hosted-workflow`. Peter must privately generate/configure the client secret before redeployment and browser sign-in acceptance. Registration alone is not verified sign-in.

### Bounded worker supervisor

- Added a sequential scan/billing supervisor with explicit database host pin, demo-mode refusal, a stop deadline within 24 hours, graceful SIGTERM/SIGINT handling, sanitized failures and no overlapping cycles. Billing work can continue when scan processing fails; billing must be explicitly enabled and configured.
- A live acceptance run against the disposable Neon branch completed one cycle with zero failures and stopped at its deadline. This verifies the runner and database telemetry path, not an always-on cloud scheduler.
- Verification: 336 unit/database tests and TypeScript pass. Focused supervisor tests cover failure recovery, sequential execution, deadline and shutdown boundaries. Hosted runtime selection and persistent scheduling remain open.

### Atomic access issuance

- Closed a membership-removal race in agent token creation, report-share creation and GitHub App authorization callback persistence. Each now checks active seat/plan membership inside its Serializable write transaction, not only during request preflight. If removal completes first, no credential/share is saved; if issuance completes first, the existing removal transaction revokes it.
- Regression tests remove membership between preflight and persistence (and during the provider exchange) and prove no token/share/connection survives that gap. Verification: 339 unit/database tests, typecheck and production build pass.
- Preview `shipcheck-bykntci46-hey-salad-inc.vercel.app` at `8ac70f6` was confirmed READY. This precedes the atomic-issuance fix; hosted acceptance of the new fix is separate from local tests. OAuth secret and Stripe authentication remain external activation gates.

- Repeated protected HTTP acceptance against `shipcheck-79yt4ox0c-hey-salad-inc.vercel.app` did not finish through the Vercel CLI transport and exited unsuccessfully at its request timeout. No new scan was observed in the test identity's queue. Cleanup was verified: zero unrevoked `Disposable HTTP acceptance` tokens. The earlier successful hosted evidence is retained as historical evidence, not proof of this retest. The harness now reports only fixed request stage and safe error category to distinguish transport failures from assertions.

### Hosted HTTP retest recovered

- The protected preview was reachable through a direct Vercel CLI request. Replacing curl's stdin configuration with a mode-0600 file in a private temporary directory resolved the acceptance harness transport hang; cleanup removes the temporary configuration in `finally`. Secrets remain outside process arguments and logs.
- Actual HTTP acceptance PASSED on `shipcheck-pa9wpykrj-hey-salad-inc.vercel.app` at `f9b7cbb`: anonymous denial, authenticated queue, idempotent request, cross-account job/report denial, scheduler authentication, worker completion, saved report retrieval and exactly one allowance reservation. Synthetic token cleanup runs after acceptance.
- Evidence: `../outputs/hosted-acceptance/http-pipeline.json`, verified 27 October 2026 at 23:58 London time. Job `d166bbde-719a-4e34-8047-faffae05d440`, saved report `063931e6-ec77-49c2-86c2-afe0b9d44184`. This uses actual Neon/GitHub/OSV with synthetic authenticated identities; browser OAuth, Stripe and customer GitHub App onboarding remain unverified. Production remains demo-only.


### Hosted identity OAuth configuration

- Peter supplied the OAuth secret privately through the clipboard; it was stored as sensitive `GITHUB_CLIENT_SECRET` only on Preview branch `codex/hosted-workflow`, without printing its value. Production was unchanged.
- Redeployment `shipcheck-l395z0wlx-hey-salad-inc.vercel.app` is READY with Preview target. The stable branch alias reaches GitHub authorization for the expected client ID and exact callback, requesting only `read:user`.
- Browser authorization is pending Peter's action-time confirmation or his own click. The secret exchange, callback session, personal-workspace provisioning and sign-in acceptance are not yet verified. Do not mark the identity gate complete from the authorization screen alone.


### Real GitHub account browser acceptance — 28 October 2026

- Peter approved identity-only OAuth authorization. GitHub granted read-only profile access to the hosted-preview app and the callback established a session displayed as `chilu18`. No repository permission was granted by this OAuth step.
- Through the actual browser, Peter's account queued `heysalad-ai/nicedeck` at commit `2bb5203218e88f2993ec0d96dcd997d3ba86e96e`; remaining monthly allowance changed from 5/5 to 4/5. Job `a59cf3df-6b7a-47ad-bcf5-02ed5e53cb28` completed through the deployed worker, invoked manually with private scheduler authentication.
- Saved private report `db816723-86c4-48e3-bd4a-29c8158838e5` opened in the browser with source commit and coverage. Two manifests, no omitted supported manifests, zero returned findings; this is bounded dependency scanning, not a complete repository security assessment.
- Signed out and loaded the exact report URL: UI displayed Report unavailable. Signed in again via GitHub and reopened that same report successfully. One saved scan remained visible; the account/session/report persistence path is now hosted-browser verified for Peter.
- Screenshot: `../outputs/hosted-acceptance/github-account-report.png`. Remaining independent gates include a second actual account, shared-link lifecycle, customer GitHub App onboarding, Stripe lifecycle and continuous worker hosting. Production remains unchanged; the test database remains disposable.

### Hosted sharing and audit acceptance — 28 October 2026

- `scripts/hosted-sharing-acceptance.ts` passed against the isolated Neon database and protected deployed `/api/shared-report` endpoint. A synthetic report share returned the correct report with `readOnly:true`; invalid and revoked tokens returned 404. Both creation and revocation audit events were persisted, and sharing consumed no scan allowance.
- The share token stayed in process memory/private temporary request configuration and was revoked in cleanup. No bearer link was logged or added to this document. Evidence: `../outputs/hosted-acceptance/sharing.json`.
- This verifies actual database creation/revocation plus the deployed HTTP reader. It does not substitute for the browser share creation/consumption walkthrough. Browser control became unavailable with “Local browser use is disabled in Work settings”; no alternate automation was used to bypass that setting. Usage dashboard and team browser acceptance remain open.

### CLI retry identity

- Added `repo --request-key UUID` and output of generated request keys before network submission. Operators can retry the same submission across separate CLI processes without creating a new allowance reservation. Duplicate/invalid flags fail before a network call.
- Built packages and typecheck pass; eight focused CLI/client tests pass, including actual compiled CLI invocations that verify the same request key reaches the transport twice and stdout remains JSON. Existing server idempotency was separately verified against the protected hosted API. No npm publication performed.

### HeySalad batch capacity preparation — 28 October 2026

- Raised only `github:7957943`'s current-month allowance on the isolated acceptance database from 5 to 500. Readback retained one reserved attempt and showed 499 remaining. No new scan was submitted, no billing/seat change was made, and the database expiry was not extended.
- Local implementation supports five-page/500-repository installation and user-grant listing, with existing authorization checks. Added CLI batch planning, sequential paced submission, durable request-key resume, process locking and job/report status refresh. Migration 009 preserves requested authenticated access and makes retries return the originally pinned job before resolving a moving branch. Public repositories can retain explicitly requested installation authentication in the worker.
- GitHub CLI inventory found 215 `heysalad-ai` repositories, including 79 private. The existing local GitHub App mapping listed one repository, none under `heysalad-ai`; CLI visibility does not grant the app access. Prepared a private 215-entry plan with zero submissions. No other organization was assumed to belong in scope.
- Verification: production build and TypeScript passed; full suite passed 350 tests, then a new real-PGlite 350-job allowance boundary test was added and the three-test capacity suite passed. Batch fixture tests exercise 350 submissions, lost responses/restarts and terminal states; pagination tests cover 500 repositories and 501 rejection. This is not proof of live 300-repository throughput.
- Fresh browser opening for allowance UI confirmation returned `Local browser use is disabled in Work settings`; no alternate browser-control mechanism was used. Database readback is the live allowance evidence.
- Changes remain local/unpublished. Migration 009 is not applied to the hosted database, and no new worker or deployment was activated. Prior restrictions on deployment and repository-permission changes remain respected. See `BATCH-SCANNING.md` for activation requirements, commands and limitations. The disposable database still has the previously scheduled 28 October 23:09 London expiry.


### End-to-end development acceptance — 3 November 2026

The supported workflow now has current local PostgreSQL/HTTP/browser evidence, actual identity OAuth and existing selected-repository access, an approved sandbox repair and approved exact-draft reuse. See `docs/end-to-end/VERIFICATION-2026-11-03.md` for commands, counts, source identities, artifacts and limits. Original hosted infrastructure was not migrated or deployed. Earlier checkpoints remain historical; they are not claims of current customer or production readiness.
