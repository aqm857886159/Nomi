# 节点浮框定位 + 堆叠伪卡媒体外观 + 「生成几个」通用化（2026-09-10）

> 起因：2026-09-10 用户真机反馈两条。
> **#10 前半** —— 点击节点后浮出的生成浮框（`NodeGenerationComposer`）来回漂移、不在节点正下方、有时被截断。**这是本次唯一处理的定位问题。**
> **#10 后半（本次不做）** —— 同一条反馈还提到底栏参数挤成一行、摘要被切成「6:9 · 72」。**2026-09-10 用户复核拍板：「单行没有问题」，底栏怎么整合另有设计讨论。** 所以底栏的控件组成、文案、顺序**一律不动**，也不加换行；此前草稿里的「按组换行 + pill 宽度改 min/max」已整体撤销。
> **#11** —— 视频节点后面显示几个「图片」占位，用户以为那是「生成几个」。
>
> 这是**既有 UI 的行为修复，不是重画面**（不出样张；被动的形态都保持 2026-07-17 拍板的样子）。

先查别人报告：[docs/research/2026-09-10-node-composer-placement/prior-art.md](../research/2026-09-10-node-composer-placement/prior-art.md)
根因合同（R21）：`docs/fixes/2026-09-10-node-composer-placement.root-cause.json`

---

## 先查别人

（完整报告见上面的链接；这里是判据条目本身，每条带出处。）

1. **依赖里已有？** `@floating-ui/*` **不是**直接依赖：`ls node_modules/@floating-ui` 报 `No such file or directory`，它只作为 Mantine / TipTap 的传递依赖躺在 `node_modules/.pnpm/@floating-ui+dom@1.8.0/` 下；`.npmrc` 没有 `shamefully-hoist`，pnpm 严格布局下直接 import 会解析不到 = 幻影依赖。见 `package.json:234`（`@mantine/core`）与 `package.json:257`（`@xyflow/react`）。
2. **仓库里已有？** 避让算法本体在 `src/workbench/generationCanvas/nodes/composerObstaclePlacement.ts:21`（空矩形切分 `:7`），全场观测在 `src/workbench/generationCanvas/nodes/useComposerViewportPlacement.ts:83`；另一个调用者 `src/workbench/ai/v4/AgentPanelV4Context.tsx:61` 传的是 `obstacles: []`，**它要的从来只是 clamp + 选边**。
3. **仓库里已有（现成件）？** 「量一组屏幕矩形」有现成 owner `src/workbench/generationCanvas/reactFlow/useCanvasBottomDockRects.ts:50`（消费方注释 `src/workbench/generationCanvas/components/CanvasBatchGenerateDock.tsx:30`）；「只按锚点选边、不避让」也已有先例 `src/workbench/generationCanvas/nodes/nodeResultStackPlacement.ts:3`。
4. **仓库里已有（另外两件）？** 节点种类→图标的唯一出口是 `src/workbench/generationCanvas/nodes/renderRegistry.tsx:70`；「一次生成几个」的通用件是 `src/workbench/generationCanvas/nodes/generationVariantCount.ts:1`，执行侧 `src/workbench/generationCanvas/runner/generationRunController.ts:626` **本来就没有 image/video 分支**，硬判只在调用点 `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:423`。
5. **生态里已有？** React Flow 官方给节点挂浮层的件 `NodeToolbar` 只有 `position/align/offset/isVisible/nodeId`，官方明写 “This toolbar doesn't scale with the viewport so that the content is always visible”，**没有**任何 clamp / 翻转 / 障碍检测：https://reactflow.dev/api-reference/components/node-toolbar 。翻转与 clamp 的标准实现是 Floating UI 的 `flip`（https://floating-ui.com/docs/flip ）与 `shift`（https://floating-ui.com/docs/shift ）。
6. **TikHub 自媒体怎么说？** 实跑两轮（附件 `docs/research/2026-09-10-node-composer-placement/tikhub/`）：轮一被「乱跑」带偏成 AI 视频人物走位（https://www.douyin.com/video/7677508966104009993 ），轮二命中的是节点画布整体难用的抱怨（「ComfyUI真够难用的！」一族）。**这一层对浮层几何没有信号**——浮层做对时是隐形的，用户只会在整体「难用」里记一笔。如实记录，不据此下判断。
7. **结论：用已有（框架/标准的做法），但不新增依赖。** 删掉自研避让搜索，改成锚点 + 视口 clamp + above/below 翻转的纯函数；剩下的是若干 `Math.min/Math.max` = 算术不是能力，不值得为它付 R29 引入新框架层的三份表代价。有效期条件写在报告第 4 节末尾（一旦需要 arrow / autoPlacement / virtual element，就整体迁 Floating UI，不在自研函数上长中间件）。

---

## 背后逻辑（一句话版）

浮框现在是「**去找一块空地**」；空地会随别的节点、别的浮条、别的结果堆叠而移动，于是用户的眼睛得追着它跑。改成「**钉在这个节点下面，只在必要时翻到上面，永远不出视口**」——位置只由「视口 + 这个节点」两件事决定，别人怎么动都不影响它。

用户要权衡的那个核心点：**「浮框绝不被任何东西遮住」和「浮框永远在同一个地方」二选一。** 现在选的是前者，代价是漂移；这次改成后者，代价是浮框可能盖住相邻节点的一角（可以拖开画布，而追着浮框跑没法回避）。

---

## 范围

### A. 浮框定位（反馈 #10 前半）

| 动作 | 文件 |
|---|---|
| 新增纯函数 `resolveAnchoredPlacement`：视口内 clamp + below/above 翻转，**位置只是 (stage, anchor, 自然尺寸) 的函数** | `src/workbench/generationCanvas/nodes/anchoredPlacement.ts`（新） |
| **删除**避让搜索及其测试（P1 加新必删旧，不留 fallback） | `src/workbench/generationCanvas/nodes/composerObstaclePlacement.ts`、`composerObstaclePlacement.test.ts`（删） |
| 定位 hook 去掉全场 ResizeObserver 与 workspace MutationObserver，改为**只观测那两个入参**：卡片自身尺寸用 `ResizeObserver`，节点/舞台矩形用每帧比对（拖动期间跳过） | `src/workbench/generationCanvas/nodes/useComposerViewportPlacement.ts` |

> 每帧比对这条是**走查逼出来的**，不是一开始就想到的：只挂 `ResizeObserver` 时浮框恒定偏 22.7px，因为节点入场是一段 `scale` 动画，而 `ResizeObserver` 报的是 border-box 布局尺寸、看不见 transform（也看不见「大小没变、位置变了」）。生态里的标准答案就是 Floating UI `autoUpdate` 的 `animationFrame` 策略。代价被两件事夹住：每帧只读两个 rect、值没变一个字都不写；画布拖动期间直接跳过（那时浮框本来就 invisible，而拖动是全仓最吃帧的动作）。
| 另一个调用者迁到同一个纯函数（它本来就传 `obstacles: []`） | `src/workbench/ai/v4/AgentPanelV4Context.tsx` |

### B. 底栏：撤销，一个字不动（反馈 #10 后半 —— 本次不做）

| 动作 | 文件 |
|---|---|
| 底栏保持 2026-07-17 拍板的单行形态：控件组成、文案、顺序一个都不动，不加 `flex-wrap`、不分组 | `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx`（只加一个 `data-node-composer-footer` 走查锚点） |
| 摘要 pill 宽度保持原样（`width: 110`），不改 min/max | `src/workbench/generationCanvas/nodes/InlineParameterBar.tsx`（**不改**） |

> 用户 2026-09-10 复核原话：**「单行没有问题」**，底栏怎么整合另有设计讨论。因此「摘要被切成 6:9 · 72」这半条**留着**、记进合同的 `residual_risks`，等那场设计讨论一起解，不在这次改动里顺手改形态。走查反过来把「底栏仍是单行」当**回归断言**守住，防止定位改动把它挤成两行。

### C. 堆叠伪卡按媒体类型（反馈 #11 前半）

| 动作 | 文件 |
|---|---|
| `CardStackPeeks` 接一个 `glyph`（外部传入的媒体示能），画在最外层伪卡露出的那条边上；带 `data-card-stack-media` 供断言 | `src/workbench/generationCanvas/components/CardStackPeeks.tsx` |
| 版本堆叠传本节点的媒体图标，**复用唯一出口** `getGenerationNodeIcon`，不另起 kind→图标表 | `src/workbench/generationCanvas/nodes/NodeResultStack.tsx` |

### D. 「生成几个」通用化（反馈 #11 后半）

| 动作 | 文件 |
|---|---|
| 新增谓词 `supportsGenerationVariants(executionKind)`，放进已有 owner；判据**从执行类派生**（产出可堆叠媒体产物的都支持），不列 kind 白名单 | `src/workbench/generationCanvas/nodes/generationVariantCount.ts` |
| 调用点的 `image \|\| video` 硬判换成该谓词 → 音频、3D 节点同样拿到 ×N | `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx` |

## 不动项（明确不碰）

- `applyCanvasToolCall.ts` / `plannedNodeMeta.ts` / `useNodeModelAutoSelect.ts` / `availableModels.ts`（另一工人在改）。
- 底栏**有哪些控件、什么顺序、什么文案、几行**：一个不删、不合、不换位、不换行（§1.5.4 反例第 4 条 + 2026-07-17 拍板 + 2026-09-10 用户复核）。
- 生成钮的 `ml-auto`（2026-07-29 拍板：卡片右下角）。
- 伪卡的层数与位移几何（`getCardStackRearLayerCount` 与 `RESTING_TRANSFORMS` / `FANNED_TRANSFORMS` 原样）。
- 分组折叠卡 `CollapsedGroupCard` 的伪卡不加媒体示能——那一堆是「几个节点」不是「几个版本」，混用媒体图标会造出第二种含义。
- `confirmAndRunNodeVariants` 的执行侧逻辑与花钱闸（本来就通用，不需要改）。
- 版本抽屉 `resolveResultStackPlacement` 的左右选边（不在本次失败类里）。

## 回滚

四块彼此独立，可分别 `git revert`：

1. A（定位）：还原 `composerObstaclePlacement.ts` + 其测试 + hook 的观测块 —— 回到「会漂移但不会盖住邻居」。
2. B（底栏）：无可回滚——底栏本次没有形态改动，只多了一个 `data-node-composer-footer` 属性。
3. C（伪卡）：`glyph` 是可选 prop，不传即回到原外观。
4. D（×N）：谓词换回 `image || video` 硬判。

整批回滚 = `git revert` 本分支的实施 commit；没有数据结构变更、没有持久化字段变更，**不需要数据迁移**（`node.meta` 一个字段都没加）。

## 验收门

| 门 | 判据 |
|---|---|
| 单测（红→绿） | `anchoredPlacement.test.ts`：① 正常在锚点正下方居中；② 下方不够时翻到上方；③ 锚点贴视口左/右缘时整框仍在 stage 内；④ **同一锚点下，加入任意「障碍」不改变结果**（这条就是「不漂移」的机器判据）；⑤ 上下都不够时取较大一侧并压高度 |
| 单测 | `generationVariantCount.test.ts` 补 `supportsGenerationVariants`：image/video/audio/model3d 为真，text 为假，`undefined` 为假 |
| 单测 | `CardStackPeeks.test.ts` 补：传 `glyph` 时渲染在最外层伪卡上且 `aria-hidden`；不传时结构与今天一致 |
| 真机走查（R13） | `tests/ux/node-composer-placement.walk.mjs`：真 Electron、UI 驱动建视频节点 → 点击 → 断言「浮框顶边在节点底边下方」「整框在 stage 内」「拖动画布后竖直偏移逐像素不变」「横向 = 以节点为心 + 视口 clamp 的那个唯一值（拖动前后各一次）」「底栏所有控件都在卡内且可命中」「**底栏仍是单行**（按竖直中心聚类，不按 top）」「声音节点也有 ×N」；截图人眼复核。实测 18/18 过 |
| 门岗 | `pnpm run gates` 全绿（含 `check:root-cause-contracts` / `check:prior-art` / `check:tokens` / `check:filesize` / `lint:ci` 棘轮不涨） |
| 视觉基线 | 只在 design-lab 真的覆盖到这几屏时更新，且录完手工退回无关的那些（`design-lab:update` 会重录全部） |
