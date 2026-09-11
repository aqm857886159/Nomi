# Nomi 剪辑栈底层架构分析 + 方案

> 日期：2026-09-09 · 方法：逐层读 owner 文件（`src/workbench/timeline/`、`electron/export/`、`src/workbench/timeline/kernel/`、`electron/agentLane/`、`electron/shared/agentCapabilities/`）
> 定位：回答两个问题——**我们的剪辑栈底层到底长什么样、强在哪弱在哪**；**agent 架构与它的接缝在哪里、下一步往哪落**。
> 关联：[agent 原生剪辑方案](../plan/2026-09-09-agent-native-editing-plan.md)（本文 §4 修正其方案 A' 落点）、[主报告](../product/2026-09-09-nomi-competitive-master-report.md)

---

## 一、七层架构图（自底向上，全部带 owner 锚点）

```
L7 UI 层            TimelinePanel/TimelineTrack/TimelineClip 组件、React Flow 生成画布
L6 agent 运行时      pi 0.85.1 AgentHarness（agentLane/）· capability 工具组（agentChatPolicy）
                    · productionRun 引擎 · 对外 MCP（capabilityCore/mcpToolCatalog）
L5 agent 契约层      shared/agentCapabilities/：capability+aliases(pi/mcp 双通道)
                    · flatModelInput 容忍器 · typed 契约+示例+副作用声明 · 作用域守卫
L4 导出层           electron/export/：exportPlanner → exportManifest → ffmpegFiltergraph
                    → ffmpegCommandBuilder → jobManager/store/IPC → exportAuditManifest
L3 预览渲染层       预览与导出共用同一帧级 resolver（转场 blend/文字 overlay/波形解码）
L2 确定性内核 ★     timeline/kernel/timelineKernel.ts：10 种操作 + CAS revision + diff + validate
L1 时间轴数据模型    timelineTypes.ts：3 轨 + textClips + transitions；clipAudio/clipFraming/
                    overlayTransform 为 typed 值对象（非散落字段）
L0 媒体原语层       ffmpeg/ffprobe（ensureExecutable）· mediaProbe · extractAudioTrack ·
                    detectShotCuts · extractVideoFrame · deconstructVideo（whisper）
```

**★ L2 是本分析最重要的发现**：`timelineKernel.ts` 提供 `TimelineOperation`（move/remove/split/trim/source-window/ripple/transition/text×4/clip-audio，`timelineKernel.ts:12-86`）、`applyTimelineOperations`（事务批量）、`diffTimelines`、`validateTimeline`、**`timelineRevision` CAS 乐观锁**（`:690`，stale_revision 诊断 `:731`）。agent 写入目标 `timelineCapabilityTarget.ts:167/278` 已消费内核并带 `expectedRevision`；`timelinePlanPreview.ts` 支持先 apply 预览。

## 二、逐层评估（现状 / 强 / 弱）

### L0 媒体原语层
- **现状**：本地 ffmpeg 打包（`ensureExecutable.ts`）；`mediaProbe`（元数据）；`detectShotCuts`（场景切点，本地零成本）；`extractAudioTrack` → whisper verbose_json（#259）；`extractVideoFrame`；`deconstructVideo` 编排。
- **强**：零外部依赖的本地媒体能力；切点/抽帧/取音轨三原语齐备。
- **弱**：**没有转写/理解的服务层 owner**——whisper 藏在拆解引擎内部，其它消费者（agent 工具、粗剪）无法复用；无响度分析（LUFS）、无节拍检测。
- **判定**：原语够用，缺「理解子层」。

### L1 时间轴数据模型
- **现状**：`TimelineState{version:1, fps, tracks[3], textClips[], transitions[]}`；`cut` 是显式元数据（「authored cut vs omitted」——为 agent 不许冒充计划而设计，`timelineTypes.ts:8-12` 注释原文）；clip 音频（gainDb 上限 0dB 正增益故意不支持、mute、帧级 fade）、取景（framing：contain/cover+scale+pan，所见即所得进导出）、文字轨（字幕/标题+归一化变换）都是 typed 值对象。
- **强**：**每个字段都有「为什么存在」的注释级契约**；fps 可携带非 30 值且全部维度 derive；取景进数据使导出可复现构图（P0-5）。
- **弱**：固定 3 轨无任意图层（分层 B-roll/动图覆盖做不了）、无变速、audio 轨禁 overlap（无 acrossfade）、无 markers/标注实体；`version:1` 没有迁移策略注释（对比 kernel 的 CAS 有明确语义）。
- **判定**：刻意收紧的编辑契约（总纲「不做通用 NLE」），弱点是**扩展必须有治理**（见 §4-X4）。

### L2 确定性内核 ★
- **强**：这是**类目稀缺资产**——ChatCut/OpenChatCut 的公开物里没有对等的「确定性操作集+CAS revision+diff+validate」内核。OpenChatCut 用 120 个工具各带语义，我们是 10 个内核原语+契约投影，**组合爆炸小得多、可测性好得多**（`timelineKernel.test.ts` 全覆盖）。
- **弱**：内核操作与 agent 契约的**词表一致性没有机器门**——`propose_edit_plan` 的 union 拍平问题（`laneTimelineTools.ts:14-24`）正是两边形状漂移的实例；transition 词表（kernel/`ffmpegFiltergraph`/工具 schema 三处）靠人守。
- **判定**：底层最好的一层，缺的是「单一 owner 的词表投影」（见 §4-X1）。

### L3+L4 预览/导出层
- **现状**：预览与导出**共用同一帧级 resolver**（转场 blend/文字 overlay/clip 音频 gain/fade 同一帧语义，`ARCHITECTURE-NOW.md:57`）；导出链 planner→manifest→filtergraph（视觉/音频/文字三链，文字链接最后一层）→commandBuilder→jobManager+store+IPC→audit manifest（`electron/export/` 20+ 文件）。
- **强**：「预览=导出」不是口号，是同一 resolver 的结构保证；坏 manifest 显式报错不静默降级。
- **弱**：`match_cut`/`whip_pan` warning 后硬切（渲染不了但契约允许）；`acrossfade` 未实现；无异步渲染进度抽帧回读（方案 D' 的缺口）。
- **判定**：质量最高的一层，弱点只在词表诚实度（契约发布了引擎渲染不了的值）。

### L5 agent 契约层
- **现状**：capability 定义+aliases（pi/mcp 双通道，`exportCapabilities.ts:177`）；`flatModelInput` 容忍器（B/C 族数组/对象容忍）；typed 契约+examples+副作用声明（`reversal:"proposal"`，`laneCanvasTools.ts:73`）；作用域守卫（`agentChatPolicy.ts:46`）。
- **强**：一次契约定义、内外两个通道共享；副作用声明是机器可读的闸门输入（阶段 3 用）。
- **弱**：**容忍器与 schema 的债显式存在**（`propose_edit_plan` 拍平拒收）；examples 覆盖率曾为 0（#547 修到 35/35，但靠人工）；无「契约词表 = 内核词表」的一致性测试。
- **判定**：设计先进（内外同源），欠一台「词表 derive 门」。

### L6 agent 运行时层
- **现状**：pi 0.85.1 AgentHarness；lane 新通路（`agentLane/` 17 文件：host/session/IPC/projection/tools/document+canvas+timeline 三族）经影子期走向阶段 4（#646）；capability 选工具组（editor/chat/canvas-agent/refine/storyboard…）；productionRun 九阶段引擎+全套动词工具；对外 MCP 生成语义 11 工具。
- **强**：影子比对机器断言、工具作用域守卫、证据制经验闭环——**工程纪律类目内没有对手**（AdCraft/OpenChatCut 均无对等物）。
- **弱**：切换未完成前用户走不到新通路（#646 卡门）；步数上限 24/8/1 对长任务紧；两 area 会话无跨区记忆（R2-U1 未交付）。

## 三、agent 架构接缝图（数据怎么流）

```
模型 ──工具调用──▶ laneToolCatalog（契约+容忍器）──▶ 领域 port（laneTimelinePort 等）
  ▲                                                    │
  │                                              timelineCapabilityTarget
  │                                                    │
  └──投影(laneViewModel 拒收乱序)◀──LanePart[]◀── applyTimelineOperations（L2 内核，CAS revision）
                                                       │
                                             采纳桥/Proposal（幂等键 replay/stale/needs_attention）
                                                       │
                                              TimelineState（L1 真相源）→ L3 预览 / L4 导出
```

**核心判断**：写入链路的**骨架已经通了**（模型→契约→内核→CAS→撤销），真正的缺口按严重度排：① `propose_edit_plan` 契约形状（union 拍平）；② transcript 层不存在（L0 缺理解子层）；③ 预览帧无法回读给 agent（L3→agent 无回路）；④ 内核/契约词表一致性无机器门。

## 四、底层方案（X1–X5，修正并取代 A' 部分设计）

**X1【P0】agent 写契约 = 内核词表的直接投影**（修正原方案 A'）
- 原设计让 `propose_edit_plan` 自定义操作集；修正：**`TimelineOperation` 就是唯一操作真相源**，lane 契约从 kernel 的操作 union derive 生成（codegen 或类型级 derive），拍平问题的修法不变（统一 `action` 形状、差额下沉 refine），但形状的 owner 是 kernel 不是契约层——kernel 加操作，契约自动跟上，漂移在编译期红。
- 新增一致性门 `check:timeline-contract`（R17：先验会红）：扫描 `TimelineOperation` 词表 vs 工具 schema vs `ffmpegFiltergraph` 支持集，三处不一致即红——这一台门同时治「契约发布引擎渲染不了的值」（`match_cut` warning 问题）。
- 验收：先红用例（kernel 加假操作、契约不跟→红）；`propose_edit_plan` 进 lane 走通「重排+trim+text+transition」真实任务。

**X2【P0】理解子层：`electron/video/understanding.ts`**（即方案 B'，落点改为 L0.5 服务层）
- `transcribe`（复用 extractAudioTrack+whisper）、`detectLoudness`（LUFS，为响度归一预留）、`detectBeats`（v2）；TranscriptAsset 落素材库；`read_transcript`/`find_transcript` 两工具进 lane。
- 验收与隐私红线同 B'（见方案文档）。

**X3【P1】时间轴序列化双形态**
- `serializeTimeline(timeline, {format:"markdown"|"json"})`：markdown=segment-id 编码（read_script/apply_script 的地基，人可读）；json=完整投影（调试/互操作/「项目文件即接口」谱系的入口）。序列化器 owner 在 kernel 同目录，read/apply 工具与未来剪映/FCPXML 导出全部消费它——**序列化只写一次**。
- 验收：round-trip（serialize→apply→serialize）幂等；diff 稳定。

**X4【P1】数据模型扩展治理**（把「3 轨够不够」从感觉题变成判据题）
- 判据：任何模型扩展（变速/图层/overlap/markers）必须 ① 先在 kernel 有操作语义+validate+diff ② 过 `check:timeline-contract` ③ 有导出端 filtergraph 对应实现或明确诚实降级。三者齐备才进 `TimelineState` 并 bump version。
- markers（方案 G'）是第一个按此流程进的实体；变速/图层在总纲「不做通用 NLE」边界内**暂不进**。

**X5【P1】agent 回路：预览帧进工具结果**（即方案 D' 的底层落点）
- `preview_timeline_frames` 在 renderer 用 L3 同一 resolver 抽帧（与预览逐位同源），走 `get_media` 纪律（只回 asset ID，不出路径）。
- 验收：粗剪提案批准后 agent 抽帧自检引用帧号；隐私走查通过。

## 五、一句话总结

剪辑栈的底层（L1 数据模型 + L2 确定性内核 + L3/L4 同源帧语义）**质量高于所有已调研竞品的公开物**，agent 契约层（L5）设计先进但欠一台词表一致性门，agent 运行时（L6）纪律最强但用户还走不到。底层方案不是补窟窿，是**把已有的 kernel/CAS/resolver 资产用机器门锁住、把理解子层和序列化层补上、然后让 agent 从 L6 一路写到 L2**——这与 agent 原生剪辑方案 A'–G' 完全同向，X1 是它更准确的落点。
