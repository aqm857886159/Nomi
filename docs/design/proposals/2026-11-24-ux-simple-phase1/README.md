# UX-simple 第一段只读全项目真窗审查报告（复杂留给系统，不留给用户）

- **审查基线**：`origin/main` @ `1730b7ea3`（100% 只读，仓库工作树 `0` 改动）
- **真窗环境**：隔离 Electron 实例 + `fake-apimart` 本地回环夹具 + `walkthrough-network-guard.cjs` 网闸（`0` 外部请求、`0` 真付费消耗、`UIElement` 屏外安静模式 `0` 次抢前台焦点）
- **常驻驱动量具回执（`node scripts/verify-line-meter.mjs`）**：
  - 主旅程实测目录：`驱动脚本 0 个 · 0 行 · 常驻驱动命令 60 次（跳过源码拷贝 0 处）`
  - 节点与设置深挖目录：`驱动脚本 0 个 · 0 行 · 常驻驱动命令 97 次（跳过源码拷贝 0 处）`

---

## 一、全项目真窗截图矩阵（6 屏 × 6 变体 + 未接模型空态 + S-D/S-E 现状 + 主旅程 15 帧）

全部 **88 张**真 Electron 窗口 PNG 均已落盘并通过 `read_file` 逐张亲眼核对：

| 屏幕分类 | `1440×900` 桌面四轨（`zh-CN`/`en` × `light`/`dark`） | `1100×690` 窄窗两轨（`zh-CN.light` / `en.dark`） | 专项深挖与状态真图 |
| --- | --- | --- | --- |
| **① 项目库 (`library`)** | `01-library.1440x900.{zh-CN,en}.{light,dark}.png` | `01-library.1100x690.{zh-CN.light,en.dark}.png` | `01-library-unconfigured.1440x900.zh-CN.light.png`（未接模型首屏）、`j01-library.zh-CN.light.png`（已接模型空库） |
| **② 创作文稿与分镜 (`creation` + `storyboard`)** | `02a-creation-text.1440x900.{zh-CN,en}.{light,dark}.png`<br>`02b-storyboard.1440x900.{zh-CN,en}.{light,dark}.png` | `02a-creation-text.1100x690.{zh-CN.light,en.dark}.png`<br>`02b-storyboard.1100x690.{zh-CN.light,en.dark}.png` | `j03-written-text.zh-CN.light.png`、`j04-selected-text.zh-CN.light.png`（选句浮条） |
| **③ 生成画布与底栏 (`canvas` + `Seedance 2.5` + `Seedream 5.5/5.0 Pro` + `画板`)** | `03-canvas.1440x900.{zh-CN,en}.{light,dark}.png` | `03-canvas.1100x690.{zh-CN.light,en.dark}.png` | `03-canvas-unconfigured.1440x900.zh-CN.light.png`；`S-D` 现状 7 张（`current-video-model-menu`、`current-seedance-2.5-{composer,mode-menu,params-panel,advanced-settings,result-card,result-card-full}`）；`S-E` 现状 9 张（`current-image-model-menu`、`current-seedream-5.5-{composer,params-panel,advanced-settings,result-card}`、`current-seedream-5.0-pro-{composer,params-panel}`、`current-whiteboard-{toolbar,layers-panel}`） |
| **④ 时间轴预览与导出 (`preview` + `export`)** | `04-preview-export.1440x900.{zh-CN,en}.{light,dark}.png` | `04-preview-export.1100x690.{zh-CN.light,en.dark}.png` | `j13-preview-before-clip.zh-CN.light.png`、`j14-preview-clip-on-timeline.zh-CN.light.png`、`j15-export-complete.zh-CN.light.png` |
| **⑤ 常驻 Agent 面板 (`agent`)** | `05-agent.1440x900.{zh-CN,en}.{light,dark}.png` | `05-agent.1100x690.{zh-CN.light,en.dark}.png` | 含右侧停靠态、窄窗 320px 紧缩底栏态、遥测首问卡与 Toast 遮挡现场 |
| **⑥ 设置各标签页 (`settings`)** | `06-settings-{file,models,ai,automation,general,about}.1440x900.{zh-CN.light,en.dark}.png` + `{models,general}` 四轨齐全 | `06-settings-{models,general}.1100x690.{zh-CN.light,en.dark}.png` | 覆盖全部 6 个页签（文件与保存 / 模型 / AI 策略 / 自动化与权限 / 通用 / 关于） |

---

## 二、核心创作者旅程基线实测（`建项目 → 写 → 出图 → 出视频 → 进时间轴 → 导出`）

### 2.1 路径 A：从「创作」写脚本出发的标准闭环（真窗实测步进表）

在新建隔离资料（已接 `fake-apimart`，`1280×800` 默认窗口）中按真人手点走完全程，逐动作对账如下：

| 步序 | 阶段 | 创作者真实动作 | 对应真窗截图 | 点击数 | 键入/快捷键数 | 被迫做的认知决定数（决定内容） | 当前卡点性质 |
| --- | --- | --- | --- | :---: | :---: | --- | --- |
| 1 | 建项目 | 项目库空态三卡中点「新建空白项目」 | `j01-library.zh-CN.light.png` → `j02-after-new-project.zh-CN.light.png` | 1 | 0 | **1**（在「新建空白项目 / 打开已有文件夹 / 重看一遍引导」三张同级大卡里挑入口） | 正常必经 |
| 2 | 写 | 点进创作页文稿编辑区并输入故事句子 | `j03-written-text.zh-CN.light.png` | 1 | 1 | **1**（写完后发现整条 18 钮工具栏全是 Markdown 排版、无任何「去生图/拆分镜」按钮，被迫读占位提示寻找下一步） | **摩擦**（缺直达出口） |
| 3 | 写→出图 | 按占位提示「选中文字」全选句子唤出选区浮条 | `j04-selected-text.zh-CN.light.png` | 0 | 1 (`⌘A`) | **1**（占位文字写「点右侧即可生成」，实际右侧是无反应的 Agent 栏；真正入口在文字上方浮条最右两颗无文字纯图标里辨认哪颗是图片） | **摩擦**（指路错 + 纯图标猜谜） |
| 4 | 写→出图 | 点选区浮条上的「生成图片」图标钮 | `j05-after-click-gen-image.zh-CN.light.png` | 1 | 0 | **1**（以为点「生成图片」会开始生图，实际只建了空节点并切到画布；且画布自动 `fitView` 放大到 **`188%`**，生成框与 `↑` 发送钮整块掉出屏幕底沿外！） | **严重阻断**（视口放大越界） |
| 5 | 视口自救 | 连点 3 次左下角 `−`（`188% → 96%`）并重选节点，把生成框底栏拉回屏幕内 | `j06-zoomed-out-composer-visible.zh-CN.light.png` | 4（3 次 `−` + 1 次选节点） | 0 | **1**（被迫排查「我的输入框和发送键去哪了」，自己决定缩放到多少倍才能同时避开底部时间轴条） | **纯浪费**（4 次点击本应为 0） |
| 6 | 出图 | 核对默认图片模型/比例（`Seedream 5.0 Pro · 1:1 · 2K`）并点右下 `↑` 生成素材 | `j07-image-generated.zh-CN.light.png` | 1 | 0 | **1**（判断默认模型与 `1:1` 画幅是否符合预期并点发送） | 正常必经（花钱确认） |
| 7 | 出图→出视频 | 在已生成的图片节点上找「图生视频」：顶部 10 钮浮条无「转视频」入口，需发现并点节点右侧圆圈 `+` | `j08-after-click-right-plus.zh-CN.light.png` | 1 | 0 | **1**（扫完浮条「多机位九宫格 / 抠图 / 改图 / 宫格 / 画板…」10 项发现没有「生成视频」，再去点右侧无文字 `+` 锚点） | **摩擦**（主路径藏在次级锚点） |
| 8 | 出图→出视频 | 在「用这个节点生成」菜单里点「视频」 | `j09-spawned-video-from-image.zh-CN.light.png` | 1 | 0 | **1**（在「图片 / 视频 / 声音(灰) / 文字」四项里选「视频」；新视频节点落位在右侧，600px 生成框右半截与 `↑` 钮以 `x=1380 > 1280` 裁出窗口右沿，且卡面印着假阻塞文案「已连接输入，等上游产出后继续。」） | **严重阻断**（横向出窗 + 假等待文案） |
| 9 | 视口自救 | 再点 `−` 缩小并点选视频节点（`96% → 77%`），让右侧 `↑` 生成钮进入窗口内 | `j10-video-composer-in-view.zh-CN.light.png` | 2 | 0 | **1**（判断「等上游产出后继续」其实是误报、并手动缩放到 `77%` 把 `↑` 钮救回屏内） | **纯浪费**（2 次点击本应为 0） |
| 10 | 出视频 | （可选换 `Seedance 2.5` 或用默认模型）输入运镜动作词，点 `↑` 生成视频 | `j11-video-generated.zh-CN.light.png` → `j12-video-settled.zh-CN.light.png` | 1（换模型另 +2） | 1 | **1**（新派生的视频节点未带入原句上下文，需重想/重敲运镜词并确认画幅——默认 `Vidu Q3` 还会把 `1:1` 首帧配成 `16:9`） | **摩擦**（未继承/对齐上游画幅） |
| 11 | 进时间轴 | 点顶栏「预览」切到预览工作区（注：画布浮条第 9 颗无字折线图标虽可贴尾，但无文字极难认出） | `j13-preview-before-clip.zh-CN.light.png` | 1 | 0 | **1**（在画布浮条无字图标 vs 顶栏「预览」之间找时间轴入口；进预览后空舞台写「从『生成区』拖入素材」，实际点左侧镜头缩略图即可贴尾） | **摩擦**（术语不一 + 引导绕远） |
| 12 | 进时间轴 | 点左侧「镜头」栏里的视频缩略图（点击加到片尾） | `j14-preview-clip-on-timeline.zh-CN.light.png` | 1 | 0 | **0**（一键贴尾；但若素材是 `9:16` / `1:1`，预览画幅仍死守 `16:9` 留黑边，改画幅藏在收起的「属性」侧条里） | 存在隐性画幅坑 |
| 13 | 导出 | 点顶栏右上「导出 MP4」输出成片 | `j15-export-complete.zh-CN.light.png` | 1 | 0 | **0**（直接导出，无需填弹窗；但导出完成后界面内无持久成功回执或「打开所在文件夹」入口） | 缺持久回执 |
| **合计** | **全链路 6 段** | **从空库到落盘真实 `.mp4`（不计可选换模型的 +2 点）** | `j01` – `j15` | **16 次点击**（含换模型为 18 次） | **3 次键入/选区**（共 **19 次交互**） | **11 个认知决定** | 其中 **6 次点击 + 5 个决定**由视口越界、入口隐藏与系统未自动对齐造成 |

### 2.2 路径 B（对照快径：跳过创作页，直接在生成画布手建节点）与 Phase 2 可证伪目标

| 对比维度 | 路径 A 现状（经创作页选句建节点） | 路径 B 现状（空项目切「生成」点底栏加节点） | Phase 2 修后可证伪目标（路径 A） | 减少的交互与判断明细 |
| --- | :---: | :---: | :---: | --- |
| **总点击数** | **16 次**（换模型 18 次） | **12 次**（省掉选句，但右 `+` 派生视频同样出窗需自救） | **≤ 10 次**（减 **-6 次 / -37.5%**） | 消除 `创作→生成` `188%` 越界自救 **-4 次** + 消除右 `+` 派生视频出窗自救 **-2 次** |
| **键入 / 选区数** | **3 次**（写文稿 + `⌘A` 选句 + 重敲视频运镜词） | **2 次**（敲图片词 + 敲视频词） | **≤ 2 次** | 创作页提供免框选直达/整段转节点（省 `⌘A`），或图转视频可选沿用/微调原描述 |
| **需要用户做的决定数** | **11 个** | **8 个** | **≤ 5 个**（减 **-6 个 / -54.5%**） | 只留真正属于创作意图的 5 个决定（建项目、写内容、确认出图、确认出视频、点导出）；砍掉找入口、救视口、辨认假等待文案、手动对齐首帧/时间轴画幅 6 个伪决定 |

---

## 三、全项目 8 条极简原则逐屏问题总表（按 `频率 × 卡顿` 严格降序）

> **评分口径**：`遇到频率 (1–5)` × `单次卡顿程度 (1–5)` = **`1–25 分`**。每条均落到实测真窗截图与相对仓库根精确 `file:line`。

| 排名 | 频率×卡顿分 | 在哪（屏幕 + repo 相对 `file:line`） | 违反哪条（1–8） | 创作者那一刻卡在哪（具体摩擦） | 改前真窗截图名 | 建议修法与修后少哪一步/哪个判断 | 是否需停下问用户 |
| :---: | :---: | --- | :---: | --- | --- | --- | --- |
| **1** | **25** `(5×5)` | **创作→生成画布**<br>`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx:340-350`<br>`src/workbench/generationCanvas/components/useAutoFitOnLoad.ts:65-85`<br>`src/workbench/creation/selectionActions.ts:71-74` | **1, 6, 7** | 从创作页选中句子点「生成图片/视频」切入画布（或单节点点「适应视图」）时，`fitView` 用 `CANVAS_MAX_ZOOM = 3` 只框住 `340×340` 空节点本身、未计入下方 `220px` 生成框高度，把空节点放大到 **`188%`**，导致提示词与 `↑ 生成素材` 整块掉出屏幕底沿外，用户盯着空白大框找不到发送键，被迫连点 3 次 `−`。 | `j05-after-click-gen-image.zh-CN.light.png` | `useAutoFitOnLoad` 首进自动取景上限钉在 `maxZoom <= 1`，并在单选节点自动对焦/适应时把 `composerInitialFootprint` 并入外接盒。<br>**修后省掉**：4 次缩放/重选点击 + 1 次「输入框去哪了」排查。 | **直修**（零碰在跑线，属明显视口缺陷） |
| **2** | **20** `(5×4)` | **生成画布（派生视频）**<br>`src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:378`<br>`src/workbench/generationCanvas/nodes/render/CardCommon.tsx:187`<br>`src/i18n/locales/generationCommon.ts:132` | **8** | 从「**已生成完毕**」的图片节点右侧 `+` 派生下游视频节点时，`BaseGenerationNode.tsx:378` 直接传 `waitingUpstream={hasFrameSourceEdge}`（只判有没有连边、没判上游节点是否已有结果！），导致视频卡面大字印着 **`「已连接输入，等上游产出后继续。」`**，骗创作者以为上游还没好、不敢点生成。 | `j09-spawned-video-from-image.zh-CN.light.png` | 将 `waitingUpstream` 改为仅当入边上游节点**尚无可用产出**（`!sourceHasResult`）时才为 `true`；上游已就绪时直接显示可生成空态。<br>**修后省掉**：1 次误以为被阻塞的假等待困惑。 | **直修**（零碰在跑线，修布尔判据 bug） |
| **3** | **20** `(5×4)` | **生成画布（右 `+` 派生与生成后长高）**<br>`src/workbench/generationCanvas/quickActions/deriveFromNode.ts:79`<br>`src/workbench/generationCanvas/nodes/composerCanvasPlacement.ts:16-45` | **6, 7** | ① 点图片右侧 `+` 新建下游视频节点时，新节点落在源右侧且画布不跟随微移，`600px` 生成框右半边连同 `↑ 生成素材`（`x=1380 > 1280`）直接裁出屏幕右沿；`1100×690` 窄窗下靠左节点的生成框左半边（模型名被切成 `am 5.0 Pro`）又钻进左栏底下。<br>② 视频生成完卡片长高，直接把底栏 `重新生成 ↑` 顶进底部「时间轴」条下方遮死。 | `j09-spawned-video-from-image.zh-CN.light.png`<br>`03-canvas.1100x690.en.dark.png`<br>`current-seedance-2.5-result-card.zh-CN.light.png` | ① 右侧 `+` 建下游节点并自动选中时，调用与 `addNode` 相同的视口可见性平移让新节点+底栏完整入画（直修）；<br>② 浮框靠边左/下夹持涉 `2026-09-25`「钉在节点正下方、被挡就挡」拍板边界。<br>**修后省掉**：每次派生下游节点后的 2 次手动平移/缩放自救。 | **拆两半**：① 新建下游节点自动平移入画可**直修**；② 改 `composerCanvasPlacement` 夹持规则**需问用户**（涉 09-25 拍板） |
| **4** | **20** `(4×5)` | **生成画布（图片节点浮条 → 图生视频）**<br>`src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:241-253`<br>`src/workbench/generationCanvas/nodes/NodeVideoFrameToolbar.tsx:63-123` | **4, 7, 8** | ① 图片生成完后，浮条摆了 10 项（`复制 / 多机位九宫格 / 抠图 / 改图 / 宫格 / 画板 / 全屏 / 下载 / 记录 / 折线图标`），偏偏**没有最核心的「生成视频 / 图生视频」**，逼人去猜右侧小圆圈 `+`；<br>② 图片与视频浮条最右第 9/10 颗核心主链路动作「加入时间轴」只有一枚抽象折线图标 `~`、无文字，反倒是低频「提取深度」「多机位九宫格」占满整串汉字。 | `j07-image-generated.zh-CN.light.png`<br>`current-seedance-2.5-result-card.zh-CN.light.png` | ① 图片浮条补显著「生成视频」入口（复用右侧 `+ → 视频` 同一派生写口，不花钱）；② 评估把「入轨/时间轴」显出短字或高辨识度图标（注：节点快捷动作浮条有 `10-04` 批次 1 样张）。<br>**修后省掉**：每次出图后找「怎么转视频」与「怎么进时间轴」的 2 次搜寻判断。 | **需协调确认板边界**（涉节点浮条已拍板排布，不涉花钱） |
| **5** | **16** `(4×4)` | **创作页（文稿编辑与选句浮条）**<br>`src/i18n/locales/creationAi.ts:30`<br>`src/workbench/creation/SelectionGeneratePopover.tsx:164-230` | **2, 4, 8** | ① 空文稿占位写 **`「选中文字，点右侧即可生成图片 / 视频节点」`**——选中后右侧（Agent 栏）毫无变化，真正入口在文字正上方的浮条（文案指错方向）；<br>② 选句浮条里左半边重复塞了顶栏 100px 上方已常驻的 `B / I / H1 / H2`，右半边真正的灵魂动作 `拆成镜头 / 生成图片 / 生成视频` 却全是无字小图标；<br>③ 不框选文字时，文稿顶栏排满 18 颗富文本排版钮（含 `行内代码 </>`、`插入表格`），却**0 颗按钮能把写好的文稿送去拆分镜或生图**。 | `explore-creation-text.zh-CN.light.png`<br>`j03-written-text.zh-CN.light.png`<br>`j04-selected-text.zh-CN.light.png` | ① **直修**：改准 `creationAi.ts:30` 占位文案（「选中句子即可生成图片、视频或拆成镜头」）；<br>② 选句浮条删重复 `B/I/H1/H2`、给「拆成镜头 / 生图 / 生视频」露出短字，并在文稿顶栏加常驻「拆成分镜」入口（涉 `2026-11-12` 样张 B）。<br>**修后省掉**：1 次按错方向找入口 + 免去每次必须先 `⌘A` 全选才能下一步。 | **拆两半**：① 修正指路错文案可**直修**；② 改选句浮条与文稿顶栏钮**需确认样张 B / 删排版钮** |
| **6** | **16** `(4×4)` | **预览时间轴（默认画幅与导出参数藏匿）**<br>`src/workbench/preview/PreviewWorkspace.tsx:240`<br>`src/workbench/preview/TimelinePreview.tsx:102,257`<br>`src/workbench/preview/inspector/PreviewInspector.tsx:100` | **1, 3, 8** | ① 项目里全部镜头都是 `9:16` 竖屏或 `1:1` 方图时，进预览时间轴后舞台画幅仍死守默认 **`16:9` 横屏**，两侧留出巨大黑/白竖边；不手改就直接按 `16:9` 导出成带黑边的废片；<br>② 改整片画幅与导出清晰度（`1080p / 标准`）藏在默认收起的竖条 **`「属性 / Inspector」`** 里，顶栏 `导出 MP4` 旁毫无当前画幅/清晰度提示。 | `04-preview-export.1100x690.zh-CN.light.png`<br>`04-preview-export.1440x900.en.light.png` | ① **系统能判断的不留给用户**：时间轴从空首次放入第一段素材且用户未手改过项目画幅时，自动把 `previewAspectRatio` 对齐首段素材画幅（`9:16` / `1:1` / `16:9`）；<br>② 在顶栏 `导出 MP4` 旁或悬停摘要显出当前导出规格（如 `16:9 · 1080p`）。<br>**修后省掉**：每次竖屏/方图项目必踩的 1 次黑边返工 + 展开属性找画幅的 2 次点击。 | **直修**（首段入轨自动对齐未手改画幅属纯体验增效，零碰在跑线） |
| **7** | **16** `(4×4)` | **全局 Toast 与常驻 Agent 面板头部碰撞**<br>`src/NomiAppProviders.tsx:33` | **6** | `Notifications` 容器硬编码了 `[body:has([data-nomi-right-panel=model\|tasks\|director])_&]:!right-[...]` 让位规则，**唯独漏掉了 10-08 新外壳常驻停靠的右侧 Agent 面板（`[data-shell-agent-layer][data-agent-form="dock"]`）**！在创作、分镜、预览三屏（Agent 默认停靠右栏），任何一条提示（如「已加入时间轴末尾 [撤销] ×」）都严严实实糊在 Agent 面板头部正上方，挡死「历史会话 / 收起 / 浮窗 / 停靠」全部按钮 3 秒。 | `explore-preview-with-clip.zh-CN.light.png`<br>`explore-creation-text.zh-CN.light.png` | 在 `src/NomiAppProviders.tsx:33` 补上右侧停靠 Agent 层的让位选择器（按实际停靠宽度动态左移到主舞台右上角，窄窗浮窗态不移）。<br>**修后省掉**：每次出 Toast 时想收起/切 Agent 却点到 Toast 或被迫干等 3 秒的打断。 | **直修**（1 处 CSS 容器让位修复，零碰在跑线） |
| **8** | **16** `(4×4)` | **创作页分镜表（空锚区「全部展开」藏死「加参考卡」）**<br>`src/workbench/creation/storyboard/anchorZone/StoryboardAnchorZone.tsx:73-86,118-128`<br>`src/i18n/locales/storyboardEditor.ts:150` | **2, 7, 8** | 新建分镜方案 `cards.length === 0` 时，空态文案写 **`「还没有参考卡——加一张，或直接写镜头。」`**，但 `+ 添加参考卡` 按钮只在 `expanded === true` 时渲染（第 118 行），而默认 `expanded = false`！结果用户看到一句让你「加一张」的话，满屏却找不到加号，右上角反而挂着一颗对 0 张卡毫无意义的 **`「⌄ 全部展开」`** 按钮！ | `explore-storyboard.zh-CN.light.png`<br>`02b-storyboard.1100x690.en.dark.png` | ① `cards.length === 0` 时隐藏无意义的「全部展开/全部收起」按钮（原则 2：此刻没用的不出现）；<br>② 空态行直接放一颗可点的 `+ 添加参考卡` 按钮（点完新增首张卡并自动置 `expanded = true`）。<br>**修后省掉**：先点「全部展开」才能看见「+ 添加参考卡」的荒谬绕路（-1 次点击、-1 次困惑）。 | **直修**（注意同步更新 `StoryboardAnchorZone.structure.test.ts` 空态断言，零碰在跑线） |
| **9** | **15** `(5×3)` | **画布生成框 + Agent 输入框（「画布点选 `↖`」无处不在且重名）**<br>`src/workbench/assets/AssetReferenceButton.tsx:17-27`<br>`src/workbench/ai/ProjectAgentResidentShell.tsx:608`<br>`src/workbench/ai/v4/AgentPanelV4Composer.tsx:285-296` | **2, 4, 8** | ① `AssetReferenceButton` 画的是鼠标箭头 `↖`（看着像白板「选择工具」），`aria-label` 和 `title` 却叫 **`「加参考」`**，与紧挨着它的 `+` 按钮在图片节点上**同名撞车（两颗相邻按钮都叫「加参考」）**；<br>② 在「创作」写字、「分镜」排镜、「预览」剪片时画布根本不在屏幕上（甚至项目里 0 个画布节点时），Agent 底栏仍常驻这颗 `↖`，白占 `28px` 把旁边的模型名挤成 `选择模...` / `Choos...`。 | `current-seedream-5.5-composer.zh-CN.light.png`<br>`02a-creation-text.1100x690.en.dark.png`<br>`04-preview-export.1440x900.en.light.png` | ① 文案说人话、唯一化：`AssetReferenceButton` 改为「从画布点选参考」（`Pick from canvas`），与 `+`（「上传或从素材库选」）明确区分；<br>② Agent 底栏仅在 `surface === 'generation'` 且画布存在可引用节点时才渲染 `↖`，画布单节点无其它可引用节点时也收起或置灰说明。<br>**修后省掉**：猜 `↖` vs `+` 区别的困惑，并为 Agent 模型名腾出 `28px` 消除截断。 | **直修**（`AssetReferenceButton` 附 `door-map` 调用方核对即可，不碰 `spend/`） |
| **10** | **15** `(3×5)` | **生成画布（图生视频未自动对齐上游首帧画幅）**<br>`src/workbench/generationCanvas/nodes/aspectRatio.ts:74`<br>`src/workbench/generationCanvas/nodes/controls/parameterControlModel.ts` | **1, 3** | 上游图片节点是 `1:1`（`Seedream 5.0 Pro · 1:1 · 2K`），通过右侧 `+ → 视频` 连成 `首帧` 后，默认选中的视频模型（如 `Vidu Q3`）参数仍停在模型出厂默认 **`16:9 · 720p · 5s`**，没有自动读取已连入 `首帧` 的 `1:1` 比例切到 `1:1`（或 `adaptive/auto`），一旦直接点生成就会裁切或变形。 | `j09-spawned-video-from-image.zh-CN.light.png` | 连入 `首帧`（`first_frame`）且目标视频节点尚未被用户手改过比例时，若目标模型支持 `auto/adaptive` 则优先选之，否则用 `preferredVideoAspect` 自动匹配上游首帧宽高比。<br>**修后省掉**：每次图生视频都要人肉核对首帧比例并手改一次参数（-2 次点击、-1 个易错判断）。 | **直修**（纯前端新建派生节点初始参数推导，不碰付费通道） |
| **11** | **15** `(5×3)` | **常驻 Agent 面板头部（0 消息空对话挂神秘 `[○ — ▾]`）**<br>`src/workbench/ai/v4/AgentPanelV4Context.tsx:19-22,80-95`<br>`src/workbench/ai/v4/AgentPanelV4Panel.tsx:24` | **2, 8** | 新建项目一句话还没聊（`flow.length === 0`、`usage.used === undefined`）时，Agent 面板左上角品牌名 `Nomi` 旁边永远挂着一颗带灰圈和破折号的胶囊 **`[○ — ▾]`**，光看完全不知道是线程名、在线状态还是模型占位，点开还是一张空卡片。 | `02a-creation-text.1440x900.zh-CN.light.png`<br>`05-agent.1440x900.zh-CN.dark.png` | 当对话尚无任何用量记录（`usage.used === undefined && !usage.input && !usage.output && !usage.threadCost`）时，`V4ContextRing` 返回 `null` 不渲染；发出第一轮产生真实 token 后再浮现。<br>**修后省掉**：首屏空面板上的视觉噪音与误点空弹层。 | **需协调确认板边界**（涉 Agent Panel v4 `Vocabulary` 板头部定稿，建议直接隐藏空态） |
| **12** | **15** `(5×3)` | **常驻 Agent 面板（已连 APIMart 仍显示「选择模型 ▾」且截断）**<br>`src/workbench/ai/ProjectAgentResidentShell.tsx:609-611`<br>`src/workbench/ai/v4/AgentPanelV4Composer.tsx:298-309`<br>`src/i18n/locales/agentPanelV4.ts:163,741` | **1, 3, 8** | 即便用户已经连好 APIMart（91 个模型可用），进入项目后 Agent 输入框底栏仍显示 **`「选择模型 ▾」`**（窄窗截成 `选择模... ▾`，英文连 `1440×900` 都截成 **`Choose a mo... ▾`**！），让用户误以为还没配好模型、必须先手动挑一个聊天大脑才能说话。 | `04-preview-export.1440x900.en.light.png`<br>`02a-creation-text.1100x690.zh-CN.light.png` | 已接入供应商且存在可用文本/助手模型但用户未手选偏好时，自动回显实际将采用的推荐默认大脑名（或精简短文案 `自动 · <短模型名>`），与 `T-6` `M5 大脑` / `S-G` 同源收敛。<br>**修后省掉**：首次对话前「我是不是还得先选个模型」的犹豫与 2 次点击。 | **需避让在跑线 + 涉 Agent 行为**（与 `T-6` `M5 大脑` 及 `S-G` 强相关，排在 `T-6` 后统一收口） |
| **13** | **12** `(4×3)` | **生成画布（底栏「高级设置」不响应 Esc 且被时间轴遮挡）**<br>`src/workbench/generationCanvas/nodes/controls/AdvancedSettings.tsx:37-52,93-160` | **5, 6** | 点开底栏「高级设置」（`Seedance 2.5` 含返回尾帧、种子、水印、输出格式 4 行）时：① 它在卡片内向下硬撑高度，直接把下半截（水印、`mp4/mov`）顶进底部「时间轴」条后面点不到；② 紧挨着它的模型菜单、方式菜单、参数面板都按 `Esc` 即关，唯独「高级设置」按 `Esc` 毫无反应。 | `current-seedance-2.5-advanced-settings.zh-CN.light.png` | ① 在生成框内监听 `Escape`（无子菜单/焦点冲突时收起 `AdvancedSettings`）；② 展开段超出可视底沿时允许生成框内部滚动或改为与「生成参数」一致的向上自适应浮层。<br>**修后省掉**：按 `Esc` 关不掉、下半截选项点不到的卡死。 | **直修**（补 `Esc` 收起 + 框内可滚，不改画布 `T` 板外观） |
| **14** | **12** `(4×3)` | **生成画布（空节点悬空单颗「复制为变体」条 + 视频标题重复「`[视频] 视频 ·`」）**<br>`src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:222,258`<br>`src/workbench/generation/list/CanvasListLinks.tsx:24`<br>`src/workbench/generationCanvas/nodes/ConvertShotToVideoButton.tsx:12-18` | **2, 4** | ① 刚建好的空白节点（连提示词都没填、什么都没生成）头顶就悬空飘着一条只有 1 颗「复制为变体」图标的浮条；<br>② 新建图片节点左上角只写 `图片`，新建视频节点左上角却同时画胶囊 `[视频]` + 默认标题 `视频` + 悬空圆点 `·`（显示成 **`[视频] 视频 ·`**），两类节点标题结构不一致且重复啰嗦。 | `current-seedance-2.5-composer.zh-CN.light.png`<br>`current-seedream-5.5-composer.zh-CN.light.png` | ① 空白且无提示词/无参考的全新空节点不挂 `EmptyNodeVariantToolbar`（复制用 `⌘D` 或右键菜单照常可用）；<br>② 当 `node.title` 等于默认种类名（`视频`）且已有 `[视频]` 角色胶囊时去重不重复印第二遍 `视频`，并去掉空后缀前的孤立中点 `·`。<br>**修后省掉**：每个新节点头顶两处无用视觉元素干扰。 | **直修**（先核走查是否断言空节点 `EmptyNodeVariantToolbar`，去重标题与孤立 `·` 100% 安全直修） |
| **15** | **12** `(3×4)` | **设置 → 通用（语言与深浅色被 4 块低频区挤出首屏外）**<br>`src/workbench/settings/SettingsDialog.tsx:346-388`<br>`src/ui/theme/ThemeToggleButton.tsx:9-37` | **4, 7** | ① `SettingsDialog.tsx:356` 注释明明写着要把语言和外观做成「通用里平铺可见的分段控件」，后面却陆续在它头顶塞了「上手 4 步」「日志」「全局截图热键」「画布滚轮」4 大块，导致在 `1280×800` 与 `1100×690` 下打开「通用」**根本看不见语言和深浅色**（误进异国语言的用户抓瞎）；<br>② 语言是平铺双胶囊 `简体中文 \| English`，紧挨下面的外观却是左文字右单颗小月亮图标，同框两种控件范式。 | `explore-settings-general.zh-CN.light.png`<br>`06-settings-general.1100x690.en.dark.png` | 将「语言」与「外观（浅色 / 深色分段胶囊）」提到「通用」页签最顶部第一组，诊断日志收至底部（与「匿名统计 / 导出诊断包」归拢）。<br>**修后省掉**：每次换语言/换主题必须先滚屏寻找 + 单图标猜状态的摩擦。 | **需避让在跑线**（碰 `src/workbench/settings/`，排在 `T-6` 合入后紧接开单） |
| **16** | **12** `(4×3)` | **全应用多处术语与命名分裂（同一概念 2–4 个名字）**<br>`src/i18n/locales/timelinePreview.ts:4,81`<br>`src/ui/app-shell/shell/ShellRail.tsx:4,124`<br>`src/workbench/preview/PanelRail.tsx:40` | **4, 8** | 同一个概念在不同屏各叫各的：<br>① **引导手册 4 个名**：空库叫`重看一遍引导`、有项目库右上叫`新手引导`、设置通用叫`完整手册`、设置关于叫`上手手册`；<br>② **文稿 3 个名**：左栏叫`文稿 (Docs)`、分镜左下叫`返回原稿 (To Draft)`、Agent 叫`读文稿 (Read the script)`；<br>③ **工作区名错位**：顶栏叫`生成`，预览空态却写`从「生成区」拖入素材即可显示`（且实际根本不用跨页拖，点左侧镜头即入轨！）；<br>④ **中英混杂与双「素材」撞车**：中文界面项目库/左栏/Agent 三处硬写英文 `Skill`（英文左栏叫 `Skills` 复数、Agent 钮叫 `Skill` 单数）；预览页外左栏叫 `素材 (Assets)`，紧挨着内侧收起条又竖排印一个 `素材 (Media)`（英文 `Media` 被 `vertical-rl` 横躺旋转 90° 极难读），英文轨道名 `Images / Videos / Text track` 前两轨不带 track 第三轨带 track。 | `04-preview-export.1100x690.en.dark.png`<br>`explore-preview-timeline.zh-CN.light.png`<br>`02b-storyboard.1100x690.en.dark.png` | 一口气统一词表：<br>· 预览空态改为「点左侧镜头加入时间轴，或直接拖入轨道」；<br>· 预览内侧收起条改叫 `片库 / Clips` 且英文不走 `vertical-rl` 竖排；轨道统一为 `图片 / 视频 / 文字 / 配乐 / 字幕`（`Images / Videos / Text / Music / Subtitles`）；<br>· 引导/文稿命名全仓收敛。<br>**修后省掉**：跨屏寻找同一东西时的术语翻译负担。 | **拆两半**：预览空态文案、轨道名、竖排英文 `Media` 可**直修**；`Skill` 是否中文化与引导四名合一由协调拍定词表 |
| **17** | **12** `(3×4)` | **创作页分镜表（「+ 添加镜头」沉在滚区底被底栏遮挡 + 新镜「默认模型」隐藏画幅参数）**<br>`src/workbench/creation/storyboard/StoryboardPlanEditor.tsx:624-643`<br>`src/i18n/locales/storyboardEditor.ts` | **1, 7, 8** | ① 新分镜方案自带 2 镜在 `1280×800` / `1100×690` 下刚好撑满可视区，导致滚区最底下的虚线钮 `+ 添加镜头` 被固定底栏（`返回原稿 · 生成剩余`）压在正下方，不滚到底根本看不见还能加镜头；<br>② 每镜默认显示 `默认模型 ▾`（不写实际跑哪个模型），且在未手选具体模型前整行隐藏比例与方式，缩略格却画成 `9:16` 竖框（哪怕项目是 `16:9`）。 | `explore-storyboard.zh-CN.light.png`<br>`02b-storyboard.1100x690.zh-CN.light.png` | ① 将 `+ 添加镜头` 同时放在固定底栏左侧（紧邻已生成进度）或分镜表头，免滚屏一键加镜；<br>② 「整片画幅：按模型默认」在未选模型时默认采用 `16:9`（与预览一致）并在「默认模型」上回显推荐模型名（随 `S-G` 收口）。<br>**修后省掉**：每次加第 3 镜都要先滚到底的动作 + 竖框误导。 | **拆两半**：`+ 添加镜头` 提到底栏免滚屏可**直修**；「默认模型」写明具体模型名归 **`S-G`** |
| **18** | **10** `(5×2)` | **常驻 Agent 面板空态（「帮 Nomi 变好」遥测卡首屏占掉 40% 面积）**<br>`src/workbench/ai/v4/AgentPanelV4Consent.tsx:30-94` | **2, 6** | 用户第一次建项目打开创作/分镜/预览，一句话都还没写、还没体验到 Nomi 任何价值时，右侧 Agent 面板正中央近一半高度被「帮 Nomi 变好（匿名分享 / 不分享 / 愿意）」卡片占满，抢走上方起手胶囊与输入框的视觉重心。 | `02a-creation-text.1440x900.zh-CN.light.png`<br>`04-preview-export.1100x690.en.dark.png` | 延后触发时机：等用户真正跑完**第一次成功生成或第一次 Agent 对话**后再在同位置浮现一次（不改卡面双等大按钮设计）。<br>**修后省掉**：新用户首个项目的首屏阅读打断（-1 个非创作判断）。 | **需问用户**（涉 `2026-09-15` 用户拍板样张 A 的出现时机约定） |
| **19** | **9** `(3×3)` | **生成画布（内联画板工具栏折成两行，`[📷] 完成` 孤悬大白条）**<br>`src/workbench/generationCanvas/nodes/whiteboard/WhiteboardEditingToolbar.tsx:91-121` | **2, 4** | 在图片节点上点「画板」进入内联编辑时，底部工具条因同时摊开 4 工具 + 颜色 + 粗细滑杆 + 撤销重做 + 导入/素材/图层 + `1280 × 1280` + 截图 + `完成`，超出浮条单行宽度，导致 **`[📷] 完成` 两颗钮孤零零折到第二行正中**，撑出一整条空白大底板。 | `current-whiteboard-toolbar.zh-CN.light.png` | 紧凑化滑杆宽度（`w-16 → w-12`）与按钮内边距，或仅在有手绘笔迹/图层改动时显出次要项，确保 `1280px+` 标准画布下画板工具条单行稳态不折行。<br>**修后省掉**：双行跳动与遮挡下方画布面积。 | **直修**（核对 `InlineWhiteboard.board.json` 锚点不变，仅调紧凑间距） |
| **20** | **9** `(3×3)` | **项目库（封面右上常驻红底删除钮易误碰，点项目标题文字反而打不开项目）**<br>`src/workbench/library/ProjectLibraryPage.tsx:560-576,629-647` | **7, 8** | ① 鼠标移上项目卡想点开项目时，封面右上角直接冒出一颗醒目的红底垃圾桶（一步弹窗前极易在移动鼠标去右上「新建项目」途中误触），反倒是重命名/打开文件夹/删除没有收进统一的 `⋯` 菜单；<br>② 单击封面下的**项目标题文字**被 `e.stopPropagation()` 拦死（第 636 行，为了留给双击改名），导致用户点标题想进项目却毫无反应！ | `01-library.1440x900.zh-CN.dark.png`<br>`01-library.1100x690.en.dark.png` | ① 标题旁或卡片右下 `⋯` 提供「重命名 / 在访达中显示 / 删除项目」，让单击卡片任意主区域（含标题，或双击改名改为右侧铅笔/`⋯` 改名）都能顺畅打开项目；② 弱化/收纳封面红底直删钮。<br>**修后省掉**：点标题没反应的挫败与封面误碰删除风险。 | **直修**（先核 `ProjectLibraryPage` 相关走查对删除钮定位器的依赖） |
| **21** | **8** `(2×4)` | **预览时间轴（空时间轴「导出 MP4」未置灰 + 导出成功无界面内持久回执）**<br>`src/ui/app-shell/shell/ShellTopBar.tsx:409-430`<br>`src/workbench/preview/TimelinePreview.tsx:248-275` | **2, 5, 8** | ① 时间轴 `0 段 · 0.0s` 完全空白时，顶栏右上 `⬇ 导出 MP4` 仍是高对比纯黑主按钮（未 `disabled`），点了才报错；且外层同时包了 `<BarTooltip>` 与原生 `title={exportLabel}`，悬停弹双层重复提示；<br>② 有内容点「导出 MP4」完成后，按钮静默变回原样，应用内没有「已导出 · 打开文件夹」轻回执（切回 Nomi 后不知道文件存哪了）。 | `explore-preview-timeline.zh-CN.light.png`<br>`j15-export-complete.zh-CN.light.png` | ① `computeTimelineDuration(timeline) <= 0` 时禁用顶栏 `导出 MP4` 并在 `BarTooltip` 说明「先往时间轴放入至少一段素材」，去掉重复的原生 `title`；<br>② 导出完成发一条带「打开所在文件夹」动作的成功 Toast。<br>**修后省掉**：空轨误点报错 + 导完找不到成片位置的焦虑。 | **直修**（零碰在跑线，核对 `preview-export-busy.walk.mjs` 即可） |
| **22** | **8** `(4×2)` | **设置 → 模型（已连好 APIMart 后首屏仍被大号「用 AI 帮我接入」卡片霸屏 + 离线引擎写「管理地址、密钥」）**<br>`src/ui/onboarding/ModelSettingsHome.tsx`<br>`src/workbench/settings/SettingsDialog.tsx:297-309` | **2, 8** | ① 明明已经连好 APIMart（91 个模型可用），点开「设置 → 模型」首屏前 60% 仍是一张巨大的「用 AI 帮我接入（WorkBuddy / Codex / Claude Code + 复制指引）」宣传卡，把真正要看的「已接入：APIMart」挤在底沿，且与隔壁「自动化与权限」里的 MCP 连接重复；<br>② `本地转写（离线）` 副标题硬套模板印着 `1 models · Manage address, key, and models`（离线模型哪来的地址和密钥，且英文 `1 models` 单复数错）。 | `explore-settings-models.zh-CN.light.png`<br>`06-settings-models.1100x690.en.dark.png` | ① 已有可用连接时把「用 AI 帮我接入」收进底部「添加更多连接」折叠区，首屏置顶「已接入」账户与模型；<br>② 离线本地连接副标题按能力诚实显示「本机离线运行 · 无需密钥」，修英文 `1 model` 单复数。<br>**修后省掉**：每次进模型设置都要跨过大号 MCP 引导卡找已连供应商的滚屏负担。 | **需避让在跑线**（碰 `T-6` 正在施工的 `ModelSurfaces` / `src/ui/onboarding/`，交 `T-6` 一并收口或排在 `T-6` 后） |

---

## 四、Phase 2 执行分桶建议（立即可开小 PR vs 避让在跑线 / 攒一轮拍板）

### 分桶 A：与在跑线零文件重叠、可直接按序开小 PR 修（共 13 项，建议合为 6 个同屏小 PR）

1. **PR-UX1（画布视口入画与假等待文案修复 · 排名 #1 + #2 + #3①）**
   - `GenerationCanvasReactFlow.tsx` / `useAutoFitOnLoad.ts`：首进自动 `fitView` 锁 `maxZoom <= 1` 并计入选中节点生成框高度（彻底消灭创作页选句建节点 `188%` 放大把发送键顶出窗外）；
   - `BaseGenerationNode.tsx:378`：修 `waitingUpstream` 只在上游真未产出时才提示等待（消灭已生成图片连视频却报「等上游产出后继续」）；
   - 右侧 `+` 新建下游节点后自动平移确保新节点及其 600px 生成框落入可视舞台内（直接砍掉主旅程 6 次自救点击！）。
2. **PR-UX2（全局 Toast 避让右侧停靠 Agent 面板 · 排名 #7）**
   - `src/NomiAppProviders.tsx:33`：补齐 `[data-shell-agent-layer][data-agent-form="dock"]` 右侧让位，不再糊死 Agent 面板头部。
3. **PR-UX3（预览时间轴自动画幅对齐 + 空轨禁用导出 + 导出成功回执 + 空态与轨道词表 · 排名 #6 + #16前半 + #21）**
   - 首段素材入空时间轴自动对齐 `previewAspectRatio`（未手改过时）；空轨置灰 `导出 MP4` 并去重双层 tooltip；导出完成弹「打开文件夹」Toast；修「生成区→点左侧镜头」、英文 `Images/Videos/Text` 统一及内侧收起条竖排英文 `Media`。
4. **PR-UX4（分镜表空锚区直出「+ 添加参考卡」隐藏空「全部展开」+ 底栏常驻「+ 添加镜头」· 排名 #8 + #17①）**
   - `StoryboardAnchorZone.tsx` + `StoryboardPlanEditor.tsx`：0 参考卡时隐藏「全部展开」、原地给 `+ 添加参考卡`；免滚屏即可点 `+ 添加镜头`。
5. **PR-UX5（生成框与节点细节减噪：高级设置 `Esc` 收起、标题去重 `[视频] 视频 ·`、画板单行不折行、`↖` 点选参考正名与按面收敛 · 排名 #9 + #13 + #14 + #19）**
   - 核对 `door-map` 与现有 `.walk.mjs` 锚点，保持 `InlineWhiteboard` 等已签板锚点 100% 兼容。
6. **PR-UX6（创作页占位指路文案修正 + 项目库标题单击可打开 · 排名 #5① + #20）**
   - 修 `creationAi.ts:30` 错写「点右侧」的占位提示；优化项目卡单击标题/菜单交互。

### 分桶 B：需避让在跑线（`T-6` / `#1660` / `spend` / 撤销）或需协调拍板设计板边界（共 9 项）

| 排名 | 涉及项 | 为什么要停下 / 避让谁 | 给协调的推荐默认决断 |
| :---: | --- | --- | --- |
| **#3②** | 靠左/靠底节点选中时 `ComposerAnchor` 浮框被左栏或时间轴遮挡 | 涉 `composerCanvasPlacement.ts` 里 `2026-09-25` 用户拍板「钉在节点正下方、宽度固定、被挡就挡」 | **不破坏固定宽度**：不在每帧 resize，只在**单选某个节点那一刻**若其生成框超出舞台左/右/下沿，做一次平滑画布微平移（pan-into-view），既守住 09-25 不变形纪律又不再裁字 |
| **#4** | 图片节点浮条补「生成视频」+「加入时间轴」显字 | 涉 `2026-10-04` 节点快捷动作批次 1 拍板浮条 | 推荐在图片浮条首段加入「生成视频」（走免费派生，不自动扣费） |
| **#5②** | 选句浮条去重 `B/I/H1/H2`、给生图/生视频加短字，文稿顶栏精简 18 排版钮并加「拆成分镜」 | 涉 `2026-11-12` 选句浮条样张 B 及删减低频富文本钮（`</>`、表格） | 推荐把 `</>` / 分隔线 / 表格收进 `⋯`，文稿顶栏右端加「拆成分镜」，选句浮条给生成组加短字 |
| **#11** | Agent 头部空对话隐藏 `[○ — ▾]` (`V4ContextRing`) | 涉 Agent 面板 `Vocabulary` 板头部元素 | 推荐 0 用量空会话直接隐藏，有第一轮 token 后再显示 |
| **#12** | Agent 底栏已连 APIMart 时自动回显默认大脑而非「选择模型 ▾」 | 撞 `T-6`（`M5 大脑`）与 `S-G`（写明推荐模型名）及 Agent 默认模型行为 | 并入 `T-6` / `S-G` 统一实现 |
| **#15** | 设置 → 通用把「语言 + 外观分段胶囊」提到首屏最顶 | 撞 `T-6` 正在改的 `src/workbench/settings/` | 等 `T-6` 合入后立即单开 1 个小 PR 上移 |
| **#16后半** | 全应用 `Skill` 是否统一译为「技能」+ 引导手册 4 个名字合一 | 涉全局词表与已签板文案断言 | 推荐中文统一为「技能」（英文统一复数 `Skills` 列表 / 单数 `+ Skill` 挂载），手册统一叫「上手引导」 |
| **#17②** | 分镜行「默认模型」写明具体推荐模型名 | 已排入样张队列 **`S-G`** | 随 `S-G` 样张拍板落地 |
| **#18** | Agent 空态「帮 Nomi 变好」遥测卡延后到首次生成/对话后出现 | 涉 `2026-09-15` 用户拍板样张 A | 推荐卡面不动，仅将触发条件从「首开空面板」延后至「首次完成一次生成或一轮对话后」 |
| **#22** | 设置 → 模型在已有连接时折叠「用 AI 帮我接入」+ 修离线转写副标题 | 撞 `T-6`（`ModelSurfaces`）与 `src/ui/onboarding/` | 交 `T-6` 顺手收口离线连接副标题与 `1 model` 复数 |

---

## 五、逐原则反向交叉审阅与剔除记录（防止把刻意设计误判为 Bug）

为确保排序表零凑数、零误判，按 `AGENTS.md`「叫某东西是 bug 之前先搞懂现有设计为什么这么写」对初筛候选项做了代码与历史拍板交叉核验，记录采纳补漏与主动剔除项如下：

1. **跨轨（英文 + `1100×690` 窄窗）交叉审查新增补漏并采纳 4 项**：
   - 补漏 ①：`1440×900` 英文下 Agent 底栏 `Choose a model` 依然截断为 `Choose a mo...`（并入 **#9 / #12**）；
   - 补漏 ②：`1100×690` 英文暗色下靠左节点的 600px 生成框左端钻入左栏底下把 `Seedream 5.0 Pro` 切成 `am 5.0 Pro`（并入 **#3**）；
   - 补漏 ③：预览页内侧收起条用 CSS `[writing-mode:vertical-rl]` 把英文 `Media` 旋转 90° 横躺显示，且轨道名出现 `Images / Videos / Text track` 不对称（并入 **#16**）；
   - 补漏 ④：`本地转写（离线）` 在英文模型页显示 `1 models · Manage address, key, and models` 语法与语义双错（并入 **#22**）。
2. **核查源码注释与历史拍板后主动剔除的 4 个「伪问题」（不进问题表）**：
   - **剔除 ①：「图片节点底栏为什么没有『生成方式（文生图/改图）』胶囊，和视频节点不一致？」** → 查 `NodeGenerationComposer.tsx:413` 确认是**刻意极简设计**：画布图片节点自动按「放没放参考图」推导文生图 vs 改图（正好符合原则 1「系统能判断的不留给用户」），反而是视频因存在「首尾帧 vs 图生 vs 参考」多义性才保留方式格，绝不该给图片节点倒退加回方式格。
   - **剔除 ②：「点节点右侧 `+ → 视频` 或浮条『多机位九宫格』为什么不直接帮用户点发送生图？」** → 查 `deriveFromNode.ts:18-20`（`deriveFromNode.noMoneyDoor.test.ts`）确认是 `2026-10-05` 明确拍板：「派生只做免费准备，花钱留给用户自己在新节点上点 `↑`」，严守不偷偷扣费边界。
   - **剔除 ③：「图片生成完后右下角 `↑` 变蓝，视频生成完却是黑色，是不是颜色不一致？」** → 查 `NodeParameterControls` 实测确认蓝色是截图瞬间指针悬停在 `↑` 上的 `hover:enabled:bg-nomi-accent` 态，常态均为 `bg-nomi-ink`，非不一致。
   - **剔除 ④：「分镜顶部参考卡为什么不支持单张独立展开/收起？」** → 查 `StoryboardAnchorZone.tsx:18-19` 确认合同 v6 §8 刻意不做逐张展开以免引入碎片状态；真正的问题只是 **`0` 张卡时还显示「全部展开」并把 `+ 添加参考卡` 藏死**（已精准收进 **#8**）。
