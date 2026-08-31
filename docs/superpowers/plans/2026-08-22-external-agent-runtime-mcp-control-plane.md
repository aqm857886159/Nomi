# Nomi External Agent Runtime 与 MCP 控制面实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不重写 Nomi 现有时间轴、Production Run 和导出能力的前提下，让 Claude Code、Codex、外部 Pi 等 Agent 可以安全地驱动 Nomi：提出生成计划、等待审批、启动可恢复任务、观察进度、取得 Artifact，并把结果通过 Proposal 接入现有时间轴。

**Architecture:** 外部控制面借鉴 Codex App Server 的 Thread/Turn/Event 生命周期，但继续复用 Nomi 现有 Capability Core + MCP transport；内部 Agent 循环借鉴 Pi 的 Agent Loop / Durable Harness，但第一阶段不引入 Pi 依赖，保留现有 `workbenchAgentRunner`。Claude Code 的 Skill、Plugin、Hook、Permission 只作为扩展和策略参考。所有花费、Provider 任务、项目修改和 Artifact 仍由 Nomi Runtime 掌握最终 authority。

**Tech Stack:** Electron + TypeScript + 现有 custom MCP / capability core + `electron/productionRun/` + Zustand Timeline + Vercel AI SDK + Vitest + Playwright。第一阶段不增加 Pi、Codex 或 Claude Code Runtime 依赖，不新建第二套 Agent Run 或 Timeline 状态源。

---

## 0. 先把方案说成人话

Nomi 现在已经有：

- 生成画布；
- 时间轴编辑；
- 预览；
- MP4 导出；
- Production Run；
- MCP / CLI 能力核。

缺的不是“再做一个剪辑器”，而是把外部 Agent 生成的结果接入这条已有链路：

```text
外部 Agent
  → 通过 MCP 告诉 Nomi 想做什么
  → Nomi 先算清楚将要执行什么
  → 用户批准花费或项目修改
  → Nomi 按冻结合同执行
  → 结果成为项目 Asset / Artifact
  → 需要进入时间轴时生成 EditProposal
  → 用户确认后复用现有 Timeline 和 Export
```

最终的产品体验不是“外部 Agent 生成了一堆视频片段”，而是：

> **外部 Agent 可以驱动 Nomi 完成一个可观察、可恢复、可进入时间轴的创作动作。**

## 1. 四个明确决策

### 决策 A：Codex 负责参考外部控制面

Nomi 不复制 Codex 的 Rust Core，但借鉴它的控制语义：

```text
initialize
  → session / thread open
  → operation / turn start
  → streamed events
  → interrupt / steer
  → completed / failed / interrupted
```

Codex 的 `Thread`、`Turn`、`Item` 是外部客户端理解 Agent 生命周期的参考，不直接成为 Nomi 的项目对象。[Codex App Server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)

### 决策 B：Pi 只作为内部 Agent Kernel 的参考

如果 Nomi 自己的右侧 Agent、生成画布 Agent 或剪辑区 Agent 需要更强的工具循环，再借鉴 Pi 的：

- Agent loop；
- 工具批次的串行 / 并行执行；
- 上下文变换和压缩；
- retry / abort / steering；
- durable run / step / task；
- snapshot + event stream。

第一阶段不因为外部 MCP 接入而引入 Pi。外部 Claude Code / Codex / Pi 自己已经拥有 Agent Loop；Nomi 只负责 MCP 服务和媒体生产 Runtime。[Pi Agent Loop](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts)、[Pi Durable Harness](https://github.com/earendil-works/pi/blob/main/packages/agent/docs/harness-v2.md)

### 决策 C：Claude Code 只参考扩展和权限模型

Claude Code 的公开仓库不是完整 CLI Runtime 源码，因此不把它当作 Nomi 的底层实现来源。只借鉴这些产品概念：

- Skill：方法说明；
- Plugin：能力包；
- Hook：动作前后的检查点；
- Permission：允许、拒绝、询问或延迟。

Nomi 自己的 Module manifest、validator 和 approval policy 必须真正执行，不能只记录“Skill 已使用”。[Claude Code Repository](https://github.com/anthropics/claude-code)、[Claude Agent SDK Hooks](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/types.py)

### 决策 D：Nomi 继续掌握媒体领域 authority

以下对象不能交给外部 Agent，也不能交给 Pi / Codex / Claude Code：

- `ExecutionContract`；
- `ProductionRun`；
- budget ledger；
- Provider task ID；
- Asset / Artifact 登记；
- 项目 revision；
- Timeline / EditorDocument；
- `EditorCommand` 的最终应用。

外部 Agent 可以提出候选，但最终“能不能花钱、改哪个项目、结果是否采用”由 Nomi Runtime 决定。

## 2. 目标架构

```text
┌──────────────────────────────────────────────────────────────┐
│ External Hosts                                                │
│ Claude Code · Codex · Pi · Cursor · 自定义 MCP Client          │
└───────────────────────┬──────────────────────────────────────┘
                        │ MCP / JSON-RPC-like lifecycle
┌───────────────────────▼──────────────────────────────────────┐
│ Nomi Capability Core / MCP Control Plane                      │
│ initialize · session · operation · snapshot · event cursor    │
│ tool schema · client identity · read/write policy             │
└───────────────────────┬──────────────────────────────────────┘
                        │ typed domain commands
┌───────────────────────▼──────────────────────────────────────┐
│ Nomi Execution Harness                                        │
│ PlanCandidate · DraftSnapshot · Approval · ExecutionContract  │
│ ProductionRun · budget · idempotency · reconcile              │
└───────────────┬──────────────────────────┬───────────────────┘
                │                          │
┌───────────────▼──────────────┐  ┌────────▼──────────────────┐
│ Generation / Provider Layer   │  │ Project / Editor Layer    │
│ submit · poll · cancel        │  │ Asset · Artifact          │
│ providerTaskId · recovery     │  │ EditProposal · CommandBus │
└───────────────┬──────────────┘  │ Timeline · Export         │
                │                 └────────┬──────────────────┘
                └──────────────┬───────────┘
                               ▼
                         Nomi Project Truth
```

### 2.1 关键边界

```text
MCP = 外部控制入口
Capability Core = 认证、Schema、路由和安全投影
Execution Harness = Nomi 的耐久执行和权限中心
ProductionRun = 付费任务的耐久事实源
EditorCommandBus = 项目修改的唯一写入口
```

MCP 不直接调用 Provider；Agent 不直接写 Zustand；Skill 不直接获得文件系统或额度权限。

## 3. Nomi 对外采用的对象模型

Codex 的 Thread / Turn / Item 只作为生命周期启发。Nomi 定义自己的领域对象，避免把聊天会话误当成项目状态。

### 3.1 `ExternalAgentSession`

表示一个外部客户端与 Nomi 的连接上下文，不代表一个项目，也不代表一个生成任务。

```ts
export type ExternalAgentSession = {
  sessionId: string
  clientId: string
  clientVersion?: string
  projectId?: string
  capabilitiesHash: string
  trust: 'trusted' | 'external'
  createdAt: string
  lastSeenAt: string
}
```

### 3.2 `NomiOperation`

表示外部 Agent 发起的一次完整操作，例如“生成一个镜头”或“提出一个时间轴修改”。它可以包含多个内部任务。

```ts
export type NomiOperation = {
  operationId: string
  sessionId: string
  projectId: string
  kind: 'generation' | 'editor-proposal' | 'export'
  status: 'draft' | 'awaiting_approval' | 'running' | 'succeeded' | 'failed' | 'interrupted'
  baseRevision: number
  runId?: string
  contractHash?: string
  createdAt: string
  updatedAt: string
}
```

### 3.3 `ProductionRun`

仍然沿用现有 `electron/productionRun/`。它记录 Provider 提交、预算、事件、Artifact、恢复和最终状态。

```text
NomiOperation = 外部 Agent 发起的业务动作
ProductionRun  = 该动作中需要耐久执行的生产任务
RuntimeTask    = Run 内可重试的具体任务
Attempt        = 某个 Task 的一次尝试
```

一个 Operation 可以没有 Run（例如只读查询或草稿 Proposal），也可以包含多个 Run（例如未来的多镜头制作）。

### 3.4 `NomiEvent`

所有外部可见事件都必须可通过 cursor 续读，并在事实持久化之后才发出。

```ts
export type NomiEvent = {
  eventId: string
  cursor: number
  sessionId: string
  operationId?: string
  runId?: string
  type:
    | 'session.ready'
    | 'operation.started'
    | 'operation.awaiting_approval'
    | 'operation.interrupted'
    | 'run.started'
    | 'run.progress'
    | 'run.awaiting_reconcile'
    | 'artifact.created'
    | 'proposal.created'
    | 'operation.completed'
    | 'operation.failed'
  payload: Record<string, unknown>
  emittedAt: string
}
```

事件不能包含本地绝对路径、Provider secret、完整未脱敏 Prompt 或内部凭证。

## 4. 外部 MCP 的具体生命周期

### 4.1 建立连接

```text
MCP Client
  → initialize(clientId, clientVersion, capabilities)
Nomi
  → 返回 serverInfo、协议版本、可用工具和 trust 状态
MCP Client
  → session/open(projectId?)
Nomi
  → 返回 sessionId、project revision、能力目录摘要
```

`initialize` 只建立通信和身份，不代表可以花钱。

### 4.2 读取上下文

```text
nomi_get_generation_context
```

返回：

- 项目摘要；
- 当前 revision；
- 可用 Asset 摘要；
- 可用模型和能力；
- 当前预算和审批规则；
- 现有时间轴摘要；
- 能力目录 hash。

不返回：

- 任意本地路径；
- Provider API Key；
- 不相关项目的素材；
- 未授权的完整项目文件。

### 4.3 提交候选计划

```text
nomi_submit_generation_plan
  → PlanCandidate
  → operationId
  → status: draft
```

这个动作不花额度、不调用 Provider、不改时间轴。

`PlanCandidate` 只能包含：

- Module 引用；
- 参数；
- 输入 Asset 引用；
- 顺序和并发意图；
- 质量要求；
- 外部 Agent 的成本估算。

不能由外部 Agent 设置：

- `approved: true`；
- `providerTaskId`；
- `actualCost`；
- `qualityPass`；
- `artifactId`。

### 4.4 预览执行合同

```text
nomi_preview_execution(operationId)
  → DraftExecutionSnapshot
```

返回用户真正需要核对的内容：

- 实际会用哪个模型；
- 哪个输入 Asset 版本；
- 规范化后的参数；
- 预计成本；
- 能力降级；
- 被丢弃的字段；
- 需要的审批；
- 将产生的 Artifact 类型。

### 4.5 审批与冻结

审批在 Nomi UI 或 Nomi 自己信任的控制面完成。外部 Agent 只能看到结果，不能伪造批准。

```text
DraftExecutionSnapshot
  → 用户在 Nomi 内批准
  → seal ExecutionContract
  → 保存 contractHash
```

批准记录必须绑定：

```text
projectId
operationId
contractHash
approvedBy
approvedAt
budgetReservationId
```

合同冻结之后，外部 Agent 的 `steer` 只能被拒绝；如果用户要改参数，必须回到新的 PlanCandidate。

### 4.6 启动执行

```text
nomi_start_generation({
  operationId,
  contractHash,
  idempotencyKey
})
```

Runtime 必须再次校验：

1. Operation 存在且属于当前 session / project；
2. Contract hash 与批准记录一致；
3. Contract 已 seal；
4. 预算 reservation 仍有效；
5. 当前 revision 没有冲突；
6. 幂等键没有对应的已提交任务。

通过后才创建或绑定 `ProductionRun`，再由现有 Provider runner 提交任务。

### 4.7 观察、暂停和恢复

```text
nomi_get_run(runId)
nomi_subscribe_run(runId, afterCursor, waitMs)
nomi_interrupt(operationId)
nomi_steer(operationId, message)
```

第一阶段可以只暴露 `get_run` 和 `subscribe_run`；`interrupt` 在取消语义和 Provider 对账完成后开放；`steer` 只允许在合同冻结前使用。

事件读取采用：

```text
先读当前 snapshot
→ 再从 afterCursor 读取事件
→ 返回 nextCursor
```

断线后不依赖聊天记录重放，而是重新读取 snapshot + cursor。

### 4.8 Artifact 与时间轴

生成完成后：

```text
Provider result
  → Artifact 登记
  → AssetRecord(role: aiGenerated)
  → nomi_get_artifact 返回安全投影
  → nomi_propose_adopt_artifact
  → EditProposal
  → 用户 Apply
  → EditorCommandBus
  → Timeline
```

默认不自动插入时间轴。外部 Agent 可以提出“把 Artifact 放到播放头位置”，但最终仍走现有 Proposal / Apply / Undo 路径。

## 5. 三类调用权限

### 5.1 Read

可直接执行：

- 读取项目摘要；
- 读取模型目录；
- 读取时间轴摘要；
- 读取 Run 状态；
- 读取事件；
- 读取 Artifact 安全投影。

### 5.2 Draft

可创建但不能产生副作用：

- PlanCandidate；
- DraftExecutionSnapshot；
- EditProposal；
- export preview。

### 5.3 Commit

必须绑定 Nomi 的权威条件：

- 付费 Provider submit；
- 预算 reservation；
- 生成合同 hash；
- 项目写入；
- Timeline Apply；
- MP4 export。

外部 Agent 不能只靠 token 进入 Commit 层。

## 6. 复用成熟项目的具体方式

### 6.1 Pi：只复用设计，不作为第一阶段依赖

先在 Nomi 内部定义自己的最小接口：

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

当前实现由 `src/workbench/ai/workbenchAgentRunner.ts` 适配。未来如果决定采用 Pi，可以新增 `piAgentLoopAdapter.ts`，但不能让 Pi Session 取代 Nomi Project 或 ProductionRun。

### 6.2 Codex：复用控制面思路，继续使用 Nomi MCP

不新建第二个 App Server。当前 Capability Core 已经是 Nomi 的本地控制面；只把 Codex 的生命周期语义补进去：

```text
initialize
session/open
operation/start
operation/read
operation/interrupt
operation/steer
operation/events
```

传输仍然使用现有 MCP / stdio，不为了模仿 Codex 而增加新的 WebSocket 或 Rust 服务。

### 6.3 Claude Code：复用扩展语义，修正 Nomi 的 Skill 执行证据

Nomi 的 Skill manifest 必须实际控制：

- stage 是否允许使用；
- Module 是否允许调用；
- Tool allowlist；
- 是否需要 approval；
- 结果中是否记录 Skill 注入证据。

仅在日志中写“Skill used”而没有真实注入，视为失败。

## 7. 需要复用的现有 Nomi 文件

### 不新建的事实源

- `electron/productionRun/productionRunService.ts`：继续作为 Run 的权威服务；
- `electron/productionRun/productionRunReducer.ts`：继续负责 Run 状态转移；
- `electron/productionRun/budgetLedger.ts`：继续负责预算；
- `electron/productionRun/submissionOutbox.ts`：继续负责付费提交意图和恢复；
- `electron/productionRun/artifactProjection.ts`：继续负责安全 Artifact 投影；
- `src/workbench/timeline/timelineTypes.ts`：继续保存当前 Timeline 兼容模型；
- `src/workbench/generationCanvas/agent/proposalTxn.ts`：复用事务和补偿原则；
- `src/workbench/generationCanvas/agent/proposalUndo.ts`：复用整笔撤销原则。

### 需要扩展的入口

- `electron/capabilityCore/dispatcher.ts`：增加 session / operation / editor 命令路由；
- `electron/capabilityCore/core.ts`：注入 Nomi Runtime 依赖；
- `electron/capabilityCore/gateway.ts`：统一前台、后台和 headless 路径；
- `electron/capabilityCore/mcpProtocol.ts`：增加工具 Schema 和注解；
- `electron/capabilityCore/mcpStdioServer.ts`：增加事件游标和长轮询返回；
- `electron/main.ts` / `electron/preload.ts`：保持窄 IPC，不暴露 Node 原语；
- `src/desktop/productionRunBridgeTypes.ts`：补充操作和事件的 typed bridge；
- `src/workbench/ai/workbenchAgentRunner.ts`：只在内部 Agent 路径接入 AgentLoopPort；
- `src/workbench/timeline/`：只通过现有编辑入口接收外部 Proposal。

### 需要新增的低耦合文件

- `electron/capabilityCore/runtimeProtocolTypes.ts`：session / operation / event Schema；
- `electron/capabilityCore/runtimeProtocolValidator.ts`：请求、身份、revision、cursor 校验；
- `electron/capabilityCore/agentOperationService.ts`：外部 Operation 生命周期；
- `electron/capabilityCore/agentOperationService.test.ts`：生命周期和权限测试；
- `electron/capabilityCore/runtimeEventCursor.ts`：snapshot + cursor 读取；
- `electron/capabilityCore/runtimeEventCursor.test.ts`：断线、重复读取和过期 cursor 测试；
- `src/workbench/editor/editorMcpTools.ts`：只暴露高价值 EditorCommand，不暴露 Store action；
- `src/workbench/editor/editorMcpTools.test.ts`：Proposal、revision 和 command allowlist 测试。

## 8. 实施阶段

### Phase 0：协议和现状对账

目标：确认不重复造已有能力。

- [ ] 阅读 Pi `agent-loop.ts` / `harness-v2.md`、Codex `app-server/README.md` / MCP interface、Claude Agent SDK hooks types；
- [ ] 逐项对账 Codex `core/src/session/session.rs`、`core/src/state/session.rs`、`core/src/state/turn.rs`、`core/src/session/turn.rs`、`app-server-protocol/src/protocol/common.rs` 和 `app-server-protocol/src/protocol/v2/thread_data.rs`，确认 Nomi 只复用语义，不复制 Rust 实现；
- [ ] 对照现有 `productionRun`、Capability Core、MCP 和 Timeline 文件；
- [ ] 冻结本方案的 session / operation / event Schema；
- [ ] 明确第一阶段不引入外部 Runtime 依赖；
- [ ] 保存“借鉴 / 适配 / 不采用”对照表。

验证：文档中每个目标对象都能映射到一个现有文件或本方案新增文件，不出现第二个 Run、Artifact 或 Timeline 真相源。

### Phase 1：External Session + Operation 骨架

目标：外部客户端能连接、读取上下文、创建零额度草稿，并在断线后恢复。

**Files:**

- Create: `electron/capabilityCore/runtimeProtocolTypes.ts`
- Create: `electron/capabilityCore/runtimeProtocolValidator.ts`
- Create: `electron/capabilityCore/agentOperationService.ts`
- Create: `electron/capabilityCore/agentOperationService.test.ts`
- Modify: `electron/capabilityCore/dispatcher.ts`
- Modify: `electron/capabilityCore/core.ts`
- Modify: `electron/capabilityCore/gateway.ts`

- [ ] 先写测试：未初始化的 client 被拒绝；错误 projectId、错误 clientId、过期 revision、伪造 trust 状态全部被拒绝；
- [ ] 先写测试：创建 `PlanCandidate` 只产生 draft 和事件，不产生 Provider 调用、不产生预算扣款；
- [ ] 实现 `session/open` 和 `operation/start` 的 typed service；
- [ ] 将 Operation 持久化到已有 Production Run / capability state 适合的 durable repository，不放进聊天消息；
- [ ] 返回 `sessionId`、`operationId`、project revision、capabilitiesHash；
- [ ] 运行：`pnpm vitest run electron/capabilityCore/agentOperationService.test.ts electron/capabilityCore/core.test.ts`；
- [ ] 运行：`pnpm run typecheck`。

验收：外部客户端可以创建草稿；杀掉并重启 Nomi 后，草稿仍能被 `operation/read` 读到。

### Phase 2：Codex 风格的 snapshot + event cursor

目标：外部 Agent 可以可靠观察任务，而不依赖聊天记录。

**Files:**

- Create: `electron/capabilityCore/runtimeEventCursor.ts`
- Create: `electron/capabilityCore/runtimeEventCursor.test.ts`
- Modify: `electron/capabilityCore/mcpProtocol.ts`
- Modify: `electron/capabilityCore/mcpStdioServer.ts`
- Modify: `electron/productionRun/productionRunService.ts`

- [ ] 先写测试：事件只有在对应持久事实提交后才可读；
- [ ] 先写测试：`afterCursor` 重复读取不产生副作用；
- [ ] 先写测试：cursor 超过最新值返回空事件和当前 cursor，不报错；
- [ ] 先写测试：错误 project/run 绑定不能读取其他项目事件；
- [ ] 实现 `operation/read` 返回 snapshot；
- [ ] 实现 `operation/events` / `nomi_subscribe_run` 的长轮询，保留现有 25 秒上限；
- [ ] 所有 projection 去掉绝对路径、Provider URL、secret、完整 prompt；
- [ ] 运行：`pnpm vitest run electron/capabilityCore/runtimeEventCursor.test.ts electron/capabilityCore/nomiMcpProductionRuns.test.ts`。

验收：外部客户端断线后重新连接，可以用 snapshot + cursor 得到连续且不重复的状态。

### Phase 3：ExecutionContract 与 ProductionRun 绑定

目标：外部 Agent 提出的计划能够进入 Nomi 现有审批、预算和执行体系。

**Files:**

- Modify: `electron/productionRun/productionRunTypes.ts`
- Modify: `electron/productionRun/productionRunReducer.ts`
- Modify: `electron/productionRun/productionRunService.ts`
- Modify: `electron/productionRun/approvalPolicy.ts`
- Modify: `electron/productionRun/budgetLedger.ts`
- Modify: `electron/productionRun/submissionOutbox.ts`
- Test: corresponding existing `electron/productionRun/*.test.ts`

- [ ] 先写测试：计划预览中的 model、input Asset、duration、cost、capability downgrade 被完整保留；
- [ ] 先写测试：批准后生成 `contractHash`，合同 hash 改变时启动失败；
- [ ] 先写测试：未批准、过期预算、过期 revision、未知 Module、非法参数均不能触发 Provider；
- [ ] 先写测试：相同 `idempotencyKey` 只产生一个 Provider submission intent；
- [ ] 先写测试：Provider receipt unknown 进入 reconcile，不允许盲目重试；
- [ ] 将 `operationId`、`contractHash`、`moduleRef`、`inputAssetRefs`、`requestFingerprint`、`idempotencyKey`、`capabilitySnapshot` 绑定进 Run；
- [ ] 外部 MCP 只能提交候选或带合法合同 hash 启动，不能传入 `approved: true`、`providerTaskId` 或实际成本；
- [ ] 运行：`pnpm vitest run electron/productionRun electron/submissionLedger.test.ts electron/capabilityCore`。

验收：审批前零 Provider 调用；批准后成功路径只提交一次；断线不重复扣费。

### Phase 4：Artifact 接入现有时间轴

目标：MCP 生成结果不再停在“片段列表”，而是可以进入 Nomi 已有编辑闭环。

**Files:**

- Create: `src/workbench/editor/editorMcpTools.ts`
- Create: `src/workbench/editor/editorMcpTools.test.ts`
- Modify: `src/workbench/generationCanvas/agent/proposalTxn.ts`
- Modify: `src/workbench/generationCanvas/agent/proposalUndo.ts`
- Modify: existing Timeline command entry points
- Modify: `electron/capabilityCore/mcpProtocol.ts`

- [ ] 先写测试：生成 Artifact 自动登记 `AssetRecord(role: 'aiGenerated')`；
- [ ] 先写测试：`nomi_propose_adopt_artifact` 只生成 Proposal，不改 Timeline；
- [ ] 先写测试：Proposal 的 `baseRevision` 过期时拒绝 Apply，并提示重新读取上下文；
- [ ] 先写测试：Apply 失败时整笔补偿回滚；
- [ ] 先写测试：成功 Apply 后现有预览和导出能读取同一个 Asset 引用；
- [ ] 外部 Agent 只能提出 `insertAsset`、`replaceItemAsset`、`trimItem`、`moveItems` 等白名单命令；
- [ ] 禁止外部 Agent 直接传入 Timeline JSON、Zustand action、绝对文件路径或任意 Provider URL；
- [ ] 复用现有 `EditorCommandBus` / Proposal 事务原则，不新建一套只服务 MCP 的编辑状态；
- [ ] 运行：`pnpm vitest run src/workbench/timeline src/workbench/editor electron/capabilityCore`。

验收：用户可以在 Nomi 中检查 MCP 提出的 Diff，点击 Apply 后，片段进入现有时间轴，并能继续预览和导出。

### Phase 5：interrupt、steer 和外部控制边界

目标：补上 Codex 风格的任务控制，但不破坏 Nomi 合同语义。

**Files:**

- Modify: `electron/capabilityCore/agentOperationService.ts`
- Modify: `electron/productionRun/productionRunService.ts`
- Modify: `electron/capabilityCore/mcpProtocol.ts`
- Test: `electron/capabilityCore/agentOperationService.test.ts`
- Test: `electron/productionRun/productionRunService.test.ts`

- [ ] `interrupt` 在 Provider 尚未提交时直接终止 Operation；
- [ ] Provider 已提交后，`interrupt` 进入 cancel / reconcile 分支，不承诺 Provider 一定取消；
- [ ] `steer` 只允许作用于未 seal 的 PlanCandidate；
- [ ] 合同 seal 后的 steer 返回结构化错误，并要求创建新 PlanCandidate；
- [ ] 重复 interrupt、重复 steer 和重复 start 都是幂等操作；
- [ ] 运行：`pnpm vitest run electron/capabilityCore/agentOperationService.test.ts electron/productionRun/productionRunService.test.ts`。

验收：外部 Agent 能停止任务；不能通过 steer 偷改已批准合同；未知 Provider 状态不会被伪装成取消成功。

### Phase 6：内部 Agent Kernel 适配（可选，晚于外部 MCP）

目标：让 Nomi 内置 Agent 也复用同一套 Operation / Tool / Event / Proposal 语义，而不是为 UI 再造一套流程。

**Files:**

- Create: `src/workbench/ai/agentLoopPort.ts`
- Create: `src/workbench/ai/currentAgentLoopAdapter.ts`
- Create: `src/workbench/ai/piAgentLoopAdapter.ts` only if the Pi PoC passes the criteria below
- Modify: `src/workbench/ai/workbenchAgentRunner.ts`
- Test: `src/workbench/ai/agentLoopPort.test.ts`

- [ ] 先写接口测试：Agent Loop 能产生流式事件、工具结果、取消结果和最终 settlement；
- [ ] 当前 runner 先实现 `currentAgentLoopAdapter`，保持现有 Vercel AI SDK 行为；
- [ ] 单独做 Pi adapter PoC，验证消息 Schema、Tool Schema、AbortSignal、stream event、token usage、context transform 和错误语义；
- [ ] 只有当适配器不引入第二套 Session / Run / Tool authority 时，才允许引入 Pi 依赖；
- [ ] Pi adapter 不得拥有 ProductionRun、Asset、Artifact 或 Timeline 写权限；
- [ ] 运行：`pnpm vitest run src/workbench/ai/agentLoopPort.test.ts src/workbench/ai/workbenchAgentRunner*`。

验收：切换内部 Agent Loop 实现不会改变 Nomi 的审批、预算、Artifact 和项目修改语义。

## 9. 第一阶段 MCP 工具面

先开放小而完整的一组工具：

```text
nomi_get_generation_context       read
nomi_submit_generation_plan      draft
nomi_preview_execution           read
nomi_get_run                     read
nomi_subscribe_run               read
nomi_start_generation            commit，必须带 contractHash
nomi_get_artifact                read
nomi_propose_adopt_artifact      draft
```

暂不开放：

- 任意 Provider API；
- 任意文件读写；
- 自动批准额度；
- 自动覆盖时间轴；
- 任意项目 JSON 写入；
- 多镜头长流程的全自动提交；
- 导出发布的外部静默批准。

## 10. 不变量和安全门

### 10.1 事实源不重复

```text
聊天 = 解释和交互
Operation = 外部业务动作
ProductionRun = 生产事实
Project / Timeline = 项目事实
Artifact = 输出事实
```

任何新功能都不能把这些状态复制到新的 Store 或新的 Run 表里。

### 10.2 审批绑定执行

```text
用户批准 contractHash=A
→ Provider 只能执行 contractHash=A
→ 结果只能绑定到 contractHash=A 的 Run / Artifact
```

### 10.3 Provider 不确定时只对账

```text
提交结果 unknown
→ 读取持久 receipt
→ 查询 Provider 或账本
→ reconcile
→ 只有确认未提交才允许重试
```

### 10.4 项目写入只有一个入口

```text
UI / 内置 Agent / 外部 MCP
  → EditProposal
  → EditorCommandBus
  → reducer / validator / revision check
  → undo boundary
```

## 11. 真实用户任务验收

### J1：外部 Agent 生成单镜

```text
外部 Codex/Claude Code
→ 读取 Nomi context
→ 提交计划
→ Nomi UI 审批
→ 生成一次
→ 外部订阅 Run
→ 获取 Artifact
```

必须证明：审批前没有 Provider 调用，成功路径只有一个 submission intent。

### J2：断线恢复

```text
生成中关闭 Nomi
→ 重启 Nomi
→ 外部客户端重新连接
→ snapshot + cursor 继续读取
→ 任务不重复提交
```

### J3：Artifact 进入时间轴

```text
获取 Artifact
→ 提出放到播放头位置
→ Nomi 显示 Diff
→ 用户 Apply
→ Timeline 出现片段
→ 现有预览和 MP4 导出正常
```

### J4：旧 revision 冲突

```text
Agent 读取 revision=10
→ 用户手动修改时间轴到 revision=11
→ Agent 提案 Apply
→ Nomi 拒绝旧 Proposal
→ Agent 重新读取 context 后再提案
```

### J5：已提交但 Provider 状态未知

```text
Nomi 写入 submission intent
→ 进程在 receipt 返回前退出
→ 重启后状态 unknown
→ reconcile
→ 不盲目重试
```

## 12. 最终取舍

| 方案 | 判断 |
|---|---|
| 直接把 Pi 整个 Runtime 塞进 Nomi | 不采用，容易形成第二套 Session / Run / Tool authority |
| 直接把 Codex Rust Core 嵌进 Electron | 不采用，协议和边界值得借鉴，运行时不必复制 |
| 把 Claude Code 当成可复用的完整 Runtime | 不采用，公开部分主要是扩展和 SDK |
| 在现有 Capability Core 上补 Codex 风格控制面 | 采用，最贴合外部 MCP 场景 |
| 在现有 `workbenchAgentRunner` 上定义 AgentLoopPort | 采用，先保留现有实现，未来可接 Pi |
| 让外部 Agent 直接改时间轴 | 不采用，必须走 Proposal / EditorCommandBus |
| 让 Nomi 继续掌握合同、预算、Run、Artifact 和项目 revision | 采用，保持 Nomi authority |

最终方案可以压缩成一句话：

> **Codex 的控制面进入 Nomi MCP，Pi 的 Agent Loop作为内部可替换实现，Claude Code 的扩展治理作为 Skill/Hook 参考；Nomi 自己掌握媒体生产和项目编辑的全部事实。**

## 13. 交付门

第一阶段不以“工具数量”验收，而以以下不变量验收：

1. MCP 能连接并读取项目能力；
2. 外部计划不会在审批前花钱；
3. 合同 hash 能绑定审批和 Provider 请求；
4. 一次生成只产生一个 submission intent；
5. 断线恢复不重复扣费；
6. Artifact 有安全投影和 Nomi 深链；
7. Artifact 可以通过 Proposal 进入现有 Timeline；
8. 时间轴修改仍然可预览、导出、撤销；
9. 外部 Agent 不能伪造审批、Provider task、Artifact 或质量通过；
10. 内部是否采用 Pi 不影响以上任何 Nomi 领域语义。

相关现有计划：

- [`2026-08-08-production-run-foundation.md`](./2026-08-08-production-run-foundation.md)
- [`2026-08-08-production-mcp-evals.md`](./2026-08-08-production-mcp-evals.md)
- [`2026-08-21-agent-editor-workbench.md`](./2026-08-21-agent-editor-workbench.md)
- [`agentic-execution-core-concepts.md`](../../guide/agentic-execution-core-concepts.md)
