# @heysalad/shiptested

Deterministic dependency checks shared by ShipTested web, CLI and MCP. ESM; Node20+; no telemetry or side effects on import. The 0.1.0 release was recorded on 27 October 2026. This source checkout contains unreleased improvements; build from source to evaluate them.

`scan({lockfile,filename:'package-lock.json'},{onStage,signal,osv:{cache}})` returns a masked report. Stage callbacks reflect actual work; they are not timer-based progress. Callback errors propagate. Invalid input throws; incomplete OSV coverage produces Incomplete, never a clean result. A detected high-severity finding remains Blocked even if other coverage is incomplete.

The transport permits only HTTPS api.osv.dev, refuses redirects, caps each response at1MB, batches100 packages, and bounds partial-evidence scans to 200 distinct advisory-detail requests and 2,000 findings. Already verified findings remain visible when another lookup fails or a limit is reached; coverage becomes incomplete. The strict `queryOsv` API retains its 12-advisory all-or-nothing budget. Input is limited to2MB/5,000 unique resolved packages; package-lock v2/v3 is supported. Existing exact package.json/Python pins are supported with explicit coverage warnings. No pnpm/yarn parsing is claimed.

Verdict labels retained for web compatibility: Blocked; Review required (needs review); Incomplete; Checks passed (clear within the stated scope). OSV severity/fix candidate rules are shared with the website. Unknown severity remains review; fixes are candidates, not proof of exploitability or compatibility. Optional AI cannot change this verdict.

OSV receives exact package names/versions, not lockfile contents. Only caller-supplied in-memory advisory caching is used; cached sources retain their original retrieval timestamp. Secret checks cover four known patterns, not full credential discovery. Advisory prose is untrusted source data, never instructions.
