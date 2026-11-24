t8-r6c-verify：通过

- 验收线：t8-r6c-verify
- 实现线：t8-r6c-impl
- 验收 HEAD：5ac7bfcf8bfe5fd64eb197b8a056604718fa05ad
- 审批设计卡基线：`docs/plan/2026-11-24-unified-undo-history.md`（★1–★9 Row C）
- Schema-v3 根因合同：`docs/fixes/2026-11-24-canvas-undo-patches-and-gesture-invariants.root-cause.json`
- 提交链：`e516cec67`（前置特征测试）→ `a0cbd550d`（Immer 补丁栈替换并同提交删除 `canvasUndoJournal.ts`）→ `c08ce03cf`（场景登记与桌面证据）→ `ecb02a676`（并入 6B 基线）→ `eef1a564d`（干净工作树 5 轮性能基线）→ `c4e6c59a6`（`canvasControlsStructure.test.ts:85` 1 行测试对齐，`25/25` 通过）

## 1. 规则 2：前置特征测试与同提交删旧核查

- **特征测试前置**：`e516cec67` 仅新增 `src/workbench/generationCanvas/store/canvasPatchHistory.characterization.test.ts`（327 行），先于任何实现改动锁定既有契约与手势/淘汰缺口。
- **旧日志前缀重放彻底删除**：`a0cbd550d` 同提交新增 `src/workbench/generationCanvas/events/canvasDocumentPatches.ts`（126 行）与 `src/workbench/generationCanvas/events/canvasPatchHistory.ts`（225 行），同提交删除 `src/workbench/generationCanvas/events/canvasUndoJournal.ts`（291 行，文件已不存在）并移除 `canvasEventEmitter.ts` 中对 `appendToUndoJournal` 的接入。
- **源码全仓零残留**：`git grep -nE 'appendToUndoJournal|canvasUndoJournal' src/ electron/` 返回 `0` 命中；`origin/feat/unified-undo-6b-director...HEAD` 全部新增 diff 行及提交说明无任何本机路径泄露。

## 2. 规则 3：资金安全与核心不变量反例破坏验证（3/3 必红，还原后全绿）

在隔离验收工作树中独立注入 3 项反向故障变异（全部触发 Vitest 必红，随后 `git checkout -- .` 还原，工作树干净，复跑 `66/66` 全绿）：

| 编号 | 破坏目标与注入方式 | 触发失败（红灯） | 还原验证 |
|---|---|---|---|
| M1（资金安全必查） | `src/workbench/generationCanvas/events/canvasPatchHistory.ts:168` 将 `landingsAfter: step.landings` 改为 `[]`，并在 `canvasDocumentPatches.ts:100` 跳过 `withLiveNodeFacts`，模拟撤销时擦除异步落盘生成结果/版本/运行事实 | `EXIT=1`：`canvasPatchHistory.characterization.test.ts` 5/22 失败（含 10 连按撤销保付费结果与新建容器保活）+ `undoKeepsLandedResults.test.ts` 4/44 失败（合计 **9/66 失败**） | `git checkout -- .` 后恢复绿灯 |
| M2（redo 截断回收通知） | `src/workbench/generationCanvas/events/canvasPatchHistory.ts:85-87` 清空 `redo.splice(0)` 时不将其传入 `discard()`，仅在 81 步满容量淘汰时通知资产 owner | `EXIT=1`：`canvasPatchHistory.characterization.test.ts` 1/22 失败（`notifies the asset owner when a fresh edit discards a reachable redo branch below capacity`） | `git checkout -- .` 后恢复绿灯 |
| M3（Esc 取消拖拽写回闸） | `src/workbench/generationCanvas/reactFlow/canvasDragWriteback.ts:117` 移除 `!wasDragging` 判定，允许已按 `Escape` 取消的拖拽在 stop 事件中写回位置与历史 | `EXIT=1`：`canvasPatchHistory.characterization.test.ts` 1/22 失败（`Escape on the active drag host cancels writeback and preserves the previous redo`：预期 `{x:100,y:50}` 实际落到 `{x:310,y:96}`） | `git checkout -- .` 后恢复绿灯 |

还原后复跑 `canvasPatchHistory.characterization.test.ts`（22/22）+ `undoKeepsLandedResults.test.ts`（44/44）合计 **66/66 通过（`EXIT=0`）**。

## 3. 独立 Vitest 核心回归与 11 项串行治理门岗（全部 `EXIT=0`）

- **14 套核心 Vitest 独立实跑（`--maxWorkers=2`，14/14 文件，1,632/1,632 通过）**：
  - `src/workbench/generationCanvas/store/canvasPatchHistory.characterization.test.ts`（22/22）
  - `src/workbench/modalInputLayerCensus.test.ts`（10/10）
  - `src/workbench/generationCanvas/store/undoKeepsLandedResults.test.ts`（44/44）
  - `src/workbench/generationCanvas/store/wholeWriteKeepsFacts.test.ts`（PASS）
  - `src/workbench/generationCanvas/store/deletedNodeArrivingOutcome.test.ts`（18/18）
  - `src/workbench/generationCanvas/store/productionCanvasHistorySignals.test.ts`（8/8）
  - `src/workbench/assets/deleteAssetResult.realStore.test.ts`（PASS）
  - `src/workbench/assets/assetDeletionMatrix.test.ts`（49/49）
  - `src/workbench/assets/assetLivenessScan.test.ts`（1,419/1,419）
  - `src/workbench/generationCanvas/agent/proposalUndo.test.ts`（8/8）
  - `src/workbench/generationCanvas/agent/proposalTxn.property.test.ts`（1/1）
  - `src/workbench/generationCanvas/nodes/director/agent/proposalUndo.embeddedEditor.test.ts`（2/2）
  - `src/workbench/generationCanvas/events/shotNumberingLegacyReplay.test.ts`（5/5）
  - `src/workbench/generationCanvas/events/canvasWriteBoundary.test.ts`（8/8）

- **11 项串行静态与治理门岗全绿（`EXIT=0`）**：

| 门岗命令 | 结果 | 关键摘要 |
|---|---|---|
| `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit` | PASS | `0` 错误 |
| `./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit` | PASS | `0` 错误 |
| `node scripts/check-test-types.mjs` | PASS | `src/` `0` 错，agent-runtime `0` 错，存量 10 棘轮未增 |
| `pnpm run check:root-cause-contracts` | PASS | 55/55 自测通过，schema-v3 合同有效 |
| `pnpm run check:perf-scenarios` | PASS | 23/23 自测通过，95 个性能场景结构齐全 |
| `pnpm run check:boundary-owners` | PASS | 历史合同锚点与新符号全部在位 |
| `pnpm run check:concept-owners` | PASS | 58/58 自测通过，第二写口 `0` 新增 |
| `pnpm run check:filesize` | PASS | `0` 红牌，33 个基线棘轮未增 |
| `pnpm run check:i18n` | PASS | 22/22 自测通过，6623 键中英对齐 |
| `NOMI_BASE_REF=origin/main node scripts/check-self-written.mjs` | PASS | 新增代码文件 7 个，0 未认领 |
| `NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs` | PASS | 143 个改动文件，0 错误，警告不增 |

## 4. 规则 4：★7 性能基准、O(1)-in-H 与字节预算核验

- **正式 5 轮干净树基线（`tests/perf/scenarios/canvas-undo-landed-200.json` + `docs/evidence/2026-11-24-unified-undo-6c/perf-canvas-undo-landed-200.json`）**：
  - `"dirty": false`（Apple M5 / macOS arm64 / 16 GB，200 节点 + 200 次 20 节点成组移动 + 已落盘生成结果 + 双向各 80 步撤销/重做校验）。
  - 主指标 `response`：5 轮 `[17.8, 17.6, 17.8, 18.2, 17.8]` ms，中位数 **17.8 ms**，p95 **18.1 ms**（预算 `100 ms`，`p95Budget = 150 ms`）。
  - 同步 store 派发 `projectionMs`：中位数 **0.8 ms**，p95 **1.1 ms**；`longTasks` 5 轮全 **0**；GC 后堆内存 `heapUsedMiB` 中位数 **38.7 MiB** / p95 **39.1 MiB**；`verdict.status = "ok"`。
- **O(1)-in-H 与补丁字节预算（`docs/evidence/2026-11-24-unified-undo-6c/history-budgets.json`）**：
  - `H = 20 / 200 / 1,600` 前置编辑下单步撤销读取无关历史前缀数均为 **`0 / 0 / 0`**；
  - 单节点移动补丁 **`316 B`**（≤ 1,024 B）、最大 20 节点成组移动 **`3,627 B`**（≤ 8,192 B）、80 步常驻 **`290,162 B`**（≤ 655,360 B）、会话释放后 `releasedIndexes = 0`。

## 5. 真桌面双语截图目视核查与验证边界

- **8 张真实隔离 Electron 截图逐张 `read_file` 目视通过**（`docs/evidence/2026-11-24-unified-undo-6c/`）：
  - `before-escape-drag.{zh-CN,en}.png` → `after-escape-drag-and-redo.{zh-CN,en}.png`：Escape 取消拖拽归位后，重做准确恢复至位移后坐标 `(515.56, 89)`，中英界面无混语、无遮挡错位。
  - `redo-available.{zh-CN,en}.png` → `after-return-to-origin-and-redo.{zh-CN,en}.png`：拖回原点不吞 redo，重做准确恢复 `340px → 380px` 缩放宽度，界面完整清晰。
- **10 连按 `⌘Z` 付费结果保活与旧版往返（`docs/evidence/2026-11-24-unified-undo-6c/desktop.json`）**：
  - `zh-CN` 与 `en` 双轨在异步结果落盘后连按 10 次 `⌘Z`，节点、媒体尺寸 `1200×800`、`assetId: "paid-asset"`、`runId: "paid-record"`、`settledStatus: "success"` 与版本 100% 保留，`paidCalls = 0`。
  - `v0.24.1 → 6C → v0.24.1` 与 `6B → 6C → 6B` 双向往返打开均保留分镜、画布节点 ID 与 6C 编辑提示词，磁盘无新增历史格式。
- **诚实未验证边界**：本机严禁消费真实付费 API 额度（`NOMI_SPEND_OK` 未设），真实付费抽检记为 `unverified` 留待协调周四复核；原生 Windows 桌面端 `Ctrl+Z` 与 Windows 安装包运行态记为 `unverified`。

## 6. CI 修复与 `origin/main` 合入独立复验（`87ef9f870f01ac7022cb41f74ae20a92699df5fe`）

- **修复核查**：
  - `git diff origin/main HEAD --exit-code -- src/workbench/generationCanvas/components/canvasDraggingFlag.ts` 返回 0（零改动，静态依赖循环已彻底消除）；
  - `src/workbench/generationCanvas/events/canvasUndoJournal.ts` 保持彻底删除状态；
  - 节点与组拖拽已恢复忽略 Escape 的契约（松手一次提交，一次 Undo 回到起点），提交日志与增量 diff 均含 **0 处**本机路径泄露。
- **独立复跑全绿（`EXIT=0`）**：
  - `pnpm exec vitest run --maxWorkers=2 src/workbench/generationCanvas/store/canvasPatchHistory.characterization.test.ts tests/ux/selection-drag-lifecycle.test.mjs`：**2 passed · 37/37 passed**（22 + 15）；
  - `node ./scripts/check-boundaries.mjs`：**✅ 3238 模块 · 53/53 基线冻结 · 0 新增越界/硬环**；
  - `pnpm run check:filesize`、`node scripts/check-root-cause-contracts.mjs`、`node scripts/check-boundary-owners.mjs`（2141 条）、`tsc -p tsconfig.app.json --noEmit`、`tsc -p electron/tsconfig.json --noEmit`、`node scripts/check-test-types.mjs`（`src/ 0 错`）、`NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs`（143 文件 0 错 0 新增警告）：**✅ 全绿**。

## 7. 概念 owner 登记与上游 6B 基线整合增量复验（`21a7fd1c2b8544b733efc5487b307b2d48bcedc2`）

- **增量核查**：干净合入 `origin/feat/unified-undo-6b-director`（`18eb2e2e2`）并在 `docs/engineering/concept-owners/canvas.gesture-lifetime.json` 登记 `src/workbench/generationCanvas/nodes/useNodeDragResize.ts#useNodeDragResize`（相对 `9f42a3676` 仅 4 行 JSON 登记增量，生产业务代码 **0 改动**，提交日志与增量 diff **0 本机路径泄露**）。
- **独立复跑全绿（`EXIT=0`）**：
  - `CONCEPT_OWNERS_BASE_REF=origin/main node scripts/check-concept-owners.mjs`：**✅ 401/401 概念通过（converged 397 / pending 4 · 写接口 1063 个 · 第二写口 0 新增）**；
  - `ROOT_CAUSE_BASE_REF=origin/main node scripts/check-root-cause-contracts.mjs`：**✅ 通过**；
  - `node scripts/check-boundaries.mjs`（3238 模块 · 53/53 冻结 · 0 新增越界）与 `node scripts/check-boundary-owners.mjs`（2141 条）：**✅ 全绿**；
  - `canvasPatchHistory.characterization.test.ts`：**22/22 passed**；
  - 串行 `tsc -p tsconfig.app.json --noEmit` 与 `tsc -p electron/tsconfig.json --noEmit`：**0 错**。

## 8. 合入最新 6A+6B 与主干（`#1647`）冲突解算及性能刷新增量复核（`9912060d1d30c3e5ab921006379cf858903e2d9c`）

- **冲突解算核查（合并提交 `3788b74d7`）**：
  - `git diff 3788b74d7^1 3788b74d7 -- src/workbench/assets/pendingAssetDeletions.ts` 为空，完整保留 6C 对 `canvasPatchHistory`（`readReachableUndoNodes` + `registerUndoHistoryEvictionHandler`）的依赖接线、`export function releaseEvictedAssetDeletions`（`discardedPositions` 判定 + 可达历史帧重锚定 + 微任务回收）与 `listMemo = null` 清理，未回退至已删除的 `canvasUndoJournal`；
  - 首父链增量提交（`3788b74d7`、`9912060d1`）及本验收单 **0 本机路径泄露**。
- **干净树性能基线刷新核查（`9912060d1`，`docs/evidence/2026-11-24-unified-undo-6c/perf-canvas-undo-landed-200.json`）**：
  - `"dirty": false`（`head: 3788b74d78d3d368728faba1fa99a41f39c9c187`），`canvas-undo-landed-200` 5 轮 `response` 中位数 **17 ms** / p95 **17.3 ms**（预算 `100 ms`），`projectionMs` 中位数 **0.9 ms** / p95 **0.9 ms**，`longTasks` 全 **0**，`heapUsedMiB` 中位数 **38.7 MiB** / p95 **39.2 MiB**，`verdict.status = "ok"`。
- **独立复跑全绿（`EXIT=0`）**：
  - 4 套核心 Vitest（`--maxWorkers=2`：`canvasPatchHistory.characterization.test.ts`、`undoKeepsLandedResults.test.ts`、`assetDeletionMatrix.test.ts`、`assetLiveness.realStore.test.ts`）：**4/4 文件，122/122 passed**；
  - 串行 `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit` 与 `./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit`：**0 错误**；
  - `node scripts/check-self-written.mjs`：**✅ 177 个领域目录 · 67 项登记 · 新增代码文件 7 个（0 个未认领）**；
  - `CONCEPT_OWNERS_BASE_REF=origin/main node scripts/check-concept-owners.mjs`：**✅ 405 个概念（converged 401 / pending 4）· 写接口 1072 个 · 第二写口 0 新增**。

## 9. 合入主干（`#1657`）解 `boundary-owners` 冲突增量复验（`5ac7bfcf8bfe5fd64eb197b8a056604718fa05ad`）

- **冲突解算核查（`git show --cc 5ac7bfcf8bfe5fd64eb197b8a056604718fa05ad`）**：
  - 合并冲突仅涉及 `scripts/boundary-owners-ledger.json` 一处，完整并存本分支 4 条 `src/workbench/generationCanvas/events/canvasUndoJournal.ts` 改锚记录与 `#1657` 新增的 1 条 `src/design/outsidePress.ts`（`listenOutsidePress` → `src/design/overlayLayers.ts#useFloatingOutsideDismiss`）改锚记录；
  - 合并提交未对任何 `src/` 业务代码做人工修改或冲突改动，提交信息与本验收单均 **0 本机路径泄露**。
- **独立复跑全绿（`EXIT=0`）**：
  - `pnpm run check:boundary-owners`：**27/27 自测通过 · ✅ 边界主人门禁通过（声明 2150 条：在位 1881 ｜ 改锚 87 ｜ 退役 87 ｜ 待查 10 ｜ symbol 机器读不了 85）**。
