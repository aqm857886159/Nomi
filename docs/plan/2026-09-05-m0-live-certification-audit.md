# M0 Codex → Nomi MCP live-certification audit

## Current evidence

The repository has a real stdio MCP handshake at `tests/ux/mcp-l1-handshake.e2e.mjs`, semantic MCP journeys under `tests/ux/mcp-l2-journeys.e2e.mjs` and `tests/ux/production-mcp-journey.e2e.mjs`, and the public tool surface documented in `docs/guide/capability-core-cli-mcp.md`. These are Electron/stdio contract journeys; they do not prove a real Codex Host session. The M0–M5 contract explicitly records `publicMcpSessionProbe` as `PARTIAL_PROOF` and real Codex Host coverage as uncovered.

Provider canaries are separate: `tests/transport-spike/apimart.mjs` checks APIMart HTTP shapes, while `tests/ux/apimart-text-brain.e2e.mjs` and `tests/ux/staging-reference.e2e.mjs` require an explicit environment gate. No credential belongs in source, fixtures, logs, screenshots, or MCP arguments.

## State ledger

| Surface | Current state | Evidence boundary |
|---|---|---|
| MCP stdio protocol / malformed input | READY contract | `mcp-l1-handshake.e2e.mjs`; no provider call |
| Semantic tools and typed scope/approval errors | READY contract / simulated journey | `mcp-l2-journeys.e2e.mjs`, Vitest MCP suites |
| Electron UI → preload → Host persistence | PARTIAL_PROOF | existing editing/production journeys; not Codex Host |
| Real Codex Host → Nomi MCP session | BLOCKED / uncovered | must use a real Codex client with generated signed client identity |
| Relay credential save/probe | UI and HTTP certification paths exist | must run through visible onboarding; never direct catalog injection |
| APIMart text model | BLOCKED until explicit live canary | environment-gated; real spend/response must be recorded and redacted |
| APIMart image/video generation | BLOCKED until model-specific low-cost canary | transport spike is shape evidence only; video is paid and must remain opt-in |
| Current packaged MCP + restart | BLOCKED | no fresh current-HEAD packaged artifact in the contract |

## Safe certification sequence

1. Build current HEAD and run the no-provider contract suites and `mcp-l1-handshake.e2e.mjs`; retain exact commit, app identity, tool count, and redacted traces.
2. In a fresh isolated Electron profile, use the visible model onboarding card to enter the user-provided relay credentials. Confirm that the probe result is a real HTTP response and that logs contain only a masked fingerprint.
3. Start a real Codex client configured through Nomi's integration flow. Verify generated `NOMI_MCP_CLIENT` and `NOMI_MCP_CLIENT_PROOF` are present for that client; do not hand-write or reuse values. Run `tools/list`, `nomi_project_create`, `nomi_read`, and a no-spend `nomi_operation_plan` only.
4. If step 3 is healthy, perform exactly one smallest text canary behind the explicit `APIMART_E2E=1` gate, then stop and record provider/model/request/result classification. Do not start image/video generation in the same run.
5. Promote image and video models independently only after a model-specific transport contract and a single bounded canary; classify unsupported reference kinds, unknown submission, timeout, and reconcile without blind retry.
6. Package current HEAD, rerun the packaged MCP smoke and cold restart readback. A loopback or custom stdio diagnostic remains `PARTIAL_PROOF` and cannot be promoted to live Codex evidence.

## Acceptance labels

Use only `documented`, `simulated`, `live-certified`, `partial-proof`, or `blocked`, with command, commit SHA, profile path, model identity, and redacted receipt/evidence path. Never report a provider as live-certified from a fixture, loopback, static UI, or a tool-list response alone.
