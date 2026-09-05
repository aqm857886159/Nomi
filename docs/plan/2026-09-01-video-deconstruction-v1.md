# 拆解视频 v1 —— 面板方案（一页纸）

⚠️ 已被 2026-09-05 拍板推翻：不再采用“右槽就近面板、拆解后默认铺图成组”的交互；现行结论见 [GPT 讨论梳理 consolidation §3](2026-09-05-gpt-discussion-consolidation.md)。
日期：2026-09-01 · 状态：⛔ 已废弃（❌ 不再采用，📦 归档）；现行结论见 [GPT 讨论梳理 consolidation §3](2026-09-05-gpt-discussion-consolidation.md)
基线：`origin/main@59e1f6c0` · 引擎侧另一班在重建（#259 `feat/apimart-gemini-vision`）
配套：面板样张 [`docs/design/mockups/2026-09-01-video-deconstruction-v1.html`](../design/mockups/2026-09-01-video-deconstruction-v1.html)（含渲染截图）

> **口径先说清（防再拿旧前提栽跟头）**：本方案说的「拆解」= 把**一条参考视频**变成一张**结构化分镜表**（每镜：时间/景别/情绪/画面/字幕/对白/图片提示词/运镜提示词），再把选中的镜头**逐个摊成画布节点并自动编组**，供后续创作。它**不是** #232 主推的「视频复刻（复刻这 5 秒 → 一句话改 → 候选替换）」——那是另一件事，押在 M 线之后（见 §5 消化结论）。

---

## 1. 背后逻辑：解决哪个真实摩擦（大白话 + 具体例子）

**用户那一刻卡在哪**：博主刷到一条 15 秒的爆款广告，心里想「我也要做一条这样的」。但他**看得懂「好」，说不出「怎么拆」**——这条到底切了几个镜头？第一个镜头是特写还是全景？那句「限时 3 折」是第几秒跳出来的？镜头是推还是摇？他只能反复暂停、拿笔记、猜，然后对着空白的创作框发呆，不知道第一句提示词该写什么。

**Nomi 现在的断点**：用户把这条视频拖进画布，只能**播放**和**抽首尾帧**——想「看懂它的结构」得靠肉眼一帧帧数。从「一条参考视频」到「我自己第一版能生成的镜头」之间，隔着一段没人帮他走的路。

**拆解 v1 补的就是这段路**：一键把这条视频拆成一张**镜头结构表**——
> 镜 1 · 0.0–2.1s · 特写 · 「产品从暗处推入，暖光打在瓶身」 · 字幕「熬夜救星」 · 运镜「缓慢推近」
> 镜 2 · 2.1–4.8s · 中景 · … · 字幕「限时 3 折」（第 3 秒才跳出来）…

看懂结构后，**勾选想要的镜头 → 逐个落成画布图片节点、自动编成一组** → 立刻能整组喂参考、改提示词、生成自己的版本。**「拆」和「学着做」在同一块画布上连起来了。**

**为什么这是 Nomi 的活、且现在能做**：引擎（#259）已九成熟——本地 ffmpeg 切点（零成本）+ 一镜多帧喂多模态 + whisper 转写归属到镜头，产出带诚实失败标记（`visionFailed`）的分镜表。缺的只有**一层面板**把它接到画布上。这正好落在 Nomi 的护城河（画布=素材关系+生成候选+创作闭环），不是通用问题。

---

## 2. 核心取舍（一句话点破）

**拆解结果落在哪：贴着源视频节点的「就近面板」（选中/hover 才出，L2 情境层），还是一个独立的拆解页/模式？** —— 选**就近面板**：源视频、镜头表、拆出的节点组、后续创作全在同一块画布上同时可见（用户看得懂关系），代价是面板要在窄画布上挤下一张表；独立页会更宽敞，但把「拆」和「用」割成两个上下文、逼用户来回切，违背 D1（从用户摩擦出发，别让他多切上下文）。

---

## 3. 范围 / 不动项 / 分期 / 验收门（R4）

### 3.1 v1 范围（做什么）
- **入口**：给画布**视频节点**的现有浮动工具栏（`NodeVideoFrameToolbar`，L2 情境浮条）加**一颗「拆解」按钮**（图标 `IconCut`）。不加任何 L1 常驻工具栏按钮、不加新模式切换器、不新建工作区。
- **面板**：右侧就近停靠面板（宽度=现役右栏宽度真相源 `--generation-assistant-target-width`，默认 340px、可拖 300–600、窄屏铺满，`dialog` `aria-modal=false`，不接管全 App）。与「生成」AI 栏/Agent 面板**互斥共占同一右槽**（见 §4.1）。四态：空态（可拆但还没拆）→ 进行中（诚实阶段文案 + 「可安全关闭/后台继续」）→ 需要处理（失败/部分失败，可单独重试）→ 结果（镜头结构表）。
- **结果=镜头结构表**：逐镜一行，字段直接投影引擎 `DeconstructShot`（景别/情绪/画面/字幕/对白/图片提示词/运镜提示词 + 自定义列）；`carriedOver` 标「承接上镜」；`visionFailed` 那一镜诚实标「这镜没读出来·可单独重试」，不假装成功；`sourceFrameUrl` 作只读对照缩略图。
- **产出到画布（既有拍板闭环）**：勾选镜头 → 「加入画布」→ **逐个抽帧落成图片节点、逐个冒出来、落完自动编成一组、整批一个 Cmd+Z**（严格复用 `extractShotCutsToNodes.ts` 的 `exactPosition`+紧凑排布+`createGroup`+`selectNodes`+`persist` 现役实现，对齐 [[batch-output-appears-progressively-and-grouped]] 拍板）。每个节点带 `meta.videoAnalysis`（图片/运镜提示词随节点走）。
- **接后续创作**：一颗「用这套结构起稿」→ 把镜头表整理成草稿推进现有生成 AI composer（复用 `setGenerationAiDraft`）。这是「拆完能用于创作」的桥。
- **自定义列**：用户可加一列（如「产品卖点」）——引擎把列名动态拼进 VLM 输出 schema（「加一列=多告诉 AI 看一个维度」）。v1 出 UI 入口即可，逻辑引擎已就绪。
- **诚实披露**：面板标明「本地取证据 / 外部提交」模式与「会上传精确选区」的隐私事实（沿用 #251 的 disclosure 模式）。

### 3.2 不动项（明确不做）
- ❌ 不做 #232 的「视频复刻」闭环（复刻这 5 秒 / 一句话改 / 候选节点 / 对比替换 / RecreationApprovalEnvelope）——押 M 线之后。
- ❌ 不新建 `VideoDeconstructionSession` / 独立状态机 / 第二套 TimelineStore / 独立编辑器工作区。
- ❌ 不引 `runAgentChatV2`、不假设 Project Agent Host 复合审批已就位（M 线在建，见 [[roadmap-20260901-post-merge-wave]]）；v1 走引擎直调 + 现役画布写入，不等 M 线。
- ❌ 不盲装 Remotion / PySceneDetect / LosslessCut 等运行时（Nomi 已有 ffmpeg + 时间轴 + 抽帧）。
- ❌ 本轮零产品代码；样张先给用户拍板。

### 3.3 分期
- **P0（本方案 → 拍板 → 施工）**：视频节点入口 + 四态面板 + 镜头结构表 + 勾选落节点自动编组 + 「用这套结构起稿」+ 自定义列入口。引擎用 #259 的 `deconstructVideo`（另一班交付后接线；面板对齐其 `DeconstructVideoPayload/Result` 契约，不重写引擎）。
- **P1**：单镜「重拆这一镜」定向重试（复用同 Run，不重跑整片）；任务中心投影拆解任务；重启恢复走查；OCR/ASR 更细对齐。
- **P2（押 M 线后）**：视频复刻（局部重拍）作为**独立高级能力**接入 M 线的审批/预算/撤销链——不在 v1、不默认按钮。

### 3.4 验收门（真完成的判据，R16）
1. **契约对账**：面板消费的字段与 #259 `DeconstructShot`/`DeconstructVideoResult` 逐项对齐，`visionFailed`/`carriedOver`/`failedShotIndexes` 都有对应 UI 呈现，无编造字段。
2. **真实任务 E2E（R16 真闭环）**：拖入一条真实广告视频 → 拆解 → 看懂结构表 → 勾 3 镜 → 逐个冒出+自动成组（整批一个 Cmd+Z）→ 「用这套结构起稿」→ composer 收到草稿。跑通并把过程中冒出的体验/UI/产品问题全修掉。
3. **诚实态走查（R13）**：部分镜 `visionFailed` 时表格如实标注、可单独重试；空态/进行中/失败三态文案给下一步、不用绿色「通过」掩盖未验证。截图人眼判断。
4. **控件契约（设计系统 §1.5/§1.6）**：拆解入口在 L2 浮条不进 L1 常驻条；勾选空时「加入画布」禁用并 `title` 说明为什么；作用域跟选中走。
5. 五门绿（`check:*` + typecheck + lint）——必要条件非充分（P3）。

---

## 4. 落点与真实外壳（动手前已核对现状，file:line）

| 事 | 真实落点（现役 main） | 说明 |
|---|---|---|
| 拆解入口住哪 | `src/workbench/generationCanvas/nodes/NodeVideoFrameToolbar.tsx` | 视频节点的**浮动工具栏**（`FloatingToolbarShell`，选中/hover 出的 L2 浮条，现有 抽首帧/抽尾帧/全屏/下载/生成记录）。v1 = 加一颗「拆解」。⚠️ 现役 main 上此浮条**还没有**拆解钮（`openVideoDeconstruction` 只在 #251 分支存在）。 |
| 面板住哪 | 挂在 `GenerationWorkspace` 画布层（`src/workbench/generation/GenerationWorkspace.tsx:105` 的 `workbench-generation__canvas`）之上的就近 `dialog` | 与右侧 AI sidebar、底部时间轴**互斥共占同一右槽**（见 §4.1），不占时间轴的位 |
| 右栏宽度真相源 | `assistantWidth`（`src/workbench/workbenchStore.ts:233` 默认 **340**，clamp 300–600 `:332`）→ CSS var `--generation-assistant-target-width`（`GenerationWorkspace.tsx:76-82`，`CanvasAssistantPanel.tsx:582`） | 拆解面板**沿用这个宽度**，不自立第二个数字（#251 的 520px 已废弃，不再引用）|
| 落节点+编组 | `src/workbench/generationCanvas/nodes/extractShotCutsToNodes.ts`（#251 零件，现役画布 store API） | `addNode({exactPosition:true})` 逐个落 → `createGroup`+`moveNodeToGroup` → `selectNodes` → `persistActiveWorkbenchProjectNow`，整批一个 undo barrier |
| 引擎契约 | `electron/video/deconstructVideo.ts`（#259，另一班在重建） | 输入 `DeconstructVideoPayload`、输出 `DeconstructVideoResult{shots[],hasAudio,failedShotIndexes}`；面板只消费，不改引擎 |
| 设计 token | `docs/design/nomi-design-system.md` §2（`nomi-paper`/`nomi-ink*`/`nomi-line*`/`nomi-accent*`/`nomi-warning`），§1.5 控件层级 | 样张 token-only、光/暗双模式 |

真实 chrome（样张须复刻）：顶栏 `NomiAppBar` = 品牌 + 项目名 + **创作/生成/预览** 三段 stepper（分镜折进创作，`src/i18n/resources.ts:179-182`）+ 右簇（浏览器/设置/接入模型/去出片）；生成区左侧 `ProjectExplorerSidebar`（镜头/素材双 Tab）；画布网格 + 底部时间轴 + 右侧可停靠 AI 栏。

---

## 4.1 与 Agent 面板的共存契约（③合流终局 + 过渡期互斥）

> **终局已由用户拍板（2026-09-01 · ③合流）**：右槽整体 = **Agent 工作区**，双区——**主体会话流**（指挥/追问/进度）+ **固定结果卡区**（需要审阅/操作的工件停靠、不随聊天滚走）。拆解面板不是右槽的第二个住户，而是这个工作区里的**第一张结果卡**；新功能 = 新卡片，不再新立面板（单壳）。终局定义权归 M 线交互 epic，其意见书见 [`docs/design/2026-09-01-right-slot-agent-workspace-opinion.md`](../design/2026-09-01-right-slot-agent-workspace-opinion.md)。
>
> **过渡期（交互 epic 落地前）走互斥**：epic 未落地时右槽尚无「双区工作区」外壳，拆解面板暂以独立就近面板停靠、与现役「生成」AI 栏**互斥共占**右槽——这是**过渡行为，epic 落地后自然消失（届时拆解卡进结果卡区、AI 栏进会话流，同壳并存、不再互斥）**。下列 R-C-1~6 中，**互斥规则（R-C-1/2）标注为过渡行为**；结果驱动/状态保持/宽度真相源/前向兼容（R-C-3/4/5）是**终局也成立的永久契约**。
>
> **这一段补的窟窿**：用户看样张时问「右侧万一有 Agent 呢」。右侧那个槽位**今天住着「生成」AI 栏**（`GenerationWorkspace.tsx:143-176` 的 `workbench-generation__ai`），**M 线落地后整体成为 Agent 工作区双区**（同一个 `aiSidebar` 槽演进而来）。样张见 `docs/design/mockups/2026-09-01-video-deconstruction-v1.html` 视图 06/07（06/07 演示的是过渡期互斥态）。

**背后逻辑（为什么这么设计）**：右侧就近停靠是 Nomi 已拍板的创作辅助位——AI 栏、参数面板、拆解面板都想贴着画布右缘。但画布右缘只有一条，三个都常驻会互相挤、布局抖（§1.5「情境控件不许挤常驻条」栽过的坑）。所以把右缘定义成**单槽（single dock slot）**：谁被唤起谁进驻，另一个**收起让位**（不是销毁）。这样用户任一时刻只面对一个右侧上下文，不用在两块并排面板间分心。

### R-C-1 互斥规则（谁进驻，谁让位）⚠️ 交互 epic 落地前的过渡行为，落地后自然消失（单壳）
> **过渡性说明**：③合流终局里右槽是 Agent 工作区**双区**，拆解卡与会话流**同壳并存、不互斥**。互斥只是 epic 那层双区外壳尚未落地时的临时让位策略——epic 落地后拆解卡进结果卡区、AI 栏进会话流，本条**整条失效**。
- 右侧**同一时刻只有一个住户**：`{ 生成/Agent 栏 | 拆解面板 }` 二选一占据右槽。
- 从视频节点浮条点「拆解」打开面板 → 面板进驻右槽，**Agent/AI 栏收成顶栏右区角标**（视图 06）。
- 拆解面板开着时用户点开 Agent → **Agent 进驻右槽，拆解收成源节点上的浮条**（视图 07）。
- 关闭进驻的那个 → 上一个住户**还位**（不是重新初始化）。

### R-C-2 收起形态（保留可见性，不静默消失）⚠️ 与 R-C-1 同为过渡行为，epic 落地后收起态并入结果卡区/会话流的自然折叠
- **AI/Agent 栏收起 → 顶栏角标**：落 `NomiAppBar` 右簇（`src/ui/app-shell/NomiAppBar.tsx:199-349` 的 `role="toolbar"`），紧挨「配置」组（设置/接入模型）左侧，形态复刻现役 ghost 钮（`h-[30px]` + `IconX size=15 stroke=1.8` 档）。**有新动静**（新回复/工具跑完）时角标上冒 accent 小圆点或数字，语法复刻 `TaskCenterButton.tsx:143-147`（`min-w-4 rounded-pill bg-nomi-paper text-micro tabular-nums text-nomi-accent`）。点角标 = 还原右栏。
  - *为什么落顶栏*：顶栏是唯一跨创作/生成/预览三区常驻的 chrome，正是「切走了还能瞥见 Agent 有没有新动静」的锚点（同 TaskCenter 落顶栏的理由，`TaskCenterButton.tsx:1-2`）。
- **拆解收起 → 节点浮条 + 节点角标**：源视频节点头挂「已拆解 · N 镜」角标（`.node__result-badge`，复用 §4.3 节点副本角标的视觉档），节点内挂可点回的「拆解结果 · N 镜」浮条（`.decon-stub`）。点浮条 = 展开右槽那张表。
  - *为什么落节点*：拆解结果本就属于那条源视频，收起态挂回它身上是最自然的家（一功能一个家，`nomi-design-system.md` §1.5）。

### R-C-3 状态保持（互斥 ≠ 丢状态）
- 两个住户都是**收起（collapse）不是卸载（unmount）**：勾选进度、滚动位置、进行中的拆解 Run、Agent 对话上下文，收起后再点回时**原样还在**。
- 现役已有可复用的收起真相源：AI 栏的 `generationAiCollapsed`（`CanvasAssistantPanel.tsx:158/164`，`setGenerationAiCollapsed`）。拆解面板引入平行的收起标志（如 `videoDeconstructionCollapsed`），**两个标志互斥**：一个从 `false→true` 时把另一个从 `true→false`（在同一 store 事务里翻，避免两个都展开的中间态）。
- 收起态**不暂停后台任务**：拆解进行中被收起，引擎继续跑（对齐现有「可安全关闭 · 后台继续」的进行中态文案），跑完在节点浮条/顶栏角标上示意。

### R-C-4 宽度单一真相源（不自立第二个 520px）
- 拆解面板占右槽时，**宽度沿用现役 AI 栏宽度**：`assistantWidth`（`src/workbench/workbenchStore.ts:233` 默认 **340**，clamp 300–600 `:332`）→ `--generation-assistant-target-width`（`GenerationWorkspace.tsx:76-82`，`CanvasAssistantPanel.tsx:582`）。样张用 `--nomi-assistant-width: 340px` 复刻这一个数字。
- **#251 的 520px 作废**，不引用、不并存——同一个槽只有一个宽度真相源，用户拖宽 AI 栏后拆解面板也跟着这个宽度（互斥住户共享槽宽，体验一致）。

### R-C-5 M 线落地后的前向兼容（设计已为此让路）
- M 线（Project Agent Host）落地后，**拆解可注册成 Agent 的一个工具**：用户在 Agent 对话里说「把这条视频拆成分镜」，Agent 调 `deconstructVideo` 工具，**结果仍落回本拆解面板**（视图 07 的 tool-card「结果已写回…拆解面板」+「查看拆解结果」链接演示了这条）。
- 关键约束：**不新开第二个拆解结果视图**——Agent 触发的拆解和节点浮条触发的拆解，产出**同一个** `DeconstructVideoResult`、渲染进**同一块**面板（右槽那张镜头结构表）。Agent 只是拆解的另一个**调用者**（对齐 P4 通用第一 + #232 吸收第 6 条「集成不绕面板/预算」）。
- 因此 v1 的面板 API 从一开始就设计成「**结果驱动、调用者无关**」：面板订阅「这条源视频的拆解结果」这个状态，而不是订阅「谁点了拆解按钮」。节点浮条入口是第一个调用者，Agent 工具是第二个，二者共用同一结果槽——**现在就把这个接缝留对，M 线接线时不用返工**。

### R-C-6 验收补充（并入 §3.4 验收门）
- 走查须覆盖互斥两向：① 拆解开→Agent 收顶栏角标、角标示意新动静、点回还原；② Agent 开→拆解收节点浮条、点回还原且勾选/进度不丢。截图人眼判断（R13）。
- 断言「不丢状态」：收起再展开后，已勾选镜头数、滚动位置、进行中 Run 的进度条都与收起前一致（不是重置为初始态）。

### R-C-7 结果卡两个入口汇聚同一张卡（终局永久契约）
- 拆解结果卡有**两个入口**，二者**汇聚同一张卡、同一份结果**，绝不各开一张：
  - **入口 A · 节点动作**：视频节点浮条点「拆解」直接唤起（v1 的第一调用者）。
  - **入口 B · Agent 会话消息内嵌卡**：M 线后用户在会话里让 Agent 拆解，Agent 调 `deconstructVideo` 工具，会话流里冒出一张**内嵌结果卡**（视图 07 的 tool-card 是它的过渡期形态）；点它 = 展开/聚焦结果卡区里**同一张**拆解卡。
- 收敛点：卡订阅「**这条源视频的拆解结果**」这个状态键（`videoUrl`/`nodeId` 维度），**不订阅「谁触发了拆解」**。A 从节点写入该状态、B 从工具写入该状态，两条路写的是同一个 `DeconstructVideoResult` 槽；卡读这个槽渲染。因此同一条视频无论从哪个入口拆，都落回**唯一一张**结果卡（对齐 R-C-5 「结果驱动、调用者无关」，是它在双入口下的推论）。
- 为什么现在就锁死这条：v1 只做入口 A，但状态键必须从一开始就按「源视频维度」建（而非「面板 open 布尔」），否则 M 线接入口 B 时会被迫新造第二个结果视图、回到「面板增生」的老坑。

---

## 5. #232 消化结论（吸收什么 / 淘汰什么 + 理由）

> #232（`origin/codex/video-recreation-plan-20260829`，17 文件 +2232 行）调研扎实但**整份建在 #223 旧架构前提**上，而 **#223 已被 M 线取代、冻结为「病历本」不动**（现状见 `docs/ARCHITECTURE-NOW.md` Agent 运行时行 + [[roadmap-20260901-post-merge-wave]]）。且 #232 **自己把「拆解」定位成 P1/P3 的次要能力、主推「复刻」**——维护者裁决把这个次序**反过来**：拆解 v1 是**现在**的主交付（#259 引擎已九成熟），复刻押 M 线。以下逐条消化。

**吸收（7 条）**：
1. **「不长 Prompt」的用户洞察**（#232 §3.3）：用户要的是看懂结构、四个决策，不是手写长提示词——直接支撑 v1「结构表 + 一键起稿」而非「让用户写 prompt」。
2. **五层 Prompt 纪律**（用户原话→证据化事实→标准化 intent→provider 编译→QA delta，每层带版本）：#259 引擎的 `imagePrompt`/`motionPrompt` 分离 + `visionFailed` 证据化已体现，面板侧继承「不把模型猜测当既成事实」。
3. **诚实失败旅程矩阵**（#232 §3.4）：切点不准/分析不确定/引擎不可达各给「下一步」，不编造、不静默——落成面板四态与单镜重试。
4. **来源不可变 + 证据帧**：原视频不可变、`sourceFrameUrl` 只读对照——v1 分镜表照此，拆出的节点是派生不是改源。
5. **开源方法集成矩阵**（§7.2）：FireRed-OpenStoryline 的 `understand_clips`（客观 caption）/`group_clips`（场景聚合）、hyperframes 的 intake+QA 合同、PySceneDetect/lossless-cut 作 benchmark——作为**方法**吸收（改成 Nomi schema、删魔法词），**不盲装依赖**。
6. **「集成 skill」三种正确含义**（方法/Provider/benchmark 集成，§7.3）：外部件不能直接写 store、不绕预算审计——纪律继承。
7. **隐私/版权披露**（最小上传精确选区、真人/商标进 policy review、日志不落 key）：落成面板 disclosure 文案。

**淘汰（4 条 + 理由）**：
1. **整个「视频复刻（复刻这 5 秒 → 候选替换）」作为 P0 主路径** → 淘汰出 v1。理由：它是**另一个功能**，且依赖 M 线未就位的审批/预算链；v1 聚焦「拆解看懂 + 落画布创作」这个 #259 引擎已支撑的闭环。复刻押 P2/M 线后。
2. **`RecreationApprovalEnvelope` / 复合一次确认 / `RecreationArtifactRef` / `paidRunActionHash`** 等 #223 Project Agent Host 合同 → 淘汰。理由：建在已取代的 #223 前提上（`docs/ARCHITECTURE-NOW.md`：引擎是 pi SDK 非 `runAgentChatV2`，Host 复合审批是 M1 未交付范围）。v1 不碰付费生成，无需这套。
3. **「拆解只是复刻的后台附属分析、按需产最小 Artifact」的从属定位**（#232 §3.3 独立拆解段）→ 淘汰这个从属关系。理由：维护者裁决拆解 v1 是**独立主交付**、有自己的完整面板与画布产出，不是复刻的隐藏前置。
4. **基线锚点 `origin/main@f9ac6c67` + 「对齐 #223 `8784ec77`」** → 淘汰（过期）。理由：现基线 `59e1f6c0`，#223 已冻结；实施以 #259 引擎契约 + 现役画布 API 为准，#223 owner 表不再是依赖。

**#251 的处理**：已关 PR，**留作零件库**（[[roadmap-20260901-post-merge-wave]] D 档裁决）。其 UI 零件（`VideoDeconstructionPanel`/`VideoAnalysisStructureView`/`extractShotCutsToNodes`/四态布局）可参考，但它绑的是 `electron/videoAnalysis/contracts`（#223 旧祖先引擎）——**布局吸收、契约换成 #259**，不整体合入（会回滚 main 三周演化）。
