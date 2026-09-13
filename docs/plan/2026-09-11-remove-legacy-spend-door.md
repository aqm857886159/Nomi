# 2026-09-11 · 删掉「客户端自报即发放」的付费通道

✅ 已交付（分支 `fix/remove-legacy-spend-door-20260911`）

> 用户 09-11 拍板：「并行的就删掉，测试没问题就删」。
> 起因：`docs/plan/2026-09-11-triage-board.md` §1.2/§1.3 的架构分诊——同一条「付费必须过真人」的不变量
> 有**两扇门**在守，其中一扇的判据是调用方自己报的一个布尔。
> 根因合同：[`docs/fixes/2026-09-11-legacy-spend-door.root-cause.json`](../fixes/2026-09-11-legacy-spend-door.root-cause.json)

---

## 0. 一句话

付费生成的放行权，从此**只有主进程收据门**一个 owner；MCP 客户端说「人同意了」不再是钱的凭据。

---

## 1. 背后的逻辑：用户那一刻的真实摩擦是什么

先说清这事儿对用户意味着什么，不然它听着像纯内部重构。

Nomi 的钱花在「发一次生成请求给供应商」。为了不让 AI 自己偷偷烧额度，我们在主进程装了一道闸：
**每一次付费提交都必须随附一张"人点过头"的凭证**，没凭证就拒发。这是 2026-06-21 立的红队底线
（`docs/plan/2026-06-21-spend-confirmation-gate.md` §2），威胁模型的要害写得很直白：渲染层不可信，
**任何「某某说同意了」都不可作为放行依据**。

问题出在：这道闸后来长出了**第二个入口**。当外部 AI（Claude Code / Codex 之类）经 MCP 驱动 Nomi 时，
确认弹在调用方那头（MCP 的 elicitation），于是我们让协议层在收到客户端 `accept` 后，
往 loopback 请求体里塞一个 `spendConfirmed: true`，主进程见到它就**直接铸令牌**
（`electron/capabilityCore/gateway.ts:85` `withPreApprovedSpend`）。headless 那条路还有个更粗的口子：
环境变量 `NOMI_LOOP_SPEND_OK=1` 也直接铸（同文件 `:125`）。

这两条的共同问题是：**它们把「谁授权了这笔钱」的判据，交给了主进程自己验不了的一方。**
代码里的注释自己就写明了代价（`gateway.ts:80-83`）：能读到 `~/.nomi/capability-core/token` 的
任何本地进程，都可以借它静默烧额度——用户看不见，也拒不掉。

**用户体验是什么**：正常情况下什么都不变（那条路今天已经没有活的生成入口在走，见 §3）。
变的是最坏情况——一个装在同一台机器上的脚本/插件，不再能凭「我读得到那个 token」把你的额度花光。

**要权衡的那个核心东西，只有一个**：少一扇门 = 少一种"就地确认"的便利，换来"钱只认一种凭证"。
我们选后者，因为便利那一侧今天并没有活用户（§3 实测：那条路已无调用者），而风险那一侧是真金白银。

---

## 先查别人

> 每条都实地 fetch 过；仓库内引用带 file:line。

| # | 出处 | 他们怎么做 | 对本题的判据 |
|---|---|---|---|
| 1 | **MCP 规范 · Elicitation (2025-06-18)** <https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation> | Elicitation 是「服务端向用户要结构化输入」的 UI 通道。原文要求 "Servers **MUST NOT** use elicitation to request sensitive information"；安全条款一律是 "Clients **SHOULD** implement user approval controls"（SHOULD，且由客户端自己实现、自己声明结果）。 | 客户端回来的 `action:"accept"` 是一条**自述的 UI 事件**，规范从未承诺它可被服务端验证。把它当付费授权用，等于把判据放在自己管不着的进程里。 |
| 2 | **MCP 规范 · Security Best Practices (2025-11-25)** <https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices> | Token Passthrough 一节结论：**"MCP servers MUST NOT accept any tokens that were not explicitly issued for the MCP server."** Confused Deputy 一节要求 "per-client consent"，且 consent 必须绑死具体 `client_id`、不能只是「用户同意过」。 | 执行方**只能认自己签发、自己能验的凭据**。「某个已鉴权的本地调用方说人同意了」正是 spec 点名禁止的那类「不是发给我的凭据」。 |
| 3 | **MCP 规范 · Tools (2025-06-18)** <https://modelcontextprotocol.io/specification/2025-06-18/server/tools> | "there **SHOULD** always be a human in the loop with the ability to deny tool invocations"；且 "clients **MUST** consider tool annotations to be untrusted unless they come from trusted servers"。 | MCP 自己就承认「协议里的自述元数据默认不可信」。反向同样成立：服务端对客户端自述的 `spendConfirmed` 也该默认不可信。 |
| 4 | **OpenAI Agents SDK · Human-in-the-Loop** <https://openai.github.io/openai-agents-python/tools/> | 机制：工具标 `needs_approval=` → run 暂停 → `result.interruptions` → `state.approve()/reject()` 才继续。**审批是 runner 进程自己的状态机迁移**。 | 同构：闸门装在执行那一侧，批准不是入参。模型/客户端无法用一个字段声明「已批准」把自己放行。 |
| 5 | **Claude Code · PreToolUse hook** <https://code.claude.com/docs/en/hooks> | "**PreToolUse** \| Before a tool call executes. Can block it"；hook 返回 `permissionDecision: "allow"｜"deny"｜"ask"`，退出码 2 直接阻断。 | 主流 coding agent 把「危险动作放不放行」做成**宿主进程里的确定性判定**，不是写进提示词让模型自觉。与主进程收据闸同构。 |
| 6 | **Confused deputy（定义源）** <https://en.wikipedia.org/wiki/Confused_deputy_problem> | 要害是 "the designator … does not carry the full authority needed"；解法是 "bundle together the designation of an object and the permission to access that object. This is exactly what a capability is."（Norm Hardy 原文 cap-lore.com 证书失效，故引维基；MCP 规范自己也链此页。） | `spendConfirmed:true` 是纯 designation（「请花钱」），随它而来的权限却是主进程自己的 vendor key = 教科书级 confused deputy。正解是让「批准」本身成为不可伪造的 capability（HMAC 收据 / 受信 IPC 手势章）——正是我们保留的那条路。 |
| 7 | **RFC 8252 · OAuth 2.0 for Native Apps** <https://datatracker.ietf.org/doc/html/rfc8252> §7.3/§8.5 | "Loopback IP-based redirect URIs may be susceptible to interception by other apps accessing the same loopback interface"；静态分发的 secret "should not be treated as confidential secrets"。 | 本机 loopback 上的**对端身份无法被证明**。「持有 loopback token = 拥有花钱权」在标准里就站不住：token 至多证明「能连上」，证不了「人点了」。 |
| 8 | **Stripe MCP（官方）** <https://docs.stripe.com/mcp> | 真正的收口是**服务端侧的 restricted API key / OAuth scope**（key 只授予 agent 需要的操作，可按 session 撤销）；「让用户确认工具执行」只作为给宿主的**建议**。⚠️ 三方博客称其工具接受 `human_confirmation` 对象，官方文档工具表里**没有**该字段——不要引用那条说法。 | 正反两面都支持本次删除：碰钱那一侧靠**能力范围**兜底，「人确认了」只当客户端礼仪，不当服务端判据。 |

**仓库内（我们自己已经写过的判据）**

- `docs/plan/2026-06-21-spend-confirmation-gate.md:41` `## 2. 威胁模型` —— T1 AI 自主/被注入调生成；T2 新入口忘传 `onToolCall` 静默放行；**T3 渲染层任何代码对 confirm 回 `{ok:true}`**；T4 UI 直发无说明就烧。`:49` 点明共同要害「渲染层不可信……任何『渲染层说同意了』都不可作为放行依据」。
  → **本次删的这扇门，就是 T3 换了个进程边界**：把「渲染层说同意了」换成「MCP 客户端说同意了」，可验证性一样是零。
- `docs/qa/2026-08-20-mcp-issues.md:95` —— 原文已登记：「不建议让 Agent 能设 `NOMI_LOOP_SPEND_OK` —— 那是脚本/评测的显式授权口，红队边界不能从这里破。」
  → 这个口子**早在 2026-08-20 就被登记为「不该让 Agent 够得着」**，只是当时用「Agent 设不了 env」当缓解，而不是把它删掉。缓解不是防线（R28）。
- `docs/plan/2026-08-19-session-scoped-spend-trust.md:50` —— 当时明写**不动** `withPreApprovedSpend`（#103 已定「会话信任只免掉『问』、不免掉『令牌』」）。
  → 与本次不冲突：那条决定守的是「令牌校验不可省」，本次删的是「令牌的发放判据不可来自调用方自述」。方向一致。

---

## 3. 实勘：删之前先证明没人在用

| 对象 | 结论 | 依据 |
|---|---|---|
| `withPreApprovedSpend` 生产调用者 | 2 处：`mcpStdioServer.ts:138`（`makeConfirmedGateway`）、`rpcServer.ts:365` | grep 全仓 |
| `McpInvokeOptions.spendConfirmed` 的**生产者** | **0 处**。`mcpProtocol.ts:30` 声明了字段，但全仓没有任何地方给它赋值 → 进程内 stdio 那条路早已是死分支 | `grep -rn "spendConfirmed" electron/` 只有读、没有写 |
| `nomi_generate` 对外工具 | **已是墓碑**：`MCP_TOOL_RESOLVER.resolve('nomi_generate')` 返回 undefined、tools/list 不含它、调用回 `未知工具` | `electron/capabilityCore/nomiGenerateRetirement.test.ts:15-44`、`mcpSurfaceCollapse.test.ts:70` |
| `core.generateOnProject`（唯一消费 `gateway.confirmSpend` 的函数） | **零生产调用者**，只被 `core.test.ts` 调 | `grep -rn "generateOnProject" electron src scripts tests` |
| `~/.nomi/capability-core/token` | **另有用途，不能删**：它是整条 loopback RPC 的鉴权凭据（`security.ts`、`nomiClient.mjs:167`），不只为付费而存在 | `docs/guide/capability-core-cli-mcp.md:36` |
| 外部宿主是否依赖 `nomi_generate` 返回形状 | **否**。它对外已不存在（上面墓碑测试），外部宿主的付费出片走 ProductionRun 语义面（`nomi_request_generation_gate` → `nomi_decide_generation_gate`（要收据）→ `nomi_start_generation`） | `generationDispatcher.ts:18-31` |

**结论**：这扇门今天只剩一种被走的方式——**本地进程手搓一个 loopback RPC 请求体塞 `spendConfirmed:true`，
或者给 headless host 设 `NOMI_LOOP_SPEND_OK=1`**。也就是说，它现在**只对攻击者有用**。

---

## 4. 做了什么

### 删

| 文件 | 删的东西 |
|---|---|
| `electron/capabilityCore/gateway.ts` | `withPreApprovedSpend` 整个函数；`createDiskGateway.confirmSpend` 的 `NOMI_LOOP_SPEND_OK` 分支（改为恒 `null`，fail-closed） |
| `electron/capabilityCore/mcpStdioServer.ts` | `makeConfirmedGateway`；`spendConfirmed` 透传；网关选择改为恒 `createDiskGateway` |
| `electron/capabilityCore/rpcServer.ts` | `preApprovedSpend` 分支与 `parsed.spendConfirmed` 字段 |
| `electron/capabilityCore/mcpLoopbackRpcRequest.ts` | 线协议里的 `spendConfirmed` 字段（塞了也不上线） |
| `electron/capabilityCore/mcpProtocol.ts` / `mcpNodeLauncher.ts` | `McpInvokeOptions.spendConfirmed` 声明与透传 |
| `scripts/_robot-demo-gen.mjs` | 整个删除（一次性脚本，唯一用途是走已退役的 `generate` + env 逃生口，无任何引用者） |
| `scripts/comfyui-utility-workflow-walkthrough.mjs` | 走查 env 里的 `NOMI_LOOP_SPEND_OK`（该走查本就是真人点 GUI，env 是残留） |

**没有留 fallback、没有留开关、没有留 env 后门（P1）。**

### 保留（刻意）

- `generationDispatcher.ts:155` 对 `params.spendConfirmed` 的**拒绝**——那是门①一侧的纵深防御（「布尔不能替代收据」），保留。
- `~/.nomi/capability-core/token`：它是 RPC 鉴权，不是花钱凭据。删门之后它的语义反而变干净了——**能连上 ≠ 能花钱**。
- `createRendererGateway.confirmSpend`（真人点应用内卡才铸）与 `taskSpend.consumeTaskSpend` 的报价确认：都是 GUI 真人手势路，不属本门。
- #730 的 `mcpTrustDowngrade.ts` / `productionRunTrustGrant.ts`：门①一侧的收紧，不动。

### 加（防复发）

`electron/capabilityCore/spendDoorSingleOwner.test.ts` —— 四条断言：
1. 设了 `NOMI_LOOP_SPEND_OK=1`，headless 磁盘网关仍不发放授权；
2. 网关模块不再导出「客户端自报即发放」的包装器；
3. loopback 线协议里没有付费自报位（硬塞也不上线）；
4. **源码棘轮**：扫全 `electron/` 树，出现 `NOMI_LOOP_SPEND_OK` 或 `withPreApprovedSpend` 即红。

第 4 条是 R28 的落点：把「不许长第二扇门」从人的记忆挪到编译期之后最早的那层（门岗）。

---

## 5. 先红后绿

```
删之前：Test Files 1 failed (1) / Tests 4 failed (4)
        offenders = [gateway.ts: NOMI_LOOP_SPEND_OK, gateway.ts: withPreApprovedSpend,
                     mcpStdioServer.ts: withPreApprovedSpend, rpcServer.ts: withPreApprovedSpend]
删之后：Test Files 1 passed (1) / Tests 4 passed (4)
```

---

## 6. 不动项

`electron/spendGrant.ts` 一字不动（令牌结构、`assertAndConsumeSpendGrant` 逐次硬校验、按 node 计次封顶全保留）。
`productionRun/` 收据门一字不动。`core.generateOnProject` 本体不动（见 §7）。

---

## 7. 明确没做完的

`core.generateOnProject` 及其整条旧生成编排（`i2vTwoHop.ts`、`shotVerifyDeps.ts` 的 grant 复用逻辑、
`ProjectGateway.confirmSpend` 这个接口成员本身）现在是**零生产调用者的死代码**，只被 `core.test.ts` 撑着。
按 P1 应当删，但那是另一条独立的、跨十几个文件的拆除（含 25+ 个单测），塞进本 PR 会把「删一扇门」这件
可审计的小事淹掉。**本轮不动，单开一条任务**。删掉它之后，`ProjectGateway` 就只剩读写画布 + 方案门，
钱的语义从这个接口上彻底消失——那才是终局形状。
