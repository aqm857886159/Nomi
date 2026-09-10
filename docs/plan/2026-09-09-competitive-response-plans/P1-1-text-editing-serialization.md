# C' + X3 · 文本式剪辑 + 序列化双形态

> 状态：📋 方案待拍板（2026-09-09 定稿，2026-09-11 归档入库）

> 详版：[agent 原生剪辑方案 C'](../2026-09-09-agent-native-editing-plan.md) · 范式鼻祖：Descript；开源实证：OpenChatCut read_script/apply_script

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
