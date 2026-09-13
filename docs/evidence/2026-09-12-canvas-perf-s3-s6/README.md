# 真机走查证据：150 节点全选拖动（2026-09-12，S3 + S6）

- `i150-select-all-drag-before.png` / `i150-select-all-drag-after.png`
- 怎么来的（可复跑，非 `expect` 断言，人眼判断）：

```
node tests/ux/canvas-performance-benchmark.e2e.mjs s3walk \
  --scale I150 --runs 1 --warmup 0 --screenshots --scenario drag-nodes-all
```

真实 Electron 窗口、真鼠标：点**真按钮**「适应视图」→ `Cmd+A` 全选 → 抓住 React Flow 自己盖上来的
选区罩子画一个 2 秒整圆 → 松手。

人眼看到的（after 那张）：150 张卡全部在选中态、整体位移一致、卡片内容与连线完整、
选区浮条显示「已选 150 个」、最小地图里的节点云随之整体平移。S3 删掉四个整表选择器之后，
卡片上由这些选择器驱动的东西（派生来源标题/分类、生成钮可用态）渲染正常，没有出现空标题、
错标题或「来源已丢失」。

注：浮条上的「生成选中 0 个」不是本刀的回归——那个数来自另一条路
（`components/useCanvasProductionActions.ts:37` 的 `eligibleGenerationNodeIds`），
夹具里这批图片节点本来就已经有产物、不进批量生成的候选集。
