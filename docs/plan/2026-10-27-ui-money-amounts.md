# 设计卡：界面不印金额——任务中心删金额格，Agent 只转述知道的数

改动名：任务中心「制作详情」删掉四个金额格；Run 对外投影只给已知金额；ESLint 拦界面代码把金额格式化上屏
线/负责人：Mac Claude 实现线 / fix(ui-no-money-amounts)
类别：[其他]（不改花钱逻辑本身，不加长跑 / 可打断语义，不新增界面；路径启发式推出的类别见文末「功能分类」）

方向检查：`docs/engineering/direction-checks/2026-10-27-ui-money-amounts.md`

## ★1 用户怎么用

当我在任务中心展开一个制作的「详情」，或者让外部 Agent（经 MCP）读这个制作的状态时，我想看到、听到的只有 Nomi 摆得出依据的事实（阶段、技能、状态），以便不被一个没有依据的零金额误导成「这次免费」或「预算是 0」。

步骤：

1. 发起一个制作，批过付费门（批的镜头里可能有算不出价的）。
2. 在任务中心打开这张制作卡，展开「详情」。
3. 看到阶段进度、逐阶段状态、技能、更新时间，没有任何金额格（中英界面一样）。
4. 让 Agent 调 `nomi_read`（target=run）读状态。
5. 价格全部已知、而且每一笔都落定了：转述照旧带「预算上限 / 已花费」的数。
6. 批过算不出价的镜头、有未知价的笔在途、或还有预留中 / 结果不明的笔：转述里不出现「预算上限 / 已花费」，结构化结果里对应字段是 null。
7. 让 Agent 暂停 / 取消（`nomi_run_control`）：回执里的「已花费」同一口径。

不做什么：不改 Run 的花钱逻辑（授权、预留、结算怎么算）；不改付费确认卡、Agent 面板的价格文案；不加「预算由你控制」之类的替代说明；别处还在上屏的金额只列名单交协调，不顺手删。

已知坑：

- 生产代码里没有写 `settle` 的地方（供应商实付从不回写账本）。所以派发过的 Run，对外的「已花费」会一直是 null——这是如实，不是回归。
- Agent 面板的任务卡读的是原始账本（`electron/agentLane/laneDesktopTasks.ts:53`），仍会把未知印成 0。它属于 Agent 面板的价格文案，本线不改，列进名单。

真实任务：

1. 任务中心打开一个已批付费门、跑过的制作，展开详情（中、英界面各一次）。
2. 外部 Agent 读一个批过算不出价镜头的 Run，转述状态。
3. 外部 Agent 读一个刚建好的草稿 Run。

指标（目标 → 信号 → 指标）：

- 主指标：任务中心制作详情里的金额格数，基线 4 → 目标 0。量具：`src/workbench/production/ProductionRunTaskCard.test.ts` 的渲染断言，加中英真截图。
- 质量指标：账本里有未知价或未落定笔的 Run，Agent 转述里出现「预算上限 / 已花费 / budget cap / spent」的比例，基线 100%（未知被说成 0）→ 目标 0。量具：`electron/capabilityCore/mcpToolResults.test.ts` 经 `safeRunProjection` 的表驱动用例。
- 护栏指标：价格全知且全部落定的 Run 照旧报数的比例 100%；草稿 Run 的 `budget.authorized` 仍为 0。量具：同上，加 `electron/productionRun/productionRunProjections.test.ts`。
- 门岗：`src/` 界面代码新写一处金额格式化，被 lint 拦下的比例 100%；真实代码误报 0。量具：`scripts/ui-money-format.test.mjs` 的反例表与全仓普查。
- 未验证：真实用户遥测缺量具（没有「界面印出金额」的使用事件）。

## ★1b 连带界面

- 任务中心制作卡「详情」：只剩阶段计数、逐阶段状态、技能、更新时间（中英）。删掉的四个词典键不换成别的钱字样。
- Agent 回执 `nomi_read`（target=run）：
  - 「预算上限 X · 已花费 Y」只写知道的那半句，两个都不知道就整行不出；
  - 未知时不写钱、不写 0、也不写「未知」；
  - `nomiOutcome.budget`、`nomiRunData.budget` 的对应字段为 null。
- Agent 回执 `nomi_run_control`：「已花费」同一口径。
- `nomi_run_start` 草稿回执里的「未花费」说的是草稿事实，不变。
- 付费确认卡、Agent 面板任务卡 / 付费卡上的金额：不改，进名单。

## ★2 谁说了算

账本事实的 owner 是 `electron/productionRun/budgetLedger.ts`：

- 预留 `amount: null` 表示算不出价（不是 0）；
- 合计只加已知价（`knownAmounts`）；
- 未知价在途的另记笔数 `unknownInFlight`；
- 授权信封另记 `unknownJobCount`（`productionGenerationAuthorization.ts`）。

账本本来就分得清未知和 0，本线不改它。

「对外说哪个数」的 owner 是 `electron/productionRun/productionRunProjections.ts` 的 `safeRunProjection`：

- `nomi_read` / `nomi_run_control` / `nomi_run_gate` / `nomi_run_start` 的结果都经它（`dispatcher.ts` 读 `readProjection` / `createDraft`）；
- 新增 `knownRunBudget` 在这里判定「这个合计是不是全额」；
- `mcpToolResults.ts` 只转述投影给的数，自己不判断。

门表：`node scripts/door-map.mjs --write=summarizeBudgetLedger,applyBudgetEntry,createBudgetLedger,validateBudget,withReadDefaults --read=safeRunProjection,runProjection,buildProductionRunView,createDesktopLaneTasks`，写 6 扇、读 5 扇；另手工补了创建时的两处初值。

| 门 | 文件:行 | 未知怎么记 |
|---|---|---|
| 写 `summarizeBudgetLedger` | `budgetLedger.ts:109,121` | 合计跳过 null，另数 `unknownInFlight` |
| 写 `applyBudgetEntry` / `createBudgetLedger` | `productionRunRepository.ts:294,523,595` | 逐笔回放，reserve 允许 null |
| 写 `summarizeBudgetLedger` | `productionRunRepository.ts:526,598` | 同上 |
| 写 `withReadDefaults` | `productionRunRepository.ts:316,322` | 旧盘缺 `unknownInFlight` 补 0（是笔数，不是金额） |
| 写 `validateBudget` | `productionRunReducer.ts:422,773` | 只收数字；`budget.set` 在生产代码里没有发送方；`qa.retry.schedule` 给 `reserved` 加 1（花钱逻辑，不碰） |
| 写（创建初值） | `productionRunRepository.ts:352,429` | 新 Run 全 0（真 0：什么都还没批） |
| 读 `safeRunProjection` / `runProjection` | `productionRunProjections.ts:143`；`productionRunService.ts:181,710,726`；`productionRunArtifactOperations.ts:193,213` | **R1：原样外发合计**（本线改） |
| 读 `buildProductionRunView` | `src/workbench/production/useProductionStatus.ts:81` | **R2：任务中心详情直接把合计格式化成金额**（本线删） |
| 读 `createDesktopLaneTasks` | `electron/agentLane/laneDesktopRuntime.ts:142` | **R3：Agent 面板任务卡读原始合计**（列名单） |

结论：写入口没有一处把未知记成 0，供应商价格表那一层也保留 null；「未知 → 0」发生在读侧这三处。

- 同一份事实存几份：1（账本）。投影是派生，不落盘。
- 没有靠「东西不见了」猜用户意图。
- 碰到的概念：Run 账本（只读）。`delivery.money-copy-truth`（词典里的零元 / 会花钱断言）与本线的门相邻、不重叠：那条管词典断言的词表，本线管代码里现算金额的写法，不改它的 owner。

## ★3 一致与复用

- 同口径先例：`electron/capabilityCore/approvalReceipt.ts:52` 的 `reservationMaximumForDisplay` 已经把「全是未知价」显示成 null。`knownRunBudget` 把同一口径用到 Run 级预算。
- 门岗接入现成方案：用 ESLint 内置的 `no-restricted-syntax` / `no-restricted-imports`，以独立规则 id 注册（先例：`eslint.config.mjs` 的 `playwright-wait`、`browser-fixture`）。
  - 选择器和出口名单住一个模块，计数测试卡「只减不增」（先例：`scripts/canvas-store-subscriptions.mjs` 加它的 `.test.mjs`）。
  - 不自写扫描器，不新开 `check:*` 名字。写法类规则进 ESLint，是 10-22 拍板的门岗方向（`docs/audit/2026-10-22-gate-family-direction.md`）。
- 不扩 `scripts/check-i18n-no-cost-claims.mjs`：它按词表扫词典里的零元 / 会花钱断言，看不见代码里现算的金额；在词表门里长出语法树判断，就是第二种答案。
- 第二份定义：任务中心详情里的 `formatAmount` 是全仓第三份货币格式化。另两份是 `src/workbench/ai/v4/formatMoney.ts` 和 `ProductionContractSummary.tsx` 内联的那份。本线删掉这一份；剩下两份属付费确认卡 / Agent 面板，进名单。

## ★4 全状态

- 空（没有制作）：任务中心不出这张卡，不变。
- 加载：不变。
- 进行中 / 成功 / 失败 / 部分成功 / 停下 / 取消中 / 过期：详情一律只有阶段、技能、更新时间，任何状态都没有金额格。
- 能力不可用：不适用——本线不新增要模型或外部资源才做得了的动作。
- Agent 转述：
  - 两个数都知道 → 报数；
  - 只知道一个 → 只报那一个；
  - 都不知道 → 预算行整行不出；
  - 草稿 → 上限 0、已花 0（真数：还没批任何东西）。
- 文案：删四个键，不新增文案，不写免费 / 不计费断言（`check:i18n` 守）。

## 5 中途表

不适用：本线不新增状态或动作。删的是只读文字格，投影是纯函数；停、关窗、断网、重启、连点之下，行为与现状相同。

## 6 外部数据与失败

不适用：不新增外部来源。账本与授权信封是本机数据；旧盘缺字段由读盘归一（`withReadDefaults`）补齐。

## ★7 性能

不适用：不新增交互。删的是 DOM，投影少三个字段，判定是同步派生（随门数线性）。

## 8 真实条件

- [x] 英文界面：中、英各截一张。
- [x] 最小窗口：加一张窄窗截图。
- [ ] Windows：unverified，本线在 Mac 工作树。
- [ ] 真规模 / 干净安装 / 真付费：unverified，本线不跑（不花钱）。
- [x] 键盘全程：不适用，没有新增可操作目标。

拍板图清单：不适用。删格属于「逻辑 bug 不出样张」（`docs/engineering/design-card.md`），用测试加中英真截图验收。

## ★9 验收与回滚

验收清单（动手前写全；实现线按它自验，并附「反例 → 结果 → 证据」表；验收线只核这份）：

1. 任务中心详情（R2）：
   - 渲染制作卡（详情展开）不含 `runDetails.authorized / reserved / actual / unsettled` 四个键，不含货币符号或货币码；
   - `ProductionRunView['details']` 不再有 `budget`（类型检查过）；`ProductionDetails.tsx` 不再引用预算。
2. 词典：
   - 四个键中、英都删了；`pnpm run check:i18n` 绿（键对称、键引用）。
   - 删之前 grep 过，这四个键和 `formatAmount` / `amount(` 没有别的用处。
3. `knownRunBudget` 表驱动（R1）：
   - a. 草稿（没有批过的门、没有预留）→ authorized 0、actual 0；
   - b. 全知价、门已批、还有预留中的笔 → authorized = 账本上限、actual null；
   - c. 全知价、所有笔都释放了 → authorized = 账本上限、actual 0；
   - d. 批过的信封里有算不出价的镜头（`unknownJobCount > 0`），即使账面上限是 0 → authorized null；
   - e. 未知价在途（`unknownInFlight > 0`）→ authorized null、actual null；
   - f. 有结果不明的笔（`unsettled > 0`）→ actual null；
   - g. 等待中 / 驳回的门里有未知价镜头 → 不影响（只认批过的门）；
   - h. 全部落定且有实付（测试构造 settle）→ actual = 实付。
4. `safeRunProjection` 的 `budget` 只有 `currency / authorized / actual` 三个键，不外发 `reserved / unsettled / unknownInFlight`。
5. Agent 回执（经真投影）：
   - 未知价 Run：`nomi_read` 的中、英文本都不含「预算上限 / 已花费 / budget cap / spent」，`outcome.budget` 两项为 null；
   - `nomi_run_control` 暂停：文本不含「已花费 / spent」，`outcome.budget.actual` 为 null；
   - 已知价且全部落定：照报两个数；草稿：0 / 0；
   - 现有的 `budget cap 99.74` 用例不变。
6. ESLint `ui-money/*`。

   反例必红：

   - 删之前的 `ProductionDetails.tsx`（原文件当夹具，按原路径喂仓库配置）；
   - 模板拼接：`` `¥${x}` ``、`` `CNY ${x}` ``、`` `${x} USD` ``、`` `$${x}` ``；
   - 加号拼接：`'¥' + x`、`x + ' CNY'`、`currency + ' ' + x`、`budget.currency + x`；
   - 货币变量进模板：`` `${currency} ${x.toFixed(2)}` ``、`` `${x}${budget.currency}` ``；
   - Intl：`toLocaleString(l, { style: 'currency' })`、`new Intl.NumberFormat(l, { style: 'currency' })`（含带引号的键）；
   - JSX：`¥{amount}`、`{amount} CNY`；
   - 词典值：`'¥{{amount}}'`、`'USD {{amount}}'`、`'{{currency}}{{amount}}'`；
   - 名单外文件 `import { formatMoney } from '…/formatMoney'`。

   正例必绿：

   - `` `${done}/${total}` ``、`` `${count} 次` ``、`` `${n}px` ``、`` `USD_RATE_${x}` ``；
   - `Intl.NumberFormat(l, { style: 'percent' })`、`Intl.DateTimeFormat`；
   - 正则拼接：`'^' + x + '$'`、`` `^${x}$` ``、`` `${a}$` ``；
   - 词典值：`'已用 {{amount}}'`、`'{{cost}} 次调用'`；
   - JSX `{done} / {total}`。

   另外两项：

   - 全仓普查：用同一组选择器扫 `src/`（测试与设计实验室除外），命中只出现在出口名单的文件里，且每个文件的处数等于名单记的数（多了红，少了也红）。名单外 0 处 = 真实代码误报 0。
   - 接线：在仓库配置下，名单外路径的反例报 `ui-money/no-restricted-syntax`；出口文件路径不报；名单外的 `formatMoney` import 报 `ui-money/no-restricted-imports`。
7. 命令（逐条记退出码）：
   - 改到的 vitest、改到文件的 ESLint；
   - `node scripts/check-i18n-no-cost-claims.mjs`、`pnpm run check:i18n`；
   - `node scripts/check-concept-owners.mjs`、`node scripts/check-root-cause-contracts.mjs`；
   - 增量 typecheck、`git diff --check`、推送前快检。
8. 截图：无头浏览器挂真组件，任务中心制作卡展开详情，中、英、窄窗各一张，亲眼看过没有金额格。

这一类会从哪回来（反例来源）：

- 入口：
  - 别的界面组件直接格式化金额（lint 拦）；
  - 从 `formatMoney` 拿现成的格式化函数（import 限制拦）；
  - 词典模板带货币符号（lint 拦词典字面量）；
  - 主进程别的读口原样外发账本合计（对外只经 `safeRunProjection`；Agent 面板任务卡读原始账本，进名单）。
- 形状：Intl currency；模板或加号拼货币符号 / 货币码；JSX 文字贴着表达式；货币变量进模板。
- 看不见的形状（明写缺口，进名单交协调）：
  - 不带币种的裸数字（如付费确认卡的 `formatAmount`）；
  - 经变量间接传给 `t()` 的金额。
- 版本 / 旧数据：
  - 旧盘缺 `unknownInFlight`，由 `withReadDefaults` 补 0（读盘归一只有这一处）；
  - 旧信封缺 `unknownJobCount`，按 0（当时未知价发不出信封）。

回滚：`git revert <实现提交>`。无迁移、无开关、无落盘格式变化。

独立验收：本改动不属四类（见下），不强制；由协调决定是否派验收线。

### 实现后补记（2026-10-27）

- 全仓普查（`scripts/ui-money-format.test.mjs`，src 1632 个文件）：14 处命中全在 7 个出口文件里，名单外 0 处（真实代码误报 0）。比动手前 grep 多出一处：Agent 提案卡的「预估」一行（`src/workbench/ai/resident/residentToolDisplay.ts`）。
- `mcpToolResults.ts` 不用改：转述本来只在 `typeof === 'number'` 时写数、结构化结果本来是 `?? null`，投影给 null 之后它就如实了。只加了经真投影的测试。
- 概念登记：新增 `production.run-known-budget`（owner `knownRunBudget`）与 `delivery.ui-money-format`（owner `MONEY_FORMAT_SELECTORS`）；合同 `docs/fixes/2026-10-27-ui-money-amounts.root-cause.json`。

### 功能分类

- [x] 新界面 / 改交互（路径推出：改了 `src/**/*.tsx`；实际是删只读文字格，不新增可点目标）
- [ ] 花钱
- [x] 长跑 / 可打断（路径推出：`production*` 文件名；本线不改任何长跑 / 打断语义）
- [ ] Agent 行为（Agent 读到的预算数变了，但不改意图抽取或草稿；量具是 mcpToolResults 单测，不是意图评测）
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式（投影是派生，不落盘）
- [x] 新增功能 / 性能（路径推出；不新增交互，不新增异步链，perf-scenario 写「不适用」）
