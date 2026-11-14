# Agent 的上限与时限：每次请求的输入预算 · 写入回执的准备时限与已知拒绝

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实现（PR 见开 PR 后的正文）。来源：铁律走查 pb04（长对话）的两条规则 `input-tokens-over-budget`（10 次）、`agent-write-receipt-stuck`（1 次）；真实用户反馈两条——「Assistant request exceeded the context window」「这一步的结果没对上账，先别按已完成算」。
> 对应合同：`docs/fixes/2026-10-01-agent-request-input-budget.root-cause.json`、`docs/fixes/2026-10-01-agent-write-receipt-stuck.root-cause.json`。

## 改动说明

| | 内容 |
|---|---|
| 新增 | 写入回执的「准备中」有了由回执主人定的时限，到点落到终态；渲染层明确回的「目标已过期」按已知拒绝处理 |
| 改变 | **用 pi 自带的压缩，只改它的配置**（`laneCompactionSettings`）：触发线放在每次请求预算的 3/4（pi 只在回合之间量，跨线那一次请求仍会按「线 + 一个回合的工具结果」发出）；`keepRecentTokens` 按 pi 的估算单位给 5,000（pi 把保留的尾巴按 chars/4 估算，中文一字约一个 token，默认的 20,000 实际会留下约 8 万 token）。渲染层回 `surface_port_stale` 的写入不再被说成「结果没对上账」，而是如实说「目标已过期、什么都没执行」 |
| 去掉 | 一份自己写的「每次请求裁剪」（`laneContextFit`，本 PR 内写了又删，不进主干）；没有去掉任何能力 |

## 自己写了什么、为什么必须自己写

| 自己写的 | 为什么不能用框架现成的 | 理由类型 |
|---|---|---|
| 无（压缩全是 pi 的：触发、切点、摘要、尾巴、落盘条目；我们只提供设置值） | — | — |
| 回执「准备中」的 75 秒到期结算（`projectAgentProposalReceiptStore`） | 回执是我们自己的账（提案 → 写入 → 对账），pi 不知道它的存在；pi 对工具执行只提供中止信号（我们已经用 `AbortSignal.timeout` 在 `laneTools.mts` 接了），没有「工具超时 → 回执终态」的设置 | 领域约束：回执状态机是 Nomi 的领域对象 |
| `surface_port_stale` 的归类 | 这是我们渲染层与主进程之间的协议码 | 领域约束：我们自己的协议 |

## 先查别人

- **pi 自带压缩（本 PR 的第一结论）**：`node_modules/@earendil-works/pi-coding-agent/docs/compaction.md`：触发是 `contextTokens > contextWindow - reserveTokens`，切点向前累计到 `keepRecentTokens`，只在回合之间量；实现 `pi-agent-core/dist/harness/compaction/compaction.js:117-148`（`estimateContextTokens` / `shouldCompact`）与 `harness/runtime/drive/structural.js:837-870`（阈值压缩何时被准备）。**我们的 lane 一直开着它**（`laneContextBudget.mts`，`e07781284` 起，阈值 80,000）。真模型 10 轮实测发现它「开着但没用」：触发那次请求已达 86-90K，随后压缩只摘了 3-6 条、保留 27 条（因为切点把中文按 chars/4 估，低估 3-4 倍），第二天的用户报告就是这么超窗的。结论：不另写裁剪，调 pi 的两个设置（触发线留一个回合的余量；`keepRecentTokens` 按 pi 估算单位给小值）。
- **压缩要不要花钱**：pi 的摘要要多调一次模型。实测（真模型 10 轮）每压缩一次那一轮多 30-70 秒。这是接受的代价，换来的是不超窗；文本模型的摘要成本远低于超窗失败后的整轮重试。（用户不允许付费摘要的领域理由不存在：摘要走的就是用户已选的那一个文本模型。）
- **上下文快满时先清旧工具结果，而不是先摘要**：Anthropic context editing（`clear_tool_uses_20250919`）——https://platform.claude.com/docs/en/build-with-claude/context-editing ；Anthropic 工程博客——https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents ；SWE-agent `LastNObservations`——https://swe-agent.com/latest/reference/history_processor_config/ ；JetBrains 观察掩码对比摘要——https://arxiv.org/abs/2508.21433 。结论：这是另一条思路（不调模型的裁剪）。第一版我们照它写了 `laneContextFit`，后来发现 pi 的压缩只要两个设置对了就够用，就删了那份自写件（P1：框架有的不再写第二份）。
- **工具调用超时以后怎么跟模型和用户说**：OpenAI Agents SDK 函数工具 `timeout_behavior="error_as_result"`——https://openai.github.io/openai-agents-python/tools/ ；MCP 规范（请求要有超时、超时发取消、取消与完成会竞态）——https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle 、https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/cancellation 。pi 工具执行侧只有中止信号，没有超时设置（`pi-agent-core/dist/harness/types.d.ts` 中只有 provider 请求的 `timeoutMs` 与 bash 的 `timeout`）。结论：准备态要有主人定的时限、到点有终态、告诉模型发生了什么；晚到的结果不能改写已收场的终态；时限只是兜底，明确拒绝当场收场。

## 概念的唯一主人

| 概念 | 主人 | 登记 |
|---|---|---|
| 每一次模型请求的输入预算（翻成 pi 压缩设置） | `electron/agentLane/laneContextBudget.mts` `laneCompactionSettings` | `agent-lane.request-input-budget` |
| 写入回执「准备中」的时限与终态 | `electron/capabilityCore/projectAgentProposalReceiptStore.ts` `createProjectAgentProposalReceiptService` | `agent-proposal.receipt-preparing-deadline` |
| 渲染层写入回复的结局归类（明确拒绝 / 结局不明） | `electron/capabilityCore/canvasReadSurfacePort.ts` `createCanvasReadSurfacePortRuntime` | `capability.surface-write-outcome` |

## 测试

`tests/agent-runtime/lane-context-budget.test.mts`（C61 触发线与保留尾巴）、`electron/capabilityCore/projectAgentProposalReceiptStore.test.ts`、`electron/capabilityCore/canvasReadSurfacePort.test.ts`；真应用 pb04 长对话（每次请求输入 token、回执终态）；真文本模型 10 回合的前后对比（`tests/ux/agent-long-chat-real.paid.mjs`）。

## 回滚

两件互相独立：预算（`laneContextBudget.mts` 的两个常量）、回执（`projectAgentProposalReceiptStore.ts` 的 `settleExpired` + `canvasReadSurfacePort.ts` 的一行分类）。
