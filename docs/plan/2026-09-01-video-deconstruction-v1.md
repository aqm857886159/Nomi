# 拆解视频 v1 —— 面板方案（一页纸）

日期：2026-09-01 · 状态：📋 设计+文档 only，样张待用户拍板（拍板前不写壳）
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
- **面板**：右侧就近停靠面板（≥1200px 宽时 520px 停靠、窄屏铺满，`dialog` `aria-modal=false`，不接管全 App）。四态：空态（可拆但还没拆）→ 进行中（诚实阶段文案 + 「可安全关闭/后台继续」）→ 需要处理（失败/部分失败，可单独重试）→ 结果（镜头结构表）。
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
| 面板住哪 | 挂在 `GenerationWorkspace` 画布层（`src/workbench/generation/GenerationWorkspace.tsx:105` 的 `workbench-generation__canvas`）之上的就近 `dialog` | 与右侧 AI sidebar、底部时间轴共存，不占它们的位；参考 #251 `VideoDeconstructionPanel` 的右停靠 520px 布局 |
| 落节点+编组 | `src/workbench/generationCanvas/nodes/extractShotCutsToNodes.ts`（#251 零件，现役画布 store API） | `addNode({exactPosition:true})` 逐个落 → `createGroup`+`moveNodeToGroup` → `selectNodes` → `persistActiveWorkbenchProjectNow`，整批一个 undo barrier |
| 引擎契约 | `electron/video/deconstructVideo.ts`（#259，另一班在重建） | 输入 `DeconstructVideoPayload`、输出 `DeconstructVideoResult{shots[],hasAudio,failedShotIndexes}`；面板只消费，不改引擎 |
| 设计 token | `docs/design/nomi-design-system.md` §2（`nomi-paper`/`nomi-ink*`/`nomi-line*`/`nomi-accent*`/`nomi-warning`），§1.5 控件层级 | 样张 token-only、光/暗双模式 |

真实 chrome（样张须复刻）：顶栏 `NomiAppBar` = 品牌 + 项目名 + **创作/生成/预览** 三段 stepper（分镜折进创作，`src/i18n/resources.ts:179-182`）+ 右簇（浏览器/设置/接入模型/去出片）；生成区左侧 `ProjectExplorerSidebar`（镜头/素材双 Tab）；画布网格 + 底部时间轴 + 右侧可停靠 AI 栏。

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
