# MCP 客户端优先授权与一次确认设计

> 状态：用户已确认方向；P0 授权/体验 seam 已实现并完成零额度回归。真实 provider 接入与客户端 attestation 扩展仍是下一决策点。本文是 `2026-08-22-nomi-unified-editor-runtime.md` 与 `2026-08-22-mcp-ai-generation-vertical-slice.md` 的用户体验补充，不建立第二套运行时方案。
>
> 目标：在不降低项目隔离、真人审批、一次提交和崩溃恢复约束的前提下，把用户需要做的确认收敛为一次，并放在用户正在使用的 Claude Code / Codex / Cursor 等客户端里；客户端做不到时，才由 Nomi GUI 兜底。

## 1. 从用户摩擦出发

用户真正想做的是“让当前 AI 助手用 Nomi 当前项目完成一次生成”，不是学习 Nomi 的授权术语，也不是在两个软件之间来回点击。

当前方案存在五个相邻摩擦点：

| 摩擦 | 现状证据 | 用户后果 | 本设计的处理 |
|---|---|---|---|
| 连接、项目授权、生成审批混在一起 | `src/ui/onboarding/ConnectAssistantCard.tsx` 只负责写 MCP 配置；计划又要求 `session/open` 先拿 handle、随后再走 gate | 用户以为“已经接入”却还要再授权，或者连续点两次 | 连接只建立客户端身份；只读上下文复用当前项目；第一次生成把项目范围和生成审批合成一次确认 |
| 客户端确认后再回 Nomi 点一次 | `electron/capabilityCore/mcpProtocol.ts` 已有 elicitation，但旧链路传递裸 `spendConfirmed` | 同一件事被问两遍，信任感下降 | attested client 的一次 accept 由主进程直接铸 receipt；没有 attestation 才跳 Nomi，一次完成，不二次确认 |
| `session/open` 需要 host 先拿 opaque handle | 当前 canonical plan 只接受 `ProjectSelectionHandleV1`，host 没有自然的 bootstrap 入口 | 用户卡在“handle 从哪来” | 保留已签发 handle；新增 server-owned bootstrap seam，由连接身份解析当前项目，不接受 host 自报 `projectId/path` |
| 每个读取/轮询/恢复都可能重新问 | 现有 `mcpSpendTrust` 是进程内重复确认/信任地图；新 lease 也可能被误用成每步门 | 长任务变成确认马拉松 | lease 按 MCP session 复用；同一 sealed contract 的轮询、取消、重连、reconcile 不重新确认 |
| 出错时让用户看协议错误码 | RPC/MCP 已有 typed fields，但用户真正需要的是下一步 | “human_approval_required” 对用户没有行动指引 | 统一 `nextAction`：在客户端确认、打开 Nomi、重试当前预览、或等待对账；协议字段仍保留给机器 |

这些优化不改变安全事实：客户端的 `accept`、`confirm:true`、`spendConfirmed`、bearer token 或 `projectId` 都不是凭证。它们只能触发主进程去验证一个已登记的客户端通道和当前 challenge。

## 2. 选择的用户流程

### 2.1 连接时不再增加一层授权

用户在 Nomi 设置里点击现有的“接入 AI 编程助手”后，Nomi 写入配置、完成握手并登记该客户端通道。这里不再增加“授权当前项目”第二个按钮；连接本身只表达“允许这个软件连接 Nomi”，不表达花费权限。

连接成功后，客户端可以获得当前活动项目的只读上下文租约：

```text
连接 MCP（用户已有的一次动作）
→ 主进程验证已登记客户端 + 当前活动项目
→ 静默签发 session lease(scope: read/context)
→ 助手可以读项目上下文、提出计划、展示预览
```

如果没有稳定的活动项目，或者项目已被删除、重建、改代际，不能猜路径或回退到 body `projectId`；返回可行动的 `open_in_nomi/select_project`。

### 2.2 第一次生成只问一次

当计划已经形成、主进程能重新计算模型和成本时，生成 gate 变成一次组合确认：

```text
助手里的一个确认框：
“允许 Nomi 在项目《短片 A》中，使用模型 X，最多花费 ¥Y，生成这一镜吗？”
                         ↓ 一次点击
主进程验证客户端通道 + challenge + 项目代际 + 当前价格
→ 原子升级 lease(scope: generation_submit)
→ 铸造并消费 HumanApprovalReceipt
→ 写入 Run intent / reservation / envelope
→ 只提交一次
```

该确认框只展示用户能做决定的信息：项目名、镜头摘要、模型、参考图数量、估算成本、有效期。内部 hash、nonce、provider/account namespace 仍签名保存但不要求用户阅读。

如果客户端支持 MCP elicitation 且已经是已登记/可验证的客户端，确认就在客户端发生。MCP 规范并不规定具体 UI，因此 Nomi 只依赖客户端声明能力和主进程验证的通道，不假定某一个软件的按钮样式。[MCP Elicitation 规范](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation)

如果客户端不能完成可验证的真人响应，主进程返回 `human_approval_required` 和 project-scoped handoff/deep link，Nomi GUI 显示同一份确认内容。GUI 点击后直接生成 receipt，客户端只继续原请求；不再让用户在 GUI 点完又回客户端确认第二次。

### 2.3 后续只在“实质变化”时再问

同一项目、同一 MCP session、同一 sealed contract 和同一 cost scope 内：

- 读取上下文、查看预览、查看进度、取消、重连、reconcile：不再确认；
- provider 已接受但丢失 task ID：只允许 reconcile，不重新提交；
- 同一 command/idempotency key 重放：返回原 receipt/receipt result，不新增点击；
- 新项目/新项目代际、lease 过期或撤销、scope 扩大、模型/账户/价格/成本上限变化、新的 generation contract：重新确认一次；
- `artifact_adopt`、导出发布等后置高影响动作：使用各自的后置 gate，不偷借 generation receipt。

## 3. 信任边界与兼容策略

### 3.1 主进程仍是唯一 authority

主进程负责：

1. 从已登记客户端通道解析当前项目，不能接受 host 自报项目路径或任意 `projectId`；
2. 生成并持久化 challenge，重新计算合同、价格和 scope；
3. 验证客户端 attestation 或 Nomi GUI 的 main-process gesture；
4. 原子签发/消费 lease 和 receipt，并把消费记录交给 ProductionRun/WAL；
5. 将 challenge/receipt 与项目 UUID、代际、revision、contractHash、costScope 和 fencing epoch 绑定。

客户端和 GUI 都只是同一 challenge 的展示/回答面，不是状态 owner，也不能制造 receipt、grant、providerTaskId 或 assetId。

### 3.2 客户端能力分层

| 客户端状态 | 用户看到的动作 | Nomi 行为 |
|---|---|---|
| 已登记 + 支持 elicitation + 可验证真人响应 | 客户端内一次确认 | 主进程直接铸 receipt；不打开 Nomi |
| 已登记但只能传输 elicitation，不能证明通道/真人 | 客户端收到清晰提示，点击“在 Nomi 确认” | 打开 Nomi 同一 challenge；一次 GUI 点击后继续 |
| 未接入/客户端不可用 | Nomi 设置里的接入提示 | 先完成连接；不进入生成，不要求用户填配置 |
| 项目失效/代际变化/权限不足 | “选择项目/重新授权” | 只给一个明确下一步；不让用户猜错误码 |

旧 `nomi_generate` 和旧 `spendConfirmed` 兼容行为在迁移完成前保留，但不得把它们描述为新 semantic generation 的安全凭证。新工具只接受主进程签发的 typed receipt/lease。

## 4. 方案不变量（用户简单，后台严格）

- 同一个用户意图最多一个可见确认；同一 challenge 重试不新增确认；
- 确认前 provider/spend/materialization 均为 0；
- 一次确认最多产生一个 sealed contract、一个 reservation、一个 provider idempotency key；
- `submission_unknown` 永远是 reconcile-only，不盲目重提；
- 不因客户端不支持 elicitation 而报“请看文档”，而是给可点击的 Nomi handoff；
- 不因安全校验而让用户输入 handle、路径、projectId、hash 或成本数字；
- 用户确认文本来自主进程重新解析的当前状态，host 提供的摘要只能作为不可信候选；
- 连接、授权、生成审批的文案各自只有一个心智：连接软件、允许本次生成、查看/撤销授权。

## 5. 交付顺序

1. **方案先行**：本设计、聚焦 UX 审计、两份 canonical plan 和 backlog 同步；没有第二套路线。
2. **P0 seam**：实现 bootstrap resolver/client registry；只读 lease 静默建立；组合 challenge 原子升级 generation scope + receipt；GUI/client 两条回答面共用一个 challenge。
3. **零额度验证**：fake client/fake provider 验证一次确认、无二次确认、重连复用、项目变化再问、unknown 只对账。
4. **真实 host 走查**：至少覆盖已登记客户端、只支持 elicitation 的客户端、无 elicitation 的客户端；记录截图和用户动作数。
5. **再进入 provider/P3**：所有 UX 不变量和安全对抗证据通过后，才接真实 adapter/付费路径。

## 6. 用户验收问题

真实用户只需要回答：

1. “我在 Claude/Codex/Cursor 里点一次确认后，是否能继续，不需要再回 Nomi 点第二次？”
2. “客户端不支持时，Nomi 是否自动给我一个明确的确认入口，而不是让我自己找设置？”
3. “我是否不用理解 lease、receipt、handle、contractHash 这些词？”
4. “同一任务重连或查看进度时，是否没有被反复打断？”

只要答案有一项是否定，优先改体验入口或下一步提示，不通过增加说明文字来掩盖流程复杂度。
