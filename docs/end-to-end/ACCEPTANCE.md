# ShipTested end-to-end acceptance

Registered 3 November 2026, before implementation in this checkout.

## Objective

A supported npm repository can be connected, scanned at a pinned commit, reopened as a private report, understood with explicit coverage, handed to a supported repair, verified in isolated compute, and published once as an explicitly approved draft PR. Existing source work is preserved; production, payment activation and publication require separate action-time approval.

## Proof required

- [x] Clean static/type checks, package builds, application builds and full relevant unit/database suites pass.
- [x] Actual HTTP/browser journey: sign in, submit repository, durable worker completes scan, open saved report, reload and reauthenticate without losing it. Live GitHub/OSV evidence is distinguished from fixture-only paths.
- [x] Negative paths: another account cannot access job/report/repair; revoked access blocks use; duplicate submission consumes one allowance; worker interruption/cancellation cannot produce duplicate persistence or a false completion.
- [x] Reports expose source commit, date, scanned/skipped inputs, incomplete checks, dependency path and an actionable supported repair handoff. Desktop/mobile, light/dark and keyboard/accessibility checks include screenshots.
- [x] Supported repair checks the scanned commit, exact dependency and advisory evidence; baseline/patched commands, regenerated lockfile, artifact integrity, post-repair scan and cleanup are required before approval. Failed/missing checks block publication.
- [x] Publication uses the exact approved evidence and creates only a draft; stale source and uncertain publication are handled without blind duplicate writes. Actual external publication remains a separate human approval.
- [x] Repeat scans show comparable new/resolved/unchanged advisory evidence without treating incomplete coverage as proof of resolution. No unsolicited external notifications.
- [x] Operating readiness checks identify database/migration lifetime, worker configuration, provider grants and explicit activation limits without printing credentials or changing production/billing.
- [x] Current setup/docs describe implemented behavior and distinguish local/fixture/provider/deployed evidence. Final report lists every unverified external gate.

## Starting source

Integration began from local hosted-workflow de32cea and was reconciled onto the newer GitHub PR #18 head b5cbf08. Selected unpublished scanner, transport, batch and repair-hardening work was retained; conflicting older UI variants were superseded by the newer committed implementation. Original checkouts remain untouched. Live provider settings were loaded privately, and a fresh development OIDC file was downloaded into an ignored owner-only directory for the approved cloud run.

## Completion scope

These checks close the development milestone, within the observed scope and limitations in [the dated verification report](VERIFICATION-2026-11-03.md). They do not mark hosted production, billing, new-customer self-service onboarding or the browser-policy-blocked private navigation as complete.
