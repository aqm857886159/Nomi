# A · 把 #646 推过合并门（全局瓶颈）

> 状态：📋 方案待拍板（2026-09-09 定稿，2026-09-11 归档入库）

> 详版依据：PR #646 三轮 C0 失败实录 + [AdCraft 对比文档方案 A](../../product/2026-09-09-adcraft-vs-nomi-full-comparison-and-plan.md)

## 先查别人

- 仓库里已有？—— A1 工具契约收敛的落点 `electron/shared/agentCapabilities/canvasWrite.ts:1` 已经是画布写工具的现有实现文件，本刀是在这个文件里收敛 schema，不是新建一层写入通路。
- 仓库里已有？—— capability 路由 `electron/harness/agentChatPolicy.ts:80` 的 `agentToolsForCapability` 已存在，A1/A2/A3 三刀都在这条既有路由之上改契约/UI/提示词，不改路由本身。
- 生态里已有？—— [AdCraft 全面对比与方案](../../product/2026-09-09-adcraft-vs-nomi-full-comparison-and-plan.md) 方案 A 一节已经把「operation 类路由字段按动作派生/给默认值」的哲学核对过 AdCraft 的对应实现，A1 的具体做法沿用该结论而非另起炉灶。
- 结论：三刀全部落在已存在的文件与路由上做收敛式修改，PR #646 本身三轮失败的根因（schema 错/审批摩擦/语言）已有实录佐证，不是重新猜测。

## 目标

agent 阶段 4 原子切换 PR #646 通过其既有合并门：L2 回放全绿（语料补到 200 回合）+ 打包 C0 真短片**一次通过**（出 MP4、13 截图全、R30 首调与回合成功率给正式数字）。三轮已失败根因不是模型能力，是三件可修的事。

## 三刀

### A1 工具契约收敛（治「首调 schema 错、媒体档位 8/8 漏填」）
- `operation` 类路由字段：改为按动作派生或给模型默认值（AdCraft 哲学：让「模型想错都难」）。
- `modelKey`/`params.resolution` 等媒体档位：schema 带 enum 或从项目默认 derive；模型漏填时容忍族兜底 + 回执提示，**禁止静默存空**。
- 错误回话改成模型可自纠的人话（缺什么字段、合法值是什么）。
- 消灭 schema 语言错误（`nomi_generation_plan` 顶层 `type:None` 直接 HTTP400 那类）。
- 落点：`electron/harness/tools/`、`electron/shared/agentCapabilities/canvasWrite.ts`、`laneCanvasTools.ts`。

### A2 审批卡与阅读区（治 6 类 UI 摩擦）
- 审批卡默认展开摘要：镜号+缩略图+档位一行看全（对齐 #646 记录的「审批项仅镜号需逐个展开辨认」）。
- 思考/anchor/carrier 文本折叠进「过程」区默认收起。
- 模型名不截断、显示档位徽标。
- 落点：`src/workbench/ai/lane/`（laneViewModel + v4 组件），owner=agent-panel。

### A3 语言漂移
- 项目/任务级「输出语言」约束注入系统段；C0 断言加「标题与答复语言一致」。
- 落点：`electron/agentLane/` system prompt 装配处。

## 依赖与预算

#659（¥50 预算+180s 推理等待）已就绪；#658 诚实反馈语汇可复用。预算边界纪律照旧（全局 ¥50 账本硬拦，已累计实付 ≈¥0.19）。

## 验收门（=#646 既有门，不放松）

1. L2 回放全绿（138 现状→补 200 语料）。
2. 打包 C0 真短片一次通过：完整 8 镜/H3 64s 流程出 MP4、13 截图全、R30 正式数字（首调写对率与回合成功率）。
3. 六类体验摩擦逐条消失（截图人眼复核）。

## 回滚

不合并即无影响；#646 自带回滚演练记录（`docs/plan/2026-09-08-agent-lane-rollback-rehearsal.md`），正式回滚针对届时实际 merge SHA 另开回滚 PR。
