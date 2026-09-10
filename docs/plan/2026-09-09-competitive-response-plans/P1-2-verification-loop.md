# D' + X5 · 验证环 + 导出预检

> 状态：📋 方案待拍板（2026-09-09 定稿，2026-09-11 归档入库）

> 详版：[agent 原生剪辑方案 D'](../2026-09-09-agent-native-editing-plan.md) · 竞品教训：OpenChatCut #113/#114、Velorn 95 分钟导出丢音轨、TimelineStudio #100 双端漂移

## 先查别人

- 生态里已有？—— [Agent 原生剪辑版图调研](../../research/2026-09-09-agent-native-video-editing-landscape.md) 已核实 `MartinDelophy/ai-video-editor`（Timeline Studio）2026-09-08 刚给 agent 加了「apply 前给语义 diff 预览」的机制，本方案「agent 抽帧自检引用帧号」的验证环设计与该先例同构，双端漂移（TimelineStudio #100）是它已踩过的坑，本方案的「同一帧 resolver」设计正是为规避这个已知失败模式。
- 仓库里已有？—— 生成节点已有的帧解析实现在 `src/workbench/generationCanvas/runner/relayFrameResolver.ts:1`，`preview_timeline_frames` 要求的「renderer 用同一帧 resolver 抽帧」直接点名与这个既有文件同源，不是重新实现一套帧提取逻辑。
- 仓库里已有？—— `get_media` 只回稳定 asset ID 不出本地路径的纪律已是既有约定：`src/workbench/generationCanvas/agent/gate.ts:36` 的 `get_media: { writes: false }` 门禁声明，本方案的抽帧返回格式沿用同一条纪律。
- 结论：验证环不是自研新的渲染管线，是把已经存在的帧 resolver 包一层 agent 可调用的接口，同时吸收了 OpenChatCut/Velorn/TimelineStudio 三家已公开的失败教训。

## 目标

agent 改完能「看见」结果；导出前失败在起跑前暴露。纪律基线：「agent 验证 ≠ 用户批准」「报告完成前验证真实结果+依赖元素」。

## 设计

1. **`preview_timeline_frames { fromFrame, toFrame, maxFrames? }`**：renderer 用 L3 **同一帧 resolver** 抽帧（与预览逐位同源，杜绝 TimelineStudio #100 式双端漂移），返回有界帧图，只回稳定 asset ID 不出本地路径（`get_media` 纪律）。
2. **`verify_export` 升级**：现有 receipt-level 校验之上加抽帧自检（导出完成自动抽 N 帧回 agent，人眼/模型双审可选）；明确不冒充逐帧质检（诚实边界照旧）。
3. **导出前 validateOnly 预检**（对齐 Velorn 教训）：起渲染前校验音轨存在性/素材可达性（exportManifest 校验补「有声轨素材缺失」用例）。
4. **依赖元素检查清单进工具守则**：结构改动后提示 agent 检查字幕/转场/音频对齐（ChatCut 纪律落地）。

## 落点

`src/workbench/timeline/agent/`（mediaToolCall 同族）、`electron/export/exportManifest.ts`、导出链帧 resolver 复用。

## 分期

T1 帧回读工具 → T2 verify_export 升级+预检用例 → T3 守则+走查。

## 验收门

粗剪提案批准后 agent 主动抽帧自检并在回复里引用帧号；导出 verify 返回抽帧结果；缺音轨素材在起渲染前报人话错误；隐私走查（无本地路径泄漏）。

## 回滚

纯增量工具，摘除无迁移。
