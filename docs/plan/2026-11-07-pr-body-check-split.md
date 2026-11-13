# PR 正文判据拆成独立检查：正文一改自动重判 + 阻断记录量具

> 📋 方案待拍板 · 2026-11-07 · 短档（纯 CI / 门岗 / 测试）· 依据：10-24 → 11-07 PR 拦截审计（Quality Gate 全量 488 次运行 + attempts API）

改动名：PR 正文判据拆成独立检查　　线/负责人：I-pr-body-check-split　　类别：[其他]

## 为什么做

审计的数：10-24 以来 PR 上 94 次 CI 红，63 次带着「按流程注定先红」的正文合并档项（独立验收还没做、账本还没转 fixed），其中 46 次除此之外什么毛病都没有。为了重判一个 3.7 秒的正文检查，要重跑 22 分钟的 Contracts（窗口内 22 次，约 8 小时），全压在「验收通过 → 合并」的关键路径上。

根子：正文的合并档判据住在 Quality Gate 的 Contracts 里，而 Quality Gate 只在推送时触发（`pull_request` 默认只有 opened / synchronize / reopened），正文改了它不知道；四类 PR 的流程又是「先开 PR、再派验收」，所以第一次 CI 按构造必红，红灯不再等于「代码有事」。

## 改法（审计 §6 ① + ⑤，协调已定）

1. 新工作流 `.github/workflows/pr-body.yml`（检查名 `PR Body`）：`pull_request` 的 opened / edited / synchronize / reopened 触发，跑 `node scripts/check-pr-judgement.mjs --stage=merge`，判合并档；不进 Quality Gate 汇总；不装依赖（判据的 import 闭包只有 node 内置模块，测试钉死）；权限只有 `contents: read` + `pull-requests: read`。
2. Contracts 里的 `check:pr-judgement` 固定判推送档：`package.json` 里写 `--stage=push`。档位只认调用点写的参数，子进程不继承；没写参数时 CI 里照旧一律合并档（继承来的 `NOMI_PR_JUDGEMENT_STAGE` 不能在 CI 放宽，10-09 那条护栏不动）。
3. `scripts/merge-preflight.mjs` 要求 PR 当前 head 上 `PR Body` 检查是绿的（同一次 `gh pr view` 多取 `statusCheckRollup`，同名取最新一次）；判据本身仍调同一个 `evaluatePrBody`，不另写一份。
4. 量具最小版：`scripts/block-radar.mjs` 只读 CI（`gh run list` + attempts API + 失败 job 日志，解析 Contracts 汇总），出「被拦」表；两个本机入口（`scripts/pre-push-contracts.mjs` 推送前快检 / 钩子、`scripts/run-gates-contracts.mjs` 整套门岗）在阻断出口各追加一行 JSONL 到 `$(git rev-parse --git-common-dir)/nomi-block-events.jsonl`（schema：`scripts/lib/block-events.schema.json`）；CI 里不写。

## 短版设计卡

- ★1：创作者看不见这件事，受益的是交付链：验收通过 → 合并这段从「改正文 + 重跑 22 分钟 Contracts」变成「改正文 + 约 1 分钟自动重判」，Quality Gate 的红重新等于「代码或推送档正文有事」。量具：`scripts/block-radar.mjs`（CI 被拦表）+ 本机 JSONL；主指标 = PR 红里「只有正文合并档项」的占比（基线 46/94，目标 0），护栏 = 合并档判据一条不少（回放 5 个已合四类 PR 结论不变）。不做：账本 fixed 机器写回（审计 ②）、「碰到的规则与门岗」自动生成（③）、推送路径并进仓库 / fresh-base 按交集（④）。老用户（= 合入那一刻还开着的 PR）：它们 head 上没有 `PR Body` 检查，合并前扫描会拒合并写清「改一下正文或推一次就会触发」；本机推送前钩子、协调脚本的环境变量用法不变。
- ★2：正文判据唯一 owner 仍是 `scripts/pr-body-criteria.mjs` 的 `evaluatePrBody`（推送前、Contracts、PR Body、合并前扫描四个入口都调它）；档位唯一出处 `resolveJudgementStage`；检查名唯一出处 `scripts/lib/prBodyCheck.mjs`（工作流测试和合并前扫描都读它）。证据：`node scripts/door-map.mjs resolveJudgementStage`。
- ★3：沿用 10-09 推送档 / 合并档分开（`5a2814f13`，「CI 里一律按合并判」防的是继承来的环境变量放宽判据——本改动保住这条，只新增调用点显式参数）；沿用 09-18 正文现取（`scripts/lib/prBody.mjs`，`edited` 事件下照样现取，不读事件负载）；沿用 docs-autosync「只 import 内置模块就不装依赖」的先例。三条路：沿原方向（Contracts 里继续判合并档）= 审计里 22 次重跑照旧；删（CI 不判合并档，只合并前扫描判）= GitHub 上看不到「可以合了」；换（独立检查，选这条）。证据：`git grep -n "resolveJudgementStage\|check-pr-judgement" -- scripts .github package.json`。
- ★4：`PR Body` 检查四种结局：绿 = 合并档全过；红 = 日志逐条写缺什么，正文改完自动重判；在跑 = 合并前扫描拒合并提示约 1 分钟后重跑；没有 = 老 PR 或工作流没触发，合并前扫描拒合并提示改一下正文。量具写记录失败（目录不可写）只出一行警告，门岗退出码不变。无界面、无文案进 i18n。
- ★9：验收清单与反例见下节；回滚 = revert 本 PR 的合并提交（或只删 `pr-body.yml` + 去掉 `package.json` 的 `--stage=push`，Contracts 立刻回到合并档）。证据：`node --test scripts/pr-body-check.node-test.mjs scripts/merge-preflight.node-test.mjs scripts/block-radar.node-test.mjs scripts/block-events.node-test.mjs` + `pnpm run check:quality-gate-workflow`。

## ★9 验收清单（动手前写全，实现线按它自验，验收线只核它）

审计 §6 ① 原文：

1. 验收前开的 PR，代码没问题时 Quality Gate 绿，「PR 正文」检查红并写清缺什么；
2. 在 GitHub 上改正文，这个检查 3 分钟内自动重判、不用人点；
3. Contracts 里任何代码门岗红，Quality Gate 照样红（反例）；
4. merge-preflight 在这个检查没绿时拒合（反例）；
5. 拿最近 5 个已合四类 PR 的正文回放，结论和当时的 merge-preflight 一致。

审计 §6 ⑤ 原文：

1. radar 对 10-24 → 11-07 跑出来的数和本报告 §1.1 一致（94 / 63 / 46）；
2. 本机门岗故意红一次，JSONL 多一条、schema 过；
3. 汇总格式改一个字，夹具测试红（变异）。

本线补的反例（这一类还会从哪些入口、形状、边界回来）：

| # | 反例 | 期望 | 量具 |
|---|---|---|---|
| a | CI 里继承来 `NOMI_PR_JUDGEMENT_STAGE=push`、调用点没写 `--stage` | 仍判合并档 | `merge-preflight.node-test.mjs` 档位用例 |
| b | `--stage=` 写错（`--stage=pussh` / 空值） | 报错退出，不当推送档 | 同上 |
| c | 同一 head 上 `PR Body` 先红后绿 / 先绿后红 / 最新一次在跑 / 被取消 / 根本没有 | 只认最新一次；绿才放行，其余拒合并且原因各不相同 | `pr-body-check.node-test.mjs` |
| d | `PR Body` 检查名在工作流里改了、合并前扫描没跟 | 工作流测试红 | `check-quality-gate-workflow.node-test.mjs` |
| e | `pr-body.yml` 权限超过 `contents: read` + `pull-requests: read`、加了装依赖步骤、从事件负载取正文、不带 edited | 工作流测试红 | 同上 |
| f | 判据的 import 闭包里冒出 npm 包（不装依赖的检查会直接崩） | 工作流测试红 | 同上 |
| g | Quality Gate 改成也在 `edited` 上触发（正文一改整套重跑） | 工作流测试红 | 同上 |
| h | 合并前扫描 `gh pr view` 拿不到 `statusCheckRollup` | 取数失败 =「结论：✖」，不当没有检查 | `merge-preflight.node-test.mjs` |
| i | 写 JSONL 失败（目录不可写） | 只警告，门岗退出码不变 | `block-events.node-test.mjs` |
| j | CI 里（`CI=true`）跑整套门岗红了 | 不写 JSONL（CI 的记录由 radar 读日志拿） | 同上 |
| k | `gh pr edit` 改正文 | 真触发 `edited`、读到新正文（草稿 PR 实测，号写进报告） | 草稿 PR 实测 |
