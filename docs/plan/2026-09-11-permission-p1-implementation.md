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

1. ~~**卡上改参数不会当场刷新价格。**~~ **2026-09-11 已由 P1.1b 修掉**（见下「P1.1b」一节）：
   根因是卡体直接绑着画布节点，双向同步没有稳定点；把编辑意图摘进卡自己的账本之后，
   投影链恢复单向，价格用**同一条算式**在本地当场重算。下面这段保留为当时的判断记录。
   改动在**按下确认那一刻**才写进 durable 候选，所以价格行在按下去之前
   仍是旧的（按钮上印的数同理）。
   **为什么不做成实时**：画布节点是候选的**投影**，落地链在候选每前进一版时都会按候选重画它一次。
   实时同步等于同时开着「节点写候选」和「候选写节点」两个方向——实测里它把计划连推三版，
   最后停在参数面板的默认值上，用户看到的是「改了又弹回去」。双向同步没有稳定点，这不是调防抖能修的。
   正解是让那条投影链变成**单向**（候选是唯一意图，节点只读它、编辑走命令），那是分镜/画布共用的一刀，
   不该夹在这个 PR 里顺手做。在那之前，确认前那一次 `generation.revise` 保住了真正要紧的那条不变量：
   **封印的就是卡上此刻这一份**。
2. **价格算式印的是「N 镜」，不是「N 镜 × 3s · ¥0.10/秒」。** 样张上那句是实验室报价桩；
   目录里的真价目是「基价 + 命中的规格加价」，根本没有「每秒单价」这个数。印它就是编一个不存在的算法。
3. ~~**R30 数字没产出**~~ **2026-09-11 已由 P1.1b 产出**：22 句真实说法（`tests/ux/agent-spend-r30-cases.mjs`）
   两档各跑一遍（零额度 loopback + DeepSeek 真实模型），数字见 P1.1b 的 PR 正文。
4. **切「全自动」的二次确认与常驻提醒没有单测**：仓库没有 `@testing-library/react`，钩子层测不了；
   它们由走查③覆盖。
5. **多张待确认时只显示第一张，没有「还有 N 条」角标。** 投影已按 `updatedAt` 排序并返回全部，缺的只是显示。
6. **确认那条链（手势 → 收据 → 门 → start）走查里没走到底**：④ 走的是丢弃那条路。
   把它跑通需要夹具供应商真的接一次生成提交，留给下一轮的真实闭环走查。

## P1.1b · 改参数之后的那四件事（2026-09-11 用户拍板，本轮实施）

### 背后逻辑（一句话）

上一轮把付费卡接进了面板，但**卡上改一个参数之后的行为是错的**，错在两处，同一个根：
卡体直接绑着画布上那个草稿节点。于是 ① 用户还没答应花钱，画布已经被改了；
② 落地链又会按候选把节点重画回去，「节点写候选」和「候选写节点」两个方向同时开着，
每改一个参数就是一场拉锯（实测：计划连推三版、最后弹回参数默认值）——
价格因此只能等确认那一刻才更新，按钮上印着旧的数。

本轮把编辑意图从画布上**摘下来**，放进卡自己的一份账本。两个坏处一起消失：
画布在按下「生成」之前不动；投影链恢复单向，价格随时可以本地重算。

### 用户要权衡的那个核心东西

**本地那个数算不算数。** 价格必须由宿主算，这条不变；但「改完到看见价格」多一个来回，
用户就会看着一个已经不对的数按下去。裁决是：**算式收成一份**（`deriveShotPrice` 从主进程搬进
中立契约层 `electron/shared/contracts/shotPricingRule.ts`），渲染层拿**同一条算式、同一份目录价目**
当场算——不是猜。按下主按钮时主进程照旧 `generation.revise` + 重新封印出正式报价；
两者理应逐分相同，真不同时以主进程为准、卡上原地换数，**不弹第二张卡、不打断**。

### 范围

| # | 层 | 做了什么 |
|---|---|---|
| ① | 契约（新） | `electron/shared/contracts/shotPricingRule.ts`：`deriveShotPrice`（基价 + 命中的规格加价）+ `createModelPricingResolver`（vendorKey + modelKey/modelAlias 身份匹配）。**唯一一份**——`productionRun/shotPricing.ts` 与 `catalogPricingResolver.ts` 改为转出/委托（P1 删旧） |
| ② | 渲染 · 本地重算 | `spendCardEstimate.ts`：按覆写账本把整笔待确认重算成同形状的 `PendingSpendConfirm`（投影层只认识一种输入，不长第二条渲染分支）+ `priceDisagreements` 逐镜对账 |
| ③ | 渲染 · 覆写账本 | `spendCardDraft.ts`（纯函数）：两层覆写（全部层 / 逐镜层，逐镜压全部）、候选 ↔ 节点 meta 的**唯一**双向映射、确认那一刻的改稿清单 |
| ④ | 渲染 · 写入接缝 | `generationCanvas/nodes/nodeWriteAccess.ts`：composer 往哪里写成为可替换的一只手。画布宿主写 store，付费卡宿主写账本。**两个宿主同一份组件、同一条写入调用**，不按 host 分叉（分叉=并行版） |
| ⑤ | 渲染 · 接线 | `useAgentPanelSpendConfirm.ts` 改为：草稿节点 = 宿主投影 ⊕ 覆写（不入 store）；按目录预取模型行建 resolver；确认时逐镜 `generation.revise` → 读正式报价 → 原地对账 → `confirmSpend` |
| ⑥ | 渲染 · 目录价目（顺手逮到的真 bug） | `modelOptionMappers.ts` 原本把目录价格 `Math.floor` 到整数（历史「积分」假设），于是**所有低于 1 元的价格一律变成 0**：画布批量确认条印「预估约 0 金币」，而主进程按同一行算出的是 0.30。改为不取整；价格不是有限非负数时整行不给价目（诚实报「算不出」，而不是编一个 0） |
| ⑦ | 渲染 · 画布确认条 | `planCostEstimate.ts` 改用同一条算式（此前只累加基价，规格加价一分不进这个数 → 比真正要扣的少报）。`src/config/models.ts` 的价目类型改为转出契约层那一份 |

### 不动项

- **审批卡倒计时**与它的夹具：另一条分支（P1.1a）在做，本轮一个字不碰。
- `×N`「一次生成几个」**不参与本地重算**：durable 候选里没有「生成几个」这个字段，
  在面板宿主里它现在改不动任何东西（见下「已知缺口」）。把价格乘上去就是印一个不会发生的数。
- 画布内用户自己点「生成」的现有弹窗、免费门语义、收据链、授权信封、seal 判据。
- 参考槽的连边/断边仍直接走画布 store（那改的是画布结构，不是这一次生成的载荷）。
- 批量确认条那句「预估约 N 金币」的**措辞**：目录里那个数其实是货币金额（付费卡印的是 `CNY 0.30`），
  「金币」是历史遗留的错标。改它是用户可见文案，另走样张拍板，本轮只修「印成 0」那个谎。

### 回滚

单分支逐层可退：⑦⑥ 各是一处函数体；⑤④③② 退掉即回到「卡体直接绑画布节点」的旧行为；
① 只是搬家 + 转出，`git revert` 即可。**数据面无迁移**。

### 验收门

- 单测：`electron/shared/contracts/shotPricingRule.test.ts`（身份匹配 / 基价+加价 / 关闭档 / 非标量 / 算不出绝不落成 0）、
  `src/workbench/ai/v4/spendCardDraft.test.ts`（逐镜只改这一镜、全部改公共层、逐镜压全部且切模式不丢覆写、改回原值等于没改、确认清单）、
  `src/workbench/ai/v4/spendCardEstimate.test.ts`（改参数当场变价、换模型跟价目走、换到没配价目的模型报「算不出」、全部模式按镜合计、目录没加载时的回落、逐镜对账）。
- `pnpm run gates` 全绿。
- R13 走查：`tests/ux/agent-spend-reprice.walk.mjs`（零额度，真人式点击）。**三个时刻逐拍钉死**：
  改之前画布节点 `size=1024x1024`、卡上 `CNY 0.30`；改之后卡上 `CNY 0.50`（价格行与主按钮同一个数）
  而画布节点**仍是** `1024x1024`；按下「生成」之后画布节点才变成 `1536x1024`。
  截图 `reprice-01/02/03`（卡的样子一个像素没变，只有数字在动）。
- R30 数字（工具写对率 / 回合成功率）：零额度 loopback 夹具 + DeepSeek 便宜档真实跑，两组数写进 PR 正文。

### 已知缺口（本轮**没做**，不假装做了）

1. **`×N` 在付费卡宿主里是个改不动任何东西的控件**（本地 `useState`，卡的主按钮走 `confirmSpend`
   而不是 `confirmAndRunNodeVariants`，durable 候选也没有「生成几个」这个字段）。它是 v3 样张里
   用户点名要的那三件之一，所以本轮没有擅自摘掉；正解是让候选长出这个字段、封印时按份数计价，
   属另一单。
2. **生产提交那一段这条走查跑不到底**：这一族走查按 `NOMI_E2E_PRODUCTION_FIXTURE: '0'` 起，
   loopback 供应商没被装进生成 provider 面（实测 `confirmSpend` 回 `configured_provider`）。
   把提交链接上是 P1.1a 的活，本轮不断言一个已知跑不到的行为。
3. **正式报价与本地估算不一致时只是原地换数**，没有把这件事说给用户听（`disagreements` 已经
   结构化留在钩子上，等一个产品裁决决定要不要出声）。

### R30 两组数字（2026-09-11 跑出，话术集 `tests/ux/agent-spend-r30-cases.mjs` 22 句 · 含 2 条阴性对照）

| 档 | 工具写对率 | 回合成功率 | 落草稿率（阳性 20 句） | 模型实际按了哪些工具 |
|---|---|---|---|---|
| 零额度 loopback 夹具（进 CI 的那一档） | **22/22 (100%)** | **22/22 (100%)** | 20/20 (100%) | `nomi_generation_plan` ×20 |
| DeepSeek Chat 真实模型（便宜档，轮二＝定稿那轮） | **2/22 (9.1%)** | **2/22 (9.1%)** | 1/20 (5%) | `nomi_canvas_write` ×3 · `nomi_canvas_read` ×2 · `nomi_read` ×1（其余只回话） |
| DeepSeek Chat 真实模型（轮一，工具普查上线之前） | **2/22 (9.1%)** | **2/22 (9.1%)** | —（那一轮没量） | —（那一轮没量） |

两个数字都按**首次**调用算，重试不冲淡首错。整场一次供应商生成都没发生（`paidCalls: 0`）。

轮一那两栏**留空不是排版偷懒**：`toolRoutes` 与 `landed` 两个字段是看完轮一才加上去的
（`r30-deepseek-report-run1.json` 里根本没有这两个键）。补一个看起来合理的数进去，就是把
「我们当时没量」伪装成「我们量到了」——那正是这份文档反复在防的事。轮一能说的只有两个率
和「20 句阳性一句都没落下待确认草稿」（`drafted` 全 false），和轮二同向。

**这两行数字不是同一件事的两次测量，别那么读。** loopback 那一行量的是**我们这条链**接不接得住
（夹具照话术派发一次 `nomi_generation_plan`，链路从工具 → 候选 → 封印 → 投影 → 卡上真实金额全程真跑）；
DeepSeek 那一行量的是**真实模型面对真实说法会走哪条路**。

真实档 20 句阳性里 `nomi_generation_plan create` **一次都没被调用**（轮二的普查里它一次都不出现，
轮一的 20 句阳性 `drafted` 全 false）。模型伸手去碰的是 `nomi_canvas_write` / `nomi_canvas_read`，
而且多数句子连那一下都没有——只把「我打算这么建」写成了回话文字。所以真实档那个 9.1% 不读作
「模型写不对参数」，读作
**「模型不替用户做花钱这个决定」**——它落草稿、把钱的那一下留给人。那正是权限模型想要的分工，
不是这一轮要修的 bug；代价是：**付费确认卡这条链，真实模型自己几乎不会走到。**

**因此本轮不改任何东西来拉高这个数**（改话术集去诱导模型调 `generation_plan`，量到的就是我们的诱导
不是它的行为）。留作一条待裁决：Agent 在什么情形下该自己发起付费生成、什么情形下该只落草稿——
那是权限模型 P2「自主开关」要回答的问题，不是 P1.1b 的。

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
