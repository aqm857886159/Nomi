# 按功能分类决定测试路由（路由表 + CI 判据）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实现未推送（2026-10-06）。用户 10-05 晚原话：「如果我们设计了新的功能，要根据功能分类对应到不同的测试体系，要确保我们的设计没有问题……最近发现太多和用户的交互预期不一致、功能没法用、性能太差、效果不好，这类直接的代码测试、功能测试测不出的东西」「可以多选吗，我怕的是有时候我们需要多种测试」「规则需要最优先落地……我需要防住我们最新的 PR」。公开仓，不写金额和私有待办。

## 为什么

代码测试、功能测试测不出「交互预期不一致 / 功能没法用 / 性能差 / 效果不好」这一类。#1031 把逃逸结账卡进了门岗，但新功能动手前没有任何东西强制它对应到合适的测试体系——要在 PR 层面拦住。

## 设计卡（★5 格）

改动名：测试路由表 + 功能分类 / 验收证据判据（merge-preflight + CI）    线 / 负责人：L-rules6    类别：[其他]

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 用户 = 实现线和协调会话。开 PR 时设计卡里勾 `### 功能分类`（可多选），PR 正文 `## 验收证据` 逐项给报告链接 / 运行号 / 截图路径，或写「未验证：原因」；漏勾路径推出的类别、缺证据条目，CI 与合并前扫描都红。不做：不实现七层里还没有的工具（按钮普查推广、真实规模性能跑器、AI 用户走查跑器、效果评测题集、全量跑里的体检）；它们在路由表里标 `tool: missing` 并写计划接什么。已知坑：路径推类别是启发式（宁可多报，写「未验证：原因」可过）；生效日之前开的 PR 只警告。真实任务：拿 #1029 #1030 #1033 #1034 实跑（PR 正文）。 | `node scripts/merge-preflight.mjs <PR 号> --enforce` |
| ★2 谁说了算 | 路由表唯一一份 = `docs/engineering/test-routing.json`；判据唯一实现 = `scripts/pr-judgement-lib.mjs`（路径推类别、设计卡功能分类、验收证据、规则与门岗改动范围）；`merge-preflight.mjs` 与 `check:pr-judgement` 都调它，四类判定也从表里读，不另起一套；#1033 的「规则与门岗改动范围」从 merge-preflight 挪进这份。 | `node scripts/door-map.mjs checkProtectedScope` |
| ★3 一致与复用 | 复用 `prBody.mjs` 的唯一取正文法（CI 现取、取不到 = 红）、`check-pr-body-gates` 的 push 前早报、现有 `gates:contracts` 链、#1031 的账本 / 铁律、#1033 的 `PROTECTED_PATHS`。测试路由表自写（领域独有：Nomi 的功能分类和每类必交证据），不接 Kiwi / TestLink，打标签用 Playwright 自带 tag / annotation。 | 本文「先查别人」 |
| ★4 全状态 | 不适用：没有用户界面。命令行状态：推不出类别（跳过）/ 推出但没勾（红）/ 勾全证据齐（绿）/ 证据写「未验证：工具未建」（接受并列缺口）/ 生效日之前的 PR（警告）/ 正文取不到（CI 红，本地跳过）/ 拿不到 base（红）。 | `scripts/pr-judgement-lib.node-test.mjs` |
| ★9 验收与回滚 | 验收：另一条线对 #1029 #1030 #1033 #1034 复跑 `--enforce`，并构造漏勾 / 缺证据 PR 看 CI 变红。回滚：revert 本分支；路由表与判据同在一个提交序列里。 | PR 正文「测试」 |

## 先查别人

- **Playwright 测试标签与按标签过滤**：`tag` 选项 / `@` 标记 + `--grep` 过滤——https://playwright.dev/docs/test-annotations 。对应：路由表里的类别就是测试的标签，测试用例用 Playwright tag 标注自己属于哪一类；功能分类这一层的路由表自写（领域独有），打标签接现成的。
- **Playwright 的无障碍自动化检查**：官方推荐 `@axe-core/playwright` 做自动扫描，并强调要配合人工和包容性用户测试——https://playwright.dev/docs/accessibility-testing 。对应：按钮普查「枚举可点目标」那一层的计划接法（missing，未建）。
- **Stagehand（AI 用户走查先试它）**：浏览器代理 SDK，MIT，约 2.5 万 star，observe / act / extract，能直接接 Playwright Page，带 OTel trace——https://github.com/browserbase/stagehand （出处来自 #1035 调研，本次未逐条复核，`unverified`）。对应：路由表里 ui-ai-walk 写 `stagehand (planned)`，用 Playwright `_electron` 拿到 Page 再交给它，接不上才自己写薄跑器。
- **UXAgent：用 LLM 代理模拟可用性测试**：https://arxiv.org/abs/2504.09407 。对应：AI 用户走查的计划接法（画像、日志、指标），在 Playwright `_electron` 上写薄跑器记录「预期 → 实际 → 感受」。
- **外包卡 21 的调研汇总**：#1035 的 `docs/research/2026-10-06-experience-testing-prior-art.md`（含性能 contentTracing / getAppMetrics、效果评测 OpenAI cookbook 与 DreamBench++、真付费 `_paidRun`、不接 Kiwi / TestLink / Storybook / Cucumber / Lighthouse CI / BrowserGym 的理由）。该文件在 #1035 里，本次没有逐条复核其中引用的页面，`unverified`；路由表 `toolRef` 的「计划接」照协调会话已定的结论写。
- **结论**：「按标签分类跑测试」「无障碍树枚举」「LLM 代理走查」都有成熟做法，思路照搬；没有现成工具能读我们的路由表并对着 PR 正文逐项对账，所以这层胶水自写（`pr-judgement-lib`，归 `gate-family`）。

## 做了什么

1. 路由表 `docs/engineering/test-routing.json`：7 类（新界面 / 改交互、花钱、长跑 / 可打断、Agent 行为、大数据量 / 画布 / 长列表、生成效果、数据格式），每类必交证据，`tool: exists | missing`（missing 写计划接什么），路径推类别规则（含四类的 `legacy` 判定），生效日 `effectiveFrom`。
2. 判据库 `scripts/pr-judgement-lib.mjs`：路径推类别（下限）、设计卡 `### 功能分类` 勾选（勾的只能比推出的多）、`## 验收证据` 逐项对账（报告链接 / 路径 / 截图 / 运行号 / PR 号，或「未验证：原因」；missing 工具的证据列出缺口）、规则与门岗改动范围（#1033 挪入，加路由表与判据库本身受保护）。
3. CI：`pnpm run check:pr-judgement`（进 Contracts，push 前 `check-pr-body-gates` 也跑），`--gaps` 列出工具缺口。
4. `merge-preflight.mjs` 改为调用同一份判据（四类也从表里读），加 `--enforce` 回放参数。
5. 设计卡模板加「功能分类」一节，`experience-system.md` 写路由表可读视图和各层工具决定，`rules.json` 的 P5 执行点同步；CLAUDE.md 不动。

## 补：测试节奏（用户 10-06 定）

不要定时自动跑；每次代码改动都跑这些测试，全量由用户手动触发。路由表每层的 `when` 只有两种：`pr`（每个 PR 按功能分类跑；零花费且能在 CI 跑的 CI 自动跑，`paid: true` 的——真付费、真模型——PR 上只要求正文交证据）、`manual-full`（只在手动全量跑里跑，PR 不要求）。全量入口 = `.github/workflows/full-experience-run.yml`（只有 `workflow_dispatch`，没有 `schedule`）→ `pnpm run test:experience:full`（`scripts/experience-full-run.mjs`）：把路由表 `fullRun.commands` 里所有零花费层串起来跑，每层独立计结果，出汇总报告并列出没覆盖的层。发版时全部层都跑，加真付费抽检和用户亲手用 30 分钟。
