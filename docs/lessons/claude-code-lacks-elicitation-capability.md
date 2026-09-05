# MCP elicitation 的支持面：CLI 已支持，桌面客户端仍普遍不支持（旧结论已反转）

> 📎 教训 · 首次记录 2026-08-18 · 状态：⛔ 已反转（2026-08-24 修正）· 2026-09-03 握手实测复核 · **2026-09-06 行为级实测（url 模式）**
> **触发场景**：要设计任何依赖 MCP `elicitation/create` 的确认通道；或看到「Claude Code 不支持 elicitation」这句被当成前提引用。

**现结论（2026-08-24）**：

- **Claude Code CLI ≥ 2.1.76（2026-03-14）已支持** `elicitation/create`（含 Elicitation / ElicitationResult hooks）。
- **桌面客户端仍普遍不支持**：Claude 桌面 App 不支持（anthropics/claude-code#41110）、claude.ai 未落地、国产桌面客户端普遍不支持。Codex 的情况见下节实测：**自报支持已确认**（0.151.0），但 openai/codex#11816 那个自动拒的行为 bug **未复验**，别把「自报」读成「好用」。
- 因此**桌面端的主流现实 = 无 elicitation**。2026-08-24 用户明确：主战场是桌面客户端，所以把 GUI 兜底卡升级为系统级置顶小浮窗，不要求用户回 Nomi 主窗。
- 用户 CLI 版本 < 2.1.76 时，旧结论对他仍成立。

**当初为什么会误判**（这才是教训）：2026-08-18 的实测结论是「Claude Code 不声明 elicitation 能力」。这条**当时是真的**，但它被当成了一条关于产品的**恒定事实**记了下来，而实际上它是一条**带版本的、会过期的观测**——客户端在 2026-03-14 就补上了这个能力，结论静默失效了一个多月，期间一直被当作设计前提引用。凡是「某客户端 / 某 SDK 支不支持 X」的结论，都必须**连版本号一起记**，并且在再次引用前重验（这正是 `CLAUDE.md` R5「不凭记忆判断能力 / 新旧」的实例）。叠加的第二个混淆源见 [MCP 侧改动必须重新打包 app 才看得到](mcp-fixes-need-repackaged-app.md)——探针没弹确认，也可能只是装机版还是旧的。

## 2026-09-06 行为级实测：url 模式在两个真宿主上都到不了用户面前

上一版留下的那句「要下『Codex 的 elicitation 可用』这种结论，得另做行为级验证」——本次做了，结论是**不可用**。
两个客户端各驱动一次真实的 `nomi_integration action=open_credentials`，逐帧 trace 落在
`docs/qa/evidence/2026-09-06-mcp-real-host/`：

| 客户端 | `initialize` 原样声明 | Nomi 发了什么 | 客户端回了什么 | 用户看到 |
|---|---|---|---|---|
| Claude Code CLI 2.1.261 | `{"roots":{"listChanged":true},"elicitation":{}}` | **不发 URL**（规范：空对象 = 只支持 form） | — | 手动兜底文案 |
| Codex CLI 0.153.4 | `{"elicitation":{"form":{},"url":{}}}` | `mode:"url"` + 真实一次性 loopback 链接 | `{"action":"decline"}` | **什么都没看到** |

两条要连版本号一起记：

1. **Claude Code 至今没有声明 `url`。** 空的 `elicitation: {}` 就是「只支持 form」，不是「支持全部」。
   任何以 URL 模式为前提的设计（例如 2026-09-05 拍板的「MCP 密钥走 elicitation URL」）**在 Claude Code
   上根本不会触发**，只会走兜底。这不是缺陷，是规范要求的行为——但做设计时必须知道兜底才是主路径。
2. **Codex 声明了 `url` 却自动拒**（openai/codex#11816 的行为，上一版标着「未复验」，本次复验为真）。
   `codex exec` 下 100% `decline`，链接从没给任何人看过。**「自报支持」离「好用」还差一整步。**

**由此产生的一条通用纪律**：客户端返回的 `decline` / `cancel` **不是**「有人拒绝了」的证据，它可能是
客户端自己替人拒的。服务端据此写「你取消了 / 超时了」的文案，就是把用户从没见过的东西算到他头上。
Nomi 侧已改成只陈述已知事实（「填写页没有在你的 AI 客户端里打开」）并给出可执行的下一步，
且不再以 tool error 中断流程（`electron/capabilityCore/mcpCredentialElicitation.ts`）。

**同日的第三条**（与本条同源）：`docs/qa/2026-09-06-agent-mcp-restart-real-user-pass.md` §2.2 记了
`nomi_timeline_edit` apply 在 main 上从来不可能成功——两道各自不可达的门。这正是本文档下面那句
「**『对方支不支持』和『我方走不走得到』要分别验，只验一半会得出反的结论**」的第二次应验；这次给它配了
门岗 `check:mcp-scope-reachable`。

---

## 2026-09-03 握手实测（结清上一版留的待办）

用探针 MCP 服务器抓真实 `initialize` 帧，本机两个 CLI 客户端**都声明** elicitation：

| 客户端 | `capabilities` 原样 | protocolVersion |
|---|---|---|
| Claude Code CLI 2.1.232 | `{"roots":{"listChanged":true},"elicitation":{}}` | `2025-11-25` |
| Codex CLI 0.151.0 | `{"elicitation":{"form":{},"url":{}}}` | `2025-06-18` |

Nomi 的 `PROTOCOL_VERSION` 也是 `2025-11-25`，与 CC CLI 完全对上。

**必须分清两件事，别把这条读过头**：上表证明的是**客户端自报支持**，**不是**「弹窗真的好用」。上一版关于
Codex 的顾虑（openai/codex#11816 自动拒的 bug）针对的是**行为**，本次探针没有证伪它——要下「Codex 的
elicitation 可用」这种结论，得另做行为级验证。自报能力只回答「服务端该不该往这条路走」。

**同日更重要的发现（另一条轴）**：客户端支不支持只是一半，另一半是**服务端自己走不走得通**。2026-09-03
查出 Nomi 的客户端确认面在生产里**整条不可达**——两个签发点无条件要求一种没有任何实现能提供的凭证
（`handoff.clientAttestation:true`），同时验证回调 `verifyClientGenerationConfirmation` 在两个生产装配点
都没接。净效果：**哪怕客户端完全支持，每次花钱确认仍被赶回 Nomi 应用，Nomi 没开就直接拒绝**。已修
（PR #429，根因合同 `docs/fixes/2026-09-03-client-confirmation-surface-unreachable.root-cause.json`）。
教训是：**「对方支不支持」和「我方走不走得到」要分别验，只验一半会得出反的结论。**

**探针方法**

首选（直接读握手，不依赖 Nomi 起没起、不花额度）：写个最小 stdio MCP server，`initialize` 时把
`params.capabilities` / `clientInfo` / `protocolVersion` 原样落盘，再回一个只带 `probe_ping` 的
`tools/list`。然后：

- Claude Code：`claude -p "调用 capprobe 的 probe_ping" --mcp-config <cfg.json> --allowedTools "mcp__capprobe__probe_ping"`
- Codex：`codex exec --skip-git-repo-check -c 'mcp_servers.capprobe.command="node"' -c 'mcp_servers.capprobe.args=["<path>"]' "..." </dev/null`

**两个坑**：① 握手发生在鉴权/审批**之前**——客户端后续报 `OAuth session expired`（本机 `claude` CLI
2026-09-03 就是这样）或 `需要审批但策略为 never`（Codex 默认）时，**capabilities 其实已经抓到了**，
别把命令失败当成没测到；② `codex exec` 必须带 `</dev/null`，否则永久挂起（见
[codex exec 后台派工要关 stdin](codex-exec-background-needs-stdin-closed.md)）。

次选（旧法，仍有效，但要 Nomi 在跑）：新建项目后调 `nomi_add_nodes` 加 2 个节点——满足 elicitation-first
方案的全部确认条件。**直接返回 ids、没弹确认** = `clientSupportsElicitation === false`。注意它测的是
「服务端到底走没走 elicitation」，会把上面两条轴混在一起，定位时要配合首选探针拆开看。

**怎么用**：

1. 讨论确认通道时按矩阵走，且**连版本号一起引用**：CC CLI 2.1.232 / Codex CLI 0.151.0 均自报支持；
   桌面 App 与多数桌面客户端仍不支持；Codex 的行为可靠性未复验。
2. 引用前重验——这条结论已经过期过一次（见下段），它是**带版本的观测**不是恒定事实。
3. 验证 elicitation 改动仍以**自声明能力的假客户端走查**为主（`tests/ux/spend-elicit-app-open.walk.mjs`
   范式）；真机客户端走查用来兜「我方走不走得到」那一半。

**出处**：2026-08-18 首测（结论已失效）、2026-08-24 反转修正、2026-09-03 握手实测；anthropics/claude-code#41110、openai/codex#11816。相关：[断言前先证明你在你以为的现场](assert-you-are-in-the-situation-you-claim.md)、[走查断言必须有真信号](walkthrough-assertions-need-a-real-signal.md)、[MCP 侧改动必须重新打包 app 才看得到](mcp-fixes-need-repackaged-app.md)。
