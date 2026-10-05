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
