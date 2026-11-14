# 设计卡：推分支改由 CI 把关（删掉推送前的本机门岗戳）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：推分支改由 CI 把关   线：I-push-gate-ci   类别：[其他]（开发流程 / 门岗；不是花钱 / 长跑 / 可打断 / 新界面，不是新增功能，不填 ★0 / ★7）
```

## 背景

用户 2026-10-24 拍板：「改成 CI 把关：推分支前本机只跑快检，完整门岗交给 CI，合并照旧只认 CI 全绿和 main 上的收据。」

在这之前，Claude 会话里的推送要过两道：git 的 pre-push 快检（`scripts/pre-push-contracts.mjs`），再加 Claude PreToolUse 钩子 `scripts/claude-hooks/pre-push-check.sh` 要求本树有一枚本机 `pnpm run gates` 全过才盖的戳（签发方 `scripts/stamp-gates-ok.mjs`，绑 worktree 路径 + HEAD sha + 30 分钟新鲜度）。完整门岗一次要占全机那把 gates 锁十几到二十几分钟，几个 PR 排队等它；而 CI 本来每个 PR 都跑完整门岗、各跑各的。

## 设计卡（★ 5 格）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当协调会话（或任何会话）推任务分支时，我想只等几分钟的快检就推上去，以便多个 PR 同时在 CI 上跑完整门岗、不在本机排队。步骤：① 并 origin/main；② `git push`（pre-push 快检自动跑）；③ CI 跑完整门岗；④ 协调按 CI 全绿 + 合并前扫描合并；⑤ main 上取收据。**不做**：不改快检内容、不改 CI、不改合并规则、不加任何绕过开关。**已知坑**：快检比完整门岗少，分支上 CI 偶尔会红（不碰 main）。**真实任务**：协调队列里接下来几个 PR 的推送。**主指标**：推送前等待——基线是完整门岗：协调 tmp 下 10 份 gates 日志里光 contracts 段就 730–1460 秒（中位约 767 秒），还不含单测、构建和等锁；目标是快检时长：19 次推送的快检 2.3–92.1 秒（中位 35.4 秒）。**护栏**：main 上收据红的比例不升。 | 主指标量具：协调 tmp 下 `push.log` 的 `[pre-push] 共 Ns` 行（快检）、`gates-*.log` 的 `gates:contracts 汇总 … Ns` 行（基线）；护栏量具：`pnpm run delivery:verify-merged` 收据。合并后的推送时间对比：未验证（本线不推送） |
| ★2 谁说了算 | 推送闸唯一 owner = git pre-push（`scripts/pre-push-contracts.mjs`）；完整门岗的裁判 = CI Quality Gate（`.github/workflows/quality-gate.yml`）；合并 = 协调 + `scripts/merge-preflight.mjs`。「这次推送过没过」只剩一份事实（快检结果），删掉戳这第二份。Claude 钩子 `pre-push-check.sh` 只剩一件事：跳过 git 钩子的推送写法记进被推那棵树的 `.claude/push-bypass.log`，交 `check:push-bypass`（快检里每次都跑）审计。 | `node scripts/door-map.mjs stamp-gates-ok --roots=scripts,.claude,.github,tests,.agents --include-tests` 与 `door-map nomi-gates-ok` 同参：0 扇；`git grep -n -E "nomi-gates-ok\|stamp-gates-ok"` 只剩历史文档、负向测试与台账键 |
| ★3 一致与复用 | 复用已有快检，不另写；删 `scripts/stamp-gates-ok.mjs` 及全部读方（push 闸的三项核验、`check:push-bypass` 的同 SHA 自动确认、`check:hook-behavior` 的戳契约轴），没有第二份定义，不留「可选」读方。绕口留痕复用现有的日志格式与 `--accept` / `--clear-confirmed`。 | `pnpm run check:self-written`；`git grep` 结果（见 ★9 第 5 条） |
| ★4 全状态 | 快检绿 → 推上去；快检红 → 已有输出一次列全部失败项，推送被拦；快检超时 → 已有「本机没跑完，CI 会跑」；取不到 origin/main → 已有「全部门岗都跑」；普通推送（任何写法）→ Claude 钩子放行、不留痕；跳过 git 钩子的推送写法 → 放行并留痕，这棵树的下一次正常推送被 `check:push-bypass` 拦下，直到有人看过 `--accept`；有绕口写法却归因不了是哪棵树（`--git-dir` / 引号不配对 / 命令理解层缺失）→ exit 2；不带新内容的推送（HEAD 的提交都已在远端跟踪分支上）→ 跳过钩子也不留痕；CI 红 → 不合并。没有界面文案。 | `scripts/pre-push-check.node-test.mjs`、`scripts/check-hook-behavior.node-test.mjs`、`scripts/check-push-bypass.node-test.mjs` |
| ★9 验收与回滚 | 见下面清单；回滚 = revert 本 PR 的 commit（戳回来，规矩回到旧版）。不是四类，不强制独立验收线，协调合并后用真实推送核一遍。 | 下面每项的命令 |

### 功能分类

- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

（只改门岗脚本、钩子、测试与文档，路径推不出类别。）

## 跳过 git 钩子的推送：留痕，不拒绝

任务书让这条线在「照旧留痕交 `check:push-bypass` 审计」和「直接拒绝」之间定。定为**留痕**，理由：

1. `check:push-bypass` 本身在快检的门岗集合里（`scripts/pre-push-gate-table.mjs`），快检一行不许改。改成拒绝，`check:push-bypass` 就成了没有写方的读方——一道永远绿的死门岗，P1 不允许，又不能从快检里删。
2. 推送阶段跳过快检的代价至多是多一轮 CI：完整门岗在 CI，CI 全绿才合并，进不了 main。而快检自己坏了 / 本机环境不对时，推上去交给 CI 判是合法出路。提交阶段那边没有合法场景（敏感数据扫描在 pre-commit），所以那边是拒绝（`docs/lessons/commit-bypass-must-be-blocked-not-audited.md`）。
3. 新判据不认任何本机凭据：以前「同 SHA 有戳就自动确认」删掉了，每条没确认的绕口都红，确认只能是人看过之后的 `--accept`（看 CI 在那个 SHA 上全绿，或在那棵树补跑一次快检）。

## ★9 验收清单与反例（动手前定好，实现线按它自验）

1. 有代码改动、本树从没跑过 `pnpm run gates` 时，Claude 钩子对一条普通 `git push origin HEAD:x` 放行（exit 0）——用钩子测试里「喂 JSON 跑钩子」的方式钉住，不真推。
2. 反例：`git -C <别的树> push`、`cd a && cd b && git push`、`git -c k=v push` 这些写法和普通推送同样判（不因为写法不同被拦或被放过跳钩子的形状）。
3. 反例：跳过 git 钩子的推送写法（至少 `--no-verify`）按新判据处理且有测试；`check:push-bypass` 的判据不再读戳，有测试证明「有戳也不算数、没戳也不因此判红」。
4. `node scripts/pre-push-contracts.mjs --list` 的输出与 origin/main 上一模一样。
5. 全仓现役代码 / 文档里不再有这枚戳：`git grep -n -E "nomi-gates-ok|stamp-gates-ok|五门戳"` 只剩带日期的历史文档、lessons、旧 plan（逐条列出剩下的并说明为什么是历史）。
6. R11 新文字落在 `docs/engineering/rules.json`；`pnpm run gen:agents` 跑过；`pnpm run check:agents-sync`、`pnpm run check:rule-aliases` 绿。
7. `scripts/claude-hooks/self-check.sh` 的 ③ 改成新说法；`node --test scripts/self-check-hook.node-test.mjs` 绿。
8. 这些单独跑全绿：`pnpm run check:claude-hooks`、`check:hook-behavior`、`check:push-bypass`、`check:root-cause-contracts`、`check:boundary-owners`、`check:concept-owners`、`check:gates-chain`、`check:self-written`、`check:prior-art`（`NOMI_PR_BODY_FILE=.tmp-pr-body.md`）、`typecheck`、`lint:changed`。
9. `git diff --stat origin/main -- .github scripts/pre-push-contracts.mjs scripts/merge-preflight.mjs scripts/git-delivery.mjs scripts/validation-policy.mjs scripts/with-gates-lock.py` 为空。
10. 这一类会从哪回来：别的会话 / 子 agent 照旧在推前跑完整门岗等戳（文档没改干净）、技能或任务书模板里还写着「push 前 pnpm run gates」（`.agents/skills/**`、`docs/engineering/*template*`）、新的 hook 又读回一份「过没过」的本机凭据。

反例（出现任何一条就是没做对）：加了环境变量 / 参数让快检变小或跳过；改了快检的门岗清单；动了 CI / 合并前扫描 / 收据；保留了一份「可选」的戳读方；CLAUDE.md 多出段落。

自验结果（「反例 → 结果 → 证据」逐条）在 PR 正文 `## 验收证据`。

## 已知限制与后续

- 全仓敏感数据扫描（`check:secrets --all`）从此只在 CI 上跑（它在 `scripts/pre-push-gate-table.mjs` 的 CI_ONLY 里），推送前只剩 pre-commit 对暂存区的扫描与 Claude 钩子对 `commit --no-verify` / `add -f` 的拒绝。用非 Claude 客户端 `commit --no-verify` 绕过 pre-commit 的内容，第一次被全仓扫描看到是在 CI 上，那时分支已在远端。要补，是往快检里加一道「只扫 origin/main..HEAD 改动文件」的敏感数据扫描——那要改快检门岗表，不在本线范围。
- `scripts/run-gates-tests.mjs` 的档位记录（gitdir 里的 `nomi-gates-tier`，`writeTierRecord` / `readTierRecord`）原本只喂给签发脚本，签发方删掉后全仓零读方：协调 10-24 在本 PR 补提交删掉（写的那一处调用连同三个定义一起删）。
- 历史根因合同里两条「机器读不了」的边界（`2026-09-02-push-gate-stamp-identity` 里 push 闸的「戳的三项核验」、`2026-09-03-push-bypass-audit-trail` 里 `check-push-bypass.mjs` 的「main gate logic」）描述的不变量已经退役或改了，但边界主人台账只给「路径 / 符号不在了」的边界设退役桶，这两条只能留在 `unreadable_symbols` 普查里。
- 快检比完整门岗少，分支上 CI 红的次数可能上升（不碰 main）；协调合并后用真实推送核一遍推送前等待与 main 收据。
