# Agent 原生剪辑：Nomi 完整可执行方案（A'–G'）

> 状态：📋 方案待拍板（2026-09-09 定稿，2026-09-11 归档入库）

> 日期：2026-09-09 · 依据：[Agent 原生剪辑版图调研](../research/2026-09-09-agent-native-video-editing-landscape.md) + 逐文件实核（本篇所有「现状」均当日验过 file:line）
> 定位：本文是**时间轴 agent 层**的完整施工图，与 [E1/E2/E3 总纲](../superpowers/plans/2026-08-24-unified-agent-master-plan.md) §5.1、[agent 运行时重做方案](2026-09-07-agent-runtime-rebuild.md) 阶段 2/3 对接；与 AdCraft 对照文档的方案 A–H 不冲突（那篇管制作链，这篇管剪辑链）。
> 纪律：开工前逐条过 P5；每条先红后绿；验收 = R16 真实任务闭环 + R13 走查，五门绿只是必要条件。

---

## 现状基线（当日实核，防拿旧文档开工）

| 事实 | 锚点 |
|---|---|
| lane 时间轴**读**工具已 100%（3 工具，帧原生 + `revision` 乐观锁写进 `TIMELINE_GUIDELINES`） | `electron/agentLane/laneTimelineTools.ts:1-60` |
| `propose_edit_plan` **有意不进 lane**：`operations[]` 的 transition/text 两支各有一个形状不同的 `action` 字段，`flattenDiscriminatedUnion` 拒收；修法=统一两支 `action` 形状、差额下沉 refine | `electron/agentLane/laneTimelineTools.ts:14-24` |
| productionRun 管线动词**已全套暴露**（start/get/subscribe/control/decide/revise/review/materialize）——旧文档说「没有暴露」已过期 | `electron/harness/tools/productionRunDescriptors.ts:12-96` |
| 画布写入工具带 typed 契约+示例+副作用声明（`reversal:"proposal"`）+容忍器 | `electron/agentLane/laneCanvasTools.ts:60-171` |
| 导出工具（nomi_export_job 等）有别名体系 pi/mcp 双通道 | `electron/shared/agentCapabilities/exportCapabilities.ts:177-196` |
| transcript：拆解引擎内部已用 whisper（verbose_json 带时间戳），未外暴为 agent 工具 | `electron/video/deconstructVideo.ts:5`、`extractAudioTrack.ts` |
| C0 真跑卡分镜阶段：媒体档位（modelKey/resolution）8/8 漏填、首调 schema 错、审批卡不可读 | PR #646 第三轮记录 |

---

## 方案 A'【P0】时间轴写入契约：让 `propose_edit_plan` 正确进入 lane

> ⚠️ **2026-09-09 底层分析修正落点**：实核发现 `src/workbench/timeline/kernel/timelineKernel.ts` 已有确定性操作内核（10 操作+CAS revision+diff+validate），且 `timelineCapabilityTarget.ts:167` 已消费内核。因此 A' 的操作词表 **owner 改为 kernel**（契约从 `TimelineOperation` derive，编译期锁漂移），并新增 `check:timeline-contract` 一致性门。详见[剪辑栈底层分析 §4-X1](../research/2026-09-09-nomi-editing-architecture-analysis.md)。以下设计中的验收门与分期仍有效，操作集以 kernel 投影为准。

**目标**：agent 能对时间轴做结构化写操作（重排/裁切/字幕/转场/配乐），每次写入=可撤销提案（不绕过 Proposal 铁律）。

**设计**（按 `laneTimelineTools.ts:14-24` 已写明的修法）：
1. **统一 `action` 形状**：transition 支与 text 支的 `action` 改成同一个 discriminated shape——`action: { kind: "apply"|"clear"|"set", params… }`，差异字段下沉到各自分支的 refine（唯一 owner 复用 `canvasWriteCrossFieldRefine` 同款模式）。
2. **操作词汇表从时间轴真实能力 derive**（总纲 §5.1 既定）：v1 操作集 = `reorder_clips` / `trim_clip`（入出点帧级）/ `set_clip_audio`（dB/mute/fade，字段已在 `clipAudio.ts`）/ `set_text_clip` / `set_transition`（dissolve|fade|cut，与 `ffmpegFiltergraph.ts` 支持集一致，**不发布引擎渲染不了的值**）/ `place_asset`（`addAssetToTimeline` 既有家底）。变速、match_cut 明确不进 v1（引擎没有）。
3. **每条操作带 `affects` 影响范围声明**（总纲既定「每条带影响范围」），计划卡 UI 按 affects 分组渲染——直接修 #646 C0 暴露的「审批卡只列 #1–#8 需逐个展开」。
4. **schema 附 3 个示例**（对照 `nomi_canvas_write` 的 examples 模式）：重排两镜 / 全片字幕改字号 / 给 4-6 镜加 dissolve。
5. **守则复用**：帧原生 + revision 乐观锁两条 `TIMELINE_GUIDELINES` 原文保留，加第三条「重叠写法会被拒绝，先 read_timeline 再提案」。

**落点**：`electron/shared/agentCapabilities/`（契约+refine）、`electron/agentLane/laneTimelineTools.ts`（去挡板）、时间轴写入执行端走 E1 采纳桥同族（`adoptStoryboardBatch.ts` 模式：整批一事务、一层撤销、幂等键 replay/stale/needs_attention）。
**分期**：T1 契约改形+先红测试（flatten 拒收用例转绿）；T2 lane 接线+计划卡按 affects 分组；T3 评测面进 #547 同族跑分。
**验收门**：真实任务「把第 3 镜和第 5 镜对调、全片字幕统一 24 号、给 4-6 镜加 dissolve」→ 计划卡渲染可读（人眼）→ 批准→一步撤销；stale revision 重试路径先红后绿；五门绿。
**回滚**：工具从 lane 目录摘除即回只读态，无数据迁移。

## 方案 B'【P0】transcript 层：把 #259 的 whisper 外暴为项目资产 + 工具

**目标**：agent 能「听见」视频——词级时间戳转写成为项目资产，支撑文本式剪辑与语义查询（方案 C'/D' 的地基）。

**设计**：
1. **运行时复用**：#259 的 `extractAudioTrack.ts`（ffmpeg 抽轨）+ whisper 调用链原样复用，抽成独立服务 `electron/video/transcribe.ts`（唯一 owner，拆解引擎改为消费它——P1 加新删旧）。
2. **资产模型**：`TranscriptAsset { sourceAssetId, language, segments: [{ startFrame, endFrame, text, confidence?, speakerId? }] }`；帧级时间戳（项目 fps 换算，与时间轴同坐标系）；存素材库、挂源视频节点。speaker 分离 v1 可空（FunASR CAM++ 级能力留 v2，不阻塞）。
3. **工具两个**（发现阶梯口径，照 ChatCut「省 token/诚实语义」）：
   - `read_transcript { sourceAssetId?, fromFrame?, toFrame?, maxSegments? }` → 紧凑短语视图（分页，未返回=未知）；
   - `find_transcript { query, sourceAssetId? }` → **时间坐标查询**：返回命中句的帧区间列表（OpenChatCut 同款定位：「找一句话什么时候说」，不是转写阅读器）。
4. **隐私**：whisper 走 OpenAI 兼容接口（#259 现状）时沿用既有披露；本地 whisper.cpp 作为 v2 降级路径登记，不阻塞 v1。
5. **媒体档位教训对齐**：模型/语言参数由服务端从项目与引擎默认 derive，schema 不要求模型填（#646 C0 的 8/8 漏填直接对标修正）。

**落点**：`electron/video/transcribe.ts`（新，唯一 owner）、`electron/video/deconstructVideo.ts`（改消费）、`electron/shared/agentCapabilities/`（新 capability+aliases）、素材库 schema、`electron/harness/agentChatPolicy.ts:35`（挂 `canvas-agent` 组）。
**分期**：T1 服务抽取+资产落库；T2 两工具进 lane+评测；T3 拆解引擎切换消费（同 commit 删内联 whisper 调用）。
**验收门**：10 分钟口播→transcribe→`find_transcript("价格")` 返回正确帧区间→`read_transcript` 分页正确；无音频视频诚实返回 `hasAudio:false`（不造空段）；拆解引擎行为回归不变（对照基线）。
**回滚**：资产字段可空，工具摘除无迁移。

## 方案 C'【P0→P1】文本式剪辑：`read_script` / `apply_script`

**目标**：时间轴可物化为 segment-id 编码的 Markdown，人或 agent 改文本=剪辑视频（OpenChatCut 已验证的最高杠杆范式；口播用户的「删文字=删视频」）。

**设计**：
1. `read_script`：时间轴 → `timeline.md`：按轨分节，每个片段一行 `{segId} [{start}-{end}] (sourceIn-{out}) text/summary`，segId 稳定持久（同 物化→改→回写 幂等）。
2. `apply_script`：Markdown diff → 方案 A' 的结构化操作序列 → 同一提案/采纳桥链路（**不写第二条落轴路径**，P1）；无效行整批拒绝并返回人话原因+行号。
3. 删除 segId 行 = 删片段 + ripple 收口（v1 仅同轨 ripple，与 ChatCut 波及语义一致并写进工具描述）。
4. **依赖**：方案 B'（有转写才能给片段标文本）；无转写的片段行退化为序号+时长，仍可重排/删除。

**落点**：`electron/shared/agentCapabilities/`（script 物化契约）、采纳桥执行端、`src/workbench/timeline/`（渲染回读预览）。
**分期**：T1 物化器+稳定 segId；T2 apply→操作序列编译器；T3 lane 工具+走查。
**验收门**：15 分钟口播→read_script→删 3 段口水词→apply→成片时长缩短且无口型断裂（人眼）；乱序 segId/未知行号整批拒绝先红后绿。
**回滚**：Markdown 是投影不是真相源，摘工具无迁移。

## 方案 D'【P1】验证环：agent 改完能「看见」结果

**目标**：对齐 ChatCut 纪律「报告完成前验证真实结果」「agent 验证≠用户批准」。

**设计**：
1. `preview_timeline_frames { fromFrame, toFrame, maxFrames? }`：渲染层合成帧抽取（复用导出链的帧 resolver，`ffmpegFiltergraph.ts` 同一帧语义——预览与导出不再有两套真相），返回有界帧图，**不出本地路径**（只回稳定 asset ID/白名单元数据，沿 `get_media` 纪律）。
2. `verify_export` 升级：现有 receipt-level 校验（`exportCapabilities.ts`）之上加「抽帧自检」——导出完成后自动抽 N 帧回 agent，人眼/模型双审可选；明确不冒充逐帧质检（诚实边界照旧）。
3. **依赖元素检查清单进工具守则**：结构改动后提示 agent 检查字幕/转场/音频对齐（ChatCut 第 5 条纪律的落地）。

**落点**：`src/workbench/timeline/agent/`（`mediaToolCall.ts` 同族）、导出链复用。
**验收门**：粗剪提案批准后 agent 主动抽帧自检并在回复里引用帧号；导出 verify 返回抽帧结果；隐私走查（无本地路径泄漏）。
**回滚**：工具摘除无迁移。

## 方案 E'【P1】音乐节拍确定性 planner

**目标**：BGM 卡点不交给 LLM 自由发挥——本地算节拍，agent 只做意图与执行（OpenChatCut 的 planner/sync 分离模式）。

**设计**：
1. `detect_beats { assetId }`：本地 ffmpeg 能量包络 + onset 检测（零网络零模型起步；Beat This/CLAP 模型级 v2 登记）。结果缓存于素材资产（同 `inspect_music` 读缓存模式）。
2. `propose_music_plan { musicAssetId, videoTrack, mode: "cut_on_beat"|"fade_align" }`：**确定性只读计划**——按节拍网格+当前轨道片段边界生成切分/淡入淡出点（fade 字段已在 `clipAudio.ts` 进导出），输出=方案 A' 操作序列，走同一采纳桥。LLM 的作用降为「选哪首 BGM、选哪种模式」。
3. 锁定语义：锁定片段不切（OpenChatCut `sync_cuts_to_music` 同款），执行时重算。

**落点**：`electron/audio/`（节拍分析新 owner）、`src/workbench/timeline/`（计划渲染）。
**验收门**：60s BGM+8 镜轨道→切点全部落在重拍±1 帧内（数值断言）→批准落轴→导出人耳走查；无音频轨视频诚实报错。
**回滚**：纯增量工具。

## 方案 F'【P2】版本/撤销 + ToolSearch + 互操作

1. **版本/撤销**：采纳桥已有一步撤销；补 agent 工具 `undo_last_change`/`manage_versions`（命名检查点，对齐 OpenChatCut）——前提是编辑器侧版本语义先落（与 AdCraft 对照文档方案 F 合并实施，不双轨）。
2. **ToolSearch 延迟激活**：工具面超过 ~30 个时再建（登记触发条件，不是现在）；模式=按关键词激活 schema 子集，元目录只进系统段。
3. **互操作**：`export_jianying_draft`（剪映草稿导出，OpenChatCut 用它抢存量用户，证据充分）；FCPXML 导入 v2 登记（优先级低于剪映：国内用户面）。
4. **craft skills**：把 talking-head 剪辑方法（粗剪节奏/字幕样式/BGM 结构）写成 Skill Pack 分发——依赖方案 M（技能存档）先落。

## 排序与依赖

```
A'(写入契约) ─┬─→ C'(文本式剪辑)
B'(transcript) ┤      └→ M(技能存档，AdCraft线)
              └─→ D'(验证环)
E'(节拍 planner)  F'(版本/ToolSearch/互操作)
```

| 批次 | 内容 | 出口判据 |
|---|---|---|
| 第一批 | A' + B' | agent 完成「重排+字幕+转场」真实剪辑任务；find_transcript 可用 |
| 第二批 | C' + D' | 口播「删文字=删视频」闭环；抽帧自检进回复 |
| 第三批 | E' + F' | 卡点数值达标；剪映草稿可导出 |

**与 #646 的关系**：第一批在 #646 合并后开工（lane 是唯一通路）；A'/B' 的契约设计与评测用例可先行（先红用例不需要 lane 合并）。

**明确不做**：多轨 overlap（引擎当前禁 overlap，语义不变）、变速/match_cut（引擎没有）、实时自回归编辑（研究向）、直播切片（非 Nomi 用户任务）、云端项目模型（本地优先不动）。

## 补充方案 G'【P2】标注层 + 语义 diff 预览

**依据**：Timeline Studio 2026-09-08 刚交付的 agent markers（章节/节拍/修改备注，apply 前语义 diff 预览）——长任务里 agent 需要「便签层」做规划，而非只有片段读写。

**做什么**：
1. `manage_markers { action: list|add|update|delete }`：时间轴标注（章节标题/节拍点/修改备注，项目时间坐标），素材库持久化，human 用户可见可编辑（不是 agent 私有状态）。
2. 提案 diff 预览：方案 A' 的计划卡升级——每个操作附「改前/改后」两行语义摘要（时间轴统计+受影响区间），对齐 C0 摩擦「审批项要逐个展开辨认」。
3. 节拍标注与方案 E' 共享数据（detect_beats 结果可作为 markers 落轴，human 可手动微调后再跑 planner）。

**落点**：`electron/shared/agentCapabilities/`（markers 契约）、`src/workbench/timeline/`（标注渲染）、计划卡组件。
**验收门**：agent 长任务（粗剪+字幕+配乐）全程用 markers 规划→执行→清除；human 中途手动改动 marker，agent 下轮 read 后不覆盖（先验旧纪律）。
**回滚**：纯增量。

## 补充：商业教训一条（进决策记录，不进代码）

Palmier Pro（14.3k★，类目第一）走「GPL 开源核 → v0.7.6 后转闭源二进制」。Nomi 不改路线：AGPL 编辑器 + Apache 兼容的技能生态 + 商务服务（既有 README 承诺），与 Pireel 双许可切分同构，避免 Palmier 式断裂。见调研文档 §6.1。
