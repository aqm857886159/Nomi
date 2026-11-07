# 设计卡：画布选中不再整层刷新（P-canvas，2026-10-16）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：画布壳不订阅选区 + 投影把选区当增量层 + 整表订阅棘轮    线/负责人：P-canvas    类别：[其他]（性能，用户可见行为不变）
```

方向检查：`docs/engineering/direction-checks/2026-10-16-canvas-shell-subscriptions.md`。根因合同：`docs/fixes/2026-10-16-canvas-shell-selection-subscription.root-cause.json`。

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在 100–200 张卡的画布上点一张卡、换选另一张、框选几张、拖动、连线、撤销时，我想让卡立刻跟手，以便不被每次点击的停顿打断。步骤：点卡 → 出生成框 → 点另一张 → 框选 3 张 → 拖动 → 连一条线 → 撤销。**不做**：生成框自身的挂载成本（归 P-compose）、合成层（等 D-perf 的 LayerTree）、卡片按 id 自取数据（方向检查第 6 节，交协调）。已知坑：选中时生成框挂载会回写节点（P-compose 的可疑点 e/i），那几次写仍会让壳重渲，本刀只消掉「选区本身」这一次。真实任务：① 打开 100 张图的项目连续点 10 张卡；② 6 张视频在生成时平移、点卡；③ 框选 20 张拖动再撤销。主指标：选中一次壳的渲染次数（目标 0，修前 1）、投影读的节点数（目标 ≤ 选区大小，修前 N）；质量指标：选中 / 多选 / 拖动 / 连线 / 框选 / 撤销行为不变；护栏：`canvas-select-composer-*` 响应、`canvas-drag-*` 帧间隔不变差。 | `src/workbench/generationCanvas/reactFlow/canvasFlowSelectionProjection.test.ts`；perf 场景见 ★7 |
| ★1b 连带界面 | 无文案变化。受影响的界面行为：多选浮条（编组 / 总览图张数 / 存工作流）、右键菜单的「编组」「复制变体」可用性、小地图选中高亮、选中连线后再点卡放掉连线、空框选中后点卡放掉框——都改成在用到的那一层订阅或在事件里读，行为不变 | 走查截图（zh 亮 / en 暗） |
| ★2 谁说了算 | 选区的唯一真相仍是 `generationCanvasStore.selectedNodeIds`（`canvasNodeActions.selectNode/selectNodes/clearSelection`）。投影 owner：`generationCanvasReactFlowAdapter.ts` 的 `projectGenerationFlowNodes` / `projectGenerationFlowEdges`（新登记概念 `canvas.flow-selection-projection`），唯一消费者 `GenerationCanvasReactFlowViewport`。选区的订阅者：视口层（投影 + 多选浮条）、浮层（右键菜单 + 小地图）；壳只用结果才变的窄选择器 `selectedGroupId`，其余在回调里 `getState()`。同一份事实 1 份；没有靠状态变化猜意图（两处「选中节点就放掉连线 / 空框」是原有行为，改成 store 订阅，判据不变）。 | `node scripts/door-map.mjs useGenerationCanvasReactFlowProjection`；`node scripts/door-map.mjs projectGenerationFlowNodes` |
| ★3 一致与复用 | 复用：React Flow 官方性能指南（父层别订阅整个 nodes、组件 memo、对象身份，https://reactflow.dev/learn/advanced-use/performance ，@xyflow/react 12.11.5）；Zustand 选择器 / `getState()` / `subscribe`（zustand 4.5.7，https://github.com/pmndrs/zustand/blob/v4.3.3/readme.md）；按 id 查节点复用 `store/canvasNodeGenerationIndex.ts` 的 `selectCanvasNodeById`；门岗用 ESLint 自带 `no-restricted-syntax`（仓库已用它守退出生命周期与测试超时下限）。没有第二份投影定义：`toGenerationFlowNodes/Edges` 与增量路径共用同一个逐项函数 `projectOneFlowNode/Edge`。 | `git grep -n "projectOneFlow"` |
| ★4 全状态 | 不适用：没有新状态、新文案、新界面；选中 / 未选 / 多选 / 选中连线 / 选中空框 / 只读画布 / 拖动中 / 折叠编组这些既有状态的显示不变，由现有测试和走查覆盖 | 现有 `generationCanvasReactFlowAdapter.test.ts`、`canvasControlsStructure.test.ts`、走查 |
| ★7 性能 | ① 操作：点选一张卡、换选、框选、拖动单卡 / 组框、生成中平移。② 最坏规模：200 张图（`canvas-select-composer-image-200`）、150 张拖动、60 图 + 6 张生成中视频。③ 预算沿用 D-perf 场景表（响应 100ms、帧间隔 p95 33ms）。④ 场景：`canvas-select-composer-image-{100,200}`、`canvas-drag-single-node`、`canvas-drag-group-frame`、`canvas-drag-20-nodes`、`canvas-pan-while-generating`（在 D-perf 分支 `perf/canvas-p0-baseline`，合入前在临时目录合起来量，不提交） | 本线报告 `perf-scenario` 行 |
| ★9 验收与回滚 | 验收（另一条线）：`pnpm exec vitest run src/workbench/generationCanvas/reactFlow scripts/canvas-store-subscriptions.test.mjs src/workbench/generationCanvas/components`；`pnpm run lint:ci`；画布走查：选中 / 多选 / 拖动 / 连线 / 框选 / 撤销，zh 亮 + en 暗截图。回滚：revert 本分支提交（无数据迁移、无落盘格式变化）。独立验收：待验收线。 | `## 独立验收` |

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能
