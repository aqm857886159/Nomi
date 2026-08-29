# 项目级常驻 Agent 与统一能力脊梁设计

> 状态：已批准方向的实现规格，待独立架构 / 产品 / 前后端复核后进入分片实施。
>
> 基线：`origin/main@a7a07cc4`，已包含 [PR #181](https://github.com/aqm857886159/Nomi/pull/181) 的 pi Agent 换芯与 [PR #204](https://github.com/aqm857886159/Nomi/pull/204) 的单一语义 owner 门岗。
>
> 关系：本文件不是第二份总计划。总体目标、阶段和产品边界仍以 [统一 Agent 总计划](../plans/2026-08-24-unified-agent-master-plan.md) 与 [R2-U1 逐文件迁移边界](../../plan/2026-08-26-pi-agent-loop-file-migration.md#r2-u1项目级统一-agent必交不是可选-ui-优化) 为准；本文件只把 R2-U1、MCP、Skill 和近期交互设计收敛成可实施合同。
>
> Ownership ADR：本文件同时是 R2-U1 的增量所有权裁定。它只新增 ProjectAgentHost 这个“会话 / 回合 / Item / 排队 / 审批引用”的持久 owner；现有文稿、画布、ProductionRun、素材、目录和 pi snapshot owner 不变。后续若改变这些边界，必须另提 ownership ADR，不能在实现 PR 中顺手漂移。
>
> **2026-08-29 cutover 覆盖决策：** 本文件中关于旧 conversation、Pi context 和 Canvas proposal receipt 可执行导入/staging 的内容已由 [全阶段执行路线图](../../plan/2026-08-29-project-agent-host-execution-roadmap.md#一次性-cutover-决策) 替代。发布只做原始文件只读归档，新 Host 从空状态启动；旧审批、回合和 Undo 不重放。作品数据与 ProductionRun 仍由原领域 owner 保留，新 Host 自身的 CAS/恢复合同不变。

## 一句话结论

Nomi 最终只有一个跟随项目常驻的 Agent。用户在创作、生成、预览之间切换时，换的是工作台，不是 Agent；对话、排队、审批、上下文和任务关联都不换人、不丢失、不重复执行。

为了做到这一点，先把现在散落在两个面板、MCP 和 Skill 里的同类能力收成一份“共同操作说明书”，再把会话与审批迁到项目总机，最后才替换界面。

## 用户为什么会觉得现在是两个 Agent

当前虽然已经共用 pi AgentSession，但产品层仍然分裂：

- 创作区和生成区各自保存消息、草稿、当前回合和审批；切页面实际上会换会话归属。
- 两个面板各自决定工具能不能用、要不要确认、怎样执行；MCP 又维护另一套工具名、schema、权限和 handler。
- Skill 现在主要把方法论塞进提示词，声明的工具和权限没有成为运行时的真正缩权边界。
- 生成忙碌时再次发送，旧面板会直接忽略；用户看不见“已经排队”，也不知道指令是否收到。
- 长任务已经有 ProductionRun，但 Agent 还可能直接走 renderer 生成队列；同一件付费任务有形成第二本账的风险。

底层逻辑是：换了同一颗推理引擎，不等于产品只有一个 Agent。只要消息、审批、工具定义和任务身份仍由不同页面分别拥有，用户就仍在和几位“长得一样、彼此不完全记得”的助手说话。

## 用户最终会体验到什么

### 1. 页面切换不换人

用户在创作页说“把第二段拆成三个镜头”，Agent 开始工作后切到生成页，原来的对话、正在执行项和待确认卡仍在同一个位置。再切预览页也一样。

页面只向 Agent 提供“你此刻正在看什么、选中了什么”的临时视野；已经发出的任务使用发送那一刻冻结的项目和目标，不会跟着后来选择漂移。

### 2. 忙时发送不会消失

同一项目一次只推进一个对话回合。Agent 忙时用户继续发送，新指令会立刻显示“排队中 · 第 1 个”，可以在开始前编辑或取消。上一轮稳定结束后按顺序执行，不靠用户重复发送。

### 3. 同一件事只出现一张卡

一条指令或工具动作有稳定的 Item 身份。它会原位从“准备中 → 待确认 → 已排队 → 执行中 → 完成 / 失败”变化，不会因 Pi、MCP、TaskCenter 和画布分别回报而出现四张看似不同的卡。

### 4. 长任务仍由任务中心负责

Agent 可以发起或跟进制作任务，但不会复制 ProductionRun。侧栏显示同一个 `runId` 的简要进度和入口；预算、gate、job、artifact、恢复和对账仍只以 ProductionRun 为准。

### 5. 手动编辑优先，不偷偷覆盖

Agent 的提案记录发送时的目标版本。用户随后手动改了文稿、节点、结果版本或时间轴，旧提案执行前必须重新核对；不一致时显示“基础内容已变化”，让用户查看差异、基于最新版重做或放弃。

### 6. 旧历史找得到，但不伪造共同记忆

升级时，创作和生成两边的历史线程都保留并标注来源。它们不会按不存在的时间线硬拼成一段“共同经历”。能证明最近活动和完整 pi 快照归属时，最近线程可成为新的活动线程；无法证明时创建一条干净的项目主线程。其它旧线程仍可打开，用户选择继续时再进入统一宿主，不再恢复 area 身份。

## 三种实施方法的取舍

| 方法 | 用户短期看到 | 结构后果 | 结论 |
|---|---|---|---|
| 一次性重写 Host、工具、付费链和 UI | 很快出现新面板 | 一次同时改会话、业务写入、花费和布局，失败时很难知道哪层错；容易保留旧路兜底 | 不选 |
| 先只合并两个面板的会话，再处理 MCP / Skill | 页面较快“像一个 Agent” | 面板先接一次旧工具表，能力合并后还要再接一次；重复实现继续增长 | 不选 |
| 先立一条共享能力脊梁，再迁 Host，最后换 UI | 第一片几乎没有可见变化 | 每迁一项就删除它的旧 owner；Host 一开始就接稳定合同；付费链和 UI 可逐层验收 | 采用 |

真正的取舍点不是“快不快看到新界面”，而是要不要再为赶界面而制造一套以后必须推倒的中间架构。这里选择先把不会再变的边界立住。

## 总体结构

```text
常驻 Agent UI ── ProjectAgentHost ─┐
                                  ├─ Capability Registry ─┬─ DocumentPort
MCP client ─────── MCP adapter ───┤                       ├─ CanvasPort
                                  │                       └─ ProductionRunAdapter
内部 production caller ───────────┘
                                                             │
                                              各领域继续保管自己的真相
```

这里刻意没有让 MCP 绕一圈聊天 Host：外部 MCP 调用和内部 Agent 可以复用同一能力执行器，但 MCP 不应伪装成一段 Nomi 对话，也不应污染项目聊天历史。后台 production caller 同理，直接进入 Registry / ProductionRun。需要在 Agent 侧展示的任务，只用 `TaskRef` 关联同一个 Run。

### ProjectAgentHost 是总机，不是新数据库

Host 只拥有：

- 当前项目绑定、活动线程、回合、稳定 Item 和发送队列。
- Agent 工具待确认的生命周期，以及它指向的目标 / 任务 / 提案引用。
- 本轮使用的模型、Skill、能力集合和 pi context 引用。
- 跨页面订阅与单调 revision，保证 renderer 不靠猜测补状态。

Host 不拥有：

- 文稿正文、画布节点 / 边 / group / result 历史、时间轴 clip。
- ProductionRun 的 gate、job、budget、artifact、ledger 或 provider receipt。
- 素材文件、模型目录、API key 或 pi 私有 snapshot 内容。

这些数据仍由现有领域 owner 保存。Host 只存稳定引用；否则“统一”会变成把所有业务复制进第三本总账。

### Capability Registry 是共同说明书，不是万能工具箱

每个真实业务动作只定义一次：

```ts
type CapabilityContract = {
  id: string
  version: number
  inputSchema: unknown
  outputSchema: unknown
  effect: 'read' | 'reversible_write' | 'destructive' | 'paid'
  execution: {
    port: 'document' | 'canvas' | 'production-run' | 'asset'
    availability: 'main_only' | 'renderer_required' | 'main_or_renderer'
  }
  exposure: 'internal_only' | 'mcp_safe' | 'legacy_unverified'
  requiredScope: string
  targetKind: string
  approval: 'none' | 'proposal' | 'human_receipt'
  projections: { pi?: unknown; mcp?: unknown; ui?: unknown }
}
```

含义用大白话说：同一个“读画布”只有一份输入、输出、只读属性和执行规则。Pi 叫 `read_canvas_state`，MCP 叫 `nomi_read_canvas`，只是两个门牌；进门后必须到同一个房间。

纯 `CapabilityContract` 与 main-only `CapabilityExecutorRegistry` 必须分开。renderer、Pi 和 MCP 只能导入纯合同；特权 executor 由主进程按 effect 注入最小端口。`read` executor 只拿到 `CanvasReadPort`，拿不到 apply、provider、ProductionRun submit 或 spend grant。执行前解析 canonical input，执行后再校验 canonical output。`readOnlyHint` 只是这一最小权限约束的外部投影，不是靠人工填 `effect: read` 获得的安全保证。

Registry 不代表所有内部工具都向 MCP 公开：

- `internal_only`：只给 Nomi 内部 Agent，用于依赖当前编辑器或尚无安全外部目标的能力。
- `mcp_safe`：经过项目 lease、target 和协议校验后可以外放。
- `renderer_required`：执行时需要当前专业界面提供端口；无界面就明确失败，不偷偷换一套 headless 实现。

Phase 1 Slice A 会把现役但尚未经过 lease 的 MCP projection 暂时登记为 `legacy_unverified`。它是 capability owner baseline 中带删除阶段的迁移债，不是第三种最终 exposure；只有 Slice B 的通用 project-session、连接绑定和当前项目身份复验全部通过后，才能改成 `mcp_safe`。

入口 adapter 可以增加 transport 字段，例如 MCP 的 `leaseHandle`；但它必须把这些字段拆成同一条已验证调用，不能再复制一份业务 input schema。请求里的 `projectId` 只是选择提示，不能成为授权。内嵌 Agent 的 target 由 Host 冻结；MCP 的 target 由连接 lease / project resolver 冻结；后台 caller 也必须提供显式 principal 和 policy，不能因绕开 Host 自动获得全权限。

MCP 的 project resolver 还必须回答“这个连接是否有权选择它”，不只是“这个项目是否存在”。可信来源只允许：GUI 当前 binding、同一连接刚创建项目后由服务端签发的 selection handle、Host/用户签发的 handle，或明确的 server allowlist。其他连接创建的项目、旧 connection handle 和 allowlist 外项目都在签 lease 前拒绝；若产品以后决定本地 bearer 可读全部项目，也必须把它写成显式 server policy，而不是由 workspace lookup 暗中授予。

### 一个能力可以有多个端口，但只能有一个业务执行器

画布正在应用中打开时，读写由 renderer store 完成；应用关闭的 MCP 只读可能从项目文件完成。这两个是同一 CanvasPort 的环境适配器，不是两套业务语义。

renderer port 不能等于“此刻活动窗口”。主进程签发的 `SurfacePortBinding` 必须绑定 `bindingId + webContentsId/processId/frame/origin + immutableProjectUuid + projectGeneration + surfaceInstanceId + portRevision/nonce`。Port resolver 只按冻结调用选端口；窗口重建、项目恢复、generation bump 或迟到回包都会使旧 binding 失效。写能力缺目标端口时明确失败，不能偷偷落到另一个项目或改走磁盘实现。

项目水合开始时必须在首次异步读取前同步 suspend / rotate 旧 Surface binding，并让 main 的 open-project route 一并失效；不能只清 renderer 的 save target。完成 snapshot restore、event-tail replay 和最终 ownership abandon 后，才由 main 根据 workspace manifest 的 UUID / generation 重新签发。水合中 renderer active project 为空时也必须 fail closed，不能把“空”解释成“没有冲突”。

Surface 生命周期使用独立只读通道，最小顺序是 `suspend → commitCanvasRead → release`：suspend ACK 前 main 已撤销旧 route；水合失败保持 suspended；回项目库同步 release；普通保存与订阅重绑不旋转 binding。legacy manifest 缺 UUID/generation 时先原子、幂等补齐一次，重启必须稳定；失败返回 `project_identity_unavailable`，绝不能每次 bind 临时生成新身份。

禁止的是：Pi 在 `applyCanvasToolCall` 写一份“读画布该返回什么”，MCP 又在 `canvasGraph` 写另一份。正确结构是同一 canonical result，经 Pi formatter 变成紧凑文本、经 MCP formatter 变成 JSON。

## 项目宿主的最小数据合同

### 身份

```ts
type ProjectBinding = {
  projectId: string
  immutableProjectUuid: string
  projectGeneration: number
}

type VerifiedCaller =
  | { kind: 'embedded-agent'; threadId: string; turnId: string; itemId: string }
  | { kind: 'mcp'; principal: string; sessionId: string; connectionNonce: string; leaseId: string }
  | { kind: 'internal'; principal: string; operationId?: string }

type VerifiedCapabilityInvocation<I> = {
  invocationId: string
  capability: { id: string; version: number }
  binding: ProjectBinding
  caller: VerifiedCaller
  authorityRef: string
  policyRevision: number
  target: TargetRef
  preconditions: PreconditionSet
  input: I
  inputHash: string
  actionHash: string
  contextSnapshotRef?: ProjectAgentContextRef
  task?: TaskRef
}

type TaskRef = {
  kind: 'production-run'
  runId: string
  expectedRunRevision?: number
  stageId?: string
  jobId?: string
  shotId?: string
}
```

`operationId` 继续只是外部别名，不另存第二个任务身份。

### 精确目标

```ts
type DocumentAnchorRef =
  | { kind: 'whole-document' }
  | { kind: 'range'; from: number; to: number; selectedTextHash: string }
  | { kind: 'cursor'; position: number; beforeHash: string; afterHash: string }
  | { kind: 'document-end'; trailingTextHash: string }

type TargetRef =
  | { kind: 'document'; documentId: string; anchor: DocumentAnchorRef }
  | { kind: 'canvas'; nodeIds: string[]; groupIds?: string[] }
  | { kind: 'canvas-result'; nodeId: string; resultId: string }
  | { kind: 'timeline'; clipIds: string[] }
  | { kind: 'artifact'; runId: string; artifactId: string; version: number; contentHash: string }
  | { kind: 'production'; runId: string; gateId?: string; jobId?: string }

type PreconditionSet = {
  document?: { revision: number; contentHash?: string }
  nodes?: Array<{ nodeId: string; revision?: number; contentHash: string }>
  groups?: Array<{ groupId: string; membershipHash: string }>
  edges?: Array<{ relationHash: string }>
  results?: Array<{ nodeId: string; resultId: string; pointerHash: string }>
  clips?: Array<{ clipId: string; revision?: number; contentHash: string }>
  run?: { runId: string; revision: number }
}
```

这里吸收卡栈 / 结果版本设计的关键教训：只记 `nodeId` 不够。用户说“第二版”或“这个折叠组”时，必须能指到 `resultId` 和 group；卡栈与折叠只是显示投影，不能成为 Agent 的数据 owner。

目标身份与冲突前提分开：`TargetRef` 回答“改谁”，`PreconditionSet` 回答“基于哪个版本”。不能用一个全画布 revision 代替多个实体的内容 hash；否则移动一个无关节点会误拦全部提案，group membership 或 result pointer 变化又可能漏拦。`actionHash` 必须覆盖 capability version、完整 ProjectBinding、canonical input、TargetRef、PreconditionSet、Task/Gate 和价格快照。冲突卡要指出具体哪一项发生变化。

文稿的 `replace_selection` / `insert_at_cursor` 在入队时就冻结 range/cursor 与相邻文本 hash，并与 document revision 一起进入 preconditions；执行时不得重新读取“当前选区”。用户只移动光标 / 选区且正文未变时，操作仍写入发送时冻结的位置；只有文稿 mutation 使 revision、正文或锚点相邻文本 hash 失配时，旧操作才明确冲突并可按最新版重做。任何情况下都不能写到后来选中的位置。

### 审批

```ts
type ProposalApprovalRef = {
  approvalId: string
  threadId: string
  turnId: string
  toolCallId: string
  actionHash: string
  target: TargetRef
  preconditions: PreconditionSet
  expiresAt: string
}

type HumanApprovalRef = {
  challengeId: string
  handoffId: string
  binding: ProjectBinding
  runId: string
  gateId: string
  contractHash: string
}
```

Host 只拥有 `ProposalApprovalRef` 的 pending / claimed / expired 生命周期，它只服务可撤的本地提案。`HumanApprovalRef` 只是显示与相关性引用：challenge、有效性、claim、expiry、receipt 和一次性消费全部由现有 main authority / ProductionRun 管理，Host 不持久化 `receiptId` 或 `approved: true`。内嵌 Agent 与外部 MCP 若显示同一批准，必须读取同一个 authority 冻结投影，其中包括真实参考素材角色、模型、价格和冻结参数。

### Thread / Turn / Item / Queue

- Thread 是项目内的对话，不含 creation / generation area 身份。
- Turn 是一次用户指令及其模型 / 工具推进；同一项目最多一个 running，其余进入可见 FIFO。
- QueueItem 在入队时冻结 ProjectBinding、TargetRef、PreconditionSet、context/Skill/capability 版本、policy revision、附件资产引用和 origin surface。编辑默认只改文字，不跟随后来的选择；“重新绑定到当前选择”必须是显式动作。
- Proposal 等待会阻塞当前 turn；拒绝、过期或取消立即释放队列。ProductionRun 已持久受理后 turn 即可结束，长轮询独立更新 Task Item，不能堵住项目聊天。
- Item 是稳定展示记录：用户文本、Agent 文本、工具、提案审批、任务、产物、失败各有独立 Item，用 `parentItemId/correlationId/ref` 关联；“一件事一张卡”是禁止同一语义对象重复投影，不是把整轮所有动作塞进一个 Item。
- origin surface 只用于解释“从哪里发起”，不能决定 session key、权限或落点。
- renderer 只订阅 `ProjectAgentPatch(binding, hostRevision, previousRevision, changes)`；patch 和补读 snapshot 都携完整 `ProjectBinding`。UUID/generation 不同的补丁即使 projectId 相同也拒绝；`previousRevision` 对不上时按同一 binding 重读 snapshot，不自行合并猜测。

唯一状态词表沿用 #194：`drafting | proposed | declined | queued | running | done | failed | stopped`，另有 `retryable/deviated` flags；页面文案只做本地化投影。Task Item 不持久复制 ProductionRun 状态，只保存 `TaskRef`，展示时从 Run projection 读取。若 Run 暂不可读，只能显示带 source revision 的“最后已知投影”，不能冒充当前事实。

### Host 持久化与 exactly-once

- store 以 `{immutableProjectUuid, projectGeneration}` 分区，不依赖一个全局 current project。
- 所有 mutation 都是 `{commandId, expectedRevision, binding, sender, type, payload}`，经每项目单一串行 reducer；`commandId` 持久幂等。
- Turn、Item、QueueItem、ProposalApprovalRequest 使用闭集状态机，明确 Stop、cancel、edit、tool result 和重复应答的胜出规则。
- async 结果必须重新进入 reducer，用 turn token、binding、target preconditions 和 expected revision CAS 后才发布。
- durable store 有独立 schema version、checksum、atomic replace 与恢复规则；best-effort `.nomi/events` 只做审计投影，绝不作为恢复真相。

### Pi context 的项目级绑定

统一 Host 不再使用 `creation | generation` 作为活跃 context 身份。canonical binding 为：

```ts
type ProjectAgentContextBinding = {
  project: ProjectBinding
  threadId: string
  sessionKey: `nomi:project-agent:${string}:g${number}`
}

type ProjectAgentContextRef = {
  binding: ProjectAgentContextBinding
  contextRevision: number
  recordId: string
}

type LegacyContextSourceRef = {
  legacyArea: 'creation' | 'generation'
  legacySessionKey: string
  legacyThreadId: string
  sourceHash: string
}
```

`sessionKey` 由 main 根据 immutableProjectUuid / projectGeneration 确定性派生并校验，renderer 和模型不能自报；同一 thread 跨创作、生成、预览始终使用同一 binding。pi snapshot 仍是 version-locked 私有工作缓存，只能挂在这份 binding 上，不成为项目正文或 Host 事实。

旧 `creation/generation` context 只能以 `LegacyContextSourceRef` 出现在迁移输入：codec、旧 sessionKey/threadId、source hash 和项目归属都验证通过时，staging 把 opaque snapshot 原子映射到新 project+thread record；迁移器不解码内容、不重放工具，也不继续写旧记录。不确定、并列或 snapshot 不兼容就建干净 context，并保留旧文字 archive。禁止继续把 area context 当活跃 fallback，也禁止只把旧文字 seed 进模型后宣称完整恢复。

## Skill 怎么接入

Skill 是方法论和缩权声明，不是许可证。最终可用能力必须满足：

```text
宿主允许
∩ 当前专业界面支持
∩ Skill 声明
∩ 当前 stage 声明
∩ 项目 / 任务政策允许
```

因此：

- Skill 只能减少能力，不能增加写入、预算、项目范围或 MCP 可见性。
- manifest 里未知 capability ID 直接拒绝，不靠提示词自觉。
- `skills.list` 和 `skills.read` 使用同一 visibility guard；列表隐藏后猜 URI / 名称也读不到。
- 用户导入 Skill 默认 internal；名字带 `director-` 不能自动变成外部可读。
- 先给模型 metadata，真正需要时再读正文，避免所有 Skill 常驻挤占上下文。
- `scripts/bin/hooks` 仍拒绝；Skill 不成为第二个执行 runtime。

多个已选 Skill 先对各自 manifest capability 求 union，再与 Host ceiling、冻结 surface support、stage 和 project/task policy 做 intersection。无 manifest 的 legacy Skill 是 prompt-only，权限集合不变；manifest 损坏或出现未知 capability ID 时激活失败，不能“正文照载、基础工具全开”。Turn 入队时冻结 capability IDs / versions / policy revision / port requirement；执行前的复验只能收窄或拒绝，不能因切页面扩大。

## ProductionRun 怎么接入

所有 Agent / MCP 发起的付费生成最终都必须引用 ProductionRun：

1. Host 根据用户目标创建或引用 Run。
2. Capability 解析并冻结 target / contract / revision。
3. Nomi 的 gate 和 receipt authority 取得真人授权。
4. ProductionRun 负责幂等提交、预算、provider job、恢复和 artifact。
5. Agent Item、TaskCenter、画布结果卡只投影同一 `runId / jobId / artifactId / resultId`。

内部 `run_generation_batch` 直接 `mintSpendGrant → renderer queue` 与旧 `nomi_generate` 都是待删除的过渡入口，不能被包装成“Registry 已统一”。迁移付费能力时必须同一提交切到 ProductionRun 并删除对应旧 owner，禁止双写验证。

## 旧数据迁移

1. 先把当前混存在 `conversations.json` 的 `committedProposal` 迁到 proposal / undo 领域的独立持久 owner；它的 compensation / watchNodes 不进入 Host snapshot，也不能因停止旧 writer 丢失。
2. 获取项目独占迁移锁，冻结旧 writer，读取旧 conversations / context 原始 bytes 并计算 hash。迁移期间任何旧 writer 竞争都必须失败，而不是覆盖 staging。
3. 新线程 ID 包含 `project + legacyArea + oldThreadId`，避免两区旧 ID 相撞；导入“源文件中仍存在的全部有效记录”，不承诺恢复旧文件本来没保存的附件、状态或审批，也不二次裁剪。
4. legacy thread 永久只读并标“旧创作 / 旧生成 · 文字记录”；点击继续是 fork 新统一线程并显示迁移边界，不修改 archive。
5. 只有精确 `sessionKey + threadId`、snapshot 校验通过、来源状态有效且唯一最新时才提升活动线程；并列或不确定就建干净项目主线程。
6. staging 分别写 Host、area-free `ProjectAgentContextBinding` 映射、proposal receipt，fsync 并校验；context 映射必须验证 project UUID/generation、thread、codec/snapshot 与 source hash，不能保留 creation/generation 活跃身份。最后只原子发布一份 cutover manifest。manifest 发布前旧 owner 仍是真相，发布后新 owner 才接管。
7. 不重放旧工具、不恢复旧审批、不把今天的画布冒充成当时快照；记录 migration version、source hashes 和完成凭据，重复启动不重复导入。
8. cutover 后停止旧格式写入，不做双写；旧文件保留只读。首次新 Host 写入前可撤销 manifest 直接回退；产生新 Host 数据后，降级必须先运行受测的离线 export/downgrade，不能声称纯 Git revert 无数据代价。

## 分阶段实施

### Phase 0：门岗（已完成）

- PR #204 已把语义词表的重复 owner 纳入每个 PR 的机器门岗。
- 这一层只防状态 / 词表重复，不能替代能力 owner 门岗。

### Phase 1：证明共享能力脊梁

- 先迁 `canvas.read`：零额度、只读、同时覆盖 Pi / MCP / renderer。
- **Slice A（合同 / 投影切换）：** 建 canonical input / result / effect / aliases 和安全 projector；Pi / MCP presentation 都从它派生。现役 MCP 的裸 projectId route 明确标为 `legacy_unverified`，该提交不把 generation 专用 lease 冒充通用 authority。它删除 Pi schema literal、MCP JSON schema literal、read-only 手写项和重复结果投影；renderer/main 的环境 adapter 仍明确存在，不宣称执行器合一。
- **Slice B（authority / 执行切换）：** 先把 project-session 从 generation rollout 抽成通用 authority，补齐 connection binding 与当前 UUID/generation/root 复验；再建立 `VerifiedCapabilityInvocation`、main-issued `SurfacePortBinding` 和 main-only executor。Pi / MCP / local RPC 全部切到同一执行器，并在同一提交删除 renderer read executor、legacy `canvas.read` switch 和最后的 executor debt。Slice A 合入后立即推进 Slice B，不把兼容接缝留成长期架构。
- 新增 `check:capability-owners`，人工放入第二份 schema / executor / alias 时必须红。
- 从第一项能力开始就执行 Skill shrink-only：旧 Skill 声明尚未完成迁移时也不能扩大宿主能力；未知 capability fail closed。Phase 5 只负责把全部旧 manifest / list / read 入口迁完，不把安全不变量推迟到 Phase 5 才生效。

此阶段用户界面不变。它的价值是证明以后每迁一个能力，都能真的删掉旧 owner，而不是又包一层。

### Phase 2：ProjectAgentHost

- **2A foundation：** 建项目级 Thread / Turn / Item / queue / proposal-ref owner 与命令 CAS / 原子持久化；只用 fixture / 离线 store 验证，不注册生产 IPC、不写真实项目。
- **2B product cutover：** 一个不可拆的发布边界内完成迁移、把两个旧面板的所有读写切到 Host，并删除 / 禁用两套 area message / turn / pending approval writer。旧外壳此时必须已经能渲染共享消息、queue 编辑 / 取消、审批、停止、TaskRef、冲突、附件和历史；不能把关键行为等 Phase 6 新 UI 才补。
- 已迁能力经 Registry；尚未迁的写能力只能调用其现有唯一 executor 的受控兼容 adapter，不复制 schema / policy / 状态，也不双写。
- 所有现有工具 adapter 未齐之前，Host 不接生产入口；compatibility adapter 不得读写旧会话 / turn / approval 状态，不留 feature-flag fallback。

### Phase 3：只读与可撤写入

- 迁剩余 read 能力，再迁画布 / 文稿可撤写入。
- Registry 调用现有 proposal transaction、Undo、reconcile；不重写这些领域服务。
- 删除 `TOOL_META`、MCP handler switch、Pi descriptor 中已经迁走的能力定义。

### Phase 4：破坏性能力与付费入口迁入既有 ProductionRun

- 精确 target / revision / action hash 后才允许 destructive proposal。
- 付费动作统一到 ProductionRun + human receipt；删除 Agent direct queue 和 legacy generation path。
- 按 PR #202 的真实 MCP 旅程补 typed cancel、reference role、输出契约、ETA、可审阅产物和 export truth 验收。

### 并行完整性轨：不能被 Host 掩盖的现役问题

PR #202 的 P0 导出 manifest 失真、持久导出身份和 build/catalog 留痕不属于 Host owner，却会直接破坏任务 / 产物真相。它们作为独立领域切片推进，最迟在 Phase 4 付费链验收前关闭；禁止为了“统一 Agent”把这些状态复制到 Host。

### Phase 5：Skill / MCP 投影

- 统一 Skill progressive disclosure、audience、list/read guard 和 shrink-only 计算。
- Pi / MCP 工具列表从 Registry 派生；外部 transport 仍保留 lease、elicitation、receipt 等额外安全层，且不经过 / 污染 ProjectAgentHost 的聊天历史。
- 删除按名字前缀猜可见性、提示词约束工具和旧 legacy route。

### Phase 6：新常驻界面

- 在 Phase 2B 已验证的共享行为组件上设计常驻位置、布局、视觉密度、Skill / context 呈现；不再引入新的状态语义。
- 常驻位置与真实布局先出样张、用户拍板，再替换两个旧面板。
- 画布卡栈、折叠组、React Flow 都只是 SurfaceAdapter；换 renderer 不改变 Agent Host。
- 真机完成创作 → 生成 → 预览、重启、跨项目、冲突和 MCP 私有性旅程后，删除旧面板。

## 对近期分支 / PR 的吸收决定

| 分支 / PR | 吸收什么 | 为什么 | 不吸收什么 |
|---|---|---|---|
| #181 pi runtime | 固定版 AgentSession、上下文快照、附件、取消和工具回喂边界 | 已合入并通过运行链验收，是 Host 的推理内核 | 不把 pi snapshot 当项目事实，不把 SDK 工具发现当 Nomi 权限 |
| #194 Agent 交互设计 | 稳定 Item、原位状态、busy queue、Skill / context / approval 呈现 | 直接解决“发没发出、做到哪、为何停”的用户摩擦 | UI 放最后，不用设计图反推数据 owner |
| #195 Skill / tool surface | audience、progressive disclosure、list/read 同守卫、Skill 只缩权、统一工具面意图 | 找到了 MCP / Skill 重复定义的根因 | 分支与 main 冲突且部分数量 / 路径已过时，不整包 cherry-pick；在 Registry 上重做 |
| #196 React Flow 试验 | renderer 只应是画布投影的原则 | 证明换画布库不能绑 Agent 业务 | PR 已关闭且两次质量门失败，不引入双 renderer / fallback |
| #197 v0.21.0 | ProductionRun、预算、受控采纳、MCP sender / owner / cancel 合同 | 是正在服务用户的生产真相，必须被 Host 引用而非重写 | 不把 TaskCenter 提升成账本 |
| Issue #198 / PR #199 / #201 | resultId、卡栈、group、duplicate-as-variant、当前结果不重排历史 | 让 Agent 能准确指向“第二版 / 这个组”，也保证 UI 可替换 | #199 已撤，#201 是独立交互 PR；不与 Host 分支混合代码，不把 card stack 变成新历史 owner |
| #202 MCP 真实旅程复盘 | legacy 路径误选、取消原因、审批身份、参考角色、ETA、可审阅产物、导出真相等验收缺口 | 这些是统一付费能力是否真的好用的用户证据 | 不把全部问题塞进首个只读切片 |
| #203 React Flow 迁移 | 再次确认 domain / store / persistence 应独立于 renderer | Host 和 Registry 必须无 React Flow 依赖 | 当前 Quality Gate 失败，不吸收实现 |
| #204 单源门岗 | 语义 owner AST 检查、历史棘轮、R14.1 审计 | 先让重复定义在 PR 上可见 | 它不识别“不同名字同一工具”，所以仍需 capability owner gate |

## 不变量和机器门岗

`check:capability-owners` 至少保证：

- 每个 canonical capability ID 只有一个 schema、effect、policy、approval 和 executor owner。
- 每个执行器只接受 `VerifiedCapabilityInvocation`；MCP 必须验证 lease/scope，renderer 必须验证 sender 与 `SurfacePortBinding`，后台 caller 必须有显式 principal/policy。
- Pi / MCP / UI alias 全局唯一，且都指向已登记 ID。
- projection 只能从 Registry 派生，不能自带第二份 input / effect / handler。
- `effect: read` 只能绑定 read-only port，随后才自动生成 MCP `readOnlyHint`；paid 必须声明 `ProductionRun + human_receipt`。
- Skill 中的 capability ID 必须存在，最终集合必须是宿主集合的子集。
- 已迁能力不得重新出现在 `MCP_TOOL_CATALOG` literal、Pi descriptor literal、`TOOL_META` 或 tool-name execute switch 的非允许位置。
- legacy debt 只减不增，不能换名字维持数量。

机器不能证明任意两段不同代码一定同义，因此 R14.1 人工 owner 审计和跨投影等价测试继续保留。

## PR #202 十三项问题去向

| ID | 归属 / 阶段 | 验收出口 |
|---|---|---|
| MCP-J01 | Phase 4，Capability Registry + ProductionRun | 多镜意图只选择 semantic operation；legacy canvas/generate 不能承接 semantic binding，也不再因说明更显眼被模型优先选中 |
| MCP-J02 | Phase 3，canvas proposal result | decline、timeout、宿主不支持、窗口关闭和 transport cancel 返回 typed reason + next action，不再只有 `cancelled:true` |
| MCP-J03 | Phase 2B/5，main approval authority + 共享行为组件/MCP adapter | 同一 handoff/challenge 可在当前支持的表面确认；回 Nomi 时有稳定待办身份，Host 不复制 authority |
| MCP-J04 | Phase 4，receipt challenge projection | 确认卡展示实际图片/视频、reference role、模型、价格、冻结参数；批准 hash 与提交一致 |
| MCP-J05 | Phase 3，model/canvas domain preconditions | 换模型前显示保留、删除和改默认的参数 diff；任何变更使旧批准失效 |
| MCP-J06 | Phase 4，ProductionRun/provider telemetry | 无可靠样本就显示“时间未知”；有样本才显示来源明确的区间，不再固定 40 秒 |
| MCP-J07 | Phase 4，ProductionRun TaskRef | 提交后立即返回稳定 run/job identity；轮询与聊天 turn 解耦，跨端只读同一 Run |
| MCP-J08 | Phase 5，MCP artifact projection/widget | 视频成功结果提供可审片 poster/player；MP4 不再塞进 `<img>`，缺 poster 时给明确可行动入口 |
| MCP-J09 | 独立 playback diagnostics 领域，不属于 Host | 保存 readyState/networkState、协议响应和 materialization 时点，复现前不武断改播放器 |
| MCP-J10 | Phase 6 后续 timeline/title capability，不属于 Host 状态 | 章节卡成为可精确指向、可撤的时间轴语义对象；未批准交互前不在 Host 中造 title 状态 |
| MCP-J11 | 并行完整性轨 P0，export job owner | 持久 manifest 与实际 prepared ffmpeg 输入、音频、overlay 字节级对账；重启后可复演 |
| MCP-J12 | 并行完整性轨，export artifact owner；Phase 6 投影 | 每次导出有项目内稳定 artifact/version/build identity，可比较、打开和设为当前；toast 只是提示 |
| MCP-J13 | 并行完整性轨，project/job provenance owner | 项目事件与 job 记录 app/build SHA、packaged/dev、Electron、MCP contract 和 catalog snapshot identity |

J09/J10 明确不由 ProjectAgentHost 修；但它们仍在总项目验收清单中，只有各自 owner 的证据关闭后才从 backlog 消失。

## 验收旅程

### 结构验收

- 同一能力经 Pi / MCP / UI adapter 得到同一 canonical invocation、target hash 和领域结果。
- 同 projectId 但 UUID/generation 不同的 Host patch、snapshot、pi context 或 Surface reply 全部拒绝；跨三个页面仍使用同一 area-free project/thread context binding。
- MCP 伪造 projectId、scope、UUID/generation、root/manifest digest 或 revocation epoch 全部 fail closed；renderer generation bump、项目复制、窗口重建和旧窗口迟到 reply 全部拒绝。
- 注入第二份 schema / executor / alias，门岗真实变红。
- 把 read capability 绑定 write/paid port 时类型或 owner gate 必须红。
- Skill 任意组合都不能扩大 capability set。
- Host snapshot 中不能嵌入 document / canvas / ProductionRun 实体，只能存 ref。
- 两窗口并发发送、queue edit/cancel、Stop 早于 cancel handle、重复 tool result/approval 和重启 replay 均 exactly-once。

### 用户旅程

- 创作页发送，执行中切生成、再切预览：同一 thread / turn / item，只执行一次。
- 忙时连发两条：第二条可见、可编辑 / 取消，随后执行一次。
- 旧项目 30 条创作 + 30 条生成历史升级两次：源文件中仍存在的有效文字全部保留、不重复、不伪造合并上下文；不可恢复字段诚实标注。
- 迁移在旧 writer、Host/context/proposal staging、manifest 发布各点强退后可重试；`committedProposal` 仍能整笔撤销。新 Host 产生消息后的离线 downgrade 不丢新消息。
- 对话执行、待审批、媒体生成三个阶段分别强退重启：显示诚实状态，不重复工具或付费提交。
- A 项目运行时切 B：A 的迟到结果只能回 A；B 不出现气泡、节点或审批污染。
- Agent 提案后手改同一文稿 / 节点 / result / 时间轴：旧 target 被 revision / hash 拦下。
- 入队后只移动文稿选区 / 光标且正文未变：旧 replace / insert 写入发送时冻结的位置；修改正文使 revision / frozen anchor 校验失效时才冲突或显式按最新版重做，任何情况下都不得写到执行时“当前”选区。
- internal Skill 猜名字、URI、resources/read、prompts/get 均读不到；公开 Skill 的 list/read 对称。
- ProductionRun、Agent Item、TaskCenter 和画布卡指向同一 run / artifact / result 身份。

## 回滚边界

- 每个能力按 owner 层分成连续切片：合同 / projector 切片合入时删对应旧定义，执行切片合入时删所有旧 executor。任何一层都不能一边新增 canonical owner、一边保留同层 fallback；回滚靠 Git revert。
- 只读能力先行，失败不会改变用户项目。
- Host 迁移前保留旧文件原件和 hash；cutover manifest 原子发布，失败不切换 owner。首次新 Host 写入后，代码降级前必须运行受测的离线 export/downgrade。
- 不转换 canvas、document、ProductionRun 的持久化格式，因此 Host / UI 代码回滚不需要回写业务数据。
- 付费能力不做 shadow submit；只用 fixture replay 和本机受控 provider 验证。

## 当前决策

方向已经由用户确认，不再等待新的产品选择。下一步按 `canvas.read` 文件级计划先做 Slice A 的 RED 测试，双审通过后才写生产代码；Slice A 合入后紧接 Slice B。两支都不改界面、不花额度、不迁用户数据，也不宣称项目级 Host 已完成。
