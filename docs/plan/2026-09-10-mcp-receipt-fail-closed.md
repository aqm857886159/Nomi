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

---

## 09-10 21:00 放宽：确认全在客户端，Nomi 不再要求「回来点」

**用户原话的意思**：外部 MCP 客户端不该被逼回 Nomi 界面点确认——否则他为什么在外面用 MCP。
所以上半场那句「这道门必须在 Nomi 里决定」对 MCP 路径是错的方向。

**改成什么**：Nomi 只坚持一条不变量——**每笔付费放行必须对应一次真人答过的确认（收据）**；
在哪儿答不管。确认弹在调用方客户端（elicitation），答「是」当场拿主进程铸的收据。

### 「以后 ¥X 内别再逐镜问」= 一次带上限的付费确认

`set_trust=budget_only` 不是一个纯粹的偏好开关：逐镜确认门**只在 confirm_all 生成**
（`productionRunDriverOps.ts:497`），所以 `confirm_all → budget_only` 等于「以后这些镜头不再问你了」——
一次付费放行。它现在走和付费门**逐字同构**的判据：

| 凭证 | 谁盖 | 绑什么 |
|---|---|---|
| `humanGesture` | 受信 IPC 边界（Nomi 自己窗口里的真人） | 「来自受信窗口」 |
| elicitation 收据 | 主进程（HMAC + TTL + 一次性，复用既有那条链） | runId + 币种 + 上限（costScope）+ 已封存授权的 digest |

缺两者 → 拒（fail-closed 不变）。**从 `key_confirm` 降档不进这条闸**：那一档本来就没有逐镜确认门，
降档只跳过免费的创意/样片门，把它也当付费放行会把「别问了直接出」在还没定价的阶段直接卡死——
那是把不变量放大成打扰，不是守住它。

**上限从哪来**：已封存授权信封（`generationPlan.authorizationEnvelope`）的 `budget.maximum` = 逐镜单价之和。
不从命令里抄（抄来的上限等于让调用方自己写自己的额度），不新算价（价格只有 catalog → 封存信封一条路）。
**改上限或改计划即失效**：上限编在 `trust.budget-only:<runId>:<币种>:<上限>` 里，digest 绑 `contractHash`。

### 确认摘要摊开逐镜价目（R2）

客户端里那段文字**就是**那张确认卡。只给「最多花费 ¥X」等于让用户闭眼签字，所以摘要改成
「镜号 · 一句话 · 模型 · 单价」逐行 + 合计；信任降档时再加一句「¥X 内不再逐镜问；超出仍会重新问你」。

**永不把「算不出」当 ¥0**：整批全部定不出价 → 不弹、直接回 `surface:'none'`；信任降档给不出正数上限 →
`production.trust-challenge` 直接拒。注意 `amount === 0` **不是**未知（本地 ComfyUI 这类真免费），
两者的区别由 `shotPricing.ts` 的 `price.known` 承载，确认层只是读它。

### 这一版新增/改动的文件

| 层 | 文件 | 做了什么 |
|---|---|---|
| 语义 owner | `electron/productionRun/productionRunGateIdentity.ts` | `trustGrantGateId` / `trustGrantCostScope`：信任收据的身份与上限编码（刻意不用 `gate-` 前缀，与真门互不通用）|
| 绑定真相源 | `electron/productionRun/productionRunTrustGrant.ts`（新） | 从已封存信封读出逐镜价目/合计/上限/digest；算不出正数上限就抛 |
| 命令边界 | `electron/productionRun/productionRunApprovalReceipt.ts` | `verifyTrustGrant`：与付费门同构的两种凭证；收据期望抽成 `ReceiptExpectations`，两条路共用一次校验 |
| 装配 | `electron/productionRun/productionRunService.ts` | set_trust 前验人证、事件落库后一次性消费 |
| 挑战签发 | `electron/capabilityCore/productionTrustGrantChallenge.ts`（新） | `production.trust-challenge`：把封存信封翻成一张 challenge（不算价、不写状态）|
| 派发 | `electron/capabilityCore/dispatcher.ts` / `dispatcherParams.ts`（新） | 新增 trust-challenge 路由；`production.control` 透传收据；三个参数校验搬进共享模块（避免外移模块反向 import 造环）|
| 协议 | `electron/capabilityCore/mcpTrustDowngrade.ts`（新） / `mcpProtocol.ts` | 截 `nomi_run_control set_trust=budget_only`：先问真人拿收据，再改档 |
| 确认文案 | `electron/capabilityCore/mcpGateConfirmation.ts` | 逐镜价目 + 合计 + 「¥X 内不再逐镜问」；全未知价不弹 |

### 这一版**不动**的

- **降档仍然永远不自动批准正在等待的付费门**（`autoApproveGate` 的 `isSpendGate` 拒绝原样保留）。
  收据授权的是「以后不再逐镜问」，不是「替你把眼前这道门按了」——两条不变量各管各的，不许互相顶替。
- 派发层「有逐镜门在等就先去决定它」的既有守卫保留（`dispatcher.ts` production.control）。
- `nomi_run_gate action=decide` 的可决议范围不变（创意门 + 定妆检查点，都是免费门）。付费门的客户端确认
  走生成门那条链（challenge → elicitation → 收据），不在 `nomi_run_gate` 上再开一个入口。

### 验收门（本版新增）

- `productionTrustLevel.test.ts`：「budget_only 无收据无手势 → 拒；带手势降档生效但逐镜付费门仍原样等着」。
- `productionRunService.test.ts`：「带绑定上限的有效收据 → 通过且一次性消费」「收据上限与请求不符 → 拒」。
- `productionRunApprovalReceipt.test.ts`：只有真正拿掉付费确认的降档才要人证；真门收据不能顶替信任收据。
- `mcpGenerationConfirmation.test.ts`：摘要含逐镜价目/合计/「¥X 内不再逐镜问」；整批未知价不弹。
- `productionRunTrustGrant.test.ts`（新）：上限只能从封存信封算出来（`trust.budget-only:<runId>:<币种>:<上限>`，
  gateId 不带 `gate-` 前缀）；没封存 / 有镜头没定价 / 合计非正 → 一律抛，不凑数字。
- `mcpTrustDowngrade.test.ts`（新）：客户端确认那一环——答「是」才把收据带进 `production.control`；
  拒绝与「没人可问」文案不混；上限算不出就连问都不问；真故障照常上抛，不洗成「没批准」；
  只截 `set_trust=budget_only`，其余动作/档位原样派发。
