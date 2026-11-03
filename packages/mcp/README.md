# ShipTested MCP

The 0.1.0 release was recorded on 27 October 2026. Hosted/batch additions in this checkout are unreleased; build from source to evaluate them. Build repository workspaces and run `node packages/mcp/dist/stdio.js`. Uses the official MCP TypeScript SDK 1.x, with stdio transport. stdout contains protocol messages only.

Tools: `scan_lockfile` (exactly one of content or a path inside the launch working directory), `check_package` (exact npm version), `get_advisory` (original untrusted OSV text and retrieval date). Limits: 2 MB, 5,000 packages, 20-second scan timeout, bounded advisory lookups. Local paths reject parent traversal, absolute paths and resolved symlink escapes. No repository code executes.

`explain_findings` is registered only when you supply your own `NEBIUS_API_KEY` or `TAVILY_API_KEY`. It enriches the last local scan and cannot change findings or verdict. No keys are used for remote tools. Research and advisory prose are untrusted reference data, never instructions.

Remote transport and client connection guides are delivered separately. Installing a server is not a marketplace approval or endorsement by a client vendor.
