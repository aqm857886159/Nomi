# P5 E2「结构化粗剪」前置盘点与方案

- 日期：2026-08-26
- 范围：只做时间轴事实盘点、EditPlan 设计、缺口与拍板清单；本轮不实现用户可见功能。
- 权威合同：统一 Agent Master Plan §4.3、§4.8、§5.1；统一 Editor Runtime P5→P7。
- 写轴原则：E2 只能复用 `src/workbench/adoption/` 的 EditProposal/原子 apply/一步 Undo；agent 不得直写时间轴。

## 1. 盘点结论（代码事实，不按目录猜）

### 1.1 时间轴模型、轨道与约束

| 能力 | 事实与约束 | 证据 |
|---|---|---|
| 图片轨 | 固定 `imageTrack`，只接 `image` clip；与视频轨并行，跨轨可同帧活动；同轨 clip 不允许重叠。 | `src/workbench/timeline/timelineTypes.ts:3-5,81-90`；`src/workbench/timeline/timelineEdit.ts:67-75,95-116` |
| 视频轨 | 固定 `videoTrack`，只接 `video` clip；与图片轨可叠加；同轨互斥。视频 clip 的 `frameCount` 是源总长，`endFrame-startFrame` 是可见窗口。 | `src/workbench/timeline/timelineTypes.ts:23-45`；`src/workbench/timeline/timelineEdit.ts:37-43,67-75` |
| 音频轨 | 固定 `audioTrack`，只接 `audio` clip；独立于视频，不再抢视频轨位置；同轨互斥。预览按当前帧只取一个 active audio clip。 | `src/workbench/timeline/timelineTypes.ts:81-90`；`src/workbench/player/timelinePlayback.ts:4-20` |
| 文字轨 | 不是 `tracks[]` 的第四媒体轨，而是 `TimelineState.textClips` 独立叠加层，style 只有 `caption|title`；文字 clip 之间没有互斥/碰撞校验。 | `src/workbench/timeline/timelineTypes.ts:48-65,67-78`；`src/workbench/timeline/timelineTextEdit.ts:44-90` |
| 容量/互斥 | 轨道数量由 `TIMELINE_TRACK_DEFINITIONS` 固定为 3；每轨可有多个 clip，但 `canPlaceClip`/`nearestLegalStart` 只在同轨防重叠。跨轨叠加是有意模型：图片在下、视频在上，文字再叠加。 | `src/workbench/timeline/timelineTypes.ts:81-90`；`src/workbench/timeline/timelineEdit.ts:67-75,113-169`；`src/workbench/export/timelineWebmExport.ts:173-199` |
| UI 分层 | 图片/视频显示为 primary；有内容的音频与文字显示为 secondary，空轨收成添加行；文字轨只在预览面出现。 | `src/workbench/timeline/TimelinePanel.tsx:486-503`；`src/workbench/timeline/TimelineTrack.tsx:19-37`；`src/workbench/timeline/TimelineTextTrack.tsx:8-12` |

### 1.2 时间维编辑：trim / split / ripple / roll

| 操作 | 真实支持程度 | 语义与边界 | 证据 |
|---|---|---|---|
| trim（媒体） | **支持：单 clip 左/右边缘裁剪** | 左 trim：`startFrame += delta`、视频/音频 `offsetStartFrame += delta`；右 trim：只改 `endFrame`、`offsetEndFrame -= delta`。最短 1 帧，且被前后邻片夹住；素材源边界也会夹住。后续 clip 的 `startFrame` 不变。 | `src/workbench/timeline/timelineEdit.ts:409-458`；store 接线 `src/workbench/workbenchStore.ts:626-634` |
| trim（文字） | **支持：文字 clip 左/右边缘改可见区间** | 保证至少 1 帧；不改媒体、不推动其它文字 clip，也不做文字内容重排。 | `src/workbench/timeline/timelineTextEdit.ts:68-90`；`src/workbench/workbenchStore.ts:741-750` |
| split | **支持：按当前可见区间切成左右两片** | 只允许 `startFrame < splitFrame < endFrame`；视频/音频按可见帧更新两边 offset，图片按可见帧更新 `frameCount`。右片新 id，后续 clip 原位不动；无 ripple。 | `src/workbench/timeline/timelineEdit.ts:311-366`；回归证据 `src/workbench/timeline/timelineClipVisibleSpan.test.ts:55-70` |
| ripple | **不存在** | 没有“裁剪后自动推动后续片段”的 API、reducer 或数据语义。所有相邻片段位置保持原值；`resizeClipEdge` 只是把本片边界夹到邻片。E2 不得把 trim 描述成 ripple。 | `src/workbench/timeline/timelineEdit.ts:409-458`（唯一媒体 resize 核）；`src/workbench/workbenchStore.ts:626-634` |
| roll | **不存在** | 没有同时移动相邻两片的边界、保持总时长的操作；`moveClipToFrame`/`moveClipToLegalFrame` 是移动整片，不能冒充 roll。 | `src/workbench/timeline/timelineEdit.ts:93-169`；`src/workbench/workbenchStore.ts:491-513` |
| 移动/吸附 | **支持：整片移动、成组平移、吸附** | 移动不许同轨重叠；撞到已有片段时拖放路径滑入最近合法空位；snap 点为 0、playhead、其它 clip 头尾，像素阈值换算成帧，Shift 可关闭吸附。 | `src/workbench/timeline/timelineEdit.ts:93-169,266-309`；`src/workbench/timeline/snapping/snapPoints.ts:12-50`；`src/workbench/timeline/snapping/resolveSnap.ts:4-34` |

**时间语义判定：** E2 当前可安全承诺的是“按起点排列、显式 trim、显式 split、移动/吸附”；不能承诺 ripple、roll、自动补缝或时间重排。`updateClipsBySourceNodeId` 遇到新产物变长也只把本片尾夹回下一片起点，并把差额记入 `offsetEndFrame`，不会推动下一片（`src/workbench/timeline/timelineEdit.ts:230-263`）。

### 1.3 字幕文字轨与对白对齐

- 手动建字幕：`addTextClip` 在 playhead 建 `caption`，默认 `3s × fps`，再由 store 压一层 undo；`TimelineSecondaryAddRow` 的“+字幕”调用这条路径（`src/workbench/timeline/timelineTextEdit.ts:22-41`；`src/workbench/workbenchStore.ts:707-717`；`src/workbench/timeline/TimelineSecondaryAddRow.tsx:35-38,86-95`）。
- 批量写入：E1 批量采纳在纯计算阶段收集 `textClips[]`，一次性作为 `AdoptionExtras` 写入；按 `sourceNodeId` 去重，已有同源字幕不重复加（`src/workbench/adoption/adoptStoryboardBatch.ts:158-207`；`src/workbench/adoption/adoptionApply.ts:43-46,90-96`）。
- 对齐规则：优先 `node.meta.subtitle`，缺失才回退 `node.meta.dialogue`，两者都空则不建字幕；字幕 `startFrame/endFrame` 与对应媒体 clip 完全相同（`src/workbench/adoption/adoptStoryboardBatch.ts:76-83,195-205`）。分镜 schema 已把 `subtitle/dialogue` 作为结构字段，并在物化节点 metadata 时保留（`src/workbench/generationCanvas/agent/storyboardPlan.ts:81-88,341-370`）。
- 文字轨只负责叠加渲染，不是媒体互斥轨；导出 WebM 会把 active text clip 画在媒体上（`src/workbench/timeline/timelineTypes.ts:48-65`；`src/workbench/export/timelineWebmExport.ts:195-199`）。

### 1.4 音乐/音轨

- 入口：素材库拖放、空音频副轨的 AssetPicker“+配乐”都调用 `addAssetToTimeline`；audio 资产先探测真实时长，失败时使用 `10s` 可用 fallback，生成 `audio` clip 后写入独立音频轨（`src/workbench/timeline/addAssetToTimeline.ts:54-80`；`src/workbench/timeline/buildClipFromAssetRef.ts:5-9,25-57`；`src/workbench/timeline/TimelineSecondaryAddRow.tsx:39-81`）。
- 时长/对齐：clip 以 `startFrame` 放置，`frameCount/endFrame` 由探测秒数 × 当前 fps 派生；贴尾路径取该轨最大 `endFrame`，不是整轴时长（`src/workbench/timeline/addAssetToTimeline.ts:54-57,83-92`；`src/workbench/timeline/timelineMath.ts:234-236`）。E2 的“垫底”必须额外选择 start=0 或明确从 playhead 开始，不能把“加到音轨”误写成自动铺满全片。
- 预览：当前帧按 `offsetStartFrame + (playhead-start)` 同步 `<audio>`，共享播放/音量/静音；同一时刻只取一个 audio clip（`src/workbench/preview/usePreviewBgmPlayback.ts:13-60`；`src/workbench/player/timelinePlayback.ts:14-30`）。
- **声明但未接通成片导出：** renderer manifest 明确 `audioCodec: 'none'`、`audioMode: 'mute'`，并且警告省略 audio/text/effect 等轨；WebM canvas exporter 只 preload image/video，未绘制或混音 audio（`src/workbench/export/renderManifest.ts:23-27,133-143,162-194`；`src/workbench/export/timelineWebmExport.ts:133-155,173-199`）。因此“预览可听到 BGM”不等于“MP4 粗剪交付含 BGM”。

### 1.5 转场

- **真实存在：声明/持久化/校验能力。** `TimelineTransition` 支持 `cut|dissolve|fade|match_cut|whip_pan` 与可选 `durationFrames`；normalize 接受并落盘；E1 批量采纳只从前一镜 metadata 的 `transition` 生成相邻 clip pair，并在原子 apply 中去重写入（`src/workbench/timeline/timelineTypes.ts:7-21`；`src/workbench/timeline/timelineMath.ts:169-190`；`src/workbench/adoption/adoptStoryboardBatch.ts:86-97,211-225`；`src/workbench/adoption/adoptionApply.ts:97-105`）。
- **声明了但没实现：视觉混合。** 预览 active layer 仍按单个 image/video clip 选择；WebM exporter 只画当前 image/video，没读取 `timeline.transitions`；renderer manifest 也不带 transition 字段。现有 `timelineSubtitleTransitionContract` 只做投影/连续性/显式声明校验，不产生 dissolve/fade 画面（`src/workbench/player/timelinePlayback.ts:14-20`；`src/workbench/export/timelineWebmExport.ts:173-199`；`src/workbench/export/renderManifest.ts:117-195`；`src/workbench/preview/timelineSubtitleTransitionContract.ts:46-83,100-170`）。
- 结论：E2 可设计 `declareTransition`（写入真实存在的元数据能力）；“应用视觉转场”必须列为缺口，不能在计划卡上说已完成。

### 1.6 clipFraming、可见区间、addAssetToTimeline 与撤销

- `clipFraming` 是时间轴 clip 的持久化 `fit/scale/offsetX/offsetY`，预览、WebM、ffmpeg filtergraph 共用同一数学语义；`setClipFraming` 合并 patch、清洗并 clamp（`src/workbench/timeline/clipFraming.ts:1-7,22-56,65-83`；`src/workbench/timeline/timelineEdit.ts:461-490`）。
- 可见区间唯一真相是 `endFrame-startFrame`；`frameCount` 对 video/audio 是源总长，不能用于布局宽度或 trim 结果（`src/workbench/timeline/timelineEdit.ts:25-34`；`src/workbench/timeline/TimelineClip.tsx:231-231`；`src/workbench/timeline/timelineClipVisibleSpan.test.ts:5-8,39-52`）。
- `addAssetToTimeline` 是图片/视频/音频共用的 probe→build→`addTimelineClipAtFrame` 路径；生成节点的写轴则已在 E1 收敛到 `adoptGenerationNode`（`src/workbench/timeline/addAssetToTimeline.ts:59-80`；`src/workbench/timeline/addNodeToTimelineEnd.ts:5-14`；`src/workbench/timeline/TimelineTrack.tsx:101-157`）。
- 普通编辑的 undo/redo：编辑前把完整 `TimelineState` 压入 undo，undo 把当前态推入 redo，redo 再推回 undo；拖动过程中 `commit:false` 不 bump 持久化，手势首次移动时 `captureTimelineUndo` 只捕获一次，最多 30 层（`src/workbench/workbenchStore.ts:521-567`；`src/workbench/timeline/TimelineTextTrack.tsx:23-97`）。
- E1 批量 apply：`buildAdoptedTimeline` 全量校验后一次 `commitTimeline`，整批只压一层；commit/校验失败会 compensation 还原 timeline **及 undo/redo 栈**，不可补偿则 `needs_recovery`（`src/workbench/adoption/adoptionApply.ts:48-161`；`src/workbench/adoption/adoptionStorePorts.ts:31-82`）。成功回执的 Undo 还会检查 proposal 仍 landed，避免撤掉别人的后续编辑（`src/workbench/adoption/adoptionReceipt.ts:49-70`）。

## 2. EditPlan：从上述事实派生的类型化操作集

E2 只允许下列 **8 条**操作。每条 operation 必须带 `scope`，scope 是用户在剪辑计划卡上看到的影响范围；计划执行器只生成 Proposal，不直接调用 store。

```ts
type EditPlan = {
  planId: string
  baseRevision: string
  operations: EditOperation[]
  summary: { affectedClipIds: string[]; affectedTextClipIds: string[]; affectedTrackTypes: TimelineTrackType[] }
}

type EditOperation =
  | { type: 'arrangeStoryboard'; sourceNodeIds: string[]; startFrame: number; scope: Scope<'image'|'video'> }
  | { type: 'placeAsset'; assetId: string; trackType: 'image'|'video'|'audio'; startFrame: number; scope: Scope<'image'|'video'|'audio'> }
  | { type: 'trimClip'; clipId: string; edge: 'left'|'right'; deltaFrame: number; scope: Scope<'image'|'video'|'audio'> }
  | { type: 'splitClip'; clipId: string; frame: number; scope: Scope<'image'|'video'|'audio'> }
  | { type: 'setClipFraming'; clipId: string; patch: Partial<ClipFraming>; scope: Scope<'image'|'video'> }
  | { type: 'materializeCaptions'; sourceNodeIds: string[]; scope: Scope<'text'> }
  | { type: 'placeMusicBed'; assetId: string; startFrame: number; scope: Scope<'audio'> }
  | { type: 'declareTransition'; fromClipId: string; toClipId: string; transition: TimelineTransition; scope: Scope<'transition-metadata'> }

type Scope<T extends string> = {
  kind: T
  clipIds: string[]
  trackTypes: TimelineTrackType[]
  frameRange?: { startFrame: number; endFrame: number }
  reason: 'storyboard-order'|'duration-alignment'|'dialogue-caption'|'music-bed'|'authored-transition'|'manual-edit'
}
```

约束：

1. `arrangeStoryboard` 只复用 `planStoryboardTimeline` 的 shotIndex 排序与视频/关键帧占位/still 选择；批量落轴必须走 `adoptStoryboardBatch`。它不包含 ripple/roll。
2. `placeAsset`/`placeMusicBed` 只调用已有 asset probe + `addAssetToTimeline` 语义；music bed 是 audio clip，不假装有导出混音能力。
3. `trimClip`/`splitClip` 的 delta/frame 必须先按当前 `baseRevision` 计算并校验可见区间，后续片段位置不变。
4. `materializeCaptions` 只从结构字段 `subtitle ?? dialogue` 派生，不解析 prompt、不调用模型；同源 `sourceNodeId` 幂等去重。
5. `declareTransition` 只写真实存在的 transition metadata；视觉 dissolve/fade 不能由该操作宣称完成，直到渲染链补齐。
6. `setClipFraming` 复用 `setClipFraming` 纯函数和单一 framing 数学，不为 E2 造第二套 crop/transform。

## 3. Proposal、幂等与一次 Apply/Undo

- Proposal key 原样复用 `AdoptionProposalKey` 六元组：`runId + contractHash + artifactId + artifactVersion + baseRevision + destination`（`src/workbench/adoption/adoptionTypes.ts:12-26`；`src/workbench/adoption/adoptionProposalKey.ts:5-8,124-143`）。E2 的整份 EditPlan 作为 artifact（稳定 `artifactId/artifactVersion`），`contractHash` 覆盖操作序列和受影响资产；不另造 `EditPlanKey`。
- `baseRevision` 必须在所有纯派生/异步 probe 完成后从当前 timeline 读取（E1 已明确这一时序，`src/workbench/adoption/adoptStoryboardBatch.ts:227-237`）。轴内容变动返回 `stale`；同 key 重复请求返回原 proposal；产物版本变更返回 `needs_attention`。
- 批量计划先全算：排列、trim、字幕、音乐、transition metadata、framing 形成一个 `next TimelineState`，再交给 `buildAdoptedTimeline`/`applyAdoption`；任何一项非法都不落轴。
- commit 只压一层 undo；失败或写后完整校验不通过，compensation 还原旧轴和两栈；成功后计划卡回执只能提供一个“撤销”，且绑定 `proposalIsLanded`。
- 自由挡不降级：用户手动拖剪后，新的 EditPlan 以最新轴 `baseRevision` 为基线；计划只能覆盖用户勾选的镜头/操作，不能锁死整条轴。

## 4. 零模型派生算法

### 4.1 按分镜计划排列 + 时长对齐

1. 从 `planStoryboardTimeline(nodes, edges, scope)` 得到 shotIndex 排序单位；视频优先，未生成视频用其首帧图片占位，纯图镜头保留，未生成项进入 skipped（`src/workbench/generationCanvas/agent/storyboardTimelinePlan.ts:58-134`）。
2. `cursor = requestedStartFrame`；对每个单位构建 clip。当前真实 builder 的时长来源是 result.durationSeconds → node.meta.videoDuration → 默认 5s，图片默认 3s（`src/workbench/generationCanvas/model/buildClipFromGenerationNode.ts:54-67,79-111`；真实视频再由 probe 修正，`src/workbench/timeline/buildGenerationNodeTimelineClip.ts:12-32`）。
3. 若分镜 `durationSec` 与已生成 clip 的可见时长不同，E2 只做结构 trim（`trimClip`）到目标帧数；不足目标时不复制/拉伸素材，标记 `duration_shortfall`，由卡展示。当前节点 `params.duration` 虽由计划写入（`src/workbench/generationCanvas/agent/storyboardPlan.ts:537-550`），时间轴 builder 不读取它，这是必须先补的映射缺口，不能默认为已对齐。
4. 每个单位的 `startFrame = cursor`，`cursor = endFrame`，同视频轨首尾相接；图片与视频仍按各自轨模型落位。已有 E1 的 `cursor = clip.startFrame + clip.frameCount` 可作为实现基线，但 E2 必须改为以**实际可见 endFrame**和目标时长计算，不能拿源 `frameCount` 混淆裁剪后跨度。

### 4.2 对白 → 字幕轨

按排列结果逐镜读取 `meta.subtitle`，无则 `meta.dialogue`，trim 空白后生成一个 `TimelineTextClip(style:'caption', sourceNodeId, startFrame, endFrame)`；无文字不生成。所有 text clips 作为同一 Proposal extras 一次写入，`sourceNodeId` 去重。零模型、零转写、零时间猜测。

### 4.3 音乐垫底

从素材库选择一个 `audio` AssetRef，先用既有 duration probe 建 clip；E2 默认 `startFrame=0`，若用户明确“从当前播放头开始”才使用 playhead。目标范围是 `[0, visualDuration)`：音频比画面长时用已有右 trim 截到画面尾；音频比画面短时**不循环、不复制**，以 `music_shortfall` 明示。原因是当前模型只有 clip placement/trim，没有 loop/ducking/mix/export 音频能力。

### 4.4 转场应用

读取每个分镜节点 metadata 的 `transition`，只在相邻、实际都落轴的 clip pair 上生成 `declareTransition`；未声明的边界不自动伪造成 transition（`src/workbench/adoption/adoptStoryboardBatch.ts:211-225` 已有同语义）。`cut` 也必须显式声明才计入成片 contract。E2 只能把 metadata 应用到 timeline；视觉 dissolve/fade/match-cut/whip-pan 进入缺口并在计划卡标“声明已写入，当前预览仍为硬切”。

### 4.5 实拍素材混排

`AssetRef` 的 kind 决定目标轨，拖放/Picker 都走 `buildAssetTimelineClip` + `addTimelineClipAtFrame`；与 AI 镜头使用同一 `TimelineClip` 模型，按用户指定的 `startFrame` 或“贴尾”落位。默认不替换、不覆盖已有片段；同轨冲突走最近合法空位/报告冲突，不引入隐式 ripple。混排只做结构拼接，不分析素材内容。

## 5. 缺口与进入闸

### 必须先补

1. **计划时长 → clip 可见时长映射**：`PlanShot.durationSec`/节点 `params.duration` 当前没有被 timeline builder 读取；需要一个纯结构 adapter，明确不足时长不拉伸、超长走 trim，并锁测试。
2. **E2 一次性 EditPlan apply adapter**：E1 已有单产物/故事板批量桥，但还没有能同时原子合并 trim/split/text/audio/transition/framing 的 EditPlan builder；必须复用 `adoptionApply.ts`，不得在 store 旁另写轴。
3. **音频进入最终导出链**：renderer manifest 当前 `audioCodec:none/audioMode:mute`，WebM canvas 不 preload/draw audio；若 E2 的“能听”定义包含导出交付，必须先补标准音频 render/export，并做真机 parity。

### 可绕过（本期诚实降级）

1. 音乐比画面短：不循环，保留短缺标记并在计划卡/回执中说明。
2. 分镜时长比真实产物长：不拉伸，保留 `duration_shortfall`，用户可手动 trim/替换素材。
3. transition 元数据已有但视觉混合未接：先允许 `cut`/声明写入；非 cut 只展示“已声明、当前预览按硬切”，不伪装成已渲染。
4. 文字轨没有 overlap 规则：同一镜一条 caption 作为 E2 约束；用户手工标题卡可继续自由叠加，不把 E2 计划扩大成字幕排版器。

### 砍掉

1. ripple edit、roll edit、自动补缝/自动推移后续 clips：时间轴没有真实语义，留到另一个明确架构阶段。
2. E2 内置 VLM/ASR/TTS/“听懂内容后重剪”：这是 E3/音频 module，不属于零模型结构派生；TTS 是否进入 Pack v1 仍待产品拍板。
3. 通用 NLE 的多层效果、关键帧、音量包络、循环 BGM、ducking：当前时间轴/导出模型没有家，越界实现会制造第二套编辑器。

## 6. 用户可见面：样张与确认漏斗（本轮只标记，不实现）

### 剪辑计划卡（必须 owner 样张拍板）

这是 §5.1 规定的“剪辑计划卡”，不是新的写轴通道。卡必须能让用户在不读技术日志的情况下回答：

- **动几条**：影响的镜头/实拍素材数量、每条稳定名称或镜号、跳过项与原因；
- **改哪里**：操作分组（排列、trim/split、字幕、音乐、转场声明、取景），每组的轨道与帧范围；
- **会变成什么**：预计画面时长、字幕条数、BGM 覆盖范围、明确的短缺/未实现转场提示；
- **可逆边界**：一个主动作“应用到时间轴”、一个“取消/返回修改”，成功回执只出现“一步撤销”；轴在卡期间变化时显示 stale/重新生成计划，而不是悄悄覆盖。

### 与既有确认漏斗的关系

- **不花钱**：E2 不触发 `SpendConfirmDialog` 的 generation/reference/contract 额度确认，也不铸 spend grant。`SpendConfirmRequest.kind:'plan'` 已定义为“AI 往画布落一套免费、可撤方案”（`src/workbench/generationCanvas/spend/spendConfirm.ts:23-29`），但 E2 是时间轴 EditProposal；若复用这一确认宿主，必须只复用队列/暂停/单一确认语义，不能把“计划卡”伪装成花钱卡。
- **托管确认**：素材仍是本地 `AssetRef` 时不触发公共托管；只有后续生成链需要上传本地引用，才走既有 `requestAssetUploadConsent → confirmDialog`（`src/workbench/generationCanvas/runner/assetUploadConsent.ts:45-73`）。E2 计划卡不得合并或绕过托管披露；两张卡的串联体验若要改变，另需样张和 owner 决策（F16 已明确这是产品取舍，不在本轮擅改）。
- **§4.3 词汇类别**：它属于“agent 思考/规划”的**可审阅写入计划**与“写入回执”的前置确认面，动作形态应是轻量可折叠/可展开计划项，不是唯一重卡（富卡片保留给要花钱），也不是任务中心长任务条。结构性编辑仍跳时间轴这个“家”；对话只负责展示、确认、回执。
- **§4.8 自由挡不降级**：卡上按镜级勾选覆盖范围；用户可取消后手动拖剪，后续计划自动以新轴为基线。卡只读决策面，不能在卡内偷偷变成完整 NLE。

### 其它需要拍板的用户可见面

1. **非 cut 转场的诚实呈现**：是显示“已声明但当前预览按硬切”，还是在 E2 v1 直接禁用并列入缺口；这是产品取舍，不能由实现者默选。
2. **BGM 短于全片/计划时长不足**：卡上是允许带缺口应用，还是强制用户换素材/改计划；当前底层没有循环/拉伸能力。
3. **TTS/配音是否进入 Pack v1**：主计划已标为待拍板；若进入，必须接 P6 音频 module，不在本 E2 盘点中偷接。

## 7. 回滚与验收门

- 本轮回滚：文档单文件删除即可；不改 schema/store/UI，不产生数据迁移。未来 E2 实现必须保持旧 TimelineState 可 normalize，且 Proposal stale 时零写入。
- 结构验收：EditPlan 每条 operation 都能指向本盘点的 file:line；不存在的 ripple/roll/视觉转场不得出现在类型或卡文案中。
- 事务验收：重复 key 返回原 Proposal；baseRevision 变化返回 stale；artifactVersion 变化返回 needs_attention；整批 apply 只压一层 undo；失败能完整 compensation，补偿失败显式 needs_recovery。
- 体验验收（实现阶段）：先做真实布局样张并由 owner 拍板；再按 J-混剪真实任务“AI 镜头 + 实拍素材 + 字幕 + BGM → 计划卡 → Apply → 预览 → 一步 Undo”走查，截图必须与实际入口/构建同构。
- 工程验收（实现阶段及本轮文档提交）：`pnpm run gates > /tmp/gates-e2.log 2>&1; echo exit=$?`，不得用管道吞退出码；本轮不实现用户可见功能，但仍跑全 gates 后才提交。

