# 权限模型重做 · 先查别人（R29 四列表 + 同行对照）

> 只读调研，2026-09-10。仓库快照：`claude/permission-model-rework-1bad6b`。
> 三个实施项：①付费确认卡进介入槽 ②卡上改参数 = `generation.revise` ③权限三档 step/自动/自主。
> 落库位置：本文件（`docs/research/2026-09-10-permission-rework-prior-art/prior-art.md`）。

---

## §1 pi 四列表

**版本**：`@earendil-works/pi-agent-core` / `pi-ai` / `pi-coding-agent` 均 `0.85.1`（`package.json:224-226`）。
**我们接的是哪一层**：`AgentHarness`（`electron/agentLane/laneHost.mts:27`），**不是** `createAgentSession` + 扩展运行时（`laneHost.mts:78` 自己写明了这个分界）。这一条决定了下面一半的裁决。

| 它提供 | 我们用了 | 我们另写了 | 我们拆散了 |
|---|---|---|---|
| **`before_tool` 钩子＝异步审批原语**。返回 `{ args?, block? }`，可 `await` 到天荒地老（`pi-agent-core/dist/harness/agent-harness.d.ts:550-563`） | 整条闸挂在这里（`laneHost.mts:346-419`），`gate.preflight()` 停在钩子里等人（`laneApprovalGate.ts:236-280`） | — | — |
| **`{ args }` 改写并重新校验**。`applyBeforeToolDecision()` 注释就叫 "Apply an explicit hook decision and **revalidate** replacement arguments"，对替换 args 重跑 `validateToolArguments`（`dist/harness/execution/tools.js:36-54`） | **没用**。`laneHost.mts:390` 写死了「**永远不返回 `{ args }`**：改了参数，面板收据上写的和实际执行的就不是一回事，而用户是照着收据点的头」 | `generation.trial_narrow` 那条「撤授权→回 draft→重新封印→重新出闸」的路（`productionRunReducer.ts:358-417`） | — |
| **`block.reason` 原样变成模型看到的 tool result**；`block.terminate` 可提前收尾（同上 d.ts:558-561） | 拒收理由一字不改（`laneApprovalGate.ts:199-208`）；回合上限用 `terminate`（`laneHost.mts:349-353`） | — | — |
| **`steer()` / `followUp()` 两个队列 + `QueueMode`**（`dist/agent.d.ts:84-90`、`types.d.ts:24-28`） | `LaneCommand` 的 `steer` / `follow-up` / `cancel-queued` 直通（`laneContracts.ts:485-495`） | — | — |
| **`abort()` + `Gate.admit`（中断准入）**（`dist/agent.d.ts:96-98`、`harness/execution/effect-gate.d.ts:6-9`） | race abort signal、被打断时 resolve 不 reject（`laneApprovalGate.ts:283-299`，含三条实测坑） | — | — |
| **`after_tool` 可整体替换结果**（`agent-harness.d.ts:564-570`） | 只读它算连续失败（`laneHost.mts:420+`） | — | — |
| **`SessionManager` / `JsonlSessionRepo` 持久化 + 分支**（`harness/session/`） | `laneSession.mts:17` 直接用 | — | — |
| **`ProjectTrustStore`（项目信任 = 一次性、可记住的信任决定）**（`pi-coding-agent/dist/core/trust-manager.d.ts`） | 没用 | 我们的「本会话允许这类」是内存 `Set`，关 app 即忘（`laneApprovalGate.ts:117-118`） | — |
| **扩展面 `ExtensionAPI.on('tool_call', …)`，`event.input` **可就地改**、明确写「**No re-validation is performed after mutation**」**（`pi-coding-agent/dist/core/extensions/types.d.ts:713-718、818-827`） | **接不进来**：那是 `pi` CLI 的扩展运行时，我们走 `AgentHarness`，没有 `ExtensionAPI` | — | — |
| **`ui.confirm/select/input` + `ui_prompt_start/end` 事件（宿主 UI 审批原语）**（同上 `types.d.ts:71-72、565-577`） | 没用（TUI 面的） | 我们自己的介入槽 `V4Intervention`（`AgentPanelV4Cards.tsx:173+`） | — |
| **pi 本体没有任何 permission mode**（`harness/execution/effect-gate.d.ts` 的 `Gate` 只管 abort 准入）。`allow/ask/deny` 三档全是社区扩展：<https://pi.dev/packages/pi-permission-system>（确认弹窗四档 `Allow Once / Allow Always / Reject / Reject with Reason`，`Allow Always` 只记本会话内存；配置键 `defaultPolicy/tools/bash/mcp/skills/special`；另有不留规则的 `yolo`）、<https://github.com/rHedBull/pi-permissions>（Claude Code 风格三档） | 没用 | `step / safe-auto / project` × `confirm / within-budget`（`capabilityApprovalPolicy.ts:43-52`） | — |

### 对照结论「用 pi 的哪些、为什么不用」

1. **(a) 审批/中断-恢复原语：有，而且够。** `before_tool` 是一个可以无限期 await 的异步闸，abort 由 `Gate` 单独管。**不需要**「pending approval + resume with modified args」这种二段式 API——pi 的模型是「一次调用停在钩子里」，恢复就是 resolve 那个 promise。我们已经吃满。
2. **(b) 「卡上改参数后继续」：pi 给了两条路，我们要的是第三条。**
   - 路一 `before_tool` 返回 `{ args }` — 框架**会重新校验**（`execution/tools.js:44-49`），比扩展面那条安全。但 pi **不会**改写转录里那条 assistant `toolCall`（`applyBeforeToolDecision` 保留 `prepared.toolCall`），所以「模型说的」和「实际跑的」在收据上分叉——这正是 `laneHost.mts:390` 拒绝它的理由。
   - 路二 `steer()` — 语义是「下一次模型请求前插话」，**承载不了**「这一次调用改参数后继续」：steer 在钩子等待期不会被 drain，改完还得等模型重发一次工具调用，中间的封印/授权全部作废。
   - 结论：**item ② 走 `generation.revise`（域内改候选→重新封印→重新出卡）是对的**，理由不是 pi 缺能力，而是 Nomi 的收据/合同哈希是领域约束（见 §3）。
3. **(c) 权限扩展：`pi-permission-system` / `pi-permissions` 借不了代码，只借形状。** 它们写在 `ExtensionAPI` 上（`on('tool_call')` + `ui.confirm`），我们这条 lane 没装扩展运行时，装不进；而且它们的 `allow/ask/deny` 是**按工具名/路径通配**的策略表，我们的判据是**能力契约上的 `effect`/`effectClass`**（P4：档案声明槽）。可借的只有两点：① 「path deny 不能被 per-tool allow 覆盖」这种**交叉面否决优先**的形状；② 把被拒工具**从系统提示词里也摘掉**（避免模型反复撞墙）。

---

## §2 同行对照表

| 产品 | **A 卡上能改参数再放行吗** | **B 渲染在哪 / 有超时吗** | **C 全自动怎么开 / 提醒 / 永不自动批的动作** |
|---|---|---|---|
| **Claude Code** | **界面上不能改参数。**唯一可写的是 Tab 打开的 comment 字段，且**只有 Yes/No 两档能附**，「整场会话允许」「保存规则」两档不给（<https://code.claude.com/docs/en/permissions>）。**能改参数的只有程序化的 PreToolUse 钩子** `hookSpecificOutput.updatedInput`，文档明写「修改后的输入会展示给用户」（<https://code.claude.com/docs/en/hooks>） | CLI 转录内联 prompt（VS Code 为模式指示器旁）。**权限弹窗永不 idle 自动收尾**——原话 "Permission prompts (including plan approval) never auto-resolve on idle"；只有 `AskUserQuestion` 有可选 `askUserQuestionTimeout`（60s/5m/10m）（<https://code.claude.com/docs/en/tools-reference>） | 六档 `default(Manual)/acceptEdits/plan/auto/dontAsk/bypassPermissions`，`Shift+Tab` 循环，状态栏常驻 `⏵⏵ bypass permissions on` 等。**危险档不进默认循环**，须 `--permission-mode` / `defaultMode` 显式启用；首次启用弹「承担责任」对话框、接受写进 user settings 只弹一次、拒绝即退出；root/sudo 下拒绝启动。**任何档都不自动批**：显式 ask 规则、组织设为 ask 的 connector 工具、`AskUserQuestion` 与 `requiresUserInteraction` 的 MCP 工具、指向 critical path 的 `rm`/`rmdir`、cross-session messaging 保护（<https://code.claude.com/docs/en/permission-modes>） |
| **Codex CLI** | **不能。**固定 5 个选项，无编辑项：`Yes, proceed` / `Yes, and don't ask again for commands that start with <prefix>` / `…for this command in this session` / `No, continue without running it` / **`No, and tell Codex what to do differently`**（<https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/approval_overlay.rs>）。改参数的正规路径＝拒绝并口头说 | CLI 是 **bottom pane 的 modal overlay**（同上源码注释）；桌面/IDE 的模式选择器在 composer 下方（<https://learn.chatgpt.com/docs/permission-modes>）。**人工审批无超时**；只有转交 reviewer agent 的 auto-review 有超时，且**超时后动作仍然不跑**（fail-closed，<https://learn.chatgpt.com/docs/sandboxing/auto-review>） | 两轴：`approval_policy` = `on-request \| never \| {granular={sandbox_approval, rules, mcp_elicitations, request_permissions, skill_approval}}`（**`untrusted` 已 retired、`on-failure` 已 deprecated**）× `sandbox_mode` = `read-only \| workspace-write \| danger-full-access`（<https://learn.chatgpt.com/docs/config-file/config-reference>）。sandbox=技术边界、approval=何时停下来问；沙箱内直接跑，越界才问。全放开 `--dangerously-bypass-approvals-and-sandbox`（`--yolo`），组合表上挂 ElevatedRiskBadge + `No sandbox; no approvals (not recommended)`，`codex exec --full-auto` 已废弃且调用打 warning。**永不自动批**：destructive 注解的 app/MCP 工具；`.git`/`.agents`/`.codex` 在 workspace-write 下**递归只读、配置也改不动**（<https://learn.chatgpt.com/docs/agent-approvals-security>）。企业 `requirements.toml` 的 `allowed_approval_policies`/`allowed_sandbox_modes` 可禁掉 never 与 danger-full-access |
| **Cursor Agent** | **未查到**任何「批准前编辑命令/编辑 diff」的一手记载。CLI 只有二元 y/n（<https://cursor.com/docs/cli/using>）。改行为走**事后配置**：`permissions.json` 的 `allow_instructions`/`block_instructions`，或 CLI `permissions.allow/deny` 的 `Shell()/Read()/Write()/WebFetch()/Mcp()` token（<https://cursor.com/docs/agent/security/run-modes>） | 渲染位置**未查到**明确一手描述（设置在 Settings > Agents > Approvals & Execution）；CLI 为终端内行内 y/n。**超时未查到**。可对照：Ask-questions 期间 agent 不空转，继续读文件/改动/跑命令，答案到了再并入（<https://cursor.com/docs/agent/overview>） | 三档 `Auto-review`（默认）/ `Allowlist` / `Run Everything`；`/run-everything`、`-f/--force`（`--yolo`）。文档定性 **run modes 是 "best-effort guardrails rather than a hard security boundary"**、auto-review "is not a security boundary"（<https://cursor.com/docs/agent/security>）。**未查到**开着时的常驻横幅。**永不自动批**：Browser Protection、File-Deletion Protection（含 `rm`）、External-File Protection（工作区外增删改）——原文 "can require approval even when a mode would otherwise run automatically"；`deny` 恒压过 `allow` |
| **Cline** | **唯一一家能在批准前改。**文件编辑打开原生 diff editor，README 原话 "every edit shows up as a diff you can **review, modify, or revert**"；手改后保存＝批准，**不再二次请求批准**，改动作为 `userEdits` 回灌模型（<https://github.com/cline/cline>、<https://github.com/cline/cline/pull/2293/files>）。终端命令能否在卡上改写 **未查到** | 对话流**内联**卡片（路径 + 绿色新增行 + ✓/✗），diff 另开编辑器。**无超时**；只有「auto-approved 命令跑满 30 秒发 OS 通知」（<https://docs.cline.bot/features/auto-approve>） | 逐项 toggle 的 Auto Approve 内联菜单（v3.35 起默认常开，**删掉了主开关 / max requests 上限**）；提醒＝折叠条上显示已开档位 + OS 通知；命令类不是白名单，由模型给每条命令打 `requires_approval`。**没有任何一类是永不可自动批准**——YOLO Mode 可全开（含 Plan→Act 转换）（<https://cline.bot/blog/cline-v3-35>） |
| **MCP elicitation / tool annotations** | **协议里没有「改参数后批准」这个概念。**elicitation 是服务端向用户**要数据**，规范只要求 Applications SHOULD 让用户 "review and **modify their responses** before sending"（改的是自己的回答）；tools 侧只有 Clients SHOULD "Show tool inputs to the user before calling the server"（<https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation>、<https://modelcontextprotocol.io/specification/2025-06-18/server/tools>） | 规范**明确不规定 UI**："the protocol itself does not mandate any specific user interaction model"；elicitation 可**嵌套**在其它调用中间。规范**无 elicitation 超时**；tools 侧只说 Clients SHOULD 为工具调用实现超时 | 无 auto-approve 概念；Clients SHOULD 实现用户批准控制 + 限流。硬禁区：Servers **MUST NOT** 用 elicitation 索取**敏感信息**；tools SHOULD 始终有人在环且能拒绝；annotations **MUST** 当作不可信除非来自受信服务端。三动作 `accept / decline / cancel` 语义不同、服务端须分别处理 |
| **Claude Desktop / Claude.ai connector** | **未查到**可编辑工具输入 | 未查到逐字 UI 描述 | 三档 **Manually approve / Automatically approve / Skip all approvals**；`Allow always` 一手文档只警告「只在信任该 server 且工具无人监督运行时才点」；Cowork 组织开关 **"Allow 'Always allow' for connector tools"** 默认 off，off 时 "Allow for all tasks" 置灰、每个 task 重新批；企业侧每工具三档 Always allow / Needs approval / Blocked（<https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp>、<https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans>） |

**三条横向结论**：
1. **（A）六家里只有 Cline 允许「改了再放行」，而且它改完不再问。** 其余五家一律把修改权还给模型（Codex 的 `No, and tell Codex what to do differently`、Claude Code 的 comment 字段、Cursor 的 `block_instructions`）。**没有任何一家做「改完重新出卡」**——Nomi 的 revise 是行业里更严的一档，理由必须是钱（收据=实际执行、合同哈希），不能说成「照同行做」。
2. **（B）审批弹窗一律内联/贴底、一律不设 idle 超时。**唯一的超时先例是 Codex 把审批转交给 reviewer agent 时，而且**超时＝动作不跑**（fail-closed）。
3. **（C）「永不自动批」写成显式清单的只有 Claude Code 和 Codex；Cursor 是三条 Protection，Cline 干脆没有。**并且三家一致地把「审批」和「边界」分开：Codex 靠沙箱 + 递归只读路径，Cursor 明说 run modes 不是安全边界。Nomi 的对应物是**能力契约的 `effect`/`effectClass`**——它才是边界，档位只是「问不问」。

---

## §3 三个实施项的硬约束（任务书照抄）

### ① 付费确认卡进介入槽

| # | 硬约束 | 依据 | 性质 |
|---|---|---|---|
| 1-1 | 卡渲染在**转录内联的介入槽**，不弹模态；同时最多一张，多余的用「还有 N 条」（现役 `pendingCount`） | 全行业一致（Claude Code / Codex / Cline 都内联）；`laneApprovalGate.ts:139-144` | 照同行 |
| 1-2 | **等待不设超时**，永不 idle 自动放行或自动拒绝 | Claude Code 明写 "Permission prompts (including plan approval) never auto-resolve on idle"（`code.claude.com/docs/en/tools-reference`）；我方同结论已在 `laneApprovalGate.ts:266-268` | 照同行 |
| 1-3 | 付费卡**没有「不再问」**：`grantable` 恒 false。门槛与现役逐字一致，不加宽 | `capabilityApprovalPolicy.ts:99-109`、`laneContracts.ts:437-441`；Claude Code「只在能把授权范围完整展示时才给 don't-ask-again」同源 | 照同行 |
| 1-4 | 卡上必须出现的四件事：**模型 · 比例 · 价格 · 两个动作**。价格不是标签而是**数字**，且必须来自**已封印合同的报价**，不是渲染层现算 | 用户 09-09 拍板「每次提交看报价确认」（memory `money-gate-per-submit-no-budget-setting`）；现役 `badgeOf()` 只给静态「付费」二字（`agentPanelV4Intervention.ts:186`） | **Nomi 领域约束** |
| 1-5 | 新增的报价/模型/比例字段走**宿主投影**，不由渲染层从 `args` 反推；渲染层不铸造任何授权凭据 | `laneContracts.ts:425-430`（"必须由宿主投影"）、`laneApprovalGate.ts:212-214`（#546 V10） | **Nomi 领域约束** |
| 1-6 | 「不要」保留**渐进披露的拒绝理由**，用户那句话一字不改进 tool result | `laneApprovalGate.ts:199-208`；同行 `pi-permission-system` 也有 "Reject with Reason" | 照同行 |

### ② 卡上改参数 = `generation.revise`

| # | 硬约束 | 依据 | 性质 |
|---|---|---|---|
| 2-1 | **禁止**用 `before_tool` 的 `{ args }` 返回值实现「改了直接跑」。改参数必须重新出卡 | `laneHost.mts:388-391` 的既有裁决；框架侧确实能做（`execution/tools.js:36-54` 会重新校验），但 pi **不改写转录里那条 assistant `toolCall`**，收据与实际执行会分叉 | **Nomi 领域约束**（收据=实际执行） |
| 2-2 | `generation.revise` 必须**逐字复刻** `trial_narrow` 的五个动作：① 校验 gate 仍是 `waiting`（未决才可改）② 校验没有 job 越过 `authorization_required` ③ 把该 gate 置 `revoked` ④ 删掉挂在旧 `authorizationDigest` 上的 jobs ⑤ 清空 `sealedContractHash` / `contract` / `planHash` / `authorization*` / `costCertainty` 并回 `state: "draft"` | `productionRunReducer.ts:358-417` | 同族先例 |
| 2-3 | `commandId` 必须带 `planVersion`（`generation.revise:<op>:v<n>`），`expectedRevision` 必须传——改参数是可重放的用户动作，幂等键不能只用 operationId | `productionGenerationOperationStore.ts:122-134` | 同族先例 |
| 2-4 | 改完**不复用旧授权**：走正常 prepare → seal → gate 生成**新的** digest，再出一张新卡 | 同 2-2 注释原文 | **Nomi 领域约束**（合同哈希） |
| 2-5 | 触发口在**主进程 authority 回调**（`onTrialFirst` 那种形状），不是渲染层直写 store | `appIntegration.ts:171-176` | 同族先例 |
| 2-6 | 旧卡在 revise 提交那一刻必须**先收尾**（等待中的 promise 以一个明确 decision settle），不能悬着——否则 `waiting` 里会同时挂两张 | `laneApprovalGate.ts:179-186`、`122-129`（「记录只认第一次」） | **Nomi 领域约束** |
| 2-7 | 同行没有一家做到「卡上改参数 + 重新计价 + 重新封印」。**能编程改参数的只有 Claude Code 的 PreToolUse `updatedInput`**，且它明确「修改后的输入会展示给用户」——即同行也认「改了必须让用户看见」 | `code.claude.com/docs/en/hooks` | 照同行的**原则**、自造的**机制** |

### ③ 权限三档 step / 自动 / 自主

| # | 硬约束 | 依据 | 性质 |
|---|---|---|---|
| 3-1 | 三档是**基线**，硬清单独立于档位：花钱 / 不可逆 / 外部 `destructiveHint` / 解不出效果类 / 逐次计划审阅——**任何档位下都逐次问**，自主档也不例外 | `capabilityApprovalPolicy.ts:95-109`；Claude Code 有等价的 "Actions no mode auto-approves"（含 `AskUserQuestion`、`requiresUserInteraction` MCP 工具、critical-path `rm`），并明写连 `bypassPermissions` 也不例外 | 照同行 |
| 3-2 | 「自主」**不等于** bypass：它只免掉 `reversible_local` 的逐次确认。**付费仍必问**，这是 Nomi 与所有同行的最大差异（同行没有一家有钱这条轴） | 用户拍板；`capabilityMayReuseSafeApproval()` 现役语义 | **Nomi 领域约束** |
| 3-3 | **切入自主档要二次确认**，且**一次性、可记住**——不是每次进都弹 | Claude Code：首次启用 `bypassPermissions` 弹「承担责任」对话框，接受写进 user settings，只弹一次；拒绝则退出 | 照同行 |
| 3-4 | **常驻提醒**：自主档必须在输入区旁有一个持续可见的状态标记，不是一次性 toast | Claude Code 状态栏 `⏵⏵ bypass permissions on` / `⏵⏵ auto mode on`，`⏸ manual mode on` | 照同行 |
| 3-5 | 三档要有**一个键在档间循环**（对应 Shift+Tab），且**危险档不进默认循环**——必须显式启用后才出现在循环里 | Claude Code：`bypassPermissions` 只在 `--permission-mode`/`defaultMode`/`--allow-…` 启用后才进循环；`dontAsk` 永不进循环 | 照同行 |
| 3-6 | 现役 `mode: step / safe-auto / project` × `spend: confirm / within-budget` 两轴收敛成三档时，**`spend` 轴不能被折进档位**（否则「自主」会顺手把付费也放行）。收敛动作是：`project` → 自主、`safe-auto` → 自动、`step` → step，`spend` 保持独立且在自主档下强制 `confirm` | `capabilityApprovalPolicy.ts:36-52`（注释已写明两轴"kept independent deliberately"） | **Nomi 领域约束** |
| 3-7 | 档位改名/收敛必须 **P1 加新必删旧**：`PROJECT_AGENT_APPROVAL_MODES` 是唯一 owner，落盘旧值要迁移不要双读；`check:vocabularies` 会盯这张词表 | CLAUDE.md R1/R14.1 | Nomi 工程纪律 |
| 3-8 | 「不再问」的作用域是**这一个能力**，不是抬全局档 | `AgentPanelV4Cards.tsx:196-201`（早先抬全局档那版已删）；Claude Code 同源约束「只在能展示全部授权范围时才提供该选项」 | 照同行 |
| 3-9 | 没有 UI 可问的 lane（MCP stdio / 走查 / 后台批）在任何档位下都 **fail-closed**，不静默放行 | `laneApproval.ts:116-119` | **Nomi 领域约束** |

---

## §4 「没想到」清单（原方案没考虑的点）

1. **付费卡上的价格没有数据通道。** `LanePendingApproval` 只有 `toolCallId/toolName/args/effectClass/grantable/pendingCount`（`laneContracts.ts:431-444`），`V4InterventionSource` 更窄（`laneViewModel.ts:146-153`）。报价住在 ProductionRun 域的 `authorizationEnvelope` / `costCertainty` 里。**item ① 的第一步不是画卡，是补一条「按 operationId join 报价」的宿主投影**——否则只能拿 `args` 反推价格，那是渲染层现算，违反 1-5。
2. **「调整」要打开的「现有完整弹窗」在仓库里不存在。** Agent 面板侧没有生成参数模态；完整参数面是画布节点上的 `NodeParameterControls.tsx` / `InlineParameterBar.tsx`。而 `laneHost.mts:355-364` 有一条 **surface_authority** 规则：`destructive` + `renderer_required` 的能力若当前 target 面不匹配就 block，并且注释明写「approval cannot grant another surface」。**「调整」跳到画布面这条路要先确认它不会撞上这条闸**，或者「调整」就得在面板内长出一个参数编辑态（那才是 item ② 的真正 UI 落点）。
3. **`spend` kind 今天不产出 `alternateLabel`。** `projectV4Intervention()` 只给 `credential` 档配了 alternate（`agentPanelV4Intervention.ts:155`）。item ① 的 `[调整]` 需要给 `spend` 档补 label + `onAlternate` 目标，且要过 i18n 门岗（R15）。
4. **pi 的 `{ args }` 会重新校验，但不会重写转录里的 assistant toolCall。** 这是 `laneHost.mts:390` 那条禁令的**技术理由**，之前只写了产品理由。写进任务书能防止实施者「发现框架支持就改用它」。反过来说：如果哪天要做「宿主静默规范化参数」（比如把用户输入的比例归一），`{ args }` 是可用的，只是必须同时把规范化结果印在收据上。
5. **pi 扩展面（`ExtensionAPI.on('tool_call')`）的就地改参数是不校验的**——`types.d.ts:713-718` 明写 "No re-validation is performed after mutation"。任何从社区 pi 扩展（`pi-permission-system` 等）抄代码的做法都会把这个洞抄进来。我们走 harness 的 `before_tool` 反而更安全，**这一点要写进任务书当作「不要抄那边」的理由**。
6. **`restoredToolCallIds` 与 revise 的交互没定义。** 崩溃重启后停在预检里的调用一律取消（`laneApprovalGate.ts:68-76、237-242`）。如果 revise 正在飞的时候崩了，域里已经 `revoked` 旧 gate、回到 `draft`，而 lane 侧的卡被取消——**用户重开后会看到一个「计划回到草稿但没人在等他」的中间态**。任务书要指定这个交叉态的收尾（建议：revise 提交前先 settle 旧卡，见 2-6，并让 `draft` 态在面板上可见）。
7. **并行工具批次下会同时有多张卡。** `currentPending()` 只投影第一张（`laneApprovalGate.ts:139-144`）。付费动作若被模型并行发两条，第二张的报价在第一张 revise 之后可能已失效。任务书要么写死「付费能力强制 `sequential`」，要么定义「revise 使同批次其余付费卡一并失效」。
8. **自主档的「常驻提醒」在 Nomi 没有 Claude Code 那样的状态栏。** 三档选择器今天是模式弹层里的一项。照 3-4 做需要在 composer 旁长出一个常驻标记——这是**用户可见 UI 改动**，按 P5/R8 要先出样张再实施，不能夹在权限逻辑 PR 里顺手做。
9. **Claude Code 的「不能从未启用的会话中途进入 bypass」值得抄一半。** 我们的档位是**项目级持久设置**，用户在等待期改档位是允许的（`laneApprovalGate.ts:60`）。要小心一个组合：一张付费卡在等，用户此刻切到自主档——按 3-1 付费仍必问，卡不该被自动放行。**任务书要有一条测试钉死这个时序。**
10. **Codex 的 `approval_policy` 枚举已经换了一代。**`untrusted` 已 retired（设了直接启动失败）、`on-failure` 已 deprecated，现役是 `on-request | never | {granular = {sandbox_approval, rules, mcp_elicitations, request_permissions, skill_approval}}`。**方向是「按面拆成一组独立开关」，不是「一条越来越松的梯子」**——这正好佐证 3-6（`spend` 必须留成独立轴），也提醒任何引用 Codex 的方案文档不要抄旧四值。
11. **「不再问」的记忆分级我们只有一级。**Claude Code 分两级：Bash 命令 / WebFetch 域名的批准**永久落盘**到 repo 的 `.claude/settings.local.json`，而**文件修改的批准只到会话结束、不落盘**。我们全部是内存 `Set`、关 app 即忘（`laneApprovalGate.ts:117-118`）。**这是一个方案里没提的岔路**：`reversible_local` 的「本会话允许」要不要升级成项目级持久？不做也行，但要在任务书里写明是有意的，别让实施者顺手加持久化。
12. **「审批」和「边界」是两件事，三家同行都分开了。**Codex 靠沙箱 + `.git/.agents/.codex` 递归只读，Cursor 明说 run modes "is not a hard security boundary"。**Nomi 没有沙箱能拦住付费**——边界只有「已封印合同 + gate」。所以自主档**绝不能实现成「跳过 gate」**，只能实现成「`reversible_local` 不弹卡」。任务书要把这句写成禁令。
13. **Cline 的先例说明「改了直接放行、不再问」对可撤销编辑是可接受的。**这提示 item ② 的范围要**收窄**：`generation.revise` 只服务 `spend`；对 `reversible_local` 的工具，将来若做「卡上改」，可以走 pi 的 `{ args }`（框架会重新校验）而不必重新出卡。**别把 revise 泛化成所有工具的通用改参路径。**
14. **如果将来给任何 lane 加超时，必须 fail-closed。**Codex 的 auto-review 是唯一有超时的审批先例，而它超时后**动作仍然不跑**。我们的 `hasUserInterface=false` 已经是同一姿势（`laneApproval.ts:116-119`），保持一致即可；但 `askUserQuestionTimeout` 那种「超时后按已选项提交」的做法**不可用于付费卡**。
15. **`describe()` 的三句话文案要跟着三档改名走**（`laneApprovalGate.ts:190-195`），它是模型看到的能力说明，不是 UI 文案——改档位名不改它，模型对「会不会被拦」的预期就错了。
