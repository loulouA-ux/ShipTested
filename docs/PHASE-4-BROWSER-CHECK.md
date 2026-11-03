# Phase 4 browser verification — 24 October 2026

Observed by Peter's Codex around 17:52–18:00 Europe/London using the computer-use browser driver. This is a partial acceptance record, not completion of P7/L4.

## Hosting and protection

- Vercel overview confirms Production deployment `shipcheck-nj5xg0pt8-hey-salad-inc.vercel.app` is Ready from main merge `a165fbc`. Production alias: `shipcheck-rho.vercel.app`. Pushing main updates Production.
- Existing Vercel Authentication was Legacy Standard Protection, excluding the current Production domain. Changed and saved to **All Deployments**, with Require Log In checked, to enforce Peter's protected-only requirement.
- A request without cookies to the Production root returned HTTP 302 to vercel.com after the change. An authenticated browser can still view it. No active shareable links or domain exceptions were displayed.
- Project environment list shows provider/member credentials and Neon configuration scoped to pre-production, not Production. Production live operation is not configured or accepted. No secret values were revealed or copied.

## Member flow on protected preview a0fe6d1

- Existing stale page showed Peter signed in after session expiry. Decision submission was correctly rejected with “Sign in to run live scans.” Reload cleared the stale member display; fresh private login succeeded. Follow-up: proactively clear stale session UI on a 401 and offer sign-in without implying a saved decision.
- Loaded the 24 October 01:04:30 synthetic saved report with two dependencies and ten findings.
- Saved a labelled synthetic acknowledgement and dismissal on the CSP finding. Each appeared in decision history with timestamps 17:56:45 and 17:57:01.
- Blank reason disabled dismissal. Keyboard navigation from note through acknowledgement to dismissal, then Enter, recorded the dismissal.
- At 390 × 844, evidence, note field, controls and history were readable. This sampled view is not a full accessibility audit. Temporary viewport override was reset.
- Reopened report after reload; verdict still Review required. After a separate fresh login, both acknowledgement and dismissal were read back from the saved finding history, confirming persistence across sessions.
- Sign-out cleared member view and returned the sign-in link.

## Vercel Sandbox assessment

Official documentation: https://vercel.com/docs/sandbox and https://vercel.com/docs/sandbox/concepts/firewall . Sandbox isolates execution in Linux microVMs. Default network policy allows outbound traffic; restricted allowlists or deny-all must be configured explicitly. Persistence/snapshots can retain files after a run, so ephemeral cleanup is required for this test.

Proposed first run: exact reviewed ShipCheck source, no .env files, member keys, database credentials or provider tokens; fixed resource/time limit; install only lockfile dependencies with scripts disabled from approved package sources, then deny outbound traffic for unit tests; stop and remove temporary artifacts. This tests ShipCheck itself. It does not introduce execution of customer-uploaded code into the scan pipeline.

HeySalad Inc is on Pro; Sandbox is metered. A £1 maximum one-off test approval was requested and is pending. No Sandbox was created or started in this verification pass.

## Still open

- Budget approval and actual isolated cloud test execution.
- Session-expiry UX fix and regression verification.
- Complete P7 security acceptance against the agreed checklist; earlier tests remain dated evidence, not a new run here.
- Louise's independent full member walkthrough and core-freeze decision.
- Production provisioning/public judging access remains deferred.

## Completed cloud Sandbox test — 24 October, 18:29–18:32 London

Peter approved a one-off test up to £1. Created `shipcheck-phase4-20261024` under HeySalad Inc / shipcheck: 2 vCPU, 4 GiB, 10-minute maximum, ephemeral, no mounted drives or published ports. Uploaded a Git archive of exact commit e3e08a7, excluding ignored private files and real environment files. The managed universal image provided Node 24.22.1; this differs from the earlier Vercel Node 22 acceptance environment.

Installation allowed only registry.npmjs.org and used `npm ci --ignore-scripts --no-audit --no-fund`. Then network policy was changed to deny-all and read back. An outbound HTTPS request failed under this policy.

Results inside the cloud microVM:
- 126 tests passed across 11 files.
- Typecheck and Next.js production build passed.
- Local-only production server smoke: demo HTTP 200, three findings, Blocked verdict; invalid schema HTTP 400; valid-shaped anonymous live scan HTTP 401.
- Initial smoke incorrectly expected 401 for a malformed live request; it correctly returned 400. Corrected the harness to assert both schema validation and authentication separately, then reran successfully. No application change was needed.

Stopped after 146.22 seconds; active CPU 80.573 seconds. Vercel displayed estimated compute list price $0.0063 (estimate, not final invoice). Removed the temporary sandbox; list including stopped sandboxes returned no entries. No snapshot or drive was created. No app deployment or customer-code execution was introduced.

Proposal for partner review: use this bounded cloud test pattern for pre-merge regression checks, initially manual, then consider CI after agreeing a recurring budget. Keep sandbox creation in trusted tooling; do not pass production secrets to the workload. A separate scope and threat-model review is required before running any customer-submitted code. This test demonstrates isolation and passing checks, not absence of all vulnerabilities or Phase 4 completion.
