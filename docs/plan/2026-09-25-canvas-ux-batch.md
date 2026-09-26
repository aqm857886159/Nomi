# 画布手感三改：浮框钉住定宽 · 单个生成不弹窗 · 画布不自己动（2026-09-25）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 起因：用户 2026-09-25 三条反馈（方向已拍板）· 做法：一个分支、每项一笔提交、一个 PR · 范围：画布生成浮框、付费确认判据、画布视口移动与新内容落点
> 样张（已拍板，5 题全按默认）：[docs/design/mockups/2026-09-25-canvas-ux-batch/](../design/mockups/2026-09-25-canvas-ux-batch/README.md) · 在线 https://claude.ai/artifact/8PAKadacB2uZ8WbxJWScMC

## 0. 一句话结论

三件事的共同病根是**没有 owner 的决定被散在入口里**：浮框的位置由一个每帧量屏幕的放置层「躲」出来；「要不要弹付费确认」只有一条 ComfyUI 例外，其余入口一律弹；新东西落在哪没人管，于是每个建节点的入口事后各自挪一次画布。修法都是**立一个 owner、删掉入口里的补偿**。

## 1. 盘点（file:line 均在 origin/main d8824a0c5 实读）

| 项 | 现在谁管 | 问题 |
|---|---|---|
| 浮框 | `nodes/useComposerViewportPlacement.ts:72-210`（常驻 rAF + RO + MO，clamp/翻转/让停靠区）；宽度 `NodeGenerationComposer.tsx:362/392` `w-max` | 底部放不下时被 shift 推到节点身上；宽度随内容 360–880 变 |
| 付费确认 | `spend/spendConfirm.ts:209` `confirmGenerationSpend`，唯一规则「全 ComfyUI 不弹」 | 单个节点每次都弹；Agent 来源在进漏斗前丢了（`capability/storyboardPresent.ts:52`） |
| 视口 | 21 个移动入口（5 个 `requestCanvasFit`、10 个聚焦事件派发、6 个 `animateViewportTo` 写口），多数是程序自动的 | 付费卡落地先聚焦放大、360ms 后再适应全图 = 「闪一下」；默认落点写死画布坐标 |

## 2. 根因

- **浮框**：矩形是「视口 + 所有停靠 chrome」的函数，不是「自己节点」的函数。09-10 起每修一次就往量测循环里多加一个要躲的东西（合同 09-09 / 09-10 / 09-19 / 09-21×2 / 09-23）。
- **付费确认**：判据不存在，入口决定弹不弹；来源不进判据。
- **视口**：没有「新东西落在哪」的 owner，所有入口靠事后移动画布补偿；每加一个入口多一扇门。

## 3. 定法

1. `composerCanvasPlacement(visualSize, zoom)` 唯一决定浮框矩形：顶边 = 节点底 + 14、中线对齐、屏幕宽 560；删放置层。提示词右上角「展开」只在装不下时出现、只给画布宿主。
2. `spendConfirmationRequirement({initiator, runCount, hostingDisclosure})` 唯一判据：Agent / ≥2 份 / 首次托管 → 弹；否则直接开始但照样报价 → 铸令牌。**不看金额、不显示价格**（2026-09-26 用户拍板「先把价格这个维度隐藏掉，等后续官方上线再说」：现在所有模型都走中转、各家价格不一，Nomi 不计算价格；首版的「≥10 点」门槛、「无报价就问」和 ↑ 旁点数已删，见 PR #880）。
3. `store/canvasVisibleArea.ts` 决定落点（单点、整批、可见区内找空位）；`components/canvasArrivalModel.ts` + `CanvasArrivalHint` 用「store 里多出来且没看见」判新到并在边缘提示；删掉全部自动移动；`requestCanvasFit` 与聚焦事件的调用处上名单（结构测试）；打开分类只在本来有内容时摆一次全貌（见下「2026-09-26 协调裁定 B」）；动画中间帧不写 store。

## 先查别人（R5，第 4 节）

| 查了什么 | 结论 |
|---|---|
| React Flow `NodeToolbar`（https://reactflow.dev/api-reference/components/node-toolbar；实读 `node_modules/@xyflow/react/dist/esm/index.mjs:5079`，外壳 `NodeToolbarPortal` 在 `:5013`） | 官方节点浮层只钉锚点 + 反缩放，不做视口躲避——用户拍板的就是框架的答案；不直接用它，因为它在 portal 里、隐藏即卸载 TipTap |
| React Flow `setViewport({ duration })`（Context7 `/xyflow/xyflow`）+ 实读 `node_modules/.pnpm/@xyflow+system@0.0.81/node_modules/@xyflow/system/dist/esm/index.mjs:2991`（带时长 → d3 transition，promise 只在 `end` 结算）、`node_modules/.pnpm/d3-zoom@3.0.0/node_modules/d3-zoom/src/zoom.js:171`（`k = w / l[2]`，面板宽取缓存） | 带时长移动每帧除以缓存的面板宽度，0×0 那帧出 NaN → 画布空白；被打断的过渡 promise 不结算。保留自研逐帧直写，退出条件写进合同 |
| 仓库里已有：自研逐帧视口动画 `src/workbench/generationCanvas/components/viewportAnimationCoordinator.ts:40`、宿主 `src/workbench/generationCanvas/reactFlow/useReactFlowViewportAnimation.ts:66` | 复用，不另起；本分支只改成「动画中不逐帧写 store、结束写一次」，并把用户手势打断接到 `onMoveStart` |
| LibTV（用户指定参考；对象登记 `docs/research/competitive/sources.md:9`，站点 https://www.liblib.tv/plugin） | 提示词框右上角展开图标；发送钮旁「⚡ N」点数。我们用词典里「付费」那枚 `IconCoin`（§6），不另起 ⚡ |

## 5. 验收门

- 单测：`composerCanvasPlacement` 类级（任意尺寸 × 缩放）、`spendConfirmationRequirement` 全组合、`canvasArrivalModel`、`canvasVisibleArea`、`resolveInsertionPosition × visibleArea`、`canvasViewportMovers` 名单、`useAutoFitOnLoad.shouldFitOnOpen`；浏览器夹具 `composerLifecycle`。
- 真机走查（打包 Electron，used 夹具 1280×800，zh + en）：浮框钉在节点下 560 宽；单个不弹、×2 弹；新建不挪画布、落屏外出提示、点提示才过去。
- 核心冒烟 `core-smoke-spend-confirm` 加断言：付费卡落地前后视口不变。

## 6. 不动什么 / 回滚

- 不动：付费卡（Agent 面板介入槽）的宿主与档位判据 `spendDecidedByPolicy`；主进程花钱闸 `electron/spendGrant.ts`；画布拖拽 / 框选时贴边自动滚（用户手在拖）。
- 回滚：三项各一笔提交，可单独 revert；无持久化格式变化。

## 2026-09-26 协调裁定 B：打开时的一次适应保留，改为量完节点必定触发

2026-09-26 协调裁定 B：**打开时适应一次 = 用户拍板保留（样张第 4 题）；此前 main 上时序不稳，现改为节点量完后必定触发。**
更正：此前一版写「它在 main 上从未生效」是错的前提——真机诊断显示它时序相关：冷启动→「继续创作」这条路径摆了（zoom 0.36），磁吸走查 / 性能夹具那条没摆（节点出现后盲等 350ms，那一刻舞台或 React Flow 还没准备好就静默放弃）。
现在 `useAutoFitOnLoad` 逐帧等到「舞台量到尺寸 + 打开时的每个节点都进了 React Flow」再判一次（最多约 2 秒，超时保守不动）。判据不变：打开时本来有内容、且没有可用视角 → 摆一次全貌；打开时是空的、之后才长出来的节点一律不触发（由边缘提示指路）。`categoryViewports` 是项目级内存、每次打开都清空，所以每次打开有内容的项目都会摆一次——这就是用户选的行为。
性能：适应后（76 节点 / 32 条 1080p 视频，缩到 0.2、全部 76 个挂载）跟手量具全部在 #871 预算内（数字见 PR #880）。60 秒引导自己的那次适应仍保留：引导进项目时画布是空的、示例之后才落，打开时的适应按设计不管它。
