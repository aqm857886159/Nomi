# AI 剪辑开源版图调研 → Nomi 差距与方案

> 日期：2026-09-09 · 调研方式：GitHub 搜索（AI video editing / AI 剪辑 / video editing agent LLM / auto cut silence）+ 头部仓库 README 逐个实读
> Nomi 现状锚点：`docs/ARCHITECTURE-NOW.md`（时间轴/导出/agent 媒体工具三行）+ `docs/superpowers/plans/2026-08-24-unified-agent-master-plan.md` §5.1（E1/E2/E3 自动剪辑总纲）
> 关联文档：[AdCraft 完整对比与方案](../product/2026-09-09-adcraft-vs-nomi-full-comparison-and-plan.md)

---

## 一、版图：谁在做什么（按与 Nomi 剪辑的贴近度排）

| 仓库 | Stars | 一句话 | AI 剪辑核心机制 |
|---|---|---|---|
| [harry0703/MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) | 121.6k | 一键生成高清短视频 | 文案→素材匹配→TTS→字幕→BGM→合成，全自动管线，批量出片 |
| [krillinai/OpenCreator](https://github.com/krillinai/OpenCreator)（原 KrillinAI） | 11.4k | 开源 AI 创作工作台 | **直接复用 Codex CLI 做 agent 引擎**（不自研 loop）+ 本地 Runtime + 可视化工作区；可视化↔对话双模式共享同一状态机；每次修改产生新版本可回看对比；三层 memory |
| [linyqh/NarratoAI](https://github.com/linyqh/NarratoAI) | 11.0k | AI 解说+一键剪辑 | 影视解说赛道：文案→TTS→字幕→时间轴自动对齐剪辑 |
| [zhouxiaoka/autoclip](https://github.com/zhouxiaoka/autoclip) | 7.3k | 高光提取剪辑 | 二创向：长视频→高光片段自动提取 |
| [RayVentura/ShortGPT](https://github.com/RayVentura/ShortGPT) | 7.9k | 自动化短视频框架 | 脚本→素材→配音→自动编排（Python 框架，自动化概念输出方） |
| [modelscope/FunClip](https://github.com/modelscope/FunClip) | 6.2k | 说话/选段式剪辑 | **FunASR Paraformer 本地 ASR（精确时间戳）+ SeACo 热词 + CAM++ 说话人识别** → 选文本段/说话人→剪出对应片段；LLM 自然语言选段；全视频+目标段 SRT；完全本地 |
| [WyattBlue/auto-editor](https://github.com/WyattBlue/auto-editor) | 5.2k | 自动剪切 CLI（Nim） | 响度/运动阈值分析自动剪切：`--edit audio:0.03 motion:0.06` 表达式可组合、`--margin` 留呼吸padding；**已提供 `npx skills add` 给 agent 调用** |
| [FireRedTeam/FireRed-OpenStoryline](https://github.com/FireRedTeam/FireRed-OpenStoryline)（小红书） | 3.4k | 对话式视频创作 agent | **ASR 口播粗剪**（自动去口水词/重复句/不流畅，时间戳对齐，2026-03）；**AI 转场生成**（前镜尾帧+后镜首帧+NL 描述→生成转场镜头，2026-04）；BGM 推荐+**卡点 beat-sync**；few-shot 风格迁移（参考文本复刻语气节奏）；**剪辑工作流存档成 Skill，换媒体即批量复刻风格**；全 NL 剪辑（切/换/重排/调色/字体/位置） |
| [YILS-LIN/short-video-factory](https://github.com/YILS-LIN/short-video-factory) | 5.3k | 产品营销短视频批量 | 桌面端批量自动剪辑 |
| [Geniusay/ChopperBot](https://github.com/Geniusay/ChopperBot) | 2.8k | 直播切片机器人 | 直播流→智能切片→标题/封面/简介→自动发布 |
| [jd-opensource/JoyAI-Video-Edit](https://github.com/jd-opensource/JoyAI-Video-Edit) | 1.8k | 京东实时开放式剪辑 | 自回归实时视频编辑（研究向） |
| [x007xyz/flycut-caption](https://github.com/x007xyz/flycut-caption) | 1.8k | 字幕编辑 React 组件 | ASR+字幕编辑组件化 |

**结构性观察**：这条赛道分三代——① 全自动管线代（MoneyPrinterTurbo/NarratoAI/ShortGPT：无交互，一键出片）；② 本地能力代（FunClip/auto-editor：单点能力锋利，无创作上下文）；③ **agent 原生代（OpenCreator/FireRed-OpenStoryline：对话驱动 + 真实时间轴 + 版本化 + Skill 存档）**。第三代与我们正面对位，且两家都已把「ASR 理解」作为剪辑 agent 的地基能力。

## 二、Nomi 现状（锚点）

已有：三轨时间轴（image/video/audio + textClips + transitions）、clip 音频参数进导出、FFmpeg filtergraph（视觉/音频/文字三链 + dissolve/fade 转场 + mixdown + 导出验证回执）、agent 媒体工具组（`get_media`/`inspect_media`/`inspect_source_range`/`read_waveform`/`export_timeline`，receipt-level）、采纳桥 E1（分镜→时间轴整批落轴带幂等）。

明确没有（`ARCHITECTURE-NOW.md:53-58` 原文级事实）：**transcript/ASR（「语义镜头理解和 transcript 仍未实现」）**、语义选段、静音/口水词剪切、BGM 卡点、AI 转场、音频 acrossfade（固定 audio 轨禁 overlap）、match_cut/whip_pan（warning 后硬切）。

已有但散落的种子：#259 拆解引擎已用 whisper 转写归属到镜头；E2 结构化粗剪/E3 理解式剪辑已有已批准总纲（EditPlan + 剪辑计划卡为核心对象）。

## 三、差距（按痛感排）

| # | 差距 | 对手证据 | 痛点场景 |
|---|---|---|---|
| G1 | **无 ASR/transcript 层**——所有理解式剪辑的地基 | FunClip（Paraformer+热词+说话人）、FireRed（ASR 粗剪）、flycut | 口播/解说/访谈类用户想剪，agent 却「听不见」视频内容；`inspect_media` 只有技术元数据 |
| G2 | **无口播粗剪**——去静音/口水词/重复句一键成片 | FireRed ASR 粗剪 skill、auto-editor（audio/motion 阈值可组合+margin） | 口播创作者最高频刚需；手工剪 dead space 是「boring task」（auto-editor 原话） |
| G3 | **无语义选段**——自然语言→时间段→落轴 | FunClip LLM 选段 | 「把提到价格的三段剪出来」做不到 |
| G4 | **无版本化**——重生成/重剪覆盖，不可回看对比 | OpenCreator「每次修改新版本」 | 与 AdCraft 对照文档 G5 同根 |
| G5 | **无 BGM 智能化**——推荐/卡点/结构对齐 | FireRed BGM 推荐+beat-sync；AdCraft bgm_direction（文字方向+纯音乐源） | 配乐全靠手挑手对齐 |
| G6 | **无 AI 转场**——只有 dissolve/fade 两个滤镜转场，无生成式转场 | FireRed 首尾帧+NL→生成转场镜头；我们 match_cut 还是 warning 硬切 | 生成的镜头之间转场生硬 |
| G7 | **无剪辑技能存档**——剪辑工作流不可复用批量 | FireRed Editing Skill Archiving | 同款风格批量出片靠手工重复 |
| G8 | **无一键成片管线**（对不用 agent 的用户） | MoneyPrinterTurbo 一键、NarratoAI 一键 | productionRun 要 agent 推，纯小白没有「一键」入口 |

**Nomi 反超点**（他们没有的）：生成侧一体（转场生成/粗剪补镜头直接落画布节点再生成，FireRed 也刚做 AI 转场但没有我们的参考槽/生成画布深度）、MCP 被 agent 调用（auto-editor 刚加 `npx skills add`，方向验证我们）、真实桌面时间轴交互（FunClip/Gradio 级别不可比）、素材库+角色一致性体系。

## 四、方案（I–M，接 E1/E2/E3 总纲，不另起炉灶）

> ⚠️ **2026-09-09 更新**：本节 I–M 已被更完整的施工图取代/深化——agent 原生剪辑的完整可执行方案见 [2026-09-09-agent-native-editing-plan](../plan/2026-09-09-agent-native-editing-plan.md)（含时间轴写入契约修法、transcript 层接口设计、文本式剪辑、验证环、节拍 planner），ChatCut/OpenChatCut/Pireel 深挖见 [agent 原生剪辑版图调研](2026-09-09-agent-native-video-editing-landscape.md)。本节保留作首轮版图结论。

> 总纲既有：E1 采纳桥（已实现）→ E2 结构化粗剪（EditPlan+剪辑计划卡）→ E3 理解式剪辑。本组方案是 E2/E3 的**能力补给**，全部落进既有总纲对象模型。

### 方案 I【P0·E 线地基】本地 ASR/transcript 层
- **做什么**：接本地 whisper.cpp（#259 拆解引擎已在用 whisper，复用同一运行时依赖）产出 `transcript` 资产：带时间戳的句级文本 + 说话人段（说话人识别 v2 可用 FunASR CAM++ 模式做本地能力升级）；transcript 进素材库、按源视频节点挂载；新增 agent 工具 `read_transcript`（与 `read_waveform` 同级，receipt/白名单元数据纪律不变）。
- **落点**：`electron/video/`（#259 同族）、`electron/harness/tools/timelineDescriptors.ts`、素材库 schema。
- **隐私红线**：本地推理默认，外部 ASR 供应商仅显式选择时启用（沿用资产上传 honesty 模式）。
- **验收门**：一条 10 分钟口播视频→transcript 落库→`read_transcript` 返回句级时间戳→走查 R13；拆解引擎与 transcript 共享同一 whisper 运行时（P1 不引第二套）。

### 方案 J【P0·E2 首刀】口播粗剪 = ASR 粗剪 EditPlan
- **做什么**：E2 的第一个真实场景：① 静音段剪切（auto-editor `audio:threshold` + `margin` 呼吸 padding 语义）；② 口水词/重复句剪切（FireRed 范式：transcript 上匹配填充词表+LLM 判重复）；产出**EditPlan + 剪辑计划卡**（总纲 §5.1 对象），走 E1 采纳桥整批落轴、一个 Cmd+Z、可逐条拒绝。
- **落点**：`src/workbench/timeline/`（EditPlan 消费端=采纳桥模式复用 `adoptStoryboardBatch` 结构）、`electron/` ASR 服务。
- **验收门**：真实 15 分钟口播→粗剪→成片时长缩 30%+、无口型断裂感（人眼走查）、计划卡逐条可拒绝重跑（R16）。

### 方案 K【P1·E3 首刀】语义选段工具
- **做什么**：agent 工具 `search_transcript(query) → 时间段候选` + `propose_edit_plan(segments)`；FunClip 范式「选文本段→剪片段」搬进 lane 工具组（capability `canvas-agent`），选段结果落时间轴走同一采纳桥。
- **依赖**：方案 I。
- **验收门**：「把提到价格的三段剪出来」真实任务 E2E 通过。

### 方案 L【P1】BGM 卡点 + AI 转场（两个生成侧联动刀）
- **做什么**：① BGM：接纯音乐源（AdCraft 同款供应商类型：火山纯音乐/天谱乐；我们已有供应商接入框架），先做「结构对齐」——BGM 淡入淡出点对齐镜头切点（`clipAudio.ts` 的 fade 已进导出，纯时间轴计算，无需 AI），推荐 v2 再上；② AI 转场：相邻片段尾帧+首帧+NL 描述 → 落画布生成节点出转场镜头 → 自动插回时间轴（FireRed 2026-04 同款，但我们有生成画布+参考槽，转场镜头可带风格一致性）。
- **验收门**：8 镜成片 BGM 淡出对齐结尾切点；一段 AI 转场镜头生成并插轴真实走查。

### 方案 M【P2】版本化 + 剪辑技能存档
- ① 版本化：对齐 OpenCreator「每次修改新版本」，与 AdCraft 对照文档方案 F 合并实施（同一套 lineage/候选语义覆盖生成与剪辑）。
- ② 剪辑技能存档：把一次成功的 EditPlan 序列（节奏模式/字幕样式/BGM 结构）参数化存成 Skill Pack，换素材批量复刻（FireRed 范式）——正好是方案 G（广告预设流）在剪辑侧的孪生。

## 五、排序与依赖

```
方案 I（ASR 地基）─┬─→ 方案 J（口播粗剪，E2 首刀）─→ 方案 K（语义选段，E3 首刀）
                   └─→ （复用同一 whisper 运行时，服务拆解引擎）
方案 L（BGM 卡点+AI 转场）   方案 M（版本化→并入 AdCraft 方案 F；技能存档→并入方案 G）
```

| 批次 | 内容 | 说明 |
|---|---|---|
| 第一批 | I + J | 一套本地 ASR 同时喂拆解引擎和粗剪，一次投入两处回报 |
| 第二批 | K + L | E3 开张 + 两个生成侧联动功能 |
| 第三批 | M | 依赖 AdCraft 线方案 F/G 的语义先落 |

**取舍声明**：不做直播切片/高光赛道（ChopperBot/autoclip 领域，非 Nomi 用户任务）；不做实时自回归编辑（JoyAI 研究向）；不引 Remotion/PySceneDetect（总纲既定：已有 ffmpeg+时间轴+抽帧）。

## 附：证据来源

- GitHub Search API：`AI video editing` / `AI 剪辑` / `video editing agent LLM` / `auto cut silence video`（2026-09-09，star 数当日实取）
- README 实读：FireRed-OpenStoryline（NEWS 时间线：ASR 粗剪 2026-03-22、AI 转场 2026-04-02、OpenClaw/Claude Code Skills）、OpenCreator（Codex 原生/双模式状态机/版本化/三层 memory）、FunClip（Paraformer/SeACo/CAM++/LLM 选段）、auto-editor（`--edit` 表达式/`--margin`/`npx skills add`）
- Nomi 现状：`docs/ARCHITECTURE-NOW.md:53-58`、`docs/plan/2026-06-25-audio-first-class-timeline.md`、`docs/superpowers/plans/2026-08-24-unified-agent-master-plan.md` §5.1、`docs/plan/2026-09-01-video-deconstruction-v1.md`（whisper 已在拆解引擎中）
