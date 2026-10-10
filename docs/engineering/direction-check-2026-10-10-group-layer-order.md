# 方向检查：画布叠层（分组框头 × 节点生成框）类根因复盘（2026-10-10）

> 触发：`fix-churn` 命中 `GroupFrameHeader.tsx`（近 14 天 3 个 fix）与 `GroupFrame.tsx`、`CanvasGroupToolbar.tsx` 等同目录文件。
> 结账挂的类检查：`src/workbench/generationCanvas/reactFlow/canvasLayerOrder.test.ts` + `tests/ux/group-layer-order.walk.mjs`。

## 0. 一句话根因

画布的叠层数字（框体、框头、节点层、选中节点、生成框、两个工具条）散写在 CSS 与 TSX 的十几处，而它们之间的上下关系只在同一个视口层里才有意义。没有一张表，也没有任何测试能看见「谁压谁」，所以每改一处都可能让另一处的比较翻车。

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 用户 10-10：分组左上角图标压住节点提示词框 | 框头 `z-[4]` 与节点层 CSS `z-index:2` 在同一视口层比较，框头压住整个节点层 | 数字散落，比较不可见 |
| 近 14 天同文件 3 个 fix（框头位置、工具条落点、批量生成） | 每个 fix 都在改局部数字或位置，没有人对着整张叠层关系做过一次 | 同一类：局部修补，无全局层级 |
| `.generation-canvas-v2__nodes { z-index: 3 }` 死规则 | 被更具体的 `.generation-canvas-react-flow .react-flow__nodes` 覆盖，无人发现 | 死数字，靠读代码才能发现 |

## 2. 为什么这一类会一直出现

- 节点层是一个独立的层叠上下文（`.react-flow__nodes` 的 z-index），节点卡片的 z（0 / 4 / 5）只在它内部比较。
- 分组框头、分组工具条、框选浮条都挂在 React Flow 的 `ViewportPortal` 里，与节点层同级比较。
- 所以「选中节点露出生成框」在节点层外面根本看不见：选中节点的 z 5 只在节点层（z 2）内部有效，而框头的 z 4 与节点层的 z 2 直接比较，框头胜出。
- 三条体验铁律：⑫「点了=以为的」相关——用户以为生成框可以点，实际被框头挡住；本次不涉及 ⑩ ⑪。

## 3. 不改结构的话，接下来会冒出什么（可验证预测）

| 预测 | 怎么验证 |
|---|---|
| 折叠分组卡（`CollapsedGroupCard`，`z-[3]` 且在视口层）会压住节点层，与选中节点的生成框叠在一起 | 真 Electron 走查：折叠一个组，放一个展开的组的节点到它下面，量 `elementFromPoint` |
| 新加的任何视口层浮层（如分组框内新标题）会因为数字不在同一张表而再次压住节点 | 层级表的顺序断言 + 散落数字守卫（已加） |

## 4. 靶子独立性检查

- 走查的断言（相交区最上层是生成框）和修复代码由同一条线写，但断言的判据是浏览器的 `elementFromPoint`，不依赖修复代码内部。
- 修复前该场景确实红：探针记录 `topAtIntersect.inGroupHeader = true`。修复后绿。
- 修复没有减少任何可见内容，不存在「修对了掉分」的先例。

## 5. P0：是不是我们独有的？现成方案

层级表是几十个数字加一段注释，不含领域逻辑，不属于需要登记的自写。React Flow 本身没有跨 `ViewportPortal` 与节点层的统一 z 管理接口，所以无现成方案可接。本次没有查 Context7 文档，结论来自代码与真 Electron 实测。

## 6. 接入 / 补 / 重写 / 删 对比

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | React Flow 无跨层统一 z 管理 | — | — | 不适用 |
| 补（只改框头的数字） | 把 `z-[4]` 换成 `z-[1]` | 小 | 下一个叠层 fix 仍会散落 | 否 |
| 建表 + 守卫（已做） | `canvasLayerOrder.ts` 唯一 owner，相关 TSX/CSS 改读表，单测扫描散落数字 | 中（约 20 处改动，11 个文件） | 守卫只覆盖清单内文件 | 推荐 |
| 删 | 框头整体移除叠层 | 违背用户要的框内标题 | — | 否 |

## 7. 用户要权衡的核心

分组框的标题与计数，是否允许被节点卡压住（即框头在节点之下）。当前选择：允许。节点（含生成框）永远压在框头之上，框头只在节点之间的空白处可见。

## 特征测试清单

- `src/workbench/generationCanvas/reactFlow/canvasLayerOrder.test.ts`：层级顺序、CSS 变量取值、散落数字守卫。
- `tests/ux/group-layer-order.walk.mjs`：真 Electron，相交区 `elementFromPoint` 取到生成框；层级数字经 `getComputedStyle` 读回。
- 既有：`generationCanvasReactFlowAdapter.test.ts`、`groupVisualContract.test.ts`、`groupToolbarPlacement.test.ts`、`generationCanvasReactFlowFramework.test.ts`。

## 用户拍板追记（10-10，第二段框头改版）

- 复盘结论与「建表 + 守卫」的方向用户认可，框头进框内一行，框外标签整体删除（同一提交）。
- 用户定的新流程：探索图 → 生产组件搭建 → 清单（覆盖状态 + 旧功能普查）→ 实现。本段已按此流程走完：实验室屏 `canvas-group-header` 搭生产组件，差异清单经用户点头后实现。
- 颜色（取代 10-06 组色方案 B）：框体无边框，底色用六色 soft token；选中不加任何描边，焦点环与落点反馈都不用蓝色。
- 分镜组判断用 `materializationOperationId` 归属章；过程中发现 `nodeGroupSchema` 缺这个字段，读盘会被 zod 剥掉，已补并加测试钉住（见 `generationCanvasSchema.test.ts`）。
- 框顶留白由 28 调到 44（`FRAME_HEADER_RESERVE`），让节点名字标签不压框头（D6），断言见 `groupHeaderClearance.test.ts`。
