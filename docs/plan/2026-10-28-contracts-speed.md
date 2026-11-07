# 设计卡：CI「合同检查」别再撞 30 分钟上限——`check:claude-hooks` 里真入口测试的重门岗只跑 4 次

```
改动名：contracts-speed   线/负责人：I-contracts-speed（Mac，Claude Sonnet，实现 · 测试基础设施）   类别：[其他]（测试 / 门岗基础设施；只改 scripts/ 与 docs/，不碰 electron/、src/）
```

- 状态：协调任务书 `briefs/20261028-mac/I-contracts-speed.md`（2026-10-28，发版流程项）。先量、再修；本卡在量完之后、动测试代码之前定稿，并单独提交。
- 方向检查：不适用。`node scripts/fix-churn.mjs scripts/pre-push-contracts.node-test.mjs` → 「未命中热点」；改法是「换」（每条各跑一遍 → 同类合成一次），不是再补一刀。
- 基线：origin/main `889255e98`（#1360 合入）。CI 数字取自这个提交的 main push：run 40571798221 / job 122427664160（`gh run view --job … --log`，只读一次）；本机数字取自同一个 HEAD。

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能（路径只在 `scripts/` 与 `docs/`，不新增用户操作；★7 不适用：开发者工具，无交互预算）

## 先量

### CI（ubuntu-latest；公开仓库的标准 Linux runner = 4 vCPU / 16 GB / 14 GB SSD，<https://docs.github.com/en/actions/reference/runners/github-hosted-runners>）

10-27 一天里 8 次 Contracts job（`gh run view <run> --json jobs`）：19.0 / 21.5 / 25.2 / 27.1 / 27.2 / 27.4 / 28.9 / 29.6 分钟；上限 `.github/workflows/quality-gate.yml:83` `timeout-minutes: 30`。其中「Static contracts, lint, and types」一步 17.8–26.2 分钟，checkout 一步 0.5–3.4 分钟——同一类代码上下浮动 ±25%，30 分钟的余量只有 1–2 分钟。

889255e98 那次（28.9 分钟）：

| 项 | 数 |
|---|---|
| 门岗数 / 顺序执行 | 107 道，`scripts/run-gates-contracts.mjs` 一道接一道（日志 `▶ [74/107] check:claude-hooks`） |
| 各门耗时之和 | 1568 秒 |
| `check:claude-hooks` | **898.5 秒 = 57%**（第二名 typecheck 107.3、第三 lint:ci 84.5、第四 check:walkthroughs 39.2） |
| `node --test` 汇总 | 231 条、231 过、0 跳过，`duration_ms` 898119.9 |
| 11 个测试文件 | `pre-push-contracts.node-test.mjs` 26 条用例**合计 888.9 秒**（= 整条命令 898 秒的 99%）；其余 10 个文件在最初十来秒内跑完 |
| 克隆 + 检出 + 收尾（用例之外的开销上限） | 约 9 秒（898.1 − 888.9；这 9 秒里还含其余 10 个文件并发时的争用） |

这 26 条里（CI 秒）：改了代码的真入口运行 10 条（11 次钩子运行）**832.0 秒（93.6%）**，每次 38.99–165.81；只改文档的 7 条（9 次运行，每次约 4.5）合计 35.6；立刻返回的 5 条合计 1.0；tsc 探针 15.8；超时用例 3 条各 1.5。

| 用例（旧） | CI 秒 | 改了什么 |
|---|---|---|
| 必红 filesize | 165.8 | `electron/main.ts` +80 行（第一次，typecheck 缓存是冷的） |
| 必红 ipc-sender-binding | 61.9 | 新增 `electron/*.ts` |
| 分离 HEAD 推分支 | 77.9 | `electron/main.ts` +80 行 |
| 推 tag | 78.2 | `electron/main.ts` +80 行 |
| 必红 test:temp-helper | 41.1 | 新增 `tests/ux/*.walk.mjs` |
| 必红 vocabularies | 86.1 | 新增 `src/*.ts` |
| 必红 store-lifetime | 86.7 | 新增 `src/workbench/**/*.ts` |
| 必红 scan-guard-census（红一次 + 登记后转绿一次） | 149.6 | 新增 `electron/*.structure.test.ts`，再登记 `scripts/pre-push-scan-guards.mjs` |
| 必红 pre-push-structure | 39.0 | 改 `scripts/pre-push-gate-inputs.mjs` |
| 必红 related（build 脚本） | 45.8 | 改 `scripts/build-electron.mjs` |

### 本机（Mac，10 核；同一个 HEAD `889255e98`；经门岗锁；5 分钟负载 18.6 → 22.5，机器上同时还有别的线在跑，所以绝对值只作参照）

`pnpm run check:claude-hooks`，带计时预加载（只记 `child_process` 调用的起止，测试代码一字不动），退出码 0：

| 项 | 数 |
|---|---|
| 墙钟 | **280 秒**（`node --test` 的 `duration_ms` 279.7；231 条全过） |
| CPU（`/usr/bin/time -l`，user + sys） | 1511.7 秒（= 墙钟的 5.4 倍）；单个进程最大常驻内存 4.5 GB |
| 11 个文件各自单独跑 | `pre-push-contracts.node-test.mjs` 26 条合计 **273.5 秒（98%）**；其余 10 个各 0.0–6.8 秒（合计 19.6）：structure 6.8、fix-churn 3.2、install-claude-hooks 2.5、commit-bypass 2.3、pre-push-check 2.2、self-check-hook 2.1、edit-time-reminder 0.3、其余三个 ≤ 0.1 |

大文件里时间花在哪（按调用分类，31 次钩子真入口 + 22 次 reset + …）：

| 阶段 | 次数 | 秒 | 占用例合计 |
|---|---|---|---|
| `git clone --shared --no-checkout` | 1 | 0.06 | 0.0% |
| `git checkout`（整仓检出，~0.87G） | 1 | 5.12 | 1.9% |
| `git reset --hard` | 22 | 2.08 | 0.8% |
| `git add` + `git commit` | 21 + 21 | 1.40 + 0.71 | 0.8% |
| 钩子真入口（`spawnSync pre-push-contracts.mjs`） | 31 | **260.5** | **95.2%** |
| 　其中改了代码的重运行 | 11 | **242.1** | 88.5% |
| 　其中只改文档 / 立刻返回 | 20 | 18.3 | 6.7% |

→ 任务书的线索「检出太大」不成立：克隆 + 检出 + reset + 提交加起来 9.4 秒（3.4%）；「文件头注释写稀疏检出、代码里没有」属实，但就算真做了也省不到 5 秒。大头是 11 次重运行。

11 次重运行（本机秒，括号里是该次最慢的几道门）：必红 filesize 38.3（冷：typecheck 37.8）· ipc 13.6 · 分离 HEAD 18.8 · 推 tag 18.0 · temp-helper 38.1（check:walkthroughs 37.4）· vocabularies 25.0 · store-lifetime 23.5 · census 红 12.5 + 转绿 23.4 · pre-push-structure 14.7 · build 脚本 16.2。这 11 次里各门耗时之和 1050.6 秒，最贵的几道：`check:test-waits` 145.5（每次 ~13，扫全部测试文件语法树，与改了什么无关）· `test:scan-guards` 137.9 · `typecheck` 128.8（8 次）· `check:walkthroughs` 62.7 · `test:related` 60.2 · `check:tokens` 59.3 · `check:vocabularies` 56.1。每一次只为断言其中**一道**门红了或绿了。

### 场景探针（同形夹具，同一个 HEAD；不进仓库，用来在动手前验证设计）

| 场景 | 钩子墙钟 | 钩子 CPU | 选中 | 红的门 |
|---|---|---|---|---|
| S1 七份红证明合成一次提交 | 33.3 | 226.5 | 72 | 七条要看的全在（filesize、ipc-sender-binding、temp-helper、vocabularies、store-lifetime、scan-guard-census、pre-push-structure），另多 test:related（探针里的 unbound ipc 让 `check-ipc-sender-binding.test.mjs` 的夹具复制红了）、check:self-written |
| S2 只填充 `electron/main.ts`（分离 HEAD 形态） | 15.7 | 127.5 | 61 | check:filesize |
| S3 新增一个 900 行没人引用的 `electron/*.ts` | 12.2 | 95.9 | 61 | check:filesize、check:self-written |
| S4 扫描探针 + 登记（转绿） | 22.5 | 151.6 | 66 | 无 |
| S5 只改 `scripts/build-electron.mjs` | 15.8 | 91.6 | 48 | 无（`vitest 2 个文件通过；node:test 1 个文件通过`） |
| S6 = S4 + S5 合成一次 | 25.0 | 169.0 | 66 | 无（`test:related` 与 S5 一字相同：被登记的探针归扫描型守卫批量跑，不混进相关单测） |
| S0 只改文档 | 2.1 | 8.4 | 39 | 无 |

S1 的 stderr 拿去对七条用例里全部 12 条 `match` 正则（取自测试文件）：全部命中。

## 根因（先分清症状 / 直接原因 / 类根因）

- 症状：Contracts job 27–30 分钟、偶尔 30 分 24 秒被砍；合并时不时被它卡住。
- 直接原因：一个测试文件里 10 条用例各自提交一份代码改动、各自把**整套**重门岗真实跑一遍，只为断言其中某一道门红了 / 绿了；这 11 次占该文件 88.5%（本机）/ 93.6%（CI）。
- 类根因：夹具的接口（`commitChange` + `prePush`）让「每条证明 = 一次整套重门岗运行」成为唯一的写法，而且没有任何东西度量或限制这种运行的次数——每新增一道推送前门岗的必红证明，CI 就多 40–160 秒；唯一的告警是 30 分钟被砍。文件头注释还写着「稀疏检出」，代码里没有，掩盖了真实的成本模型。
- 数门（`node scripts/door-map.mjs commitChange --roots=scripts,tests,evals --include-tests`）：写入口 1 扇（`scripts/pre-push-contracts.node-test.mjs`，21 处出现）；整仓克隆的夹具全仓只有这一份（`git grep -n "'--shared'" -- scripts tests electron`）。
- 为什么「让夹具只触发它要测的那道门」做不到：`check:filesize` 只看 `src/` `electron/` 的 ts，`check:ipc-sender-binding` 只看 `electron/`，`check:vocabularies` / `check:store-lifetime` 只看 `src/`；这些目录下任何 ts 改动都选中 typecheck + 扫描型守卫批量 + lint + 相关单测 + `check:test-waits`（场景 S3：一个没人引用的新文件也有 61 道）。触发面缩不小，只能让重门岗少跑。

## 先查别人

- Node 官方文档 <https://nodejs.org/api/test.html>（Test runner execution model）：「each matching test file is executed in a separate child process」，文件数并发由 `--test-concurrency` 管（<https://nodejs.org/api/cli.html>：默认 `os.availableParallelism() - 1`，CI 上 = 3）；同一文件里的测试「will be executed within a single application thread, regardless of the value of the concurrency option」· **确认了**同一个文件里的重运行不可能靠 `concurrency` 并行；要快只能少跑，或把文件拆开让 runner 文件级并行——后者要搬测试（会和「流程分档」线在同一个文件里冲突），而且 4 vCPU 已被 typecheck（5 个 tsc，本机单个进程最大常驻 4.5 GB）+ vitest 占满，并行多份夹具还会共写 `node_modules/.cache/nomi-typecheck`。**决定**：少跑，不拆文件，不并行。
- git sparse-checkout <https://git-scm.com/docs/git-sparse-checkout>：只决定工作树里放哪些路径（路径外的文件真的不在盘上），不动对象库（`--shared` 本来就不复制对象）；cone 模式是默认、非 cone「deprecated」；「THIS COMMAND IS EXPERIMENTAL」· **确认了**稀疏检出省的只是写盘：本机克隆 0.06 秒 + 检出 5.1 秒、CI 整个文件 898 − 889 约 9 秒；而 37 道总跑门岗里不少读 `docs/` 登记表（如 `check:board-parity` 读 `docs/design/boards/`），路径清单就是又一张会漂的手写表（本仓已为这类表交过学费，见 `scripts/pre-push-gate-inputs.mjs` 抬头）。**决定**：不做真稀疏检出，文件头注释改成实话。
- Martin Fowler《Eradicating Non-Determinism in Tests》<https://martinfowler.com/articles/nonDeterminism.html>（Lack of Isolation）：「Keep your tests isolated from each other, so that execution of one test will not affect any others.」「Properly isolated tests can be run in any sequence.」· **改了**共用运行的写法：共用的是一次懒计算出来的**值**（不是可变状态），任何一条用例先跑都一样，单跑一条（`--test-name-pattern`）也成立。
- 仓库内先例：`scripts/pre-push-contracts.mjs` 的 `SCAN_TESTS` 里 `test:pre-push-structure`（上一轮已把「快的结构用例」拆去 `pre-push-structure.node-test.mjs`，推送前跑它）和 `scripts/pre-push-related-tests.mjs` 的 `SLOW_TEST_FILES`（这个文件被明确标成「只在 CI 跑的慢文件」）· **确认了**这个文件的归宿是 CI，所以不能用「搬去推送前」解决。

## ★1 用户怎么用

当我（或协调、或任一条线）推一个 PR，我想让 CI 的 Contracts 稳稳在 30 分钟里跑完，不再被 `check:claude-hooks` 这一道占掉一半以上，以便合并不被它卡住；本机 `pnpm run gates` 也跟着少花几分钟。

1. PR 一推，Contracts job 顺序跑 107 道门岗；
2. 轮到 `check:claude-hooks`：`node --test` 把 11 个测试文件按文件并发起来；
3. `pre-push-contracts.node-test.mjs` 先在系统临时目录克隆一个夹具仓库（整仓检出）；
4. 「必红」证明：7 份探针改动合成**一次**提交，真入口钩子**只跑一次**，各条用例断言自己那道门红了；
5. 「转绿」证明：登记后 census 转绿 + 改 build 脚本后相关单测通过，合成**一次**提交、钩子只跑一次；
6. 另外 2 次必须独立的重运行：分离 HEAD、新 tag（各要自己的 stdin 形态）；
7. 其余只改文档的运行各约 4.5 秒（CI），不动；汇总：用例数 233（231 + 2 条护栏），0 跳过。

**不做什么**：不加超时、不删测试、不跳测试、不改任何旧断言（新旧断言行按多重集比对，被删 / 被改 0 条）；不动钩子实现（`scripts/pre-push-contracts.mjs` 等）、不动 `src/` `electron/`；不真做稀疏检出；不把这一道拆出 Contracts（拆是换个地方跑，不是变快，且改 `.github/workflows/` 属高风险路径，要协调另派）；不拆测试文件、不改 T7 / T9 的边（会和「流程分档」线同文件冲突）。

**已知坑**：① 合成一次运行会让「别的探针替它选中那道门」→ 第一条护栏单独核；② 同一道门的两种不同的红证明不能共用一次运行（会互相替）→ 写在 `RED_PROBES` 注释里；③ 合成的红证明里除了各用例点名的门，还会多出别的红（`check:self-written`、`test:related`），没有用例断言它们——要断言某道门的绿，放进 `GREEN_PROBES`；④ 重门岗本身变慢（typecheck 107 秒……）不在本单，次数已压到 4 次；⑤ CI 机器同一类代码上下浮动 ±25%，所以对比口径看 `check:claude-hooks` 这一行和逐条用例耗时，不只看 job 总时长。

**真实任务**（真仓库、真钩子、真 CI 日志，不是合成夹具）：① 本机经锁真跑 `pnpm run check:claude-hooks`：改前 2 次（基线 HEAD 上带计时预加载 1 次，即上表；同一棵树同一个 HEAD 上用基线测试文件的搬家副本再 1 次）、改后 2 次，后三次在同一次持锁里交错（新 → 旧 → 新）；② 协调推送后读 CI 的 Contracts job 与 `✅ check:claude-hooks (N s)`；③ 本 PR 自己的推送前快检（`NOMI_PR_BODY_FILE=.tmp-pr-body.md node scripts/pre-push-contracts.mjs`）退出码 0。

**指标**（目标 → 信号 → 指标，每个点名量具）：
- 主：Contracts 不再撞 30 分钟 → `check:claude-hooks` 墙钟 → CI 上 898.5 秒降到 ≤ 550 秒（−39% 以上），Contracts job ≤ 23 分钟。量具：CI 日志行 `✅ check:claude-hooks (N s)` 与 job 起止时间（协调推送后读）；本机 `pnpm run check:claude-hooks` 经锁，`/usr/bin/time -l` 的墙钟与 user+sys。基线：CI 898.5 s；本机 280 s / CPU 1511.7 s。预测（CPU 比例法：重运行 11 → 4，CPU 由约 1380 降到约 650 + 非重运行约 130）：CPU 约降一半，CI ≈ 450–550 s。
- 质量：必红仍红 → 反例 F1–F5 全部真红、按字节还原后回绿；旧断言行被删 / 被改 = 0；用例数 233、0 跳过。量具：`cx` 一次性分支上的全文件运行 + 断言行比对脚本（输出贴报告）。
- 护栏：选中整套重门岗的真入口运行 ≤ 4 次（量具：新增的预算护栏用例）；共用不掩盖选择范围（量具：新增的第一条护栏用例）。

**★1b 连带界面**：不适用（开发者工具，没有 Agent 回执 / 通知 / 错误卡）。失败时读的是 `node --test` 的用例失败输出：两条护栏的消息写明「该怎么改」。

## ★2 谁说了算

- 概念：不新增、不改动任何 `concept-owners/` 概念。夹具状态（`work`、`baseSha`、两次合成运行的结果）只活在这个测试进程里，不跨进程、不落盘；唯一 owner = `scripts/pre-push-contracts.node-test.mjs`。门表：`node scripts/door-map.mjs commitChange --roots=scripts,tests,evals --include-tests` → 写入口 1 扇（同一个文件，21 处出现）。
- 「哪些改动算红 / 绿证明」这件事存 1 份：`RED_PROBES` / `GREEN_PROBES`（`gate` / `files` / `apply` 在同一个对象里；`files` 与 `apply` 是否同源由合成时的 `git diff --name-only` 核对）。门岗清单仍归 `package.json` 的 `gates:contracts`，选择表仍归 `scripts/pre-push-contracts.mjs`，本卡不新增第二份。
- 没有靠「东西不见了 / 状态变了」去猜意图：重门岗是否选中，直接读钩子入口自己打的那行「改动 N 个文件，跑：…」。

## ★3 一致与复用

- 同类：全仓整仓克隆的夹具只有这一份。复用：`makeTempDir`（临时目录归属）、`isolatedFromCiBaseRefs`、`pre-push-contracts.mjs` 导出的 `PRE_PUSH_GATES` / `SCAN_TESTS` 的 `when`（第一条护栏直接读，不抄第二份）、`pre-push-related-tests.mjs` 的 `relatedTests`（核 build 脚本 → electron-build.test.mjs 的映射）。
- 评估过的现成方案：git 稀疏检出（不做，收益 < 9 秒，且路径清单是又一张手写表）；`node:test` 的并发（同文件内无效，见先查别人）。理由是收益，不是领域约束；都不引入新依赖。
- 第二份定义：没有。旧写法（十条用例各自 `commitChange(...)` + `prePush()`）同提交换成 `sharedRedRun()` / `sharedGreenRun()`（P1 加新必删旧）；分离 HEAD 与新 tag 仍用旧写法，是因为它们要的就是各自独立的一次运行，预算护栏把这件事钉成 4 次。

## ★4 全状态（开发者工具，输出中文，和现有输出一致，不进 i18n）

| 状态 | 看到什么 |
|---|---|
| 成功 | 233 条全过，0 跳过；预算护栏那条也过 |
| 一条「必红」没红 | 那一条用例红，消息是整段钩子 stderr（`assert.equal(result.status, 1, result.stderr)` 等旧断言不变），可对照里面的 `✅` / `✖` 行 |
| 共用运行起不来（探针 `apply` 抛错 / 夹具提交失败 / `files` 与实际改动不同源） | 依赖它的用例同一条报错，指向哪份探针；不吞 |
| 选择范围缩小了 | 第一条护栏红，点名哪道门、哪些路径 |
| 重门岗运行多了 | 最后一条护栏红，写明预算、怎么改（加进 `RED_PROBES` / `GREEN_PROBES`，别另起一次）、确需新增再改预算并写明理由 |
| 取消中 / 超时 | 不变——单门超时、整体超时、分发器超时三条既有用例照旧 |
| 部分成功 | 逐条用例独立；共用运行的结果是值，某条红不影响别的条读它 |
| 过期 / 能力不可用 | 不适用 |

## ★9 验收与回滚

**回滚**：revert 测试实现提交即恢复修前行为（只改 `scripts/pre-push-contracts.node-test.mjs` 与 `docs/plan/`，无迁移、无数据）。

**验收**：另一条线 / 协调用下面的命令一字不改地复核；本单不属于花钱 / 长跑 / 可打断 / 新界面四类，不强制独立验收线。

### A 验收项（实现线逐条自验，报告贴「命令 + 退出码」）

1. 断言一字不动：基线版本（`git show 889255e98:scripts/pre-push-contracts.node-test.mjs`）与新版里所有含 `assert.` 的行（去首尾空白）按多重集比对：旧断言行（81 条）被删或被改 = 0；新增 = 4 条（合成运行里 `files` 与实际改动同源 1、第一条护栏 2、预算护栏 1）。
2. `pnpm run check:claude-hooks` 退出码 0：`ℹ tests 233`、`pass 233`、`fail 0`、`skipped 0`、`cancelled 0`（基线 231 条 + 2 条新护栏）。
3. 本机耗时：改前 2 次、改后 2 次，贴墙钟、user+sys CPU、起止负载。改前 = 基线 HEAD 上带计时预加载的一次（上表）+ 同一棵树同一个 HEAD 上跑基线测试文件的搬家副本（只改 import 路径与 `repoRoot`）一次；改后 = 新版两次；后三次在同一次持锁里交错（新 → 旧 → 新），唯一的变量是那一个测试文件。
4. 新版带计时预加载跑一次：选中整套重门岗的钩子运行恰为 4 次（合成的红证明 1、合成的转绿证明 1、分离 HEAD 1、新 tag 1）；各阶段（克隆 / 检出 / reset / 提交 / 钩子）分项。
5. B 表反例全部真红，按字节还原后回绿（还原后的树 hash 与任务分支一致）。
6. `pnpm run gates` 退出码 0（自己拿锁，不再套）；推送前快检 `NOMI_PR_BODY_FILE=.tmp-pr-body.md node scripts/pre-push-contracts.mjs`（经锁）退出码 0，最后几行贴报告；`.tmp-pr-body.md` 过 `pnpm run check:pr-judgement`。
7. CI 对比口径（协调推送后读）：基线 = main 上 889255e98 的 run 40571798221 / job 122427664160（Contracts 28.9 分钟；`✅ check:claude-hooks (898.5s)`；`ℹ tests 231`；`duration_ms 898119.9`；107 道各门之和 1568 秒）。推送后取 PR 上最近一次 Contracts job：`gh run view <run> --job <id> --log` 读一次，看 ① `✅ check:claude-hooks (N s)`；② `ℹ tests 233 / pass 233`；③ job 起止时间；④ `pre-push-contracts.node-test.mjs` 各条用例耗时（预期：第一条需要合成红证明的用例付一次整套的钱，另外 6 条「必红」读结果、接近 0；转绿那条付一次；分离 HEAD / 新 tag 各约 78 秒不变）。同一类代码 CI 上下浮动 ±25%，以 ①④ 为准，不只看 ③。

### B 反例（必须真红，再按字节还原后回绿；每条记「反例 → 哪几条红 → 证据」）

在一次性分支 `cx/contracts-speed-faults`（从任务分支末尾切出，做完删除）上一次注入五个互相独立的故障，跑全文件；再把它们按字节还原（`git restore --source=<任务分支> --staged --worktree -- <文件>`）、核对还原后 `git rev-parse HEAD^{tree}` 与任务分支相同，再跑全文件。

| 反例 | 预期红的用例 | 预期仍绿（说明各自可归因） |
|---|---|---|
| F1 `scripts/check-file-sizes.mjs` 一进来就 `process.exit(0)`（门岗被弄坏） | 「必红：改了 electron/main.ts 超出基线」 | 其余必红 |
| F2 `scripts/check-ipc-sender-binding.mjs` 一进来就 `process.exit(0)` | 「必红：新增未加固的 ipcMain.on」 | 其余必红 |
| F3 `RED_PROBES` 里删掉 vocabularies 那份探针 | 「必红：src 新增未登记的 type union」（别的探针偷不了它的绿） | 其余必红 |
| F4 `check:store-lifetime` 的选择范围缩到只剩另一个探针的固定文件 | 第一条护栏「共用一次运行不掩盖选择范围」；而「必红：新增一个没有 declareStoreLifetime 的 zustand store」**仍绿**（被别的探针替它选中——这正是第一条护栏存在的理由） | |
| F5 在最后一条护栏之前再塞一条旧式 `commitChange(代码改动)` + `prePush()` | 最后一条预算护栏（5 > 4） | 其余 |

### C 这一类会从哪些入口、形状、边界、版本回来

| 回来的路 | 对策 | 状态 |
|---|---|---|
| 以后又新增一条「必红 / 转绿」证明，又各跑一遍整套 | `RED_PROBES` / `GREEN_PROBES` 只收「改动」；预算护栏钉住次数（F5） | 本单覆盖 |
| 合成一次运行掩盖选择范围缩小 | 第一条护栏逐条单独核（F4 证明它有牙，也证明 store-lifetime 那条单看会被掩盖）；build 脚本 → `electron-build.test.mjs` 的映射单独用 `relatedTests` 核 | 本单覆盖 |
| 某份探针不再造成它自己那道门的红（被别的探针替红） | 各用例原有的 `match` 点名各自的探针（`PrepushProbeState`、`useProbeStore`、探针文件名）；F3 | 本单覆盖（部分） |
| `files` 声明与 `apply` 实际改动漂开，第一条护栏核错路径 | 合成时 `git diff --name-only` 与 `files` 并集做 `deepEqual` | 本单覆盖 |
| 同一道门要两条不同的红证明（如 filesize 的「超基线」与「新文件超 800 行」） | 不能共用一次运行（会互相替），要另起一次并改预算写明理由 | 约定写在 `RED_PROBES` 注释里，不是结构 |
| 重门岗本身变多 / 变慢，每次运行更贵 | 次数已压到 4；Contracts 单门耗时预算告警是另一刀，建议协调另派 | **残余风险**，写进报告 |
| 另一个测试文件仿照这里整仓克隆 | 全仓目前只有这一份；没有新增门岗拦它 | **残余风险** |
| CI 机器波动 ±25% | 对比口径看分项，不只看总时长 | 口径 |
| 「流程分档」线同时在改推送前判据，也可能往这个文件加用例 | 新增重运行会撞预算护栏，被迫走 `RED_PROBES` / `GREEN_PROBES` 或明写理由；本单不搬测试、不碰 T7 / T9 / 其它非重运行用例，只改夹具搭建，减少冲突面 | 已沟通（见报告） |
| Linux / Windows | 本机只验了 macOS；Linux 以 CI 为准；Windows 未验 | **unverified** |

### D 真实条件

macOS 本机、经锁、真仓库、真钩子、真 `$TMPDIR`（前后数 `nomi-prepush-*`）。Windows / 英文界面 / 最小窗口 / 真付费 / 键盘全程：不适用（开发者工具，无界面、不花钱）；Linux CI 的数字由协调推送后读。

### E 自验命令

```
python3 /Users/aoqimin/Desktop/Nomi/.claude/worktrees/coord-main/scripts/with-gates-lock.py -- pnpm run check:claude-hooks
python3 <断言行比对脚本> <基线测试文件> scripts/pre-push-contracts.node-test.mjs
NOMI_PR_BODY_FILE=.tmp-pr-body.md node scripts/pre-push-contracts.mjs   # 经锁
pnpm run check:pr-judgement
pnpm run gates                                               # 自己拿锁，不再套一层
```
