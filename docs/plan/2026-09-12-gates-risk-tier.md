# 门岗按风险分档：`pnpm run gates` 默认走 focused，全量交给 CI

- 状态：draft
- 日期：2026-09-12
- 规则：R22（验证分层与测试预算）、R17（加规则先验会红）、R28（防线建在最早能拦住的那层）

## 背景：一句话的真实摩擦

R22 从 2026-08-30 起就写着「普通隔离改动用 `focused`，Electron/模型执行/画布/基础设施用 `full`」，
`.github/workflows/quality-gate.yml` 的 Unit job 也确实按 `scripts/validation-policy.mjs` 分档跑。
**只有本机 `pnpm run gates` 从来没分过档**——它写死 `pnpm run test`（`scripts/vitest-fair-share.mjs`
全量 + agent-runtime 原生套件 + stats），一万两千多个用例，不管这次改的是一行文案还是 React Flow 内核。

代价不是「慢一点」，是**排队**：全机一把 `/tmp/nomi-gates.lock`（`scripts/with-gates-lock.py:128`），
20+ 棵 worktree 共用。2026-09-11 22:00–09-12 03:30 实测：8 棵 worktree 轮流拿锁，每次 10–25 分钟，
队列峰值 18。本文档写作时开的基线测量，一开口就排在 `Nomi-model-box` 后面等了 7+ 分钟。
每个人都在为「别人那棵树跑一遍和自己无关的一万两千个测试」付墙钟。

所以这次改的不是测试策略，是**把已经拍板的策略接到本机入口上**：分档判据早就有，只是没人调用。

## 先查别人

- **Nx `affected`**（https://nx.dev/docs/features/ci-features/affected）：从 `base..head` 的 git diff 反推受影响 project，
  只跑它们的 target。**它自己没有兜底**：base/head 钉错就静默少跑（官方要你用 `nrwl/nx-set-shas` 钉住），
  也没有周期性全量。我们的对应兜底是 CI 侧 merge queue 的合并树 + 下面那条 fail-closed 清单。
- **Turborepo `--affected` / `--filter=...[base]`**（https://turborepo.dev/docs/reference/run）：
  `--affected` 等价于 `--filter=...[main...HEAD]`（三点 diff）加依赖闭包；**浅克隆拿不到足够历史时退化成跑全部**。
  我们的对应物是 `classifyValidationPolicy` 里的 `empty_diff_fail_closed`（`scripts/validation-policy.mjs:151`）。
- **Bazel target determinator**（https://github.com/bazel-contrib/target-determinator）：用 `rdeps` 从改动文件
  算出必须重跑的 target 集合，精度最高，代价是整棵构建图必须先 Bazel 化。我们**有意不走这条**——
  领域约束：Nomi 是 Vite + Electron + Playwright 混合栈，没有统一 action graph，为了选测去 Bazel 化
  是拿护城河外的成本换一点精度（R20）。
- **GitHub merge queue**（https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue）：
  必测跑在**投机合并提交**（base + 队列里排在前面的 PR + 本 PR）上，而不是每个人的分支上；任一必测红就把
  该 PR 连同它后面的一并踢出队列。这正是「本地轻、合入前全」的行业形状；
  我们已经在用（`scripts/check-fresh-base.mjs:8` 记的 #344 就是 merge queue 的合并树把分支树的假绿打红）。
- **Azure DevOps Test Impact Analysis**（https://learn.microsoft.com/en-us/azure/devops/pipelines/test/test-impact-analysis?view=azure-devops）：
  插桩记录「测试 → 它碰过的源文件」映射，只跑映射命中的测试；它的 safe fallback 是**认不出的文件类型
  一律跑全量**，外加可配的周期性全量与手动 `DisableTestImpactAnalysis` 开关。我们的等价物是 ② 的
  fail-closed 清单（认不出 = 空 diff / 删改名 / 基础设施 → full）+ `pnpm run gates:full` 这个手动开关。
- **仓库里已有**：`scripts/validation-policy.mjs:129`（`classifyValidationPolicy`）已经输出
  `unit: 'focused' | 'full'`，`scripts/test-focused.mjs:102`（`runFocusedValidation`）已经实现 changed/sibling/related
  选测，`.github/workflows/quality-gate.yml:122` 已经在消费它。**本档不新造任何选测逻辑**——
  新代码只是把本机入口接到这两份既有实现上（R29：框架/仓库已提供的能力不许再长一份）。

结论：**用已有**。唯一新增的是「本机 gates 该跑哪一档」这个调度点，以及它写进五门戳的一行记录。

## 方案

### ① 两档入口

| 入口 | 内容 | 什么时候用 |
|---|---|---|
| `pnpm run gates` | `check:fresh-base` → `gates:contracts`（含 lint/typecheck/check:test-types，全部门岗）→ **按档选测** → `build` → 盖戳 | 默认。普通 PR |
| `pnpm run gates:full` | 同上，但选测档位强制 `full`（今天的全量：`pnpm run test`） | 测试基础设施改动、手动发布边界、R22 的 fail-closed 场景、想自己兜底时 |

档位由 `scripts/run-gates-tests.mjs` 决定，判据**直接调用** `classifyValidationPolicy(...).unit`——
不新写一份「本地版风险面」，否则本地和 CI 必然漂移（R14.1 的典型形状）。

- `unit === 'focused'` → `pnpm run test:system:focused`
- `unit === 'full'` → `pnpm run test`

本地的 changed entries = `origin/main..HEAD`（`check:fresh-base` 已保证 origin/main 是 HEAD 祖先）
∪ 工作区未提交改动 ∪ untracked（按 `A` 记）。三者都空 → 空 diff → fail-closed 到 full。

### ② fail-closed（照抄 R22，不新增语义）

`classifyValidationPolicy` 已经把这些判成 `unit: 'full'`，本档原样继承并**打印原因**：

- `.github/workflows/`、`.github/actions/`、`scripts/{validation-policy,select-quality-gate-profile,test-system,test-focused,…}`、
  `tests/system/`、`vitest.config.*` 等 → `validation_infrastructure:<path>`
- 删除 / 重命名 → `deletion_or_rename_fail_closed`
- 空或不可解析 diff → `empty_diff_fail_closed`
- `electron/`、journey/canvas/performance/package 风险面 → 各自的 `<面>:<path>`

**本档新增一条 pattern**（R17：先验它会红）：`tests/ux/_*.mjs` 这一族**共享走查 harness**
（`_launchApp.mjs` / `_assert.mjs` / `_canvasHit.mjs` / `_feel.mjs` …）此前不在
`VALIDATION_INFRASTRUCTURE_PATTERNS` 里——改它等于改所有走查的地基，却会被判成 `isolated_change`。
先写一条断言「改 `tests/ux/_launchApp.mjs` → tier 必须是 full」证明它现在是红的，再补 pattern 变绿。

### ③ 五门戳记录档位

`scripts/stamp-gates-ok.mjs` 多写一行 `tier=focused|full|manual`。
**push 闸不变**：`scripts/claude-hooks/pre-push-check.sh:190` 只读 `sha=` / `worktree=` 两个身份字段，
`tier=` 和既有的 `stamped_at=` 一样是给人看的记录。要让 push 闸开始认档位，得先给
`STAMP_KEYED_FIELDS` 加篡改用例（`scripts/check-hook-behavior.mjs`），那是另一件事，本档不做。

手工盖戳（没走 gates 脚本）时 tier 记 `manual`；`run-gates-tests.mjs` 写的档位记录带 HEAD sha，
sha 对不上就不采信，避免读到上一次的陈旧档位。

### ④ `test:system:full` / `release` 仍然是全量

`tests/system/profiles.mjs:13` 的 `gates` stage 改指 `gates:full`，
这样 `full-local` 与 `release` profile 的语义（「显式全量本地验证」）不因默认档变化而被偷偷降级。

## 不动的东西

- `gates:contracts` 一个门岗都不减（contracts 是 R22 里「所有 PR 都跑」的那一面）。
- `check:gates-chain` 的可达性判据不动：`gates` 仍然字面引用 `gates:contracts`。
- push 闸、绕口留痕、ponytail 评审、CI 工作流的分档逻辑，全部不动。
- `scripts/test-focused.mjs` 的选测算法不动。

## 回滚

`git revert` 本 PR 即可：`gates` 回到写死 `pnpm run test`，`gates:full` 变成孤儿脚本但无害。
单独回滚也行——把 `package.json` 的 `gates` 改回 `pnpm run test` 一行即可，其余新增文件不影响任何现有入口。

## 验收门

1. `node --test scripts/run-gates-tests.node-test.mjs` 全绿，且包含「改 `tests/ux/_launchApp.mjs` → full」
   这条先红后绿的用例。
2. `pnpm run gates:contracts` 全绿（含 `check:gates-chain`、`check:quality-gate-workflow`、
   `check:hook-behavior`、`check:agents-sync`）。
3. 本机实测两个数字写进 PR：改前 `pnpm run gates`（全量）一次、改后 `pnpm run gates`（focused）一次。
4. 假 diff 演示：只改 `tests/ux/_launchApp.mjs` 时 `run-gates-tests.mjs --dry-run` 打印 `tier=full`
   与 `validation_infrastructure:tests/ux/_launchApp.mjs`。
