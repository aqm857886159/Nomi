# 画布高频性能审计：拖动、投影与订阅边界

这张卡承接真实 Electron 中观察到的 React Flow 边层 `childList` 高频变更。目标是清查同一类问题：高频手势把瞬态位置写入业务 store，再把整张图投影回 React Flow；或订阅者拿整张 `nodes` / `edges` 后在每个节点上重新派生数组、对象和图关系。

## 设计卡

```text
改动名：画布高频状态与订阅性能收口
线/负责人：codex/create-composition-optimization
类别：[长跑][新界面]
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 创作者拖单个节点、多选节点或编组时，节点跟手、连线不反复清空重建；松手后位置、编组归属和撤销仍正确。 | 真实 Electron `node-drag-image`、`multi-node-drag`、`drag-group-frame-60` |
| ★2 谁说了算 | React Flow 内核拥有拖动中的瞬态几何；画布 store 只在手势结束时批量接收最终位置。边结构由图投影拥有，位置变化不能改写边身份。 | `GenerationCanvasReactFlow.tsx`、`canvasDragDraft.ts`、`useGenerationCanvasReactFlowProjection.ts` |
| ★3 一致与复用 | 复用现有 React Flow kernel draft、节点投影同步、store `moveNodes` / `moveGroupNodes` 和稳定选择器；不增加第二套拖动状态机或第二套边数据。 | `node scripts/door-map.mjs handleNodesChange`；既有 drag writeback 测试 |
| ★4 全状态 | 正常拖动、取消、失焦、松手丢失、Alt 复制、多选、编组、连线中、节点被删除和重新加载都必须保持几何与撤销一致。没有真实资源的路径记为 `unverified`。 | `selection-drag-lifecycle`、画布拖动走查、性能 JSON |
| 5 中途表 | 拖动中不落盘、不触发全图业务投影；取消恢复原位置；正常松手只提交一次；窗口失焦由拖动租约收尾；重启从已提交位置恢复。 | `canvasDragWriteback.test.ts`、真实 Electron lifecycle |
| 6 外部数据与失败 | 性能探针同时记录边层 `childList`、属性变更、React commit、长任务和 off-canvas 自身渲染；不把 synthetic-preview 当成真实视频解码证据。 | `canvas-performance-benchmark.e2e.mjs`、真实媒体走查 |
| 7 性能预算 | 60 节点拖动：`frameGapP95 ≤ 22ms`，`longTasks = 0`，边层 `childList` 在拖动窗口内不随 move 次数线性增长；边身份和 DOM 节点身份保持稳定。 | 最终 JSON 与 MutationObserver 分类回执 |
| 8 真实条件 | macOS Electron 生产构建、真实输入、真实项目节点；性能夹具明确区分真实图片/视频资源与合成节点规模。Windows、干净安装、供应商生成不在本轮冒充已验证。 | `tests/ux/` 真实走查和 `tests/ux/perf-results/` |
| ★9 验收与回滚 | 先跑审计基线，再跑 focused 单测、typecheck、build、真实 Electron 和性能 5 轮；另由 PR #1014 协调会话独立检查交互与设计。回滚为 revert 本 PR。 | 本卡、根因合同、PR 及 #1014 评论收据 |

## 清查面

| 类别 | 检查目标 | 处理原则 |
|---|---|---|
| React Flow 受控投影 | `nodes` / `edges` 是否因位置 tick 重新喂回内核 | 瞬态位置留内核，投影只同步结构/数据变化 |
| 图边投影 | `flowEdges` 是否每帧新建，边 DOM 是否整层重建 | 位置变化保持边数组、边对象和 DOM identity |
| Zustand 订阅 | 组件是否订整张 `nodes` / `edges`，或返回每次新建数组/对象 | 改为单节点、标量、引用稳定派生值 |
| 派生索引 | 同一 store 版本是否被每个节点重复扫描 | 在最早共享边界缓存一次，调用方只读对应 key |
| 量具 | MutationObserver / React fiber 探针是否能区分 childList、属性和真实 render | 先固定证据口径，再用同一命令比较前后 |

## 当前已确认的边界

审计前的工作树确实在 `handleNodesChange` 的每个 position change 调用 `moveNodes`，这就是用户报告的同类根因：持久 store、整图投影和 React Flow 内核在一个 pointer tick 里互相回写。当前实现已经把这条写口收回 `applyCanvasDragKernelPositionChanges`，持久 store 只在 `commitCanvasNodeDragStop` 统一写回；编组框预览继续只写 DOM `translate`，不写 store。

静态清查结果：

| 入口 | 是否会在节点拖动 tick 触发 | 结论 |
|---|---:|---|
| `GenerationCanvasReactFlow.handleNodesChange` | 是 | 已修：position tick 只更新 React Flow kernel draft |
| `useCanvasSelectionDrag` 编组框 | 是 | 已有 rAF 合帧 + shell `translate`，松手一次性提交 |
| `useCanvasSelectionDrag` 选择框拖动 | 是（设计实验室/备用宿主） | 已修：选择节点 shell 使用 `translate` 预览，settle 才一次性 `moveSelectedNodes` |
| `useNodeDragResize` 自定义拖动 | React Flow 宿主不走此分支 | 设计实验室/旧宿主仍标 `unverified`，不把它冒充生产路径 |
| `useNodeRelationships` / 节点面板整表 selector | 会随 durable store 变更 | 位置 tick 不再触发；关系查询已有 WeakMap / generation index 缓存，需继续守住单节点读边界 |
| `useCanvasProductionActions`、`BatchPlanOverlay` 等画布级整表读 | 只在自身功能激活时挂载 | 不属于拖动热路径；保留为低频业务读，禁止复制到每卡组件 |

本地生产 Electron 证据（真实 pointer 输入）：I60 单节点 60 moves 的 edge `childListRecords=4`、属性变更 184；多选 22 moves 的 `childListRecords=44`、属性变更 817；两者 `longTasks=0`，帧间隔 P95 分别为 10.3ms / 11.2ms。真实 1920×1080 H.264 视频节点在解码后拖动的 `childListRecords=12`、属性变更 484、`maxActiveVideos=1`、`longTasks=0`。这把“约 7.9 万 childList”与属性更新分开，避免把两种量混成一个数字。

组框 60 节点真实资产回归为 250 次 pointer move、`childListRecords=314`、属性变更 2、`frameGapP95=10.1ms`、`longTasks=0`；这些 childList 发生在一次提交边界，未随每个 pointer sample 重建整层，边节点身份保持 96/96。
