# ChatCut 与「对话式剪辑」产品拆解 → Nomi 剪辑面对账（2026-09-05）

> 研究范围：公开官网/官方手册/官方更新页与可见评测。访问日期均为 2026-09-05。每条结论标注核实程度：**实测**（本次页面或本地代码直接看到）、**官方文档**（产品方文档/DOM）、**评测转述**（第三方或社区）、**推测**（基于证据的设计判断）。截图不入 git；DOM/手册文本见同名证据目录。

## 0. 一句话结论

ChatCut 最值得 Nomi 借的是「选中对象变成带类型的上下文 chip → Agent 先给可见结果/确认 → 改动落真实时间线并留差异与撤销」，而不是把聊天框做成万能入口；Nomi 已有提案、revision 守卫、diff、undoToken 和预览选中片段，但 Agent 仍不能写转场、字幕、片段音频，且时间轴工具栏动作多而分散。**P0 是把这条可审阅事务链扩展到三类已有数据模型，并统一一条“选择—提案—应用—收据—撤销”路径。**（官方文档 + 本地实测）

## 1. ChatCut 深拆

### 1.1 先确认“ChatCut”是哪一个

本次检索得到两个容易混淆的对象：

- **ChatCut（chatcut.io）**：官网称 AI video editor，提供 Web、Desktop 和 ChatGPT/Codex/Claude Agent Plugin；编辑结果是可继续手工编辑的多轨时间线。（官方文档：[What is ChatCut?](https://chatcut.io/docs/what-is-chatcut)，[AI Video Editor](https://chatcut.io/features/ai-video-editor)，实测 DOM：`chatcut-what-is.dom.txt`）
- **OpenChatCut（GitHub/ openchatcut.com）**：开源、local-first 的独立替代品，产品页明确写 independent、not affiliated with ChatCut。（官方仓库：[LeonSooLab/openchatcut](https://github.com/LeonSooLab/openchatcut)；本次仅作同名排除。）

本文选择 chatcut.io，因为它是官网自称 ChatCut、同时覆盖对话 Agent 与真实剪辑轴的产品；上线时间采用 Product Hunt 的平台索引转述：2026-04-09 首次发布，2026-07-10 ChatCut，2026-08-26 Desktop（**评测/平台索引转述，未能从官网找到独立发布公告**）。（[Product Hunt](https://www.producthunt.com/products/chatcut-ai-video-editor)，本次搜索结果已记录，页面正文受脚本限制）

### 1.2 指令如何改到剪辑轴、文稿或片段

- **入口与路由**：AI 面板在编辑器左侧；对话、进度/问题/确认卡在上方，底部 Prompt composer 收集下一条指令。Agent 模式负责理解项目上下文、改 Timeline、多步任务；Video Gen 是单次生成提交。（官方文档，[AI Panel Overview](https://chatcut.io/docs/ai-panel-overview)；DOM `chatcut-ai-panel.dom.txt:164-235`）
- **落点**：Agent 结果可能是对话回复、新资产、活动 Timeline 的修改，或组合；文字稿删除/重排词语会同步改变视频/音频剪辑。（官方文档，[What is ChatCut?](https://chatcut.io/docs/what-is-chatcut)、[Editor Layout](https://chatcut.io/docs/editor-overview)；DOM `chatcut-what-is.dom.txt:160-183`、`chatcut-editor-overview.dom.txt:255-262`）
- **改前确认**：纯剪辑指令的公开文档描述为发送后执行并在 Viewer/Timeline 审阅；涉及 Motion Graphics、Video/Image Generation 时，会在对话里出现确认卡，显示引用、信用估算，按钮为 Allow / Allow all… / Deny，可用调整字段改参数。（官方文档，[Generation Confirmations](https://chatcut.io/docs/generation-confirmations)；DOM `chatcut-confirmations.dom.txt:162-180`）因此“每个时间线改动都有统一前置确认”**不确定**；目前确定的是生成类确认，编辑类依赖发送后审阅与全局 Undo。
- **改后收据**：官方首页示例把结果写成结构化进度行：“read_project”“read_transcript”“plan · cut silences → B-roll → captions”“Cut 7 silences · saved 20s”“Generated B-roll · V2”“Captioned · 54 words”。这是可读的动作/影响收据，但不是公开的机器 schema。（官方页面，[AI Video Editor](https://chatcut.io/features/ai-video-editor)；实测 DOM `chatcut-home.dom.txt`；收据 schema 为**推测/未公开**）
- **撤销与版本**：顶部 Undo/Redo；新编辑会清空 redo；Versions 是命名快照，恢复版本本身可再 Undo；提交编辑持续同步，保存版本是额外检查点。（官方文档，[Versions / Undo / Redo](https://chatcut.io/docs/versions-undo-redo)；DOM `chatcut-versions-undo.dom.txt:161-187`）

### 1.3「选中即上下文」

Selection Mode 是独立于普通编辑选择的模式：点击 Timeline clip、素材、Viewer 区域、时间尺点位或 Transcript 文字后，Prompt 字段出现记录类型与项目上下文的 `@` reference chip；再输入指令并 Send。普通选择只服务 Inspector/Timeline，不会自动进入 Agent 草稿；切换时间线、替换/删除素材或大改文字稿后，旧 chip 可能失效，需要重选。（官方文档，[Selection Mode](https://chatcut.io/docs/selection-mode)；DOM `chatcut-selection-mode.dom.txt:160-197`）

### 1.4 工具栏、对话位置与收起行为

默认布局是 AI/媒体面板与 Viewer 并列、Timeline 在下方；Top bar 从左到右为 Home、项目名、分享成员、Undo、Redo、Workspace、Versions、Export、头像菜单。Workspace 可显示/隐藏 AI、My Assets、Library、Transcript、Timeline；Viewer/Timeline 上方另有 split、snapping、play/pause、time、zoom、画幅、captions、fullscreen 控件。（官方文档，[Editor Layout](https://chatcut.io/docs/editor-overview)；DOM `chatcut-editor-overview.dom.txt:164-197,255-262`）

对话框固定在 AI panel 底部，隐藏 AI panel 后需从 Workspace 恢复；官方没有说明“全屏或右栏收起时把输入框搬到哪里”，因此该行为**未能访问/不确定**。明确的是，隐藏面板不会删除内容，Reset to default 可恢复布局。（官方文档；DOM `chatcut-editor-overview.dom.txt:203-217`）

### 1.5 转场、字幕、音频能否让 AI 操作

- **转场**：AI Effects 接受“在 @clip-A 与 @clip-B 的 cut 加八帧玻璃折射转场”等自然语言；内建转场也可从 Library 拖到相邻片段切点。Timeline 右键切点可加 video cross dissolve、audio cross fade 或两者，拆/删任一侧可能移除转场。（官方文档，[AI Effects](https://chatcut.io/docs/ai-effects)、[Timeline](https://chatcut.io/docs/timeline)；DOM `chatcut-effects.dom.txt:162-208`、`chatcut-timeline.dom.txt:284-290`）
- **字幕/文字稿**：Transcript 是可编辑文字；删除或重排文字改变剪辑；Auto captions 生成逐词时间戳。2026-08-04 更新说明字幕文本、时序、翻译、布局以可恢复 cue program 存储，直接编辑与 Agent 编辑保持同步；Desktop 后续支持搜索、替换、拆分、合并与同步选择。（官方文档/更新页，[Caption programs](https://chatcut.io/docs/changelog/2026-08-04-caption-programs-prompt-queue-nle-export)、[AI Video Editor](https://chatcut.io/features/ai-video-editor)；DOM `chatcut-changelog-captions.dom.txt`）
- **片段音频**：轨道头有 Visibility、Volume、Lock、Audio ducking、Captions、Effect lane；右键片段可 Detach Audio；AI Voice Isolation 通过右键处理语音，Restore original audio 可回退；AI Effects/Agent 也可要求清理语音、自动 ducking。（官方文档，[Timeline](https://chatcut.io/docs/timeline)；DOM `chatcut-timeline.dom.txt:207-237,256-272,306-330`；AI Voice Isolation 为官方文档描述，非本次登录实测）

### 1.6 口碑与失败/扣费摩擦

- 正向信号：Product Hunt 4.5/5（2 条评论）的一条评论称“结果仍是 active、editable multi-track timeline”，适合把粗剪交给 AI 后继续掌控结构。（评测转述，[Product Hunt](https://www.producthunt.com/products/chatcut-ai-video-editor)）
- 负向信号：Trustpilot 有 1 星评论抱怨升级后“interface remains mediocre”“capabilities limited”“customer service…non-existent”；该样本极小，只能说明有人遇到付费后预期落差，不能推成总体口碑。（评测转述，[Trustpilot](https://www.trustpilot.com/review/chatcut.io)）
- 社区对早期 Seedance 资格、排队超时、模型名与实际效果、充值/扣费有强烈质疑；这些 Reddit 帖子集中于 2026-02 的早期生成服务，不能直接外推到当前剪辑轴，但说明“模型/额度/失败原因不透明”会吞噬信任。（评测转述，[Reddit 讨论](https://www.reddit.com/r/u_Zestyclose-Way7259/comments/1r5qqa9/chatcut_exposed_as_a_scam/)、[Seedance 讨论](https://www.reddit.com/r/Seedance_AI/comments/1rnypuh/chatcut_codes_plz/)）
- 当前官方修复了部分可控性：失败资产卡给出具体错误，Credits history 是最终扣费真相；官方写明失败/超时通常不扣，但要求用户以交易明细核验，不要从错误类别推断收费。（官方文档，[Error messages](https://chatcut.io/docs/error-messages)、[Credits policy](https://chatcut.io/docs/credits-policy)；DOM `chatcut-errors.dom.txt:171-201`、`chatcut-credits.dom.txt:168-199,271-280`）

## 2. 四家副对象（机制层 + 工具栏证据）

**剪映/CapCut（主样本）**：官方 Desktop 指南给出的可见流程顺序是 Import → 选中时间线片段并点 Split → 顶部左侧 Transitions → 右侧 Video > Basic > Enhance quality / Reduce image noise → 右键 Transcribe → Captions > Auto captions → Generate → Export；Help Center 还把 Auto Cut 定义为按音乐节拍、语音停顿或文字提示自动剪辑。该页面没有公开完整桌面“底部 11 图标”顺序，因此顺序只按官方操作路径记录，未把移动端 Edit/Audio/Text/Stickers/Overlay/Effects 截图冒充桌面证据。（官方文档：[CapCut Desktop](https://www.capcut.com/resource/capcut-desktop-download)、[Help Center](https://www.capcut.com/help)；DOM `capcut-desktop.dom.txt:178-225`、`capcut-help.dom.txt:187-224`）选中片段后属性在右侧 Video/Basic，右键入口至少有 Transcribe；AI 入口在 Auto Cut、Auto captions、Enhance quality 等工具中，非独立聊天 Agent。（官方文档，实测 DOM）

**Descript（文稿即时间线祖师）**：官方定位是编辑 transcript 就编辑视频：删除、重排、复制粘贴句子会同步更新视频；Underlord 是内置 AI co-editor，可按自然语言写脚本、编辑、给反馈、加场景/视觉/旁白；AI 工具还包括 Remove Filler Words、Studio Sound、Eye Contact。新时间线保留可展开的多轨编辑，insert toolbar 用于模板、stock media、project files、recordings；选中片段后仍可在时间线精修，但本次官方页面没有给出完整按钮顺序或右键菜单清单，故该项标不确定。（官方文档：[Video editing](https://www.descript.com/video-editing)、[Product tour](https://www.descript.com/tour)；DOM `descript-video-editing.dom.txt:104-114,172-197`、`descript-tour.dom.txt:64-72`）

**Premiere Pro**：Adobe 把 AI 放进老时间线的现有工具/任务条：Generative Extend 直接拖拽视频或音频片段边缘，补几帧以盖住转场、反应或环境声；Generative Media Tool（beta）在时间线选定范围后输入描述、选模型，结果以可编辑 clip 加回序列并可在原地重生成；Media Intelligence/Search panel 负责找素材，Caption Translation 负责字幕翻译。官方帮助页未给出完整 toolbar 图标顺序；常规选择/剃刀/钢笔/手形等工具仍是既有工具栏，AI 是“选中范围后的任务条/面板”，不是另起一套编辑器。（官方文档：[Generative Extend](https://helpx.adobe.com/premiere/desktop/edit-projects/edit-with-generative-ai/generative-extend-overview.html)、[Generative Media Tool](https://helpx.adobe.com/au/premiere/desktop/edit-projects/edit-with-generative-ai/generative-media-tool-overview.html)；DOM `adobe-generative-extend.dom.txt`、`adobe-generative-media.dom.txt:1685-1706`）选中 clip 后属性在 Properties/Essential Sound；右键/上下文菜单细节需登录软件实测，本文不臆测。（官方文档，未访问桌面客户端）

**DaVinci Resolve（Cut 页）**：Blackmagic 把 Cut 页定义为“每次点击都有直接结果”的极简面，使用双时间线、Source Tape、Smart Indicator。官方 Cut 页写明 Smart Insert、Append at End、Place On Top、Close Up（Neural Engine AI 找脸）、Ripple Overwrite、Source Overwrite；其顺序即官方页面列出的动作顺序，顶部工具栏另有播放、编辑、转场按钮。选中 clip 后通过 Smart Indicator/Trim 工具直接编辑，颜色/音频等属性进入对应页；本次公开页面未给完整右键菜单。（官方文档：[Cut page](https://www.blackmagicdesign.com/uk/products/davinciresolve/cut)、[Resolve 20 Editor’s Guide](https://documents.blackmagicdesign.com/UserManuals/DaVinci-Resolve-20-Editors-Guide.pdf)；DOM `davinci-cut.dom.txt:185-228`）

## 3. 逐功能对账矩阵

| 功能 | 竞品做法（核实程度） | Nomi 现状（origin/main，file:line） | 缺口 | 优先级 |
|---|---|---|---|---|
| 对话改剪辑轴 | ChatCut Agent 读项目/文字稿，结果写活动 Timeline，并在 Viewer 审阅；生成类先确认卡。（官方文档） | `propose_edit_plan` schema 与六类操作：`electron/shared/agentCapabilities/timelineRead.ts:10-75,77-112`；写入为 revision 守卫+proposal approval，返回 diff/undoToken：`electron/shared/agentCapabilities/timelineWrite.ts:35-63,110-127` | 没有统一的用户可见 proposal 卡/动作收据规范；只有结构编辑 | P0 |
| 选中即上下文 | Selection Mode 把 clip、时间点、Viewer 区域、Transcript 文字变成 `@` chip；普通选择不自动带入。（官方文档） | 预览发送前快照选中片段：`src/workbench/ai/ProjectAgentResidentShell.tsx:147-159,494-514` | 选中内容没有 UI chip/失效提示的统一产品契约 | P0 |
| 改前预览/确认 | ChatCut 生成类有 Allow/Deny/估价；剪辑类靠执行后 Viewer/Timeline + Undo。（官方文档） | `apply_edit_plan` 明确“after user approval”，但 UI 证据/可视 diff 不在时间轴组件内：`electron/shared/agentCapabilities/timelineWrite.ts:100-105,123-126` | 需要逐操作预览、影响范围、确认/取消 | P0 |
| 收据/影响范围 | ChatCut 对话显示 plan、删掉几处、节省秒数、生成 V2 等可读行；失败卡与 Credits history 分开。（官方页面/文档） | 返回 `summary`、`appliedOperationCount`、`diagnostics`、`diff`、`undoToken`：`electron/shared/agentCapabilities/timelineWrite.ts:35-53` | 缺少面向用户的“改了哪些片段/时间/费用/下一步”卡 | P0 |
| 撤销/版本 | 顶部 Undo/Redo + 命名 Versions；恢复版本本身可 Undo。（官方文档） | Agent 专用 `undo_timeline_edit` 带 expectedRevision/undoToken：`electron/shared/agentCapabilities/timelineWrite.ts:8-23,55-63`；Timeline 本地 Undo/Redo：`src/workbench/timeline/TimelinePanel.tsx:93-96,340-350` | 没有把 Agent 收据、版本快照和用户手工 Undo 串成同一历史视图 | P1 |
| 操作种类 | ChatCut 支持移动/trim/split/duplicate、转场、字幕 cue、音频 ducking/voice isolation、效果/速度等。（官方文档） | 只有 move/remove/split/trim/source-window/ripple：`electron/shared/agentCapabilities/timelineRead.ts:10-75`；内核同样六类：`src/workbench/timeline/kernel/timelineKernel.ts:398-524` | Agent 触不到已有 transition/text/audio 字段 | P0 |
| 转场 | ChatCut AI Effects 可创建并应用转场；切点右键 cross dissolve/cross fade。（官方文档） | 数据模型已有 `cut/dissolve/fade/match_cut/whip_pan`：`src/workbench/timeline/timelineTypes.ts:7-21,86-89`；反馈/导出仅支持部分类型：`src/workbench/timeline/timelineVisualFeedback.ts:4-5,135-167` | 需要 transition operation/schema、相邻片段校验、预览/导出能力矩阵 | P0 |
| 字幕/文字稿 | ChatCut Transcript 与 caption cue program 可由直接编辑和 Agent 同步。（官方更新） | 文字轨是独立一等公民：`src/workbench/timeline/timelineTypes.ts:59-89`；UI 文字轨：`src/workbench/timeline/TimelineTextTrack.tsx:1-9,179` | 无 Agent text edit/时间范围/样式操作 | P0 |
| 片段音频 | ChatCut 有 gain/volume/mute/fade/ducking/voice isolation，并可 Restore original audio。（官方文档） | 数据模型已有 gainDb/muted/fadeInFrames/fadeOutFrames：`src/workbench/timeline/timelineTypes.ts:23-30`；内核校验：`src/workbench/timeline/kernel/timelineKernel.ts:200-209`；运行时增益/淡入淡出：`src/workbench/timeline/clipAudio.ts:23-60` | Agent 不能读写 audio 字段，不能做 ducking/voice isolation | P0 |
| 工具栏/面板 | ChatCut Top bar + 可收起 Workspace；CapCut/Resolve 把动作按粗剪→效果→字幕/音频组织。（官方文档） | 真实工具栏顺序见 §4；`src/workbench/timeline/TimelinePanel.tsx:284-359` | AI arrange、再生、微调、缩放、删除、剪刀堆在一条右上 pill；与 Inspector/右键语义未统一 | P1 |
| 失败与扣费 | ChatCut 失败资产卡给原因，Credits history 为最终真相；社区仍抱怨早期排队/扣费不透明。（官方+评测转述） | MCP 暴露四工具：`nomi_timeline_read/edit/export_job/media_query`（`electron/harness/tools/modelToolSurfaceManifest.ts:128-185`）；写入有 diagnostics | 需把失败原因、影响范围、是否扣费/可重试写入同一收据 | P0 |

## 4. 工具栏趋同建议表

> 证据边界：CapCut 官方页面只公开操作路径，不公开完整桌面图标顺序；Premiere 官方帮助公开 AI 任务条与 Properties，不公开整条 toolbar 顺序；DaVinci 官方 Cut 页公开动作顺序。故“未公开”保持原样，不补猜测。Nomi 当前按钮按 `TimelinePanel.tsx:303-350` 的 DOM 顺序读取。

| 一行一个动作 | 剪映/CapCut 叫法（官方路径） | Premiere 对应 | DaVinci Cut 对应 | Nomi 现在 | 建议 |
|---|---|---|---|---|---|
| 导入/添加素材 | Import | Import/Media Browser（常规） | Media Pool / Source Tape | 不在此条工具栏，走拖放与素材库 | 保留为素材库入口，不塞剪辑 pill |
| 选择/移动 | Select/拖动片段（未公开图标顺序） | Selection Tool | Smart Indicator + 选择 | Timeline clip 拖动（`TimelineClip.tsx:133-239`） | 保留，统一选中 chip |
| 分割 | Split | Razor | Blade/Trim | Split（剪刀，`TimelinePanel.tsx:327-339`） | 保留，名称统一“分割” |
| 修剪/波纹 | Trim（属性/时间线） | Ripple/Roll/Trim | Trim/Roll/Slip/Slide | 拖边 trim；ripple 仅 Agent schema | 合并为“修剪”，高级波纹放二级 |
| 删除 | Delete | Clear/Ripple Delete | Ripple Delete | Delete selected（`TimelinePanel.tsx:346-350`） | 保留；显示是否 ripple |
| 复制 | Duplicate/Copy | Duplicate | Duplicate（常规） | Duplicate（`TimelinePanel.tsx:314-316`） | 保留，移入选中片段动作组 |
| 前后微调 | Nudge（未公开统一名） | Nudge | 微移/拖动 | Nudge earlier/later（`TimelinePanel.tsx:314-316`） | 合并为“微移”并显示快捷键 |
| 转场 | Transitions tab | Effects/Transitions | Transition buttons / Smart edits | 仅可视标记与模型，无 Agent 按钮 | 新增转场入口，P0；不另做供应商按钮 |
| 字幕 | Captions > Auto captions | Captions / Text-Based Editing | Subtitles/Caption | 文字轨 + “+字幕”（`TimelinePanel.tsx:491-494`） | 保留“字幕”，接 Agent text operation |
| 音频/静音 | Audio、Enhance voice、Reduce noise | Essential Sound / Properties | Fairlight / track speaker | 音频副轨与模型字段，无 Agent 控件 | 新增片段音频面板；静音/增益/淡入出合并 |
| AI 粗剪/自动编排 | Auto Cut | Text-Based Editing / Media Intelligence | Smart Insert / Close Up（AI） | AI arrange wand（`TimelinePanel.tsx:319-326`） | 改名“按计划编排”，与 Agent proposal 同源 |
| 重新生成/生成媒体 | AI video maker / Generate | Generative Media / Generative Extend | Close Up（AI）等 | Regenerate sparkles（`TimelinePanel.tsx:303-313`） | 保留，但必须走确认卡/费用收据 |
| 撤销/重做 | Undo/Redo（常规） | Undo/Redo | Undo/Redo | 条件显示（`TimelinePanel.tsx:340-345`）+ Agent undoToken | 保留置顶；与 Agent 收据合并历史 |
| 缩放 | Timeline zoom | Timeline zoom | 双时间线/Resize Timeline | − / % / Reset / +（`TimelinePanel.tsx:346-349`） | 合并为一个“缩放”菜单，减少四个图标 |

## 5.「Agent 改剪辑轴」的交互收敛

| 步骤 | ChatCut/竞品证据 | Nomi 采纳 |
|---|---|---|
| 1. 预览 | ChatCut Selection Mode 先生成 `@` chip；生成类确认卡展示引用与估价；Resolve/ Premiere 先在时间线选范围再执行 Smart/Generative 动作。（官方文档） | 发送时冻结 `selectedClipIds` 已有：`ProjectAgentResidentShell.tsx:147-159,494-514`。补一个可见 chip：片段 id、轨道、起止帧、当前 revision；过期即提示重选。 |
| 2. 确认 | ChatCut Allow/Deny/调整字段；Descript Underlord 在用户指导下工作，文字改动即时反映。（官方文档） | `propose_edit_plan` 只产 Proposal；卡片列出每个 operation、受影响片段/字幕/音频、预估时长/费用、冲突诊断；用户确认才调用 `apply_edit_plan`。 |
| 3. 收据 | ChatCut 对话给 plan、数量、节省时长、版本（如 V2）；失败卡链接 Credits history。（官方页面/文档） | 复用 `summary + appliedOperationCount + diagnostics + diff + undoToken`，渲染“改前→改后、影响范围、费用/未收费、下一步”；失败按“原因→影响→重试范围”。 |
| 4. 撤销 | ChatCut 顶部 Undo/Redo + 命名 Versions，恢复版本本身可 Undo。（官方文档） | 成功收据挂 `undoToken` 与 revision；“撤销本次 Agent 修改”调用 `undo_timeline_edit`，检查 expectedRevision；手工新改动后明确提示需恢复版本而非盲撤。 |

这四步的底层逻辑是把 AI 当“可审阅事务”而不是直接改状态：用户能在付费/不可逆生成前停下，能在错误改动后定位并回退，Agent 仍可复用现有时间轴内核。对 Nomi 来说，最小可交付顺序是 transition/text/audio 三类 operation → 收据卡 → 真实 Electron 走查；不要先扩成全能剪辑器。（推测/产品建议）

## 6. 抄 / 避清单

**抄：**

1. ChatCut Selection Mode 的“选中即 chip”，但把 chip 内容做成 Nomi 自己的稳定 `TargetRef`；（官方文档）
2. ChatCut/CapCut 的“动作落在真实时间线、结果马上可见”，以及 Resolve 的 Smart Indicator/双时间线减少找命令时间；（官方文档）
3. ChatCut 的生成确认卡、Live estimate、Credits history 与失败卡；Nomi 应把费用与是否收费写进收据，不让用户猜；（官方文档）
4. Descript 的文稿删除/重排即剪辑，映射到 Nomi 已有独立文字轨；（官方文档）
5. Lovart 的 Touch Edit：点选元素直接带入对话；对剪辑面可借“点片段/点文字/点切点即带上下文”，但不照搬图像分层。证据：`docs/research/2026-06-27-lovart-element-decomposition-research.md:24-33`。（既有研究）
6. MiniMax Design 的剪辑 Agent：自然语言修改视频片段、字幕、转场和画面效果并导出；其反馈公式“保留什么 + 修改什么 + 为什么 + 期望结果”可作为 Nomi proposal 文案，证据：`docs/research/2026-08-24-agent-workbench/docx/MiniMax_Design_-.md:132-143,163-166`；官网把脚本、分镜、图片、视频、音乐、剪辑放同一画布，证据：`docs/research/2026-08-24-agent-workbench/web/minimax_design_home.full.dom.md:64-86`。（既有研究）

**避：**

1. 把“生成成功”当“剪辑完成”：没有可播放 Viewer、真实时间线和可撤销版本就不能交付；（跨产品证据）
2. 一句模糊的“做得更有电影感”直接执行。ChatCut AI Effects 自己要求写目标、效果、时间范围、强度与保持不变项；（官方文档）
3. 黑箱整段重抽、不可中止、积分不透明。早期社区对 ChatCut/Seedance 的排队和扣费质疑说明信任损耗很快；（评测转述）
4. 为每家供应商复制一套 UI。Premiere、Resolve、CapCut 的共同结构都是“选中范围/片段 → 既有工具或任务条 → 可编辑结果”，Nomi 应维护一套 capability contract。（推测）
5. 把静态页面、宣传语或平台排名当生产证据；本报告把产品宣传、官方文档、评测转述、推测分开。（方法纪律）

## 7. 花费与未能访问说明

- 本轮只做公开网页检索、官方页面 DOM 文本下载和本地代码阅读；未登录 ChatCut、未创建项目、未调用任何生成模型、未消耗 ChatCut/Nomi 额度。
- DOM 文本证据目录：`docs/research/2026-09-05-chatcut-conversational-editing/`，包含 ChatCut 官网/手册、Credits/Error/Versions、CapCut、Descript、Adobe、DaVinci 页面文本；每个文件首行有 URL 与 Accessed 日期。
- 未能访问：ChatCut 登录后的真实编辑器、全屏/收起右栏后的输入框行为、剪辑类 proposal 的真实 UI 收据 schema；CapCut/Premiere/Resolve 桌面客户端的完整图标顺序、选中片段右键菜单；Product Hunt 正文因脚本限制只通过搜索索引核实上线时间与评论摘要。
- 研究边界：社区“诈骗/模型不符/扣费”帖是早期生成服务的评测转述，不能作为当前剪辑能力的实测结论；官方 Credits policy 也要求用交易明细核验最终扣费。
