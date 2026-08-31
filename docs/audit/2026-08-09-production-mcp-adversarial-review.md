# Production MCP Adversarial Review — 2026-08-09

## Verdict

No unresolved P0 or P1 issue was found in the Production Run MCP boundary. The built Electron journey, MCP Apps host journey, focused security tests, and full repository gates passed on the same worktree and build.

## Attack Matrix

| Attack | Expected boundary | Evidence | Result |
|---|---|---|---|
| External MCP approves budget/export or publishes | No control tool exists; decisions require Nomi UI | `nomiMcpProductionRuns.test.ts`, real four-gate journey | Pass |
| Caller claims `host=nomi/codex/claude` | Transport authority overrides caller data | `productionRunCore.test.ts` forged-host table | Pass |
| Artifact leaks prompt, absolute path, provider URL/task ID, idempotency key, or private contract data | External projection recursively sanitizes and omits private fields | `productionRunService.test.ts`, `artifactProjection.test.ts`, real `nomi_get_artifact` assertion | Pass |
| Preview token is missing, forged, expired, from another profile, or scoped to another project/Run/artifact | Loopback preview fails closed | `artifactProjection.test.ts`, `artifactPreviewHttpServer.test.ts` | Pass |
| Deep link injects path traversal, unknown Run, or wrong-Run artifact | Repository ownership is verified before navigation | `productionDeepLink.test.ts` | Pass |
| Retry or restart duplicates a paid provider submission | Durable command ID, revision CAS, idempotency key, and `submission_unknown` safe pause prevent automatic resubmit | `productionRunRepository.test.ts`, `submissionOutbox.test.ts`, `productionRunDriver.test.ts`, real restart journey | Pass |
| Filtered event is reread forever | Durable cursor advances beyond suppressed events | `productionRunService.test.ts` | Pass |
| MCP Apps fabricates progress or floods media/actions | Canonical state maps to one truthful sentence, at most one preview, and one Nomi CTA | `nomiMcpApps.test.ts`, 9-assertion host render journey | Pass |
| Fixture reaches production builds or calls a provider | Fixture requires both E2E flags and `app.isPackaged === false`; it uses bundled FFmpeg only | `productionRunE2eFixture.test.ts`, real journey | Pass |

## Residual Product Boundaries

- Production MCP currently exposes the complete `brand.promo` playbook, not a public batch-generation API.
- Direction, spending, rough-cut acceptance, export, publish, deletion, and overwrite remain human decisions in Nomi.
- Projects, prompts, keys, orchestration state, and adopted outputs are local-first. Required task inputs still leave the machine when the user chooses an external model provider.
- A provider timeout or ambiguous receipt pauses the Run for reconciliation; it does not automatically retry or claim success.

## Reproduction

```bash
pnpm run gates
node tests/ux/production-mcp-journey.e2e.mjs
node tests/ux/mcp-apps-host-render.e2e.mjs
```
