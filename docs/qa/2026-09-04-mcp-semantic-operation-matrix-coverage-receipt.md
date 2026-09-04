# MCP semantic operation matrix coverage receipt

## Delivery baseline and scope

- Baseline: `origin/main` at `68e88075ddfaa90edb0078f902b2d9103dba1bb3`.
- Changed production scope: `electron/capabilityCore/documentSurface.ts` only.
- The matrix exercises the published MCP protocol and dispatcher for
  `nomi_document_read`, `nomi_document_edit`, and
  `nomi_canvas_maintenance`. It also records the renderer-only gaps for
  timeline, media, and export operations.
- This receipt does not claim 100% coverage for the repository.

## Red to green evidence

The production write path originally retained a fallback for
`workbenchDocuments`. The preceding `projectDocument()` call already rejects a
missing or non-array collection and requires a selected document, so that
fallback branch is unreachable on the same production call path. The matrix
test covered the real write effect and exposed that branch as the only scoped
coverage miss.

Red command (temporary pre-fix source, latest baseline):

```sh
pnpm exec vitest run electron/capabilityCore/mcpSemanticOperationMatrix.test.ts \
  --coverage.enabled --coverage.provider=v8 \
  --coverage.include=electron/capabilityCore/documentSurface.ts \
  --coverage.reportsDirectory=/tmp/nomi-mcp-semantic-matrix-v8-latest-red \
  --coverage.thresholds.statements=100 \
  --coverage.thresholds.branches=100
```

Result: exit 1. Tests were 3/3 green, statements 30/30 (100%), branches
40/41 (97.56%), functions 9/9 (100%), lines 26/26 (100%); the unreachable
fallback branch left line 56 uncovered and failed the 100% branch threshold.

Green command (minimal production fix applied):

```sh
pnpm exec vitest run electron/capabilityCore/mcpSemanticOperationMatrix.test.ts \
  --coverage.enabled --coverage.provider=v8 \
  --coverage.include=electron/capabilityCore/documentSurface.ts \
  --coverage.reportsDirectory=/tmp/nomi-mcp-semantic-matrix-v8-final-green \
  --coverage.thresholds.statements=100 \
  --coverage.thresholds.branches=100
```

Result: exit 0. Tests 3/3 passed; statements 30/30 (100%), branches 39/39
(100%), functions 9/9 (100%), lines 26/26 (100%).

## Verification receipt

- Targeted matrix plus related production-path suites: 4 files, 15 tests
  passed.
- `pnpm run typecheck`: passed.
- `pnpm run build`: passed, including Electron install verification (13/13).
- `node tests/ux/production-mcp-journey.e2e.mjs`: passed with 58 assertions
  in a real built Electron run. The run opened a real MCP-created project,
  used the real stdio MCP server, created a canvas node through MCP, deleted
  and undid it through the renderer gateway, and read it back after a real
  Nomi restart.

## Remaining gaps

- A newly MCP-created project has no creation document, so the real Electron
  journey records `nomi_document_read` as an explicit
  `document_not_found` contract gap. Positive document read/edit persistence
  is covered through the real workspace repository fixture and dispatcher
  path; there is currently no MCP document-create operation to seed it through
  the production journey.
- `nomi_timeline_read`, `nomi_timeline_edit`, `nomi_media_query`, and
  `nomi_export_job` are advertised but are renderer-only in the current
  production path; the headless dispatcher returns unknown-method errors for
  these routes. Timeline writes additionally require Host approval, and export
  write is Host-only. The tests record this as blocked/gap evidence rather than
  fabricating successful semantic operations.
- The published document edit contract has no revision parameter, so stale
  revision is recorded as a schema/contract gap instead of inventing a
  concurrency protocol.
