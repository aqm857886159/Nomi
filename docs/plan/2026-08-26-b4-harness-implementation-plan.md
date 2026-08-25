# B4 统一 Harness 实施计划（2026-08-26）

> 状态：实施合同，**本轮只交付计划，不写产品实现**。
> 
> 基线：本分支已 `git fetch origin main`，`origin/main = b16b8dfe68c9a620bf6df7c71b95ce9e2af4f6e1`。以下事实、文件和行号均以该基线复核；执行阶段开始前仍要重新 fetch，并把漂移记录到阶段任务中。

## 0. 范围、硬约束和完成定义

### 本轮要交付的范围

B4 只建设一套可恢复、可停止、可重试、可对账的控制面：

1. Nomi 自有 `Thread → Turn → Item` 领域契约；
2. 事件 envelope、版本 upcast、关联键和两个日志的桥接索引；
3. 集中的 `PolicyDecision` 与 `ApprovalDecision` 语义，内部 IPC/MCP 只是投影适配器；
4. 一个同步单循环的接线点，以及从事件恢复 UI/外部宿主所需的投影；
5. AI SDK 7 仅做隔离、只读、可删的 spike；继续使用 `ai@4` 作为产品运行时。

### 绝不改变的约束

- 四件套自建；不引入全栈 agent runtime。
- 通用事件日志与 ProductionRun 日志**不物理合并**。前者当前由 `electron/events/eventLogRepository.ts:218-249` 用 `fs.appendFileSync` 追加、旁路失败不阻断；后者由 `electron/productionRun/productionRunRepository.ts:90-98` 经 `writeSync + fsyncIfDurable` 持久化。`electron/durability.ts:1-9,24-63` 是唯一 fsync 语义源。
- `Thread/Turn/Item` 是 Nomi union；ACP/SDK 只在 adapter 边界出现，SDK 类型不能反向进入业务模型。
- ProductionRun 账本、预算/收据/幂等、锚一致性、Proposal/撤销、能力核权限永不被 Harness 反向改写。
- 本计划不承诺 fork/replay 产品能力；v1 只承诺恢复、审计和一致对账。

### 当前基线可复用的事实

- `electron/events/types.ts:9-26` 已有 v1 `NomiEvent`（`id/seq/ts/source/causeId/txnId/proposalId/type/payload`），并在 `:1-4` 规定历史只读 upcast；`agentChatTrace.ts:33-160` 已把 turn/tool/gate 观察写入通用日志。
- ProductionRun 创建事件、游标和命令幂等在 `electron/productionRun/productionRunRepository.ts:256-283,360-375,452-517`；审批与预算授权仍在 `:378-447` 各自落 durable 文件。
- 会话键/清会话/单次与多轮的基础收口已经存在于 `src/workbench/ai/agentSessionKey.ts:15-63`、`agentLoopMode.ts:15-63`；`workbenchAgentRunner.ts:37-83` 仍允许 caller 传散装 `sessionKey/skillKey/mode`，需在前置清理阶段收敛。
- `electron/ai/agentLoop.ts:1-92` 是现有循环底座；`electron/ai/agentChatV2Ipc.ts:11-45,76-169` 已有停止、超时拒绝和窗口销毁出口。
- `electron/capabilityCore/mcpGenerationPolicy.ts:70-75,123-203` 已有能力/阶段快照；`mcpGateConfirmation.ts:4-8,61-124` 与 `mcpConfirmationBinding.ts:17-65` 已有单 challenge 确认语义，B4 只接入统一 domain decision，不再造第三个确认面。

## 1. 分期总览

| 期次 | 性质 | 目标 | 主要新建/删除规模（估算） | 独立回滚点 |
|---|---|---|---:|---|
| **B4-0 契约期** | 新建 | 只定 domain contract、envelope、upcast 和键规则；不接 runtime | 新增约 180–300 行类型/契约测试；删除 0 | 删除 contract-only 文件，生产代码零影响 |
| **B4-1 前置清理期** | **§3 前置清理**，加新删旧 | 补齐 B1a/B1b/B1c/B1d，收敛 B2 工具注册和 B3 确认入口；同 commit 删除旧 caller 配置层 | 新增约 250–450 行；删除约 220–420 行散装声明/重复分支（最终以 diff 计） | 以保留的旧 key 字节快照和一次性回滚分支恢复；见 §4 |
| **B4-2 双日志接线期** | 新建 | 让现有 Agent trace、Proposal/事务、MCP challenge、ProductionRun gate 产生同一组关联键；建立只读 correlation index | 新增约 300–500 行；删除约 40–100 行旁路手写关联 | 回退 adapter/bridge，日志原文件和 Run 文件不动 |
| **B4-3 策略与单一审批期** | 新建 + 删除旧入口 | 实现 deny→ask→allow、三档闸门和单一 `ApprovalDecision`，由 IPC/MCP 各自投影 | 新增约 350–600 行；删除约 180–320 行重复确认/模式判断 | 关闭新 adapter，旧入口恢复；不得回滚账本已有记录 |
| **B4-4 事件流/恢复期** | 新建 | 由两条日志和 correlation index 派生 Thread/Turn/Item；验证 stop/restart/retry/receipt 对账 | 新增约 450–750 行；删除约 100–180 行重复 projection | 停用投影消费者，保留日志，UI 回到现有 trace/Run projection |
| **B4-5 SDK 7 spike** | 隔离只读 | 在临时 harness fixture 中验证 AI SDK 7 映射、Electron bundling、abort/stream 兼容性 | 新增约 120–220 行；删除 0（spike 失败直接删目录） | 删除整个 spike worktree/目录；不得触及 Run、预算、canvas |

> 行数是工程估算，不是承诺；每期开始前以 `git diff --stat origin/main...HEAD` 记录基线，超过上限必须停在该期复盘，不得靠继续加代码掩盖范围漂移。

## 2. B4-0：契约先行（第一期只定 domain contract）

### 2.1 计划文件与真相源

执行时只新增 contract-only 文件（建议目录 `electron/harness/domain/`）：

- `contracts.ts`：Nomi union、`ApprovalDecision`、`PolicyDecision`、envelope 和 correlation 类型；不导入 AI SDK、MCP 或 UI。
- `upcast.ts`：纯函数 `unknown -> LatestEventEnvelope`；不写文件、不调用 runtime。
- `contracts.test.ts`、`upcast.test.ts`：固定 fixture 和不变量测试。

真相源划分如下，禁止把投影当事实：

| 对象 | 字段草案（v1） | 真相源 |
|---|---|---|
| `Thread` | `threadId`, `projectId`, `sessionKey`, `status: active\|closed`, `createdAt`, `updatedAt`, `lastEventSeq` | 通用事件日志中 `thread.started/closed` 的回放；没有第二份 Thread store。`projectId` 来自事件所属项目目录，`sessionKey` 只来自 session-key registry。 |
| `Turn` | `turnId`, `threadId`, `runId?`, `mode: single-shot\|multi-turn`, `status: started\|waiting\|completed\|failed\|stopped`, `startedAt`, `endedAt?`, `modelRef?`, `causeId?` | 通用日志 `agent.turn.started/finished/error`；模型只记录经脱敏的 `modelRef`，不成为权限真相。 |
| `Item` | `itemId`, `turnId`, `kind: text\|tool\|progress\|approval\|artifact\|failure\|receipt`, `status: started\|delta\|completed\|waiting\|failed\|stopped`, `payloadRef?`, `toolCallId?`, `proposalId?`, `txnId?`, `runId?`, `causeId?` | 通用日志事件投影；`artifact/receipt/budget` 的事实字段必须回指 ProductionRun/receipt 文件，不能由 Item payload 复制一份。 |
| `ApprovalDecision` | `decisionId`, `challengeId`, `proposalId?`, `runId?`, `txnId?`, `outcome: allow\|deny\|expired\|cancelled`, `scope`, `planHash?`, `frozenFields`, `maxSpend?`, `currency?`, `expiresAt?`, `decidedAt`, `actor: user\|system`, `surface: nomi-ipc\|mcp-elicitation\|notification`, `reasonCode?` | 领域决定事件；**付费授权是否真实生效**以 ProductionRun approval/budget ledger 和 receipt 校验为准（`productionRunRepository.ts:378-447`、能力核 receipt authority）。 |
| `PolicyDecision` | `decisionId`, `capability`, `action`, `outcome: deny\|ask\|allow`, `reasonCode`, `capabilitySnapshotHash`, `phase`, `scope`, `estimatedSpend?`, `evaluatedAt`, `runId?`, `proposalId?` | 策略 evaluator 的不可变输出事件；它不是付款授权，授权仍由 ProductionRun/能力核完成。 |
| `EventEnvelope` | 保留现有 `v/id/seq/ts/source/causeId/txnId/proposalId/type/payload`，新增逻辑字段 `streamKind: observation\|correlation`, `projectId`, `threadId?`, `turnId?`, `itemId?`, `runId?`, `occurredAt`（adapter 内映射 `ts`） | observation stream 的 append repository；`seq` 只在单条通用日志内有序，不能拿来与 ProductionRun cursor 比大小。 |

### 2.2 Upcast 规则（历史永不回写）

1. 读取 v1 时把 `id -> eventId`、`ts -> occurredAt` 做内存映射，保留原字段；缺失 optional key 仍为 `undefined`，不凭 payload 猜值。
2. 旧事件没有 `streamKind/projectId/threadId/turnId/itemId` 时，`streamKind` 取 `observation`；`projectId` 只可由已知项目目录注入；无法证明的关联键保持空并产生 `upcast.warning`，不能“猜一个 runId”。
3. `runId` 只从已登记事件类型的结构化字段提取；未知 `type` 与未知 payload 原样保留为 opaque Item，不能丢弃。
4. 新写入只写最新版本；旧 JSONL、sidecar、ProductionRun 文件和 intent log 不重写、不迁移、不 fsync 策略变更。
5. upcast 必须幂等：同一字节输入两次得到深相等输出；坏 JSON/超 4KB sidecar 继续沿用既有 repository 的错误/截断语义。

## 3. 四个关联键：写入责任、跨日志对账与证明

### 3.1 写入规则

| 键 | 语义 | 谁铸造 | 何时写入/传播 |
|---|---|---|---|
| `runId` | 一次 ProductionRun | `productionRunRepository.create*` 铸造；agent 只有在已有 Run 上下文时携带 | Run 事件原生持有；通用 observation/correlation 事件复制同值；无 Run 的普通聊天保持空 |
| `causeId` | 直接因果父事件 | 产生事件的 writer 以父事件 `id` 铸造 | `turn.started → tool.proposed → policy/approval → tool.completed` 逐级指向 immediate parent；不把它当全链路 trace id |
| `txnId` | 一次提交/撤销事务 | Proposal/transaction coordinator 在 proposal 建立时铸造 | 同一批 Proposal、approval、commit/abort/revert observation 事件复用；不能由 UI 生成或修改 |
| `proposalId` | 用户批准的具体提案版本 | Proposal builder 铸造，参数 hash 固定后不可变 | `agent.tool.proposed`、`ApprovalDecision`、事务回执和 correlation record 贯穿；编辑参数必须新建 proposal，不覆盖旧值 |

### 3.2 两条日志如何对账（不合并文件）

- `eventLogRepository` 继续只写 observation/correlation JSONL；它通过 `runId`、`txnId`、`proposalId` 以及 `productionEventId/commandId/approvalId/billingEntryId` 的**只读 correlation record**指向 ProductionRun。
- ProductionRun 仍由 `productionRunRepository.execute` 及既有 scheduler/intent log 写入；Harness 不直接 append Run event、approval、budget ledger 或 intent record。`productionRunRepository.ts:360-375,452-517` 的幂等/版本冲突仍是唯一提交闸门。
- 对账器先按 `runId` 分组，再按 `proposalId/txnId` 做一对一或一对多（批量事务）匹配；最后用 `commandId/approvalId/billingEntryId` 回读 ProductionRun projection，比较 plan hash、scope、金额、attempt 和最终状态。两个 `seq/cursor` 不做跨文件排序比较。
- correlation record 缺生产事件、重复映射、金额/hash/scope 不一致时，输出 fail-closed 的 reconciliation error；不得自动修补任何一边。

### 3.3 测试必须“证明对账是对的”

B4-2 至 B4-4 的测试 fixture 固定走一条最小闭环：`turn.started → tool.proposed(proposalId,txnId) → policy.ask → approval allow → Run gate/approval/budget → intent prepared→committed → tool.completed → txn.committed`，并另测 deny/expired/abort。

每个测试直接读两类真实临时文件（不是只测内存 DTO），断言：

1. 所有带 `runId` 的 observation/correlation record 都能找到一个同 `runId` 的 ProductionRun；无 Run 的聊天不能凭空出现 Run。
2. 每个 `proposalId` 恰好对应一个 immutable plan hash 和一个最终 decision；同 proposal 重放不产生第二笔 approval/budget entry。
3. 每个 `txnId` 的状态只允许 `prepared → committed` 或 `prepared → aborted`；commit/abort 二选一，重复调用返回同一结果。
4. correlation record 指向的 `commandId/approvalId/billingEntryId` 在 Run projection 中存在且 scope、金额、attempt 相等；任一字段改动必须被断言拒绝。
5. 故意丢掉一条 observation 或制造重复 correlation record 时，对账器返回明确 orphan/duplicate 错误，测试断言**不写回**任何 Run 文件。
6. 并发确认用同一 `challengeId`，断言只出现一个 decision 和一个 receipt；使用 awaitable fixture，不使用私有 `waitFor`/`Date.now()` 轮询（R18）。

## 4. 各期执行卡（目标 / 文件 / 验收 / 回滚）

### B4-0 契约期（新建）

- **目标**：完成 §2 的 union、字段真相源、envelope、upcast 和键不变量；不导入 runtime、Electron IPC、MCP、AI SDK、ProductionRun。
- **涉及文件**：新建 `electron/harness/domain/{contracts,upcast}.ts` 及同目录测试；补 `docs/plan` 的字段/不变量记录。只读参考 `electron/events/types.ts:1-69`、`electron/events/eventLogRepository.ts:1-36`。
- **验收门**：类型测试覆盖每个 union 分支；upcast fixture 覆盖 v1、未知 type、缺 key、sidecarRef、重复读；`rg` 证明 contract 目录无 `ai/productionRun/capabilityCore` runtime import；`pnpm run typecheck` 与本期 targeted Vitest 退出码为 0。
- **回滚**：删除 contract-only 文件即可；不得需要回滚任何现有日志或 schema。
- **规模**：新增约 180–300 行，删除 0。

### B4-1 §3 前置清理期（加新删旧）

- **目标**：把配置层收成面板 registry/统一 adapter。B1a/B1b/B1d 已存在的 `agentSessionKey.ts`、`agentLoopMode.ts` 保留其旧 key 字节和单次清会话语义；本期补齐漏掉的 caller，并完成 B1c systemPrompt 合成器（含项目偏好记忆层，Master Plan Rev.2 已拍板）。B2 统一工具 schema/registry；B3 将内部确认、MCP challenge 和单次/多轮模式改为同一 domain 输入。**这是 §3 前置清理，不是 B4 runtime 新建。**
- **涉及文件**：`src/workbench/ai/{agentSessionKey,agentLoopMode,workbenchAgentRunner}.ts`；`src/workbench/creation/CreationAiPanel.tsx`、`src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx`；`src/workbench/generationCanvas/agent/{runDirectionPlanner,runStoryboardPlanner,shotVerifyJudge,generationCanvasTools}.ts`；`electron/ai/{agentChatV2,agentChatV2Ipc,documentTools,canvasTools,agentLoop}.ts`；新增 registry/adapter 目录；MCP 只接 adapter，不改既有 challenge 语义（`electron/capabilityCore/mcpGateConfirmation.ts:61-124`）。执行前用 `rg` 复核审计清单 `docs/audit/2026-08-24-internal-agent-architecture-audit.md:10-41`，不能把旧清单当现状。
- **加新删旧边界**：registry 成为唯一声明入口后，同 commit 删除 caller 手写 `sessionKey/skillKey/tools/systemPrompt/mode` 和重复确认分支；不保留 feature flag 双路径或 fallback。旧 session key 只作为兼容字面值测试 fixture，不再作为第二实现。
- **验收门**：旧 key fixture 逐字节相等；四类入口（创作、画布、方向/脚本单次、shot verify）都只经 registry；工具 schema 只有一个可执行来源；同一 challenge 仍只产生一个确认面；单次链先清会话、多轮链保留历史。跑 targeted tests、`pnpm run check:agents-sync`、`pnpm run typecheck`、`pnpm run lint:ci`，全部退出码 0。
- **回滚**：先保留本期前的 commit tag；若新 registry 失败，整体 revert 本期 commit，恢复旧 caller。由于 session key 字节和日志 schema 不变，不需要数据迁移；已生成的事件/Run 文件保持可读。禁止只恢复一个面板形成新旧并行版。
- **规模**：新增约 250–450 行，删除约 220–420 行；精确数字以实现 diff 为准。

### B4-2 双日志接线期（新建）

- **目标**：在不改变两条持久化契约的前提下，让所有新事件按 §3 写四键，并生成 correlation record；新增只读 reconciliation service。
- **涉及文件**：新增 `electron/harness/{correlation,adapters,reconciliation}.ts`；接入 `electron/events/agentChatTrace.ts:33-160`、`electron/events/eventLogRepository.ts:218-249`、`electron/productionRun/productionRunService.ts:713-789` 的读取/投影；调用既有 `electron/productionRun/productionRunRepository.ts` 和 `productionRunIntentLog.ts` API，不改其 ledger/intent 语义。必要的只读 DTO 测试放 `electron/harness/*.test.ts`。
- **验收门**：§3.3 的双文件真实 fixture 全绿；duplicate command/revision conflict 仍由 Run repository 拒绝；事件日志写失败不阻断聊天，Run durable 写失败仍 fail-closed；reconciliation 对 orphan/duplicate/hash/amount/scope 漂移给非零测试断言。`pnpm run check:heavy-path` 必须通过，确认没有新增同步大 payload/base64。
- **回滚**：停用 bridge/reconciliation consumer 并 revert adapter；不删除、不重写已有通用日志、Run events、approvals、budget ledger、intent log。correlation JSONL 是旁路产物，可按项目版本保留供审计。
- **规模**：新增约 300–500 行，删除约 40–100 行。

### B4-3 策略与单一审批期（新建 + 删除旧入口）

- **目标**：实现 domain `PolicyDecision`（deny/ask/allow、能力快照、阶段/范围、估算花费）和 `ApprovalDecision`（范围、冻结字段、过期、surface、receipt 关联）；内部 IPC 与 MCP 适配同一决定，ProductionRun/能力核仍是最终授权。
- **涉及文件**：新增 `electron/harness/policy/`、`electron/harness/approval/`；接入 `electron/ai/agentChatV2Ipc.ts:11-45,124-169`、`agentChatV2.ts:276-318`、`electron/capabilityCore/mcpGenerationPolicy.ts:123-203`、`mcpConfirmationBinding.ts:17-65`。`mcpGateConfirmation.ts` 仅作为已有 challenge surface，不重写其绑定和 fail-closed 规则。
- **验收门**：策略矩阵覆盖只读、project_write、paid、anchor checkpoint、无 surface、模型能力不足、预算不足、过期和取消；同 challenge 并发只生成一张卡/一个 decision；审批通过但缺 receipt/Run authorization 时执行仍被拒；deny 不产生 tool side effect；三档闸门与 session trust 有可追踪事件。跑 targeted tests、`pnpm run check:ipc-sender-binding`、`pnpm run typecheck`、`pnpm run test`，退出码全为 0。
- **回滚**：关闭新 policy/approval adapter，恢复调用既有 IPC/MCP confirmation；不得删除已落账 approval、receipt 或 budget entry，历史事件继续由 upcast 读。
- **规模**：新增约 350–600 行，删除约 180–320 行。

### B4-4 事件流/恢复期（新建）

- **目标**：从 observation log + Run projection + correlation index 派生 Thread/Turn/Item，提供 `started → delta* → completed`、waiting/stopped/failed 状态；把 stop、restart、单条 retry、receipt/花费和 artifact 回执放进同一可读故事。
- **涉及文件**：新增 `electron/harness/projection/`、`electron/harness/recovery/`；读取 `electron/events/` 和 `electron/productionRun/productionRunService.ts:53-76,713-789`；渲染适配落 `src/workbench/ai/` 和现有 agent stream consumer 所在目录，MCP 只复用 adapter；不新增第二个 UI 状态 store。
- **验收门**：真实任务 J1（目标→确认→单条重跑→停止→导出）至少跑一遍内部宿主和一遍 MCP 宿主，断言两者得到同一个 Run；关闭/重启后从 cursor 恢复，不重复扣费；失败条能定位 item 且 retry 只生成新 proposal；一张审批卡一次确认。`pnpm run check:walkthroughs` 只算静态检查，**不能**作为走查通过证据；必须另跑 Electron/Playwright walkthrough，记录命令和真实退出码，并保存截图/日志。
- **回滚**：停用 projection consumer，UI 退回现有 `agentChatTrace`/`productionRunService` 投影；日志只读保留，绝不回放写回 Run。
- **规模**：新增约 450–750 行，删除约 100–180 行。

### B4-5 AI SDK 7 隔离只读 spike（新建，可删）

- **目标**：在独立 fixture/worktree 验证 SDK 7 的 `ToolLoopAgent`/stream/abort/approval 事件能否映射到 Nomi adapter；产品仍锁 `ai@4`。不得写入 ProductionRun、预算、receipt、canvas 或真实项目目录。
- **涉及文件**：仅 `spikes/ai-sdk7-harness-readonly/`（或等价独立 worktree）、fixture、bundle smoke script；不得修改 `package.json` 产品依赖、`electron/productionRun/**`、`src/workbench/generationCanvas/**`。
- **验收门**：只读 fixture 可重复运行；abort/repair/error 事件有映射或明确缺口；Electron bundling、Node/ESM、包体和启动耗时有记录；grep/测试证明没有 ProductionRun/预算/canvas 写入调用。spike 失败不阻塞 B4-0..4，也不触发升级。
- **回滚**：直接删除 spike 目录/分支，无迁移、无数据清理。
- **规模**：新增约 120–220 行，删除 0。

## 5. 本轮绝对不动的文件/模块

以下是保护项的具体落点；B4 adapter 只能调用其公开接口，不能改写其事实或另存一套：

- `electron/productionRun/productionRunRepository.ts`：Run event、revision/command 幂等、approval JSONL、budget ledger、snapshot。
- `electron/productionRun/productionRunIntentLog.ts`：prepared/committed/aborted、hash-chain、HMAC、fencing epoch。
- `electron/productionRun/productionRunService.ts` 的 Run projection/cursor 合同（`53-76,713-789`）以及 `multiShotBatchScheduler.ts` 的 dispatch/poll/materialize 责任。
- `electron/durability.ts`：durable/ephemeral 与 fsync 唯一开关。
- `electron/capabilityCore/generationDispatcher.ts`、`appIntegration.ts`、`security.ts`、`mcpVerify.ts`、receipt authority：能力核、来源绑定、receipt 校验和 paid side effect。
- `electron/productionRun/anchorCheckpoint.ts`、`src/workbench/generationCanvas/agent/{proposalTxn,applyCanvasToolCall,proposalUndo}.ts` 及其测试：这些 Proposal/Apply/Undo/锚一致性实现只可被 Harness 调用，Harness 不直接写画布。B4-1 允许改 `generationCanvasTools.ts` 的 registry adapter，但不改上述事务内核。
- `package.json` 中现有 `ai@4` 依赖与产品 runtime；SDK 7 只能在 B4-5 隔离目录。

“不动”不等于不测试：保护项必须作为黑盒事实源被读取、断言和故障注入；不允许为了让 gates 变绿而放宽其约束。

## 6. 回滚与发布纪律

- 每期独立 commit、独立验收、独立可 revert；不得把 B4-1 的旧配置删除与 B4-2 的日志桥接混在同一 commit。
- 每期开始前记录 `git branch --show-current`、`git rev-parse origin/main`、变更文件和预计行数；每期结束保留 targeted test、diff stat 和回滚演练结果。
- 纯文档/实现期均执行：`pnpm run gates > /tmp/gates-b4plan.log 2>&1; echo exit=$?`，读取最后一行和文件尾部确认真实退出码。**不能**把 `test`/`build` 接在管道后用管道状态冒充退出码。
- `check:walkthroughs` 只扫描静态声明；真实走查必须亲跑 Electron/Playwright 命令，单独保存 stdout/stderr、截图和 `exit=$?`。没有亲跑记录就不能把该期标为体验通过，即便 gates 为 0。
- 本计划交付本身只需 B4 文档变更；实现阶段仍须按项目五门顺序（filesize → tokens → i18n → heavy-path → lint → typecheck → test → build）执行并在 owner 批次中攒批 push。

## 7. 风险、未知和待 owner 拍板

1. **Correlation record 的物理落点仍有一个不可逆选择**：是把 `commandId/approvalId/billingEntryId` 关联只放在通用日志的 correlation sidecar，还是扩展 `RunCommand/RunEvent` 的非账本 metadata。此计划默认先用旁路 correlation record，避免触碰保护 schema；若 owner 要扩展 Run metadata，必须在 B4-2 前单独拍板、给迁移/回滚方案。
2. `origin/main` 的 B1a/B1b/B1d 已有实现，但审计表仍记录旧 caller；我没有把“所有残余调用点已清零”当成事实。B4-1 开始时必须用 `rg` + typecheck 找到完整入口集，行数估算可能变化。
3. 现有 `NomiEvent` 的 `runId` 主要仍在 payload/注释语义中（`electron/events/types.ts:6,32-45`）；将它提升为 envelope 逻辑字段需要 adapter/upcast，不能直接改历史 JSONL。旧事件能否无歧义提取 runId，要以逐类型 fixture 结果为准。
4. `ProductionRun` 的事件 cursor 与通用日志 seq 不共享时钟/序列；如果未来有人要求跨文件严格时间排序，必须另行拍板，当前只承诺键关联与状态对账。
5. “单一审批”是否允许 session-level trust 的默认扩散，主方案只拍板了三档闸门和收敛方向，默认先保持现有 trust scope；任何扩大范围都应在 B4-3 的策略矩阵中标为待拍板，不由实现者自行放宽。
6. AI SDK 7 spike 的真实包版本、Electron bundler/ESM 兼容性和性能收益目前没有本地证据；在 spike 前不宣称“可升级”或“比 ai@4 更好”。

## 8. 阶段完成判定

一阶段只有同时满足“契约/代码事实、自动化断言、真实走查（若涉及 UI/体验）、回滚演练、退出码记录”才可报告完成。仅 `gates` 绿色只能证明静态/自动化门通过，不能证明 Harness 已恢复、对账或用户走查正确；尤其不能把 `check:walkthroughs` 的 0 当成亲跑证据。
