# 先查别人：付费门的人证要不要自己造一套

日期：2026-09-10 · 场景：MCP / 制作 Run 批量侧付费门 `gate.decide` fail-open 修复。

问题一句话：「一次门决议到底算不算真人授权了花钱」这件事，Nomi 要不要再发明一套证明机制？

## ① 依赖里已有？

- **没有可用的**。检索本仓依赖：没有任何一个包提供「主进程签发、跨进程可验、一次性消费的人类审批凭证」。
  最接近的是 Electron 自己的 `ipcMain` 发送方校验（我们已经用了，见 `electron/ipcSenderGuard.ts`），
  但它只回答「这条 IPC 来自不来自我们的窗口」，不回答「用户在哪个门上点了什么、批了多少钱、是否已用过」。
- MCP SDK 侧同理：协议只定义了 `elicitation/create` 这个**问**的通道（下面③），不定义**证**的凭据。
- 结论：依赖层没有现成件，但这也**不构成自研理由**——因为仓库里已经有一份（见②）。

## ② 仓库里已有？

已经有一条完整、在跑的单发（single-shot / semantic generation）收据链，能力覆盖本次需求的全部要点：

- `electron/capabilityCore/approvalReceipt.ts:255` `createApprovalReceiptAuthority` —— challenge → 手势证明 → receipt
  三段式，HMAC-SHA256 签名（`sign`，:215）、TTL 到期（`assertNotExpired`，:246）、落盘状态自校验
  （`readState` 的 checksum + store MAC，:262）、一次性消费（`consumeReceipt`，:537）。
- `electron/capabilityCore/approvalReceipt.ts:389` / `:419` —— 两种人证来源已经建模好：主进程 GUI 手势
  （`createMainProcessGestureAttestation`）与 MCP 客户端 elicitation（`createClientElicitationAttestation`）。
- `electron/capabilityCore/generationTransportAdapters.ts:216` —— 单发路径把「没有收据权威就整条能力不可用」
  写成了硬前置；`:240` 决议落库后一次性消费。这是本次要照抄的姿势。
- `electron/capabilityCore/runOwnedGenerationGateAuthority.ts:139` —— 收据 → `gate.decide` 的落库形状
  （`receiptId` + `authorizationDigest` + `projectRevision`）已经定好，批量侧不需要发明新字段。
- `electron/productionRun/productionRunApprovalReceipt.ts:27`（修改前）—— 校验函数**本来就在**制作 Run
  的命令边界上，只是权威缺席时返回 `undefined`，于是从没被真正执行过。

结论：**能力在仓库里已经有了，缺的不是机制而是装配**。再造第二套 = 第二把密钥、第二个状态文件、
第二种过期语义，等于把「验不过」变成「各验各的」。

## ③ 生态里已有？

- MCP 规范的 **Elicitation**（2025-06-18 起）：<https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation>
  —— 规范明确把「向人要确认」定义为**服务端→客户端**的请求，并要求客户端不得代替用户自动应答。
  它规定的是「怎么问」，**不**提供「问过了」的可验证凭据；所以「拿到 elicitation 的 accept」必须在我们
  这一侧转成主进程签发的证明，这正是 `createClientElicitationAttestation` 在做的事。我们照规范用，不另起协议。
- MCP 安全最佳实践：<https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices>
  —— 要求服务端不得把客户端自述的身份/同意当作授权依据。对应到本次：`initialize.clientInfo` 只当审计标签
  （代码里已有这条注释，`electron/capabilityCore/mcpProtocol.ts:430`），付费授权只认主进程自己签的东西。
- Claude Code 的权限模型：<https://docs.claude.com/en/docs/claude-code/iam>
  —— 它公开列出「没有任何模式会自动放行的动作清单」，即高危动作**不存在**由模式降档带来的自动放行。
  这条直接对上本次的第二个洞：我们的 `set_trust=budget_only` 曾经会顺手批掉逐镜付费门 = 降档带来了自动放行。
- Anthropic 的 agent 工具设计指引：<https://www.anthropic.com/engineering/writing-tools-for-agents>
  —— 花钱/不可逆的动作要有独立、显式的人类确认路径，不与「模型自主度」旋钮耦合。

## ④ TikHub 自媒体里怎么说？

- 本次**没查成**：TikHub 检索这轮没有跑（任务窗口内只做安全修复，未起调研 agent）。诚实记一笔，不假装查过。
  影响评估：本题的判据来自规范与仓库现状，自媒体观点不构成额外约束。

## 结论

**用已有的**：复用 `capabilityCore/approvalReceipt.ts` 那一份收据链，把它装配到制作 Run 服务上；
不新建密钥、不新建状态文件、不新建协议。本次唯一新增的概念是 `humanGesture`——它不是新凭据，
而是把「这条命令来自受信窗口」这个**本来就存在**的事实（`assertTrustedSender`）显式化，
以便付费门能区分「Nomi 自己窗口里的真人」和「远端客户端」。升级它成为带签名的手势证明
（`createMainProcessGestureAttestation`）是后续工作，前提是批量确认卡先领 challenge。
