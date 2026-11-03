# ShipTested CLI

The 0.1.0 release was recorded on 27 October 2026. Hosted/batch additions in this checkout are unreleased; build from source to evaluate them. Build workspaces from the repository, then run `node packages/cli/dist/index.js --help`.

`scan [path=package-lock.json]` supports `--json`, `--sarif <new-file>`, `--fail-on high|medium|low|any`, `--ai`, `--quiet`, `--no-color`. Output never uses ANSI colours. Stages go to stderr; JSON alone goes to stdout. SARIF refuses to overwrite an existing file.

Exit codes: 0 checks passed; 1 blocked or threshold met; 2 review required; 3 incomplete coverage; 64 usage/input error; 70 internal/output error. Incomplete takes precedence over threshold results. A pass only covers the documented checks.

`explain <advisory-id>` prints original **untrusted** OSV advisory text, retrieval date and affected-version ranges. `mcp` launches the separately installed `shiptested-mcp` executable. Optional `--ai` reads only your `NEBIUS_API_KEY` and/or `TAVILY_API_KEY`; findings and verdict cannot change.

Only exact dependencies and supported credential patterns in the supplied file are checked. The CLI does not execute repository code, modify dependencies, or apply fixes. Lockfiles are limited to 2 MB and 5,000 packages; OSV detail lookup is bounded and may return incomplete coverage for large inputs.
