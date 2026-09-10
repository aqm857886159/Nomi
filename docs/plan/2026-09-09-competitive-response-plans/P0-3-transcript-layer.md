# B' + X2 · transcript 层（理解子层）

> 状态：📋 方案待拍板（2026-09-09 定稿，2026-09-11 归档入库）

> 详版：[agent 原生剪辑方案 B'](../2026-09-09-agent-native-editing-plan.md) · 竞品依据：OpenChatCut/ChatCut/FireRed 全部以 ASR 为剪辑 agent 地基

## 目标

agent 能「听见」视频：词级时间戳转写成为项目资产，支撑文本式剪辑（P1-1）、语义选段、口播粗剪三条线。

## 设计

1. **服务抽取**：`electron/video/understanding.ts`（唯一 owner）——复用 `extractAudioTrack.ts`（ffmpeg 抽轨）+ whisper verbose_json（带时间戳）调用链；`deconstructVideo.ts` 改为消费它（同 commit 删内联调用，P1 加新删旧）。
2. **资产模型**：`TranscriptAsset { sourceAssetId, language, segments: [{ startFrame, endFrame, text, confidence?, speakerId? }] }`——**帧级时间戳**（项目 fps 换算，与时间轴同坐标系）；存素材库、挂源视频节点；speakerId v1 可空（FunASR CAM++ 级 v2）。
3. **两个工具**（发现阶梯口径，省 token+诚实语义）：
   - `read_transcript { sourceAssetId?, fromFrame?, toFrame?, maxSegments? }` 紧凑短语视图，分页，未返回=未知；
   - `find_transcript { query, sourceAssetId? }` **时间坐标查询**：返回命中句帧区间列表（OpenChatCut 定位：找一句话什么时候说，不是转写阅读器）。
4. **媒体档位参数服务端 derive**（对 #646 C0 的 8/8 漏填教训）：模型/语言从项目与引擎默认 derive，schema 不要求模型填。
5. **隐私**：沿用既有披露模式（外部提交精确选区需明示）；本地 whisper.cpp 为 v2 降级路径，登记不阻塞。

## 落点

`electron/video/understanding.ts`（新）、`electron/video/deconstructVideo.ts`（改消费）、`electron/shared/agentCapabilities/`（capability+aliases）、素材库 schema、`agentChatPolicy.ts:35`（挂 canvas-agent 组）。

## 分期

T1 服务抽取+资产落库 → T2 两工具进 lane+评测 → T3 拆解引擎切换消费。

## 验收门

10 分钟口播 → 转写 → `find_transcript("价格")` 帧区间正确 → `read_transcript` 分页正确；无音频视频诚实返回 `hasAudio:false` 不造空段；拆解引擎行为回归不变（对照基线）；五门绿。

## 回滚

资产字段可空；工具摘除无迁移；拆解引擎消费切换可单独 revert。
