# Nomi user workflow scenario matrix and performance budget

Written before the first measurement on 2026-10-10. Thresholds are fixed for this task; a failing result requires diagnosis or a documented blocker, never a post-hoc threshold change.

## Fixed scale, host and repetition policy

| Scale | Project contents | User purpose | Cache/repetition |
|---|---|---|---|
| Small | 2 documents; 2 storyboard plans; 12 shots; 4 images + 2 videos; 4 references | New creator learns the flow and edits a short draft | cold and hot; 1 warm-up + 5 measured runs per cell |
| Typical | 5 documents; 5 storyboard plans; 48 shots; 24 images + 24 videos; 48 references | Working creator compares drafts, plans and mixed media | cold and hot; 1 warm-up + 5 measured runs per cell |
| Heavy | 12 documents; 10 storyboard plans; 320 shots; 160 images + 160 videos; 320 references | Long-lived project with dense canvas and Agent activity | cold and hot; 1 warm-up + 5 measured runs per cell |

The existing canvas fixture names `S/M/L/XL` are retained for the media-only slice (`S=24+24`, `M=48+48`, `L=96+96`, `XL=160+160`). The user workflow fixture adds document and storyboard-plan counts around those canvas payloads. If a scale cannot be represented by the current production schema, the raw result is recorded as `blocked_fixture` rather than silently shrinking it.

Every run records: OS/architecture, logical CPU count, total memory, GPU/backend, Electron/Chrome/Node versions, renderer build (`prod` or `dev`), viewport, scale, cache state, run index, fixture counts, and process IDs. The host in this container is Linux software rendering; cross-platform acceptance remains required.

## Scenario matrix

Each row is an actual user action sequence. `UI wait` means product work visible in the renderer/main process. `Model/network wait` is measured from the same action but excluded from UI-blocking latency; synthetic Agent fixtures make this split repeatable without paid calls.

| ID | Workflow and action sequence | Scales | Agent state | Primary measurements |
|---|---|---|---|---|
| P1 | Cold app launch → library visible → open first project → first document and canvas visible | S/T/H | idle | input→visible, input→interactive, renderer/main CPU, long tasks, working set |
| P2 | Hot reopen → enter project → switch project A/B/A → return to library | S/T/H | idle | same as P1 plus open/close residual and cache delta |
| D1 | Create document → type/edit 20 short operations → switch among all documents → return to first | S/T/H | idle | edit input→visible, interactive-ready, frame p95/p99, dropped frames |
| D2 | Open document while switching storyboard plan → edit a title/shot → undo/redo → cancel a pending save | S/T/H | idle | visible feedback, long tasks, correctness and cancellation path |
| B1 | Create storyboard plan → add/rename/reorder shots → duplicate plan → switch among plans | S/T/H | idle | action latency, frame gaps, DOM/React work, memory trend |
| B2 | Select all shots in a plan → batch move/delete/undo → switch plan during batch | T/H | idle | batch feedback, p95/p99 frame time, main/renderer CPU, recovery |
| C1 | Open mixed image/video canvas → pan/zoom → select node → edit prompt → reference another node | S/T/H | idle | visible feedback, interactive-ready, frame p95/p99, dropped frames, media pending |
| C2 | Multi-select and drag dense nodes → preview image/video → hover/play/stop → cancel preview | T/H | idle | gesture feedback, frame p95/p99, long tasks, active media, correctness |
| C3 | Open canvas with mixed references → switch plan/document → return to canvas → reload | T/H | idle | reopen latency, first media decoded, media errors, working set |
| A1 | Agent idle while P2/D1/B1/C1 sequence runs | S/T/H | synthetic idle | UI metrics; no model/network wait expected |
| A2 | Local fixture emits token stream while user switches document/plan and edits canvas | T/H | synthetic stream | UI metrics separated from fixed 2 s stream wait; stream cancellation/recovery |
| A3 | Local fixture runs a tool call while user opens/switches/edits documents, plans and media | T/H | synthetic tool-running | UI metrics separated from fixed 1 s tool wait; tool completion/failure/retry |
| A4 | Stream → tool-running → idle; repeat P2 + C2; cancel at each phase, then reopen | T/H | synthetic sequence | cancellation latency, resource cleanup, no stale loading UI, memory residual |
| R1 | Repeat open project → close studio → return library 10 times, then quit/relaunch | S/T/H | idle | working-set/JS-heap slope, renderer process count, listeners/timers, asset/video handles |
| R2 | Repeat A4 then close/reopen 5 times; include failed/cancelled tool fixture | T/H | synthetic sequence | residual memory, active videos, pending promises/IPC, recovery correctness |

## Metric definitions

- **Visible feedback:** first stable DOM or canvas mutation attributable to the action, measured from Playwright input dispatch. A spinner/skeleton counts as feedback, but the raw result also records the concrete content milestone.
- **Interactive-ready:** the first point at which the target control reports enabled and a second independent no-op input is accepted without queueing behind a long task.
- **Frame time:** consecutive `requestAnimationFrame` intervals during the action window. Report p95 and p99; record max separately. Dropped frames are intervals above 50 ms for a 20 FPS floor and above 33.3 ms for the 30 FPS target.
- **Long task:** `PerformanceObserver('longtask')` entries; report count, total, p95 and max. Renderer and main process measurements are kept separate.
- **CPU:** renderer and main process samples from Electron `app.getAppMetrics()` plus CDP `Performance.getMetrics`; report median/p95 over the action window, not a single instantaneous reading.
- **Memory:** renderer working set, total app working set, JS heap and DOM/listener counts at start, settled end and after teardown. Report absolute values and slope across repeats.
- **Wait split:** synthetic stream/tool timers and any external/network wait are separate fields. UI latency is never hidden inside a model/network duration.

## Budgets

Budgets apply to the measured distribution after warm-up. A cell passes only when all non-advisory budgets pass and the functional walk completes.

| Metric | Small | Typical | Heavy | Notes |
|---|---:|---:|---:|---|
| Input → first visible feedback p95 | ≤100 ms | ≤120 ms | ≤150 ms | Navigation/edit/gesture; wait-only intervals reported separately |
| Input → interactive-ready p95 | ≤500 ms | ≤700 ms | ≤1000 ms | Includes local persistence and layout, excludes model/network wait |
| Frame interval p95 during active gesture | ≤33 ms | ≤33 ms | ≤50 ms | 30 FPS target; heavy allows 20 FPS floor while still recording p99 |
| Frame interval p99 during active gesture | ≤50 ms | ≤67 ms | ≤100 ms | Max remains advisory and is always reported |
| Dropped-frame ratio | ≤2% | ≤3% | ≤5% | `frameInterval > 50 ms` over the action window |
| Renderer long-task p95 | ≤80 ms | ≤80 ms | ≤100 ms | Any task >200 ms is a hard diagnostic failure |
| Main-process long-task p95 | ≤80 ms | ≤100 ms | ≤120 ms | Main blocking must remain distinguishable from renderer work |
| Renderer CPU p95 while interactive | ≤70% | ≤75% | ≤85% | Host sample; mark noisy when host contention is observed |
| Main CPU p95 while interactive | ≤50% | ≤60% | ≤70% | Same host/noise policy |
| Settled renderer working-set growth after R1 | ≤30 MB | ≤50 MB | ≤75 MB | Relative to first settled open |
| JS heap growth after R1 | ≤10 MB | ≤15 MB | ≤25 MB | Full GC is requested only for diagnostics, never to hide trend |
| Renderer process/listener residual after close | 0 extra renderer; 0 stale target | same | same | Functional/resource guard, not a timing relaxation |

The existing canvas performance gate's calibrated Linux multiplier is historical context only. This matrix's numbers are the acceptance contract for the new cross-surface workflow evidence; if a platform needs a calibration, add a separate platform row with evidence rather than changing these ceilings.

## Noise and blocker rules

All raw samples stay in evidence. A run can be labelled `noise` only with a contemporaneous host/process observation (CPU steal, renderer crash/restart, Xvfb failure, or background process over the recorded threshold). Noise never turns a failed cell into a pass; it makes the cell `inconclusive` until rerun under the same fixed protocol. Missing Electron runtime, missing real-material fixture, or inaccessible Windows/macOS hardware is a blocker recorded in `limitations.md`, never replaced by a synthetic green result.

