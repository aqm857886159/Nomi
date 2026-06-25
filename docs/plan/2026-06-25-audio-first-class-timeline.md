# 音频成时间轴一等公民（素材可拖 + 独立音频轨 + 预览试听 + 导出混音）

> 2026-06-25 · 用户拍板「一步到位·完整可用」。承接素材库放开音频上传（094b736）后，让音频真正可用。

## 关键发现：导出侧已经全通，不要重写

调查 ffmpeg 导出引擎，**音频混音整套已建好且有测试**，Explore 初判「导出是大头」是错的（它只看了 renderer 侧 `renderManifest.ts` 的 `audioMode:'mute'`，漏看主进程覆写）：

- `electron/export/exportJobs.ts:137-172` `tryBuildFiltergraphExport`：对每个资产 url→absolutePath + `probeMediaMetadata` ffprobe，`anyHasAudio` 就把 profile **覆写**成 `audioMode:'mixdown'`+`audioCodec:'aac'`+192k。renderer 侧 `renderManifest.ts` 的 `mute` 是死的、被这里盖掉。
- `electron/export/ffmpegFiltergraph.ts:188-223` `buildAudioGraph`：音频源（独立音频轨 clip + `asset.hasAudio` 的视频）逐个 atrim→asetpts→adelay（平移到时间轴位置），多源 amix `normalize=0`，输出 `[aout]`。已认 `track.kind==='audio'`、`asset.kind==='audio'`、video+hasAudio。
- `electron/export/ffmpegCommandBuilder.ts:79-118`：mixdown audioMode + audioOutputLabel → `-map [aout] -c:a aac`。

**结论：只要一条 audio clip（带可本地解析的 nomi-local url）进到导出 manifest，mp4 导出就会自动混音。** 导出侧零改动，本任务只需「把音频送进时间轴 + 预览能听到」，导出做 R13 真实验证即可。

## 工作范围（三块，A/B/C）

### A. 入口：素材库音频可拖 → 时间轴直接收
- `assetLibraryDrag.ts`：payload `kind` 放宽含 `'audio'`，解析守卫放行 audio。
- `AssetLibraryPanel.tsx:57`：`draggable` 含 audio；title 提示「拖到时间轴」（音频拖画布无意义，文案区分）。
- `TimelineTrack.tsx`：drop / dragover / dragenter 增认 `ASSET_LIBRARY_DRAG_MIME`（现仅认 `TIMELINE_GENERATION_NODE_DRAG_MIME`）。
- 新 `buildClipFromAssetRef`（assets→timeline 适配）：从 AssetRef 建 audio clip。难点=① 无源节点 → 合成稳定 `sourceNodeId = 'asset:' + assetRef.id`；② 时长 → 新 `readAudioDurationSeconds`（离屏 `<audio>` 探，仿 readVideoDurationSeconds），探不到回落默认（如 10s，可拖 trim）。

### B. 独立音频轨（不再寄生视频轨、跟视频抢位）
- `timelineTypes.ts`：`TimelineTrackType` 加 `'audio'`；`TIMELINE_TRACK_DEFINITIONS` 加 `{ id:'audioTrack', type:'audio', label:'音频轨' }`；`getTrackTypeForClipType` audio→audio。
- 新 token `--workbench-audio`（紫/violet，区分 accent=蓝、video=青）+ soft，加在 tailwind.config.ts addBase（同 `--workbench-video` 定义处）。
- `TimelineTrack.tsx` 轨道色点、`TimelineClip.tsx` audio 配色改用 `--workbench-audio`、`timelineDropFeedback.ts` 允许 audio clip 落 audio 轨 + 轨道标签。
- 连带核查：timelineMath/timelineEditReconcile/timelineNodeReconcile 对「三轨」假设（多数按 track 遍历，应自适应；逐一核）。

### C. 预览试听（基建已存在，加平行 `<audio>`）
- `timelinePlayback.ts`：`TimelinePlaybackLayer` 加 `audio`，`resolveTimelinePlaybackLayer` 解析活动 audio clip。
- `TimelinePreview.tsx`：已有 `<video>` + 音量/静音/play 同步基建（:54/79/117/162）。加 `audioRef` 平行元素：活动 audio clip → currentTime 跟 playhead（复用 video 的播放感知阈值同步）、play/pause 跟随、共享 volume/muted。

## 不动项 / 非目标
- ffmpeg 导出引擎、filtergraph、command builder：**零改动**（已支持，仅验证）。
- 视频自带音轨混入（asset.hasAudio）：本就支持，不专门做；但本次音频轨打通后顺带可用。
- WebM 降级路径：canvas 录制本就无音频，仅在资产无法本地解析时触发（如远端 http url）——诚实标「降级导出无配乐」，不为它造音频路径（边缘情况）。
- 音频波形可视化（clip 内画波形）：超范围，audio clip 用纯色块 + 名字即可。
- 多音频轨 / 音量包络 / 淡入淡出：超范围。

## 回滚
单一 feature，集中在 timeline + assets + preview；无 schema 迁移（TimelineState version 不变，新 audioTrack 是加项，旧项目加载时 normalize 补空音频轨）。出问题 revert 本次 commit 即可。注意 normalize：旧持久化 timeline 只有两轨，加载需补 audioTrack（在 normalizeTimeline 处加，幂等）。

## 验收门（R13 真机 + 五门）
1. 素材库音频格子可拖，拖到时间轴音频轨成 audio clip。
2. 预览播放能**听到**配乐（真机 + 截图/日志证音频元素在播）。
3. **真实导出 mp4 带配乐声**：跑真 ffmpeg 导出，ffprobe 产物确认有 aac 音轨（这是终极证明，额度=本地零成本）。
4. 五门全过；audio clip trim/split 等编辑不回归（已有测试覆盖 audio）。
5. 旧项目（两轨）加载补音频轨不崩、不丢 clip。
