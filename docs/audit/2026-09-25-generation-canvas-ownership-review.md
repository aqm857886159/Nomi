# 生成画布结构复核：一件事两个 owner（src/workbench/generationCanvas）

> 状态：随 `claude/canvas-follow-hand` 分支提交（2026-09-25）。触发：`check:symptom-cluster`——`src/workbench` 这一层 7 天内的第三份以上根因合同。
> 范围：生成画布（`src/workbench/generationCanvas/**`）及其与素材落盘边界（`electron/assets/**`）的接缝。不冒充整个工作台的审计。

## 这一周同一层的合同

| 合同 | 表面症状 | 两个 owner 分别是谁 |
|---|---|---|
| 2026-09-22-canvas-dragging-flag-outlives-gesture | 浮框 / 浮条消失，`data-dragging` 卡死 | 各手势自己记账释放 vs 画布级租约 |
| 2026-09-23（两份，拖动标志） | 同上的另两种时序 | 同上 |
| 2026-09-24-canvas-connection-ring-dead-ends | 拉环点了没反应 | 卡面 vs 把手层 |
| 2026-09-25-canvas-node-drag-release-lost | 节点粘在光标上 | 我们的租约 vs React Flow 内核的拖动（d3-drag） |
| 2026-09-25-canvas-video-players-always-mounted | 30 个视频全挂、2 GB 显存 | 落盘边界（画封面）vs 节点卡片（挂播放器） |

同一周在这一层还修了三件没单独立合同、但是同一形状的事：@ 引用被接到拖线的首尾帧规则上（@ 的「参考」语义与拖线的「接力」语义共用一个路由）；方向键的「来自键盘」授权靠微任务时间窗口（和内核落位置的时机是两个 owner）；4 个卡片组件从 workbenchStore 读缩放，而 `canvasViewportScale.ts` 写明缩放的唯一真相是 React Flow 的 `transform[2]`。

## 共同的结构原因

画布换成 React Flow 之后，很多事实天然有两个持有者：**内核**（React Flow / d3-drag / d3-zoom 持有手势、视口、节点位置的实时值）和**应用状态**（我们的 zustand store、租约、落盘边界的约定）。迁移时的要求是「行为逐项等价」，没有要求「每个事实只认一个 owner」。于是：

1. **手势寿命**：我们的租约能判定手势结束，却结束不了内核的手势（粘鼠标）；内核的时序又能让我们的释放漏掉（标志卡死）。
2. **媒体**：边界承诺「画布只画封面」，卡片自顾自挂播放器；三个面各自推导视频封面。
3. **意图**：两种用户意图（@ 引用 / 拖线连接）被当成同一种，共用一个带首尾帧偏好的路由。
4. **视口**：缩放有 transform 与 workbenchStore 两份，动画期间还每帧把后者写一遍。

每一次单修一个时序、一个入口都能变绿，但只要两个 owner 还在，下一个入口就会用另一种时序再漏一次——这正是这张表一周长出五行的原因。

再往下追一层（[`kernel-state-ownership.md`](../research/2026-09-25-canvas-follow-hand/kernel-state-ownership.md)）：两份状态本身是 09-02 为绕开「画布根组件订阅整份文档」而付的代价——根因是订阅太宽，不是写得太频繁。下面这张裁决表是在两份状态仍在的前提下定单向规则；把两份收成一份另立方案。

## 结构裁决（这一轮已落 / 已派）

| 事实 | 唯一 owner | 落点 |
|---|---|---|
| 一次画布手势何时结束 | `components/canvasDraggingFlag.ts` 的租约；内核手势经 `reactFlow/canvasDragWriteback.ts` 的 `endKernelNodeDrag` 走内核自己的 end 路径结束 | 本分支 |
| 画布视频何时有 `<video>` / 谁在播 | `nodes/NodeVideoPlaybackGuard.tsx` / `nodes/nodeVideoPlayback.ts` | 本分支 |
| 视频封面怎么来 | `electron/assets/assetPreview.ts`（渲染层经 `ensureLocalAssetPreview` 要） | 本分支 |
| @ 引用落哪个槽 | `model/canvasReferenceConnection.ts` 的 `resolveMentionReference`（与拖线的 `resolveCanvasReferenceConnection` 分开） | 本分支 |
| 方向键移动的授权 | 「按下时选中的那批节点」（`keyboardMoveScope`），不靠时间窗口 | 本分支 |
| 缩放 / 程序化移动视口 | React Flow `transform` 唯一；程序不再主动移动视口（2026-09-25 用户拍板） | 已派 `claude/canvas-ux-batch` |
| 节点下方浮框的位置 | 固定贴节点，删除躲避与常驻 rAF（用户拍板） | 已派 `claude/canvas-ux-batch` |

## 防回

- 结构断言进 CI（`tests/ux/canvas-follow-hand.perf.mjs --structural`，本分支收入）：空闲 `<video>` = 0、同时在播 ≤ 1、叠放拖出粘住 0、方向键能挪、打一个字其它节点不重渲。这类断言与机器快慢无关，撤回一笔「看起来无关」的提交时会当场变红。
- 以后在这一层新增「和内核共享的事实」时，先在 `docs/engineering/concept-owners.json` 登记 owner，再写代码。
