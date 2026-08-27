# 自动剪辑（Auto-Edit）架构方案

> 日期：2026-08-27 · 状态：📋 **方案待拍板**（未写一行实现码）
> 分支：`feat/auto-edit-plan`（从 `origin/main` @ `8f9365ae` 起的独立 worktree）
> **可信度纪律**：仓库结论全部逐行读过源码，给 `file:line`；外部结论标 URL + 抓取日期（均 2026-08-27）；star / license / 活跃度用 **GitHub API 实测**，不用记忆。查不到的地方明写「未公开」。

---

## 0. 一页读懂（D6：先讲逻辑，再讲取舍）

### 0.1 要解决的真实摩擦

镜头全生成完了，用户切到预览区，看到的是这样一条轴：

> 按镜号一字排开 · 每镜原样长度（模型给多长就多长）· 没有字幕 · 没有配乐 · 没有转场 · 没人告诉他哪里该短哪里该长

从这里到「能发出去的成片」，还差几十刀手工活。而这一段**现在完全没有 AI**：创作区有 Agent（文档工具组），生成区有 Agent（画布工具组），**预览/剪辑区一个都没有**——`WorkbenchShell.tsx:292` 给 preview 传的是裸 `<PreviewWorkspace />`，隔壁 `GenerationWorkspace` 传的是 `aiSidebar={generationAi}`。这不是「忘了做」，是整条链在这里断了。

### 0.2 根因不是「缺一个自动剪辑算法」，是「剪辑意图在管线里被丢掉了」

这是本方案最重要的一句话。逐层看证据：

| 环节 | 上游其实知道什么 | 实际存下来什么 | 证据 |
|---|---|---|---|
| 拆镜头 | 每镜的时长意图、情绪、台词、这镜为什么存在 | 只有 index / shotKind / durationSec / anchorIds / prompt / modelKey / params / keyframe | `electron/harness/tools/canvasDescriptors.ts:81`（storyboardShotSchema）——**没有台词字段、没有 beat/幕字段、没有转场意图、没有声音意图** |
| 排片 | 镜序 + 每镜角色（视频/占位/静帧） | 只按 shotIndex 排序、role 三选一，其余全丢 | `src/workbench/generationCanvas/agent/storyboardTimelinePlan.ts:58` |
| 时间轴 | —— | TimelineClip 有 id/type/帧区间/framing，**没有任何「为什么这么剪」的字段** | `src/workbench/timeline/timelineTypes.ts:23` |

所以：**哪怕现在写一个自动剪辑器，它能读到的也只是「一串没有语义的视频文件」**——它只能靠视觉重新猜一遍上游本来就已经想清楚的东西。这就是 P2 的自检答案：不修这层，「自动剪辑」这个病还会从别的入口冒出来（MCP 外部 agent 排片同样瞎、导出同样没依据、重剪同样从零猜）。

**先把意图接起来，自动剪辑才有东西可推理。**

### 0.3 核心取舍（一句话点破，D6 ②）

> 是把 Nomi 做成**「又一个能剪素材的 AI 剪辑器」**（正面打 ChatCut / Descript，人家「转录 + 选段」打磨了两年），
> 还是做成**「唯一知道这条片子为什么这么剪的剪辑器」**（剧本、分镜、每镜意图都是我们自己生成的，对手拿不到）？

**我的判断（D5，给真判断不给菜单）：两条都要，但顺序不能反。**

- **A 轨「意图直通」= 护城河**：只有 Nomi 有上游意图，对手结构上抄不动（ChatCut 拿到的永远是别人拍好的 mp4，没有分镜意图）。**先做。**
- **B 轨「素材剪辑」= 基本功**：转录 / 删静音 / 转录稿剪辑，是已经商品化的通用能力，随时能补，且开源件成熟（见 §5）。**后做，但必须做**——因为用户说「先跟顶尖对齐」，而这块不做，任何一个拿手机拍了段口播的用户在 Nomi 里寸步难行。

两轨**共用同一个中间层**：EditDecisionList（剪辑意图层）。这是本方案的地基——不是两套系统。

---

## 1. 现状盘点（逐行读过 · file:line）

### 1.1 数据模型：能装什么

`src/workbench/timeline/timelineTypes.ts`

```
TimelineState  { version:1, fps, scale, playheadFrame, tracks[], textClips[], transitions?[] }
TimelineTrack  { id, type:'image'|'video'|'audio', label, clips[] }        // 固定 3 条，不可增
TimelineClip   { id, type, sourceNodeId, label,
                 startFrame, endFrame, frameCount,
                 offsetStartFrame, offsetEndFrame,                        // 两端裁剪
                 text?, url?, thumbnailUrl?, framing? }                   // framing = contain/cover + scale + offsetXY
TimelineTextClip { id, sourceNodeId?, text, style:'caption'|'title',
                 startFrame, endFrame, position?, scale?, rotation?, fontFamily? }
TimelineTransition { fromClipId, toClipId, type:'cut'|'dissolve'|'fade'|'match_cut'|'whip_pan', durationFrames? }
```

**装得下的**：三轨（图/视频/音）、帧级 in/out、静态取景、字幕/标题卡、转场元数据。
**装不下的**（对照 §2 顶尖）：每 clip 音量 / 变速 / 关键帧动画（Ken Burns）/ 任意图层数 / 音频 ducking / 每 clip 的「为什么」（rationale）。

### 1.2 编辑能力：能做什么

`src/workbench/timeline/timelineEdit.ts`（505 行，31 个导出）已经相当扎实：
`addClipAtFrame:77` / `moveClipToLegalFrame:160` / `removeClipsByIds:191` / `splitClipAtFrame:311` / `duplicateClipById:368` / `nudgeClipById:397` / `resizeClipEdge:409` / `setClipFraming:465` / `applyClipStartFrames:296`（整批）。
配套：磁吸 `timeline/snapping/`、撤销/重做栈 `workbenchStore.ts:521/532/551`、多选、快捷键 `timelineShortcuts.ts`。

**结论：手工剪辑的原子操作基本齐了。缺的不是「手」，是「脑」和「意图」。**

### 1.3 采纳桥：整批落轴已经做对了

`src/workbench/adoption/adoptStoryboardBatch.ts` —— 12 个镜头 = **一次落定、一层撤销**（注释见 `sendStoryboardToTimeline.ts:19`）。
这是本方案要复用的关键机制：**任何自动剪辑结果都应该走这条桥落轴**，而不是「算一个写一个」（否则第 N 个失败会留半条轴、用户要按 N 次 Cmd+Z）。

### 1.4 导出链：ffmpeg，且比想象中完整

`electron/export/ffmpegFiltergraph.ts`（416 行）：

- 视觉链 `buildVisualGraph:259`：白底 base + 逐 clip scale → overlay（带 `enable='gte(t,..)*lt(t,..)'` 时间窗），取景表达式与预览 CSS 同公式（`framingFilters:103`）。
- 音频链 `buildAudioGraph:192`：atrim → asetpts → adelay → amix + volume 补偿。
- 文字链 `buildTextOverlayGraph:339`：全画幅透明 PNG 作输入 → `overlay=0:0` + `enable=between(...)`，**接在视觉链最后一层**（与 video-use 硬规则 1 一致，见 §2.2）。
- 音频档位 `exportJobs.ts:169-170`：任一素材有音轨 → aac / mixdown，否则 none / mute。**配乐是真的会出声的**（我原本怀疑是静音，读码后推翻）。

### 1.5 已有的自动化底座：productionRun（96 个文件，被严重低估）

`electron/productionRun/` 已经是一套完整的可恢复 Run 引擎：阶段机 + 门（gate）+ 预算账本 + 审批回执 + 幂等 + 制品（artifact）+ 事件流。
**并且 playbook 里已经有 `assemble` 阶段**：

```
brief → direction → script → storyboard → build → generate → qa → assemble → export
                                                                   ^^^^^^^^
electron/productionRun/productionPlaybooks.ts:33-43
```

`assemble` 现在做什么？`productionRunDriverOps.ts:576-585` —— 起阶段 → 调 `production.arrange` → 存一个 `kind:'timeline'` 的 artifact → 标 completed。而 `production.arrange` 的实现（`src/workbench/capability/capabilityApplyHandler.ts:543`）就是 `arrangeStoryboardToTimeline()` 一行。

**这意味着：自动剪辑不需要新建管线，它就是把 `assemble` 这个已经存在但只有一行的阶段填满。** 这是本方案最省力的地方，也是「加新必删旧」（P1）的天然落点。

### 1.6 三个「静默说谎」的洞（P2 根因级，必须一起修）

**洞 1：转场被授权、被校验、但从不渲染。**
`timelineSubtitleTransitionContract.ts:169` 硬性要求「最终成片至少 2 个明确转场（硬切也必须显式声明）」，TimelineTransition 支持 dissolve/fade/match_cut/whip_pan。
但 `ffmpegFiltergraph.ts` 全文**没有 xfade、没有 acrossfade**（实扫：`grep -n "xfade" electron/export/*.ts` → 0 命中；唯一 transition 字样是 amix 的 `dropout_transition=0`）。
→ **用户/Agent 授权了 dissolve，导出出来是硬切，且没有任何警告。** 这是典型的「本地看不出、成片才发现」，正是 R17 重活门岗那一族。

**洞 2：切点没有护栏。**
`resizeClipEdge` / `splitClipAtFrame` 只做帧级合法性检查（不重叠、不越界）。没有「不切在词中间」、没有「切边留 padding」的概念——因为**根本没有词级时间信息**（无 ASR）。对生成内容影响小（无对白音轨时），对 B 轨（用户素材）是致命的。

**洞 3：剪辑决策不可解释、不可复现。**
时间轴是最终状态，不是决策记录。用户问「这刀为什么这么切」，代码里没有答案；Agent 重跑一次也无法复现上次的判断。对照 video-use 的 EDL（每段带 beat / quote / reason）和 OpenMontage 的 edit_decisions（每 cut 带 reason），这是明确的结构性缺口。

### 1.7 Agent 面现状

| 工具组 | 文件 | 工具 |
|---|---|---|
| 画布 | `electron/harness/tools/canvasDescriptors.ts:310` | read_canvas_state / propose_storyboard_plan / create_canvas_nodes / connect_canvas_edges / set_node_prompt / delete_canvas_nodes / run_generation_batch / **arrange_storyboard_to_timeline** / tidy_canvas / create_staging_reference / create_camera_move |
| 文档 | `electron/harness/tools/documentDescriptors.ts:39` | read_full_text / read_selection / insert_at_cursor / replace_selection / append_to_end / author_skill |
| **剪辑** | **不存在** | **—** |
| MCP（外部 agent） | `electron/capabilityCore/mcpGenerationTools.ts:57` | nomi_session_open … nomi_start_generation / nomi_reconcile_generation（11 个，**全是生成，没有剪辑**）|

唯一碰时间轴的是 `arrange_storyboard_to_timeline`——而它的描述里明写 *"ordering decided by stored shot numbers, **not by you**"*（`canvasDescriptors.ts:366`）。也就是说**现在的设计刻意不让 LLM 参与剪辑决策**。这个设计当初是对的（防 LLM 瞎排序），但它同时把「自动剪辑」这条路堵死了。本方案要做的是：**把决策权交回给 LLM，但用「提案 → 人确认 → 纯函数落轴」的三段式兜住**（这正是 `propose_storyboard_plan` 已经验证过的成功范式）。

---

## 2. 顶尖对账（外部实调 · 2026-08-27）

### 2.1 商业产品

| 产品 | 输入 | 核心机制 | 交互模型 | 剪完留下什么 | 对 Nomi 的价值 |
|---|---|---|---|---|---|
| **ChatCut**（用户点名） | 上传素材 + AI 生成素材 | ① 自动转录（100+ 语言）、分说话人、**每个词映射到帧**；② Agent 模式：分析每条 clip → 找高光 → 去重复 take/口癖 → 排序 → 上字幕/B-roll/音乐 | 可配置工作区（Viewer + AI 面板 + 下方时间轴）；AI 面板支持 **@ 引用**：timeline item / asset / viewer 区域 / 转录稿文字；两种模式 Agent ／ Video Gen；有 **Skills & Design Styles** | **"a real, editable timeline"**（明说不是黑盒成片）；导出 video/audio/字幕/图形/**XML（Premiere/DaVinci）** | **最该对齐的对象**。它的 @ 引用、Skills、「剪完留真时间轴」三条，Nomi 分别已有雏形（deepLinkFocus / `skills/` 31 个 / 真时间轴） |
| **Descript** | 录音/录屏 | 文本即视频：删字=删画面；去口癖、去停顿、Studio Sound、AI Eye Contact | 文档式 | 时间轴 + XML 导出到 Premiere | 转录稿剪辑的范式定义者；B 轨对标 |
| **Premiere Pro（Sensei）** | 专业素材 | Scene Edit Detection：自动识别每个剪切点打标记（实测 47/49 命中） | 传统 NLE | 工程 | 场景切分能力是 B 轨的一半 |
| **可灵 / 即梦 / Higgsfield / Vidu / 海螺** | 生成 | 见 `docs/research/2026-08-19-short-drama-pipelines.md`：**全都在生成侧发力，剪辑侧几乎空白**（「配音+剪辑字幕成片」是流水线最后一段，无一家做自动剪辑） | — | — | **这是缺口**：AI 视频这一侧，「生成完之后怎么变成片」没人做透 |

> 关键观察：**ChatCut / Descript 强在「素材侧」，可灵/即梦强在「生成侧」，中间那段「生成完 → 成片」是无人区。** Nomi 的画布 + 时间轴同在一个 app 里，是唯一能吃下这段的结构。

### 2.2 开源（star / license / 活跃度 = GitHub API 实测，2026-08-27）

| 仓库 | ★ | License | 最近 push | 语言 | 它解决什么 | 我们能直接抄什么 |
|---|---:|---|---|---|---|---|
| [OpenCut-app/OpenCut](https://github.com/OpenCut-app/OpenCut) | **87,085** | MIT | 2026-08-10 | TypeScript | 开源 CapCut（web+桌面） | ⚠️ **实测仓库刚重写**（tree 只剩 151 个文件，changelog 停在 0.3.0，桌面端改 Rust `apps/desktop/src/panels/timeline.rs`）——星多但**当下不是可抄的成熟代码库**，先观察 |
| [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage) | **51,769** | **AGPL-3.0** | 2026-08-22 | Python | Agent 驱动的整条影片生产（research→proposal→script→scene_plan→assets→**edit**→compose），12 条 pipeline | ✅ `schemas/artifacts/edit_decisions.schema.json` 可直接当我们 EDL 的参照系（见 §4.2）；**License 与 Nomi 同为 AGPL-3.0，代码级借鉴无法务风险** |
| [browser-use/video-use](https://github.com/browser-use/video-use) | **21,420** | MIT | 2026-08-26 | Python | 对话式剪任意视频。**整个「产品」只有 1 个 SKILL.md（322 行）+ 6 个 helper 脚本**，引擎是 Claude Code/Codex 本身 | ✅✅ **本方案最重要的参照**。见下方拆解 |
| [HKUDS/ViMax](https://github.com/HKUDS/ViMax) | 12,117 | MIT | 2026-07-29 | Python | 剧本→视频全流程 agent | 已在 `docs/research/2026-08-19-script-to-video-frameworks.md` 拆解过（生成侧），剪辑侧无增量 |
| [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | 14,424 | Apache-2.0 | 2026-08-25 | C++ | 离线 ASR/TTS/VAD/说话人分离，**有 JS API，可在 Electron 里跑**；支持 SenseVoice（中/粤/英/日/韩）+ CTC 对齐时间戳 | ✅ **B 轨转录的直接答案**（本地优先、不上传、中文可用） |
| [WyattBlue/auto-editor](https://github.com/WyattBlue/auto-editor) | 5,081 | Unlicense | 2026-08-25 | Nim | 自动删静音/无动作段，导出 premiere / resolve / final-cut-pro / shotcut / v3 EDL | ✅ 静音检测算法 + **多 NLE EDL 导出格式**参照 |
| [Breakthrough/PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | 5,124 | BSD-3 | 2026-08-24 | Python | 镜头边界检测（content/adaptive/threshold 三种检测器） | ✅ B 轨「场景切分」（= Premiere 的 Scene Edit Detection）算法参照 |
| [AcademySoftwareFoundation/OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | 1,965 | Apache-2.0 | 2026-08-07 | C++ | 影视工业时间轴交换标准；Resolve / Avid / **Premiere Beta** 均已支持 | ◐ **抄语义，不抄依赖**：JS binding 仍是 WIP、未发 npm（[OpenTimelineIO-JS-Bindings](https://github.com/JeanChristopheMorinPerso/OpenTimelineIO-JS-Bindings) 自述 "still a work in progress"）。见 §5 |

#### video-use 逐行拆解（★21.4k / MIT / 6 个 py 文件 / 18 commits）

**它的整个架构就是一句话**：`Transcribe → Pack → LLM Reasons → EDL → Render → Self-Eval`。

值得抄的四条（源码级）：

1. **「打包转录稿」是唯一值得存在的派生物**（`helpers/pack_transcripts.py:1-13` 文档串）
   词级 JSON → 按 **静音 ≥0.5s 或换说话人** 断句 → 每行带 `[start-end]` 的 markdown。原话："gives word-boundary precision from text alone at **1/10 the tokens** of raw Scribe JSON"。
   其余一切（口癖标注、重复 take 检测、镜头分类、重点打分）**都在决策时现推，不预计算**。
   它的 Anti-patterns 第一条就是 *"Hierarchical pre-computed codec formats … Over-engineering"*，第二条是 *"Hand-tuned moment-scoring functions. **The LLM picks better than any heuristic you'll write.**"*

2. **「文字为主，视觉按需」**（`helpers/timeline_view.py:1-20`）
   唯一的视觉下钻工具 = 给定 `[start,end]` 出一张「胶片条 + 波形 + 词标签 + 静音阴影」合成 PNG。文档明写 **"Not a scan tool"** —— 只在决策点用，不做背景索引。
   → 直接回应了「给 LLM 看视频太贵」这个问题：**大部分决策靠文本，只在犹豫的地方看一眼图**。

3. **12 条「硬规则」与「艺术自由」分离**（SKILL.md Hard Rules 段）
   硬规则是**会导致静默失败**的那些（不是审美）：字幕必须最后一层（否则被 overlay 盖住）、逐段抽取+无损 concat（否则二次编码）、每段边界 30ms 音频淡入淡出（否则爆音）、overlay 必须 `setpts=PTS-STARTPTS+T/TB`、字幕时间戳要用输出时间轴偏移、**绝不切在词中间**、每个切边留 30–200ms padding。
   → 这套「硬规则 vs 自由」的分层，和 Nomi 的 CLAUDE.md（P1–P5 硬 / 其余自由）是同一种设计哲学，**可以直接映射成我们的 EDL 校验器 + 门岗**。

4. **自审环**（SKILL.md step 7）
   渲染完成后，对**输出文件**（不是源）在每个切点 ±1.5s 出 timeline_view，逐张检查：跳切闪烁 / 波形爆音 / 字幕被盖 / overlay 错帧；再抽首 2s、尾 2s、2–3 个中点看调色一致性。**最多 3 轮**，超了就诚实上报而不是死循环。
   → 与 Nomi 已有的 `production.verify-shots`（`capabilityApplyHandler.ts:554`）是同构的，可以复用同一套审片闭环。

#### OpenMontage 的 edit_decisions schema（我们 EDL 的参照系）

`schemas/artifacts/edit_decisions.schema.json`（237 行，"Editorial decisions produced by the Edit Agent"）：

```
cuts[]      { id, source, in_seconds, out_seconds, speed, layer,
              transform{ scale, position, animation, crop{x,y,w,h} },
              transition_in, transition_out, transition_duration,
              backgroundColor, reason }
overlays[]  { asset_id, start_seconds, end_seconds, position{x,y,w,h}, animation, opacity }
audio       { narration{segments[]}, music{asset_id, volume, fade_in, fade_out, ducking}, sfx[] }
subtitles   { enabled, style: sentence|word-by-word|karaoke, source, font, font_size,
              color, outline_color, background, position, max_words_per_line }
transitions[] (全局表，已标注 deprecated，优先 per-cut)
```

与 Nomi TimelineClip 逐项对账（**这就是我们的能力缺口清单**）：

| 字段 | OpenMontage | Nomi | 缺不缺 |
|---|---|---|---|
| in/out | in_seconds/out_seconds | offsetStart/EndFrame | ✅ 有（帧 vs 秒，帧更好） |
| 变速 | speed | — | ❌ **缺** |
| 图层 | layer（任意） | 固定 3 轨 | ❌ 缺（本期先不补，见 §7 不动项） |
| 静态取景 | transform.scale/position/crop | framing | ✅ 有 |
| 动态取景 | transform.animation（ken-burns / pan-left） | — | ❌ **缺**（对生成片是刚需：静帧占位镜靠它才不死板） |
| 转场 | per-cut transition_in/out + duration | transitions[] 全局表 | ◐ 有 schema **无渲染**（洞 1） |
| 叠加物 | overlays[] 带位置/动画/透明度 | 只有文字 overlay | ◐ 部分 |
| 配乐 ducking | audio.music.ducking | — | ❌ **缺**（有配乐必然要，否则盖住人声） |
| 音效 | audio.sfx[] | — | ❌ 缺 |
| 字幕样式 | 8 个字段 + word-by-word/karaoke | style:'caption'/'title' + font | ◐ 部分 |
| **为什么这么剪** | cuts[].reason | — | ❌ **缺**（洞 3） |

### 2.3 学术（近 6 月，只收对落地有增量的）

| 论文 | 日期 | 对我们的增量 |
|---|---|---|
| [AutoCut（CVPR 2026）](https://arxiv.org/html/2603.28366) | 2026-03 | 把脚本/帧/音频统一离散化成 token，然后**四个任务同底座**：视频选择、视频排序、脚本生成、**BGM 选择**。→ 印证「选片/排序/配乐是同一个决策问题」，支持我们用一份 EDL 提案一次性覆盖 |
| [From Long Videos to Engaging Clips](https://arxiv.org/pdf/2507.02790) | 2026-07 | 管线：镜头切分 → **叙事理解模块**（视觉+转录+场景 → 结构化场景描述 + 叙事相关度分）→ 选段排序 → 组装。中间产物是「叙事图 + 排序矩阵」。→ 支持 §4.2 的 beat 图设计 |
| [BEAT: Rhythm-Elastic Alignment](https://arxiv.org/pdf/2605.27067) | 2026-05 | 音乐节拍驱动剪辑点、且允许「弹性」对齐（不是硬卡拍）。→ 配乐节奏对齐的做法参照 |
| CutClaw / CineAgents | 2026 | agentic 长视频剪辑 + 指令驱动影视合成 benchmark。→ 只作为方向印证，未开源可读代码 |

---

## 3. 关键判断（D2：从结构和约束推，不从功能列推）

### 3.1 Nomi 的自动剪辑和 ChatCut 的自动剪辑不是同一个问题

| | ChatCut / Descript / video-use | Nomi（A 轨） |
|---|---|---|
| 输入 | 几十分钟废料，**80% 要扔** | 十几个镜头，**每个都是按剧本意图生成的、本来就该用** |
| 核心难题 | **选**（哪几秒是好的） | **接**（这镜留几秒、怎么接下一镜、字幕配乐在哪） |
| 信息来源 | 只有像素和声音（意图已丢失在拍摄现场） | **完整意图链就在同一个 app 里**（剧本→分镜→镜头 prompt→参考图） |
| 决策依据 | 转录稿 + 视觉下钻 | **剧本 + 分镜意图**（不需要重新「理解」自己刚生成的东西） |
| 对手能不能抄 | 能（人人都能接 Whisper） | **不能**（他们拿到的永远是 mp4，没有上游） |

**推论**：A 轨不需要转录、不需要 VLM 看片、不需要高光检测——**它需要的是把已有意图接起来**。这是工程量最小、差异化最大的一条路。这也是 D2 的答案（约束就是战略：solo，广度是敌人，只投结构上对手抄不动的）。

### 3.2 但「不做 B 轨」会挨打

用户明确说「先跟顶尖对齐，再说比他们好」。B 轨（转录 / 删静音 / 转录稿剪辑）是**顶尖产品的入场券**，也是任何「用户自己拍了段素材想混进来」的场景的底线。所以 B 轨要做，但：

- 用**开源件**做（sherpa-onnx，本地优先，符合 Nomi 的「本地优先」定位，还顺带比 ChatCut 强一条：**素材不出机器**）；
- 排在 A 轨之后；
- **共用同一个 EDL 中间层**，不另起炉灶（P1：无并行版）。

### 3.3 「剪完必须留一条真时间轴」是不能让的一条

ChatCut 自己在文档里强调 *"leaving a real, editable timeline behind"*。video-use 的 12 条硬规则里第 11 条是「执行前必须先确认策略」。OpenMontage 强调「审批闸不能被 agent 绕过」。
**三家顶尖在这一点上完全一致，因为这是信任的地基。** Nomi 已经有这个地基（采纳桥 + 提案确认 + 单层撤销），**不能为了「一键成片」的爽感把它拆掉**。

---

## 4. 架构方案

### 4.1 三层（唯一真相源在中间层）

```
┌─ 意图层 ────────────────────────────────────────────────────────┐
│  EditDecisionList (EDL v1)  —— 新增，持久化进 project           │
│  剪辑决策的唯一记录：每刀的 in/out、转场、字幕、配乐、为什么      │
│  作者可以是 Agent，也可以是人（手工剪完回写）                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ projectEdlToTimeline()  纯函数 · 幂等 · 可重放
                            ▼
┌─ 投影层 ────────────────────────────────────────────────────────┐
│  TimelineState  —— 已有，不改语义，只补字段                      │
│  仍然是渲染 + 手工编辑的真相源（P1：不搞双真相源）               │
│  落轴一律走 adoption/adoptStoryboardBatch（整批一次、一层撤销）  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ buildRenderManifestRequest() 已有
                            ▼
┌─ 渲染层 ────────────────────────────────────────────────────────┐
│  ffmpeg filtergraph  —— 已有，补 xfade / ducking / speed         │
└─────────────────────────────────────────────────────────────────┘
```

**为什么中间层不能省（回答「这是不是过度设计」）**：

- 没有它，「为什么这么剪」就没地方存（洞 3）；
- 没有它，Agent 重剪只能读最终状态反推，无法复现；
- 没有它，A 轨和 B 轨会长出两套逻辑（违反 P1）；
- 没有它，导出 XML/EDL 给 Premiere/DaVinci（ChatCut 有、auto-editor 有）无从谈起。

**为什么不把 TimelineState 直接当 EDL**：TimelineState 是**结果**（帧位置），EDL 是**决策**（意图 + 理由）。手工拖了一下 clip，TimelineState 变了但 EDL 不该凭空长出一条假理由。二者的关系是「EDL 可以投影出 TimelineState，反之只能投影出『手工调整』这一条 diff」。

### 4.2 EDL v1 schema（提案，逐字段有出处）

```ts
// src/workbench/edit/editDecisionTypes.ts  (新增)
export type EditDecisionList = {
  version: 1
  fps: number
  /** 谁做的这次决策 —— provenance，对齐 ProductionArtifact.actor 的既有做法 */
  author: { kind: 'agent' | 'user' | 'auto'; sessionKey?: string; at: string }
  /** 叙事骨架。来源优先级：分镜 plan 的 beat > 剧本结构 > Agent 现推 */
  beats: Array<{ id: string; label: string; order: number }>
  cuts: Array<{
    id: string
    /** 与 TimelineClip.sourceNodeId 同语义；B 轨则是素材库 assetId */
    source: string
    sourceStartFrame: number
    sourceEndFrame: number
    beatId?: string
    /** 变速。1 = 原速。缺省不带（省体积，同 framing 的既有做法） */
    speed?: number
    /** 静态取景，复用既有 ClipFraming，不新造 */
    framing?: ClipFraming
    /** 动态取景（Ken Burns）。对静帧占位镜是刚需 */
    motion?: { kind: 'ken_burns' | 'pan' | 'none'; from: ClipFraming; to: ClipFraming }
    transitionIn?: { type: TimelineTransitionType; durationFrames: number }
    /** 这刀为什么这么剪 —— video-use reason / OpenMontage cuts[].reason 的对应物 */
    reason: string
  }>
  captions: Array<{ id: string; text: string; startFrame: number; endFrame: number
                    style: TimelineTextStyle; sourceCutId?: string }>
  music?: { assetId: string; startFrame: number; gain: number
            fadeInFrames: number; fadeOutFrames: number
            /** 有人声就压配乐。OpenMontage audio.music.ducking 的对应物 */
            ducking?: { enabled: boolean; targetGain: number } }
  sfx?: Array<{ assetId: string; atFrame: number; gain: number }>
  /** 全片诊断：Agent 自己承认的取舍与缺陷（D4 诚实交付） */
  diagnostics: { warnings: string[]; notes: string[] }
}
```

**刻意不做的**（避免过度设计，对齐 video-use 的 anti-pattern 第一条）：

- 不做任意图层数（保持 3 轨，图层是 NLE 专业件，Nomi 用户不是剪辑师——沿用 `2026-06-21-preview-rough-cut-overhaul.md` 已验证过的用户测结论）；
- 不做关键帧曲线编辑器（motion 只给 from/to 两端 + 固定 easing）；
- 不预计算任何「打分矩阵」「高光索引」（决策时现推）。

### 4.3 上游补意图（根因修复，A 轨的地基）

`storyboardShotSchema`（`canvasDescriptors.ts:81`）补三个字段，**都是 optional，老 plan 不炸**：

```ts
beat: z.string().optional()
  .describe("Narrative beat this shot serves (e.g. HOOK / SETUP / TURN / PAYOFF). Used by auto-edit for pacing."),
dialogue: z.string().optional()
  .describe("On-screen dialogue/narration for this shot. Becomes the caption; not part of the image prompt."),
transitionIn: z.enum(['cut','dissolve','fade','match_cut','whip_pan']).optional()
  .describe("How this shot enters from the previous one. Default cut."),
```

理由（D3 讲清「为什么」）：

- **beat** —— 节奏来源。有了它，「HOOK 要快、PAYOFF 要留」这类判断才有依据，而不是让 LLM 对着一串 mp4 猜。对齐 video-use 的 editor brief（SKILL.md "Common structural archetypes"）和 §2.3 的叙事图。
- **dialogue** —— 字幕的**根**。现在字幕只能手打或事后 ASR；实际上台词在写剧本那一刻就存在了。这一条能直接让「自动上字幕」从「需要 ASR 的重活」变成「零成本的字符串搬运」。**这是 A 轨最大的一块免费午餐。**
- **transitionIn** —— 让洞 1 有真实数据源（现在 transitions 表基本是空的）。

对应地，`planStoryboardTimeline` 的返回单位补 beat / dialogue / transitionIn 透传；`adoptStoryboardBatch` 已经支持写 textClips 和 transitions（`adoptionApply.ts:97`），落轴不用改机制。

### 4.4 剪辑工具组（Agent 面）

新增 `electron/harness/tools/timelineDescriptors.ts`，与 canvas / document 并列（**参数化工具组的机制已经建好**，见 `docs/plan/agent-merge-architecture.md` Phase 2）：

| 工具 | 花钱 | 语义 | 对齐谁 |
|---|---|---|---|
| `read_timeline` | 免费 | 读当前轴 + EDL（含每 clip 的 beat/reason） | read_canvas_state |
| `inspect_timeline_range(start, end)` | 免费 | **返回该区间的胶片条+波形合成图**（视觉下钻，非扫描工具） | video-use timeline_view.py |
| **`propose_edit(brief)`** | **免费·不落轴** | 产出一份完整 EDL 提案给用户在面板里逐条看/改 | propose_storyboard_plan（已验证的范式） |
| `apply_edit(edlId)` | 免费 | 经采纳桥整批落轴，一层撤销 | arrange_storyboard_to_timeline |
| `set_transitions(list)` | 免费 | 批量改转场 | OpenMontage per-cut transition |
| `generate_captions(source)` | A轨免费 / B轨本地算力 | source='script' 走 dialogue 字段；source='asr' 走 sherpa-onnx | ChatCut captions |
| `place_music(assetId, opts)` | 免费 | 配乐 + 淡入淡出 + ducking | OpenMontage audio.music |
| `transcribe_media(assetId)`（B轨） | 本地算力 | 词级时间戳 → 打包转录稿 | video-use transcribe+pack |
| `review_cut()` | 视模型 | 对**输出**在每个切点 ±1.5s 自审，最多 3 轮 | video-use step 7 / 复用 production.verify-shots |

**门规则**（沿用 `generationCanvas/agent/gate.ts:43` 的既有 `writes: true` 机制）：

- propose_edit / read_* / inspect_* → 免确认（零成本、不写）
- apply_edit / set_transitions / place_music → 走确认卡片（写轴）
- 破坏性操作（清空轴、覆盖已有剪辑）→ 二次确认 + 必须给 reason

**MCP 侧同步开口**：`mcpGenerationTools.ts` 现在 11 个工具全是生成。补 `nomi_read_timeline` / `nomi_propose_edit` / `nomi_apply_edit`，让 Claude Code / Cursor 也能驱动剪辑（这是 Nomi README 的核心卖点之一，不能只在生成侧兑现）。

### 4.5 预览区 ✕ Agent 合并（用户第 3 点）

**做法（结构上最省）**：`WorkbenchShell.tsx:290` 把 preview 也传 aiSidebar，与 GenerationWorkspace 同构：

```tsx
<PreviewWorkspace aiSidebar={previewAi} aiLayout={previewAiLayout} />
```

复用 `workbenchAgentRunner` + `agentSessionKey`（跨区记忆已经打通，见 `agent-merge-architecture.md` Phase 3），`skillKey = 'workbench.preview.*'` → 挂剪辑工具组。

**布局**（对齐 ChatCut 的 "Viewer + AI 面板 + 下方通栏时间轴"，而 Nomi 现在已经是 "素材栏 + 播放器 / 下方通栏时间轴"）：

```
┌──────────┬────────────────────────┬──────────────┐
│ 素材来源  │      播放器 Viewer      │  AI 面板     │  ← 新增这一列
│ 镜头/资产 │                        │  (可收起)    │
├──────────┴────────────────────────┴──────────────┤
│              时间轴（通栏，不变）                  │
└──────────────────────────────────────────────────┘
```

⚠️ **这一块是用户可见改动，按 R8 必须先出 mockup + 用户拍板才能写码**，且加控件前必须过设计系统 §1.5 控件层级规则（AI 面板是 L1 常驻还是 L2 抽屉？预览面常驻预算还剩几个？）。本方案**只给结构判断，不预设视觉**。

**@ 引用（对齐 ChatCut，且我们已有零件）**：AI 面板输入框支持 `@` 选中 clip / 字幕 / 时间段 / 画布镜头。Nomi 已有 `deepLinkFocus.ts` 与 `selectedTimelineClipIds`，缺的只是把「当前选中」注入 prompt 上下文这一层。

### 4.6 渲染层补齐（修洞 1，且做成门岗）

1. `ffmpegFiltergraph.ts` 视觉链支持 `xfade`（dissolve/fade）与音频 `acrossfade`；match_cut / whip_pan 本期**诚实降级为硬切并在导出诊断里明写**（D4：缺口明着标，不藏）。
2. **门岗（P2 通用性判定 + R17）**：新增 `scripts/check-render-coverage.mjs` —— 扫 TimelineTransitionType 的每个枚举值，断言渲染层要么有实现、要么在**显式降级白名单**里；新增枚举值不登记就报红。基线只减不增。
   > 理由：洞 1 之所以能漂这么久，正是因为「schema 加了值、渲染忘了跟」这件事**当场看不出**（预览用 CSS 也不渲染转场）。靠自觉记不住，只能靠机器每次拦。
3. 配乐 ducking：amix 前对配乐支路加 `sidechaincompress`（以人声支路为 sidechain），无人声轨时静默跳过。

---

## 5. build-vs-buy 闸（R20：造轮子前先过）

三问：① 这是不是通用问题？② 同类怎么做的（实查）？③ 自研在不在护城河上？

| 能力 | 通用？ | 现成方案（实测） | 决定 | 理由 |
|---|---|---|---|---|
| **时间轴数据模型 / 交换格式** | 是 | OTIO（Apache-2.0，Resolve/Avid/Premiere 都支持）；JS binding **WIP、未发 npm** | **对齐语义，不取依赖**：EDL 字段命名向 OTIO 靠（track/clip/media_reference/source_range/transition），后续加 `.otio` JSON 导出 | 不在护城河上，且碰「信任」（导出给专业 NLE）。但 C++/WASM 依赖对 Electron 打包是纯负担，语义对齐已能拿到 90% 收益 |
| **渲染引擎** | 是 | **Remotion**（OpenMontage 用它）— 但 [License FAQ](https://www.remotion.dev/docs/license/faq) 明确：source-available、按公司规模收费、**与 AGPL 不兼容**；Nomi 是 `AGPL-3.0-only`（package.json） | **继续用 ffmpeg，不引入 Remotion** | 法务硬边界，不是技术偏好。且我们的 filtergraph 已经跑通取景/音频/字幕三链 |
| **转录 ASR（B 轨）** | 是 | sherpa-onnx（Apache-2.0，14.4k★，**有 JS API 可在 Electron 跑**，SenseVoice 中/粤/英/日/韩 + CTC 时间戳）；对照 ChatCut 走云端 Scribe、video-use 明确反对本地 Whisper CPU | **用 sherpa-onnx，本地优先** | 不在护城河上。且本地跑正好把 Nomi 的定位变成优势：**素材不出机器**（ChatCut 做不到） |
| **静音/无动作检测** | 是 | auto-editor（Unlicense，可自由借鉴） | **抄算法，不引依赖**（它是 Nim，进不了我们的进程） | 算法就几十行 RMS + 阈值 + 最小时长 |
| **镜头边界检测** | 是 | PySceneDetect（BSD-3）content detector | **抄算法**（HSV 帧差 + 自适应阈值），在 Electron 端用 ffmpeg `select='gt(scene,0.4)'` 先做 v0 | 同上 |
| **剪辑决策（选片/排序/节奏/配乐）** | **否** | — | **自研** | **这就是护城河**：我们有上游意图，别人没有。而且 video-use 已经证明「手写打分函数不如让 LLM 直接选」 |
| **意图直通（分镜 → EDL）** | **否** | — | **自研** | 同上，结构上对手抄不动 |

---

## 6. 切片与排期

> 每片独立 commit、独立可回滚、独立过五门。**先做能立刻看见效果的**（D1 effect-first）。

| # | 切片 | 内容 | 量级 | 为什么排这个位置 |
|---|---|---|---|---|
| **S0** | 修洞 1 + 门岗 | xfade/acrossfade 渲染 + check-render-coverage 棘轮 + 未实现类型诚实降级并上报 | 中 | **它是 bug 不是 feature**（授权了 dissolve 导出硬切）。P2 说先修根因，且它挡着后面所有「转场」相关的工作 |
| **S1** | 意图直通 | storyboardShotSchema 补 beat/dialogue/transitionIn → planner 透传 → 采纳桥落 textClips+transitions | 中 | **最大的免费午餐**：做完，「拆完镜头 → 排片 → 字幕转场自动就位」当场可见，一行 LLM 推理都不用花 |
| **S2** | EDL 中间层 | editDecisionTypes.ts + projectEdlToTimeline() 纯函数 + 持久化 + 单测（幂等/重放/往返） | 中 | 地基。S1 的产物正好是第一份真实 EDL，用它验证投影函数 |
| **S3** | 剪辑工具组 + 预览区 Agent | timelineDescriptors.ts + propose_edit/apply_edit + PreviewWorkspace 挂 aiSidebar + @ 引用 | 大 | ⚠️ **先出 mockup + 拍板（R8）**。这是用户第 3 点的正题 |
| **S4** | 自动剪辑 v1（A 轨） | 一句话/一键 → Agent 读 EDL+beat → 出剪辑提案（时长调整/转场/字幕/配乐点）→ 确认 → 落轴；含 review_cut 自审环（≤3 轮） | 大 | 到这里「自动剪辑」才算真跑通 |
| **S5** | B 轨基本功 | sherpa-onnx 转录 + 打包转录稿 + 转录稿面板 + 删静音/删口癖 + 切点词边界护栏（修洞 2） | 大 | 对齐 ChatCut/Descript 的入场券 |
| **S6** | 专业出口 | `.otio` / FCPXML 导出（对齐 ChatCut 的 XML 出口、auto-editor 的多 NLE 出口） | 中 | 锦上添花，但它是「我们不锁你」的信号，对开源用户有分量 |

---

## 7. 范围 / 不动项 / 回滚 / 验收门（R4）

**范围**：§6 的 S0–S6。
**新技术栈**：只有 S5 的 sherpa-onnx（Apache-2.0，Electron 原生模块）——**引入前按 R5 必须先过 Context7/官方文档实查 + 打包体积与多平台二进制评估**，本方案只做选型判断，不算已拍板。

**不动项**：

1. 不改 TimelineState 的语义（只补 optional 字段），不搞第二个时间轴真相源（P1）；
2. 不引入 Remotion 或任何第二渲染器（AGPL 冲突 + P1）；
3. 不做任意图层数 / 关键帧曲线编辑器（剪辑师专业件，Nomi 用户是 AI 创作者——沿用 `2026-06-21-preview-rough-cut-overhaul.md` 的用户测结论）；
4. 不动生成画布 renderer（R21 单内核）；
5. 不动 productionRun 的阶段机与门语义，只把 assemble 阶段填满；
6. 不新增设计 token（AI 面板复用 GenerationWorkspace 的既有壳与 token）。

**回滚**：每切片独立 commit。S0 关掉 xfade 分支即回旧行为；S1 三个字段是 optional，删字段即回；S2 EDL 是旁路制品，不投影即无影响；S3 不传 aiSidebar 即回；S4/S5 关工具组入口即回。

**验收门**：

1. 五门全过（check:filesize → check:tokens → check:i18n → check:heavy-path → lint:ci → typecheck → test → build）+ 新增 check:render-coverage；
2. 单测：EDL 往返幂等、投影纯函数同输入同输出、转场渲染逐类型断言、切点词边界护栏；
3. **P3 真机走查**：起真 Electron，跑「拆镜头 → 生成 → 一键自动剪辑 → 看成片」全程，**截图自己亲眼 Read 过**；
4. **R16 真实用户任务端到端**：至少 3 条真实任务（① 15 镜短剧自动成片 ② 用户导入一段口播 + 生成 B-roll 混剪 ③ 已剪好的片让 Agent「把节奏调快 20%」），把过程中冒出的体验/设计/产品问题**全修掉**才算完成；
5. 与 mockup 逐项对账（S3/S4 的 UI）。

---

## 8. 与顶尖对比：做完之后我们站在哪（用户第 4 点）

| 维度 | ChatCut | Descript | Premiere AI | OpenMontage | video-use | **Nomi（本方案做完）** |
|---|---|---|---|---|---|---|
| 转录稿剪辑 | ✅ 强 | ✅✅ 范式定义者 | ◐ | ◐ | ✅ | ✅ S5（**且本地不出机器**） |
| 自动删静音/口癖 | ✅ | ✅ | ◐ | ◐ | ✅ | ✅ S5 |
| 场景切分 | ✅ | — | ✅✅ | ✅ | — | ✅ S5 |
| 对话式剪辑 Agent | ✅✅ | ◐ | ◐ | ✅ | ✅✅ | ✅ S3/S4 |
| @ 引用上下文 | ✅✅ | — | — | — | ◐ | ✅ S3 |
| 剪完留真时间轴 | ✅ | ✅ | ✅ | ◐（JSON 制品） | ❌（直出 mp4） | ✅ **已有，且带撤销栈** |
| 生成 + 剪辑同一 app | ✅ | ❌ | ◐ | ✅ | ❌ | ✅ **已有** |
| **上游意图直通剪辑** | ❌ | ❌ | ❌ | ◐（自己生成但 JSON 断层） | ❌ | ✅✅ **S1/S2 —— 唯一** |
| 本地优先 / 素材不上云 | ❌ | ❌ | ◐ | ◐ | ❌ | ✅✅ **已有定位** |
| 自带模型 / 接本地 ComfyUI | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ **已有** |
| 外部 agent 可驱动（MCP） | ❌ | ❌ | ❌ | ✅（agent 就是引擎） | ✅ | ✅ S4（补剪辑工具到 MCP） |
| 导出到专业 NLE | ✅ XML | ✅ XML | 原生 | ◐ | ❌ | ✅ S6 |
| 多图层 / 关键帧曲线 | ✅ | ◐ | ✅✅ | ✅ | ◐ | ❌ **主动不做** |

**一句话结论**：做完 S0–S5，Nomi 在「对话式剪辑 + 转录稿剪辑 + 留真时间轴」这些**入场券**上与 ChatCut 平齐；在**上游意图直通、本地优先、生成剪辑同栈、外部 agent 可驱动**四条上是**唯一**。放弃的是多图层/关键帧曲线这类剪辑师专业件——这是主动取舍，不是能力不足。

---

## 9. 把执行委派给 Codex（用户追加要求）

本机已装 **Codex CLI v0.149.1**（`C:\Users\23732\AppData\Roaming\npm\codex`），`codex doctor` 全绿，`~/.codex/config.toml` 走自定义 provider `fox` + `gpt-5.6-sol`。**已实测跑通**（非纸面）：

```bash
codex exec --sandbox read-only "Say CODEX_OK and nothing else." < /dev/null
```

**分工原则（用户定的）：我出方案，Codex 出执行。**

| 我（Claude）做 | 委派给 Codex 做 |
|---|---|
| 方案设计、根因判断、取舍、schema 设计、门岗规则设计 | 按已定稿的 schema/切片写实现码 |
| Review Codex 的产出、真机走查、报完成 | 批量机械改动（补 optional 字段、透传、写单测） |
| 用户可见改动的 mockup 与拍板 | 跑门禁、修 lint/typecheck、补测试到绿 |

**委派配方（可直接用）**：

```bash
codex exec --sandbox workspace-write -C C:/Users/23732/Nomi-auto-edit -m gpt-5.6-sol "读 docs/plan/2026-08-27-auto-edit-architecture.md 的 S1 切片，只做 S1，改动范围仅限该节列出的文件。完成后跑 pnpm run typecheck 与 pnpm run test 到绿。" < /dev/null
```

要点（都是实测踩到的）：

- **`< /dev/null` 必须带**：不带会卡在 `Reading additional input from stdin...`；
- `-C <worktree>` 指定工作根，配合并行 worktree 纪律，**绝不让 Codex 在共享主仓里动手**；
- `--sandbox workspace-write` 是执行档；只读调研用 `read-only`；`--dangerously-bypass-approvals-and-sandbox` 不用；
- `codex exec resume` / `codex apply` 可续跑与回收 diff；`codex review` 可跑非交互 code review；
- 结果**必须我 review + 真机走查**才算完成（P3：全绿 ≠ 完成）——Codex 的自述「已完成」不作数；
- ⚠️ 本机 Node 是 `v22.15.0`，package.json 要求 `>=22.19.0`，pnpm 每次都 WARN。委派前建议先升 Node，免得 Codex 把时间浪费在环境噪音上。

---

## 10. 待拍板（只列真正需要你定的，其余我按 D1-D6 自己定）

| # | 决策点 | 选项 | 我的推荐 |
|---|---|---|---|
| **①** | **顺序**：先 A 轨（意图直通，护城河）还是先 B 轨（转录剪辑，对齐 ChatCut）？ | A 先 / B 先 / 并行 | **A 先**。A 轨 S1 是免费午餐（不花一次 LLM 推理就能让字幕+转场自动就位），B 轨要引原生模块 + 打包体积，重且是商品化能力 |
| **②** | **自动剪辑的默认强度**：一句话直接出成片，还是永远先出提案让人确认？ | 直出 / 永远提案 / 可配 | **永远提案**（与 propose_storyboard_plan 同范式）。三家顶尖在这点上完全一致，是信任地基 |
| **③** | **S5 引入 sherpa-onnx**（原生模块，影响打包体积与多平台产物） | 引入 / 先用云端 API / 先不做 B 轨 | **引入**，但按 R5 先做官方文档实查 + 三平台二进制体积评估再拍 |
| **④** | S3 预览区 AI 面板的**视觉方案** | —— | 需要我先出 mockup（R8），本方案不预设 |

---

## 附：本轮调研的一手材料

- 仓库内既有研究（已读并接上）：`docs/research/2026-08-19-script-to-video-frameworks.md`、`2026-08-19-short-drama-pipelines.md`、`2026-08-24-video-agent-architecture-survey.md`、`docs/plan/2026-06-21-preview-rough-cut-overhaul.md`、`docs/plan/agent-merge-architecture.md`
- 外部仓库（已 clone 并逐文件读，非 README 概括）：`browser-use/video-use`（SKILL.md 322 行 + 6 helper）、`calesthio/OpenMontage`（schemas / pipeline_defs / skills）
- 产品文档：[ChatCut Docs — What is ChatCut](https://chatcut.io/docs/what-is-chatcut)、[Editor Overview](https://chatcut.io/docs/editor-overview)
- star / license / 活跃度：GitHub REST API 实测（2026-08-27）
