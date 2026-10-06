# 体验铁律第一批：⑪ 能选到 · ⑩ 说的=摆的 · ⑫ 点了=以为的

状态：实现中（一个 PR，每条铁律一个提交）
方案正本：[综合体验验收体系](2026-10-05-comprehensive-experience-acceptance.md) §5.1 硬门、§8 Phase 1
范围：只做分镜 / Agent 起草这一块，不铺全产品；不改已有九条铁律的判据，不放宽任何门岗。

## 为什么

现有九条铁律查的是「系统自洽」（例如 ③ 看到的 = 发出的）。10-05 真实测试里用户说 16:9，卡上和请求里都是 1:1：两边自洽，③ 照样过。缺的是「和用户意图一致」这一层——功能用不了、参数选不到、交互和心智不一致。三条新铁律各补一层，全部做成能自动跑的检查。

## 设计卡（★ 5 格）

改动名：体验铁律第一批　　线：L-laws　　类别：[其他]（只加检查，不改产品行为；分镜底栏两份选项列表抽成纯函数，行为逐字节不变）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当协调会话 / 发版前检查想知道「用户会不会再撞上选不到参数、说 16:9 摆成 1:1、点了跟以为的不一样」时，跑三样东西拿到确定答案：⑪ 单测（每个 PR 的 CI 都跑）、⑩ 宿主矩阵单测（CI）+ 意图样本评测（默认不跑，显式开关才花钱）、⑫ 分镜表走查剧本（发版前 / 验收线跑）。**不做**：不修第一次跑出来的缺口（列进逃逸账本 candidate，协调会话定修哪些）；不铺分镜以外的屏；不跑真模型。主指标：⑪ 缺口类数（只减不增）；⑩ 宿主矩阵全绿 + 评测首次通过率 / 字段命中率 / 越界诚实率；⑫ 每个可点目标「预期 vs 实际」一致率。护栏：零花费（夹具 + 网络闸）、不碰用户真 Nomi。基线：本 PR 首跑数字写在 PR 正文。真实任务：10-05 用户 16:9 → 1:1；方案 §2「点击选择后反而隐藏」；付费卡等确认时草稿节点写「在下方输入提示词」但提示词已填。 | `pnpm exec vitest run tests/experience-laws`；`pnpm exec vitest run evals/intentDraft.test.ts`（零额度夹具跑通 `eval:score`）；`node tests/ux/full-walk/playbooks/pb12-storyboard-click-expectations.walk.mjs`；`tests/ux/full-walk/escapeLedger.json` |
| ★2 谁说了算 | 「入口能渲染哪些控件」的 owner 是各入口自己的渲染函数（`resolveRenderedControls`、`composerBarParams` / `shotAspectChoices` / `shotDurationChoices`、`projectSpendNode`），检查只**调用**它们，不复制判据；「Agent 意图 → 草稿」的 owner 是 `draftShotsProjection.ts` + 宿主计划处理器；「点击结果」的 owner 是真实 DOM 与落盘项目。检查自己只拥有登记表（豁免 / 已知缺口 / 用户预期）。碰的概念：模型档案（只读）、分镜行底栏（抽纯函数）、付费卡投影（只读）、full-walk 监视器（加一条观察）。 | `node scripts/door-map.mjs resolveRenderedControls`、`composerBarParams` |
| ★3 一致与复用 | ⑪ 用 vitest 与内置目录种子（`applyBuiltinSeeds` + `derivePublishedExecution`），和 `modelSpecParity.class.test.ts` 同一种「全量不抽样」写法；⑩ 宿主半复用 `agentPanelSpendConfirmTestUtils` 那条零额度的宿主链，模型半复用 `eval:run` / `eval:score` 与 `evals/datasets/*.mjs` 词表、`evals/lib/grading.mjs` 的评分三元组；⑫ 复用 full-walk 的 `startPlaybook` / `monitor.step` / 网络闸与 `catalog.mjs` 的 `CLICK_TARGET_CONTRACT`。不新建第二套测试框架、不另写状态机、不另写网络闸。新写的只有：清单生成器（领域：档案 × 入口的对账，没有现成库知道 Nomi 的档案和入口）、意图评分器（领域：草稿字段词表）、点击预期表（领域：用户心智）。 | `check:self-written`（新增文件都在 tests/ 与 evals/，不在登记口径内）；本卡「先查别人」 |
| ★4 全状态 | ⑪：缺口在豁免表 / 已知缺口表 → 绿；表外新缺口 → 红并点名入口、参数、例子模型；登记的缺口已修好 → 红（提示删行）；生成器读空 → 红。⑩：宿主矩阵每格「Agent 说的 / 草稿 / 节点 / 付费卡」四列一致 → 绿，任一列丢值或改值 → 红；比例列在 #1023 合入前标 `pending`（接口留好，不假绿）。评测：真模型默认不跑，未开开关时 `eval:run intent-draft` 直接拒绝并说明约花多少 token；零额度夹具跑通评分管线。⑫：每个可点目标「一致 / 违反 / 走查故障」三态；违反写进报告并写进逃逸账本 candidate；走查没走通 = 退出码 2，它的「没违反」不作数。文案：本 PR 不加任何界面文案。 | 测试输出；`tests/ux/full-walk/reports/`（产物，不进 git） |
| ★9 验收与回滚 | 验收：另一条验收线在干净 worktree 上跑 `pnpm exec vitest run tests/experience-laws evals/intentDraft.test.ts`、`pnpm exec vitest run evals/intentDraft.test.ts`（零额度夹具跑通 `eval:score`）、`pnpm run build && node tests/ux/full-walk/playbooks/pb12-storyboard-click-expectations.walk.mjs`，核对 PR 正文里的首跑数字与截图；硬门 ⑩ / ⑪ / ⑫ 的逐项对账见 PR 正文；逃逸项见 `escapeLedger.json` 的 `LAW11-*`、`LAW10-*`、`LAW12-*` candidate。回滚：逐个 revert 三个提交（彼此独立）。 | `## 独立验收` / `git revert <sha>` |

## 先查别人

| 出处 | 它怎么做 | 我们拿什么 / 为什么不直接用 |
|---|---|---|
| Playwright：[ARIA snapshot testing](https://playwright.dev/docs/aria-snapshots)（`toMatchAriaSnapshot`） | 把页面的可访问性树快照下来与预期比对，断言「用户（含读屏）能看到 / 能操作什么」 | ⑫ 观察实际结果时读真实 DOM 的角色 / 名称 / 可见性，与这个思路一致；走查本身就是 Playwright 驱动 Electron，所以直接用它的 locator 与可见性判断，不另写 DOM 遍历器。不用快照比对：我们要比的是「点前 vs 点后」的差异和用户预期，不是固定快照。 |
| Storybook：[Interaction tests](https://storybook.js.org/docs/writing-tests/interaction-testing)（`play` 函数 + `expect`） | 在组件故事里模拟用户点击，再断言组件状态 | 「点一下 → 断言结果」的结构照搬到 ⑫；但 Storybook 测的是孤立组件，分镜表的点击语义依赖真实项目、落盘和 Agent 引用，必须在真 Electron 里测，所以放进 full-walk 而不是引入 Storybook。 |
| 认知走查（Cognitive Walkthrough，Wharton、Rieman、Lewis、Polson 1994，[概述](https://www.nngroup.com/articles/cognitive-walkthroughs/)） | 对每一步问四个问题：用户会想做这件事吗、看得到控件吗、能把控件和目标对上吗、做完能看出进展吗 | ⑫ 的 `userExpectation` 就是第三、四问的书面答案（「点之前以为会发生什么」），`actualObservation` 是第四问的真实观察；把这套方法从人工评审变成每次走查都核一遍的表。 |
| Nielsen：[Match between system and the real world](https://www.nngroup.com/articles/ten-usability-heuristics/)（第 2 条启发式） | 系统应遵循用户熟悉的惯例，例如表格行首的复选框表示「选中」 | 用来判「行首复选框 = 本次跳过」这类违背惯例的点击目标。 |
| Anthropic：[Automating eval design and hillclimbing](https://claude.dev/blog/automating-eval-design-and-hillclimbing/) | 确定性打分器优先、train / test 留出、单变量改动 | ⑩ 模型半的样本集按 train / test 拆，打分器只做字段确定性比对；judge 不参与通过判定。 |

## 三条铁律的落点

- ⑪ `tests/experience-laws/parameterReachability.{mjs,test.mjs}` + `reachabilityLedger.json`；覆盖表每次跑写到 `artifacts/experience-laws/parameter-reachability.md`。
- ⑩ 宿主半：`tests/experience-laws/intentShownEqualsDrafted.{mjs,test.mjs}`（复用 `agentPanelSpendConfirmTestUtils` 的宿主链，只加了「换目录 / 换供应商 / 接素材身份」三个可选口）；模型半：`evals/datasets/intent-draft.mjs`（26 条，中英各半，train / test 拆开）+ `evals/lib/intentGrading.mjs`，接进 `eval:score`；`eval:run intent-draft` 不带 `--spend-ok` 拒绝；零额度夹具在 `evals/fixtures/intent-draft-run/`。
- ⑫ `tests/ux/full-walk/playbooks/pb12-storyboard-click-expectations.walk.mjs` + `catalog.mjs` 的 `STORYBOARD_CLICK_TARGETS` + 监视器 `checkClickTarget`。
