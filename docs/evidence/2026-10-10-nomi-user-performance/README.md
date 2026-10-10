# Nomi user workflow performance evidence

This directory contains the redacted, repeatable evidence for the Nomi user workflow performance pass.

The measurements cover project/library navigation, multi-document editing, multi-storyboard-plan operations, mixed image/video canvas work, Agent idle/streaming/tool-running combinations, and repeated open/close cleanup. Network/model waiting is recorded separately from UI blocking. Local stream/tool fixtures are synthetic and are labelled as such; no paid generation is triggered.

## Execution contract

- App: Electron `43.4.1`, production renderer build unless a result says otherwise.
- Viewport: `1280x933` CSS pixels, device scale factor `1`.
- Hardware: record OS, architecture, logical CPU count, memory, GPU/backend and renderer mode in every raw result. The current Linux container is a software-rendered reference environment; it is not a substitute for the required macOS/Windows user machines.
- Cache states: `cold` means isolated user-data/projects directory and empty HTTP/media cache; `hot` means the same fixture reopened after one settled open. Never mix the two in one aggregate.
- Repetitions: one warm-up run, then five measured runs per cell. Preserve all measured samples; report median, p95 and p99. Do not discard slow samples. A run may be marked `noise` only when the process or host is independently observed to be contended, and it remains in raw data and the limitation table.
- Timing boundaries: input dispatch → first visible feedback; input dispatch → interactive-ready; model/network wait; renderer/main long tasks and CPU; frame interval p95/p99 and dropped-frame ratio; working-set/JS-heap trend and teardown residual.
- Evidence hygiene: fixtures use generated or repository-owned media. Real private assets, credentials, absolute host paths and network responses are not committed.

## Files

- `scenario-matrix-and-budget.md` — fixed scale matrix, action boundaries and budgets written before the first baseline.
- `design-card.md` — the required pre-change design card and independent-acceptance contract.
- `raw/` — one JSON result per command/scale/cache/leg; filenames contain no machine-private paths.
- `analysis.md` — baseline bottleneck ranking and before/after comparisons.
- `limitations.md` — unavailable machines, unmeasured surfaces and synthetic-fixture boundaries.

## Reproduction commands

```bash
node --test tests/ux/nomi-user-workflow-performance.node-test.mjs
GIT_COMMIT=$(git rev-parse HEAD) node tests/ux/nomi-user-workflow-performance.e2e.mjs --scale=small,typical,heavy --runs=5 --warmup=1
node scripts/summarize-nomi-user-performance.mjs
```

The second command requires a display-capable Electron host. In this container it exits with blocked rows after the launch probe; use the same command on a host with Xvfb or a native display before interpreting budgets.

## Current baseline status

The first baseline was run from branch `perf/nomi-user-workflows-20261010` against `origin/main` at `4e1eecdad`. Existing canvas-scale and project-open probes are reused as historical comparison only; their old numbers are not this task's acceptance baseline. The new workflow runner produced one raw report for small/typical/heavy fixture contracts, with all 45 scenario rows marked `blocked` before the first window because this execution environment has no `$DISPLAY`/Xvfb. The earlier canvas S-scale launch report is retained alongside it under `raw/`; neither report contributes timing numbers.

The fixture/schema node tests pass and verify the small tier's 2 documents, 2 plans, 24 shots, 4 images and 2 videos. Production UI timings, CPU, memory trend and optimization deltas remain unmeasured until a display-capable runner executes the same command with one warm-up and five measured runs.

