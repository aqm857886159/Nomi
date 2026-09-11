# pi 运行时设计研究：本地考古 + 上游调研 → 方案迭代

> 2026-09-10 · 方法：①本地 `node_modules/@earendil-works/*` 源码考古（最权威——我们实际装的版本）②上游 earendil-works/pi 仓库/changelog/设计文档调研（2 子代理并行）
> 定位：此前所有方案（P0-1/P0-2/P0-3/IMPL）都建立在「pi 会给我们什么」的假设上，本文核实假设、修正方案。

---

## 一、版本事实核对（第一个意外）

`package.json` overrides 锁六包 **0.85.1**，但 `node_modules/@earendil-works/` 实际只装了 **三个包且均为 0.84.3**（pi-agent-core / pi-ai / pi-coding-agent）；chord、pi-tui 未在顶层（pi-telemetry 是传递依赖）。**锁版本 ≠ 装版本**——升级验证必须以 `node_modules` 实况为准。

## 二、pi API 面（本地 0.84.3 考古，全部带 包:文件:导出）

| 域 | pi 原生提供 |
|---|---|
| 工具注册 | `pi-ai:types.d.ts:Tool {name, description, parameters: TSchema}`——**TSchema 是 typebox，不认 zod**；运行时 `AgentTool` 加 `label / prepareArguments（校验前容忍钩子）/ execute(toolCallId, params, signal?, onUpdate?) / executionMode` |
| **收据** | `AgentToolResult {content, details, usage?, addedToolNames?, terminate?}`——**`details` 就是官方结构化回执位**（"for logs or UI rendering"），我们的收据纪律天然对位 |
| **审批** | **原生 `Hooks.on('before_tool')` + `BeforeToolCallResult {block?, reason?, terminate?}`**——block 即拦截，reason 成为模型看到的错误结果。`laneHost.mts:93` 已接。宿主不用自建审批通道 |
| 会话/恢复 | JSONL V4（header{cwd, parentSessionId?}）；**公开 append API 已存在**（appendMessage/appendCustomEntry/appendEntry/appendRecord）；崩溃恢复 `AgentHarness.create → {harness, suspended[]}`；分叉 navigateTree/createLane |
| 重试/队列/费用 | `RetryPolicy`+指数退避；steer/followUp/nextRun 三队列+QueueMode；`Usage{...,cost{...}}` 主动记账 |
| 结构化输出 | **无原生 response_format**；仅 `ConstrainedSamplingConfig`（json_schema strict/grammar）。形状校验=typebox+ajv；zod pi 不认识——**G-08 的「ajv 形状→execute 内 zod 契约 parse」对路且是唯一出口** |
| 上下文 | `CompactionSettings`+before_compaction/transform_context 钩子；工具结果**无强制大小限制**，`truncateHead` 是原料，截断策略靠工具层自建（Nomi 的 truncateForModel 已建） |

## 三、上游设计哲学与状态（第二个意外，重大）

- 仓库现为 **earendil-works/pi**（原 badlogic/pi-mono），MIT，六包 lockstep。95.9k stars；OpenClaw 以 pi 为 Gateway 核心；Sentry、Armin Ronacher 在用。定位：「确定性、可观测、可组合的最小 harness」，不是 Claude Code 复刻。
- 哲学："An autonomous agent is just an LLM + tools + a loop"。**明确不做清单：No MCP（CLI+README Skills 替代，225 tokens vs 13,700）、No sub-agents、No permission popups（进容器）、No plan mode、No built-in to-dos（"They confuse models"）。**
- Agent loop：双层 while（内层 tool-call+steering，外层 follow-up），AgentMessage 贯穿、调 LLM 时才 convertToLlm（late conversion）。
- ⚠️ **Lane/AgentHarness v2 不是稳定 API**：release notes 未把 Lane 列为 0.85 正式特性；它来自一份 3,446 行设计文档（intent-first 预写日志、append-only 上下文保护 KV cache）；第三方实测 `prompt()/resume()/compact()/navigateTree()` **仍抛 HarnessNotImplemented**——Lane 当前=设计规范+实验代码。

## 四、方案迭代（四条修正）

1. **P0-1 风险登记更新**：#646 切 Lane 的上游依赖**本身是实验性 API**（HarnessNotImplemented 实测）。合并门建议加一条风险记录：若 Lane API 未达稳定，退路是重做方案岔路 1 的 B 档（layer ⑤ 加厚、不用 Lane 类）。这解释了三轮 C0 之外 #646 迟迟不过门的另一半原因。
2. **IMPL 工具契约双形态写明**：pi 侧 typebox/JSON schema（`flattenDiscriminatedUnion` 已产出）+ execute 内 zod 契约 parse（G-08 唯一出口）。`edit_timeline`/`read_transcript`/`find_transcript` 全按此注册为**稳定 AgentTool**（Agent+Session+before_tool 层），**不依赖 Lane 实验面**。
3. **计划卡批准 = 原生 before_tool 钩子**：`block:{reason}` 就是「等用户批准」的官方挂点（reason 可直接承载计划卡文案）。IMPL 的 TimelineWritePort 不新增审批通道，挂既有钩子；`appendCustomEntry` 落提案/批准领域记录（#646 的公开 append API 用法正确）。
4. **升级纪律**：必须锁 **0.85.1**（0.85.0 曾误发实验 subpaths 致 SDK import 失败）；六包 lockstep 一起动；行为风险集中在 fork 丢 compaction 边界（#8990）/fork 早于 turn settle（#8937）；上游 shrinkwrap 与我们 overrides 叠加需排查。

## 五、立场对齐确认

- pi「No MCP」与我们「对外 MCP 面」**不冲突**：pi 是内部运行时，MCP 是 Nomi 作为宿主对外提供的服务层——两层各司其职。
- pi「few tools + late conversion + 最小 harness」与[工具面极简主义](2026-09-09-agent-tool-surface-minimalism.md)完全同向——选 pi 这条底座是三次独立验证（AdCraft 同栈 / 上游哲学 / 我们的自研纪律）。
- pi「No built-in to-dos（They confuse models）」给计划卡一个提醒：**计划卡是用户侧确认物，不是注入给模型的 todo**——别把它塞进系统段。

---
*执行：2 子代理（本地考古 + 上游调研）；版本差异与 HarnessNotImplemented 为最关键两条修正。*
