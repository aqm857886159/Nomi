# 设计卡：Agent 面板任务卡不印金额

改动名：任务卡事实删掉币种 / 已花 / 预估三个字段，视图投影、卡片组件、标签接线、门岗名单一起收
线/负责人：I-lane-task-money（Mac Claude 实现线）
类别：[其他]（不改花钱逻辑，不改长跑 / 打断语义，不新增界面；路径启发式推出的类别见文末「功能分类」）

方向检查：`docs/engineering/direction-checks/2026-10-27-lane-task-no-money.md`

依据（都已批）：

- 设计系统「钱只印一处：界面不印合计数量或金额」（`docs/design/nomi-design-system.md:405`）。
- 用户 09-26 拍板：价格维度暂时对用户隐藏（同文件 :801）。
- 界面金额那条线（#1339）删了任务中心四个金额格，它的门表把这张卡列为第三个出口（`docs/engineering/direction-checks/2026-10-27-ui-money-amounts.md` 归类表第 3 行）。

## ★1 用户怎么用

当我在 Agent 面板里看 Agent 发起的一张生成任务卡，我想看到的只有 Nomi 摆得出依据的事实（标题、状态、阶段计数、进度、候选图、脚注），以便不被卡尾一个恒为零的「已花」误导成「这次没花钱」。

步骤：

1. 让 Agent 生成几张参考图，在付费卡上点「生成」。
2. 面板里出现任务卡：卡头是标题、状态、阶段计数。
3. 卡体是进度条；跑完后是候选缩略图。
4. 点一张候选图采用。
5. 关掉对话再打开：任务卡从领域重新 join，样子不变。
6. 任何一态、中英界面，卡上都没有金额。

不做什么：

- 不改 Agent 付费卡（`agentPanelSpendCard.ts`）、付费确认卡、`formatMoney.ts`，也不改出口名单里别的金额。
- 不改 Run 的花钱逻辑、账本、对外投影（`knownRunBudget` 归界面金额那条线）。
- 卡上其它内容不动，不换成别的钱字样，也不加说明。

已知坑：

- 车道任务卡没有 `params`，而 `V4TaskCard` 只在有参数时才画「预估」胶囊。所以生产里用户真正看到的是卡尾 `footnoteTrailing`（已花）：实付从不回写，它恒为零。
- 设计实验室的任务卡夹具在 `trailing` 字串里也写着金额。实验室不上生产，`trailing` 也不归本线删；本线只删类型删掉后编不过的那两处（预估胶囊、卡尾数），其余列进残余风险。

真实任务：

1. Agent 面板里让 Agent 给第 2 镜出 4 张参考图，生成中看卡（中、英各一次）。
2. 跑完的任务卡，点一张候选图采用。
3. 重开这条对话，看同一张卡。

指标（目标 → 信号 → 指标）：

- 主指标：有领域事实的任务卡上印出的金额处数，基线 1（卡尾「已花」）→ 目标 0。量具：`src/workbench/ai/lane/laneViewModel.test.ts`（整卡 toEqual，卡上字串不含货币符号 / 货币码），加中英真截图。
- 质量指标：主进程投影出的任务卡事实里带金额字段的比例，基线 100% → 目标 0。量具：`electron/agentLane/laneDesktopTasks.test.ts`（键集合只许 status / progress / stagesDone / stagesTotal / candidates）。
- 护栏指标：卡上其它内容（标题、状态、阶段计数、进度、候选图、脚注）照旧出现的比例 100%。量具：同一份 laneViewModel.test.ts 的整卡断言，加截图。
- 门岗：货币格式化函数的 import 名单与 src 里真实的 import 逐一相等，名单外 0、名单里不再 import 的 0。量具：`scripts/ui-money-format.test.mjs` 新增的 import 普查。
- 未验证：真实用户遥测缺量具（没有「卡上印出金额」的使用事件）。

## ★1b 连带界面

- Agent 面板任务卡（中英）：卡头标题 + 状态 + 阶段计数，卡体进度条 / 候选图 / 脚注；不印金额。
- 设计实验室：`v4-task-running` 少一颗预估胶囊，`v4-flow-generation` 那张四参考图任务卡少一个卡尾数。这一屏在 `tests/ux/design-lab/calibration.json` 的待拍板登记里，比对本来就跳过，登记里补一句内容变了。
- Agent 回执 / MCP 转述：不涉及。任务卡事实不进模型上下文（`tests/agent-runtime/lane-task-card.test.mts` 第三条已证）。
- 别的金额出口（Agent 付费卡逐镜价、付费确认卡、提案卡预估、来历面板、两条词典模板、Agent 用量 costUsd）：不改。

## ★2 谁说了算

- 任务卡事实的 owner：`electron/agentLane/laneDesktopTasks.ts#createDesktopLaneTasks`，主进程按 ProductionRun 投影，全仓唯一写 `LaneTaskFacts` 的地方。
- 契约：`electron/shared/agentLane/laneContracts.ts#LaneTaskFacts`。
- 视图投影：`src/workbench/ai/lane/laneViewModel.ts#taskCardFor`，唯一产 `TaskCardData` 的生产代码。
- 组件：`src/workbench/ai/v4/AgentPanelV4Cards.tsx#V4TaskCard`。
- Run 账本 owner 是 `budgetLedger.ts`，本线只读、不改。

同一份事实存几份：1（Run 账本）。任务卡事实是投影，不落盘；转录里只存 `productionRunId` 和 `operationId` 两个 id。没有靠「东西不见了」猜用户意图。

碰到的概念：

- `production.run-known-budget`：它的 notes 写着「Agent 面板任务卡仍读原始账本，待协调定」，本线改成已删。
- `delivery.ui-money-format`：名单收紧。

门表：`node scripts/door-map.mjs LaneTaskFacts TaskCardData formatMoney laneViewModel createDesktopLaneTasks`，写 8 扇、读 8 扇。`formatMoney` 按名字数，所以 `ProductionContractSummary.tsx` 自带的同名函数也被数进来；它是付费确认卡的出口，不在本线。另手工追了三个字段的属性读写，door-map 按标识符数、数不到 `facts.spent` 这种写法：`git grep -E "(spent|estimated)\s*:"`、`git grep -E "facts\??\.(spent|estimated|currency)"`。

| 门 | 文件:行 | 金额怎么走 | 本线 |
|---|---|---|---|
| 写 `createDesktopLaneTasks` 的投影 | `electron/agentLane/laneDesktopTasks.ts:52-53` | 把 `run.budget.currency / actual / reserved` 填进事实 | 删 |
| 契约 `LaneTaskFacts` | `electron/shared/agentLane/laneContracts.ts:176-191` | 定义三个字段（:183-188） | 删字段 |
| 透传 `tasks` 读口 | `electron/shared/agentLane/laneProjection.ts:251,277-281` | 原样挂到 task 段，不读金额 | 逻辑不改，注释里的「金额」改掉 |
| 类型 `LaneTaskFactsResolver` | `electron/agentLane/laneRuntimePort.ts:252` | 只是类型 | 不改 |
| 读 `taskCardFor` | `src/workbench/ai/lane/laneViewModel.ts:230-249` | `money()` → `labels.formatMoney` → `cost` / `footnoteTrailing` | 删 |
| 标签 `LaneViewModelLabels.formatMoney` | `src/workbench/ai/lane/laneViewModel.ts:102-106` | 只给 `taskCardFor` 用 | 删 |
| 接线 | `src/workbench/ai/v4/useAgentPanelV4Data.ts:5,251` | `formatMoney(i18n.language, …)` | 删 |
| 组件 `V4TaskCard` | `src/workbench/ai/v4/AgentPanelV4Cards.tsx:103-107,144-147` | 预估胶囊（只在有参数时画）、卡尾数 | 删 |
| 卡片类型 `TaskCardData` | `src/workbench/ai/v4/agentPanelV4Types.ts:152,159-160` | `cost`、`footnoteTrailing` | 先 grep 生产者，再定删不删（见下） |
| 实验室夹具 | `src/devlab/designLab/v4/agentPanelV4LabKit.tsx:29,117,245,285` | `labViewModelLabels.formatMoney`、两处夹具金额 | 类型删了它就编不过，随删 |
| 测试夹具 | `laneViewModel.test.ts`、`laneDesktopTasks.test.ts`、`tests/agent-runtime/lane-task-card.test.mts`、`tests/agent-runtime/laneL1Scenarios.mts`，以及 4 份标签夹具 | 写三个字段 / 接 `formatMoney` | 删 |
| 组件用例（实现时补记） | `src/workbench/ai/v4/agentPanelV4Blocks.test.ts` 的「每张卡都能带花费」 | 直接喂 `cost` 断言预估胶囊上屏 | 换成反向用例：喂删之前的形状，卡上不许出现金额。初稿按符号和字段名数门，数不到对象字面量里的 `cost:`，是实现时 vitest 抓到的 |

读口普查结论：除上表，没有别的读口把这三个字段印成钱。`LanePart` 的 task 段只有 `laneViewModel` 一个消费者；`AgentPanelV4Panel.tsx:191` 渲染 `V4TaskCard`，`laneTaskCandidateActions.ts:45` 只读候选。

`TaskCardData.cost` / `footnoteTrailing` 的生产者（`git grep -n TaskCardData`）：

- 生产代码只有 `laneViewModel.ts#taskCardFor`。
- 类型注释里的「画布 FlowGeneration 板」是 09-06 Agent 面板 v4 定稿画布上的一块板（`docs/design/mockups/2026-09-06-agent-panel-v4/src/canvas.json:68`），不是产品画布。生成画布没有任何代码产 `TaskCardData`。
- 另一个写它的是设计实验室夹具（`agentPanelV4LabKit.tsx:245,285`），照抄的就是那块 09-06 的板，早于 09-26 拍板和「界面不谈钱」。实验室不进生产包（`src/devlab/designLab.tsx` 抬头），不算生产者。

结论：没有别的生产者，两个字段连同组件里画它们的两处一起删。

## ★3 一致与复用

- 同口径先例：#1339 删任务中心四个金额格，依据是同一条规矩，做法也一样：删格、删只给它用的格式化和词典键，不换字样。
- 不新增组件、格式化函数或文案。`formatMoney.ts` 不动，Agent 付费卡还在用。
- import 普查沿用同一文件里出口普查的做法：计数器加名单逐一相等。判据用仓库 ESLint 内置的 `no-restricted-imports`，规则就是 `scripts/ui-money-format.mjs` 里那一个 `FORMAT_MONEY_IMPORT_PATTERN`，不写第二份判据，不新开 `check:*`。
- 第二份定义：无。

## ★4 全状态

- 任务卡五态（排队 / 生成中 / 完成 / 失败 / 已停止）：都不印金额，其余内容照旧。
- join 不到领域事实：仍只有标题加「任务详情在任务中心」，不变。
- 取消中：Run 的 `pausing` 照旧映射成生成中，不变。
- 加载 / 空 / 过期：没有单独的态，不变。
- 能力不可用：不适用，不新增要模型或外部资源才做得了的动作。
- 文案：不新增；删一个设计实验室夹具键 `agentPanelV4.fixtureCostSpent`（中英）。不写免费 / 不计费断言（`check:i18n` 守）。

## 5 中途表

不适用：不新增状态或动作。删的是只读字段和只读文字；投影是纯函数，停、关窗、断网、重启、连点之下，行为与现状相同。

## 6 外部数据与失败

不适用：不新增外部来源。任务卡事实来自本机 ProductionRun，不落盘、不迁移。

## ★7 性能

不适用：不新增交互。卡少渲染一个卡尾数（和一颗只在有参数时出现的胶囊），主进程投影少三个字段。

## 8 真实条件

- [x] 英文界面：中、英各截一张。
- [ ] 最小窗口：unverified，任务卡宽度跟面板走，本线不改布局。
- [ ] Windows：unverified，本线在 Mac 工作树。
- [ ] 真规模 / 干净安装 / 真付费：unverified，本线不跑（不花钱）。
- [x] 键盘全程：不适用，没有新增可操作目标。

拍板图清单：不适用：pure-bugfix：删掉违反已批规矩「钱只印一处」的只读金额，不新增元素。

## ★9 验收与回滚

验收清单（动手前写全；实现线按它自验，并附「反例 → 结果 → 证据」表；验收线只核这份）：

1. 契约与主进程投影：
   - `LaneTaskFacts` 没有 `currency / spent / estimated`；
   - `createDesktopLaneTasks` 投影出的事实，键集合只在 `status / progress / stagesDone / stagesTotal / candidates` 里，账本有合计（预留、已结算都不为 0）也一样；首次读和领域变更后重投两次都核。
   - 反例：把 `currency: run.budget.currency, spent: run.budget.actual, estimated: run.budget.reserved` 放回 `laneDesktopTasks.ts` → `laneDesktopTasks.test.ts` 必红。
2. 视图投影 `taskCardFor`：
   - 有领域事实的卡（生成中带阶段和进度、完成带候选）整卡 `toEqual`：标题、状态、阶段计数、进度、候选（带序号），没有 `cost` / `footnoteTrailing`；
   - 卡上所有字串不含货币符号或货币码；
   - 测试喂的事实故意带上删之前的三个金额字段（模拟旧形状），证明这一层不读它们。
   - 反例：把 money 那几行放回 `taskCardFor`（连同 `labels.formatMoney`）→ 必红。
3. 接线：`LaneViewModelLabels` 没有 `formatMoney`；`useAgentPanelV4Data.ts` 不 import、不接线；设计实验室的 `labViewModelLabels` 同删。五份类型检查过（`node scripts/typecheck.mjs`）。
4. 组件与卡片类型：
   - `TaskCardData` 没有 `cost` / `footnoteTrailing`（生产者 grep 结论见 ★2）；
   - `V4TaskCard` 不再画预估胶囊和卡尾数；
   - 卡上其它内容（标题、状态、阶段计数、进度、候选图、脚注、撤销）不动。
5. 门岗名单：
   - `FORMAT_MONEY_IMPORTERS` 只剩 `agentPanelSpendCard.ts`；`formatMoney.ts` 出口的说明去掉「任务卡金额」，处数不变；
   - `scripts/ui-money-format.test.mjs` 照旧全绿，新增 import 普查：名单 = src 里真实 import 它的文件。
   - 反例 a：在 `useAgentPanelV4Data.ts` 放回 `import { formatMoney } from './formatMoney'` 并接线 → ESLint 报 `ui-money/no-restricted-imports`，import 普查也红。
   - 反例 b：名单里留着 `useAgentPanelV4Data.ts`，文件已不 import → import 普查红。
6. 词典：`agentPanelV4.fixtureCostSpent` 中英都删（删之前 grep 过，只有实验室夹具用它）；`pnpm run check:i18n` 绿。
7. 截图：
   - 无头 Chromium 加 vite 开发服务，挂真组件（`laneViewModel` → `V4TaskCard`，放在 `AgentPanelV4Panel` 里）、真词典；
   - 有领域事实的任务卡（生成中、完成各一张），中英各截一张，亲眼看过：没有货币符号、没有「已花 / Spent」；标题、状态、阶段计数、进度条、候选图照旧；pageerror 0；
   - 改前同取景对照（中英）。
8. 命令逐条记退出码：
   - 改到的 vitest、改到文件的 ESLint；
   - `node scripts/typecheck.mjs`（排锁）、`pnpm run check:i18n`；
   - `node scripts/check-concept-owners.mjs`、`node scripts/check-root-cause-contracts.mjs`；
   - `git diff --check`、推送前快检（排锁）。

这一类会从哪回来（反例来源）：

- 入口：
  - 主进程别的读口把 `run.budget` 塞进任务卡事实：类型拦，`LaneTaskFacts` 没有这几个字段；
  - 渲染层给 `TaskCardData` 塞金额：类型拦；
  - 别的文件 import 货币格式化函数：lint 拦，加上 import 普查；
  - 往 `trailing` / `footnote` 这类通用字串里拼金额：现算写法由 `ui-money/no-restricted-syntax` 拦。
- 形状：
  - 数字加币种交给注入的标签函数格式化。这就是本次删的路，`laneViewModel.ts` 里既没有货币写法、也没有 import，语法门和 import 门都看不见它，只在接线处（`useAgentPanelV4Data.ts` 的 import）被名单记了账。
  - 明写缺口：经依赖注入传进来的格式化函数，lint 只在 import 处拦得住。
- 版本 / 旧数据：任务卡事实不落盘，每次投影现 join；转录只存两个 id。旧转录、旧盘没有要迁移的金额。
- 平台：无平台差异。

回滚：`git revert <实现提交>`。无迁移、无开关、无落盘格式变化。

独立验收：路径启发式推出「长跑」（见下），由协调决定是否派验收线。

### 功能分类

- [x] 新界面 / 改交互（路径推出：`AgentPanelV4Cards.tsx`；实际只删卡上的只读金额，不新增可点目标）
- [x] 长跑 / 可打断（路径推出：`laneDesktopTasks.ts` 文件名含 task；本线不改任何长跑 / 打断语义）
- [x] Agent 行为（路径推出：`electron/agentLane/`、`src/workbench/ai/`；不改意图抽取、起草、模型可见面）
- [x] 新增功能 / 性能（路径推出；不新增交互，perf-scenario 写「不适用」）
- [ ] 花钱（不改授权、预留、结算）
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式（任务卡事实不落盘）
