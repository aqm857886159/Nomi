# 接模型工具面 · 真实模型跑分（R30）

> 2026-09-11 / PR #754 / 分支 `feat/mcp-onboarding-tool-face-20260911`
> 夹具与打分器：`scripts/tool-face-bank/`，题库 `tests/fixtures/tool-selection/2026-09-11-onboarding-bank.json`（30 句）。

## 怎么量的

模型看到的工具定义**逐字节来自生产代码**（`dump-tools.ts` 直接 import `MODEL_ONBOARDING_TOOLS`），不是手抄的近似。
探针 MCP server（`probe-server.mjs`）只广播工具、只记录调用，**什么都不执行**——
要量的是「这份工具面好不好读」，让真实 CLI 连真 app 会把它和「后端好不好用」混成一个数。
探针回的信封故意**不**代表成功：`unverified` 里一直留着 `model_produces_output`，
会谎称「接好了」的探针只会把分数刷高。每个 case 按它的 `S11.x` 状态铺一个对得上的初始世界。

## 结果

| 司机 | 工具面 | **入参一次写对率** | 一次都没调工具 | 首跳选对（严格 / 不计开头的读） |
|---|---|---|---|---|
| DeepSeek (`deepseek-chat`) | **新 · 4 工具** | **62/62 = 100%** | 1/30 | 14/30 · 24/30 |
| Codex CLI 0.153.4 | **新 · 4 工具** | **71/71 = 100%** | **0/30** | 14/30 · 27/30 |
| DeepSeek (`deepseek-chat`) | 旧 · 6-action（阳性对照） | 9/14 = **64.3%** | 17/30 | 8/30 · 8/30 |
| Codex CLI 0.153.4 | 旧 · 6-action（阳性对照） | 18/31 = **58.1%** | 10/30 | 11/30 · 11/30 |
| Claude Code CLI 2.1.263 | — | **没跑成**（周额度用尽） | — | — |

**R30 判据（入参一次写对率 ≥90%，基线 62%）：两个能跑的司机、在新面上都是 100%。**

两臂两司机一起看才是重点：

- **新面：100% / 100%**（DeepSeek 62 次调用、Codex 71 次，合计 133 次，一次没写错）。
- **旧面：64.3% / 58.1%**，**把 09-10 记录的 62% 夹在中间**。
- 「一次都没调工具」：新面 1/30 与 **0/30**，旧面 17/30 与 10/30。

### 作废的那一版 Codex 读数（留着，因为它是怎么错的比结果更值钱）

第一版量出「新面 31/31、旧面 30 个 case 一个工具都没调」。**两个数都不作数**，两处仪器问题：

1. **环境不干净。** 用户全局 `~/.codex/config.toml` 里挂着一个真的 `nomi` MCP server
   （指向 `/Applications/Nomi.app`，跑的是 main 上的旧面）。于是 Codex 同时看到探针和真 app，
   工具名还撞车；日志里能直接看到 `mcp: nomi/nomi_list_models started`。
   只有走探针的调用被记了下来，分母不可信。
   现在 harness 自己造一个隔离的 `CODEX_HOME`：抄用户的 model/provider 与 auth，
   但 `[mcp_servers]` 是空表，探针由命令行注入——既不动用户的配置，也没有第二个 server 混进来。
   **隔离后同一批 case 从 31 次调用变成 71 次**，污染当时压掉了一半以上的调用。
2. **审批策略把两臂的差别变成了「谁标了 annotation」。** 旧的 `nomi_integration` 不带任何
   MCP annotation，新面的读工具带 `readOnlyHint`；配上 `approval_policy="never"`，
   旧面每一跳都撞 `MCP tool call requires approval, but approval policy is never` 而 fail-closed。
   那个 0/30 量的是我自己的沙箱配置，不是「模型读不懂旧面」。
   现在两臂一律绕过审批（探针什么都不执行）。隔离重跑后旧面是 10/30 没调工具，不是 30/30。

## 阳性对照臂说明了什么

没有阳性对照的绿灯不作数（`docs/lessons/race-repro-needs-positive-control`）。
对照臂用的是**真的旧面**：本分支已经删掉那两个文件（P1），所以 `dump-legacy.sh` 从 `origin/main`
原样取出 `MCP_INTEGRATION_TOOL` / `MCP_INTEGRATION_MANAGEMENT_TOOL` 再发布给同一个探针——
不是手抄的近似。旧面那一臂的「一次写对」按**运行时**必填算，因为模型看得到的只有
`advertisedRequired`（几乎永远只有 `action`），真正会抛的是 `runtimeRequired`，
这条缝正是 62% 的来源。

**两个司机对旧面的读数是 64.3% 和 58.1%，把 2026-09-10 记录的 62% 夹在中间**
（`docs/fixes/2026-09-11-mcp-onboarding-defects.root-cause.json:5`，Codex + 真实 DeepSeek key，36/58）。
换了模型、换了天、同一个旧面，三次读数落在 58–65% 这个带子里 —— 尺子是准的，
所以新面那两个 100% 作数。

最刺眼的那一列不是写对率，是**「一次都没调工具」**：旧面 17/30 与 10/30，
新面 1/30 与 **0/30**。旧面上有三分之一到一半的用户意图，模型连试都没试。

## 一个数把 payload 棘轮讲清楚

| | 旧 `nomi_integration` | 新 `nomi_model_setup` |
|---|---|---|
| 描述字节 | **241 B** | 6700 B |
| 管几个动作 | 6 | 6 |
| 广播的必填 | `["action"]` | `["action"]` + 逐 action 真实清单写进 `action` 的描述 |
| 运行时真正会抛的字段 | 5 个（`advertisedRequired` 之外） | 与描述一字不差 |

241 字节去管 6 个动作，且广播的必填是假的——这就是 62%。
棘轮涨的那 10 KB 买的是这张表右边那一列，也就是 R30 在量的东西。

## 仪器自己出过的三次错（都记下来，因为它们长得和产品结论一模一样）

`docs/lessons/harness-catch-launders-bugs-into-verdicts` 说的就是这件事。本轮踩了三次：

1. **DeepSeek 臂只发一轮请求**，不把工具结果喂回去，于是每条链长度恒为 1，
   「读完一眼就停」被记成「没选对」。改成真多回合。
2. **30 个 case 共用一个世界**，`nomi_list_models` 永远报「已经有一个 setup 在等你贴 key」，
   模型很合理地停下来让用户去贴。改成按 case 的 `S11.x` 铺世界。
3. **Codex 环境不干净 + 审批策略混杂**（见上）。

三次的共同形状：**读数看起来完全像一个产品结论**，而且都是对新面不利或对旧面过分不利的方向。
所以「量到一个很戏剧性的数」之后的第一件事永远是先证明仪器没坏。

## 还没跑成的那一臂（不遮）

**Claude Code CLI 跑不了**：本机 CLI 周额度已用尽，`You've hit your weekly limit · resets Sep 14 at 9am (Asia/Shanghai)`。
这是环境限制，不是读数。没有拿别的模型冒充这一臂，也没有把它从表里去掉。
额度恢复后跑：`node scripts/tool-face-bank/run.mjs --driver claude --out docs/evidence/2026-09-11-tool-face/claude-code.json`

## 首跳选对率为什么低，以及它是不是问题

严格读数把「先调 `nomi_list_models` 看一眼」记成走错。但 `nomi_list_models` 的描述里**明写**
「Use it when: Before every other call here」——模型照做，然后被扣分。
所以两个数都报，差值本身就是发现：**声明怎么说**和**题库怎么期望**目前对不上。

- 题库的 `expectedCallSequence` 在 S11.1（10 句）上期望直接 `connect_provider`，不先读；
- 工具描述叫模型先读。

零额度 loopback 量不到这条缝，因为它的司机照 `expectedCallSequence` 走、不读描述。
**这是本轮真实模型臂最值钱的产出**，登记为待裁决：要么放宽题库（读一眼是对的），
要么收窄 `nomi_list_models` 的 `useWhen`（只在需要 id 时才先读）。两边都有道理，不自己挑。

## 真实模型臂改掉的三个缺陷

跑之前它们全在，零额度 loopback 全绿：

1. **`declarations.ts:170`**「If you do not know the base URL, ask the user」——
   但 `baseUrl` 根本不是必填（`connect_provider` 只要 `kind + name`）。
   模型把它读成「没有 baseUrl 就别调」，10 句 connect 里 8 句停下来问人——
   那正是 R30 要求为 0 的**人工干预**。改成约束字段而不是约束调用。
2. **`declarations.ts:278`** 条件必填的 `whenText` 渲染成
   「check_connection requires no other required field; when always — give either vendorKey or setupId, also vendorKey」，
   既不通顺又自相矛盾。「二选一」不是「当 X 时还要 Y」这个机制能表达的东西。
3. **`dispatch.ts` `chooseModels` 收下编出来的 `modelKey`**（见 PR 正文）——
   工具描述写着「Never invent a modelKey」，运行时却不拦，描述就是一句空话。

前两条是**只有真实模型会踩**的：确定性司机不读描述，所以读不出「描述把模型劝退了」。
