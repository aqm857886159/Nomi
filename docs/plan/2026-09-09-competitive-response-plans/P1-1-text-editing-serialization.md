# C' + X3 · 文本式剪辑 + 序列化双形态

> 状态：📋 方案待拍板（2026-09-09 定稿，2026-09-11 归档入库）

> 详版：[agent 原生剪辑方案 C'](../2026-09-09-agent-native-editing-plan.md) · 范式鼻祖：Descript；开源实证：OpenChatCut read_script/apply_script

## 先查别人

- 生态里已有？—— [AI 视频编辑版图与缺口](../../research/2026-09-09-ai-video-editing-landscape-and-gap.md) 已核过 `modelscope/FunClip`（选文本段/说话人→剪出对应片段）与 FireRed-OpenStoryline（全 NL 剪辑：切/换/重排/调色/字体/位置）两条独立的文本式剪辑实现，「文本改动=视频改动」不是本方案独创的假设，是这个赛道的共识范式（Descript 首创，多家跟进）。
- 仓库里已有？—— 序列化器要投影的时间轴数据已有唯一真相源：`src/workbench/timeline/kernel/timelineKernel.ts:10` 的 `TimelineOperation`；本方案「segment-id 编码的 Markdown」是这个既有类型的一个视图/投影，不是给时间轴另开一份平行状态。
- 仓库里已有？—— transcript 层（[P0-3](P0-3-transcript-layer.md)）已经规划复用现有 whisper 链路（`electron/video/extractAudioTrack.ts:1`）产出词级时间戳，本方案的 segment-id 编码直接消费 P0-3 的产物，不重复造一份转写。
- 结论：文本式剪辑是「既有 kernel 数据 + 既有 transcript 产物」的一层 Markdown 投影/反投影，双向序列化本身是新增代码，但两端的数据源都已存在，不是从零建模型。

## 目标

时间轴可物化为 segment-id 编码的 Markdown，人或 agent 改文本=剪辑视频；序列化器同时服务 agent 工具、调试与未来互操作。

## 设计

1. **序列化器唯一 owner**（kernel 同目录）：`serializeTimeline(timeline, {format: "markdown"|"json"})`——markdown=segment-id 编码（人可读）；json=完整投影（调试/互操作入口，「项目文件即接口」谱系）。
2. `read_script`：按轨分节，每片段一行 `{segId} [{start}-{end}] (sourceIn-out) text/summary`；segId 稳定持久（物化→改→回写幂等）。
3. `apply_script`：Markdown diff → **A' 的 kernel 操作序列** → 同一提案/采纳桥链路（不写第二条落轴路径）；无效行整批拒绝+人话原因+行号。
4. 删 segId 行 = 删片段 + 同轨 ripple 收口（v1 同轨，写进工具描述）；无转写片段行退化为序号+时长仍可重排/删。

## 落点

kernel 同目录序列化器、`electron/shared/agentCapabilities/`（script 契约）、采纳桥执行端、`src/workbench/timeline/`（回读预览）。

## 分期

T1 物化器+稳定 segId → T2 apply→操作序列编译器 → T3 lane 工具+走查。

## 验收门

15 分钟口播 → read_script → 删 3 段口水词 → apply → 成片时长缩短且无口型断裂（人眼）；round-trip（serialize→apply→serialize）幂等且 diff 稳定；乱序 segId/未知行整批拒绝先红后绿。

## 回滚

Markdown 是投影不是真相源；工具摘除无迁移。
