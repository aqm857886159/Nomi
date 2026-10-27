# 设计卡：生成框走查按 B3 重做——界面上选模型 + 本机回环供应商

改动名：`tests/ux/composer-overlap-and-fast-typing.walk.mjs` 按 B3 生成框重写；夜跑排除清单里它那一行的理由照实改
线/负责人：I-composer-walk-b3（Mac，Claude）/ `test/composer-walk-b3`
类别：[其他]（只改测试：一条走查 + 排除清单一行；不碰 `src/`、`electron/`）

## 为什么

发版前的全功能走查要覆盖 B3 生成框，这条走查还按 B3 之前的生成框写，覆盖不到：

- 它点「改图」方式钮、点「加参考」钮、认「输入图 1」小图——B3 把这三样都换掉了（`98434ef2c`；板 `docs/design/boards/2026-10-18/ComposerB3.board.json` 的 `legacy.mode-bar`、`legacy.dashed-slots` 已 dropped），走查第一步就点不到东西；
- 第 3 轮曾把模型在数据层钉死（`pinCanvasImageModelByCapability`），钉出来的是界面上那个模型选不到、或接不了参考图的假现场，已于 `b37483296` 撤回，留了「另立单重做」；
- 「优化 → 应用」要真 DeepSeek 官方端点和 key，所以它被夜跑排除（理由「requires a live DeepSeek API key」），平时也没人能跑。

它守的事情仍然要守：浮框钉在节点正下方（用户 09-25 拍板「被挡就挡」）、0ms / 5ms 快打不丢字、粘贴逐字相同、外部改写写进编辑器后继续快打不丢字、底栏芯片不被裁断。

## 现在的 B3 生成框长什么样（动手前先看真样子）

2026-10-27 上午在当天 `origin/main` 的构建上起隔离 App 实拍（内置 APIMart 档案 + 本机回环夹具，截图在本机 `.tmp/walk-b3-probe/`，含私人素材，不进仓库）。此后到 `dffacdeeb`，`src/workbench/generationCanvas/{nodes,quickActions,adapters,store}` 和 `src/design/NomiSelect.tsx` 没有新提交，看到的就是现在的样子：

- **新建图片节点**：浮框钉在节点正下方，宽 560。最上面一排参考行只有两颗 40px 方钮：「画布点选」（指针图标，`[data-reference-entry]`）和「+」（`[data-asset-add-tile]`），两颗的无障碍名都叫「加参考」。中间是提示词框（占位「描述这一帧的画面…」）和四颗快捷词。底栏左边是模型芯片（默认「Fixture 图片」，回环夹具自己的图片模型）和参数芯片（1024x1024），右边是提示词工具簇和生成钮。**没有**「文生图 / 改图」方式钮，也没有「输入图 1」这种槽位标签。
- **模型菜单**：点模型芯片弹出，列着 Seedream 5.0 Pro、Nano Banana 2、GPT Image 2、GPT Image 2.5 Flare、GPT Image 2.5 Sunburst、Gemini 3 Pro 图像、Grok Imagine 2.0、Qwen-Image 3.0（都标 APIMart）。选 GPT Image 2 后芯片显示「GPT Image 2」，参数芯片变成「自动 · 1K」。
- **「+」**：打开素材选择器（搜索框 +「上传本地文件」）。在新建节点上点「上传本地文件」选一张图：画布上多一张素材卡且**被选中**，图片节点的浮框收起，没有连线，参考行仍是空的（当时记下的图：选中项变成素材卡，连线 0 条，选择器、浮框都已关闭）。这是产品问题，见 ★1「已知坑」。
- **「画布点选」**：画布进点选态，点素材卡就连上线，方式从文生图（t2i）变成参考图生图（i2i）。参考行变成「画布点选」「+」（这时「+」叫「添加参考：上传或从素材库选」，`[data-reference-add-entry]`）加一张在用的小图（`[data-reference-row] [data-asset-slot-group="array"] [data-asset-tile]`），行尾写「参考图 1 张」，提示词占位多了「打 @ 可引用参考图」。
- **视频节点**：默认模型「可灵 3.0 Turbo」，生成框里同样没有方式分段；视频的方式在参数面板顶部（`src/workbench/generationCanvas/nodes/controls/generationModePresentation.ts:54-89`：图片恒 `where: 'none'`，视频要有 ≥2 种要放素材的方式才 `where: 'panel'`）。

14:51 在 `dffacdeeb` 的构建上复核了一遍（同一组画面，加「优化 → 应用」弹层、视频参数面板、英文 1100×720），结论不变：「+」上传后选中项变成素材卡、连线 0 条、选择器和浮框都关了；「画布点选」接上后有一条素材卡 → 图片节点的参考连线；视频节点的参数面板里只有比例 / 清晰度 / 时长，没有方式分段。英文参考行行尾写的是「1 references」（单数没变形，另报）。

## ★1 用户怎么用

当创作者把一张真实照片导入画布、新建图片节点、从底栏模型芯片里选一个模型、用参考行的「画布点选」把这张照片接进来，再把节点拖到画布左下角写提示词时，我想让生成框照旧钉在节点正下方、底栏字不被裁、快打和粘贴一个字不丢，以便不用为了「框被挡 / 字丢了」去挪画布或重打。

步骤（走查照真人路径走，一步不灌 store、不读 store）：

1. 新建空白项目，切到生成工作区。
2. 画布底部「导入」→ 系统文件选择器 → 选一张真实 4K 照片，画布上出现这张素材卡。
3. 加图片节点（新卡落在素材卡左边、一半压在左栏底下，先点缩放簇「适应视图」把两张卡放进视口，再点回这张卡），在生成框底栏点模型芯片，从菜单里选 GPT Image 2（内置 APIMart 档案，文生图 + 参考图生图）。
4. 点参考行「画布点选」→ 点那张素材卡：参考行出现一张在用的小图（方式随输入从文生图切到参考图生图）。
5. 拖节点到左下停靠区那片、再压到舞台底边、再把窗口缩到最小（1100×720）：每一格浮框都钉在节点正下方。
6. 0ms / 5ms 逐键打 ≥80 字中英混合串、Cmd+V 粘贴长文本：逐字相同、文字从不倒退。
7. 点「优化」→「优化提示」→「应用提示」：编辑器逐字变成文本模型回的那句，接着 0ms 快打追加串不丢字。
8. 加视频节点 →「适应视图」→ 把它拖到左下停靠区那片（适应视图只按节点框视口，新卡在最下面时生成框伸出舞台、点不进去），重复第 6 步，浮框钉在下方；换英文界面，重走 2–5 步和 0ms 快打。每次点进提示词框前先证它真人点得到（中心点在视口里、最顶层就是它）。

不做什么：不点生成（不发生图请求，生成链路另有走查）；不验「生成方式」分段（B3 图片节点没有，视频的在参数面板顶部，`tests/ux/composer-b3-real.walk.mjs` 在验）；不验参考行「+」→「上传本地文件」（见已知坑，产品问题另报）；不改产品代码；不进夜跑。

已知坑：

- 参考行「+」→「上传本地文件」在还停在文生图的新建图片节点上**接不上**：导入出来的素材卡被选中（`canvasNodeActions.addNode` 默认选中新卡）→ 生成框跟着收起 → `NodeInputReferenceEntry` 卸载、`shouldConnect()` 读到 false → 只建卡不连线（实拍见上一节）。这是产品问题，走查不绕它、也不替它修：加参考改走同样是生成框里真有的「画布点选」（板 `ref.tool.canvas-pick`），上传这条写进报告「发现的问题」交协调定。
- 新卡的落点由画布避让决定，不保证整张生成框在视口里：画布正中已有素材卡时，新图片节点落在它左边、一半压在左栏底下，生成框左半截（模型芯片）被左栏盖住，点不到；因为节点中心还在视口里，「新节点在…」提示也不出（`canvasArrivalModel.ts` 的 `isNodeSeen` 只看节点中心）。走查走真人会走的路：点「适应视图」。这条另报，不在走查里绕。
- 「适应视图」只按节点框视口，不算生成框：选中的卡在最下面时，它的生成框伸出舞台底边，提示词框点不进去——Playwright 的 click 照样「点得动」（它会先把容器滚一下），旧写法因此证明不了真人点得到。走查在每次点进提示词框前先证中心点在视口里、最顶层就是它，视频节点适应视图后再拖到左下停靠区那片（和图片节点同一个现场）。
- 「适应视图」是一段 200ms 的动画：等变换层停稳（`waitForCanvasViewportSettled`）再量、再拖。在动画半路量，拖的起点还是动画前的位置，等于没拖上（15:10 那一轮实测：视频节点没动，生成框留在舞台外，红在「点得到」那格）。
- 模型菜单只列此刻可用的模型；目录还在加载时芯片是骨架。走查等芯片出现再点，不等时长。
- 参考图用 `NOMI_REAL_MEDIA_DIR` 下的私有真实素材，CI 上没有：走查留在夜跑排除清单里，理由照实写真实素材。

真实任务：

1. 中文界面：导入素材登记表里的真实 4K 照片 `image-4k-png`（3840×2160 PNG，≥8 MiB），图片节点选 GPT Image 2、点选接上这张图，默认窗口和最小窗口下把节点拖进左下停靠区、压到舞台底边。
2. 中文界面：同一张卡上快打 ≥80 字中英混合串、粘贴、优化 → 应用、接着快打；再加视频节点快打、粘贴。
3. 英文界面：同样的图片节点流程，1100×720 下看底栏芯片。

指标（目标 → 信号 → 指标）：

- 主指标：浮框位置。目标「钉在节点正下方」→ 信号「卡片顶边 = 节点底边 + 14×缩放、中线对齐、屏幕宽 560」→ 每格三项全对的比例。基线：旧走查在 B3 上第一步就红、一格都测不到；目标 100%（中文 5 格、英文 3 格）。量具：本走查的 `assertComposerPinned`。
- 质量指标：快打与粘贴。逐字相同的比例目标 100%，纯插入期间文字倒退次数目标 0。量具：本走查的 `typeAndCompare` / `pasteAndCompare` 和回退探针。
- 质量指标：模型是从界面上选的。选之前芯片上不是它、菜单列着它、选完芯片显示它、菜单勾在它那行、参考入口可点，五项全对的比例目标 100%（中英各一次）。量具：本走查的 `pickModelInComposer`。
- 质量指标：参考图真用上了。接进来后参考行在用小图 = 1、「未用到」= 0，目标 100%（中英各一次）。量具：本走查的 `attachReferenceByCanvasPick`。
- 护栏指标：出图请求 0、夹具之外的请求 0、改写请求恰好 1 次。量具：本走查的 `expectNoGeneration`（夹具 `images` 计数）+ 夹具的 `assertClean()`（意外请求 / 没用上的剧本都判红）+ 出网闸 `NOMI_TEST_NETWORK_GUARD` + 本走查对改写请求数的断言。
- 未验证：Windows、打包版、真付费出图（走查不点生成）；真实用户里「浮框被挡」「上传参考没接上」的发生率缺量具（没有对应的使用事件）。

### ★1b 连带界面

不适用：只改测试，不新增任何界面文字或状态。

## ★2 谁说了算

只改测试，不碰任何产品概念；走查只读这些 owner 的结果，不替它们写：

- 浮框位置：`src/workbench/generationCanvas/nodes/composerCanvasPlacement.ts`（只看节点画布尺寸 + 画布缩放）。走查在屏幕坐标里量，不读 store。走查里的 14 / 560 是它和 `nodeSizing.ts` 那组数的镜像，旧走查就有，照留（注释写明出处）；改这组数是产品决策，走查跟着改。
- 选模型：节点 `meta` 里的模型身份，写口是生成框的模型芯片（`InlineParameterBar` 的 `NomiSelect` → `useDedupedModelSelect.onModelPick` → `handleModelChange`）。走查只经芯片选，不调 `__nomiCanvasStore`，也不用 `tests/ux/_directorLab.mjs` 的 `pinCanvasImageModelByCapability`（那是数据层钉模型，正是这次要换掉的写法）。
- 参考图：导入归画布导入那一条（加节点条「导入」→ `importLocalFilesToGenerationCanvas`）；接线归参考行「画布点选」→ `pickCanvasInputFor` → `connectExistingInput`（和手拉连线同一道总闸）。走查只认参考行里在用的小图。
- 外部改写：`NodePromptOptimizer` 的「应用」→ `updateNode(prompt)`。文本模型由 `getTextBrain({ strict: true })` 解析（`src/workbench/api/promptLibraryApi.ts:133`：Agent 面板选了谁就是谁，没选就回落到默认文本模型；这条走查里落到夹具目录的回环文本模型，报告 `external.model` 记下请求里实际的模型名）。
- 远端：`tests/ux/agent-runtime-fixture.mjs` 的本机回环夹具（`createRuntimeWalk(…, { generationProvider: 'apimart' })`：内置 APIMart 档案 + 出网闸把 `api.apimart.ai` 指到本机夹具）。夹具只放写定的剧本，没写的请求一律判红。

同一份事实只存一份：夹具收到的请求就是「走没走回环、调了几次、有没有出图」的唯一证据，走查不另记一份计数。没有靠「东西不见了」猜意图的地方。

## ★3 一致与复用

- 启动 / 夹具 / 出网闸 / 屏外窗口 / 收尾报告：复用 `tests/ux/agent-runtime-walk-support.mjs` 的 `createRuntimeWalk`（`start` / `snap` / `resizeWindow` / `stopApp` / `finish`）和 `recorded`（等夹具收到请求的有界等待）。旧的 `launchWithDeepSeek`（起两次 App、手写 safeStorage 密文、手改 catalog）、`setViewport`、`redact` 同提交删掉。
- 外壳：`tests/ux/_shell.mjs` 的 `newProjectEntry`、`switchWorkspace`、`canvasAddBar`、`addCanvasNode`、`canvasFitView`、`setAppLanguage`（`addCanvasNodeFromRail` 只是 `addCanvasNode` 的旧名字，新走查直接用 `_shell.mjs`）。
- 等画布停稳：`tests/ux/_canvasHit.mjs` 的 `waitForCanvasViewportSettled`（读变换层计算样式、连续 800ms 不动才算停），和 `derived-node-placement.walk.mjs` 适应视图之后同一个等法；不写 `waitForTimeout`。
- 「真人点得到」：`tests/ux/_assert.mjs` 的 `expectHittable`（中心点 `elementFromPoint` 命中它自己），不另写一份。
- 导入走系统文件选择器（`waitForEvent('filechooser')` → `setFiles`），和 `tests/ux/contextual-node-guidance.walk.mjs` 同一口径；不往隐藏 input 里直接塞文件。
- 真实素材：`tests/ux/fixtures/realMedia.mjs` 的 `requireRealMediaAssets(['image-4k-png'])` 直接取登记的文件，和 `tests/ux/real-media-import.walk.mjs` 同一口径——登记表是唯一来源，走查里不现场抽帧、不带本机路径；缺素材当场红，不跳过、不退回合成图。（上一条线的草稿是从 4K HEVC 视频现场抽一帧，改掉。）
- 文案：一律 `uiText(locale, 键)`（`tests/ux/full-walk/invariants.mjs`），不抄词典原文（`check:test-copy-literals` 的棘轮只减不增，这个文件基线 6 处，改完为 0）。
- 参考行断言和 `7f977acfe` 改过的两条组走查同一口径：认参考行里在用的小图、没有「未用到」。
- 几何量法（`measureComposer` / `pinProblems` / `dragNodeToBottomLeft`）、回退探针、`readPrompt` 照旧，只把「第一个浮框」改成「这张节点的浮框」（画布上还有导入的素材卡、视频节点）。
- 不抽新的共用辅助函数，不改别的走查。

## ★4 全状态

走查自己不新增界面状态；下面是它会遇到的每个状态、看到什么、怎么判：

- 空：新建项目的画布没有节点；导入、加节点后各自出现（等元素，不等时长）。
- 加载：导入中素材卡是导入进度层 → 等卡上出现本地图（`img[src^="nomi-local://"]`）；模型目录加载中芯片是骨架 → 等芯片出现再点；改写流式中 → 等夹具收到请求（有界等待），再点「应用提示」。
- 成功：每一格的判据都对；`report.json` 记模型、参考、几何、打字、改写五类证据，截图逐格留。
- 失败：任一判据红 → 当场停，留 `FAIL.png` 和 `report.json`，退出码 1（`walk.finish`）。
- 部分成功：中文轮过、英文轮红也算红；报告里分轨记。
- 取消中：不适用——走查不发起可取消的长任务（改写是一次流式文本，夹具一次回完；点选态点中即退出，走查断言它退出了）。
- 过期：不适用——每次都是新的隔离资料目录。
- 能力不可用：
  - 模型菜单里没有「能选、又收参考图」的模型 → 走查红在「模型是从界面上选的」那格，这是要报的发现，不是走查该绕过去的事；
  - 选中的模型不收参考图 → 参考入口灰掉（悬停写原因）→ 红在「参考入口可点」；收了但用不上 → 小图淡显「未用到」→ 红在「没被淡显」；
  - 真实素材目录没设或缺文件 → `requireRealMediaAssets` 当场抛（不跳过）；
  - 文本模型没配上 → 优化弹层报「去配置文本模型」，夹具收不到请求 → 红在有界等待那一步。

## ★9 验收与回滚

### 断言对账表（旧走查每条断言在 B3 下的去向）

行号指 `origin/main` `dffacdeeb` 上旧走查（`git show dffacdeeb:tests/ux/composer-overlap-and-fast-typing.walk.mjs`）。拿不准的一律按「保留」处理并标出来；这张表里没有拿不准的退役。

| # | 旧断言 / 旧步骤（行号） | 去向 | 新形式，或退役依据 |
|---|---|---|---|
| 1 | 必须有 `DEEPSEEK_API_KEY`，没有就抛（L37-38）；日志与报告里遮 key（`redact`，L64） | 退役 | 外部改写换成本机回环夹具，全程不要任何 key，也就没有要遮的东西（派工书「零花费、不要 DeepSeek key」）。出网闸 `NOMI_TEST_NETWORK_GUARD` 只放本机。 |
| 2 | 文本大脑解析到隔离 catalog 里的 DeepSeek（L90-91；`launchWithDeepSeek` 起两次 App、手写 safeStorage 密文） | 改 | 不再读 preload 的 `textBrain()`（那不是用户看得见的结果）。以夹具为证：改写请求恰好一次、带编辑器里的原句；`assertClean()` 不许有没写剧本的请求。 |
| 3 | 新建空白项目、点「生成」标签、加节点条就绪（L96-98，按中英文抄字面量） | 改 | `newProjectEntry` + `switchWorkspace(win, 'generation')`（外壳唯一出口）+ 加节点条可见；不抄文案。 |
| 4 | 「不分享」同意卡：看得见就点掉（L99-100） | 退役 | 这不是断言，是一道「可见才点」的软防护。那张卡只在**第一次打开 Agent 面板的空态**里出现（`src/workbench/ai/v4/AgentPanelV4Consent.tsx:3`）；这条走查不开 Agent 面板。万一冒出来挡住了点击，会红在那一步点击上，不会静默通过。 |
| 5 | `setViewport`：设原生窗口 + 视口，量回内容区 = 目标尺寸（L104-110） | 改 | `walk.resizeWindow`：同样两步，量回不等就抛（`tests/ux/agent-runtime-walk-support.mjs:543-557`）。 |
| 6 | 新建图片节点后浮出生成浮框（L394） | 保留 | 改成按**这张节点的 id** 认浮框（画布上还有导入的素材卡和后加的视频节点，「第一个浮框」认不准）。 |
| 7 | 点「改图」方式钮（L395）；EN 点名字含 edit 的第一个钮（L459） | 退役 | B3 图片节点没有方式钮，方式随输入走：`generationModePresentation.ts:54` 对图片恒返回 `where: 'none'`；B3 落地提交 `98434ef2c`；板 `ComposerB3.board.json` 的 `legacy.mode-bar` 已 dropped（用户 2026-10-18）。「走到了参考图生图」改由新增 N2 证明。 |
| 8 | 「加参考」钮 →「上传本地文件」→ 出现「输入图 1」小图（L363-365，EN 同） | 改 | 旧的那一颗「加参考」在 B3 拆成参考行的「画布点选」和「+」两颗（新建节点上两颗的 aria 都叫「加参考」，旧定位器会同时撞上两颗）；「输入图 1」这个标签也没了（小图按素材名标）。新路：画布底部「导入」经系统文件选择器导入真实 4K 照片 → 参考行「画布点选」→ 点那张卡 → 参考行有 1 张**在用**的小图、没有「未用到」（N2）。参考行「+」→「上传本地文件」在新建图片节点上接不上，见 ★1 已知坑，另报。 |
| 9 | 参考图用仓库里的 `tests/ux/fixtures/hires-detail-1024x1792.png`（L42） | 改 | 用 `NOMI_REAL_MEDIA_DIR` 下登记的真实 4K 照片 `image-4k-png`（派工书「真实素材」）；缺文件 `requireRealMediaAssets` 当场抛。 |
| 10 | 钉住不变量：顶边 = 节点底边 + 14×缩放（±2）、中线对齐（±2）、宽 560（±1）（`pinProblems` L270 起；各格 L398 / 402 / 409 / 416 / 448 / 463 / 468 / 473） | 保留 | 中文 5 格（默认位置、左下默认窗口、压到底边、最小窗口、视频节点）+ 英文 3 格，和旧走查格数一样。 |
| 11 | 底栏在、底栏里有控件、底栏芯片文字不被裁断（L296-298） | 保留 | 原样。1100×720 英文仍是芯片裁断的现场。 |
| 12 | 压到底边那格先证浮框确实伸出了舞台底边（L299-301） | 保留 | 原样（这一格的基线，不然是摆设）。 |
| 13 | 「生成方式」模式栏完整在卡内、不被参考区滚动口裁、不与提示词区相交（L302-303，旧注释「追加 C」） | 退役 | 同 #7：B3 图片节点没有这一组；视频节点的方式组在参数面板顶部（`presentGenerationModes` 视频分支返回 `where: 'panel'`），`tests/ux/composer-b3-real.walk.mjs` 在验参数面板方式组。 |
| 14 | 浮框在屏上时模式 tab 都点得中（L304-306，`onScreen`） | 退役 | 同 #13。 |
| 15 | 拖节点前量得到节点、舞台与缩放条（L339） | 保留 | 原样。 |
| 16 | 拖完浮框还在，不在就点节点重新选中（`ensureComposerOpen`，L349-353） | 保留 | 按节点 id 认。 |
| 17 | 0ms / 5ms 逐键快打 ≥80 字中英混合串，逐字相同、回退 0 次（L160-175；中文图片 + 视频、英文图片 0ms） | 保留 | 原样，按节点 id 读编辑器。 |
| 18 | 一次性粘贴长文本逐字相同（L177-183） | 保留 | 原样。 |
| 19 | 「真模型给出优化结果」：「应用提示」钮在限时内出现（L373-375） | 改 | 先给夹具写好改写剧本；等夹具收到带原句的请求（`recorded` 有界等待）再点「应用提示」。 |
| 20 | 外部改写写进编辑器：改后 ≠ 改前且非空（L377-379） | 改（收紧） | 编辑器**逐字等于**夹具回的那句。 |
| 21 | 改写后 0ms 追加，逐字 = 改写结果 + 追加串（L436-437） | 保留 | 原样。 |
| 22 | 新建视频节点后浮出生成浮框（L444） | 保留 | 按节点 id 认。旧走查加完视频节点就地打字；现在画布上多了导入的素材卡，视频节点落在最下面、生成框伸出舞台，所以先「适应视图」、等画布停稳，再把它拖到左下停靠区那片（N4 证编辑器真人点得到）。 |
| 23 | 失败留 `FAIL.png` 和 `report.json`、退出码 1（L479-487） | 改 | `walk.finish`：同样留两样，再加 `fixture.assertClean()`；产出在 `.tmp/pi-composer-overlap-and-fast-typing-development-<时间>/`，不再写进 `tests/ux/shots/`。 |
| N1 | （新增）模型是从界面上选的 | 新增 | 选之前芯片上不是它 → 菜单里列着它 → 点完芯片显示它 → 再开菜单勾在它那行 → 参考行「画布点选」和「+」可点。中英各一次。 |
| N2 | （新增）参考图真用上了 | 新增 | 接进来后参考行里在用的小图 = 1，「未用到」= 0（基线由在用小图证明探针活着）。中英各一次。 |
| N3 | （新增）夹具护栏 | 新增 | 改写请求恰好 1 次；全程出图请求 0（没点生成）；`assertClean()` 没有意外请求、剧本全用完。 |
| N4 | （新增）提示词框真人点得到 | 新增 | 每次点进提示词框前 `expectHittable`：中心点在视口里、最顶层就是它。起因：14:57 那一轮全绿，可视频节点的提示词框其实在舞台外，是 Playwright 先滚了容器才点进去的——「打字没丢」证明不了真人够得着。 |

### 验收清单（实现线自验、验收线只核这张）

1. 只改两个文件：`tests/ux/composer-overlap-and-fast-typing.walk.mjs` 和 `tests/ux/nightly-ci-exclusions.json` 里它那一行；`src/`、`electron/`、别的走查零改动（`git diff --stat origin/main...`）。
2. 走查里不再用 `DEEPSEEK_API_KEY`、`__nomiCanvasStore`、`pinCanvasImageModelByCapability`，也不再按「改图」「加参考」「输入图 1」这些 B3 前的名字找控件（`git grep` 只剩注释里的来历说明）。
3. 中文、英文两轨跑通，退出码 0，截图逐张人眼看过：浮框在节点正下方、参考行有一张真实照片的小图、芯片上是选中的模型名、菜单勾在它那行。
4. 夹具 `assertClean()` 过：没有意外请求、改写剧本恰好用掉一次；出图请求 0。
5. 排除清单那一行的理由改成真实素材那条，和同表 `whiteboard-refactor` 一个写法；`scripts/nightly-walk-selection.node-test.mjs` 照过。
6. ESLint（改到的走查文件）、`node scripts/check-test-waits.mjs`、`node scripts/check-walkthroughs.mjs`、`git diff --check`、推送前快检全过，各记退出码。

### 反例（真做，做完还原）

| 反例 | 预期 | 证据 |
|---|---|---|
| 把 `composerCanvasPlacement.ts` 标准分支的下边距改错：`top: visualSize.height + NODE_COMPOSER_GAP` 改成 `+ NODE_COMPOSER_GAP * 2`（间距从 14 变 28，只差 14 个画布单位，验判据的 ±2 灵敏度），重新构建后跑走查 | 红在「中文·默认位置」的钉住判据（顶边 ≠ 节点底边 + 14×缩放）；`git restore` 还原、重新构建后转绿 | 实现后填进报告 |
| 把「界面上选模型」那一步换回数据层钉模型（第 3 轮的 `pinCanvasImageModelByCapability(win, nodeId, 'reference-image')`，为让它真钉得上，同时置 `__nomiE2E` 开 store 桥） | 红在「模型是从界面上选的」：芯片上不是选中的那个模型（钉模型按档案名排序挑了别的模型）；还原后转绿 | 实现后填进报告 |
| 参考图被淡显成「未用到」（模型不收这张图） | `expectAbsent([data-reference-unused])` 红；基线由「参考行里有在用的小图」证明探针活着 | 走查自带判据，不另造现场 |

这一类还会从哪儿回来：换一个默认模型（菜单顺序变了）→ 判据按模型名找，不按位置；默认模型恰好就是 GPT Image 2 → 「选之前芯片上不是它」先红，提醒换一个要选的模型；B3 再改底栏 → 选择器都按 `data-bar-segment` / `data-node-composer-footer` / 词典键找，`check:walkthroughs` 的死锚点规则会先红；参考行改结构 → `IN_USE_TILE` 认 `data-reference-row` 下的槽，死锚点规则同样先红；上传那条修好以后 → 加参考可以改回「+」→「上传本地文件」，那时同提交把「画布点选」这条换掉。

回滚：revert 走查改写那个提交即可（设计卡留着）；排除清单那一行跟着一起回去。

独立验收：待协调定。

### 功能分类

- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

只改测试，路径推不出类别（`docs/engineering/test-routing.json`）；走查覆盖的是画布交互，但不改它。

拍板图：不适用——不改界面。
