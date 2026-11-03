<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## ShipTested delivery ownership

Codex owns the supported repository → scan → saved report → tested repair → human-approved draft PR journey. Carry changes through implementation, real checks and reviewable evidence; do not stop at UI fixtures or a green build when a provider/runtime check is needed.

- Keep findings, scope and missing coverage explicit. Shared scanner rules control the verdict; AI notes cannot change it.
- Preserve existing local work. Use isolated branches/checkouts for integration and keep private configuration out of Git and handoffs.
- Read `docs/end-to-end/ACCEPTANCE.md` and `RUNBOOK.md` for the current acceptance boundary. Record fixture, live-provider, browser and deployed evidence separately.
- Use supported synthetic fixtures for cloud acceptance. Never install or execute deliberately vulnerable fixture dependencies on the host. Paid sandbox runs require an explicit bounded approval; do not repeat an uncertain run or silently replenish its allowance.
- Exact-patch approval, merge, deployment, billing activation and repository-permission expansion retain their explicit human gates. Existing matching drafts should be reused after exact-patch approval; do not create duplicates.
- Verify changed surfaces and failure paths, then finish the relevant static/build/unit/browser checks. Keep source, package and deployment status truthful. Do not claim a customer launch from local acceptance.
