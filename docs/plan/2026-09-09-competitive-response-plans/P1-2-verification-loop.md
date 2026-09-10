# D' + X5 · 验证环 + 导出预检

> 状态：📋 方案待拍板（2026-09-09 定稿，2026-09-11 归档入库）

> 详版：[agent 原生剪辑方案 D'](../2026-09-09-agent-native-editing-plan.md) · 竞品教训：OpenChatCut #113/#114、Velorn 95 分钟导出丢音轨、TimelineStudio #100 双端漂移

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
