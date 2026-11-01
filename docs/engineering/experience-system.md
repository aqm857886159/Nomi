# 体验验收闭环与结账规则（L2）

> 用户 2026-10-05：「核心的问题和反复发生的问题是要修根因的，是要从我们的结构上修复的，就是让以后读取到整个仓库的任意 AI 都可以不发生类似的问题。」
> 常驻一句话在 CLAUDE.md 的 P2；本文是细则。规则正本 `docs/engineering/rules.json`（P2）。

## 闭环

发现 → 原话入逃逸账本（`tests/ux/full-walk/escapeLedger/<id>.json`，一条一个文件，分类表在 `_meta.json`；candidate）→ 归类（`categories`）→ 人工复核（reviewed）→ 根因合同（`docs/fixes/*.root-cause.json`）→ 结构性预防 → `check:escape-ledger` 卡住才能结账（fixed）。

「结构性预防」= 类型约束、唯一 owner、铁律或门岗级的类检查。只修现场、只加一个单场景回归测试，不算修好——同一类问题还会从别的入口回来。

## 结账（fixed）必须同时有三样

| 字段 | 要求 |
|---|---|
| `rootCauseContract` | 指向一份 `docs/fixes/<日期>-<名字>.root-cause.json`；文件存在、合法、有 `detected_by` 与 `prevention`，并且点名了下面那条类检查 |
| `classCheck` | `kind: "iron-law"`：`ref` 是铁律 ⑩ ⑪ ⑫ 或 `inv:1`…`inv:9`，`file` 必须是该铁律的检查文件，且这条逃逸自己声明过属于这条铁律；`kind: "matrix"`：矩阵 / 普查测试，要有参数化或遍历清单的形状，只测单个场景的不算 |
| `fixedInPr` | 合入的 PR 号（正整数） |

另外：`since` 是入账日；`candidate` 停留超过 14 天，`check:escape-ledger` 警告，提醒派人复核 / 修。条目格式不合法直接红。

## 谁判断（只许一份实现）

- 判据在 `scripts/escape-ledger-lib.mjs`：`validateEscapeLedger`（门岗用）、`fixedTransitions`（账本两版之间 candidate / reviewed → fixed 的转换）。
- `scripts/merge-preflight.mjs` 不再看 PR 正文有没有「逃逸 / 用户反馈 / 发版后」这几个词（两头都出错：#1025 正文提到「逃逸账本」被误判，#1026 修用户反馈却因没写这几个词被漏掉），改为看账本状态转换：本 PR 让条目变成 fixed 才要求带根因合同；合同声明 `detected_by` 为 user / post-release、却没有账本转换，也红。

## 门岗体检：advisory 的提示文案要和真实补齐机制对得上

`scripts/run-gates-contracts.mjs` 的 `ADVISORY_FILL` 逐个声明 advisory 门岗的补齐机制：有机器补齐主体（如 docs-autosync 工作流）才可以说「自动补齐」；要人判断的文案写清谁、怎么补（目前 advisory 名单是空的：`check:concept-owners` 已于 2026-10-19 回到阻断）。`run-gates-contracts.node-test.mjs` 核对「声明 ↔ 工作流是否真的提到它 ↔ 打出来的文案」。

## 概念 owner 存量债

`check:concept-owners`（阻断）在 main 上冻结了 37 处「受管合同声明了共享边界、但还没登记成概念写接口」。登记 owner 要人判断（它是哪个概念、谁是唯一写入口），docs-autosync 补不了。

- 冻结：`scripts/concept-owners-baseline.json` 的 `unregistered_boundaries`，只减不增；新增的未登记边界直接红，基线比参照提交多一条也红，登记完成后对应条目必须删（陈旧也红）。
- 负责：协调会话。排期原则：每次有 PR 碰到某份合同声明的文件，就顺手把那份合同的边界登记成概念写接口并删基线条目；14 份合同，目标 0.24 发版前清到 ≤10 处，**2026-10-19 用户拍板「改回挡合并（推荐）」**，这道门已回到阻断（取代 2026-10-01/02「只提示不阻断」）：新增的未登记边界当场红，合同作者在写 `shared_boundaries` 的同一 commit 登记；10-19 起 10-07 之后攒下的 84 处已全部登记，存量债仍是基线里冻结的 37 处。

## 测试路由表（按功能分类决定必交证据）

用户 2026-10-05：「设计了新功能，要根据功能分类对应到不同的测试体系，要确保我们的设计没有问题……有时候我们需要多种测试」。**路由表只有一份**：`docs/engineering/test-routing.json`；下表是可读视图（改表改 JSON，不改这里）。类别可多选，必交证据取并集。

| 类别 | 必交证据（`## 验收证据` 里每项一行） | 工具现状 / 计划（调研：#1035 `docs/research/2026-10-06-experience-testing-prior-art.md`） |
|---|---|---|
| 新界面 / 改交互 | 真组件样张（用户已拍板）· 按钮普查（每个可点目标按七字段预期表逐项对照，见下）· AI 用户走查 · 中文 / 英文 / 窄窗截图 · **体验成绩单**（`ui-task-scorecard`，2026-10-21 起；一页入口，取代重复的测试表 / 验收页摘要，见下「体验成绩单」） | 样张、截图已有；**按钮普查 `planned`**（现有 ⑫ `catalog.mjs` 只覆盖分镜表格；计划接 Playwright 无障碍树 + `@axe-core/playwright`，全量跑里加带种子的 gremlins.js；不接 Storybook / Cucumber）；**AI 走查 `stagehand (planned)`**（计划先试 Stagehand：MIT、约 2.5 万 star、observe / act / extract、能直接接 Playwright Page、带 OTel trace——用 Playwright `_electron` 拿到 Page 再交给它；只有接不上才自己写薄跑器记录「预期 → 实际 → 感受」，参考 UXAgent） |
| 花钱 | 最小量真付费抽检 + 三方对账 · 故障注入（断网、供应商报错、超时） | 已有 `_paidRun` harness（发版最小抽检，平时走零额度回环）、`pb07` 故障类走查 |
| 长跑 / 可打断 | 端到端任务链（关窗、重启、断网后续上，且不重复扣费） | 已有 J05 暂停 / 恢复、pb05 |
| Agent 行为 | 意图评测（⑩ 说的=摆的、建了几份方案、首次做对率） | 已有 `evals/` + ⑩ 铁律测试 |
| 大数据量 / 画布 / 长列表 | 真实规模性能（p95 和最长卡顿，只许变好） | **exists**：`pnpm run perf:scenarios` 跑性能场景登记表（`tests/perf/scenarios/`，复用 Playwright + CDP + PerformanceObserver 的现有量具，规矩见 `docs/engineering/perf-scenarios.md`）；每个 PR 另交 `perf-scenario` 数字证据；不用 Lighthouse CI |
| 生成效果 | 效果评测题集（跨镜一致、参考有没有用上） | **missing**（计划照 OpenAI 图片评测 cookbook 的 LLM 成对比较评一致性，照 DreamBench++ 评「参考图有没有用上」；VBench 以后再说） |
| 数据格式（含决定老模型能不能用的目录文件） | 升级路径（老用户的项目、模型、设置照常能用；真实旧数据，不接受「未验证」） | 老项目 `core-a-old-project.packaged.mjs`；老模型 `electron/catalog/upgradeKeepsWorkingModels.test.ts` + `tests/fixtures/old-user-data/` |

- **路径推类别是下限**：`pathRules` 按改动路径推出一组类别（四类沿用旧判定，`legacy` 字段），设计卡 `### 功能分类` 里勾的只能比它多。
- **缺工具的证据**：接受「未验证：工具未建」，同时 `node scripts/check-pr-judgement.mjs --gaps` 和 PR 扫描输出都会列出缺口——缺工具不是永久豁免，缺口账一直挂着，直到工具建成、该证据改成 `exists`。
- **判据两处同源**：推送前（pre-push 钩子 → `scripts/pre-push-contracts.mjs` → `check:pr-judgement`）、CI（`check:pr-judgement`，Contracts 里）与合并前扫描（协调会话）都调 `scripts/pr-body-criteria.mjs`（设计卡 ★ 格 / 独立验收 / 逃逸合同 detected_by / 中文标题）和 `scripts/pr-judgement-lib.mjs`（路由 / 规则与门岗范围）。#1094 的形状（推送放行、合并才红）靠这一份消灭。#1033 的「规则与门岗改动范围」也在这里。
- **生效日**：`effectiveFrom`（表里）之前开的 PR 路由只警告；规则与门岗范围不吃宽限。
- **其他层的工具决定**（调研结论）：功能分类 = 自写路由表 + Playwright tag / annotation 打类别标签（不接 Kiwi、TestLink）；交互预期 = ⑫ `catalog.mjs` + Playwright role/name 定位；体验指标 = 主指标逃逸数 + 关键时刻 User Timing + 用户每次亲手用 30 分钟后填 SUS；测试体系体检 = 汇总 Playwright JSON 报告（每层多久没跑、哪些用例时好时坏），Stryker 先不上、继续手动变异校验。

## 体验成绩单（2026-10-21，依据 R-uxprocess §2、§6（协调本地报告，仓库外）；试行）

回答「这次改动让创作者做成那件事顺不顺」，一页：场景 id、完成 n/d、主指标现状 → 当前、护栏、最大摩擦与决定、没验证的、证据路径。

- **场景从哪来**：`tests/ux/journeys/catalog.json` 的 `scenarios`（8–12 条，试行上限 12）：来源（用户原话 / issue / 走查 / 调研报告，带出处）、创作者类型、时刻、频率证据（不知道写「未知」）、成功终点、失败护栏、状态、负责人。状态两档：`research-candidate`（只有来源和假设）/ `executable`（指向带 runner 的旅程或仓库里存在的走查脚本）；旧 runner 只读 `journeys`，从不执行候选。校验在 `check:feel`。
- **机器数据**：复用 `collect.mjs` 的采集和 `report.mjs`；`machineFromRun` 把一次运行的 `steps.json` 变成成绩单的机器那一栏（每步一次尝试，失败和没走到的步骤原样保留）。还没接采集器的走查，指标先手工填，口径写「脚本计数」或「估算」，不冒充实测。
- **真人数据**：SEQ（1–7）和人工事件（误点 / 回退 / 求助 / 首次尝试）单独录入，没有就是 `null`；有分数必须是真人给的（`rater: "human"` 并写参与者），AI 不代打；报告里不出总分。
- **谁消费**：实现线自验、独立验收线、协调会话读同一页，不再各抄一份；页面由记录 JSON 渲染（`node tests/ux/experience/scorecard.mjs <记录.json>`），单测核对「页面 = 记录渲染结果」，不许手改页面。
- **接上采集器之前**：路由证据允许引用手工填的记录；接上以后机器那一栏改成自动生成，只剩真人栏手填。
- **试行期（两周，自 2026-10-21）不加严**：路由证据行 `ui-task-scorecard` 仍接受「未验证：原因」，两周后复盘再决定要不要加严（比如必须引用成绩单路径）。
- 样例：`docs/evidence/2026-10-21-ux-scorecard/`（#1264 一张、已合入的 #1181 对照一张）。

## 节奏：每个 PR 按路由跑，全量由用户手动触发

用户 2026-10-06 定：不要定时自动跑；重要的是每次代码改动都跑这些测试；全量由用户自己手动触发。路由表里每层只有两种 `when`：

| when | 什么时候跑 | 做法 |
|---|---|---|
| `pr` | 每个 PR 按功能分类推出的那几层（主力） | 零花费、能在 CI 跑的由 CI 自动跑（现有的 Contracts / Unit / E2E Walkthroughs / 画布验收 / Tool Face 等，按改动范围选）；`paid: true` 的（真付费抽检、AI 用户走查、Agent 意图评测、效果评测——花钱或要真模型）在 PR 上**只要求正文 `## 验收证据` 交证据**，不在 CI 自动跑 |
| `manual-full` | 只在用户手动触发的全量跑里跑，PR 正文不要求 | 目前只有真实规模性能（`perf-real-scale`：登记表全量跑，耗时长） |

- **全量入口**：GitHub Actions 的「Full Experience Run」（`.github/workflows/full-experience-run.yml`，只有 `workflow_dispatch`，**没有 `schedule`**）。它调 `pnpm run test:experience:full`（`scripts/experience-full-run.mjs`），把路由表 `fullRun.commands` 里所有零花费层串起来跑，每层独立计结果（一层红了后面照跑），出一份汇总报告（job summary + artifact）；报告末尾列出「没有覆盖的」——付费层和工具还没建的层，免得「没跑」被读成「通过」。本地可 `pnpm run test:experience:full -- --list` 看会跑什么、`--only catalog,laws` 只跑几层。
- **发版时**：全部层都跑（手动触发一次全量跑），再加真付费抽检（由协调会话亲自跑，先算最小量）和用户亲手用 30 分钟。
- **不设定时触发**：不加任何 `schedule` 工作流；体验类自动化不会在没人改代码时自己跑。

### 按钮预期表的字段集（路由表 `buttonExpectationFields`）

没有公开的跨厂商标准（调研：#1035 的 Design-to-button expectation table 一节），所以我们自己的表就是这份字段集，不另造格式。「新界面 / 改交互」类的按钮普查证据按这七个字段写；⑫ 的 `tests/ux/full-walk/catalog.mjs` 预期表映射到它们（路由表里每个字段的 `catalogField`，有 node-test 核对映射的字段真的在 catalog 里）：

| 字段 | 内容 | catalog.mjs 里对应的字段 |
|---|---|---|
| designSource | 设计来源 / 组件 | `owner`（代码组件）· `designRef`（设计链接，可选，还没填） |
| variantState | 变体 / 状态 | `state`（可选，还没填） |
| roleName | 无障碍角色 + 名称（`getByRole`） | `role` · `accessibleName`（可选，还没填） |
| userAction | 用户动作 | `action`（可选，还没填） |
| expectedState | 预期的界面状态和副作用 | `userExpectation` |
| testId | 测试 ID（Playwright tag） | `id` |
| evidence | 证据（截图 / trace） | `actualObservation` |

`tool` 字段：`exists` = 已有；`<工具名> (planned)`（或 `missing`）= 还没建，写的是计划接什么，PR 对这类证据可以写「未验证：工具未建」，缺口会被列出来。
