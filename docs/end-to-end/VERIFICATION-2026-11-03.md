# Verified development milestone — 3 November 2026

The supported dependency workflow was exercised with actual GitHub/OSV, an isolated local PostgreSQL database, the existing GitHub App grant, one explicitly approved cloud verification and an explicitly approved handoff to an existing matching draft. No merge, hosted deployment, billing activation or permission expansion occurred.

## Observed acceptance

| Check | Evidence | Result |
| --- | --- | --- |
| Static checks | `npm run typecheck`; `git diff --check` | Passed |
| Unit/database regression | `npm test` | 487 tests in 70 files passed |
| Application builds | Root Next.js, MCP app, documentation, developer portal | All four passed |
| Application browser regression | `npm run test:e2e` | 114 passed |
| Public demo across engines | Public-demo config; Chromium, WebKit, Firefox and DPR variants | 30 passed |
| Developer/docs/MCP browser checks | Platform UI config | 7 passed |
| Actual HTTP/browser customer journey | `npm run test:journey`; local PostgreSQL with live public GitHub/OSV, no intercepted API responses | Passed |
| Installable library/CLI/MCP | Packed installation and npm publish dry run | Passed; installed CLI returned Blocked with 5 findings and exit 1; MCP exposed 3 deterministic tools; nothing published |
| Actual account and private repository | Chrome signed in through the existing identity OAuth as chilu18, read the saved repair, and submitted the private synthetic fixture through its existing App grant | Passed against local application/database |
| Cloud verification | Repair `254cabe1-d3a8-40bb-8ced-f6608b3b636c`; source commit `abca9e9ffcff8f15901548e9d5f531ab86b7eeb7` | Passed |
| Exact-patch handoff | User approved the verified change; existing matching private fixture draft PR #1 was confirmed and reused | Published local handoff state; no new PR or GitHub content write |

The cloud test upgraded minimist 1.2.5 to 1.2.6. Baseline install/test and patched lockfile generation/install/test all exited 0. Both dependency files passed integrity checks. OSV matches went from 1 to 0 for the one resolved dependency. Cleanup completed; an independent project inventory returned zero sandboxes afterward. The fixture has no build command, so no fixture-build result is claimed.

Chrome verified the saved approved repair after reload and opened private report `774cfa4f-9bd9-44a5-a85a-ba0e633f37cf`, produced by actual worker job `05dd8c6d-6b84-4f51-bb0a-be845fd5056d`. The account's allowance changed from 5 to 4. The report showed the expected pinned commit, one advisory and the same earlier advisory match in comparison. The finding exposed the expected repository/report-bound repair URL. A later interactive click on that URL was rejected by browser URL policy and was not retried through another route. That particular private Chrome navigation remains unverified; automated handoff tests passed independently before the rejection.

## Failure paths covered

Database/unit tests cover owner/workspace isolation, request-key reuse, worker fencing, membership/token revocation, missing/partial provider coverage, stale repair sources, unsupported manifests, dependency-file mutation, incomplete cleanup, approval fingerprints, stale publication bases, interrupted verification recovery and changed/ambiguous matching drafts. Browser tests cover lost-status recovery, saved evidence, disabled approval, source handoff, mobile layouts, themes and automated accessibility checks. Fixture responses used by the ordinary browser suite are not counted as live provider acceptance.

Actual OAuth/App verification used one existing admitted GitHub account and existing selected-repository grants. Independent-account browser OAuth and new-customer self-service App authorization/revocation were not performed. Two distinct local operator accounts and database tests verified negative access boundaries.

## Artifacts and limits

Sanitized runtime logs, package evidence, HTTP journey JSON and screenshots are retained locally under ignored `test-results/journey/`. Private exact patches and provider execution evidence are under owner-only `.private/provider-acceptance/`; they contain synthetic fixture data and must not be mixed with credentials or published automatically. GitHub/OSV results are point-in-time dependency evidence, not application-wide security proof.

Read-only inspection of the older configured hosted database found connectivity but missing required schema. It was not migrated or used for this milestone. Persistent hosted storage, supervised recurring workers, a protected deployment, production rollback, independent customer onboarding and any Stripe lifecycle remain release work. The new manual Actions journey workflow is authored and YAML-validated; no run of that new workflow is claimed before pushing it.
