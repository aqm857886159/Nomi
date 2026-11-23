t8-r3-verify：通过

- 验收线：t8-r3-verify
- 实现线：t8-r3-cache-impl
- 验收 HEAD：bca1f0ecf3e36b6c6456aab535dfd35de097eb46
- 关联任务：协作看板 #1586 · T-8 第 ③ 刀（`lru-cache@10.4.3` + `swr` → 唯一入口 `electron/shared/boundedCache.ts`，叠在 PR #1645 `refactor/p-retry-policy` 之上，已并入最新 `origin/main` `6ed4c34b8`）

## 1. 对照 `docs/plan/2026-11-24-bounded-cache-lru.md` ★9 逐项核查

1. **冻结账本与依赖核查**：
   - `eslint-suppressions.json` 中 `generic-map-eviction/no-restricted-syntax` 存量精确由 **`21 → 9`**（12 个零冲突业务文件全部清零）；仅剩受在途 PR 保护的 4 个文件：`electron/assets/providerMediaFetch.ts`（1，#1638）、`electron/capabilityCore/apimartGenerationProvider.ts`（5，#1642）、`electron/capabilityCore/canvasTransportProvider.ts`（2，#1642）、`electron/productionRun/productionGenerationHistory.ts`（1，#1642）。
   - `generic-retry-loop/no-restricted-syntax` = **0**、`generic-raw-rename/no-restricted-syntax` = **0**。
   - `package.json` 精确锁定 `"lru-cache": "10.4.3"`（无 `^` 范围漂移），渲染查询依赖 `"swr": "^2.4.1"` 保持不变。
2. **共享入口与 12 处业务迁移核查**：
   - 核查 `electron/shared/boundedCache.ts`（122 行，`BoundedCache` + `createSingleFlightCache`）已在 `docs/engineering/self-written.json`（`id: bounded-cache-adapter`）规范登记，底层直接委托 `lru-cache@10.4.3` 管理容量与淘汰，仅桥接跨端墙钟 TTL、FIFO 原位更新、单飞合流与失败释键。
   - 12 个消费点及 `taskAdmission.ts` / `readTask.ts` 全部收口到 `electron/shared/boundedCache.ts`；`src/ui/toast.tsx` 与 `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardDrawingTool.tsx` 逐行 diff 核对 **JSX / 样式 / 文案 0 改动**。
3. **首轮拦回与次轮复验闭环**：
   - 首轮（`0bb98f827f6e831bac0bdc5cdb3bdd50f4f6e5f3`）独立跑门岗捕获 2 个真 CI 阻断（均源于多余拆分 `useWhiteboardDocumentHistory.ts`）：① `check-self-written.mjs` 报 `useWhiteboardDocumentHistory.ts` 命中 `genericZones` 未认领；② `lint-changed.mjs` 报 `WhiteboardDrawingTool.tsx` 新增 3 条 `react-hooks/exhaustive-deps` 警告（`0 → 3`）。
   - 次轮（`bca1f0ecf3e36b6c6456aab535dfd35de097eb46`）核查已删除 `useWhiteboardDocumentHistory.ts` 并在 `WhiteboardDrawingTool.tsx` 原位内联 `BoundedCache`：`WhiteboardDrawingTool.tsx` 格式化代码行 **`882 < 922`**（低于迁移前 883 行与冻结上限 922 行），`check-self-written.mjs` 与 `lint-changed.mjs` 双双清零复绿。
4. **路径隐私核查**：相对基线全量 diff 与本验收报告均含 **0 处**本机绝对路径或工作树路径泄露。

## 2. 独立实跑命令与结果

### 2.1 核心单测全绿（`--maxWorkers=2`）
- **13 套核心单测（`boundedCache` + 12 个消费方套件）**：**13 passed / 158 passed**
  - `electron/shared/boundedCache.test.ts`：11/11
  - `electron/agentLane/laneApprovalGate.undo.test.ts`：4/4
  - `electron/agentLane/laneToolInputBoundary.test.ts`：48/48
  - `electron/ai/onboarding/vendorPricePreview.test.ts`：8/8
  - `electron/capabilityCore/generationDocumentPlan.test.ts`：1/1
  - `electron/capabilityCore/projectLease.test.ts`：7/7
  - `electron/integrationCertification/credentialElicitation.test.ts`：8/8
  - `electron/tasks/taskCache.test.ts`：5/5
  - `src/ui/toastOccurrence.test.ts`：10/10
  - `src/workbench/adoption/adoptionBridge.test.ts`：12/12
  - `src/workbench/api/taskApi.telemetry.test.ts`：13/13
  - `src/workbench/generationCanvas/nodes/whiteboard/useWhiteboardFrameSize.test.tsx`：18/18
  - `src/workbench/observability/perfCollector.test.ts`：13/13
- **次轮 `bca1f0ecf3e3` 复跑白板全套 + `boundedCache`**：`src/workbench/generationCanvas/nodes/whiteboard/`（10 文件）+ `electron/shared/boundedCache.test.ts` → **11 passed / 120 passed**（白板 109/109 + `boundedCache` 11/11）。

### 2.2 三项独立变异反例测试（全部必红 → 还原 100% 复绿）
1. **M1（破坏容量淘汰：`electron/shared/boundedCache.ts` 将 `max` 改为 `999999`）**：运行 `boundedCache.test.ts` + `taskApi.telemetry.test.ts` → **2 failed files · 9 failed / 15 passed (24)**（覆盖 `access`/`write`/`fifo` 淘汰顺序、`onEvict` 回调、`evictBeforeSet` 与 `taskApi` 上限淘汰，`exit=1`）。
2. **M2（破坏单飞失败释放：`electron/shared/boundedCache.ts` 注释 `cache.delete(key)`）**：运行 `boundedCache.test.ts` + `vendorPricePreview.test.ts` → **2 failed files · 3 failed / 16 passed (19)**（`shares a pending load and retries a rejected load` 与 `vendorPricePreview` 失败重试双双变红，`exit=1`）。
3. **M3（业务文件写回手写淘汰：在 `electron/tasks/taskCache.ts` 临时加入 `m.delete(m.keys().next().value!)`）**：运行 `./node_modules/.bin/eslint electron/tasks/taskCache.ts` → **1 error**（`generic-map-eviction/no-restricted-syntax` 立即拦截，`exit=1`）。
4. **还原复绿**：`git checkout -- .` 恢复干净后复跑上述 3 套单测 → **3 passed / 32 passed (`exit=0`)**。

### 2.3 全套仓库门岗实跑（均 `EXIT=0`）
- `./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit`：✅ 0 错
- `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`：✅ 0 错（次轮复跑通过）
- `node scripts/check-test-types.mjs`：✅ 0 新增错
- `node scripts/check-boundaries.mjs`：✅ 3241 模块 · 68 基线冻结 · 0 新增越界/硬环
- `node scripts/check-boundary-owners.mjs`：✅ 声明 2134 条 · 0 错
- `node scripts/check-concept-owners.mjs`：✅ 403 概念 · 1060 写接口 · 0 新增第二写口
- `node scripts/check-self-written.mjs`：✅ 177 领域目录 · 66 登记 · 新增 5 文件 0 未认领（次轮复跑 `EXIT=0`）
- `node scripts/check-file-sizes.mjs`：✅ 0 超限（`WhiteboardDrawingTool.tsx` 882 行 < 冻结上限 922）
- `pnpm run check:package-budget`：✅ 10/10 通过 · `package-budget.json` 形状完整
- `node scripts/lint-changed.mjs`：✅ 38 改动文件 · 0 错误 · 0 新增警告（次轮复跑 `EXIT=0`）
- `pnpm run lint:ci`：✅ 0 error（87 条基线存量警告，0 未使用抑制项）
- `node scripts/fix-churn.mjs --range origin/main..HEAD`：✅ 0 个未带 `Direction-Check` 的热点 fix

## 3. 未验证范围说明
- 真桌面窗口交互走查（中文 / 英文 / 窄窗截图）、Windows 真机、真实规模负载、端到端断连恢复及真实付费样本均诚实记为 `unverified`（本次改动限进程内缓存保留与单飞收口，白板与通知 JSX / 样式 / 文案零改动，零真实付费调用）。
