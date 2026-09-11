# 权限模型重做 P1 · 付费确认卡进 Agent 面板（2026-09-11）

状态：🚧 实施完成、**未 commit** · 分支 `feat/permission-p1-spend-card-20260911`
（worktree `/Users/aoqimin/Desktop/Nomi-permission-p1`；`ponytail-review` 连续 5 次 180s 超时，
按纪律不绕 hook、停在工作树里等它恢复。诊断：同一条 review prompt 手动跑 10 行 diff 约 10s 返回
`PONYTAIL_REVIEW: PASS`，13 行的真实 staged diff 却超时——问题在 Codex 侧的响应，不在 diff 大小；
`codex --version` 0.153.4 正常、磁盘 36Gi 空闲、`report/stdout/stderr` 三个 0B 是 hook 有意丢弃流。）
（合并了 `fix/agent-draft-single-ledger-20260910` / `fix/mcp-receipt-fail-closed-20260910` / `design/spend-card-node-params-20260910`）

---

## 背后逻辑（一句话）

Agent 在面板里说「好，我来生成」，然后**什么都没发生**——草稿静静躺在 ProductionRun 里，
用户既没被问「要不要花这笔钱」，也没有任何地方可以点「开始」。他只能自己去画布上把节点一个个点开。

结构上的原因是：**模型面根本看不见付费能力**（`paidBoundary.ts`：`effect:"paid"` 的契约不投影到
内部 profile，所以 agent 自己发不起一次付费调用——这是对的），**而宿主这一侧从没长出对应的入口**。
于是「agent 建了草稿」和「这笔钱花不花」之间断了一截。

本方案把那一截接上，并且**只在一个地方接**：agent 面板的介入槽。

## 用户要权衡的那个核心东西

**改参数之后，那张已经算好价的确认卡怎么办。**

行业里六家（Claude Code / Codex / Cursor / Cline / MCP 规范 / Claude Desktop，见「先查别人」）
只有 Cline 允许「批准前改」，而它改完**不再问**。我们不能照抄：Cline 改的是可撤销的文件编辑，
我们改的是**要付钱的那份载荷**。所以 Nomi 走的是行业里更严的第三条路——**改完重新出卡**：
撤掉还没被点头的授权、重新计价、重新封印、把新的数印在同一张卡上。

代价是每改一个参数要多一个来回（价格永远落后那一下点击一拍）。
换来的是一条能被机器验的不变量：**收据 = 实际执行**。

---

## 范围

| # | 层 | 做了什么 |
|---|---|---|
| ① | 主进程 · durable | `generation.revise` 命令（`productionRunReducer.ts`）。`sealed` + 付费门 `waiting` 时逐字复刻 `trial_narrow` 的五个动作（校验门在等 → 校验没有 job 越过 `authorization_required` → 门置 `revoked` → 丢弃旧 digest 的 job → 清空封印/授权字段回 `draft`），随后把候选补丁落上去；`draft` 态直接落补丁。两条命令共用抽出来的 `applyGenerationCandidatePatch` / `revokeWaitingGenerationAuthorization` / `unsealedGenerationPlanFields`（P1：`trial_narrow` 同 commit 改为调用它们，不留两份写法） |
| ② | 主进程 · 幂等 | `productionGenerationOperationStore.revise()`，`commandId = generation.revise:<op>:v<planVersion>:<candidateRevision>:<shotId>`；改完走既有 `notifyPlanChanged` 把改动投影回画布（不新建第二条落地链） |
| ③ | 主进程 · 投影 | `productionPendingSpend.ts`：「有一笔生成在等你点头」→ 卡需要的全部事实（逐镜 prompt / 模型 / 参数 / **宿主算出来的价** / 已落地的 nodeId）。价格来自目录 `model.pricing`，渲染层不反推；算不出就是 `{known:false}`，**绝不落成 0**。只投影 `origin.host === "nomi"`（外部 MCP 宿主的用户此刻没在看这块面板） |
| ④ | 主进程 · 编排 | `appIntegrationSpendConfirm.ts`：读 / 改参数 / 丢弃 / **确认并开跑**。确认那条把「卡上这一下点击」变成主进程手势证明 → 铸收据 → `authorizeGeneration` → 一次性消费 → `start`。租约与 resident 适配器共用同一个 `leaseFor` |
| ⑤ | 通道 | 四个 IPC（`pending-spend` / `revise-spend` / `discard-spend` / `confirm-spend`），全部经 `assertTrustedSender` + 「只服务当前打开的项目」守卫；读通道回空数组而不是抛 |
| ⑥ | 渲染 · 投影 | `agentPanelSpendCard.ts`（纯函数）：宿主投影 → 介入槽 `InterventionData`（价格行 / 翻页器 / 范围切换 / 主按钮文案 / 「Nomi 选的」现算徽标） |
| ⑦ | 渲染 · 接线 | `useAgentPanelSpendConfirm.ts`：轮询宿主投影、把卡体绑到那份已落地的画布节点（`NodeGenerationComposer host="panel"`）、把节点上的改动防抖同步进 durable 候选、三个动作 |
| ⑧ | 渲染 · 面板 | 介入槽三个数据源的优先序 **钱 > 换档 > lane 工具审批**；`AgentPanelV4Panel` 新增 `slotComposer` / `composerBanner` 两个落点 |
| ⑨ | 权限三档 | `PERMISSION_POLICIES.project.spend` 由 `within-budget` 改为 `confirm`；`permissionWhy.project` 文案改成如实（zh + en）；切「全自动」二次确认卡 + 开启后 composer 上沿常驻提醒（`useAgentPanelAutoMode.ts` + 设计分支已有的 `V4AutoModeBanner`） |
| ⑩ | 单轨化（P1 加新必删旧） | appIntegration **不再**向 resident 生成适配器注入 `confirmGenerationInNomi`——那是居中弹窗的入口。「agent 代发的付费确认不会弹居中卡」因此是**结构上不可能**，不是靠没人去调它；真被走到会 fail-closed 报 `generation_approval_unavailable` |

## 不动项

- 外部 MCP 客户端的 elicitation / 倒计时（另一条分支在做）：`mcpStdioServer` / `mcpNodeLauncher` 的
  `confirmGenerationInNomi` 一字不动，`SpendConfirmDialog` 及其倒计时照旧服务那条路。
- 画布内用户自己点「生成」的现有弹窗：那是用户主动动作，不在本轮。
- 免费门（方向 / 样片 / 锚定妆照检查点 / 导出 / 发布）的决议语义。
- 收据链本身（`approvalReceipt.ts`）、授权信封、seal 的判据。
- 首次使用询问（P3）、通配规则文件——本轮明确不做。

## 回滚

单分支，逐层可退：
⑩ 退回注入 `confirmGenerationInNomi`（回到今天：agent 路径弹居中卡）；
④⑤⑦⑧ 退掉即回到「面板上没有付费卡」；
①② 是新增命令，没有调用方就是死代码，`git revert` 即可；
⑨ 改回 `within-budget` 一行。
**数据面无迁移**：`generation.revise` 只写既有字段；`PendingSpendConfirm` 是纯投影不落盘。

## 验收门

- 单测：
  - `electron/productionRun/generationRevise.test.ts`（撤门/丢 job/清封印/落补丁/planVersion；越线拒绝；门已决定拒绝；已提交拒绝；范围切换）
  - `electron/productionRun/productionPendingSpend.test.ts`（价格来自目录、规格加价、unknown 不落成 0、draft/gate 两档、origin 过滤、多镜序号、排序）
  - `electron/shared/agentCapabilities/capabilityApprovalPolicy.test.ts`（**等待中的付费卡不因切档被放行**；硬清单独立于档位；阳性对照）
  - `src/workbench/ai/v4/agentPanelSpendCard.test.ts`（不印 ¥0、标题不印金额、翻页/范围/主按钮文案、节点→候选补丁）
  - `src/workbench/ai/v4/agentPanelV4Logic.test.ts`（**三档 spend 恒 confirm**）
- `pnpm run gates` 全绿。
- 根因合同：`docs/fixes/2026-09-11-agent-paid-confirm-not-in-panel.root-cause.json`（schema-v3，`recurring`）。

## R13 走查（零额度 loopback，真人式点击）

`tests/ux/agent-spend-card.walk.mjs` —— 只有远端供应商是夹具，SDK / IPC / ProductionRun / 渲染层 / 落盘全是真的；
整场 `paidCalls: 0`、`imageRequests: 0`（一次供应商生成都没发生）。四条全绿：

| # | 证明了什么 | 截图 |
|---|---|---|
| ① | agent 说「帮我生成一张六棱柱」→ 草稿落画布（`meta.modelKey` = agent 定的那个）+ **面板介入槽出付费卡**，价格 `CNY 0.30` 由宿主按目录算出；同时断言**居中弹窗计数为 0**（单轨化的可见证据） | `01-spend-card-in-intervention-slot.png` |
| ② | 卡体就是画布节点那张生成框整件：上提示词、下一行 `[模型][参数][×N]`，参数面板真能点开 | `02-spend-card-parameters-are-editable.png` |
| ③ | 付费卡等待中切到「全自动」：先出换档确认卡 → 确认 → composer 上沿出常驻提醒 → **付费卡仍在原处等人答，价格一个字没变** | `03-spend-card-still-waiting-under-full-auto.png` |
| ④ | 按 × → durable 计划取消 + 画布上那个占位节点消失 | `04-spend-card-discarded-canvas-clean.png` |

截图目录随每次运行变（`.tmp/pi-spend-card-development-<ts>/`，不入库）。

**走查顺手逮到并当场修掉的两件**（P3：走查的价值就在这里，CI 五门一个都看不见它们）：
1. **卡标题一律写「视频」**。同一张卡也用来确认图片生成，用户在**付钱前那一刻**看到自己的图片草稿被说成视频，
   第一反应是「它是不是搞错了」。改成按候选的 `mode` 分图片/视频两句（zh + en）。
2. **落地链把用户挑过的参数按回档案默认**。`rebindLandedShots` 只带模型身份不带 `parameters`，
   于是 `buildPlannedNodeMeta` 每次重绑定都用档案 `defaultValue` 覆盖。这不是显示问题：
   **节点是候选的投影，而投影漏掉了参数**。修在最早的共享边界——`MaterializeShotCandidateWire` 带上标量参数，
   新建与重绑定两条路都喂给同一个 `buildPlannedNodeMeta`。

## 已知缺口（本轮**没做**，不假装做了）

1. ~~**卡上改参数不会当场刷新价格。**~~ **2026-09-11（P1.1b）已补上**，做法正是这里写的那条正解：
   卡不再回写画布节点，编辑落进它自己的覆写账本（`spendCardDraft.ts`），于是「候选 → 节点」变成单向，
   拉锯消失；价格由**同一条算式**在本地当场重算（算式 2026-09-11 从主进程搬进中立契约层
   `electron/shared/contracts/shotPricingRule.ts`，主进程封印与卡上重算共用一份）。
   按下主按钮时仍照旧 `generation.revise` + 重新封印出**正式报价**，两者不一致时以主进程为准、
   卡上原地换数。走查：`tests/ux/agent-spend-reprice.walk.mjs`。
   顺带修掉的一条更隐蔽的少报：渲染层此前把目录价目又归一了一次（`Math.floor` + 负数/NaN 落成 0），
   所以基价 0.3 在卡上会变成 0——**少报比不报更坏**，现在两端读的是逐字节同一份价目。
2. **价格算式印的是「N 镜」，不是「N 镜 × 3s · ¥0.10/秒」。** 样张上那句是实验室报价桩；
   目录里的真价目是「基价 + 命中的规格加价」，根本没有「每秒单价」这个数。印它就是编一个不存在的算法。
3. **R30 数字没产出**（工具写对率 / 回合成功率）。走查里模型的每一步都是夹具编排的固定回复，
   量不出真实模型的写对率；那需要一组 ≥20 句真实说法跑真模型，属另一轮。
4. **切「全自动」的二次确认与常驻提醒没有单测**：仓库没有 `@testing-library/react`，钩子层测不了；
   它们由走查③覆盖。
5. **多张待确认时只显示第一张，没有「还有 N 条」角标。** 投影已按 `updatedAt` 排序并返回全部，缺的只是显示。
6. **确认那条链（手势 → 收据 → 门 → start）在 loopback 夹具里跑不到底**——2026-09-11（P1.1b）
   第一次真的按下去，所以现在这条缺口有了**确定的原因**，不再是「没走到底」而已：

   - 现场：`tests/ux/agent-spend-reprice.walk.mjs` 按下主按钮后，`generation.revise` 确实落了
     （画布节点跟着变成新参数、主进程投影 `candidateRevision:2` 价 `0.5`），但付费卡仍停在原处等人答，
     夹具供应商零出站（三次真机运行，`imageRequests: 0`）。
   - 原因（真机探针直接问主进程拿到的返回）：
     `confirmPendingSpend` → `{ ok:false, code:"failed", message:"Provider agent-runtime-loopback
     lacks required recovery capabilities: configured_provider" }`。
     `generationProviderBootstrap.ts:99+` 只为 **`apimart` 这一个 vendorKey** 装配语义生成 provider，
     其余供应商一律 `providerReady:false / missingForSubmit:["configured_provider"]`。
     走查夹具的供应商叫 `agent-runtime-loopback`，因此这道门对它**结构上**过不去。
     **这不是付费卡那条链自己的缺陷**，而是「谁能真的提交生成」那条线只认一家的后果
     （与「用户自己接模型太难 / 官方端点不是 APIMart」是同一条主线，不在本轮范围）。
   - 连带暴露的一条，**是真缺陷**：渲染层这一侧是**静默**的——`useAgentPanelSpendConfirm` 的 `act`
     把 `ProductionActionResult` 整个吞掉（`.catch(() => undefined)`，成功失败一个样），
     所以用户看到的是「按了没反应」，连一句「没成」都没有。钱这条轴上静默失败是最不该有的默认。

   本轮（报价算式收一份 + 写入面接缝）不碰这两件，走查因此断言到「改动确实回写了」为止，不假装它通了。
   下一轮两件：① 让付费卡把失败说出来（i18n 两语）；② 走查要么把夹具供应商装成能提交的那一家，
   要么明写它证不到出站那一段。

## 先查别人

完整报告：[docs/research/2026-09-10-permission-rework-prior-art/prior-art.md](../research/2026-09-10-permission-rework-prior-art/prior-art.md)

### pi 四列表（`@earendil-works/pi-agent-core@0.85.1`，我们接的是 `AgentHarness` 不是扩展运行时）

| 它提供 | 我们用了 | 我们另写了 | 为什么 |
|---|---|---|---|
| `before_tool` = 可无限期 await 的异步审批原语（`dist/harness/agent-harness.d.ts:550-563`） | 整条闸挂在这里（`electron/agentLane/laneHost.mts:346-419`） | — | 够用，不需要二段式 API |
| `before_tool` 返回 `{ args }` 改写并**重新校验**（`dist/harness/execution/tools.js:36-54`） | **没用** | `generation.revise`（本方案①） | pi 不改写转录里那条 assistant `toolCall`，收据与实际执行会分叉（`laneHost.mts:388-391` 的既有裁决）。理由是领域约束（钱），不是偏好 |
| `steer()` / `followUp()` 两个队列 | `LaneCommand` 直通 | — | steer 语义是「下一次模型请求前插话」，承载不了「这一次调用改参数后继续」 |
| `ProjectTrustStore`（可记住的信任决定） | 没用 | 内存 `Set`（`laneApprovalGate.ts:117-118`） | 有意：付费永远逐次问，没有可记住的东西 |
| `ui.confirm/select/input` + `ui_prompt_start/end` | 没用（TUI 面的） | 介入槽 `V4Intervention` | 我们的宿主是 React 面板，不是 TUI |
| pi 本体**没有** permission mode（`allow/ask/deny` 全在社区扩展） | 没用 | `step / safe-auto / project` × `spend` 两轴 | 社区扩展写在 `ExtensionAPI.on('tool_call')` 上（**明写不重新校验**，`pi-coding-agent/dist/core/extensions/types.d.ts:713-718`）；我们这条 lane 没装扩展运行时，装不进，而且那个洞不该抄进来 |

### 六家同行的三条横向结论

1. **只有 Cline 允许「改了再放行」，而且它改完不再问**；其余五家一律把修改权还给模型
   （Codex 的 `No, and tell Codex what to do differently`、Claude Code 的 comment 字段、Cursor 的 `block_instructions`）。
   **没有任何一家做「改完重新出卡」**——Nomi 的 revise 是行业里更严的一档，理由必须是钱，不能说成「照同行做」。
2. **审批弹窗一律内联/贴底、一律不设 idle 超时。** Claude Code 原话："Permission prompts (including plan
   approval) never auto-resolve on idle"。唯一的超时先例是 Codex 把审批转交 reviewer agent 时，
   而且**超时 = 动作不跑**（fail-closed）。本方案的付费卡因此没有倒计时。
3. **「永不自动批」写成显式清单的只有 Claude Code 和 Codex**；三家一致地把「审批」和「边界」分开
   （Codex 靠沙箱 + `.git/.agents/.codex` 递归只读，Cursor 明说 run modes 不是安全边界）。
   Nomi 没有沙箱能拦住付费——边界只有「已封印合同 + gate」，所以**全自动档绝不实现成「跳过 gate」**，
   只实现成「`reversible_local` 不弹卡」。⑨ 那一行改动守的就是这条。
