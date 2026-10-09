# 门表：列表新增的花钱入口

`node scripts/door-map.mjs runGroupGenerate`：两扇调用点，一个执行口。

| 调用点 | 说明 |
|---|---|
| `generationCanvas/components/useCanvasFrameActions.ts`（画布组框工具条 / 右键「生成整框」） | 原有，改成调 `runGroupGenerate` |
| `generation/list/GenerationListSectionHeader.tsx`（分区头「生成全部」） | 新增，同一个函数 |

两扇门没有合并成一扇的必要：它们是同一个函数的两个按钮，执行口只有 `groupGenerate.runGroupGenerate`（`eligibleGenerationNodeIds` → `buildDependencyWaves` → `confirmAndRunPlan`），列表没有第二条批量路径。结构断言在 `groupGenerate.test.ts`：列表组件不许自己引 `confirmAndRunPlan` / `buildDependencyWaves`。单节点「生成」走 `nodeComposerGenerate`（画布「↑」同口）。
