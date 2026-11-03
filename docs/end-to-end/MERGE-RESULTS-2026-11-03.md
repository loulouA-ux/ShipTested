# Merge workflow verification — 3 November 2026

The separately approved merge workflow is implemented in source and disabled by default. No live merge, draft-state change, check/status creation, repository permission expansion, paid compute run or deployment was performed for this milestone.

| Criterion | Observation | Result |
| --- | --- | --- |
| Regression checks | `npm test`: 536 tests in 72 files; `npm run test:e2e`: 122 browser checks | Passed |
| Build/static checks | `npm run build`; `npm run typecheck`; `git diff --check` | Passed |
| New merge browser flow | 8 checks for explicit approval, double-click protection, pending reload, uncertain recovery, blockers, feature-off state and theme/viewport variants | Passed |
| Mobile/desktop accessibility | axe on merge controls, no horizontal overflow; dark/light at 390px and 1280px | Passed; screenshots retained locally |
| Exact patch and actor boundaries | Database/provider contract tests reject changed head/base/target/files/commit ancestry, missing approval, other owners/workspaces, lost write access and missing user connection | Passed |
| Current checks/reviews | Pending/failing/absent/incomplete checks, unknown mergeability, draft state, requested changes and unsupported repository settings block submission | Passed with provider fixtures |
| Duplicate/racing requests | Two concurrent approvals produce one merge write; stale reconciliation cannot overwrite a new attempt | Passed against PGlite transactions and synthetic provider transport |
| Async outcomes | Pending, merged, failed and uncertain remain distinct; timeout/conflict/error never automatically repeats a write | Passed with official API response shapes in fixtures |
| Accepted write followed by read failure | A 403 while confirming an accepted merge remains uncertain; it is not eligible for safe retry | Passed |
| Real HTTP boundary | Local Next.js/PostgreSQL/operator session: eight expected 400/401/403/404 denials, including cross-origin, another owner and missing explicit confirmation | Passed |
| Real GitHub read contract | Existing private fixture draft #1, head `72bff84011c6697d51660de71b4aaf84a69937e2`; 11 API reads, 0 remote writes | Correctly blocked: draft and no passing GitHub checks |
| Local schema | Applied migration 013 through isolated runtime setup; read-only readiness confirmed required tables | Passed locally; hosted schema unchanged |
| Actual customer App merge authorization | Current human token path is covered by encrypted connection, identity, membership, selected-repository and permission tests | Live provider acceptance not performed |
| Actual GitHub merge | Existing fixture is not eligible; no write approval requested or consumed | Not performed |

The live read-only probe used existing GitHub CLI access and actual API responses. It did not exercise the customer's connected GitHub App token. Successful merge submissions and their async outcomes were tested through the real server service/database logic with a synthetic provider transport; the browser suite used intercepted application API responses. These are different evidence levels.

The test fixture for confirmation-read failure initially hung because the test cloned a streaming error response and then cancelled only one side of the tee. Returning the single response fixed the harness; the targeted checks and full suite passed afterward. No timeout threshold or safety assertion was weakened.

A later full run exposed database WASM startup exceeding the migration test's five-second budget under concurrent workers. Startup now runs in the fixture setup hook; the timed test still applies every migration twice, with the same timeout, and additionally verifies the merge table and required UUID attempt column. This fixes the setup boundary rather than extending the migration assertion's time limit.

Evidence remains in ignored `test-results/merge/` and `/tmp/shiptested-merge-*.log`. Browser images use illustrative commit hashes and synthetic repository responses. They are UI verification, not screenshots of a real merge.

The implementation sends an exact head SHA and explicitly disables GitHub rule bypass. A base read is point-in-time; GitHub's merge API does not offer an atomic expected-base parameter. Repository protections are evaluated by GitHub at execution. Queue-required and stacked workflows remain outside the supported direct-squash path.

Before enabling: review/apply the schema in the target development environment, verify existing customer App permissions without widening grants silently, and prepare an eligible synthetic PR with genuine passing CI/reviews. A live fixture merge requires a separate explicit approval of its exact PR/head and deployment consequences. Production activation remains separate.
