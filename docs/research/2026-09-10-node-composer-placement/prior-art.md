# 先查别人报告：节点浮框定位 / 版本堆叠外观 / 「生成几个」计数（2026-09-10 调研）

对应方案：[docs/plan/2026-09-10-node-composer-placement-variants.md](../../plan/2026-09-10-node-composer-placement-variants.md)。
对应用户反馈：2026-09-10 真机反馈 #10 前半（浮框漂移 / 不在节点正下方 / 被截断；**底栏那半条 2026-09-10 用户复核后判定「单行没有问题」，不在本次范围**）与 #11（视频节点后面的「图片」占位被读成「生成几个」）。

写这份的原因（R27）：这次要动的两件事（把浮框钉回节点、给堆叠伪卡按媒体类型换外观）**每一件生态里都已有成品**，先证明自己查过、再决定用哪份，比直接改快也比直接改可信。

---

## 1. 依赖里已有？

| 查了什么 | 结果 | 出处 |
|---|---|---|
| `@floating-ui/*` 是不是直接依赖 | **不是**。`ls node_modules/@floating-ui` → `No such file or directory`；它只作为 `@mantine/core` / `@tiptap/extension-floating-menu` 的传递依赖躺在 `node_modules/.pnpm/@floating-ui+dom@1.8.0/` 里 | `package.json:234`（`"@mantine/core": "^8.3.18"`）、`package.json:257`（`"@xyflow/react": "12.11.5"`）；`.npmrc` 全文没有 `shamefully-hoist` / `node-linker`，所以 pnpm 走默认严格布局，传递依赖**不可 import** |
| Mantine 自带的 `Popover`（内部就是 Floating UI 的 flip+shift） | 能用，但要把浮框搬进 portal | `package.json:234` |
| React Flow 自带 `NodeToolbar` | 已经在用同族思路：本仓的节点浮条选择器就叫 `[data-node-floating-toolbar="true"]` | `src/workbench/generationCanvas/nodes/useComposerViewportPlacement.ts:6` |

**结论**：直接 `import '@floating-ui/dom'` 会是幻影依赖（pnpm 严格布局下解析不到）。把它提成直接依赖是可行的，但代价见第 4 节。

## 2. 仓库里已有？

| 已有的东西 | 它现在干什么 | 出处 |
|---|---|---|
| `useComposerViewportPlacement` | 本次要改的那个 owner：ResizeObserver 观测全场障碍 + MutationObserver 监听整个 workspace 的 childList/subtree/style，任何布局变化都重跑定位 | `src/workbench/generationCanvas/nodes/useComposerViewportPlacement.ts:28`（`React.useLayoutEffect` 起点）、`:83`（`mutationObserver.observe(workspace, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })`） |
| `resolveComposerObstaclePlacement` | 自研的「最大空矩形」避让搜索：把 stage 减去所有障碍，挑一块能放下卡片的空地 | `src/workbench/generationCanvas/nodes/composerObstaclePlacement.ts:21`，空矩形切分在 `:7` |
| `useCanvasBottomDockRects` | 已有的「量一组屏幕矩形」现成件：底部停靠区自己挂 `data-canvas-bottom-dock`，量法集中在一处，不各自抄名单 | `src/workbench/generationCanvas/reactFlow/useCanvasBottomDockRects.ts:50`；消费方注释 `src/workbench/generationCanvas/components/CanvasBatchGenerateDock.tsx:30`、`src/workbench/timeline/TimelineMiniPreview.tsx:75` |
| `resolveResultStackPlacement` | 版本抽屉自己那套 left/right 选边，**没有**障碍避让 —— 同一个面上已经存在「只按锚点选边」的先例 | `src/workbench/generationCanvas/nodes/nodeResultStackPlacement.ts:1`（被 `NodeResultStack.tsx:27` 引用） |
| `getGenerationNodeIcon` | 节点种类 → 图标的**唯一出口**（左侧栏 / 右键菜单 / 实验室空态共用），注释明写「漂移在结构上不可能发生」 | `src/workbench/generationCanvas/nodes/renderRegistry.tsx:70` |
| `GENERATION_VARIANT_COUNTS` / `parseGenerationVariantCount` | 「一次生成几个」已经有通用件和解析器，只是调用点写死了 `image \|\| video` | `src/workbench/generationCanvas/nodes/generationVariantCount.ts:1`，调用点 `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:423` |
| `confirmAndRunNodeVariants` | 连发 N 次的执行侧**本来就是通用的**：只是 `for` 循环调 `runGenerationNode`，没有任何 image/video 分支 | `src/workbench/generationCanvas/runner/generationRunController.ts:626`（循环体 `:650`） |

**结论**：避让算法只有两个调用者，其中一个（Agent 面板）传的是 `obstacles: []`——**它要的从来就只是 clamp + 选边**（`src/workbench/ai/v4/AgentPanelV4Context.tsx:61`）。「生成几个」的通用件已存在，缺的只是别在调用点写死媒体类型。

## 3. 生态里已有？

| 出处 | 它怎么做 | 对我们的意义 |
|---|---|---|
| React Flow 官方 `NodeToolbar`：https://reactflow.dev/api-reference/components/node-toolbar | 只有 `position` / `align` / `offset` / `isVisible` / `nodeId` 五个参数；官方明写 “This toolbar doesn't scale with the viewport so that the content is always visible”；文档**没有**任何 viewport clamp / 边缘翻转 / 障碍检测 | 框架自己给节点挂浮层的答案就是「钉在锚点上 + 反缩放」，连翻转都不做。我们做的避让搜索比框架的官方件多了一整套机制，而多出来的那套正好是漂移的来源 |
| Floating UI `flip`：https://floating-ui.com/docs/flip | 实读该页：“changes the placement of the floating element to keep it in view”，默认同时查主轴与交叉轴 | 这正是我们要的「只做 above/below 翻转」的标准实现 |
| Floating UI `shift`（同页交叉引用，官方建议与 flip 配套用）：https://floating-ui.com/docs/shift | flip 定方向、shift 沿轴平移把浮层推回可视区 | 这正是我们要的「只在视口内 clamp」 |

**没查的（诚实边界，别当它查过）**：没去读 tldraw / Excalidraw 一类无限画布的选中浮层源码。它们的行为看得见（浮层跟随选中 bounds），但「有没有做全场避让」要读源码才能下结论，本次没读，所以不拿它当论据。

## 4. 结论：用已有 / 自研 + 理由

**决定：删掉自研的避让搜索，改成「锚点 + 视口 clamp + above/below 翻转」的纯函数；不引入 `@floating-ui/*` 直接依赖。**

三条理由，按重要性排：

1. **框架的官方答案就是「不避让」。** React Flow 的 `NodeToolbar` 是同一个问题的官方件，它连翻转都不做。我们真正缺的能力只有 flip + clamp 两条，不是一整套空矩形搜索。删掉搜索之后剩下的是 `Math.min/Math.max` 若干行 + 一个 `if`——那是算术，不是一份「通用能力」，R20 要拦的是后者。
2. **锚点住在 CSS `transform: scale()` 里，Floating UI 的产出还要再换算回来。** 浮框是 React Flow 节点的子元素，用画布单位相对节点定位，再用 `transform: scale(1/zoom)` 反缩放（`NodeGenerationComposer.tsx:305`、`:311`）。Floating UI 给的是屏幕坐标，要用它就得把浮框 portal 到 stage 上——那会一并丢掉三件已生效的东西：拖动期间用 `visibility` 隐身以**不卸载 TipTap 实例**（`NodeGenerationComposer.tsx:299-303` 的注释写明这是为了不丢未提交输入）、`onPointerDown` 的事件围栏、以及 `data-flipped` 驱动的参数弹层贴边方向。
3. **引入直接依赖要连带交 R29 的三份表。** `@floating-ui/*` 现在是幻影依赖（第 1 节），提成直接依赖等于新接一个框架层，按 R29 要出「它提供 / 我们用了 / 我们另写了 / 我们拆散了」四列表 + 参考实现逐层对照 + framework-surface 逐字段裁决。为了替掉六行算术付这个代价，代价与收益不成比例。

**这条结论的有效期条件（写死，免得下次又靠记忆判断）**：如果以后浮框需要的定位能力超出「翻转 + clamp」（比如要 arrow、要 autoPlacement、要 virtual element、要跟随滚动容器），就不再是算术了 —— 那时按 R29 走完三份表，把 `@floating-ui/react-dom` 提成直接依赖并整体迁移，不要在自研函数上继续长中间件。

另外两件的结论：
- **堆叠伪卡外观**：复用 `getGenerationNodeIcon`（`renderRegistry.tsx:70`）这个唯一出口，不在 `CardStackPeeks` 里另起一张 kind→图标表（否则就是「同一语义两份定义」，R14.1）。
- **「生成几个」**：复用已有的 `GENERATION_VARIANT_COUNTS`，把调用点的 `image || video` 硬判换成从执行类派生的谓词，放进 `generationVariantCount.ts` 这个已有 owner 里（P4 通用第一）。

---

## 自媒体来源

用 `scripts/research/tikhub-search.mjs` 实跑两轮（附件在 `tikhub/`，密钥只走 `TIKHUB_API_KEY`）：

- 轮一：`--q "AI 画布 节点 参数面板 遮挡 乱跑"`，抖音/小红书/B站/X 各 10 条 → [tikhub/tikhub-search.md](tikhub/tikhub-search.md)
- 轮二：`--q "ComfyUI 节点 弹窗 挡住 画布 难用"`，四平台各 8 条 → [tikhub/tikhub-search-comfyui.md](tikhub/tikhub-search-comfyui.md)

**如实结论：这一层对「浮层几何」没有信号，但它给了一条别的信息。**

- 轮一被「乱跑」这个词带偏了：命中的全是 AI 视频里**人物**乱跑（如 https://www.douyin.com/video/7677508966104009993 「AI人物总乱跑？3张参考图锁死站位」）。中文创作者社区里「乱跑」是内容问题的词，不是界面问题的词。
- 轮二命中的是节点画布整体难用的抱怨——「ComfyUI真够难用的！」「被comfyui折磨疯的第一天」「comfyui劝退篇……单论操作是真的不如闭源」（https://www.douyin.com/video/7627441237456877434 一族，完整清单见附件）。**没有一条**在讲浮层定位。
- 这个「查不到」本身是判据：浮层定位做对的时候是隐形的，用户不会为它拍视频，只会在整体「难用」里记一笔。所以这类问题**拿不到自媒体验证**，只能靠真机走查和几何断言（本次验收就是这么设计的）。不要把「自媒体没人提」误读成「不重要」。
