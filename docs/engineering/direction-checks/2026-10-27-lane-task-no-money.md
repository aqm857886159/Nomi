# 方向检查：Agent 面板任务卡印金额——界面谈钱的第三个出口（2026-10-27）

协调代批（10-27）：只因目录口径命中、改法是删。

触发（本线 10-27 实跑 `node scripts/fix-churn.mjs`，要改的文件本身都没命中）：

- `src/workbench/ai/v4/` 目录口径：近 14 天 11 个 fix（6 个文件），本次第 12 个。落在这里的 `useAgentPanelV4Data.ts`、`agentPanelV4Types.ts`、`AgentPanelV4Cards.tsx` 文件本身近 14 天各 0 / 1 / 1 个 fix，未到阈值。
- `electron/shared/agentLane/` 目录口径：近 14 天 2 个 fix（2 个文件），本次第 3 个。落在这里的 `laneContracts.ts`、`laneProjection.ts` 文件本身 0 个。
- 词典 `src/i18n/locales/agentPanelV4.ts` 按功能键计数，命中的是 `fixtureMarkdown`，本线不碰它；本线删的 `fixtureCostSpent` 没命中。
- 没命中：`laneDesktopTasks.ts`、`laneViewModel.ts`、`scripts/ui-money-format.mjs`、设计实验室夹具。

改法全是**删**：任务卡上的金额、只给它用的字段、标签函数和接线一起删，不留开关、不留回退、不新增分支。按 P1 的例外由协调代批，事后报用户。

## 0. 一句话根因

Run 账本的合计只加已知价、实付从不回写，任务卡却把它当全额：主进程把原始合计填进任务卡事实，渲染层用注入的格式化函数印成金额。语法门看不见这条路，因为格式化函数是经标签对象注入的，视图层里既没有货币写法，也没有 import。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 任务中心「制作详情」四个金额格（#1339 已删） | `ProductionDetails.tsx` 用 Intl currency 现算账本合计 | 界面现算金额；合计当全额 |
| Agent 转述「预算上限 0 · 已花费 0」（#1339 已改） | 对外投影原样外发账本合计 | 合计当全额外发 |
| Agent 面板任务卡卡尾印零金额（本线） | `laneDesktopTasks.ts:52-53` 把 `run.budget.currency / actual / reserved` 填进事实，`laneViewModel.ts#taskCardFor` 经 `labels.formatMoney` 印成 `footnoteTrailing` / `cost` | 合计当全额；格式化函数经依赖注入进视图层 |

## 2. 为什么这一类会一直出现

- **表示层**：账本合计的字段名不带「仅已知价」限定，任务卡契约照抄成 `spent / estimated`。任何新出口都会自然当全额读。
- **实付从不回写**：生产代码没有 settle 写入口，「已花」恒为 0，看上去像真数。
- **门岗形状**：`ui-money/no-restricted-syntax` 认的是现算写法，`ui-money/no-restricted-imports` 认的是 import。本条路的格式化函数在 `useAgentPanelV4Data.ts` import、经 `LaneViewModelLabels.formatMoney` 注入，视图层 `laneViewModel.ts` 两道都看不见；它只在 import 名单上被记了一笔账，等协调定去留。
- **名单只记账、不对账**：import 名单只校验「名单外的文件不许 import」，不校验「名单里的文件还在 import」。所以一个出口删掉以后，名单可能还留着它的放行位。

| 铁律 | 结论 | 最小证据 |
|---|---|---|
| ⑩ 说的=摆的 | 适用：卡上只摆 Nomi 有依据的事实，不摆未知的合计 | `laneViewModel.test.ts` 整卡断言；`laneDesktopTasks.test.ts` 键集合断言 |
| ⑪ 能选到 | 不适用：不涉及模型参数 | — |
| ⑫ 点了=以为的 | 不适用：不改可点目标（采用、撤销不变） | — |

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 任务卡某次重构把「已花」挪进 `trailing` 或脚注，零金额换个位置回来 | `laneViewModel.test.ts` 的「卡上字串不含货币符号 / 货币码」断言 |
| 主进程给任务卡加第四个读账本的字段（如已授权） | `laneDesktopTasks.test.ts` 的键集合断言；`LaneTaskFacts` 类型 |
| 出口删了、import 名单还留着放行位，下次有人顺手 import 回来，lint 不报 | `scripts/ui-money-format.test.mjs` 的 import 普查（名单 = 真实 import） |

## 4. 靶子独立性检查

- 尺子是仓库 ESLint 内置规则加名单普查（同一份 `FORMAT_MONEY_IMPORT_PATTERN`），不是本线新写的判据。任务卡的断言查的是卡上真实输出：整卡相等，字串里没有货币符号 / 货币码，不依赖实现线自己认为哪些算钱。
- 没有「修对了反而掉分」的先例。
- 已知盲区（经依赖注入传进来的格式化函数、不带币种的裸数字）明写进设计卡与合同，不假装覆盖。

## 5. P0：这些是我们独有的吗

- 「任务卡上印什么」是 Nomi 的领域投影（Run → 任务卡），本线只删，不新增模块。
- 「名单与真实 import 是否一致」是通用的代码形状检查，用 ESLint 内置 `no-restricted-imports` 判，不自写扫描器。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | ESLint 10 内置 `no-restricted-imports`（<https://eslint.org/docs/latest/rules/no-restricted-imports>），普查与线上同一条规则、同一个 pattern | 无新依赖 | 依赖注入的格式化函数仍看不见 | **是**（名单对账） |
| 补 | 只把卡上金额换成「未知」或加说明 | 小 | 违反「钱只印一处」，换个字样还是在谈钱 | 否 |
| 重写（限一个模块） | 任务卡改读 `knownRunBudget` | 中 | 已批规矩是界面不印金额，知道的数也不印 | 否 |
| 删 | 删三个事实字段、卡片两个字段、标签函数、接线、组件里两处，名单去掉放行位 | 小 | 无 | **是** |

## 7. 用户要权衡的核心

任务卡只说有依据的事实，不再印一个恒为零的「已花」。代价：卡上看不到这一单的钱，钱只在 Agent 付费卡的逐镜价那一处出现（它的去留是另一个待定项）。

## 特征测试清单

- `electron/agentLane/laneDesktopTasks.test.ts`：投影出的事实键集合只许五个键，首次读和领域变更后都核。
- `src/workbench/ai/lane/laneViewModel.test.ts`：有事实的卡整卡相等、卡上字串不含货币符号 / 货币码；喂的事实带着删之前的三个金额字段。
- `scripts/ui-money-format.test.mjs`：import 名单与 src 真实 import 逐一相等。
