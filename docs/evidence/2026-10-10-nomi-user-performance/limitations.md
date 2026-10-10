# Limitations and blockers

Updated 2026-10-10.

## Current blockers

1. **Electron window unavailable in this execution environment.** The existing Playwright benchmark starts Electron 43.4.1 with the repository's `--no-sandbox` and SwiftShader flags, then Chromium exits with `Missing X server or $DISPLAY` because neither Xvfb nor another display server is installed. The four requested S-scale baseline scenarios are retained as failed raw samples in `raw/nomi-user-baseline-s.json`; no timing number is treated as a baseline.
2. **Cross-platform hardware is unavailable.** Windows and macOS runs, real GPU backends, and a real user profile remain `unverified`. Linux software rendering can be a later comparison leg but cannot stand in for those platforms.
3. **Private real-user material is unavailable.** The repository fixture uses generated media and synthetic local Agent stream/tool timers. No credentials or paid model calls are used. Real private documents, plans, images and videos require a user-provided sanitized fixture on a machine with a display and remain `unverified`.
4. **GitHub PR API access is unauthorized in this environment.** The branch pushed successfully at `origin/perf/nomi-user-workflows-20261010`, but both `gh pr create --repo aqm857886159/Nomi --draft ...` and `gh pr comment 1014 --repo aqm857886159/Nomi ...` returned `Post "https://api.github.com/graphql": Forbidden`. The draft PR and required #1014 status comment therefore remain pending an authorized GitHub session; the local commit and push are preserved.

## Measurement implications

The evidence directory contains the fixed matrix and budgets and the failed launch raw result. Until a display-capable runner is available, the workflow runner can be syntax-checked and its fixture/schema contracts tested, but it cannot claim input-to-visible, frame, CPU or memory values. Any optimization commit made before that run must be labelled instrumentation-only or hypothesis-driven and cannot be marked as meeting the budgets.
