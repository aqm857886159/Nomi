# Production MCP loopback journey · 2026-09-13

- Command: `NOMI_E2E_PRODUCTION_FIXTURE=1 node tests/ux/production-mcp-journey.e2e.mjs`
- Result: **PASS · 58 assertions**
- Real Electron + real MCP stdio transport, GUI approvals, restart recovery, durable run, zero-authorized-spend fixture, and final playable MP4 all passed.
- MP4 was produced by the double-gated local fixture; it is not evidence of a paid/live provider canary.
- Live provider canary remains separately blocked because the live gate has no supplied provider credentials and explicit spend authorization.
