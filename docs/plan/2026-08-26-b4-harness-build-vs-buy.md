# B4「统一 Harness 核心」build-vs-buy 调研与选型（2026-08-26）

> 本轮是调研/取舍交付，不包含实现代码。代码事实均以本轮 `git fetch origin main` 后的 `origin/main` 为准（当前基线 `b16b8dfe`）。外部资料于 2026-08-26 复核；“现役”只表示在该日期仍有官方文档、源码或发布活动，不等于适合 Nomi。

## 0. 先给 owner 的判断

B4 四件套不应买一个全栈 agent runtime 来替换 Nomi 的控制面。最稳的边界是：

1. **事件溯源日志：自建并扩展已有两条日志**。通用日志层已经存在；ProductionRun/预算/收据/幂等继续做领域事实源，不能被外部 event store 改写。
2. **Thread / Turn / Item：借形状，自建领域投影**。AI SDK 7、OpenAI Agents JS、ACP/Codex App Server 都有可借的消息/运行事件形状，但没有一个同时满足 Nomi 的项目、Run、Proposal、撤销和两宿主投影。
3. **策略引擎：自建**。这是预算、能力核、来源绑定、幂等与权限的护城河；外部框架只能提供 guardrail/interrupt 的机械参考。
4. **单一审批信道：自建语义 + 买协议适配**。内部 IPC 与 MCP elicitation 都接同一个确认域；不把 SDK 的 approval 类型倒灌到业务模型。

主方案 §2 的“最核心”四件保持不变；§3 的配置层收敛仍是 B4 前置清理，而不是借框架绕过它。

## 1. 外部现状（Context7 + 官方网页/源码）

### 1.1 现役方案总表

| 方案（官方来源） | 2026-08-26 可核实能力 | 维护/日期证据 | 对 B4 的可买边界 |
|---|---|---|---|
| **Vercel AI SDK 7**（[官方 changelog](https://vercel.com/changelog/ai-sdk-7)，2026-06-25；[官方仓库](https://github.com/vercel/ai)） | `ToolLoopAgent`/`WorkflowAgent`、工具审批、可恢复 workflow、超时、telemetry/OTel、MCP Apps；新增 `HarnessAgent` 与 Claude Code/Codex/Deep Agents/OpenCode/Pi adapters。[Context7 `/vercel/ai`](https://github.com/vercel/ai/blob/main/content/docs/07-reference/04-ai-sdk-workflow/01-workflow-agent.mdx) 也确认 agent loop/多步工具调用。 | 官方 changelog 2026-06-25 明列 SDK 7；仓库/文档在本轮仍更新。 | **买模型抽象、流式、工具循环及事件/审批的接口形状；SDK 7 的 durable/harness 能力先做兼容性 spike，不直接接管账本或 Run。** |
| **MCP TypeScript SDK v2**（[官方仓库](https://github.com/modelcontextprotocol/typescript-sdk)，[SDK tiers](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/sdk.mdx)） | v2 对齐 2026-07-28 规范；server/client split、stdio/Streamable HTTP、schema 校验、cancellation/lifecycle、elicitation、协议版本协商；v1.x 仍有 bug/security maintenance。[Context7 `/modelcontextprotocol/typescript-sdk`](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/elicitation.md) 给出 input-required/URL elicitation。 | 官方仓库 2026-08-26 标为 v2 stable；v1.x 至少维护 6 个月；官方 repo 活跃（2026-08-20 有更新记录）。 | **买 wire/protocol 语义**：elicitation、取消、schema、transport；不买审批/预算权限，不让 MCP 类型成为 Nomi 领域模型。v2 是否进入产品是待拍板兼容性问题。 |
| **LangGraph 1.x**（[官方仓库](https://github.com/langchain-ai/langgraph)，[releases](https://github.com/langchain-ai/langgraph/releases)，[JS docs](https://reference.langchain.com/javascript/langgraph/)） | 有 graph state、checkpoints/durability、streaming、interrupt/resume 人在回路；Context7 `/langchain-ai/langgraph` 记录 v1.0 将 `checkpoint_during` 收敛为 `durability: sync/async/exit`，并保留 `Command(resume=...)`。 | 官方 releases 显示 `1.2.11` 于 2026-08-11 发布；本轮 2026-08-26 仍有维护活动。 | **不买作 Nomi runtime**：它的价值是多步 workflow/stateful HITL 参考；引入会带图运行时、checkpointer 和跨语言/部署面，且会与现有同步 Electron loop、ProductionRun 事实源重叠。 |
| **Mastra 1.x**（[官方 blog](https://mastra.ai/blog)，[GitHub releases](https://github.com/mastra-ai/mastra/releases)） | TypeScript agent/workflow；durable agent、suspend/resume、`requireToolApproval`、thread/resource memory、event ingestion；2026-08-19/25 仍在加细粒度 authorization、tool/skill search、多轮 eval。Context7 `/mastra-ai/mastra` 给出 `listSuspendedRuns`/`approveToolCall`/`resume`。 | 官方 blog 2026-08-25、GitHub release 2026-08-21（1.61.0）均有更新。 | **可买编排/评测参考，不买核心控制面**。`@mastra/core` 已在 `origin/main` 的 devDependencies（`package.json:153-162`），但只用于 `evals/`；它不是产品 runtime 的白拿依赖，且 peer 需要 AI SDK 6/7。 |
| **OpenAI Agents JS**（[官方 JS docs](https://openai.github.io/openai-agents-js/)，[repo/releases](https://github.com/openai/openai-agents-js/releases)） | Agents/handoffs/guardrails/MCP、Session 持久化（`getItems/addItems/popItem`）、tracing；Context7 `/openai/openai-agents-js` 给出 Session interface 与 trace 事件。 | 官方 release process 明说 0.Y.Z 仍快速演化，未到 1.0；`v0.17.0` 于 2026-08-19 发布，故仍维护但 API 风险高。 | **只借 Session/trace/guardrail 形状**。OpenAI-first 的 runner、handoff 与 Nomi BYO vendor/账本不匹配，不能替代统一 harness。 |
| **KurrentDB / EventStoreDB**（[Kurrent concepts](https://docs.kurrent.io/getting-started/concepts)，[Node client](https://docs.kurrent.io/clients/node/)） | 真正的 append-only event store、optimistic concurrency、subscriptions/projections；Node SDK v1.x。旧 `@eventstore/db-client` npm 包最后发布约两年前（[npm evidence](https://www.npmjs.com/package/%40eventstore/db-client)）。 | Kurrent docs v26.1 与 Node v1.3 文档于 2026-08-26 可访问；KurrentDB 是活跃产品，但 Kurrent License v1 不是 OSI-approved。 | **不直接买**：它需要外部 DB/运维/许可证并改变本地优先部署；只借 event-sourcing 语义与 concurrency test ideas。 |
| **Temporal TypeScript SDK**（[官方 repo](https://github.com/temporalio/sdk-typescript)） | durable execution、workflow history、replay、activities；Node worker 依赖 native modules/worker_threads/vm。 | 官方 repo 的 latest release 页显示 1.21.1 于 2026-07-24 发布，仍维护。 | **不买**：服务端与 worker 运行时远超 B4 范围，且其 history 不是 Nomi 的用户可见事件流/账本。 |

### 1.2 会话消息建模：谁有“Thread / Turn / Item”

没有一个外部方案可直接成为 Nomi 的四层领域模型：

- **AI SDK 7** 的 `Agent`/`UIMessage`/多步 stream 更接近“运行消息与 UI parts”；它提供工具调用、审批、流式和 telemetry，但不定义 Nomi 的 project-scoped Thread、可重放 Turn、Proposal/撤销 Item。
- **OpenAI Agents JS** 的 `Session` 是最接近的现成接口（`getItems/addItems`），但它是模型输入历史存储，不是 Nomi 的事实事件日志。
- **Mastra** 以 `threadId + resourceId` 持久化 memory，并把 active-turn delivery 标进 transcript；它更像 runtime/session store。
- **LangGraph** 用 thread/checkpoint/interrupt/resume 表达执行状态；它不是 UI Item 分类学。
- **ACP/Codex App Server**（主方案对齐对象）适合拿 `started → delta* → completed` 的事件形状；协议层不拥有 Nomi 领域权限。

结论：**买形状、自己定义语义**。Nomi 的 `Thread/Turn/Item` 必须能关联 `projectId/runId/causeId/txnId/proposalId`，并能投影到内部 UI 与 MCP 两个宿主。

### 1.3 事件溯源库是否值得直接吃

通用 event store 的强项是持久化、序列一致性、订阅和并发控制；它们的弱项正好撞 Nomi 约束：外部 server、远程运维、跨进程部署与许可证，且不知道本地素材路径、预算收据、Proposal/撤销和能力核。当前 Nomi 已有按项目 JSONL 的单写者、seq 高水位恢复、4KB cap/sidecar/redaction；再引入 KurrentDB/EventStoreDB 会制造两套事实源。**B4 应扩展现有日志，不增加 event-store 依赖。**

## 2. 内部代码实查（`origin/main`，file:line）

### 2.1 已有事件/Run/调度设施

| 已有机制 | 证据 | 判断 |
|---|---|---|
| 通用观察事件日志 | `electron/events/eventLogRepository.ts:1-36,62-73,218-249`：按项目 `.nomi/events/log-*.jsonl`，单写者 seq、分段、4KB cap、sidecar、redaction；`electron/events/types.ts:9-26` 定义 `id/seq/source/causeId/txnId/proposalId/type/payload`。 | 已有 B4 事件骨架；旁路失败不阻断产品，不能直接宣称它已是 Run 事实源。 |
| Agent 轨迹 | `electron/events/agentChatTrace.ts:34-160`：turn start、tool proposed/result、gate denied、context capped 均写入上述日志。 | 可作为 Thread/Turn/Item 的输入投影，不应再造第二条 chat log。 |
| ProductionRun 账本/事件 | `electron/productionRun/productionRunRepository.ts:90-112,256-283` 创建 append-only `run.created/gate.waiting`；`:360-481` 以 commandId/revision 做幂等与 optimistic concurrency，追加事件、commands、snapshot。 | **保护项**。它是生产事实源，不能被 AI SDK/Mastra/KurrentDB 反向改写。 |
| 预算、审批、幂等 | `productionRunRepository.ts:379-448` 将 approval 写入 approvals JSONL，将 authorize 写入 budget ledger；`productionRunIntentLog.ts:7-25,100-112,201-280` 有 hash-chain、HMAC、fencing epoch、prepared→committed/aborted。 | 这是钱与一致性的护城河；外部 runtime 只能调用 command/receipt。 |
| Run 事件投影/`nomi_get_run` | `electron/productionRun/productionRunService.ts:53-76,713-756,781-789` 提供 safe projection、事件 cursor/long-poll；`electron/capabilityCore/mcpToolResults.ts:436-475` 把 gates/budget/artifacts/status 转成 `nomi_get_run`。 | B4 Item projection 应从这里派生，不另存一份 UI 状态。 |
| 调度器 | `electron/productionRun/multiShotBatchScheduler.ts:125-155,329-377` 通过 `repository.execute` 驱动 dispatch/poll/materialize，预算 halt/checkpoint rest/re-kick 均是 Run 状态。 | 外部 durable runtime 会与它竞争“谁负责恢复/等待”；暂不引入。 |

### 2.2 已有审批/策略信道

- **内部 Agent confirmation**：`electron/ai/agentChatV2Ipc.ts:11-45,76-105,124-160` 保存 pending confirmations、超时按拒绝收口、窗口销毁与 Stop 共用 abort 出口；`electron/ai/agentChatV2.ts:276-308` 的 `makeAgentTool` 把每个工具调用接进 `awaitToolConfirmation`。
- **MCP 单一确认面**：`electron/capabilityCore/mcpGateConfirmation.ts:4-8,61-124` 明确“一张 challenge → 恰好一个确认面”，客户端 elicitation、Nomi GUI fallback、无 surface 则拒绝；`mcpConfirmationBinding.ts:17-65` 对同 key 并发共享一个 in-flight promise。
- **MCP elicitation 与 Run gate**：`electron/capabilityCore/dispatcher.ts:365-391` 只允许 creative/anchor gate 由外部决定，预算/导出/逐镜付费仍回 Nomi；`mcpProtocol.ts:563-618` 先确认再 invoke，逐笔仍经主进程 grant 校验。
- **策略单点现状**：`electron/capabilityCore/mcpGenerationPolicy.ts:70-75,123-203` 已有 immutable snapshot、phase/scope、legacy-route deny；`electron/capabilityCore/mcpConfig.ts:27-63,446-488` 仍是客户端 launcher/config 合并层，不应与业务 policy 混在一起。

### 2.3 “散装配置层”清单（B4 前置清理对象）

审计 `docs/audit/2026-08-24-internal-agent-architecture-audit.md:7-41` 已盘点：会话键、清会话、模型偏好/降级、system prompt、工具注册、确认与单次/多轮模式各自为战。当前 `origin/main` 已做部分 B1 收口，但仍有多处声明：

| 配置面 | 现状与 file:line | B4 处理 |
|---|---|---|
| Session key / clear | `src/workbench/ai/agentSessionKey.ts:1-63` 已有工厂和 safe clear；`workbenchAgentRunner.ts:37-83` 仍由 caller 传 `sessionKey/skillKey/mode`。 | 先把注册表声明变成唯一入口；保留历史 key 字节兼容。 |
| Identity / prompt | `electron/ai/agentChatV2.ts:53-115,608-614` 有 identity + panel + skill + memory 合成器；`src/workbench/generationCanvas/agent/generationCanvasAgentClient.ts` 仍持有画布专长层。 | 保留合成器字节稳定性；B4 不让外部 SDK 拥有 prompt truth。 |
| Tool schema | `electron/ai/documentTools.ts:59-96`、`electron/ai/canvasTools.ts` 是后端 schema；`src/workbench/generationCanvas/agent/generationCanvasTools.ts` 是 renderer/store 工具实现。 | 统一 registry/typed adapter；不要把 SDK tool type 变成领域类型。 |
| Model/mode | `workbenchAgentRunner.ts:63-83` 取 `getAssistantModelPref()`；`agentLoop.ts:16-31,66-76` 再按 skill 设 maxSteps/retry/repair。 | 能力分级与策略应从 registry/policy 派生，不在面板重复 hardcode。 |
| Confirmation | `CreationAiPanel.tsx`、`CanvasAssistantPanel.tsx` 的 UI callback 与 `agentChatV2Ipc.ts:124-160` 仍是两个宿主入口；MCP 另有 `mcpGateConfirmation`。 | 统一为一个 domain decision，再投影到 IPC/MCP；不是再造第三个 dialog。 |

## 3. 逐件 build-vs-buy 对比表

判据：这是通用问题吗？现成方案是否成熟/仍维护？它是否处在 Nomi 的护城河（预算、收据、幂等、锚一致性、Proposal/撤销、能力核权限）？

### 3.1 事件溯源日志

| 方案 | owner 看到什么 | 代价 | 风险/保护项 | 结论 |
|---|---|---|---|---|
| **A. 扩展已有 `eventLogRepository` + ProductionRun bridge** | 一条项目事件流，能回放 Thread/Turn/Item；Run 事件与观察事件有明确边界。 | 需要定义事件分类、upcast、投影 cursor、同步 loop 的写入契约。 | 低；保留现有 redaction/cap/sidecar。必须明确旁路 agent trace 不能冒充账本。 | **买形状 + 自建实现（推荐）**；不新增依赖。 |
| B. 引入 KurrentDB/EventStoreDB | 现成 append/concurrency/subscription/projection；但要随 Nomi 打包/部署数据库。 | 外部 server、连接/迁移/备份/本地离线恢复；Kurrent License v1 非 OSI。 | 会制造第二事实源，可能绕过 ProductionRun/预算/receipt。 | **拒绝**，只借语义。 |
| C. 引入 Temporal | 长任务重试/replay/worker。 | server+worker+workflow sandbox，远超桌面产品。 | history 与用户可见事件、预算账本不相等。 | **拒绝**。 |

### 3.2 Thread / Turn / Item

| 方案 | owner 看到什么 | 代价 | 风险 | 结论 |
|---|---|---|---|---|
| **A. Nomi domain model，借 ACP/Codex/AI SDK 事件形状** | Item 有 `started/delta/completed`，同时可显示 proposal、gate、artifact、failure、receipt；同一事件投影到内部 UI/MCP。 | 自建 schema/upcast/投影测试；要定 Thread↔Run↔project 关联。 | 需防 UI item 与事实事件双写。 | **自建领域模型 + 借形状（推荐）**；不新增依赖。 |
| B. OpenAI Agents JS Session/AgentInputItem | 现成 `getItems/addItems` 历史存储与 tracing。 | OpenAI runner/版本演化；要包一层 BYO provider。 | session item 不是预算/Proposal 事实，类型会反向侵入业务。 | **只借接口想法**。 |
| C. Mastra thread/resource memory | 现成 durable transcript、while-active delivery。 | 引入 runtime/persistence/peer 版本；与已有 agentSessionStore 重叠。 | 第二状态层、与本地优先及 Run cursor 脱节。 | **不买运行时**。 |

### 3.3 策略引擎

| 方案 | owner 看到什么 | 代价 | 风险 | 结论 |
|---|---|---|---|---|
| **A. Nomi policy domain（deny→ask→allow + capability snapshot）** | 每个 tool/Pack step 有明确 `propose|paid|project_write`，预算/来源/模型/attempt 冻结，弱模型诚实降级。 | 需要做 registry、policy decision、测试矩阵、审计事件。 | 实现难，但权限与钱正是护城河。 | **自建（必选）**；保护 ProductionRun/ledger/receipt/anchor/Proposal/capabilityCore。 |
| B. AI SDK 7 approvals / OpenAI guardrails | 工具调用可暂停、审批、guardrail tripwire。 | 只覆盖模型调用边界；仍需 adapter。 | approval/guardrail 不知道 Nomi 的额度、收据、幂等；可能出现 prompt/SDK 绕闸。 | **买机械能力，policy 仍自建**。 |
| C. Mastra authorization / LangGraph interrupt | 现成细粒度授权或 suspend/resume。 | 引入完整 runtime/state store。 | 权限事实分裂；LangGraph 还带 graph-centric 状态。 | **只作参考/评测，不接管**。 |

### 3.4 单一审批信道

| 方案 | owner 看到什么 | 代价 | 风险 | 结论 |
|---|---|---|---|---|
| **A. Nomi `ApprovalDecision` domain + IPC/MCP adapters** | 一张确认语义：scope、estimated cost、冻结项、expires、surface、receipt；内部对话卡和外部 elicitation 是两个投影。 | 把现有 `pendingConfirmations`、`mcpGateConfirmation`、Run gate 接到同一 decision/receipt contract。 | 迁移时需防双问、并发重复扣费。 | **自建语义；复用现有实现（推荐）**。 |
| B. MCP SDK elicitation | 外部客户端原生表单/URL/input-required，带取消与 schema。 | 需跟 v1/v2 protocol era、客户端 capability 协商。 | MCP 只负责问，不负责 Nomi 授权；不能把 accept 当 receipt。 | **买协议适配**；保留 Nomi 主进程硬闸。 |
| C. AI SDK 7 tool approvals / Mastra `requireToolApproval` | agent loop 原生 pause/resume。 | SDK/runtime 版本与 Electron/CJS 兼容成本。 | 一次 approval 可能只覆盖 tool call，无法表达批预算、锚检查点、项目级信任。 | **可在 loop adapter 内借用，不作 authority**。 |

## 4. Vercel AI SDK 到底能“白拿”多少

### 当前依赖（`origin/main`）

`package.json:99-151` 的产品依赖是 `ai: ^4.3.19`，并配 `@ai-sdk/anthropic ^1.2.12`、`@ai-sdk/openai ^1`、`@ai-sdk/openai-compatible ^0.2.16`；`package.json:153-162` 的 `@mastra/core ^1.45.0` 是 devDependency，实际只在 `evals/` 使用。当前可以白拿的，是已经写进代码的：

- `electron/ai/agentLoop.ts:8-91`：`generateText/streamText`、maxSteps、retry、tool-call repair、abort、step finish；
- `electron/ai/agentChatV2.ts:267-308,427-460`：tool-call event、工具 schema、统一确认 hook；
- `agentSessionStore.ts` 与 `eventLogRepository.ts`：会话持久化、trace/compact/cap；
- provider abstraction/BYO key：不用为每个模型写第二套 loop。

### 上游 SDK 7 能力（不是当前依赖白拿）

2026-06-25 官方 changelog 明确新增 `WorkflowAgent` durable execution、tool approvals、timeouts、telemetry，以及 `HarnessAgent` 对 Claude Code/Codex/Pi 等 harness adapter；这相当于**未来可买的 loop/adapter/observability 能力**。但升级不是零成本：官方同时要求 Node 22+、ESM imports，且 v7 migration 会改变 `system→instructions`、stream/result shapes、telemetry 包和多步结果语义（见 changelog 的 migration 段）。Nomi 当前 Electron/TS 模块形态与 `ai@4` API 不能把这些当作现成可用。

**准确结论：**当前“白拿”约等于模型抽象、工具 schema、流式多步循环、abort/retry/repair；Thread/Turn/Item 事件语义、ProductionRun 事件源、策略、预算/收据/幂等、Proposal/撤销、单一审批信道仍必须由 Nomi 自建。SDK 7 的 durable/harness/approval 只能做隔离 spike，不能直接替换保护项。

## 5. 6 角色评审（保留分歧）

| 角色 | 赞成点 | 主要反对/担忧 | 未解决分歧 |
|---|---|---|---|
| **CTO** | 自建 authority 可避免第二事实源；复用 AI SDK/MCP wire 降低供应商锁定。 | SDK 7 已经出现 HarnessAgent，完全忽略会错过维护红利；应做小型 compatibility spike。 | spike 是只读 adapter 还是允许替换 loop？ |
| **设计** | 一份 ApprovalDecision 投影到内部卡/MCP 表单，符合“一语义三宿主”；Item 状态可保持紧凑。 | 外部 SDK 的 generic approval 会漏掉价格、冻结项和下一步；不能让“批准”看起来像只确认一个按钮。 | 确认卡字段是否由 Pack 合同固定，还是由 policy 动态加字段？ |
| **PM** | 不引入大型 runtime，能继续 P4 主链；B4 只清配置层，交付边界清楚。 | 自建 Thread/Turn/Item 看似基础设施，短期用户价值不直观；需要用 `nomi_get_run`/对话回放验收。 | B4 v1 是否必须支持 fork/replay，还是先满足恢复/审计？ |
| **前端** | AI SDK/ACP 事件形状可减少组件分类争论；内部事件流一项一个组件。 | SDK `UIMessage`/`AgentInputItem` 不能直接塞进 Zustand/domain；还要处理长任务、失败条、写入回执。 | Item 类型是完全自有 union，还是保留 SDK raw payload 透传？ |
| **后端** | ProductionRun、ledger、intent log、MCP confirmation 已有成熟边界；外部 runtime 只当 adapter。 | 两条 JSONL（通用 event log + Run events）要明确 cursor/cause 关系，否则 B4 会再造“第三条日志”。 | 通用 trace 是否升级为 Run 的子流，还是永远旁路观察？ |
| **真实用户** | 一个确认面、明确价格/冻结项、停止后可续跑，比“换了什么框架”重要；自由画布不能降级。 | 不接受确认后又被另一宿主/第二张卡再问；也不接受失败只能看内部日志。 | 是否允许外部客户端直接确认创意门；预算/导出仍回 Nomi 已基本拍板。 |

最大分歧不是“买还是造”本身，而是**SDK 7 compatibility spike 的边界**以及**通用 event log 与 ProductionRun 事件的合流方式**。两者若不先拍板，B4 容易出现并行事实源。

## 6. 推荐方案与必须 owner 拍板的岔路

### 推荐（默认执行路径）

1. B4 先做 domain contract：`Thread/Turn/Item`、`ApprovalDecision`、`PolicyDecision`、事件 envelope/upcast；不引入新 runtime。
2. 以 `eventLogRepository` 为通用观察/对话事件入口，以 ProductionRun repository 为生产事实源；用 `runId/causeId/txnId/proposalId` 做显式关联，不复制账本。
3. 在 `agentLoop.ts` 外扩展 registry/policy adapter；`ai@4` 继续跑现有主链。MCP 官方 SDK 只负责 wire validation、elicitation、cancel/version negotiation 的标准语义。
4. 做一个隔离、只读的 **AI SDK 7 spike**：验证 Electron 当前 bundling、ESM/Node 22、ToolLoop/WorkflowAgent/HarnessAgent 的事件/审批映射；不得写入 ProductionRun、预算或 canvas。spike 通过后再决定是否升级 `ai`。

### 待 owner 拍板（当前有 3 个关键岔路）

| # | 岔路 | 选项 | 我不替 owner 选的原因 |
|---|---|---|---|
| 1 | **两条事件流的边界** | A. 通用 event log 继续旁路，Run events 是事实源；B. 用统一 envelope 把 Run events 纳入同一物理日志；C. 只做逻辑合流、物理文件不合并。 | A 最小改动，B 最统一但迁移最大，C 需要长期 projection 规则；是架构不可逆取舍。 |
| 2 | **AI SDK 7 升级时机** | A. 先保持 ai@4，B4 自建薄壳；B. 先做只读 spike 后升级；C. 直接把 SDK 7 Workflow/Harness 当 B4 runtime。 | A 最稳，B 可验证未来收益，C 会把 Node/ESM/版本迁移与 authority 风险一起引入。 |
| 3 | **Thread/Turn/Item 事件形状** | A. Nomi 自有 union，对外做 ACP/SDK adapters；B. 直接采用 AI SDK/OpenAI item types；C. 采用 ACP/App Server wire shape 作为内部 canonical。 | B 违反“SDK 类型不得反向侵入业务模型”；A/C 的长期生态与迁移成本不同。 |

在 owner 拍板前，本文件不授权实现以上三项中的不可逆选择；其余低风险边界（不新增 event store、不让外部 runtime 拥有预算/权限、不造第二审批 dialog）可按推荐路径推进。

## 7. 资料与核验记录

- Context7 本轮解析：`/vercel/ai`、`/modelcontextprotocol/typescript-sdk`、`/langchain-ai/langgraph`、`/mastra-ai/mastra`、`/openai/openai-agents-js`、`/eventuous/eventuous`；查询重点为 agent loop、durability、elicitation、Session/Item、approval、persistence。
- 网页核验日期：2026-08-26；官方来源优先。对 KurrentDB 的许可证表述来自官方 v26.1 docs；对旧 EventStore Node npm 包的“约两年未发布”来自 npm 页面，故只把它作为反例，不将其当作 KurrentDB 当前维护结论。
- 本轮没有把第三方 benchmark、博客排名或“最新/SOTA”当作选型依据；维护结论均以官方仓库/文档的 release、changelog 或近期更新为证。
