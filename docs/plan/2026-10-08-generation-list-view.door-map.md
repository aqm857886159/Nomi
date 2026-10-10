# 门表：列表新增的花钱入口

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

`node scripts/door-map.mjs runGroupGenerate`：两扇调用点，一个执行口。

| 调用点 | 说明 |
|---|---|
| `generationCanvas/components/useCanvasFrameActions.ts`（画布组框工具条 / 右键「生成整框」） | 原有，改成调 `runGroupGenerate` |
| `generation/list/GenerationListSectionHeader.tsx`（分区头「生成全部」） | 新增，同一个函数 |

两扇门没有合并成一扇的必要：它们是同一个函数的两个按钮，执行口只有 `groupGenerate.runGroupGenerate`（`eligibleGenerationNodeIds` → `buildDependencyWaves` → `confirmAndRunPlan`），列表没有第二条批量路径。结构断言在 `groupGenerate.test.ts`：列表组件不许自己引 `confirmAndRunPlan` / `buildDependencyWaves`。单节点「生成」走 `composerRun.startGenerationFromComposer`（画布「↑」同口）。

## `confirmAndRunPlan` 全部入口（`node scripts/door-map.mjs confirmAndRunPlan`，2026-10-09 评审后补）

| 入口 | 逐项勾选？ | 说明 |
|---|---|---|
| `groupGenerate.runGroupGenerate`（画布组框工具条 / 右键菜单 / 列表分区头） | **是**（`itemized`） | 唯一传 `itemized` 的；没生成默认勾、已生成不勾、生成中锁住；确认后按勾选重建计划再出价再派发 |
| `storyboardRowActions`（分镜编辑器批量） | 是（自己的 `confirmStoryboardBatch` 勾选卡） | 同一个 `PlanRows` 组件 |
| `batchPlanPreview`（pending-refs 预览 / 失败重试通知）、`TaskCenterPanel` 重试 | 否 | 重跑的是系统补的上游 / 用户刚被告知的失败批，不是「让用户挑」 |
| `ProductionCanvasLandingHost`（E2E 桥，只读暴露） | — | 仅 `__nomiE2E` 时挂到 window |

出价只有一扇门：`consentPaidNodes`（`batchPlanPreview.ts`），入参是确认后重建的执行计划里的 id。
