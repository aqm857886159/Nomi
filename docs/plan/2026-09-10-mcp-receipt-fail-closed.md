# 2026-09-10 · 付费门人证 fail-closed + 输出铁律与运行时对齐

状态：已实施（分支 `fix/mcp-receipt-fail-closed-20260910`）

## 背景：两件事，同一个毛病——「说的」和「真跑的」对不上

**A（安全）** 制作 Run 的付费门（合同预算门 / 逐镜提交门）在命令边界上本来有一道收据校验，
但**没有任何生产装配注入过收据权威**：`createProductionRunService` 的
`approvalReceiptAuthority` 一直是空的，校验函数在权威缺席时返回 `undefined`，服务就原样放行。
即「门有锁孔，但从没装过锁芯」。同一时期还有第二个洞：`set_trust=budget_only` 这个**只能由
客户端工具调用发起**的降档动作，会顺手自动批准正在等待的逐镜门——而逐镜门批准的下一步就是
真实供应商调用。合起来：一次工具调用可以替用户批掉一次扣费。

**B（诚实）** 系统提示词的「输出铁律」写着「所有写入/生成都要等用户在卡片上确认后才生效」，
而 safe-auto 档下建草稿是 `reversible_local`、自动放行、面板上根本没有卡。模型照着这句话
把「建了草稿」讲成「已提交生成，你可以在右侧预览区看结果」，还让用户去找一张不存在的候选卡。

## 先查别人

完整报告：[docs/research/2026-09-10-mcp-receipt-fail-closed/prior-art.md](../research/2026-09-10-mcp-receipt-fail-closed/prior-art.md)

- **仓库里已有（决定性）** `electron/capabilityCore/approvalReceipt.ts:255` —— 单发路径的完整收据链已经在跑：HMAC-SHA256 签名 `approvalReceipt.ts:215`、TTL 到期 `approvalReceipt.ts:246`、一次性消费 `approvalReceipt.ts:537`，两种人证来源已建模（主进程手势 `approvalReceipt.ts:389`、MCP 客户端 elicitation `approvalReceipt.ts:419`）。缺的是装配，不是机制。
- **装配姿势的参照** `electron/capabilityCore/generationTransportAdapters.ts:216` —— 单发路径把「缺收据权威 = 整条能力不可用」写成硬前置；收据 → `gate.decide` 的落库形状见 `electron/capabilityCore/runOwnedGenerationGateAuthority.ts:139`，批量侧不需要发明新字段。
- **依赖里已有？没有** —— 依赖里没有「主进程签发、跨进程可验、一次性消费的人类审批凭证」；最接近的 `electron/ipcSenderGuard.ts:1` 只答「来自不来自我们的窗口」，不答「批了什么门、多少钱、用过没有」。但这不构成自研理由，因为②已经有一份。
- **生态里已有（规范）** MCP Elicitation 只定义「怎么问」、不提供「问过了」的可验证凭据，且要求客户端不得代替用户自动应答：<https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation> —— 所以 accept 必须在我们这侧转成主进程签的证明，正是 `createClientElicitationAttestation` 在做的事。
- **生态里已有（安全基线）** MCP 安全最佳实践要求不得把客户端自述的身份/同意当授权依据：<https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices> —— 对应 `electron/capabilityCore/mcpProtocol.ts:430` 已有的「clientInfo 只当审计标签」。
- **生态里已有（同类产品的裁决）** Claude Code 的权限模型公开列出「没有哪个模式会自动放行的动作清单」：<https://docs.claude.com/en/docs/claude-code/iam> —— 直接对上本次第二个洞：降档（`set_trust=budget_only`）不得带来自动放行。
- **TikHub 自媒体** —— 本轮**没查成**（未起调研 agent），如实记录，不假装查过；本题判据来自规范与仓库现状，不受影响。
- **结论：用已有的** —— 复用 `electron/capabilityCore/approvalReceipt.ts:255` 那份收据链并把它装配到制作 Run 服务上，不新建密钥、状态文件或协议；唯一新增概念 `humanGesture` 只是把 `assertTrustedSender` 这个既有事实显式化，不是第二种凭据。

## 改动范围

| 层 | 文件 | 做了什么 |
|---|---|---|
| 语义 owner | `electron/productionRun/productionRunGateIdentity.ts` | 新增 `isSpendGate`：「批准它会不会花钱」的唯一定义，按 scope 判（`budget_envelope` / `job_set`） |
| 命令边界 | `electron/productionRun/productionRunApprovalReceipt.ts` | 两个自由函数 → `createGateApprovalOwner` 持有者；付费门批准必须随附人证（验过的收据 或 受信窗口手势），缺权威**拒绝**而非跳过；免费门与否决语义不变 |
| 装配 | `electron/productionRun/productionRunService.ts` | 构造期消掉「没有人证持有者」这个空状态；`autoApproveGate` 拒绝付费门；`set_trust=budget_only` 不再把逐镜门算进自动批准范围 |
| 装配 | `electron/productionRun/productionRunRuntime.ts` | 生产单例注入收据权威 + 项目版本解析器（所有入口共用这一个 service 实例） |
| 真相源 | `electron/capabilityCore/approvalReceiptRuntime.ts`（新） | 进程内唯一的收据权威 + 项目版本解析器；`appIntegrationAuthorities.ts` 改为从它取，不再各造一份 |
| 通道 | `electron/productionRun/productionRunTypes.ts` / `productionRunIpc.ts` | `RunCommand.humanGesture`：由 IPC 层在 `assertTrustedSender` 之后**自己盖**，只盖在 `gate.decide` 上，不从 payload 抄 |
| 提示词 | `electron/harness/context/agentContext.ts` | 输出铁律改成如实：不花钱的本地改动立刻生效；付费生成才等确认卡；建好草稿不许说「已提交/去预览区看」；替用户选的模型要明说 |

## 不动项

- 免费门（方向/样片/冻结创意门、锚定妆照检查点、导出/发布门）的决议语义一字不改，MCP 客户端经
  elicitation 表态的既有路径照常。
- 三处调用方各自的「只准决定可逆创意门」白名单（`mcpProtocol.ts` / `productionRunTransportAdapters.ts` /
  `dispatcher.ts`）保留为纵深防御，不在本次收敛（收敛它会**放宽**远端能碰的门，方向相反）。
- `task/ux-feedback-20260910` 上的语言规则改动不在本分支，未重造。
- 单发/语义生成路径的收据流程不改。

## 回滚

单 commit 回滚即可；无数据迁移、无持久化格式变更（`humanGesture` 不进事件，事件只记 commandId/type）。

## 验收门

- `electron/productionRun/productionRunApprovalReceipt.test.ts`：缺权威时付费门被拒 / 免费门与否决仍免收据 / 受信手势放行。
- `electron/productionRun/productionRunService.test.ts`：注入权威后，无收据被拒、带有效收据照常通过并被一次性消费。
- `electron/productionRun/productionTrustLevel.test.ts`：卡在逐镜付费门时降 `budget_only`，门必须原样等着（已做变异测试证明改前为红）。
- `electron/productionRun/productionRunIpc.test.ts`：手势章是这一层自己盖的，不从渲染层 payload 抄。
- `electron/ai/composeAgentSystemPrompt.test.ts`：旧的自相矛盾那句不许回来。
- `pnpm run gates` 全绿。

## 残留风险

`humanGesture` 目前只证明「来自受信窗口」，不是一条带签名的手势证明。把它升级成
`createMainProcessGestureAttestation` 需要批量确认卡先领 challenge（renderer + IPC + service 三层联动），
不在本次范围内；在此之前，渲染进程被攻破仍等于拿到批量付费门的批准能力——与本次修复前的状况相同，
没有变差，但也没有变好。
