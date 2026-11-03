# Customer journey implementation and verification

This checkout builds on hosted-workflow `b5cbf08`, with selected unpublished scanner, batch, transport and repair-hardening work preserved from the two existing local checkouts. Their original files remain untouched. This document describes source behavior, not a production rollout.

## Local workspace with real HTTP and providers

Prerequisites: Node 22, npm, and PostgreSQL tools available through `pg_config --bindir` or `POSTGRES_BIN`. Run from the repository root:

```sh
npm ci
npm run local:setup
npm run build
npm run local:serve
```

Setup creates its own PostgreSQL cluster under ignored `.private/local-runtime`, listening only on `127.0.0.1:55437`. It creates `shiptested_local`, applies numbered idempotent migrations in a transaction, and provisions a synthetic two-person local workspace. Generated database credentials and operator keys are owner-readable only. Existing allowances are not reset by repeated setup.

Open `http://127.0.0.1:3157/sign-in`. Read the individual local operator keys from `.private/local-runtime/access.json` and use the team access-key form. Do not share this file. These are local operator identities, not GitHub OAuth acceptance. Public repository scans read GitHub manifests at pinned commits and query live OSV. A sequential local worker processes the queue. No hosted environment file is loaded by this command; cloud repair and billing are disabled in its generated configuration.

The PostgreSQL transport refuses hosted Vercel environments, non-loopback database addresses, database URL options, unrelated database names and non-loopback application origins. Hosted deployments continue using the existing Neon transport.

Stop the local app/worker with Ctrl-C. `npm run local:stop` stops its PostgreSQL cluster and retains local data. Re-run setup to start it again. Do not delete local data while an acceptance proposal or approval is outstanding.

## Repeatable browser acceptance

With the local app stopped and PostgreSQL prepared:

```sh
npm run test:journey
```

This starts a fresh optimized Next.js server. It tests real operator-key sign-in, live public GitHub/OSV scanning, worker processing, saved-report reload, cross-account denial, idempotent submissions, repeat comparisons, report-to-repair navigation and sign-out/re-authentication. It checks desktop/mobile in both themes with axe and overflow assertions. No browser API responses are intercepted. Password inputs and session network bodies are not traced.

Evidence is written to `test-results/journey/customer.json`, screenshots to `test-results/journey/`, and failure artifacts to `test-results/journey-browser/`. The test consumes two local scan reservations per completed run. Inspect local usage before repeating; the setup command intentionally does not replenish it. Provider failures and rate limits fail acceptance rather than being converted into a clear report.

The manual GitHub Actions workflow `customer-journey.yml` runs the same journey with its own disposable PostgreSQL service. It is manual because it depends on actual public provider availability; no recurring schedule or notification has been activated.

## Reports and repairs

- Repeat comparisons are account/workspace scoped. They compare advisory/package/dependency-path associations with the most recent earlier report for the same repository. Missing matches are not counted as resolved if either report is incomplete or their manifest coverage differs.
- A report handoff is checked on the server against the current repository snapshot, exact commit, affected package/version and supported root dependency path. A stale report or a different repository cannot silently produce a repair proposal. The source report is retained in the proposal audit event.
- Unsupported nested projects and transitive-only dependency paths do not offer a root repair. A manually chosen new repair remains available without pretending it originated from an earlier report.
- Verification checks both dependency files after install/test/build and before cleanup. Mutation, read failure, remaining advisories, failed commands or unconfirmed cleanup block approval.
- A verification request stalled for at least 15 minutes can be explicitly recorded as interrupted. This preserves failure evidence, leaves cleanup unconfirmed, and does not repeat compute or refund the lifetime allowance. A completing worker cannot overwrite that recovered state. Check actual provider cleanup before any fresh proposal.
- Publication remains an explicit approval action bound to the verified patch and evidence. An existing draft with exactly the same two changed Git blobs and pinned base is reused after fresh confirmation; ambiguity or incomplete discovery stops publication. Stale base commits are rejected; uncertain publication is reconciled through reads rather than repeated GitHub writes.

## Actual GitHub App and sandbox acceptance

Separately approved repair merging is documented in [MERGE-ACCEPTANCE.md](MERGE-ACCEPTANCE.md). It is disabled by default, uses the connected human's GitHub token, requires fresh readiness and a distinct merge approval, and never treats publication or a pending request as a completed merge. Apply migrations 013 and 014 before enabling it. No live merge is established by the earlier draft handoff acceptance.

`scripts/provider-acceptance.ts prepare` uses an existing selected-repository App grant and live OSV to prepare a report-bound proposal in the local database. It accepts only the two existing synthetic fixture repositories. It creates no remote branch/PR and executes no source code.

Load provider settings from an ignored private environment file, followed by `.private/local-runtime/runtime.env` so database writes stay local. Set `SHIPTESTED_ACCEPTANCE_ACTOR` to the existing admitted GitHub actor and `SHIPTESTED_ACCEPTANCE_REPOSITORY` to an already-authorized fixture. No installation or permission is expanded by the script.

`verify` requires `SHIPTESTED_ACCEPTANCE_APPROVED=1` after explicit budget approval. It reserves one lifetime run and requests at most two sequential ephemeral Vercel sandboxes, one vCPU and 180 seconds each, with no exposed ports. Only npm-registry fetches are permitted during installation; lifecycle scripts are disabled and test networking is denied. It checks cleanup and saves complete verification evidence privately. The run count is an execution limit, not a provider-enforced currency cap. The verification command never publishes a PR. `review` checks whether an existing open draft has the same two Git blobs and verified base. After separate exact-patch approval, `approve-existing` requires `SHIPTESTED_ACCEPTANCE_PUBLICATION_APPROVED=1` and can only record the handoff to that expected matching draft; it cannot fall back to a new PR.

Inspect the generated manifests, lockfile, command evidence, advisory rescan, cleanup and exact approval hash before separately approving draft PR publication. A successful fixture run does not prove general application security or customer onboarding.

## Hosted release gates

`scripts/check-readiness.ts` prints sanitized configuration presence. `--database` adds read-only schema connectivity checks. It never migrates, enables flags, mints tokens, starts compute or configures billing. A reachable database does not establish its lifetime, backup policy or production suitability.

Before customer activation: identify a persistent development/production database; rehearse migrations including `012_report_comparisons.sql`; verify two real browser accounts and selected-repository App authorization/revocation; supervise worker failure/recovery; complete the configured billing provider's test lifecycle if charging; review the exact release/rollback; and obtain explicit production approval. The local journey and existing green CI do not close these external gates.

## Review branch

`codex/end-to-end-readiness` is disabled in `git.deploymentEnabled` for the root web app and all three hosted platform apps. This permits source review without an automatic Vercel deployment from this branch. It does not change deployment behavior for other branches. A protected preview or production activation remains a separate reviewed action. Configuration reference: https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled .
