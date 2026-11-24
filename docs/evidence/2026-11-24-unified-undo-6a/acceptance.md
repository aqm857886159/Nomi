t8-r6a-verify：通过

- 验收线：t8-r6a-verify
- 实现线：t8-r6a-impl
- 验收 HEAD：1d14b7a22f916d205e632aad5f9ab37ef12eaa35
- 审批设计卡基线：`d28c4fbf6`（PR #1649，`docs/plan/2026-11-24-unified-undo-history.md`）
- 特征测试前置提交：`67a33d2ea`；核心实现提交：`979710b79`；性能场景登记与原始结果补齐提交：`35f7c7eea`；全局监听普查同步收紧提交：`1d14b7a22`（仅删 `src/workbench/modalInputLayerCensus.test.ts` 中已退役的 `PreviewWorkspace.tsx` 登记项 1 行，`36 -> 35`，0 业务代码变动）

## 1. 架构硬规与同提交删旧核查

- **单一撤销键盘出口**：`src/workbench/shortcutSurface.ts` 持有唯一 `dispatchHistoryShortcut` 分发循环与优先级表（`director > layout > canvas > timeline`），每次按键组合仅派发给首个有资格的宿主面并立即返回；`src/workbench/preview/PreviewWorkspace.tsx` 已删除旧的独立 `window.addEventListener('keydown', onKeyDown)` `⌘Z` 监听，改为通过 `registerPreviewLayoutHistoryShortcut` 接入统一历史键盘分发，`SplitHandle` 交互通过 `editingPanelHistory.activate()` 显式转移当前活跃历史目标。
- **双旧手写栈同提交删除**：
  - `src/workbench/timeline/timelineUndoHistory.ts` 已在 `979710b79` 同提交删除（`D`）。
  - 源码全量扫描 `git grep -nE 'pushTimelineUndo|timelineUndoHistory|editingPanelUndoStack|\bpushUndo\b' src/ electron/` 返回 `0` 命中。
  - 时间轴（30 步上限）与剪辑面板布局（20 步上限）历史均迁入 `zundo@2.3.0`（通过 `src/workbench/history/historyMiddleware.ts` 的 `createSessionHistory` 统一管理项目会话寿命、手势合并/取消、采纳回滚检查点及 Agent 回执元数据）。
- **新增依赖与自写登记**：`package.json` 固定接入 `zundo: "2.3.0"`，`vite.config.ts` 将 `zundo` 归入 `state-vendor` 分包；`docs/engineering/self-written.json` 登记了 `workbench-session-history`（明确 `zundo` 负责两份限额历史，自写薄层仅覆盖项目会话换实例、回执 revision 授权及多面 `⌘Z` 归属）。

## 2. 独立 Vitest 实跑证据（22 文件，1873/1873 通过）

在 `979710b79` / `1d14b7a22` 上使用 `--maxWorkers=2` 独立实跑全部改动及相关核心测试（含 `1d14b7a22` 复跑 `modalInputLayerCensus.test.ts` 10/10）：

- **核心 14 个测试文件（391/391 通过）**：
  - `src/workbench/history/timelineAndLayoutHistory.test.ts`（10/10）
  - `src/workbench/timelineUndo.test.ts`（9/9）
  - `src/workbench/timeline/timelineGesture.test.ts`（12/12）
  - `src/workbench/timeline/timelineShortcuts.test.ts`（3/3）
  - `src/workbench/timeline/agent/timelineCapabilityTarget.test.ts`（12/12）
  - `src/workbench/preview/editingPanelKeep.test.ts`（25/25）
  - `src/workbench/preview/agentDockPersistence.test.ts`（14/14）
  - `src/workbench/preview/assistantWidthWriteback.test.ts`（13/13）
  - `src/workbench/shortcutSurface.test.ts`（5/5）
  - `src/workbench/shortcutSurface.matrix.test.ts`（122/122）
  - `src/workbench/shortcutSurface.modalLayer.matrix.test.ts`（104/104）
  - `src/workbench/generationCanvas/components/useCanvasShortcuts.test.ts`（23/23）
  - `src/workbench/generationCanvas/components/canvasShortcutParity.test.ts`（31/31）
  - `src/workbench/project/releaseWorkbenchProjectSession.test.ts`（8/8）
- **其余 8 个本次改动测试文件（1482/1482 通过）**：
  - `src/workbench/modalInputLayerCensus.test.ts`（10/10，在 `1d14b7a22` 实跑通过，`PreviewWorkspace.tsx` 全局监听登记移除 `36 -> 35`）
  - `src/workbench/adoption/adoptionBridge.test.ts`（11/11）
  - `src/workbench/adoption/adoptionReceipt.test.ts`（8/8）
  - `src/ui/app-shell/shell/ShellAgentHost.openWritesNothing.test.tsx`（9/9）
  - `src/workbench/assets/assetLivenessScan.test.ts`（1419/1419）
  - `src/workbench/assets/projectLivenessContent.census.test.ts`（5/5）
  - `src/workbench/generationCanvas/agent/agentTurnMutations.test.ts`（10/10）
  - `src/workbench/generationCanvas/runner/generationQueue.test.ts`（10/10）

## 3. 串行静态与治理门岗实跑证据（12/12 全绿）

| 门岗命令 | 结果 | 关键摘要 |
|---|---|---|
| `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit` | PASS | `0` 错误 |
| `./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit` | PASS | `0` 错误 |
| `node scripts/check-test-types.mjs` | PASS | `src/` `0` 错，agent-runtime `0` 错，存量 10 个棘轮未增 |
| `node scripts/check-supply-chain-pins.mjs` | PASS | 4 条版本钉在册且一致 |
| `NOMI_BASE_REF=origin/main node scripts/check-self-written.mjs` | PASS | 177 领域目录 · 65 项登记 · 新增代码文件 2 个（0 未认领） |
| `NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs` | PASS | 改动文件 `0` 错误，警告不增 |
| `pnpm run check:i18n` | PASS | 22/22 自测通过；key-parity 6623 键对齐；src 可见文案硬零 |
| `pnpm run check:concept-owners` | PASS | 58/58 自测通过；403 概念，第二写口 `0` 新增 |
| `pnpm run check:filesize` | PASS | `0` 红牌，冻结基线 33 个棘轮未增 |
| `pnpm run check:boundaries` | PASS | 3238 模块，越界/硬环 68 处未新增 |
| `pnpm run check:root-cause-contracts` | PASS | 55/55 自测通过，无高风险未覆盖路径 |
| `pnpm run check:perf-scenarios` | PASS | 23/23 自测通过，93 个性能场景结构齐全（含新增 `timeline-trim-history`） |

## 4. 独立反例破坏验证（3/3 必红，还原后全绿）

| 编号 | 破坏目标与注入方式 | 触发失败（红灯） | 还原验证 |
|---|---|---|---|
| M1 | `src/workbench/shortcutSurface.ts`：移除 `dispatchHistoryShortcut` 命中最优先面后的 `return true`，使单次 `⌘Z` 向下穿透同时撤销预览布局与时间轴 | `EXIT=1`：`timelineAndLayoutHistory.test.ts` 2/10 失败（`layoutFirst = true/false` 均报 `expected [] to have a length of 1 but got +0`，证实单键双撤被拦住） | `git checkout --` 后恢复绿灯 |
| M2 | `src/workbench/timeline/agent/timelineCapabilityTarget.ts`：绕过 `undoPlan` 中 `expectedRevision / preconditions.timeline.revision / metadata.afterRevision !== currentRevision` 的陈旧版本校验 | `EXIT=1`：`timelineCapabilityTarget.test.ts` 4/12 失败 + `timelineAndLayoutHistory.test.ts` 1/10 失败（5 例预期 `undo_stale_revision` 却错放行 `ok: true, undone: true`） | `git checkout --` 后恢复绿灯 |
| M3 | `src/workbench/adoption/adoptionStorePorts.ts`：跳过 `compensate` 中的 `rollback()` 调用 | `EXIT=1`：`adoptionBridge.test.ts` 1/11 失败（`pastStates` 残留幽灵历史条）+ `timelineAndLayoutHistory.test.ts` 1/10 失败（满容量回滚后重做期望 `'32'` 实际得 `'31'`，丢失原 redo 分支） | `git checkout --` 后恢复绿灯 |

三次破坏均在隔离工作树中即刻还原，`git status -s` 干净，复跑 `timelineAndLayoutHistory.test.ts` + `timelineCapabilityTarget.test.ts` + `adoptionBridge.test.ts` 全部 **33/33 通过（`EXIT=0`）**。

## 5. ★7 性能基准与安装包体积核验

按 `docs/plan/2026-11-24-unified-undo-history.md` ★7 预算（`timeline-trim-history` 场景：p95 ≤ 33 ms，长任务 >50 ms 为 0；实测环境：macOS arm64，Apple M5，16 GB RAM，窗口 1600×1000，5 次采样 + 1 次预热）：

- **随 PR 正式登记场景结果（`tests/perf/scenarios/timeline-trim-history.json` + `docs/evidence/2026-11-24-unified-undo-6a/perf-timeline-trim-history.json`）**：
  - 规模 `M`（24 视频片段 / 96 节点）：5 轮 `frameGapP95` 原始样本 `[23.0, 23.2, 24.4, 22.7, 23.2]` ms，中位数 **23.2 ms**，p95 **24.2 ms**（预算 ≤ **33 ms**），`longTasks` 5 轮全 **0**，`verdict.status = "ok"`。
- **双规模对比复测（`canvas-scale-bench.mjs --scales M,CLIPS200 --scenarios timeline-trim-history --runs 5 --warmup 1`）**：

| 规模档 | 视频片段数 | 5 次原始 frameP95 (ms) | 中位 frameP95 (ms) | 中位 frameP50 (ms) | 中位 maxFrame (ms) | 中位 FPS | >50 ms 长任务 | 预算判定 |
|---|---:|---|---:|---:|---:|---:|---:|---|
| `M` | 24 | `23.0, 22.8, 22.4, 22.7, 23.0` | **22.8** | 16.6 | 25.4 | 59.8 | **0** | 通过（≤ 33 ms） |
| `CLIPS200` | 200 | `23.5, 23.4, 23.6, 25.0, 23.1` | **23.5** | 16.7 | 24.1 | 59.9 | **0** | 通过（≤ 33 ms） |

安装包与产物增量核验（256 个打包 npm 身份、0 禁用文件、0 运行时闭包错误）：
- `state-vendor` chunk gzip：`+415 B`
- renderer JS gzip 总计：`+1,234 B`
- `app.asar` / 已安装应用体积：`+3,078 B`
- macOS DMG：`-32,968 B`；macOS ZIP：`-1,583 B`

## 6. 正式旧版 `v0.24.1` 往返兼容性与验证边界

- **旧→新→旧往返**：基于校验和通过的正式发布版 `v0.24.1` 与 6A 前基线执行双轨往返（`v0.24.1 → 6A → v0.24.1` 与 `基线 → 6A → 基线`），6A 保存的分镜项目可被旧版重新打开，完整分镜内容与项目 ID 每次打开完全一致，磁盘无新增历史格式。
- **未验证边界（诚实声明）**：本机为 macOS arm64 环境，原生 Windows 桌面端及 Windows 安装包运行态记为 `unverified`。
