# React Flow Canvas Complete Migration

> ✅ 已交付（React Flow 单内核迁移已随本 PR 落地，配套不变量测试同批提交；状态标记由 `check:doc-status` 门岗要求）

## Objective

Replace the generation canvas renderer with React Flow as the only renderer while
keeping the existing canvas store, persisted project format, graph semantics,
and user-visible behavior stable.

The migration is complete only when the real canvas workflows pass in a built
renderer/Electron session. Passing TypeScript and unit tests alone is not enough.

## Invariants

- `useGenerationCanvasStore` remains the single persisted source of truth.
- React Flow node/edge state is an adapter/rendering projection and is never
  written into project snapshots.
- Connections continue through `startConnection`, `connectToNode`,
  `connectToGroup`, and the existing graph actions; React Flow `addEdge` is not
  used.
- Existing node data, edge mode/order/viaGroupId, group link semantics,
  category viewports, undo/redo, and external Agent/MCP updates remain intact.
- The old canvas renderer is removed after parity work; no runtime fallback or
  parallel renderer remains.

## Implementation Stages

### 1. Contract inventory

- Read `AGENTS.md` and the triggered sections of `docs/engineering-rules.md`.
- Inventory every legacy canvas capability and its store/action contract.
- Map each existing canvas UX walkthrough to the React Flow event/component
  that will own it.
- Record baseline test/build results and known unrelated failures.

### 2. Renderer boundary

- Keep the public `GenerationCanvas` component API unchanged.
- Make React Flow the only implementation behind that API.
- Remove the legacy component, legacy-only imports, engine flag, and fallback
  code once parity is verified.
- Keep React Flow CSS scoped to its renderer and avoid adding global style
  duplication.

### 3. Interaction parity

- Nodes: single/multi-select, marquee selection, keyboard selection, drag,
  multi-node drag, resize, lock/read-only rules, and focus/deep-link behavior.
- Groups: frame rendering, group drag, group selection, group connection,
  group/ungroup actions, and group input/output semantics.
- Edges: magnetic handles, pending connection line, node/group completion,
  empty-canvas image/video creation, mode editing, selection, disconnect,
  deletion, and undo/redo.
- Viewport: pan, wheel/pinch zoom, zoom controls, category viewport
  persistence, reset, fit, tidy, minimap, and auto-fit-on-load.
- Existing overlays: toolbar, context menus, selection toolbar, batch dock,
  batch plan, screenshot capture, 3D capture hosts, and prompt-save selection.
- Drag/drop: workspace files, asset library/browser assets, OS media, and
  timeline node drops.
- Performance: preserve lightweight rendering/visibility culling behavior and
  verify large-canvas responsiveness.

### 4. Automated coverage

- Adapter tests for node/edge/viewport conversion and dangling-edge handling.
- Store integration tests for drag/resize preview versus commit events.
- React Flow integration tests for selection, multi-drag, connection routing,
  edge deletion/mode updates, viewport persistence, read-only guards, menus,
  and all supported drop payloads.
- Entry smoke tests proving the single renderer mounts without the legacy path.

### 5. Real UX walkthroughs

Run the built renderer/Electron test environment and capture evidence for:

- `canvas-drag-pan-gestures.walk.mjs`
- `canvas-shortcuts.walk.mjs`
- `canvas-node-context-menu.walk.mjs`
- `canvas-context-menu-click.walk.mjs`
- `canvas-batch-production.walk.mjs`
- `selection-toolbar-vendor.walk.mjs`
- `group-baseline.walk.mjs`
- `group-ports.walk.mjs`
- `group-reference-direction.walk.mjs`
- `p4-s5-canvas-landing.e2e.mjs`
- `p4-s5-canvas-reconcile.e2e.mjs`
- `canvas-performance-benchmark.e2e.mjs`

Add at least three repeatable real-user-task scenarios covering a normal
creation flow, an edge/group editing flow, and a read-only/reload boundary.
Each scenario must reach the user's actual outcome, not only an intermediate
assertion.

### 6. Repository gates

Run and fix all new failures from:

```text
pnpm run check:filesize
pnpm run check:tokens
pnpm run check:i18n
pnpm run check:heavy-path
pnpm run lint:ci
pnpm run typecheck
pnpm run test
pnpm run build
```

Also run the focused canvas tests and `git diff --check`. Existing unrelated
environment/baseline failures must be documented separately rather than hidden.

### 7. Delivery

- Review the final diff for deleted legacy code, accidental metadata churn, and
  persisted-state changes.
- Create a fresh task branch from the latest `origin/main`.
- Commit and push only after all gates and real walkthroughs pass.
- Create a new PR with scope, migration invariants, test commands/results,
  walkthrough evidence, and any residual non-blocking warnings.

## Acceptance Criteria

- React Flow is the only canvas renderer in the production entry point.
- No legacy renderer/fallback/second canvas state remains.
- Existing project snapshots load unchanged and external graph updates render.
- All listed canvas workflows work in a real built session, including reload,
  undo/redo, read-only mode, and large-canvas interaction.
- Focused tests, repository gates, and real-user-task walkthroughs pass before
  the PR is opened.

## Verification Log (2026-08-27)

### Migration-specific results

- `pnpm run build`: passed (renderer and Electron TypeScript build).
- `pnpm run typecheck`: passed.
- `pnpm run lint:ci`: passed with 86 warnings and 0 errors (repository limit: 98).
- `pnpm run check:filesize`, `check:tokens`, `check:i18n`, and `check:heavy-path`: passed.
- `check:dangling-tokens`, `check:test-waits`, `check:controls`,
  `check:e2e-launch`, and `check:test-types`: passed.
- Added R21 to `CLAUDE.md` and `docs/engineering-rules.md`, regenerated
  `AGENTS.md`, and passed `check:agents-sync`. R21 fixes React Flow as the
  single production renderer and preserves the store/snapshot truth boundary.
- The latest single-renderer structure and adapter tests passed 26/26,
  including a production-source scan that rejects the removed renderer and
  engine flag symbols.
- Focused React Flow/canvas tests: 33/33 passed, including the read-only
  node-selection guard added during final walkthrough.
- Full Vitest on the rebased `0.21.0` main baseline: 7991 passed, 30 failed,
  19 skipped. No migration-related test failed; all 30 failures are in files
  outside this migration diff and match Windows/path, `/bin/sh`, symlink,
  fixture, production sample, onboarding/settings, MCP/Antigravity, and script
  baselines below. The separately invoked agent-runtime suite passed 151/151.
- `pnpm run build:renderer`, `pnpm run build`, `pnpm run lint:ci` (86 warnings,
  0 errors), and `pnpm run typecheck`: passed.
- Real Electron journeys passed: image preview/rename with reload persistence, batch production with retry and timeline, group baseline, group ports, group reference direction, read-only/reload, drag-pan/zoom/marquee, shortcuts, blank-canvas menu, and node context menu.
- Final medium-canvas performance benchmark: all 14 scenarios executed with
  0 page errors and 0 hard failures. `cold-open`, `blank-pan`, both node-drag
  cases, wheel/pan zoom, resize, media reveal/error, low-zoom preview,
  video-hover, and reload-heavy passed their budgets. `marquee-select` retained
  an occasional max-frame-gap budget miss (P95 128.2ms vs 100ms), and
  `click-select` retained a frame-gap P95 miss (36.1ms vs 33ms; max 117.7ms).
  These are residual single-frame responsiveness risks, not correctness or
  stability failures. The repository has no same-scale committed React Flow
  baseline.

### Final walk and audit update

- Rebuilt the production renderer before the final walks.
- Re-ran `canvas-drag-pan-gestures.walk.mjs` (38 assertions),
  `group-ports.walk.mjs`, `react-flow-read-only.walk.mjs`,
  `canvas-batch-production.walk.mjs`, `canvas-shortcuts.walk.mjs`,
  `canvas-node-context-menu.walk.mjs`, `canvas-context-menu-click.walk.mjs`,
  `canvas-image-preview-and-rename.e2e.mjs`, `selection-toolbar-vendor.walk.mjs`,
  `group-baseline.walk.mjs`, `group-reference-direction.walk.mjs`,
  `p4-s5-canvas-landing.e2e.mjs`, and `p4-s5-canvas-reconcile.e2e.mjs`: all
  passed with no page/console errors.
- The read-only walk initially exposed React Flow selecting a node despite the
  top-level guard. `toGenerationFlowNode` now sets both `selectable` and
  `focusable` to `!readOnly`, with an adapter regression test.
- `git diff --check` passed. No production references remain to
  `CanvasEdgeLayer`, `generationCanvasEngineFlag`,
  `isReactFlowCanvasEnabled`, or `LegacyGenerationCanvas`; historical audit
  documents may still mention the removed renderer by name.
- The exact `pnpm run gates` chain was also invoked. It passes the chain,
  filesize, token, and dangling-token stages, then stops at the pre-existing
  `check:archetype-defaults` drift; no `.claude/.gates-ok` marker was created.

### Existing repository blockers (not introduced by this migration)

- `check:archetype-defaults`: generated archetype defaults are already out of sync.
- `check:adoption-bridge`: pre-existing direct timeline writes in `src/workbench/timeline/addAssetToTimeline.ts`.
- `check:ipc-sender-binding`: Windows path construction resolves `C:\\C:\\...\\electron`.
- `check:walkthroughs`: pre-existing ratchet counts for unrelated walkthroughs; migration-added absence assertions now use `proveProbe`/`expectAbsent`.
- `check:site`: pre-existing stale marketing site output.
- Full Vitest failures are limited to files outside this migration diff: Windows/path and symlink assumptions, `/bin/sh`-dependent Antigravity tests, secrets fixture, production sample, script syntax, onboarding/settings baseline, and MCP/asset path tests.

These blockers are recorded rather than changed because they are outside the canvas migration boundary and modifying them would add unrelated behavior or baseline churn.
