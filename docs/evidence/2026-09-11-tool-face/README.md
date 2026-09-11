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
| Codex CLI 0.153.4 | **新 · 4 工具** | **31/31 = 100%** | 3/30 | 10/30 · 12/30 |
| DeepSeek (`deepseek-chat`) | 旧 · 6-action（阳性对照） | 9/14 = **64.3%** | **17/30** | 8/30 · 8/30 |
| Claude Code CLI 2.1.263 | — | **没跑成** | — | — |

**R30 判据（入参一次写对率 ≥90%，基线 62%）：两个能跑的司机都是 100%。**

## 阳性对照臂说明了什么

没有阳性对照的绿灯不作数（`docs/lessons/race-repro-needs-positive-control`）。
对照臂用的是**真的旧面**：本分支已经删掉那两个文件（P1），所以 `dump-legacy.sh` 从 `origin/main`
原样取出 `MCP_INTEGRATION_TOOL` / `MCP_INTEGRATION_MANAGEMENT_TOOL` 再发布给同一个探针——
不是手抄的近似。旧面那一臂的「一次写对」按**运行时**必填算，因为模型看得到的只有
`advertisedRequired`（几乎永远只有 `action`），真正会抛的是 `runtimeRequired`，
这条缝正是 62% 的来源。

**对照臂读数 64.3%，独立复现了 2026-09-10 用 Codex CLI + 真实 DeepSeek key 量到的 62%**
（`docs/fixes/2026-09-11-mcp-onboarding-defects.root-cause.json:5`，36/58）。
换了模型、换了天、同一个旧面，两次读数差约 2 个百分点 —— 尺子是准的，所以新面的 100% 作数。

最刺眼的那一列不是写对率，是**「一次都没调工具」17/30**：
旧面上有一半以上的用户意图，模型连试都没试。新面是 1/30。

## 一个数把 payload 棘轮讲清楚

| | 旧 `nomi_integration` | 新 `nomi_model_setup` |
|---|---|---|
| 描述字节 | **241 B** | 6700 B |
| 管几个动作 | 6 | 6 |
| 广播的必填 | `["action"]` | `["action"]` + 逐 action 真实清单写进 `action` 的描述 |
| 运行时真正会抛的字段 | 5 个（`advertisedRequired` 之外） | 与描述一字不差 |

241 字节去管 6 个动作，且广播的必填是假的——这就是 62%。
棘轮涨的那 10 KB 买的是这张表右边那一列，也就是 R30 在量的东西。

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
