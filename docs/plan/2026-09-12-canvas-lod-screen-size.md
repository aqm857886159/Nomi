# 画布 S5：LOD 的判据换成「这张卡在屏幕上多大」

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实现（随 `fix/canvas-media-preview-lod-20260914` 交付，取代 PR #776；机制来自 `ba753cfa5`）
> 上游调研（数字、根因、别人怎么做、验收预算都在那里）：
> [docs/research/2026-09-12-canvas-perf-at-scale/README.md](../research/2026-09-12-canvas-perf-at-scale/README.md) §1.5 / §5 S5 / §6
> 前一刀（S3 + S6 + 三条门岗场景）：[docs/plan/2026-09-12-canvas-perf-s3-s6.md](2026-09-12-canvas-perf-s3-s6.md) · PR #763
>
> 本文件只写「这一刀做什么、不做什么、怎么回滚、凭什么算做完」。

## 用户报的是什么

> 「选中 60 个图片拖动组就开始特别卡了，拖动鼠标都不行；画布东西多的话那么卡。」
> —— 2026-09-12 用户原话（调研 §0）

调研 §1.5 把创始人那一格量了出来：**60 张图片卡**（旧判据要 >80 个节点）在**适应视图后的缩放 0.217**
（旧判据要 <0.55），两条都不满足，于是每张 340 宽的卡在**约 74 × 41 屏幕像素**里渲染全套 chrome。
判据问的是「画布上一共有几个节点」，而卡片贵不贵取决于「它在屏幕上有多大」——问错了问题。

## 先查别人

- <https://tldraw.dev/sdk-features/performance> —— tldraw 把这件事写成产品口径：
  「tldraw adjusts rendering fidelity based on **zoom level and on-screen size**, a technique called
  level of detail (LOD)」，并给出 `steppedScreenScale` =「the ratio of the shape's **on-screen size
  (in CSS pixels)** to the image's native size, rounded up to the nearest power of two」。
  判据是**屏上尺寸**，不是场景里有几个形状；小到一定程度就换更省的画法（便签丢掉 box shadow、
  虚线笔画画成实线）。本刀照抄的就是这条判据的形状（2026-09-12 实取）。
- <https://reactflow.dev/learn/advanced-use/performance> —— React Flow 官方性能页给的是
  `onlyRenderVisibleElements`（视口剔除）+ 细粒度订阅；**没有**任何「按屏上尺寸降档」的原语，
  所以这一层必须由我们自己判，不是「框架已经提供却另写一份」（R29）。
- `src/workbench/generationCanvas/reactFlow/canvasViewportScale.ts:68` —— 仓库里**已经有**同形状的
  判据：分镜表按缩放分 `full` / `compact` / `card` 三档密度。本刀不发明第二套机制，
  只是把节点卡这一格从「数节点个数」改成同一条「看屏上多大」。
- `src/workbench/generationCanvas/nodes/NodeLabelRow.tsx:11` —— 卡片自己也早就认了这条：
  缩放低于 0.4 时元数据行直接 `visibility: hidden`。这个 0.4 原本是行内字面量，本刀把它提升成
  `NODE_LABEL_ROW_MIN_ZOOM` 常量、由 LOD 模块单一 owner 持有（R14.1）。
- `src/workbench/generationCanvas/nodes/nodeSizing.ts:20` —— `MIN_NODE_WIDTH = 240` 是
  `getNodeSizeBounds` 交给 `NodeResizer` 的下钳位：**全套 chrome 被授权布局过的最窄宽度**。
  阈值直接取它，不另造一个数。

**结论：判据形状抄 tldraw（生态共识），阈值取仓库里卡片自己的布局断点（不新造常量）。**

## 范围（这一刀做什么）

**① 主判据换成屏上宽度。** `components/canvasNodeLevelOfDetail.ts`：

| 旧 | 新 |
|---|---|
| `LIGHTWEIGHT_NODE_RENDER_THRESHOLD = 80`（节点总数） | **删除**，不留并行判据 |
| `LIGHTWEIGHT_NODE_ZOOM_THRESHOLD = 0.55`（缩放） | **删除** |
| `shouldUseLightweightNodeRendering(nodeCount, zoom)` | `shouldUseLightweightNodeRendering({ cardWidth, zoom })` = `cardWidth * zoom < FULL_CHROME_MIN_SCREEN_WIDTH_PX` |

`FULL_CHROME_MIN_SCREEN_WIDTH_PX = MIN_NODE_WIDTH = 240`。数从哪来见上面「先查别人」第五条：
比 240 更窄的完整卡片布局**从来没存在过**，所以卡片在屏上比它还窄时，全套 chrome 正画在一个
没被设计过的尺寸里。对 340 宽的图片卡等价于缩放低于 0.706——旧判据的 0.55、既有门岗
`low-zoom-preview` / `drag-at-low-zoom` 用的 0.45 都落在里面，语义只扩不缩。

**② 节点数退成二级闸，而且换成「同时在动几张」。** `CONCURRENT_FULL_CHROME_LIMIT = 50`：
选区超过 50 张时，非主选卡走轻量档。50 来自调研 §2.5① 实测的平台期——同时在动 50 张时
三档仍是 118.8 / 94.5 / 88.6 fps（平的），到 150 张才塌。这条比旧的「画布上一共有几个」更贴成本：
同一张表里「在动 = 1 个」那一行从 60 到 300 个节点是平的。

**③ 轻量档不再挂缩放手柄。** 这是本刀实测出来最大的一笔（见下面「量到了什么」）：
`NodeResizer` 对**每个 selected 节点**都挂一整套八向控制点，全选 300 张卡拖动时每帧重建 300 套。
它也是同一条判据的自然结论——手柄本体 16 px，卡片进轻量档时屏上不足 11 px，
比卡片自己都不画的元数据行（`h-7` = 28 px × 0.4 = 11.2 px）还小，**点不中的东西不必画**。
落在 `shouldRenderNodeResizeAffordance()` 里，不写成第二个散落条件。

**④ 轻量档准入：有东西可画才降档。** `resolveLightweightNodePreview()` 返回 null 的卡
（文本、分镜表、还没生成的卡）在轻量档里只剩一个灰盒子——那不是「远景简化」，是「卡片没了」。
`isLightweightRenderable()` 把它们挡在轻量档外。这条同时修掉了旧判据下的既有观感缺陷。

**⑤ 门岗常量跟着改。** `tests/ux/canvas-perf/dragScenarios.mjs` 的 `LIGHTWEIGHT_ZOOM_CEILING = 0.55`
→ `LIGHTWEIGHT_SCREEN_WIDTH_CEILING = 240`，`runDragAtLowZoom` 改判被拖卡片的**屏上宽度**；
同步守卫 `advisoryMetrics.test.mjs` 跟着改成对 `FULL_CHROME_MIN_SCREEN_WIDTH_PX` 的断言。
`canvas-performance-benchmark.e2e.mjs:1340` 那句「settled above lightweight threshold」的 0.55
其实只是「有没有真的缩到 0.45」的余量判据，不是 LOD 阈值——**数值一个不动**，只把注释与文案
改成它真正在判的东西（R14.1：一个语义只许有一份定义）。

## 不动项（明确不在这一刀里）

- **S1 / S2 / S4**（组框拖动收回内核、删两条死拖动路、冻结门认单一标志）——下一刀。
- **S7 / S8** —— 不碰。
- **`drag-nodes-all` @ I300 剩下的那段成本**：本刀把它从「每帧重建 300 套缩放手柄」这一笔里救了出来，
  但「React 每帧重渲染 300 个节点组件」这件事本身还在（见下面「还没解决的」）。
- 预算数字：一个不调。

## 量到了什么

harness 与前一刀同一份（`tests/perf/canvas-scale-bench.mjs`），同一台 M5、同一个 worktree、
背靠背各两次采样，`before` = PR #763 分支（S3+S6 已在），`after` = 同一棵树 + 本刀。
原始 JSON：`tests/perf/results/canvas-scale-s5base.json` / `canvas-scale-s5after.json`（在 bench worktree）。

（表见 PR 正文。）

## 还没解决的（如实记账）

`drag-nodes-all` @ I300 剩余的每帧成本不是 LOD 能管的：**在 I300 上轻量档本来就已经全开**
（实测 `lightweight=204`，即所有挂载节点都已是轻量卡），249 次长任务是在轻量渲染下发生的。
本刀能把它压下去，靠的是第 ③ 条——把 `NodeResizer` 也纳入 LOD——而不是「卡片内容变简单」。
再往下那一层是「React 每一次 pointermove 都要重渲染 N 个被拖节点组件」，
对应 tldraw 的 `useQuickReactor` + `setStyleProperty` 命令式位移（调研 §4）；那是另一刀，不在这里。

## 回滚

`git revert` 本 PR 的合并提交。本刀只改渲染分档判据与两处门岗常量，不碰数据、不碰持久化、
不改任何 store 结构，回滚即恢复旧判据。

## 验收门

- 单测 `canvasNodeLevelOfDetail.test.ts` 全绿（含「创始人那一格」与「既有门岗低缩放场景仍在轻量档内」两条）。
- harness `drag-nodes-all` / `pan` 在 I60 与 I300 上的 before/after 表（PR 正文）。
- 真机走查截图：60 张图片卡 + 适应视图（缩放 0.217），人眼判断轻量档「看起来是有意为之，不是坏了」。
- 五门 `pnpm run gates`。
