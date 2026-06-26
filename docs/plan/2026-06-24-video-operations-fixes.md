# 视频操作一揽子修复（2026-06-24）

用户报 4 个现象，要求顺藤摸瓜把同类「视频操作」问题一并治本。已读真相源定位根因，本文档记范围/根因/落点/不动项/验收。

## 现象 → 根因（已读代码确认）

| # | 现象 | 根因（file:line） |
|---|---|---|
| A | 素材库不能导入视频 | `assetImportAdapter.ts` 整个是 image-only：`filterImportableImageFiles:132` 滤掉非 `image/`、`importImageFilesToGenerationCanvas` 硬编码 `type:'image'`。`AssetLibraryPanel.tsx:160` 二次 image 过滤 + `:229 accept="image/*"` |
| B | 视频不能直接拖进画布 | 文件树拖(`canvasStageDrop.ts:35`)、素材库拖(`:68`)**已支持**视频；唯独 OS 原始文件拖 `:82` `file.type.startsWith('image/')` 把视频滤光 |
| C | 播放轴点中间不 seek、只从头播放 | ①`TimelinePreview.tsx:120 if (playing) return`：播放中 scrub 改了 playhead 但不同步到 `<video>.currentTime`。②被 D 放大：clip 时长被钉成 5s，用户点的"中间"落在 5s 之外→`togglePlayback:320 playheadFrame>=durationFrame` 复位 0→从头播 |
| D | 视频入轨变成固定 5 秒 | `buildClipFromGenerationNode.ts:57 resolveFrameCount`：`result.durationSeconds || DEFAULT_VIDEO_SECONDS(5)`。拖入/上传的视频没有 `durationSeconds`（那是生成参数，非文件真实时长）→ 一律 5s。入轨链路从不测真实时长 |

## 落点（治本，单一真相源）

**统一时长真相键 = `node.meta.videoDuration`（秒）。**写者两处、读者一处，根因层收口：
- 新 `src/media/videoDurationProbe.ts` → `readVideoDurationSeconds(url)`：离屏 `<video preload=metadata>` 测时长（仿 `readBrowserImageDimensions`），8s 超时兜底。
- 写①节点渲染回填（catch-all）：`BaseGenerationNode.tsx` 的 `<video onLoadedMetadata>` 已回填 W/H，扩成同时回填 `meta.videoDuration`（任何来源的视频节点一渲染即自愈时长）。
- 写②导入/拖入即测：generalize 后的 import adapter 与 `canvasStageDrop` 视频路，建节点时 probe → 写 `meta.videoDuration`（消除「渲染前就拖到时间轴」的竞态）。
- 读：`buildClipFromGenerationNode.resolveFrameCount` 改 `result.durationSeconds ?? node.meta.videoDuration ?? 5`。

**A/B（导入视频）generalize import adapter（P1 不开并行版）：**
- `assetImportAdapter.ts`：`filterImportableImageFiles`→`filterImportableMediaFiles`（收 image+video，按 kind 分大小上限：图 30MB、视频 800MB），`importImageFilesToGenerationCanvas`→`importLocalMediaFilesToGenerationCanvas`（按 `dropKindFromMime` 分流：图走旧路；视频上传通用 API[本就透传 contentType]、`type:'video'`、probe 时长写 meta、不做 data-url 兜底）。
- `AssetLibraryPanel.tsx`：上传过滤 + `accept` + 空态文案放开到图片/视频。
- `canvasStageDrop.ts:82`：OS 文件路放开到 image+video，调 generalized import。
- 同步改 1 测试 import + AssetPicker 注释里的旧函数名。

**C（seek）：** `TimelinePreview.tsx` 删 `if (playing) return`，改播放感知阈值（播放 0.3s 只在 scrub 大跳纠正、暂停 0.04s 逐帧贴紧）。D 修好后"点中间落在真实时长内"，复位 0 不再误触发。

## 不动项
- 时间轴 drop 只收 `TIMELINE_GENERATION_NODE_DRAG_MIME`（必须先成画布节点再拖下）——不改，维持现流。
- `togglePlayback` 末尾复位 0 = 正常 replay 语义，不动。
- 音频导入不在本轮（无音频节点 archetype 可落，库里音频不可拖）。
- 生成产物视频已带 `durationSeconds`（生成参数），不受影响。

## 验收门
- 五门：filesize→tokens→lint→typecheck→test→build。
- 新单测：buildClip 读 `meta.videoDuration` 回退；import adapter 收视频出 `type:'video'`。
- R13 真机走查：①素材库上传一个视频→入库；②OS 视频拖进画布建视频节点；③拖视频节点到时间轴→clip 时长=真实时长（非 5s）；④播放中点时间轴中间→画面跳到该点继续播（非从头）。

## 回滚
单 commit；逐文件可 revert。helper/adapter generalize 与 seek/duration 互不耦合，可分别回退。
