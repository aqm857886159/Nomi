# Local Unit failures: selected head/main contrast

All16 files from the initial full Unit failure were rerun on B289 and origin/main4e1 in two identical groups, sequentially with unmodified runner concurrency/retries/timeouts/budgets. Both sides produce15 failed files/20 failed tests,63 passed tests and92 tests blocked by existing failed hooks. The obsolete canvas factory assertion was already repaired and passes23/23 on both. [Full hashes and archived outputs](cold-admission-unit-contrast.json).

| Failure class | Head and baseline observation | Scope finding |
|---|---|---|
| Ten browser UI files | Same missing Playwright Chromium executable before meaningful UI execution | Shared setup blocker, no browser baseline acceptance |
| mcpStdioDocumentReceipt | Same keys-directory ENOENT during module import; the declared hoisted temp root is only applied in beforeEach | Shared test isolation defect; no user directory is repaired or populated |
| generationParity.matrix | Same configured120s beforeAll timeout | Shared failure; precise internal wait still unproven |
| paidPostCodeFeatureTable | Same30s catalog/APIMart assertion timeout | Shared failure; precise cause still unproven |
| Antigravity | Same four exit/cleanup/cancellation assertions | Shared failure; no blanket container/zombie diagnosis |
| tryModelSubmitBudget | Same shared-budget assertion failure | Shared failure; no budget or fake-clock relaxation |
| canvasControlsStructure | Both23/23 pass after the previous branch correction | Initial branch-specific stale factory assertion corrected |

The baseline dependency linking used the same lockfile pins; Electron postinstall download failed. The selected Vitest runs use the existing electron stub and the same Node24.19/pnpm10.8.1/Vitest4.1.8. This is a selected failing-file contrast, not a second all-suite baseline or proof that every timeout is environmental. B289 remote Unit1/2/3 all pass; see exact-head Quality Gate38117963767. Original full Unit failed evidence is retained unchanged.
