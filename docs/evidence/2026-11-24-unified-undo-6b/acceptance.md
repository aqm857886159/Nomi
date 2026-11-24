t8-r6b-verify：通过

- 验收线：t8-r6b-verify
- 实现线：t8-r6b-impl
- 验收 HEAD：f08a8f57c08a39dcf20a01c6f3093ad2ac02dad2
- 关联任务：协作看板 #1586 · 7 大替换第 ⑥ 刀 PR 6B（`feat/unified-undo-6b-director`，叠在 PR `#1651` `feat/unified-undo-6a-timeline-layout` `c7d5e6affa79` 之上）
- 设计卡：`docs/plan/2026-11-24-unified-undo-history.md`（★9 Row B）

## 1. 提交序列、同提交删旧与架构核查

1. **先特征测试再迁移删旧**：
   - `a38b84032`：前置仅新增 `src/workbench/generationCanvas/nodes/director/model/directorHistory.characterization.test.ts`（199 行），先锁死旧导演台 50 步历史、200ms 滚轮分字段合并、嵌套 `withHistory` 异常回滚与隐藏层不抢键行为；
   - `82ad86cb5`：同提交新增 `src/workbench/generationCanvas/nodes/director/model/directorHistory.ts`（145 行，基于 `zundo@2.3.0` `temporal` + `HISTORY_LIMIT = 50` + `WHEEL_MERGE_MS = 200`），同步删除旧手写 `HistoryEntry` / `undoStack` / `redoStack` 双数组与逐帧全工程 `JSON.stringify` 快照逻辑（`git grep -nE '\bHistoryEntry\b|undoStack|redoStack' src/workbench/generationCanvas/nodes/director/` 为 **0 命中**），并将 `useDirectorHistoryShortcut` 接入唯一分发出口 `shortcutSurface.ts`（`registerHistoryShortcut('director', ...)`）；
   - `f08a8f57c08a`（基于 `origin/feat/unified-undo-6a-timeline-layout` + 最新 `origin/main` `1f4d15189` 干净重建）：核实相对 `8f5c20aec` 在导演台代码、性能脚本与场景登记上 0 字节差异，且提交历史零本机路径泄露。
2. **路径隐私核查**：相对 `c7d5e6affa79..HEAD` 全量 28 文件 diff 及本验收报告均含 **0 处**本机绝对路径或临时目录泄露。

## 2. 独立实跑单测、变异反例与全套门岗

### 2.1 核心 Vitest 套件全绿（`--maxWorkers=2`，12 套件 **1,695/1,695 通过**）
- **批次 1（9 套件，1,674/1,674 通过）**：
  - `src/workbench/generationCanvas/nodes/director/model/directorHistory.characterization.test.ts`（11/11）
  - `src/workbench/generationCanvas/nodes/director/model/directorSceneTransactions.test.ts`（44/44）
  - `src/workbench/generationCanvas/nodes/director/scene/ViewCamera.test.ts`（39/39）
  - `src/workbench/generationCanvas/nodes/director/model/actionIds.test.ts`
  - `src/workbench/modalInputLayerCensus.test.ts`
  - `src/workbench/history/timelineAndLayoutHistory.test.ts`
  - `src/workbench/shortcutSurface.test.ts`、`shortcutSurface.matrix.test.ts`、`shortcutSurface.modalLayer.matrix.test.ts`
- **批次 2（3 套件，21/21 通过）**：
  - `src/workbench/generationCanvas/nodes/director/agent/proposalUndo.embeddedEditor.test.ts`
  - `src/workbench/generationCanvas/agent/proposalUndo.test.ts`
  - `src/workbench/generationCanvas/agent/proposalUndoReceiptLifecycle.test.ts`

### 2.2 四项独立变异反例测试（4/4 必红 → `git checkout -- .` 还原 100% 复绿）
1. **M1（容量上限降为 49：`directorHistory.ts` `HISTORY_LIMIT = 49`）**：运行 `directorHistory.characterization.test.ts` → **1 failed / 10 passed (11)**（第 50 步撤销停在 `#3` 而非 `#2`，`exit=1`）。
2. **M2（破坏滚轮跨字段切分：移除 `gesture.wheel.field !== field`）**：运行 `directorHistory.characterization.test.ts` → **1 failed / 10 passed (11)**（`switching wheel fields splits even when both edit the same property` 误合并 X/Y 轴，`exit=1`）。
3. **M3（破坏 `withHistory` 异常回滚：注释 `catch` 中的 `set(before)`）**：运行 `directorHistory.characterization.test.ts` + `directorSceneTransactions.test.ts` → **3 failed / 52 passed (55)**（异常后遗留脏场景/脏对象，`exit=1`）。
4. **M4（破坏隐藏层不抢键守卫：移除 `useDirectorHotkeys.ts#useDirectorHistoryShortcut` 的 `if (!layerActive) return`）**：运行 `ViewCamera.test.ts` → **1 failed / 38 passed (39)**（隐藏态多挂 1 个 `keydown` 监听，`exit=1`）。
5. **还原复绿**：`git checkout -- .` 恢复干净后复跑上述 3 套件 → **55/55 + 39/39 全部复绿 (`exit=0`)**。

### 2.3 串行静态与治理门岗（11/11 全绿 `EXIT=0`）
- `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`：✅ 0 错
- `./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit`：✅ 0 错
- `node scripts/check-test-types.mjs`：✅ `src/` 0 错（存量 10 个只减不增）
- `NOMI_BASE_REF=origin/main node scripts/check-self-written.mjs`：✅ 177 领域目录 · 65 登记 · 新增 4 文件 0 未认领
- `NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs`：✅ 76 改动文件 · 0 错误 · 0 新增警告
- `node scripts/check-file-sizes.mjs`：✅ 0 红牌超限
- `pnpm run check:i18n`：✅ 22/22 单测 + `visible-text` + `key-parity`（6623 keys）+ `key-ref`（1816 文件）+ `fragile-match` + `test-copy-literals` 全绿
- `pnpm run check:perf-scenarios`：✅ 23/23 单测 + **94 个场景**结构齐全（含 `director-gesture-history`）
- `node scripts/check-boundaries.mjs`：✅ 3239 模块 · 68 基线冻结 · 0 新增越界
- `node scripts/check-concept-owners.mjs`：✅ 403 概念 · 1060 写接口 · 0 新增第二写口
- `node scripts/check-supply-chain-pins.mjs`：✅ 4 条版本钉一致

## 3. 真 Electron 性能基准与连续手势零整工程序列化实证（`director-gesture-history`）

原始结果：`docs/evidence/2026-11-24-unified-undo-6b/perf-director-gesture-history.json`；场景登记：`tests/perf/scenarios/director-gesture-history.json`；测量脚本：`tests/perf/director-gesture-history.mjs`（隔离真 Electron `1280×933`，满 50 步历史后连续 120 帧 range 拖动 + 120 帧滚轮调参 + 单步撤销/重做 + 50 步排空校验，Apple M5 / macOS arm64 / 16GB）：

| 指标 / 手势 | 样本数 / 轮次 | 中位数 / p50 | p95 | 预算 / 约束 | 整工程 `JSON.stringify` 次数 |
|---|---:|---:|---:|---|---:|
| 登记场景 `director-gesture-history`（`frameGapP95`） | 5 轮（`18.2 / 18.0 / 17.8 / 18.2 / 17.9`） | **18.0 ms** | **18.2 ms** | ≤ 33 ms（`ok`） | — |
| 登记场景 `longTasks`（`>50ms`） | 5 轮（`0 / 0 / 0 / 0 / 0`） | **0** | **0** | = 0（`ok`） | — |
| 连续滑条拖动（`drag`） | 120 帧 | 16.7 ms | 17.7 ms（max 18.7 ms） | 单步撤销/重做一致 | **0** |
| 连续滚轮调参（`wheel`） | 120 帧 | 16.7 ms | 17.2 ms（max 18.4 ms） | 单步撤销/重做一致 · 排空深度 50 | **0** |

## 4. 未验证范围与协调待确认项说明
- **未验证（`unverified`）**：原生 Windows 桌面与打包安装态运行（本次桌面性能与双语抽查均在 macOS arm64 执行，0 供应商调用与 0 花费）；本次 6B 仅迁移导演台内存撤销栈与快捷键路由，不改动磁盘工程格式与任何可见界面外观（`internal-no-visible-change`）。
- **合并前协调确认项（`merge-preflight` 提示）**：开 PR 后需协调执行 `node scripts/coord-approve.mjs --pr <号> --perf director-gesture-history`（以及若以 `main` 为基线合并时含 `--perf timeline-trim-history`）。
