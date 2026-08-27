# Agent Runtime 源码阅读与 Nomi 适配方案

> 这是一份独立的源码研究文档。它不修改或替代 `docs/superpowers/plans/2026-08-22-external-agent-runtime-mcp-control-plane.md`，只回答一个问题：Codex 和 Pi Agent 的真实代码里，哪些设计值得 Nomi 复用，应该落在哪一层。
> **2026-08-26 实施决策已更新**：内部 Agent 选择受控 pi `AgentSession`，不再维持“继续 ai@4 或 pi 二选一”的开放分支；非 Agent 文本链继续 ai@4。文内 Harness/Operation 图是研究和业务边界，不代表固定 0.84.3 的 `AgentHarness` 已可用（其关键方法未实现，本期不采用）。实际文件与验收状态见 [harness 导览](../../electron/harness/README.md) 和 [R1 实施卡](../plan/2026-08-26-pi-r1-runtime-cutover.md)。

## 先给结论

Codex 和 Pi 解决的不是同一个问题：

```text
Codex = 外部 Agent 如何被一个应用控制
        Session / Thread / Turn / Item
        App Server / MCP / event / interrupt / steer

Pi Agent = Agent 在应用内部如何循环工作
           model call / tool batch / retry / hook / context / event

Pi Harness = 这个内部 Agent 如何长时间运行、崩溃恢复和持久化
             operation / lane / checkpoint / intent / settlement

Nomi = 视频生产和项目编辑的最终 authority
       ExecutionContract / ProductionRun / budget / Provider task
       Artifact / Asset / Timeline / EditorCommand
```

所以我们的方案不是“选 Codex 还是选 Pi”，而是：

```text
外部 Claude Code / Codex / Pi
        ↓ MCP
Nomi External Control Plane       ← 借 Codex
        ↓ typed command
Nomi Execution Harness             ← 借 Pi Harness 的耐久语义
        ↓
ProductionRun / Artifact / Timeline ← Nomi 自己掌权

Nomi 内部 Agent（如果需要）
        ↓ AgentLoopPort              ← 借 Pi Agent Loop
```

## 1. Pi Agent：代码里真正值得复用的东西

### 1.1 `agent-loop.ts` 是低层循环，不是完整业务 Runtime

源码：[Pi `packages/agent/src/agent-loop.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts)

它的核心入口是：

```text
agentLoop(prompt, context, config)
agentLoopContinue(context, config)
runAgentLoop(...)
runAgentLoopContinue(...)
```

代码中有几个关键边界：

| 源码行为 | 真实含义 | Nomi 应该怎么用 |
|---|---|---|
| `agentLoop` 与 `agentLoopContinue` 分开 | 新 prompt 和从现有 context 继续是两种语义；continue 不允许最后一条消息是 assistant | Nomi 也区分创建新 Operation、恢复 Operation、重试当前 Attempt，不能把恢复伪装成新任务 |
| 外层 follow-up + 内层 tool continuation | 当前 assistant 发出的工具调用要先完成；工具结果回来后才能继续下一轮；Agent 本来要停时才处理 follow-up | 当前 Provider/tool batch 未完成前，不接受会改变已执行合同的修改；follow-up 只能影响后续计划 |
| `getSteeringMessages()` | 在当前工具批次完成后、下一次模型请求前注入；不会跳过已经发出的 tool call | Nomi 的 `steer` 可以进入未 seal 的计划或下一次内部 Agent turn；不能修改已经提交给 Provider 的参数 |
| tool execution 支持 sequential / parallel | 工具可以按批次并行，但每个工具可以声明自己必须串行；并行完成事件按完成顺序，结果消息按源顺序回写 | 只读分析工具可并行；Provider submit、预算扣款、Artifact 登记、Timeline apply 必须按 `sideEffectClass` 和 `lockScope` 串行 |
| `beforeToolCall` / `afterToolCall` | 工具参数先验证，再执行前拦截；工具完成后还可以改写展示结果 | Nomi 对应 `preflight → effect → settlement`；after 只能补充结果，不得覆盖账本、Provider task ID、Artifact ID |
| `tool_execution_update` | 工具可以持续报告增量进度；最终结果另有结束事件 | 映射为进度事件，不把每个 progress 当成最终事实 |
| 截断的 tool call 不执行 | 输出被 token limit 截断时，可能出现“看起来合法但参数不完整”的调用，Pi 会全部报错并要求重发 | Nomi 对不完整的 PlanCandidate、Asset 引用和 EditorCommand 一律拒绝执行 |
| `transformContext` → `convertToLlm` | 先裁剪/注入 Agent 消息，再转换成模型可接受的消息；UI-only 消息可以被过滤 | Nomi 分开内部运行日志、模型可见上下文和 MCP 安全投影，不能把完整内部状态直接暴露给外部 Agent |
| stream 失败进入正常结果 | `StreamFn` 的失败应表现为 stream event 和 `stopReason: error/aborted`，而不是留下没有结束事件的半截循环 | Nomi 每个失败都要落为可查询的 failed/aborted/interrupted 状态，并标明是否需要 reconcile |

Pi Agent Loop 的事件层次是：

```text
agent_start
  → turn_start
  → message_start / message_update / message_end
  → tool_execution_start / tool_execution_update / tool_execution_end
  → turn_end
  → [steering / follow-up 后继续]
  → agent_end
```

这套事件适合做内部 Agent UI 和诊断，但它不是 Nomi 的 ProductionRun 事实源。需要崩溃恢复、预算对账和 Provider reconcile 的事实必须独立持久化。

### 1.2 `types.ts` 暴露的是窄接口

源码：[Pi `packages/agent/src/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts)

Pi 没有要求业务层理解 loop 内部实现，而是通过几个接口插入能力：

- `AgentContext`：system prompt、messages、tools；
- `AgentLoopConfig`：`convertToLlm`、`transformContext`、动态 `getApiKey`、`shouldStopAfterTurn`、`prepareNextTurn`、steering/follow-up queue、tool execution mode、before/after tool hooks；
- `AgentTool`：schema、`execute`、`AbortSignal`、增量更新回调、工具级串并行声明；
- `AgentEvent`：Agent、Turn、Message、Tool execution 四层事件；
- `AgentState`：当前 model、tools、messages、streaming 状态、pending tool calls 和错误。

Nomi 应该复用的是这种接口形状：把 Agent Loop 当成一个可替换端口，不让 Pi 的具体 `AgentMessage`、provider context 或 session 对象渗透到项目、时间轴和 ProductionRun。

第一阶段的 Nomi 接口：

```ts
export type AgentLoopPort = {
  runTurn(input: {
    context: AgentContext
    tools: AgentTool[]
    signal?: AbortSignal
  }): AsyncIterable<AgentEvent>

  continueTurn(input: {
    context: AgentContext
    signal?: AbortSignal
  }): AsyncIterable<AgentEvent>
}
```

当前实现继续由 `src/workbench/ai/workbenchAgentRunner.ts` 提供。未来要接 Pi，只增加 `piAgentLoopAdapter.ts`；不让 Pi Session 取代 Nomi Project 或 ProductionRun。

## 2. Pi Durable Harness：我们真正要借的耐久语义

源码/设计：[Pi `harness-v2.md`](https://github.com/earendil-works/pi/blob/main/packages/agent/docs/harness-v2.md)、[Pi explicit state redesign](https://github.com/earendil-works/pi/blob/main/packages/agent/docs/harness-v2-state-machine.md)

Pi Harness 把 durable session 分成四类状态：

```text
conversation tree   = 模型和用户看到的 append-only 对话内容
lanes               = 工作位置，每条 lane 最多一个 open operation
operation log       = 执行记录、恢复点、队列和 pending writes
global facts        = session 范围的 latest-wins 元数据
```

对 Nomi 最有价值的是这些不变量：

1. **先接受，后执行。** Operation 被接受时先留下 durable 记录；崩溃后必须恢复完成或明确关闭，不能留下外部看不懂的半完成状态。
2. **Effect 前 intent，Effect 后 settlement。** Provider 请求、工具调用和文件/媒体写入都可能在进程崩溃时处于未知状态，所以要靠幂等键、可安全重放声明、reconcile 或明确的 uncertain 状态处理。
3. **事件只观察，Hook 才改变执行。** 事件不能反向修改运行；事件在对应事实提交后才发出。
4. **Snapshot + live stream。** 客户端先拿一个原子 snapshot，再接收实时事件；事件不是断线后的历史重放机制。
5. **Checkpoint 恢复。** steering、follow-up、deferred write、tool batch 和 compaction 在固定 checkpoint 处理，而不是进程重启后随意重放整个上下文。
6. **单写者。** 一个 Harness 负责写一个 session；多 lane 可以并行，但每条 lane 自己串行。
7. **上下文尾部追加。** Provider context 尽量只在尾部追加；中间插入会破坏缓存和成本预期。

Pi 的 `Operation`、`Run`、`Step`、`Task` 也值得区分：

```text
Operation       = 被接受的耐久工作
Run             = 一次 prompt 及其自动 continuation
Step            = 一次 assistant response + 它请求的完整 tool batch
Task            = 可重试的工作单元；一次 Task 可有多个 provider request
Attempt         = Task 的一次尝试，次数必须耐久化
```

这正好解释 Nomi 为什么不能只保留一个“生成中”布尔值。Nomi 需要把外部意图、ProductionRun、Provider attempt、Artifact 和 reconcile 分开记录。

## 3. Codex：代码里真正值得复用的控制面

主仓库：[OpenAI Codex](https://github.com/openai/codex)

### 3.1 Session、SessionState、TurnState 是三层不同状态

| Codex 源码 | 代码职责 | Nomi 映射 |
|---|---|---|
| [`core/src/session/session.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/session/session.rs) | Session 持有 thread id、事件发送器、Agent 状态、权限环境、App Server client 信息，并限制同一 Session 同时只有一个运行 task | `ExternalAgentSession` + project operation coordinator |
| [`core/src/state/session.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/state/session.rs) | 跨 Turn 的历史/context、rate limit、additional context、上一 Turn 配置、connector、权限和下一 Turn 设置 | session context、能力视图和租约信息；不是 ProductionRun |
| [`core/src/state/turn.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/state/turn.rs) | 当前 Turn 的 pending approval、permission、user input、elicitation、MCP approval metadata、dynamic tools、input queue、mailbox phase | `NomiOperation` 的控制态：审批等待、steer、interrupt、当前 attempt 控制信息 |
| [`core/src/session/turn.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/session/turn.rs) | Turn 执行前注入 skills/plugins，运行 hooks，合并 connectors，记录 context injection；重试时复用 model client session；采样后处理输入、stop hook、diff tracker | seal 前冻结 Module/Skill/capability 证据；运行时保留 preflight、attempt、settlement、proposal 检查点 |

关键边界：Codex 的 TurnState 是控制态；Nomi 的 budget、Provider task ID、Artifact、project revision 必须进入自己的 durable authority，不能只放在内存状态里。

### 3.2 App Server 是“可序列化协议 + 事件流”

| Codex 源码 | 代码职责 | Nomi 映射 |
|---|---|---|
| [`app-server-protocol/src/protocol/common.rs`](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs) | 集中定义 thread、turn start/read/steer/interrupt 路由及通知/锁定约束 | 集中定义 `session/open`、`operation/start/read/events/interrupt/steer`、`editor/proposal/*` |
| [`app-server-protocol/src/protocol/v2/thread_data.rs`](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs) | Thread / Turn 的稳定 serialized projection，包含 id、items、status、error、时间 | `ExternalSessionSnapshot`、`OperationSnapshot`、`RunSnapshot`、`NomiEvent` |
| [`app-server/README.md`](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) | server notification 推送 started、item、delta、completed，并支持 interrupt、steer、approval | 先提交事实，再发布可续读事件；复用 Nomi MCP stdio/长轮询，不新建 App Server |
| [`docs/protocol_v1.md`](https://github.com/openai/codex/blob/main/codex-rs/docs/protocol_v1.md) | 区分 Task 与 Turn；一个 Thread 同时只有一个 Task；支持 resume/fork | Nomi 区分 Operation、RuntimeTask、ProviderAttempt；seal 后 steer 不能改合同 |
| [`docs/codex_mcp_interface.md`](https://github.com/openai/codex/blob/main/codex-rs/docs/codex_mcp_interface.md) | MCP server 以生命周期 RPC 控制 thread、turn、approval | Nomi MCP 也按生命周期暴露，不把几十个底层小工具直接丢给外部 Agent |

Nomi 不复制 Rust Core，也不把 Codex `Thread` 直接命名成 Nomi `Project`。我们只吸收协议结构：

```text
Codex Thread / Turn / Item
  → Nomi Session / Operation / Event projection

Codex one active task per thread
  → Nomi one write operation per project

Codex turn/started → item/* → turn/completed
  → Nomi operation/started → run/item/* → operation/completed
```

## 4. 两套 Runtime 如何在 Nomi 里分工

### 4.1 外部 Agent 路径

外部 Claude Code、Codex、Pi 都已经有自己的 Agent Loop。它们调用 Nomi 时，只走 MCP：

```text
external Agent
  → session/open
  → context/read
  → plan/preview
  → user approval
  → operation/start(contractHash)
  → operation/read / operation/events
  → operation/interrupt 或 operation/steer
  → Artifact / EditProposal
```

这里 Pi Agent Loop 不参与执行。Nomi 只需要提供稳定的 MCP 生命周期和 Production Runtime。

### 4.2 Nomi 内部 Agent 路径

如果右侧 Agent、生成画布 Agent 或时间轴 Agent 自己需要循环调用工具，则使用：

```text
workbenchAgentRunner
  → AgentLoopPort
  → AgentContext / AgentTool / AgentEvent
  → Nomi Capability Core
  → typed domain command
```

已批准的内部运行核是受控 pi AgentSession；其适配只进入既有 Nomi 工具宿主，不能直接写 Timeline Store 或绕过业务批准/花费权威。原有 ai@4 仅保留在本次未替换的非 Agent 文本链，不作为 Agent 的失败 fallback。

### 4.3 媒体执行路径

下图表达目标业务权威链，不是 R1 已统一两条付费入口的现状。R1 保留内部画布的 `mintSpendGrant → runPlanWithToasts` 和外部能力核的 `lease/receipt → ProductionRun`；本次只换 Agent 运行机制，不借研究图偷偷改写付费链。

所有外部和内部 Agent 最终都要经过同一条 Nomi authority 链：

```text
PlanCandidate
  → DraftExecutionSnapshot
  → ApprovalGate
  → ExecutionContract + contractHash
  → ProductionRun
  → budget reservation / submission outbox
  → Provider task / poll / cancel / reconcile
  → Artifact projection
  → AssetRecord
  → EditProposal
  → EditorCommandBus
  → Timeline / Export
```

## 5. Nomi 的具体实现边界

### 5.1 可以复用

- Codex 的 Session / Turn / Item 生命周期表达；
- Codex 的稳定 Snapshot、server event、interrupt、steer 和 resume/fork 语义；
- Pi Agent Loop 的 `AgentLoopPort`、tool batch、before/after hook、stream event 形状；
- Pi Harness 的 accepted operation、checkpoint、intent/settlement、recovery、single writer；
- Claude Code 的 Skill、Plugin、Hook、Permission 扩展语义。

### 5.2 必须适配

- `Thread` 改成 Nomi 的 `ExternalAgentSession`；
- `Turn` 改成 Nomi 的 `Operation` / `RuntimeTask` 组合；
- `Item` 改成安全的 `NomiEvent`，不直接暴露内部消息；
- Pi 的 lane 改成 Nomi 的 project write lock，第一阶段不开放任意多 lane；
- Pi 的 tool execution mode 增加媒体副作用分类和锁域；
- Pi 的 retry 改成区分 LLM request retry、Provider submit uncertainty 和 Artifact reconcile；
- Codex 的 approval 改成 Nomi 的预算、合同 hash、项目 revision 和 Editor Proposal 审批。

### 5.3 明确不复用

- 不引入 Pi 作为第一阶段依赖；
- 不复制 Codex Rust Core 或另起 Rust App Server；
- 不让外部 Agent 直接拿 Provider API key；
- 不让 Agent 直接改 Zustand、Timeline、Project JSON 或 ProductionRun reducer；
- 不把聊天上下文当作任务事实源；
- 不把“事件已经发出”当作“任务已经持久化”。

## 6. 推荐落地顺序

### Phase 1：先做外部控制面

新增 `session/open`、`operation/start/read/events`、`operation/interrupt/steer` 的 typed schema 和 validator。沿用现有 MCP stdio、Capability Core 和 ProductionRun，不引入 Pi。

验收：外部 Agent 可以创建零额度草稿；Nomi 重启后仍可以通过 snapshot + cursor 找回 Operation。

### Phase 2：把 Codex 事件语义接到 ProductionRun

事件必须在事实提交后发布，至少形成：

```text
operation/started
  → run/item/started
  → run/item/progress
  → run/item/completed
  → operation/completed | operation/failed | operation/interrupted
```

验收：断线、重复读取、cursor 续读和事件乱序都不会导致重复扣费或重复登记 Artifact。

### Phase 3：把 Pi Harness 语义接到耐久执行

不复制 Pi 的 Session 存储，而是在已有 `electron/productionRun/` 中补齐：

- accepted operation record；
- Provider submit intent；
- provider attempt number；
- submission settlement；
- cancel/reconcile 状态；
- 恢复 checkpoint；
- 可区分的 interrupted / failed / uncertain。

验收：在 submit 前、submit 后未写回、poll 中、cancel 中、Artifact 投影中断等位置杀进程，都能恢复或明确进入 reconcile。

### Phase 4：最后再决定是否接 Pi Adapter

当 Nomi 内部 Agent 确实需要更强的 steering、tool batch、context transform 或 durable harness 时，再实现：

```text
src/workbench/ai/piAgentLoopAdapter.ts
```

它只实现 `AgentLoopPort`，不改变 Nomi 的 MCP 协议、ProductionRun、预算账本和 Timeline authority。

## 7. 最终判断

Pi Agent 要看，而且重点不是“以后要不要安装 Pi”，而是它把 Agent Loop 的边界写得很清楚：工具批次、steering、hook、context 转换、事件和错误都应该有窄接口。

Codex 也要看，而且重点不是照抄它的 Thread 名称，而是它把外部控制面拆成了 Session、Turn、Item、snapshot、事件、interrupt 和 steer。

Nomi 最终应当是：

> **Codex 的外部控制面语义 + Pi 的内部 Agent Loop / Durable Harness 语义 + Nomi 自己的媒体执行和编辑 authority。**

这三者组合起来，才既能接入外部 Agent，又不会让 Nomi 退化成“只吐出几个片段的 MCP 工具集”。
