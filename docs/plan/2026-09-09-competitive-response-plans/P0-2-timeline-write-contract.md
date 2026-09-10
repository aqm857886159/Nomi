# A' + X1 · 时间轴写入契约（kernel 投影 + 一致性门）

> 状态：📋 方案待拍板（2026-09-09 定稿，2026-09-11 归档入库）

> 详版：[agent 原生剪辑方案 A'](../2026-09-09-agent-native-editing-plan.md) · 落点修正：[剪辑栈底层分析 §4-X1](../../research/2026-09-09-nomi-editing-architecture-analysis.md)

## 目标

agent 能对时间轴做结构化写操作（重排/裁切/字幕/转场/配乐），每次写入=可撤销提案；操作词表单一真相源 = `timelineKernel.ts` 的 `TimelineOperation`。

## 关键事实（当日实核）

- `src/workbench/timeline/kernel/timelineKernel.ts`：10 操作原语 + `applyTimelineOperations` 事务 + `diffTimelines` + `validateTimeline` + **`timelineRevision` CAS**（`:690`，stale_revision 诊断 `:731`）。
- agent 写入目标 `timelineCapabilityTarget.ts:167/278` **已消费内核**（expectedRevision 进出）。
- 唯一断点：`propose_edit_plan` 契约因 transition/text 两支 `action` 形状不同被 `flattenDiscriminatedUnion` 拒收（`laneTimelineTools.ts:14-24`，修法作者已写明）。

## 设计

1. **词表 owner = kernel**：lane 契约从 `TimelineOperation` union **derive 生成**（类型级 derive 或 codegen），kernel 加操作契约自动跟上，漂移编译期红。
2. **统一 `action` 形状**：transition/text 两支改同一 discriminated shape（`{kind, params}`），差额下沉各自 refine（复用 `canvasWriteCrossFieldRefine` 单一 owner 模式）。
3. **v1 操作集只发布引擎渲染得了的值**：重排/帧级 trim（source-window）/clip 音频（`clipAudio.ts` 字段）/text clip/transition（`dissolve|fade|cut`，与 `ffmpegFiltergraph.ts` 支持集一致）；变速、match_cut 不进 v1。
4. **每操作带 `affects` 影响范围**：计划卡按 affects 分组渲染（直修 C0「审批项逐个展开辨认」摩擦）。
5. **schema 附 3 示例**（对照 `nomi_canvas_write` examples 模式）；守则三条：帧原生、revision 乐观锁（重读再试）、重叠先 read。
6. **新门 `check:timeline-contract`**（R17，先验会红）：`TimelineOperation` 词表 vs 工具 schema vs `ffmpegFiltergraph` 支持集三处一致，否则红——同时治「契约发布引擎渲染不了的值」。
7. 执行端走 kernel `applyTimelineOperations` + 采纳桥同族幂等（整批一事务一步撤销）；**不写第二条落轴路径**。

## 分期

T1 契约改形+先红测试 → T2 lane 接线+计划卡分组 → T3 评测进 #547 同族跑分。

## 验收门

真实任务「第 3/5 镜对调 + 全片字幕 24 号 + 4–6 镜 dissolve」→ 计划卡可读（人眼）→ 批准 → 一步撤销；stale revision 重试先红后绿；`check:timeline-contract` 入 gates；五门绿。

## 增长政策（2026-09-09 补）

新能力=现有 ops-union 工具加操作分支，不是新工具；新工具仅限新副作用域；工具名保持域前缀（mask 不增删 schema，Manus 原则）。依据：[工具面极简主义](../../research/2026-09-09-agent-tool-surface-minimalism.md)。常驻工具面目标 ≤16。

## 回滚

工具从 lane 目录摘除即回只读态；契约层无数据迁移。
