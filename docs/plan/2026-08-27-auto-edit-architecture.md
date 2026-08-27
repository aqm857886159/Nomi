# E2 前置：剪辑模块代码盘点 + 内部 Agent 接线方案

> 状态：📋 **方案待拍板** · 日期：2026-08-27 · 基线：`origin/main` @ `8f9365ae`
> **本文不是新方案。** 它是 [统一 Agent 总体方案](../superpowers/plans/2026-08-24-unified-agent-master-plan.md) §5.1「AI 剪辑三步」里 E2 明文要求的前置动作：
> > 「确切操作集——尤其时间维裁剪语义——**E2 动手前做代码盘点补录，不凭目录猜**」
> 沿用总纲词汇：**EditPlan / 剪辑计划卡 / E1 采纳桥 / E2 结构化粗剪 / E3 理解式剪辑**。不另造 EDL、propose_edit 等平行命名。
> **可信度**：仓库结论逐行读过给 `file:line`；外部结论标 URL + 抓取日期（2026-08-27）；star/license 用 GitHub API 实测。

---

## 0. 一页读懂

### 0.1 盘点结论：E2 的地基比总纲写的时候更完整，但有两处断点

总纲 §5.1 说 E2 靠「结构派生而非 AI 猜」——分镜计划里本就有时长/对白/字幕/转场。**这个前提成立**，而且比预期更好：**从分镜到时间轴的字幕、转场、幂等键，今天已经全线实现了**：

```
storyboardPlan.ts:180-182   渲染端 planner schema 声明 subtitle / dialogue / transition
  → :363-365                写进 planned node 的 metadata
  → applyCanvasToolCall.ts:308-312   透传成真实 canvas node 的 meta
  → adoptStoryboardBatch.ts:79       storyboardCaptionText 读 meta.subtitle ?? meta.dialogue
  → adoptStoryboardBatch.ts:88       transitionFromNode 读 meta.transition
  → :199-209 建 textClips ／ :217-229 建 transitions
  → :234-238 Proposal 幂等键（replay / stale / needs_attention）
  → applyAdoption 一次写定，一层撤销
```

E1 采纳桥不只完成了，连总纲要求的幂等键语义都在。**E2 不需要从零建管线。**

**两处真实断点**（都不是"没做"，是"做了一半"）：

| # | 断点 | 后果 | 证据 |
|---|---|---|---|
| **B1** | **两条分镜产出路径 schema 分叉**：渲染端 planner 声明了 subtitle/dialogue/transition；**内部 Agent 工具 `propose_storyboard_plan` 没有** | **用户在创作区拆镜 → 字幕转场自动就位；让内部 Agent 拆镜 → 永远没有字幕、没有转场**。同一个产品两种结果 | `storyboardPlan.ts:180-182` vs `canvasDescriptors.ts:81` |
| **B2** | **转场只写不渲染** | 授权了 dissolve，导出是硬切，**无任何警告**。而 `timelineSubtitleTransitionContract.ts:169` 还硬性要求「至少 2 个显式转场」——**校验通过 ≠ 渲染得出来** | `ffmpegFiltergraph.ts` 全文无 `xfade`／`acrossfade`（实扫 0 命中） |

**B1 正是「内部 Agent 做剪辑」这条线的第一块砖**：不修它，Agent 参与的每一条产线都天生缺字幕和转场，后面 E2/E3 做得再好也建在缺口上。

### 0.2 核心取舍

> 剪辑这件事上，是去和 ChatCut / Descript 拼「素材侧」（转录+选段，他们打磨两年），还是把**「我们知道这条片子为什么这么剪」**这件只有我们能做的事做到底？

判断：**两条都要，顺序不能反。** 意图直通是结构性护城河（ChatCut 拿到的永远是别人拍好的 mp4，没有上游意图）；转录/删静音是已商品化的通用能力，开源件成熟，随时能补——它对应总纲里的 **E3**，总纲自己也把它排在最后，理由一致（贵 + 依赖 E2 操作词汇表成熟）。**本文不改这个顺序。**

---

## 1. 代码盘点（E2 要的那份「操作词汇表」）

### 1.1 时间轴真实能力（EditPlan 的操作集只能从这里 derive）

`src/workbench/timeline/timelineEdit.ts`（505 行，31 导出）——手工剪辑的原子操作齐备：

| 能力 | 函数 | EditPlan 操作候选 |
|---|---|---|
| 定点插入 | `addClipAtFrame:77` | `place` |
| 移动（含合法位吸附） | `moveClipToLegalFrame:160` | `move` |
| 批量重排 | `applyClipStartFrames:296` | `reorder` |
| 删除 / 批量删除 | `removeClipById:179` / `removeClipsByIds:191` | `remove` |
| 播放头分割 | `splitClipAtFrame:311` | `split` |
| **两端裁剪** | `resizeClipEdge:409`（改 `offsetStart/EndFrame`） | `trim` ← **总纲点名要补录的「时间维裁剪语义」** |
| 复制 | `duplicateClipById:368` | `duplicate` |
| 微调 | `nudgeClipById:397` | （并入 move） |
| 取景 | `setClipFraming:465`（contain/cover + scale + offsetXY） | `reframe` |

**时间维裁剪语义（补录，这是总纲要的）**：`TimelineClip` 用 `offsetStartFrame` / `offsetEndFrame` 表示**从源两端各裁掉多少帧**，不是源内绝对位置。源窗口 = `[offsetStartFrame, frameCount - offsetEndFrame]`。
> ⚠️ 这里踩过一次真坑：曾把 `offsetEndFrame` 当成 `sourceEndFrame`，导致未裁剪 clip 得到 `sourceEnd=0 ≤ sourceStart=0`，manifest 校验拒收 → **整个导出静默回退成无声 WebM**（注释见 `renderManifest.ts` buildClip）。EditPlan 的 trim 操作必须沿用「裁掉多少」语义，不要换成绝对位置。

**文字轨**：`textClips[]` 独立于 media 轨，有 `caption | title` 两种 style、位置/缩放/字体（`timelineTypes.ts`）。**字幕不需要新机制。**

**装不下的**（EditPlan 不要发明这些操作）：任意图层数（固定 3 轨）、变速、每 clip 音量、关键帧曲线、音频 ducking。

### 1.2 采纳桥 = EditPlan 的落地通道（已建好，直接用）

`adoptStoryboardBatch.ts` 已经具备总纲对 EditPlan 的全部要求：整批一次写定（第 N 个失败不留半条轴）、**一层撤销**、Proposal 幂等键带 `replay / stale / needs_attention`、**先算完再查闸**（`assertCanApply` 在算完之后才取 baseRevision，因为 await 期间轴可能被别处动过）。

**结论：EditPlan 的 Apply 必须走这条桥，不要新写落轴路径**（P1 无并行版；也是总纲铁律「agent 不直接落轴」）。

### 1.3 导出链

`ffmpegFiltergraph.ts`：视觉链 `buildVisualGraph:259`（白底 base + 逐 clip scale→overlay + `enable` 时间窗）／音频链 `buildAudioGraph:192`（atrim→asetpts→adelay→amix+volume 补偿）／文字链 `buildTextOverlayGraph:339`（全画幅透明 PNG，**接最后一层**）。音频档位 `exportJobs.ts:169`：任一素材有音轨 → `aac/mixdown`。
**缺口只有 B2（转场）。** 其余三链都通。

### 1.4 生产流程：`assemble` 阶段已存在，只有一行

`productionPlaybooks.ts:33`：`brief→direction→script→storyboard→build→generate→qa→assemble→export`。
`assemble` 现在 = `productionRunDriverOps.ts:576-585` 起阶段 → 调 `production.arrange` → 存 timeline artifact → 完成；而 `production.arrange` = `capabilityApplyHandler.ts:543` 的一行 `arrangeStoryboardToTimeline()`。
**E2 就是把这个已存在的阶段填满，不新建管线。**

---

## 2. 内部 Agent 怎么用上这些工具（本轮补的正题）

> 以下接线事实由 Codex 独立读码复核（读 `harness/`、`agentChatV2*`、`applyCanvasToolCall`、pi 运行时与 4 份 pi 方案文档），逐条给了 file:line。**旧版本文这一节整段基于 2026-06 的 `agent-merge-architecture.md`，那份已 ⛔ 过期**（引擎已切 pi SDK），结论作废，此处重写。

### 2.1 工具组按 `capability` 选，不是按 skillKey

`electron/harness/agentChatPolicy.ts:35`：

```
creation-editor → 全部文稿工具        canvas-agent   → 全部画布工具
creation-chat   → read_full_text / read_selection / author_skill
canvas-refine   → 仅 set_node_prompt   storyboard    → read_canvas_state + propose_storyboard_plan
其余（含 single-shot）→ 空工具集
```

配套作用域守卫 `agentToolIsInScope:46`（主进程按 capability 校验工具名；`canvas-refine` 另校验 nodeId 必须在选中集内）。步数上限 `agentChatV2.ts:102`：`storyboard`=24、其余=8、`single-shot`=1 且零工具。

> ⚠️ **Skill 只提供方法，不授予工具权限**——换个 Skill 名字不能扩权（pi 方案原话）。

### 2.2 新增剪辑工具组要动的完整接线

| 跳 | 动作 | 位置 |
|---|---|---|
| 1 | 建 `timelineDescriptors.ts`（Zod 参数 + 唯一工具说明，与 canvas/document 并列） | `electron/harness/tools/` |
| 2 | **新增 capability** 并挂工具（这一跳旧版漏了） | `agentChatPolicy.ts:35` `agentToolsForCapability` |
| 3 | 作用域守卫补分支（剪辑工具要校验目标 clip/range 在冻结目标内） | `agentChatPolicy.ts:46` |
| 4 | 步数档位 | `agentChatV2.ts:102` |
| 5 | **建 timeline 领域 gate**（见下） | 渲染端 |
| 6 | 渲染端执行器 → 汇流采纳桥 | `src/workbench/timeline/` → `adoption/` |

**capability 分两档**（对齐 §5.1「agent 不直接落轴」）：

- **`timeline-planner`**（只读 + 产提案）：`read_timeline` / `inspect_timeline_range` / `propose_edit_plan`。多步工具循环，语义对齐现有 `storyboard`——**不是 `single-shot`**（single-shot 零工具，装不下）。
- **`timeline-editor`**（可写）：`apply_edit_plan` / `set_transitions` / `generate_captions` / `place_music`。

### 2.3 审批：`gate.ts` 不能直接复用

`generationCanvas/agent/gate.ts:43` 的 `writes: true` 表**是画布专用的**——未登记的 timeline 工具会被**直接 deny**。必须建 timeline 领域 gate（或受控泛化），**不能拿 `agentChatPolicy` 当审批替代品**（它管的是作用域，不是用户确认）。

另：**破坏性二次确认今天不存在**——`destructive: true` 没有任何二次确认分支。「覆盖已有剪辑必须二次确认 + 必须给 reason」是**待实现需求**，要在 descriptor 把 `reason` 设为必填、并在 renderer gate/卡片和最终提交边界各落实一次。

### 2.4 渲染端执行、主进程只回喂

pi 运行时契约：**renderer 已执行的工具结果只回喂模型，主进程不得再执行一次**。所以剪辑工具的真实 execute 必须写在渲染端（时间轴 store 和采纳桥都在那边），主进程只做参数 Zod 解析 + 作用域校验 + 结果转发。这与画布工具同构。

### 2.5 MCP 对外：两套入口合同，一套领域实现

现状范式（`applyCanvasToolCall.ts:595` 与 `capabilityApplyHandler.ts:543` 各自入口，最终都调 `sendStoryboardToTimeline.ts:77`）：**共享点在领域函数，不在 schema 层。**

剪辑开放给外部 agent 时需要各自补：内部走 §2.2；外部走**顶层 `mcpToolCatalog.ts:12`**（不是 `mcpGenerationTools.ts`——那是生成语义子目录）、补 `READ_ONLY_TOOLS` 标注、dispatcher、外部授权、renderer bridge operation。`tools/list` 广播的 JSON Schema 同时是唯一运行时校验边界（`mcpProtocol.ts:445`）。

### 2.6 预览区：接 R2-U1 共同宿主，不是第三个面板

**旧版本文提的「给 `PreviewWorkspace` 传 `aiSidebar`」是错的**，且被 pi 方案点名否掉：

> 创作/生成的会话键、活动历史和面板消息各自分区，**预览没有 Agent；这不是只移动 JSX 就能解决的外观问题** —— `2026-08-26-pi-agent-loop-file-migration.md:51`

事实：`agentSessionKey.ts:3` 只有 `creation | generation` 两个 area、**两份独立历史**（R1 过渡边界）；**跨区记忆并未打通**（旧版本文说「已打通」是假的）。R2-U1 的范围表（`:287`）已经写明预览接**共同宿主**、且「**不虚构 E2 尚未实现的剪辑工具**」；验收用例（`:395`）更直接写着「从创作发指令…**再到预览继续**」。

**结论**：再加第三个 owner / 第三份历史 = 正好在造 R2-U1 要拆的债。
**分工**：剪辑 capability + renderer 执行器可以**先独立建**（不依赖 R2-U1）；**预览的 Agent 呈现面等 R2-U1 共同宿主**，届时作为一个视图投影接入。不新增 `WorkbenchAgentArea='preview'`、不新增 preview sessionKey / history store。

### 2.7 @ 引用不只是注 prompt

选中 clip/时间段要作为 **typed request 目标冻结**在请求里，主进程 `agentToolIsInScope` 校验，渲染端提交前**复验 timeline revision**。否则用户切了选区，在途任务会改到新目标上。

---

## 3. 顶尖对账（外部实调 2026-08-27）

### 3.1 商业产品

| 产品 | 核心机制 | 交互 | 剪完留下什么 | 对我们的价值 |
|---|---|---|---|---|
| **ChatCut** | 自动转录（100+ 语言）、分说话人、**词→帧映射**；Agent 分析每条 clip→找高光→去重复 take/口癖→排序→上字幕/B-roll/音乐 | Viewer + AI 面板 + 下方时间轴；**@ 引用** timeline item/asset/viewer 区域/转录稿文字；Agent ／ Video Gen 双模；有 **Skills & Design Styles** | **"a real, editable timeline"**（明说不是黑盒）；导出含 **XML（Premiere/DaVinci）** | @ 引用、Skills、留真轴——我们分别已有雏形 |
| **Descript** | 文本即视频；去口癖/停顿、Studio Sound | 文档式 | 轴 + XML | E3 对标 |
| **Premiere（Sensei）** | Scene Edit Detection 自动打切点（实测 47/49） | 传统 NLE | 工程 | E3 的场景切分 |
| **可灵/即梦/Higgsfield/Vidu/海螺** | **全在生成侧发力，剪辑侧几乎空白** | — | — | **「生成完→成片」是无人区** |

> 画布 + 时间轴同在一个 app，是我们唯一能吃下这段的结构性优势。

### 3.2 开源（GitHub API 实测）

| 仓库 | ★ | License | 最近 push | 可复用什么 |
|---|---:|---|---|---|
| [OpenCut](https://github.com/OpenCut-app/OpenCut) | 87,085 | MIT | 2026-08-10 | ⚠️ **仓库刚重写**（tree 仅 151 文件、changelog 停在 0.3.0、桌面端改 Rust），星多但当下不是可抄的成熟库，先观察 |
| [OpenMontage](https://github.com/calesthio/OpenMontage) | 51,769 | **AGPL-3.0** | 2026-08-22 | `edit_decisions.schema.json` 可当 EditPlan 字段参照；**与 Nomi 同 License，借鉴无法务风险** |
| [video-use](https://github.com/browser-use/video-use) | 21,420 | MIT | 2026-08-26 | ✅✅ 见下 |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | 14,424 | Apache-2.0 | 2026-08-25 | **E3 转录的直接答案**：有 JS API 可在 Electron 跑，SenseVoice 中/粤/英/日/韩 + CTC 时间戳 |
| [auto-editor](https://github.com/WyattBlue/auto-editor) | 5,081 | Unlicense | 2026-08-25 | 静音检测算法 + 多 NLE EDL 导出格式 |
| [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | 5,124 | BSD-3 | 2026-08-24 | 镜头边界检测算法 |
| [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | 1,965 | Apache-2.0 | 2026-08-07 | ◐ 抄语义不抄依赖（JS binding 仍 WIP、未发 npm） |

**video-use 值得抄的四条**（★21.4k，整个"产品"= 1 个 322 行 SKILL.md + 6 个 py 脚本，引擎就是 Claude Code 本身）：

1. **唯一值得存在的派生物是「打包转录稿」**——词级 JSON 按「静音≥0.5s 或换说话人」断句成带 `[start-end]` 的 markdown，**token 只有原始 JSON 的 1/10**。其余（口癖标注、重复 take、镜头分类、打分）**全部决策时现推，不预计算**。
2. **文字为主、视觉按需**——唯一视觉下钻工具给 `[start,end]` 出「胶片条+波形+词标签」合成 PNG，文档明写 **"Not a scan tool"**。→ 直接回答「给 LLM 看视频太贵」：大部分决策靠文本，只在犹豫处看一眼。这条给 §2.2 的 `inspect_timeline_range` 定了性。
3. **硬规则 vs 艺术自由分离**——硬规则只收「会导致**静默失败**」的（字幕必须最后一层、逐段抽取+无损 concat、每段边界 30ms 音频淡入淡出防爆音、overlay 必须 PTS 位移、**绝不切在词中间**、切边留 30–200ms padding）。
4. **自审环**——对**输出文件**在每个切点 ±1.5s 逐张检查（跳切/爆音/字幕被盖/overlay 错帧），**最多 3 轮**，超了诚实上报而不是死循环。→ 与我们 `production.verify-shots`（`capabilityApplyHandler.ts:554`）同构，可复用。

> video-use 的 anti-pattern 第二条值得抄进 E2 的设计约束：**"Hand-tuned moment-scoring functions. The LLM picks better than any heuristic you'll write."** —— EditPlan 不要预计算打分矩阵。

### 3.3 学术（近 6 月）

[AutoCut（CVPR 2026）](https://arxiv.org/html/2603.28366)：视频选择/排序/脚本/**BGM 选择**四任务同底座 → 支持「一份 EditPlan 一次性覆盖」。
[Long Videos → Engaging Clips](https://arxiv.org/pdf/2507.02790)：镜头切分→叙事理解→选段排序→组装，中间产物是叙事图 → 支持 beat 化。
[BEAT](https://arxiv.org/pdf/2605.27067)：节拍驱动剪辑点且**弹性对齐**（不硬卡拍）→ 配乐节奏参照。

---

## 4. build-vs-buy 闸（R20）

| 能力 | 通用？ | 现成方案（实查） | 决定 |
|---|---|---|---|
| 时间轴交换格式 | 是 | OTIO（JS binding **WIP、未发 npm**） | **对齐语义，不取依赖**；后续加 `.otio` 导出 |
| 渲染引擎 | 是 | **Remotion** —— [License FAQ](https://www.remotion.dev/docs/license/faq) 明确 source-available、按公司规模收费、**与 AGPL 不兼容**；Nomi 是 `AGPL-3.0-only` | **继续 ffmpeg，不引入 Remotion**（法务硬边界，非偏好） |
| 转录 ASR（E3） | 是 | sherpa-onnx（Apache-2.0，JS API 可在 Electron 跑，中文可用） | **用它，本地优先**——顺带比 ChatCut 强一条：**素材不出机器** |
| 静音检测 | 是 | auto-editor（Unlicense） | **抄算法不引依赖**（它是 Nim） |
| 镜头边界检测 | 是 | PySceneDetect（BSD-3） | **抄算法**；v0 先用 ffmpeg `select='gt(scene,0.4)'` |
| **剪辑决策（选片/排序/节奏/配乐）** | **否** | — | **自研** = 护城河；且 video-use 已证明手写打分不如让 LLM 直接选 |
| **意图直通** | **否** | — | **自研**，结构上对手抄不动 |

---

## 5. 切片

> 每片独立 commit / 独立可回滚 / 独立过五门。E1 已完成，故从修断点开始。

| # | 切片 | 内容 | 量级 | 为什么在这个位置 |
|---|---|---|---|---|
| **S0** | **修 B2 + 门岗** | `xfade`/`acrossfade` 渲染；未实现类型（match_cut/whip_pan）**诚实降级为硬切并写进导出诊断**；新增 `check:render-coverage` 棘轮——扫 `TimelineTransitionType` 每个枚举值，要么有实现要么在显式降级白名单里，新增枚举不登记即红 | 中 | **它是 bug 不是 feature**，且挡着 E2 的「转场应用」 |
| **S1** | **修 B1（内部 Agent 意图对齐）** | `canvasDescriptors.ts` 的 `storyboardShotSchema` 补 `subtitle` / `dialogue` / `transition` 三个 **optional** 字段，与 `storyboardPlan.ts:180-182` 对齐；补一个**两份 schema 字段一致性**的断言测试防再分叉 | 小 | **最大的免费午餐**：链路下游全通，只差 schema 声明。做完 Agent 拆的镜头当场就有字幕转场，零 LLM 额外成本 |
| **S2** | **EditPlan 契约 + 剪辑计划卡** | `editPlanTypes.ts`（操作词汇表从 §1.1 derive）+ 纯函数投影 + 复用采纳桥 Apply + 幂等键；对话里渲染剪辑计划卡（动几条/改哪里/可撤销） | 中 | 总纲 §5.1 的核心对象 |
| **S3** | **剪辑工具组接内部 Agent** | 按 §2.2 六跳：descriptors → `timeline-planner`/`timeline-editor` capability → 作用域守卫 → 步数档 → **timeline 领域 gate**（含破坏性二次确认 + 必填 reason）→ 渲染端执行器汇流采纳桥 | 大 | 本文正题 |
| **S4** | **E2 结构化粗剪** | 按计划排列+时长对齐、对白→字幕轨、音乐垫底、转场应用、实拍素材混排 → 产出「能看、有字幕、有音乐的粗剪」 | 大 | 总纲 Pack v1 剪辑段 |
| **S5** | **MCP 对外开口** | 顶层 `mcpToolCatalog.ts` + READ_ONLY 标注 + dispatcher + 外部授权 + renderer bridge | 中 | 与内部共享领域层，不共享权限链 |
| **S6** | **E3 理解式剪辑** | sherpa-onnx 转录 + 打包转录稿 + 切点词边界护栏 + 删静音/口癖 + 审片给节奏建议 | 大 | 总纲明确排最后（贵 + 依赖 E2 词汇表成熟） |
| **S7** | 专业出口 | `.otio` / FCPXML 导出 | 中 | 「我们不锁你」的信号 |

**预览区 Agent 呈现面不在本表**——它属于 R2-U1 共同宿主，见 §2.6。

---

## 6. 范围 / 不动项 / 回滚 / 验收门（R4）

**新技术栈**：只有 S6 的 `sherpa-onnx`（Electron 原生模块）——**引入前按 R5 先过官方文档实查 + 三平台二进制体积评估**，本文只做选型判断，不算已拍板。

**不动项**：
1. 不改 `TimelineState` 语义（只补 optional 字段），不搞第二个时间轴真相源（P1）；
2. 不引入 Remotion 或第二渲染器（AGPL 冲突）；
3. 不做任意图层数 / 关键帧曲线（剪辑师专业件；总纲边界也写着「不做通用 NLE 竞品，剪映在那，不拼也不该拼」）；
4. 不动生成画布 renderer（R21 单内核）；
5. 不动 `productionRun` 阶段机与门语义，只把 `assemble` 填满；
6. **不新增 `WorkbenchAgentArea='preview'` / preview sessionKey / 第三份历史**（§2.6）；
7. 不新增设计 token。

**回滚**：S0 关 xfade 分支即回；S1 三字段 optional，删字段即回；S2 EditPlan 是旁路制品，不投影即无影响；S3 摘掉 capability 即回；S5 从 catalog 摘掉即回。

**验收门**：
1. 五门全过 + 新增 `check:render-coverage` + 两份 storyboard schema 一致性测试；
2. 单测：EditPlan 往返幂等、投影纯函数、转场逐类型渲染断言、trim 语义（`offsetEnd` 不得被当作绝对位置）、作用域守卫拒绝越界目标；
3. **P3 真机走查**：起真 Electron 跑「Agent 拆镜 → 生成 → 剪辑计划卡 → Apply → 预览 → Undo 复原」，**截图自己亲眼 Read 过**；
4. **R16 真实任务**：至少 3 条（① 15 镜短剧自动成片 ② 一半上传素材+一半 AI 镜头的 **J-混剪**，断言 agent 未直接写时间轴 ③ 已剪好的片让 Agent「节奏调快 20%」），过程中冒出的体验/产品问题**全修掉**；
5. UI 部分与 mockup 逐项对账（R8）。

---

## 7. 做完之后我们站在哪

| 维度 | ChatCut | Descript | Premiere AI | OpenMontage | video-use | **Nomi（S0–S6 后）** |
|---|---|---|---|---|---|---|
| 转录稿剪辑 | ✅ | ✅✅ | ◐ | ◐ | ✅ | ✅ S6（**且本地不出机器**） |
| 自动删静音/口癖 | ✅ | ✅ | ◐ | ◐ | ✅ | ✅ S6 |
| 场景切分 | ✅ | — | ✅✅ | ✅ | — | ✅ S6 |
| 对话式剪辑 Agent | ✅✅ | ◐ | ◐ | ✅ | ✅✅ | ✅ S3/S4 |
| @ 引用上下文 | ✅✅ | — | — | — | ◐ | ✅ S3（带目标冻结+revision 复验）|
| 剪完留真时间轴 | ✅ | ✅ | ✅ | ◐ | ❌（直出 mp4） | ✅ **已有，且一层撤销** |
| 生成+剪辑同一 app | ✅ | ❌ | ◐ | ✅ | ❌ | ✅ **已有** |
| **上游意图直通剪辑** | ❌ | ❌ | ❌ | ◐ | ❌ | ✅✅ **S1 —— 唯一** |
| 本地优先/素材不上云 | ❌ | ❌ | ◐ | ◐ | ❌ | ✅✅ **已有定位** |
| 外部 agent 可驱动（MCP） | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ S5 |
| 导出到专业 NLE | ✅ XML | ✅ XML | 原生 | ◐ | ❌ | ✅ S7 |
| 多图层/关键帧曲线 | ✅ | ◐ | ✅✅ | ✅ | ◐ | ❌ **主动不做** |

**一句话**：S0–S6 做完，入场券（对话式剪辑 / 转录稿剪辑 / 留真轴）与 ChatCut 平齐；**上游意图直通、本地优先、生成剪辑同栈、外部 agent 可驱动**四条是唯一。放弃多图层/关键帧曲线是主动取舍。

---

## 8. 待拍板

| # | 决策点 | 我的推荐 |
|---|---|---|
| ① | **S1 先行**（修 B1，补三个 optional 字段）能不能直接开工？ | **能**——纯 schema 对齐、下游全通、零 LLM 成本、可单字段回滚。这是整份方案里性价比最高的一刀 |
| ② | 剪辑 capability 分 `timeline-planner` / `timeline-editor` 两档，是否认可？ | **认可**——对齐「agent 不直接落轴」铁律，只读档可放宽确认 |
| ③ | S6 引 sherpa-onnx（原生模块，影响打包体积与三平台产物） | **引**，但先按 R5 做官方文档实查 + 体积评估再拍 |
| ④ | 预览区 Agent 呈现面等 R2-U1，本轮不做 | **是**——否则在造马上要拆的债 |

---

## 附：本轮一手材料

- 仓库内既有方案（已接上）：[统一 Agent 总体方案 §5.1](../superpowers/plans/2026-08-24-unified-agent-master-plan.md)、[pi R1 运行核切换](2026-08-26-pi-r1-runtime-cutover.md)、[pi 逐文件迁移 §7 R2-U1](2026-08-26-pi-agent-loop-file-migration.md)、[短剧管线调研](../research/2026-08-19-short-drama-pipelines.md)、[剧本→视频框架调研](../research/2026-08-19-script-to-video-frameworks.md)
- 外部仓库（已 clone 逐文件读，非 README 概括）：`browser-use/video-use`、`calesthio/OpenMontage`
- 产品文档：[ChatCut — What is ChatCut](https://chatcut.io/docs/what-is-chatcut)、[Editor Overview](https://chatcut.io/docs/editor-overview)
- star/license/活跃度：GitHub REST API 实测 2026-08-27
- pi 接线事实：Codex 独立读码复核（7 处旧结论作废，见 §2 开头）
