# 方向检查：界面与 Agent 谈钱——金额从哪几条路上屏、上到 Agent 嘴里（2026-10-27）

协调代批（10-27）：只因目录口径命中、改法是删。

触发（本线 10-27 实跑 `node scripts/fix-churn.mjs`，文件本身都没命中）：

- `src/workbench/production/ProductionDetails.tsx`：任务书记的是 `src/workbench/production/` 目录口径（近 14 天 2 个 fix，本次第 3 个）；本线实跑时该目录已不报（窗口滑过）。改法是**删**。
- `electron/productionRun/productionRunProjections.ts`：目录口径 `electron/productionRun/` 近 14 天 10 个 fix（4 个文件），本次第 11 个。改法是**换**：原样外发账本合计，换成只外发已知数；同提交删掉原样外发，不新增分支。
- `src/i18n/locales/generationCommon.ts`：词典按功能键计数。改法是**删**四个键。
- 没命中：`eslint.config.mjs`、`productionRunView.ts`、`mcpToolResults.test.ts`、新增的门岗模块与测试。

三处都是口径命中、文件本身没命中、改法是换或删，按 P1 的例外由协调代批，事后报用户。

## 0. 一句话根因

账本把「已知价的合计」和「未知价的笔数」分两根轴记，但读侧三个出口只拿合计那根轴当全额用：

- 任务中心详情把它格式化成金额；
- 对外投影原样外发；
- Agent 面板任务卡直接读。

而门岗只扫词典字符串，看不见代码里现算出来的金额。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 任务中心「制作详情」四个金额格印零金额 | `ProductionDetails.tsx` 用 Intl currency 把账本合计格式化上屏 | 界面现算金额；合计当全额 |
| Agent 转述「预算上限 0 · 已花费 0」 | `safeRunProjection` 原样外发合计，`mcpToolResults.ts` 见数就报 | 合计当全额外发 |
| 同类潜伏：Agent 面板任务卡印零金额 | `laneDesktopTasks.ts:53` 读原始合计 → `formatMoney` | 合计当全额（进名单） |
| 同类潜伏：付费确认卡、Agent 付费卡、Agent 提案卡的预估、节点来历面板、两条词典模板印金额 | 各自格式化（实现后全 src 普查：7 个文件 14 处，名单外 0 处） | 界面现算金额（进名单，归协调） |

## 2. 为什么这一类会一直出现

- **表示层**：`BudgetLedgerSummary` 的 `authorized / reserved / actual / unsettled` 字段名不带「仅已知价」的限定，读的人自然当全额。未知只在另一根轴上（`unknownInFlight`、信封的 `unknownJobCount`），读侧没有一个共享的「这个合计是不是全额」判定。
- **实付从不回写**：生产代码没有 settle 写入口，「已花费」恒为 0，看上去像真数。
- **门岗形状不对**：`check-i18n-no-cost-claims.mjs` 和走查监视器都按词表扫字符串。金额格的标签不含钱字，值是格式化函数现算的，门岗天然看不见。
  - 逃逸账本 `FB-20261008-ui-talks-money` 已标 fixed，它的类检查（`tests/ux/full-walk/outcomeText.test.mjs` 词表矩阵）同样只看词典——这四格就是从这条缝里漏的。

| 铁律 | 结论 | 最小证据 |
|---|---|---|
| ⑩ 说的=摆的 | 适用：界面和 Agent 只说 Nomi 摆得出依据的数；未知价、未落定时不报数 | `knownRunBudget` 表驱动 + `mcpToolResults.test.ts` 经真投影的用例 |
| ⑪ 能选到 | 不适用：不涉及模型参数 | — |
| ⑫ 点了=以为的 | 不适用：不改可点目标 | — |

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 新界面组件再格式化一次预算 / 价格上屏（第四份货币格式化） | `scripts/ui-money-format.test.mjs` 全仓普查：名单外命中即红 |
| 新的主进程读口原样外发账本合计，Agent 又把未知报成 0 | `node scripts/door-map.mjs --read=safeRunProjection,runProjection`；`productionRunProjections.test.ts` 的键断言 |
| 词典里出现 `¥{{amount}}` 一类模板 | 同一普查（词典字面量选择器） |

## 4. 靶子独立性检查

- 尺子：ESLint 的语法树选择器是外部现成能力。反例来自删之前的真文件和仓库里真实的存量写法，不是实现线自己编的形状。全仓普查按「名单外 0 处」判，不依赖实现线认为哪些算钱。
- 没有「修对了反而掉分」的先例。
- 尺子的已知盲区（不带币种的裸数字、经变量传给 `t()` 的金额）明写进名单，不假装覆盖。

## 5. P0：这些是我们独有的吗

- 「哪个数算知道」是 Nomi 账本独有的领域语义（已知价 / 未知价两根轴、按门授权）。自写一个纯函数 `knownRunBudget`，放在既有的对外投影层，不新增模块。
- 「代码里有没有把金额格式化上屏」是通用的代码形状检查。接 ESLint 内置规则（独立规则 id 注册），不自写扫描器。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | ESLint 10 内置 `no-restricted-syntax` + `no-restricted-imports`（<https://eslint.org/docs/latest/rules/no-restricted-syntax>、<https://eslint.org/docs/latest/rules/no-restricted-imports>），独立规则 id；选择器与出口名单住 `scripts/ui-money-format.mjs` | 无新依赖；一份选择器 | 盲区：裸数字、间接传参 | **是**（门岗部分） |
| 补 | 往 `check-i18n-no-cost-claims.mjs` 的词表里加金额模式 | 小 | 词表看不见现算金额；词表门里长出第二种判据 | 否 |
| 重写（限一个模块） | 投影层加 `knownRunBudget`，换掉原样外发 | 一个纯函数加类型收窄 | 外发少三个字段（门表普查过，没有消费者） | **是**（Agent 部分） |
| 删 | 删任务中心四格、只给它用的格式化、四个词典键，以及视图里的 `details.budget` | 小 | 无 | **是**（界面部分） |

## 7. 用户要权衡的核心

界面和 Agent 只说知道的数。代价是派发过的 Run 对外「已花费」会一直是空（Nomi 收不到实付），换来的是不再把「不知道」说成「0」。别处还在印金额的地方（付费确认卡、Agent 面板）要不要一起收，是下一个要拍板的。

## 特征测试清单

- `src/workbench/production/ProductionRunTaskCard.test.ts`：详情展开后不含四个键与货币符号。
- `electron/productionRun/productionRunProjections.test.ts`：`knownRunBudget` 表驱动；投影的 `budget` 只有三个键。
- `electron/capabilityCore/mcpToolResults.test.ts`：经真投影的未知 / 已知 / 草稿转述。
- `scripts/ui-money-format.test.mjs`：删之前的 `ProductionDetails.tsx` 必红、反例 / 正例表、全仓普查、接线。
