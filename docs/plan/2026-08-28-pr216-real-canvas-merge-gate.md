# PR 216 real-canvas merge gate

> 状态：✅ 本地验收完成，等待远端 CI

## Objective

Treat PR 216 as a canvas-engine migration rather than a collection of isolated
component changes. The merge gate must prove that the production Electron app
can create, render, edit, persist, and reopen the migrated canvas through real
pointer and keyboard interactions.

## Scope

- Fix regressions found while exercising PR 216 from the project library into
  the production React Flow canvas.
- Keep Zustand/project snapshots as the only persisted canvas truth.
- Make React Flow the only owner of node placement, drag, connection, and
  resize controls while a node is mounted in the React Flow renderer.
- Add a required, repeatable real-canvas CI stage with inspectable screenshots
  and a machine-readable suite summary.
- Keep result-history trays inside the visible canvas on constrained desktop
  viewports by flipping their node-relative placement when the preferred side
  collides with the stage edge.
- Restore the approved semantic presentation contract for model parameters:
  aspect ratios and suppliers remain explicit segmented choices across models,
  while genuinely long workflow/file enumerations retain the searchable list.
- Preserve one undo transaction for a multi-shot canvas materialization even
  though the landing operation awaits asynchronous tool calls.
- Run the broader canvas acceptance set and a medium-canvas performance pass
  locally before merge.

## Do not change

- Provider/model request contracts or generation spending behavior.
- Persisted node, edge, group, or project schemas.
- Unrelated application surfaces or open pull requests beyond PR 201 and PR
  203, which PR 216 explicitly supersedes.
- The approved card-stack visual design except where a real walkthrough proves
  a functional regression.

## Test system

| Layer | Purpose | Required evidence |
|---|---|---|
| Store and adapter contracts | Lock graph, history, selection, projection, and path invariants | Focused Vitest suite |
| Production-entry smoke | Prove project library -> workbench -> add node -> visible composer in the built app | Electron assertions plus failure screenshot/diagnostics |
| Critical real-canvas CI | Exercise pan/drag/selection, group ports, result stacks, persistence, project switch, and read-only reload | Required Linux CI stage with screenshots and JSON summary |
| Full pre-merge acceptance | Cover shortcuts, context menus, batch production, group semantics, landing/reconcile, and medium-canvas responsiveness | Local Electron suite and inspected screenshots/performance JSON |

The critical suite must run after the production build and must fail closed if
any child walkthrough exits non-zero. It is not a source scan and does not call
the canvas store as a substitute for user interaction.

## Root-cause hypothesis

The CI smoke creates a node successfully but never finds its composer. React
Flow already positions the outer node from `node.position`, while the legacy
`BaseGenerationNode` wrapper still applies its own absolute translation. This
double placement can leave the real card/composer outside the visible stage.
The same incomplete ownership transfer leaves duplicate legacy connection and
resize controls under React Flow.

## Linux CI follow-up

The first required Linux run exposed three independent acceptance-system
failures after the production smoke was repaired:

- `react-flow-read-only.walk.mjs` waited for a Vite stdout substring without a
  timeout. A changed port, early server exit, or different logging behavior
  could therefore stall the entire job indefinitely.
- The gesture journey requested a 1600px window, but Xvfb constrained the real
  viewport to roughly 1280px. The second generated node remained outside the
  viewport, so every hard-coded marquee start candidate was invalid.
- `NodeResultStack` always opened to the right. The video fixture near the
  right stage edge left most of the tray outside the interactive viewport, so
  the history-video hover target was not visibly usable.

The class-level corrections are: bound every canvas child process, probe the
actual Vite resource instead of parsing logs, fit real content before deriving
selection geometry, and resolve overlay placement from measured stage space.

The complete local profile then exposed a separate renderer-migration gap: the
React Flow shell rendered the context menus but did not consume the shared
deferred context-click lifecycle. Reconnecting that lifecycle restores blank
and node menus without turning a secondary-button pan into a menu click. The
same profile also gives the medium performance matrix a longer scenario-specific
hard timeout while retaining the eight-minute bound for ordinary journeys.

The final interaction pass also found two cross-model/state regressions. The
generic large-enum fallback introduced for imported workflow parameters used
option count and label length as its only presentation inputs. It therefore
turned the approved visual aspect-ratio grid and supplier buttons into a
searchable dropdown for models with larger catalogs. Presentation must instead
preserve semantic roles before applying the generic overflow fallback. The S5
landing journey separately proved that a multi-shot materialization created the
correct store transaction, but generation-card mount effects then normalized
default model, supplier, archetype, and video-aspect metadata through ordinary
history writes. Marking those renderer-owned normalization writes as
`history: false` preserves persistence and event journaling without splitting
the user-visible undo boundary; explicit user edits still create history.

## Rollback

The hardening commit is additive to the existing PR branch and can be reverted
without changing persisted data. Reverting restores the pre-review renderer
behavior and removes only the new test profile/diagnostics.

## Acceptance gate

- A newly added image node's business-card bounds align with its React Flow
  wrapper; its inner wrapper has no second translation.
- React Flow-mounted nodes expose one drag/connection/resize implementation.
- The production smoke reaches and edits the node composer.
- Focused unit/contract tests, full repository gates, and the required remote
  checks pass.
- The critical and full real-canvas suites pass; their screenshots are opened
  and visually inspected.
- Every canvas-suite child has a hard timeout and reports timeout state in the
  machine-readable summary instead of blocking later scenarios.
- The active React Flow renderer consumes the deferred context-menu lifecycle;
  secondary clicks open the correct menu while secondary drags remain pans.
- A result-history tray is fully contained by the canvas stage on both wide
  and constrained viewports, preferring the right side and flipping left when
  required.
- Aspect-ratio options remain the approved visual segmented grid and supplier
  options remain explicit segmented buttons for every model/vendor count used
  by the product; long generic workflow enums still use searchable lists.
- One undo after a successful multi-shot materialization removes the complete
  operation group and all of its materialized nodes.
- The medium-canvas benchmark completes without page errors or hard failures.
- PR 216 merges before PR 201 and PR 203 are closed as superseded; Issue 198 is
  confirmed closed by the merge keyword.

## Verification log

- Before fix: PR 216 Linux CI and local production smoke both time out waiting
  for `.generation-canvas-v2-node__composer-card` after clicking Add image node.
- Before fix: 19 focused Vitest files pass (182 tests), demonstrating that the
  existing unit layer does not detect the production DOM-geometry regression.
- Linux run `33192162137`: gesture selection failed because no hard-coded
  marquee start remained inside the constrained viewport; the uploaded
  failure screenshot shows the second node clipped beyond the right edge.
- Linux run `33192162137`: the fixed-right result tray made the history video
  invisible near the stage edge, then the read-only scenario stalled before
  its first assertion while waiting on Vite stdout.
- Focused parameter-presentation and landing transaction coverage passes: 3
  Vitest files, 23 tests.
- `pnpm run check:root-cause-contracts`, targeted ESLint, and `pnpm build` pass.
- The real parameter-control Electron journey passes 60 assertions: Nano
  Banana 2 exposes all 15 aspect ratios as visual segments and Kie/APIMart as
  side-by-side supplier choices.
- The real S5 Electron journey passes 21 assertions: one Undo removes the four
  materialized nodes and their storyboard group after the real cards mount.
- The complete real-canvas profile passes all 14 scenarios, including the
  bounded medium-canvas performance scenario. Its machine-readable result is
  `tests/ux/perf-results/canvas-pr216-acceptance.json`.
- `pnpm gates` passes: 871 test files passed and 1 skipped; 8,221 tests passed
  and 1 skipped; type checks, lint ratchets, security/contracts, agent runtime,
  and the production build are green (86 existing lint warnings, 0 errors).
- Screenshots inspected after the final build:
  `tests/ux/shots/canvas-control-clarity/02-dark-canvas-ratio-panel.png`,
  `tests/ux/shots/p4-s5-canvas-landing/01-three-states-light.png`, and
  `tests/ux/shots/p4-s5-canvas-landing/03-after-undo.png`.
