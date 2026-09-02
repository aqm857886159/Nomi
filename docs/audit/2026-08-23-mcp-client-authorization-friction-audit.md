# MCP 客户端授权体验聚焦审计（2026-08-23）

> 范围：只审与“外部 AI 软件调用 Nomi”有关的确认、连接、项目选择、重复授权和错误下一步；不是全 App 重跑。目标是把用户从“想生成一镜”到“继续等待结果”的可见动作降到最少，同时不削弱 P0 的项目隔离、真人审批、一次提交和恢复约束。
>
> 结论：采用“客户端优先、Nomi 兜底、一次组合确认”。本报告是诊断快照；活状态写入 [`docs/audit/redundancy-backlog.md`](redundancy-backlog.md)，实施入口仍是两份 2026-08-22 canonical plan。

## 用户任务和动作预算

目标用户任务：已在 Claude Code / Codex / Cursor 中工作，想让 Nomi 当前项目生成一镜。

理想可见动作：

```text
接入（一次，通常只做一次）
→ 在客户端看到同一份项目/模型/成本确认（一次点击）
→ 等待、查看进度、断线恢复（零额外授权点击）
```

若客户端无法提供可验证的人类响应：

```text
客户端提示“在 Nomi 确认”
→ Nomi 同一 challenge 点击一次
→ 回到原请求继续
```

禁止出现：客户端点一次 + Nomi 再点一次；要求用户粘贴 projectId/handle/hash；把协议错误码当作用户操作指南。

## 发现清单

| 编号 | 模式 | 证据 | 评级 | 决定 |
|---|---|---|---|---|
| F1 | 同一意图存在两次确认的风险 | `electron/capabilityCore/mcpProtocol.ts:186-210,458-480` 的 elicitation 仍把结果作为裸 `spendConfirmed` 透传；canonical gate 另有 GUI/receipt | B 产品取舍 | 客户端 attestation 成功时一次 accept 直接铸 receipt；无 attestation 才跳 Nomi，一次完成 |
| F2 | 连接与项目/花费授权的心智可能重叠 | `src/ui/onboarding/ConnectAssistantCard.tsx` 负责配置写入与握手，不应承担每次生成 gate | B/C | 卡片保留“接入/状态/撤销”；连接后只读 lease 可静默复用，生成授权单独且只问一次 |
| F3 | `session/open` 的 opaque handle 对 host 不可发现 | canonical plan 仅接受 `ProjectSelectionHandleV1`，而 host 没有自然 bootstrap 面 | B | 增加 main-process/server-owned bootstrap seam；用当前活动项目解析，不接受 host `projectId/path` |
| F4 | 重连/轮询可能被误当成新的授权 | `electron/capabilityCore/mcpSpendTrust.ts` 是进程内 map；若与新 lease 逐调用使用，会重复打断 | B | lease 按 session 复用；同合同读/轮询/取消/reconcile 不重问；过期/撤销才重问 |
| F5 | “不支持 elicitation”容易变成死路 | `mcpProtocol.ts:461-480` 已有 supported 分支，但旧 fallback 语义不够明确 | A/B | 返回 `human_approval_required` + 可点击 `open_in_nomi` handoff，不让用户找设置或读文档 |
| F6 | 机器错误字段和用户下一步没有分层 | `mcpRpcError.ts`/`mcpToolResults.ts` 已保留 typed error；仍需统一用户可执行的 nextAction 语义 | A | 机器保留 code/phase/capability；用户只看“在客户端确认 / 在 Nomi 确认 / 重新选择项目 / 等待对账” |
| F7 | 新工具与 legacy confirmation 术语可能混淆 | `mcpProtocol.ts:30-33` 同时存在 `spendConfirmed` 与 `planConfirmed` | A | 新 semantic route 只讲“允许本次生成”；legacy 保持兼容但不复用为新 gate authority |
| F8 | 项目切换后的安全提示可能过度解释 | 方案有 UUID、generation、revision、hash 等内部绑定 | A | 用户文案只说“当前项目已变化，请重新确认”；细节进审计日志，不进入操作主路径 |

## 取舍判断

| 方案 | 用户看到什么 | 安全/实现代价 | 结论 |
|---|---|---|---|
| A：每次都回 Nomi 点确认 | 最明确，但来回切窗口 | 低信任复杂度、高操作摩擦 | 仅作无 attestation 兜底 |
| B：客户端一次确认，主进程验证后直接继续 | 用户留在当前软件，一次点击 | 需要客户端登记、通道证明和 challenge 绑定 | **采用** |
| C：客户端 `confirm:true` 直接放行 | 最省事 | 可伪造、无法证明真人或项目范围 | 禁止 |
| D：连接后永久信任 | 几乎零摩擦 | 项目切换/账号/成本边界失控 | 禁止；只做有期限、可撤销、按 scope 的 lease |

## 验收不变量

- 首次生成最多一个可见确认；客户端成功后不出现 Nomi 第二个确认；
- 客户端无 attestation 时最多一个 Nomi 确认，不要求客户端再确认；
- 只读上下文、同一合同的进度/取消/reconcile 不新增确认；
- 项目 UUID/generation、scope、价格或合同变化时恰好新增一次确认；
- 确认前 provider/spend/materialization 计数均为 0；
- `submission_unknown` 只给 reconcile action，绝不出现“再试一次生成”的默认按钮；
- 用户操作文案不出现 lease、receipt、hash、nonce、providerTaskId 等内部术语；
- 真实 host 旅程记录“从输入意图到继续等待”的可见点击数和截图，而非只测 RPC 返回值。

## Backlog 归档

本轮不扩张为全 App 审计。与本链路直接相关的条目进入 backlog：B8（一次确认与授权心智收敛），C5（连接/授权/错误文案分层）。B8 先于 P3 provider 接入，C5 与同一批实现一起收口。

## 实施与体验证据（2026-08-23）

本轮在隔离 worktree、零真实额度下完成了以下验证：

- `mcpGenerationConfirmation`、dispatcher、lease、receipt、RPC/MCP outcome、renderer gate 等聚焦套件：107 tests passed；同一 challenge 重放只复用原结果，不重复弹窗。
- `pnpm run test:mcp-journey`：45 assertions passed；真实 stdio、mock vendor、一次确认后的会话复用均通过，mock vendor requests 6 次，真实 provider quota 为 0。
- `node tests/ux/production-mcp-journey.e2e.mjs`：55 assertions passed；GUI 任务中心、等待确认、重启恢复、reconcile-only 和最终产物路径通过，fixture actual/unsettled spend 保持 0。
- `node tests/ux/spend-elicit-app-open.walk.mjs`：22 assertions passed；不支持 elicitation 的客户端只在 Nomi 点一次，支持 elicitation 的客户端只在调用方确认一次，期间没有第二张 Nomi 卡。

关键截图已由同构建实机走查并人工检查：

- `tests/ux/shots/spend-elicit-app-open/02-fallback-card-shown.png`：Nomi 兜底卡只呈现项目、节点、模型和产物，动作是“确认生成”。
- `tests/ux/shots/spend-elicit-app-open/03-during-elicit-no-card.png`：调用方确认等待期间，Nomi 不再叠第二张卡。
- `tests/ux/shots/production-mcp/02a-shot-1-gate.png`、`03b-shot-2-gate.png`：任务中心就地显示“提交前等你确认”，用户无需理解 lease/receipt/hash。

安全修正也一并固化：标准 MCP `confirm:true` 没有 challenge-bound attestation 时不会直接铸 receipt，而是沿同一个 challenge 走 GUI；因此当前真实客户端若只有标准 elicitation，会多一次“切到 Nomi”的动作，但不会出现双重确认或裸 boolean 放行。
