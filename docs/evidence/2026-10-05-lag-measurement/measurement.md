# PR1014 Card 17: real-scale lag measurement (sanitized)

Measurement date: 2026-10-05. Baseline commit: 180224684e4d3dad93aad7f258d46a932eb70e35. Product code, assertions and baselines were not changed; no paid model or real API key was used.

## Method

The run reused `tests/ux/canvas-performance-benchmark.e2e.mjs`, `tests/perf/canvas-scale-bench.mjs`, and `tests/ux/fixtures/canvas-performance-fixture.mjs`. Executable scenarios used one warmup and five samples; p95 uses the benchmark's linear percentile. Renderer and main-process profile artifacts are retained privately in the Library evidence package and are not copied into this public PR.

Fixture scale: I300 = 300 image nodes / 150 edges. XL mixed media = 160 image + 160 video nodes / 320 nodes / 640 edges. The media fixture used 80 image entries and 10 video entries from the authorized local fixture set.

## Facts

| Scenario | Samples | Facts (median; p95) |
|---|---:|---|
| I300 cold-open | 5 | first canvas 13,842 ms; 13,864.8 ms. Media settled 2,695 ms; 2,710.6 ms |
| I300 blank-pan | 5 | FPS 120.6; 120.7. Frame p95 10.2 ms; 10.38 ms. Long tasks 0; 0 |
| I300 node-drag-image | 5 | FPS 120.1; 120.2. Frame p95 10.4 ms; 11.42 ms. Long tasks 0; 0 |
| Waiting effects | 5 | 8 running image nodes. FPS 120; 120. Frame p95 9.8 ms; 10 ms. Long tasks 0; 0 |
| XL node-drag-video | 5 | 160 image + 160 video nodes. FPS 116.2; 117.4. Frame p95 11.4 ms; 11.74 ms. Long tasks 0; 0 |
| XL drag-nodes-all | 1 profile batch | FPS 32.2. Frame p95 66.9 ms. Max frame gap 115.6 ms. Long tasks 249; longest 184 ms. |
| XL zoom-slider-drag | 1 profile batch | FPS 112.5. Frame p95 14.6 ms. Max frame gap 78.6 ms. Long tasks 1; longest 68 ms. |

## Coverage limits

The I300 fixture had no visible video nodes, so its video-drag scenario is not reported as a passing number. Existing reusable harnesses had no setup for empty-project creation, Agent streaming/idle project switching or new-project actions, 40 storyboard shots, three documents, or approximately 200 Agent history entries. Those scenarios remain unverified and are listed in `blockers.txt`.

## Evidence boundary

The complete raw JSON, traces, screenshots and CPU profiles are in the user-confirmed private Library artifact `card17-lag-measurement-evidence.zip`; this PR contains only sanitized facts and numeric summary. Source harness paths are repository-relative and are listed in `metrics.json`.

## Hotspots requested by the coordinator

The profiles identify production-bundle locations; source maps were absent, so minified names are retained rather than converted to invented source functions.

### I300 cold-open renderer trace aggregation

The benchmark's `cold-open` timing is project-open action to the first stable canvas predicate (canvas stage visible with expected nodes/media settled). The captured dataset does not contain separate read-project, parse, node-build and first-render timestamps; those sub-stages are therefore `unavailable`, not estimated.

Top renderer FunctionCall aggregates from the I300 trace set (self total; calls; max):

1. `ni` — `dist/assets/BaseGenerationNode-BloKw0LT.js:619`, 1,244,358 µs; 21,608; 1,692 µs.
2. `frame` — injected probe, 1,071,089 µs; 23,856; 360 µs.
3. `<anonymous>` — `dist/assets/react-vendor-BQQcTRIt.js:8`, 465,839 µs; 630; 4,685 µs.
4. `at` — `dist/assets/react-vendor-BQQcTRIt.js:1`, 248,069 µs; 945; 13,271 µs.
5. `<anonymous>` — `dist/assets/canvasViewportScale-mUvAWIFP.js:1`, 226,028 µs; 756; 3,720 µs.
6. `frame` — injected probe, 64,384 µs; 21,602; 91 µs.
7. `pf` — `dist/assets/react-vendor-BQQcTRIt.js:5`, 46,980 µs; 2,856; 156 µs.
8. `<anonymous>` — `dist/assets/WorkbenchShell-B_U38f6Z.js:7`, 15,203 µs; 336; 222 µs.
9. `<anonymous>` — `dist/assets/useGenerationFeedback-3p0boaJ4.js:1`, 12,378 µs; 180; 219 µs.
10. `listener` — injected probe, 8,344 µs; 1,572; 204 µs.

Main-process profile top self-time entries (the profile was captured during the same benchmark run; idle samples omitted): `readJsonFile` (`dist-electron/jsonFile.js:113`, 119,959 µs), `read` (110,108 µs), `fsync` (109,170 µs), `readFileUtf8` (102,333 µs), `(program)` (89,047 µs), `readFileSync` (`node:fs:434`, 72,110 µs), `readWorkspaceManifestSnapshot` (`dist-electron/workspace/workspaceManifest.js:426`, 50,328 µs), `internalModuleStat` (48,600 µs), `compileSourceTextModule` (`node:internal/modules/esm/utils:317`, 46,398 µs), and `wrapSafe` (`node:internal/modules/cjs/loader:1769`, 29,762 µs).

### XL drag-nodes-all profile

Top renderer profile frames (self sample hits; share): `(program)` 53,260 (48.2%), `(idle)` 11,451 (10.4%), `(garbage collector)` 4,637 (4.2%), `<anonymous>@index-DooT7VsE.js` 3,169 (2.9%), `formatLanguageCode@index-DooT7VsE.js` 2,148 (1.9%), `we@react-vendor-BQQcTRIt.js` 1,626 (1.5%), `Pc@canvasViewportScale-mUvAWIFP.js` 1,498 (1.4%), `wc@react-vendor-BQQcTRIt.js` 1,290 (1.2%), `bs@react-vendor-BQQcTRIt.js` 1,281 (1.2%), and `setAttribute@(anonymous)` 1,231 (1.1%).

The measured mutation counters were 79,564 node style writes, 275 DOM flushes and 665,454 subtree mutations across 320 nodes; the captured profile does not prove one unique source call stack. The largest named production-bundle frames are the canvas viewport-scale module and React vendor frames; the report intentionally keeps this as an observation rather than a root-cause claim.
