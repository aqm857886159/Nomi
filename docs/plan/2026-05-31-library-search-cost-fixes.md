# 三处修复：30秒体验被压扁 / 假搜索 / 无用花费徽章

> 裁决：已被资源库发现与生产计费链路取代；证据：`src/workbench/library/ProjectLibraryPage.tsx:246-285`、`src/workbench/library/ProjectLibraryPage.tsx:137-167`、`electron/productionRun/catalogPricingResolver.ts:35-58`。

> 状态：实施中
> 触发：用户反馈 ——「一开始进入30秒体验NOMI这个东西已经没了。另外搜索项目名称那个东西是假搜索，没有用。还有右上角那个花多少钱，那个也没用。没法做到就先删掉，能做到就处理。」

## 1. 三个问题的根因（已用 CDP 实测确认）

| # | 现象 | 根因 | 文件 |
|---|---|---|---|
| 1 | 「30 秒体验 Nomi」hero 只剩一行标签，标题+示例按钮没了 | hero 内容**都在 DOM 里**（实测 section 3 个子节点高度 17/52/61），但 `<main>` 是 `flex flex-col + overflow-y-auto`，项目多时内容超出视口高度（clientH 860 < scrollH 1293）。flex 子项默认 `flex-shrink:1`，且 hero `<section>` 带 `overflow-hidden` → flex 自动最小高度塌成 0 → hero 被压扁到 38px，标题/按钮被裁掉 | `src/workbench/library/ProjectLibraryPage.tsx` |
| 2 | 「搜索项目名称…」是假搜索 | `<input type="search">` 无 `value`/`onChange`，`projects.map` 从不按关键词过滤 | `ProjectLibraryPage.tsx` |
| 3 | 右上角「💰 $0.00 估算」无用 | USD 估算来自 `electron/cost/providerCostTable.ts` 的静态正则价表；kie.ai/onboarded 模型永不命中 → `estimateCost` 恒 null → 徽章恒 $0.00。同一估算还喂给节点 ProvenancePanel「估算费用」行 | cost 子系统（见 §3） |

## 2. 方案

- **#1 撑开 hero（修根因，通用）**：`<main>` 的直接子项加 `shrink-0`，让滚动容器**滚动**而不是**压扁**子项。所有 4 个子项（header/hero/search/grid）都 `shrink-0`，与项目数量无关，永不再塌。
- **#2 真搜索**：`ProjectLibraryPage` 加 `query` state + 受控 `<input>`；`projects` 按 name 不分大小写过滤后再 map。空结果时网格只剩「新建项目」卡。零新依赖。
- **#3 删除 USD 花费估算子系统**：准确成本对任意 onboarded 模型不可得（无单价元数据，静态价表纯猜），用户已拍「没法做到就删」。按规则 1（加新必删旧 / 死代码物理删除）整条删除，不留半死插桩。

## 3. #3 删除清单（区分两种 "cost"）

**保留（与花费估算无关）**：
- `useModelOptions.ts` 的 `pricing.cost` / runtime `specCosts` —— 这是 catalog 里**模型积分**配置，不是 USD 估算。
- `electron/ai/onboarding/reporter.ts` 的本地 `estimateCost(tokens, model)` —— onboarding agent 自己的 token 成本（LLM 用量），独立函数，保留。

**删除（USD 花费估算，恒 $0）**：
- 文件：`src/workbench/cost/ProjectCostBadge.tsx`、`electron/cost/costLog.ts`、`electron/cost/providerCostTable.ts`、`electron/cost/providerCostTable.test.ts`（整目录 `electron/cost/` 清空 → 删目录；`src/workbench/cost/` 同理）
- `src/ui/app-shell/NomiAppBar.tsx`：删 import + `<ProjectCostBadge>` 用法
- `electron/preload.ts`：删 `cost.projectSummary` bridge
- `src/desktop/bridge.ts`：删 `cost` 字段
- `electron/main.ts`：删 `readProjectCostSummary` import + `nomi:cost:project-summary` IPC 注册
- `electron/runtime.ts`：删 `logCostEntry`/`summarizeProjectCost` import、两处 `logCostEntry(...)` 调用、`readProjectCostSummary` 函数、`TaskResult.provenance.cost` 字段 + 其 write
- 节点 provenance 估算费用：`generationCanvasTypes.ts` 删 `cost` 字段、`generationCanvasSchema.ts` 删 `cost` zod（snapshot schema 仅测试用，不走 hydration，老项目不受影响）、`catalogTaskActions.ts:394` 删 `rec.cost` 透传、`ProvenancePanel.tsx` 删「估算费用」行 + `formatCost`

## 4. 不动什么
- 不动模型积分 `pricing.cost`/`specCosts`（catalog 真实配置）。
- 不动 onboarding reporter 的 token 成本估算（独立、可信）。
- 不动项目卡片、模板选择器、Try-Now 示例数据/流程。
- 不动 hero 的视觉样式，只加 `shrink-0` 修塌陷。

## 5. 回滚
- 单 commit；回归 `git revert`。
- #1/#2 纯前端低风险；#3 是删除，回滚即恢复整子系统。

## 6. 验收门
1. 前端 tsc 我改文件 0 新错；`pnpm exec tsc -p electron/tsconfig.json` 0 错；`pnpm test` 全绿（删 providerCostTable.test 后用例数下降属正常）。
2. #1：项目很多时，「30 秒体验」hero 完整显示标题+3 个示例按钮，main 区域可滚动。
3. #2：搜索框输入关键词，网格实时过滤。
4. #3：右上角不再有花费徽章；节点 provenance 不再有「估算费用」行；grep 无 `ProjectCostBadge`/`cost:project-summary`/`logCostEntry` 残留。

## 7. 结果（实施后回填）

实施完成（CDP 实测确认）。

- **#1 hero 撑开**：`ProjectLibraryPage.tsx` `<main>` 的 4 个直接子项（header/hero/search/grid）加 `shrink-0`。实测：项目 28 个时 hero 高度从塌陷的 38px 恢复到 196px，标题 + 3 个示例按钮完整显示，main 区域正常滚动。根因是 flex 列容器在内容超高时压扁带 `overflow-hidden` 的子项（其 flex 自动最小高度被 overflow 归零）。
- **#2 真搜索**：`ProjectLibraryPage.tsx` 加 `query` state + 受控 `<input value/onChange>`，`filteredProjects` 按 name 不分大小写过滤。实测：输入「13_00」→ 28 张卡过滤到 1 张。
- **#3 删除 USD 花费估算子系统**：
  - 删文件：`src/workbench/cost/ProjectCostBadge.tsx`、`electron/cost/{costLog,providerCostTable,providerCostTable.test}.ts`（两个 cost 目录已删空）。
  - 删引用：`NomiAppBar`（import + 用法 + 连带死掉的 `projectId` prop 链：NomiAppBar/WorkbenchShell/NomiStudioApp）、`preload.ts` cost bridge、`bridge.ts` cost 字段、`main.ts` import + IPC、`runtime.ts`（import + 两处 logCostEntry + readProjectCostSummary + provenance.cost 类型/写入）、`ProvenancePanel` 估算费用行 + formatCost、`generationCanvasTypes`/`generationCanvasSchema` cost、`catalogTaskActions` cost 透传。
  - 保留：模型积分 `pricing.cost`/`specCosts`（catalog 真实配置）、onboarding `reporter.ts` 本地 token 成本估算。

验收：electron tsc 0 错、`build:renderer` 通过、`pnpm test` 34 files / 327 + 1 todo 全绿（少的 12 个用例是删掉的 providerCostTable.test）、grep 无残留引用、已重建重启（单实例）。#1/#2 CDP 实测通过；#3 徽章组件已物理删除、无引用，无法再渲染。
