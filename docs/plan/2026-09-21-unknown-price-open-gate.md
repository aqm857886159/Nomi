# 未知价开闸 —— 恢复 2026-09-10 已拍板的「暂时算不出价格 / 仍要生成」

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

- 日期：2026-09-21 ｜ 分支 `integration/core-a-salvage-20260921`（批次 A · Pass 3a）
- 用户拍板：`scratchpad/user-decisions.md`「未知价不能挡生成」「未知价 × 全自动 = 直接跑」「开闸范围 = 全部路径」
- 数门正本：`scratchpad/doormap-unknown-price.md`（18 扇）｜根因合同：`docs/fixes/2026-09-21-unknown-price-blocks-generation.root-cause.json`
- 已拍板样张：`docs/design/2026-09-10-spend-card-node-params-and-full-auto.md`（§4 第 9 张图、§7 卡点④）
- 关单：`docs/roadmap/TODO.md` T-MO-25

## 1. 底层逻辑（为什么这么改）

内置 204 个生成模型里**一个都没有 `pricing` 行**，而且没有任何 UI 能填它。于是「算不出价」不是边缘
情况，是干净装机上 100% 的默认状态。今天拒绝的理由不是「怕你乱花钱」，是**授权信封上没有一个格子
能写『不知道』**：`jobs[].price.maximum` / `budget.maximum` / `budget.ledgerCeiling` 三个字段都是裸
`number`，于是只剩两条路——写 0（谎，会被读成「这次免费」）或者不发信封（拒）。当初选了「拒」，
`assertKnownShotPrice` 就是那个选择的落点。

同一个仓库里另一条钱闸（渲染层 `spendQuote` / `spendGrant`）从来没有这么选：它给未知价留了一个
**独立的名额位** `unknownRemaining`，既不当 0 也不拒绝。所以「不当 0」和「能生成」在本仓早就同时
做到过——只是两条钱闸各答各的（R14.1 同一语义两份定义）。

这次把那个格子补上：**未知走自己的轴，不进金额比较**。补完之后，D1–D6 那一族拒绝**没有必要存在**，
它们只是类型缺口的下游补丁，同 commit 删掉（P1）。

## 2. 用户会看到什么

| 路径 | 改前 | 改后 |
|---|---|---|
| Agent 面板付费卡 | 卡上写「暂时算不出价格」、主钮「仍要生成」，**按下去必然失败**（T-MO-25） | 同一张卡，按下去**真的出图** |
| 分镜「提交执行计划」 | `generation_pricing_unknown` | 同上 |
| 外部 MCP（`nomi_request_generation_gate`）| 抛错；全批未知时 `surface:'none'` 静默不弹 | 逐镜写「价格未知」的确认文案，用户答了就跑 |
| 全自动档 | 拒 | **不弹卡、直接跑**（用户 09-21：「直接跑就行」） |
| 重拍 / 续批 | 拒 | 能跑 |
| 画布手动生成 | 本来就能 | 一个字没变（回归面） |

卡的长相、文案、按钮颜色 2026-09-10 已拍板，词条 `spendParamsUnavailable` /
`spendParamsConfirmUnknown` / `spendParamsScopeUnknown` 全部已在库里——**本次一条文案都不新造**。

## 3. 底线（不许破）

1. **绝不把未知写成或算成 0**：信封、收据、账本、卡面、MCP 文案，任何一处都不许出现代表未知的 0/¥0。
2. **已知价部分的硬上限照常**：`policy.maxSpend` / `ledgerCeiling` / `approval.maxSpend` 对已知金额
   一个字没松。混合批次里已知部分超上限**仍然被拒**。
3. **未知不计入上限、不参与金额比较**：它走独立的计数轴。
4. **信任降档（「以后 ¥X 内不再问」）仍然对未知 fail-closed**：那条闸的全部意义就是那个 X，
   `readTrustGrantBinding` 的 `costCertainty === "partial"` 拒绝保留不动。

## 4. 范围

### 改（类型层 + 它的下游）
- `electron/productionRun/productionGenerationAuthorization.ts` —— `jobs[].price.maximum: number | null`
  （null = 未知），`budget` 加 `unknownJobCount: number`（这就是那个新格子）。校验：
  `unknownJobCount` 必须等于 `price.maximum === null` 的 job 数；`budget.maximum` 只覆盖**已知**之和。
- `prepareProductionGenerationAuthorization.ts` —— 删 3 处 `assertKnownShotPrice`（首波 / 重拍 / 续批），
  已知之和与未知计数分开算；续批的「已经覆盖了」判据加上「还有未授权的未知镜」这一支。
- `productionGenerationAuthorizationState.ts` —— 三处门 `requestedSpend` 旁加 `requestedUnknownJobs`。
- `budgetLedger.ts` / `productionRunTypes.ts` —— `reserve.amount: number | null`；
  `BudgetLedgerSummary` 加 `unknownReserved: number`（未知的在途笔数），reserve 时未知不进上限比较。
- `submissionOutbox.ts` —— 删 `costCeiling === null → unknown-cost`；未知走 `amount: null` 的 reserve。
- `batchScheduleDerivation.ts:198` —— **必须同改**：`price.known ? amount : 0` 删掉，未知不进
  `addLiability`、不触发 halt，单列 `unknownDispatchCount`。
- `mcpGenerationTools.ts` —— 删 2 处 `assertKnownShotPrice`；`maximumCost: number | null`。
- `approvalReceipt.ts` / `generationDispatcher.ts` / `runOwnedGenerationGateAuthority.ts` /
  `appIntegrationAuthorities.ts` —— `reservationPreview` 与 `maximumCost` 允许 null 并带 unknown 计数。
- `mcpGateConfirmation.ts` —— **数门报告没列到的第 19 扇**：全批未知时今天直接回
  `surface:'none'`（= 外部 MCP 永远确认不了）。改成如实印「价格未知」的逐镜文案 + 一句诚实交代。
  `trustGrant` 那一支的 fail-closed 保留。
- `appIntegrationSpendConfirm.ts:347` —— 删 PR 分支加的 `|| acceptedQuote.unknownShotCount > 0`
  （它还把「价格未知」谎报成 `generation_quote_changed`）；现时性校验其余判据保留。
- `src/workbench/capability/capabilityApplyHandler.ts` —— `maximumCost` 缺席不再落成 0。
- `shotPricing.ts` —— `assertKnownShotPrice` / `GenerationPricingUnavailableError` 无剩余合法用途，删（P1）。

### 不改
- 渲染层四张卡（`agentPanelSpendCard` / `MultiShotContractSummary` / `BatchPlanOverlay` /
  `spendConfirm`）——它们一直是按「能生成」画的，本来就对。
- `spendDecidedByPolicy`：**任务书要它「加未知价这条轴」，但代码事实是加了等于多一个 owner**。
  它今天已经 `mode === "project" → true`，删掉抛点之后「全自动未知价直接跑」自动成立。
  在那里再加一个未知价参数只会让「该不该问」有第二个答案（正是它的注释明令禁止的）。
  → 按**意图**实现（全自动放行 / 其它档走卡），**不加那个参数**，理由记在这里与报告里。
- `checkSealAffordability` 的「未知计 0 进 running、仍占一个 slot」：它本来就只对**已知**求和
  （`price.known ? amount : 0` 在这里是「未知不加钱」，不是「未知是 0 元」），语义正确，只补注释。
- 信任降档、`policy.maxSpend`、已知价的全部比较。

### 顺手（单独 commit）
- `electron/productionRun/multiShotCanvasLanding.ts:69` 与 `src/workbench/capability/multiShotCanvasLanding.ts:65`
  的 `authorContentToken?: string` 已无人读写（Pass 2 收货发现的残留），删。

## 5. 回滚
每个里程碑一个 commit，按 §4 的分组倒序 revert 即可；持久化面只加字段不改旧字段语义，
旧 Run 的信封没有 `unknownJobCount` → 读作 0（= 全部已知，和旧行为一致），无需数据迁移。

## 6. 验收门
- typecheck / check:filesize / check:root-cause-contracts / check:door-map / check:vocabularies /
  check:i18n / check:boundaries / model-face / lint:ci / `test:system:focused`。
- 新测试：①未知价计划在**每条路径**都能授权并提交；②混合批次：已知部分超上限仍被拒、未知不计入；
  ③全自动未知价直接派单且账本记「未知」非 0；④卡片投影在未知时不出现任何 `0`/`¥0`。
- 真机走查（loopback 供应商 + 无 pricing 模型）：Agent 面板 / 分镜提交 / 全自动 / 重拍 / 续批 /
  画布手动，zh 逐条截图 + 至少一条 en，亲眼确认屏上没有 ¥0。

## 先查别人

> 2026-09-21 合并 ①：同上，标题里的编号让门岗看不见这一节；内容未改。
- 本仓内的既有正解：`electron/spendGrant.ts:135` `assertAndConsumeQuotedSpend` 的 `unknownRemaining`
  名额位 —— 「未知不当 0、也不拒绝」在本仓已经跑了很久的那一份实现，本次是把同一形状搬到 Run 这一侧，
  不是新发明（P1：两条钱闸从此对同一个问题给同一个答案）。
- 类根因登记：`docs/fixes/2026-09-07-absent-number-printed-as-zero.root-cause.json` —— 「用 in-band
  数值同时编码三态」，它的 `entry_points` 已经把 `deriveShotPrice` 的 `{known:false}` 列为同类正解。
- 名额是**从报价里数出来的**，不是另记一份：`electron/spendGrant.ts:67`
  （`quote.lines.filter(line => line.amount === null).length`）。Run 这一侧要补的
  `budget.unknownJobCount` 就是同一个数，同一种数法。
- 「暂时算不出价格 / 仍要生成」那句**早就在 main 上**：`src/i18n/locales/agentPanelV4.ts:393`（zh）
  与 `:800`（en）的 `spendParamsConfirmUnknown`。本次是把已拍板的那张卡真正接上，不是新写文案。
- 「把未知当 0 参与预算比较」的那一处在 `electron/productionRun/batchScheduleDerivation.ts`
  （`price.known ? amount : 0`）——同改，否则未知会以 0 元的身份混进上限比较，比拒绝更危险。
- 外部标准：这是本仓内部的授权信封形状（非对外读写的格式/协议），不落 R5⑤；
  用的是 OpenAPI/JSON Schema 里表达「缺席」的常规做法（可空字段 + 独立计数），不自造第三态编码。
