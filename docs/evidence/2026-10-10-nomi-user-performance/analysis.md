# Nomi user workflow performance analysis

Generated from 2 raw reports in `<repo>/docs/evidence/2026-10-10-nomi-user-performance/raw`.

The matrix and budgets in `scenario-matrix-and-budget.md` are fixed before measurement. A blocked row has no timing value and cannot be compared with a budget.

| Scale | Scenario | Status | Visible/action p95 (ms) | Frame p95 (ms) | Frame p99 (ms) | Long task p95 (ms) | Dropped p95 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| small | P1 | blocked | — | — | — | — | — |
| small | P2 | blocked | — | — | — | — | — |
| small | D1 | blocked | — | — | — | — | — |
| small | D2 | blocked | — | — | — | — | — |
| small | B1 | blocked | — | — | — | — | — |
| small | B2 | blocked | — | — | — | — | — |
| small | C1 | blocked | — | — | — | — | — |
| small | C2 | blocked | — | — | — | — | — |
| small | C3 | blocked | — | — | — | — | — |
| small | A1 | blocked | — | — | — | — | — |
| small | A2 | blocked | — | — | — | — | — |
| small | A3 | blocked | — | — | — | — | — |
| small | A4 | blocked | — | — | — | — | — |
| small | R1 | blocked | — | — | — | — | — |
| small | R2 | blocked | — | — | — | — | — |
| typical | P1 | blocked | — | — | — | — | — |
| typical | P2 | blocked | — | — | — | — | — |
| typical | D1 | blocked | — | — | — | — | — |
| typical | D2 | blocked | — | — | — | — | — |
| typical | B1 | blocked | — | — | — | — | — |
| typical | B2 | blocked | — | — | — | — | — |
| typical | C1 | blocked | — | — | — | — | — |
| typical | C2 | blocked | — | — | — | — | — |
| typical | C3 | blocked | — | — | — | — | — |
| typical | A1 | blocked | — | — | — | — | — |
| typical | A2 | blocked | — | — | — | — | — |
| typical | A3 | blocked | — | — | — | — | — |
| typical | A4 | blocked | — | — | — | — | — |
| typical | R1 | blocked | — | — | — | — | — |
| typical | R2 | blocked | — | — | — | — | — |
| heavy | P1 | blocked | — | — | — | — | — |
| heavy | P2 | blocked | — | — | — | — | — |
| heavy | D1 | blocked | — | — | — | — | — |
| heavy | D2 | blocked | — | — | — | — | — |
| heavy | B1 | blocked | — | — | — | — | — |
| heavy | B2 | blocked | — | — | — | — | — |
| heavy | C1 | blocked | — | — | — | — | — |
| heavy | C2 | blocked | — | — | — | — | — |
| heavy | C3 | blocked | — | — | — | — | — |
| heavy | A1 | blocked | — | — | — | — | — |
| heavy | A2 | blocked | — | — | — | — | — |
| heavy | A3 | blocked | — | — | — | — | — |
| heavy | A4 | blocked | — | — | — | — | — |
| heavy | R1 | blocked | — | — | — | — | — |
| heavy | R2 | blocked | — | — | — | — | — |

Measured rows: 0; blocked rows: 45.

## Blocked rows

- small: 15 rows — launch_error:  ❌ Nomi 走查启动失败（nomi-user-perf-small）：Electron 起不来（electron.launch 失败/超时，5000ms）  按可能性排查：   1) 构建产物过期 —— 走查跑的是 dist-electron 的产物，不是源码。改完代码没重新构建，      或主进程启动时就抛错，都会长这样。→ pnpm run build 后重跑。   2) 主进程启动即退/崩溃 —— 看下面那几行主进程输出，真正的线索基本都在那儿。   3) 单实例锁 —— 本启动器**已强制** NOMI_E2E_
- typical: 15 rows — launch_error:  ❌ Nomi 走查启动失败（nomi-user-perf-typical）：Electron 起不来（electron.launch 失败/超时，5000ms）  按可能性排查：   1) 构建产物过期 —— 走查跑的是 dist-electron 的产物，不是源码。改完代码没重新构建，      或主进程启动时就抛错，都会长这样。→ pnpm run build 后重跑。   2) 主进程启动即退/崩溃 —— 看下面那几行主进程输出，真正的线索基本都在那儿。   3) 单实例锁 —— 本启动器**已强制** NOMI_E2
- heavy: 15 rows — launch_error:  ❌ Nomi 走查启动失败（nomi-user-perf-heavy）：Electron 起不来（electron.launch 失败/超时，5000ms）  按可能性排查：   1) 构建产物过期 —— 走查跑的是 dist-electron 的产物，不是源码。改完代码没重新构建，      或主进程启动时就抛错，都会长这样。→ pnpm run build 后重跑。   2) 主进程启动即退/崩溃 —— 看下面那几行主进程输出，真正的线索基本都在那儿。   3) 单实例锁 —— 本启动器**已强制** NOMI_E2E_

## Interpretation

- Model/network wait is represented by `fixture.agent` and must be read separately from UI timing.
- No production optimization is claimed until a display-capable runner produces baseline samples for the same matrix.

