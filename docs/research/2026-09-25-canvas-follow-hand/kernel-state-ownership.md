# 生成画布：React Flow 内核和我们的 store 各管一份（2026-09-25 分析）

> 触发：`docs/audit/2026-09-25-generation-canvas-ownership-review.md` 里同一层一周五份合同，共同形状是「一件事两个 owner」。本文追到这个形状从哪来。
> 覆盖范围：这是 `framework-boundaries.json` 里 `xyflow-react` 参考实现对照债（到期 2026-10-07）的**状态归属层**，不是九层全交；债不因本文销账。
> 引用钉在：ComfyUI_frontend `5f63bb1`、tldraw `e8e194c`、本仓 `claude/canvas-follow-hand`。

## 一句话结论

画布根组件订阅了**整份文档**（`reactFlow/GenerationCanvasReactFlow.tsx:115-116`，整个 `nodes`、整个 `edges`），任何一次写入都让整张画布重算投影。于是「拖一帧写一次 store」太慢，09-02 的性能改动（`9d41e9ba05`）把节点改成非受控（`GenerationCanvasReactFlowViewport.tsx:187` `defaultNodes`），让 React Flow 自己留一份实时位置。从那以后，位置、选中、视口都变成两份，每种手势（鼠标拖、方向键、Alt 复制拖、框选、程序移动）都要自己写一条同步路径，bug 就在这些路径的时序缝里反复长出来。

**症状是「两个 owner」，根因是「订阅太宽」。** 两份状态是为了绕开宽订阅而付的代价。

## 证据

近一个月（2026-08-25 起）按文件数的修复提交：

| 文件（管的接缝） | 修复 / 总提交 |
|---|---|
| `reactFlow/GenerationCanvasReactFlow.tsx`（所有同步的汇合处） | 28 / 63 |
| `reactFlow/GenerationCanvasReactFlowViewport.tsx`（视口） | 10 / 20 |
| `components/canvasDraggingFlag.ts`（手势寿命） | 9 / 12 |
| `reactFlow/canvasDragWriteback.ts`（位置回写） | 6 / 7 |
| `reactFlow/canvasMeasuredNodeRect.ts`（测量尺寸，**已是单 owner**） | 0 / 1 |

只有一个 owner 的那条（测量尺寸，09-20 几何审计裁给 React Flow）一个月零修复。

## 每件事现在几份

| 事实 | React Flow 持有 | 我们持有 | 为两份写的同步代码 |
|---|---|---|---|
| 节点位置 | 非受控内部节点（实时） | `generationCanvasStore.nodes[].position`（提交后） | `canvasNodeProjectionSync`（store→内核）、`canvasDragDraft`（拖动草稿+直写内核）、`canvasDragWriteback`（松手回写、`restoreDisownedKernelPositions` 撤销未授权的内核移动、方向键提交）、Alt 复制拖的 id 重映射 |
| 选中 | `node.selected` | `selectedNodeIds`；连线选中另在组件局部 state | `nextSelectionFromFlowChanges`、`handleSelectionEnd`（注释自承「每次同步会形成反馈环」，所以框选只在结束时提交） |
| 视口 | `transform` | 组件 `liveViewport` + workbenchStore 分类视口 + 4 张卡读 store 缩放 | `onMoveEnd` 回写、自家 rAF 动画器、NaN 视口自愈、`panZoomTakeoverReconciler` |
| 手势寿命 | d3-drag 的拖动状态 | 租约 `data-dragging` | `endKernelNodeDrag`、`onReleaseLost`（本分支） |
| 测量尺寸 | `measured` | 无 | `canvasMeasuredNodeRect` 只读 ✅ |

## 四列表（R5.4，状态层）

| 它提供 | 我们用了 | 我们另写了 | 我们拆散了 |
|---|---|---|---|
| 受控 `nodes` + `applyNodeChanges`（官方推荐的单 owner 形状） | 测量尺寸、连线手势、d3-drag | 拖动草稿与直写内核、投影同步、选中结束同步、rAF 视口动画（理由：内核 d3 过渡在 0×0 extent 下吐 NaN，见 `animateViewportTo` 注释） | 节点真相（`defaultNodes` + store）、选中（内核 + store + 局部 state）、视口（内核 + `liveViewport` + workbenchStore） |

## 别人怎么做

- **React Flow 官方**：受控，节点只在你的 store 里，`onNodesChange` 里 `applyNodeChanges` 每次都写（[State management](https://reactflow.dev/learn/advanced-use/state-management)）；性能靠「组件别订阅整个 nodes 数组」（[Performance](https://reactflow.dev/learn/advanced-use/performance) 的 *Avoid inefficient store access*）。
- **ComfyUI**：LiteGraph 画布和 Vue 节点两个渲染器共用**一个** `LayoutStoreImpl`，按节点分作用域的监听与版本号（[layoutStore.ts L170-200](https://github.com/Comfy-Org/ComfyUI_frontend/blob/5f63bb1c229d9cbe0a9b4a3d9943cffca674d97f/src/renderer/core/layout/store/layoutStore.ts#L170-L200)）。
- **tldraw**：选中和相机都是同一个 store 里的记录上的 computed（[Editor.ts L2138](https://github.com/tldraw/tldraw/blob/e8e194c3a55af60d1f6da86ce842de38784d07e1/packages/editor/src/lib/editor/Editor.ts#L2138-L2140)、[L3137](https://github.com/tldraw/tldraw/blob/e8e194c3a55af60d1f6da86ce842de38784d07e1/packages/editor/src/lib/editor/Editor.ts#L3137)）。
- **反方**：受控模式每帧仍有一次 store 写入和 React Flow 的节点比对；节点上千时确实比非受控慢。我们是几十个，瓶颈在根组件重算而不在写入次数——这点要原型实测，不靠推断。

三家都是**一个 owner + 按实体订阅**，没有一家为了性能把交互状态拆成两份。

## 三条路

| 方案 | 用户看到的 | 代价 | 同类 bug 还会回来吗 |
|---|---|---|---|
| **A 受控、store 唯一**（官方形状） | 手感不变或更好；粘鼠标、选中错乱、拖完弹回这一类从结构上消失 | 根组件和节点外壳改成按 id 订阅，投影按节点缓存；删掉投影同步、拖动草稿、回写里的补偿、选中同步。碰最常出 bug 的文件，需要原型先证明拖动 ≤50ms | 位置、选中不会（只剩一份）；视口单独按「内核唯一、存盘只写不读」收 |
| **B 保留两份，收进一个桥接模块** | 不变 | 小；同步代码集中到一个文件、每种手势一个提交点、加不变量测试 | 会——每加一种手势还得写一条同步，只是都在一个文件里 |
| **C 反过来以 React Flow 为准** | 不变 | 大；撤销、存盘、Agent 写入、分镜/时间轴都读我们的 store，全要改 | 不会，但换来一片新接缝 |

## 推荐（2026-09-25 用户拍板：A，先原型；本分支先发，A 下一版，登记 TODO T-CV-21）

**A，但先做原型实测**：把节点改回受控，根组件只订阅 id 列表，节点外壳按 id 订阅，拖动帧用不进历史、不触发存盘的写入，松手记一条撤销；用本分支的量具在 32 个 1080p 视频上量拖动帧。达标（≤50ms）才全量迁移，不达标退回 B。

时机：本分支（封面/播放器/滑杆/@/粘鼠标等）按现有结构已修完，先随 0.22.x 发；A 另开分支。视口这一块归 `claude/canvas-ux-batch`（R33：同一概念同一时段只归一条 lane），A 等它合入后再动视口，位置和选中可以先做。
