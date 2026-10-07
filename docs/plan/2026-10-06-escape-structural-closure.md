# 逃逸结账必须挂结构性预防（P2 闭环 + 三个门岗体检）

> 状态：已实现未推送（2026-10-06）。用户 10-05 原话：「核心的问题和反复发生的问题是要修根因的，是要从我们的结构上修复的，就是让以后读取到整个仓库的任意 AI 都可以不发生类似的问题才行，这个是不是可以写入规则」。公开仓，不写金额和私有待办。

## 为什么

- 已有：`scripts/root-cause-contracts.mjs` 要求「反复出现的修复必须带结构性预防，只有测试或文档不算」；#1018 合入了逃逸账本 `tests/ux/full-walk/escapeLedger.json` 与三条新铁律 ⑩ ⑪ ⑫。
- 缺的环节：用户发现的问题（逃逸）没有被强制走进这条链，账本里的条目怎么结账没有任何门岗管。
- 门岗体检顺带发现的三处不准：`merge-preflight` 的 `ESCAPE_SIGNAL` 只看正文用词，两头都出错（#1025 正文写了「逃逸账本」被误判、#1026 修用户反馈却没写这几个词被漏掉）；`check:concept-owners` 在 main 上攒了 37 处合同边界没登记，汇总却说「由 docs-autosync 自动补齐」，这句不是真话；没有任何检查核对 advisory 门岗的提示文案和它真实的补齐机制。

## 设计卡（★5 格）

改动名：逃逸结账门岗 + 三个门岗体检    线 / 负责人：L-rules6    类别：[其他]

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 用户 = 实现线和协调会话。把一条逃逸账本条目改成 `fixed` 时，必须同时给根因合同、一条类级检查（铁律 ⑩ ⑪ ⑫ / inv:1-9，或矩阵 / 普查测试）和合入 PR 号，否则 `check:escape-ledger` 红；`candidate` 停留超 14 天警告。协调会话合并前扫描：只有账本里出现 candidate / reviewed → fixed 才要求合同。不做：不改任何产品代码；不把 `check:concept-owners` 升回阻断（用户 10-01 拍板的降级，升回要另提）；不实现综合体验测试六块（只写计划）。已知坑：类级判据是形状启发式，挡「拿单场景测试结账」，挡不住有心人写假遍历，那层由独立验收线对着根因合同核。真实任务：构造不合格 / 合格的 fixed 条目走门岗，回放 #1025、#1026 的判法。 | `pnpm run check:escape-ledger` |
| ★2 谁说了算 | 「结账够不够格」「账本两版之间哪些条目转成 fixed」唯一 owner = `scripts/escape-ledger-lib.mjs`（`validateEscapeLedger` / `fixedTransitions`）；`merge-preflight` 只 import 它，不再自带第二份判断。advisory 的补齐机制唯一 owner = `scripts/run-gates-contracts.mjs` 的 `ADVISORY_FILL`。未登记合同边界的存量债唯一账 = `scripts/concept-owners-baseline.json` 的 `unregistered_boundaries`。 | `node scripts/door-map.mjs fixedTransitions` |
| ★3 一致与复用 | 复用 `root-cause-contracts` 的 `detected_by` 枚举与合同路径、账本既有的 `ironLaws` / `existingInvariants` 声明、概念门岗既有的基线 + 参照提交棘轮（只加一个桶，不另造机制）。自写：把账本状态与「类检查」对上的这层判断（数据是 Nomi 的领域数据，现成工具读不了）；登记归 `gate-family`（`scripts/check-*.mjs`）。 | 本文「先查别人」 |
| ★4 全状态 | 不适用：没有用户界面。命令行状态：账本不合法（红）/ fixed 缺合同、类检查、PR 号（红）/ candidate 超 14 天（警告，退出 0）/ 全合格（绿）/ 账本文件缺失或解析失败（红，不当通过）。 | `scripts/check-escape-ledger.node-test.mjs` |
| ★9 验收与回滚 | 验收：另一条线跑 `check:escape-ledger`、`check:concept-owners`、`check:gates-chain`、`check:agents-sync`、`check:rule-aliases`，并复核验红证据（PR 正文）。回滚：revert 本分支提交；CLAUDE.md 的 P2 一句与 `rules.json` 同在，revert 后重跑 `gen:agents`。 | PR 正文「测试」 |

## 先查别人

- **Google SRE《Postmortem Culture》**：postmortem 必须带「有效的预防动作，降低复发的可能性和 / 或影响」，而不是只修这一次——https://sre.google/sre-book/postmortem-culture/ 。对应本卡：逃逸结账要挂「类级检查」，不是修现场。
- **Google SRE Workbook《Postmortem Culture: Learning from Failure》**：action items 要追到完成，「没有后续行动的 postmortem 和没写一样」，用集中的追踪系统防止它们漏掉——https://sre.google/workbook/postmortem-culture/ 。对应：账本 `status` 状态机 + `check:escape-ledger` 把「结账」变成机器卡的步骤，`candidate` 超 14 天就警告。
- **PagerDuty 事故响应 post-mortem 流程**：负责人只负责开出跟进工单，不负责追到解决——https://response.pagerduty.com/after/post_mortem_process/ 。这正是我们要避免的断点（开了单没人追）：所以追踪放进门岗，不靠责任人记得。
- **Etsy《Blameless PostMortems and a Just Culture》**（Code as Craft）：无责复盘，重点放在改系统而不是追人——https://www.etsy.com/codeascraft/blameless-postmortems （抓取时被站点 403 拒绝，`unverified`：出处按公开已知引用，内容未在本次核对）。对应：账本不记「谁的错」，只记类别与结构性预防。
- **事故管理里的 corrective vs preventive 区分**：纠正动作（修这一次）与预防动作（防同类再来）要分开记账——出处同上 Google SRE 两篇的 action items 部分；本次没有找到可抓取的、专门讲这个区分的单一页面，`unverified`。对应：`rootCauseContract` 管症状 / 类根因，`classCheck` 管预防。
- **结论**：「预防动作要追到完成」「复盘不等于修一次」都有成熟做法，思路照搬；没有现成工具能读我们的逃逸账本、根因合同和铁律文件，所以这一层胶水自写。

## 做了什么

1. **规则一句话**：CLAUDE.md 的 P2 并进「用户发现的问题进逃逸账本，结账必须挂结构性预防，只修现场不算修好」，不新增条目；为了字节只减不增，同时压掉两处冗词（`rules.md` 说明括号、多会话里与编排手册重复的「实现会话 3 个左右」，手册 §19 仍有）。`rules.json` 的 P2 规则文字与执行点同步，`gen:agents`、`check:agents-sync`、`check:rule-aliases` 通过。
2. **新门岗 `check:escape-ledger`**（进 Contracts）：账本格式、`fixed` 必须带 `rootCauseContract` + `classCheck` + `fixedInPr`、`candidate` 超 14 天警告。账本新增 `since`（入账日），22 条存量用首次入库日回填（均为 2026-10-05）。
3. **合并前扫描改判据**：`merge-preflight` 看账本里 candidate / reviewed → fixed 的状态转换，不再看正文用词；与门岗共用 `fixedTransitions`。
4. **concept-owners 存量债棘轮**：37 处未登记合同边界冻进基线 `unregistered_boundaries`，只减不增，新增当场红；汇总文案改成按门岗各自的补齐机制出（concept-owners 写「要人判断」）；`docs/engineering/experience-system.md` 写明债由谁负责、什么时候清。
5. **体检**：`run-gates-contracts.node-test.mjs` 核对每个 advisory 门岗「声明的补齐机制 ↔ 工作流是否真的提到它 ↔ 打出来的文案」，只有机器补齐主体才可以说「自动补齐」。
6. **复盘模板**加一句：来源是逃逸账本的修复要写明结账挂的是哪条类检查。
7. **综合体验测试六块**写进 `docs/plan/2026-10-05-comprehensive-experience-acceptance.md` 第 12 节（只写计划）。
