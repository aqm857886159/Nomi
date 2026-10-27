# 设计卡：测试与走查的临时目录按「创建者进程号」归属，进程被杀后有人收

```
改动名：test-tmp-pid-reclaim   线/负责人：I-test-tmp-leak（Mac，Claude Sonnet，实现线）   类别：[其他]（测试 / 门岗基础设施；不碰 electron/、src/）
```

- 状态：协调已定设计（2026-10-28）；本线先写卡、再写失败用例、再动代码。只因概念口径命中热点（`node scripts/fix-churn.mjs scripts/_test-temp.mjs` → 概念「测试与走查的临时目录归属」14 天第 7 个 fix），要改的文件本身不是热点，改法是「换」——按 P1 例外由协调代批（10-28），事后报用户。
- 方向检查（取自调查报告 R-test-tmp-leak）：`docs/engineering/direction-checks/2026-10-28-test-temp-reclaim.md`。
- 调查事实已逐条对过 origin/main 94eb65a88 的文件:行：`scripts/pre-push-contracts.node-test.mjs:38` 整仓克隆进 `nomi-prepush-`（0.85G）；`scripts/_test-temp.mjs:13` 清理只靠 `process.once('exit')`；`scripts/pre-push-contracts.mjs:337`（单门超时）与 `:378`（整体超时）经 `scripts/lib/processTree.mjs` 的 `killProcessTree` 对整个进程组发 `SIGKILL`——整组杀得到了孙进程，但创建目录的进程被 SIGKILL 杀死，退出钩子不会跑，目录留下。

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能（路径只在 `scripts/` 与 `docs/`，不新增用户操作；★7 不适用：开发者工具，无交互预算）

## 先查别人

- Node 官方文档，进程信号：<https://nodejs.org/api/process.html#signal-events>。原文 `'SIGKILL' cannot have a listener installed, it will unconditionally terminate Node.js on all platforms`；`'exit'` 监听器只能做同步操作 · **确认了**：`process.once('exit')` 管不了 SIGKILL，不能再当目录的唯一清理路径。
- Node `process.kill(pid, 0)`：<https://nodejs.org/api/process.html#processkillpid-signal>（"a signal of 0 can be used to test for the existence of a process"）+ POSIX `kill(2)`：<https://pubs.opengroup.org/onlinepubs/9699919799/functions/kill.html>（`[ESRCH]` 没有这个进程；`[EPERM]` 有但无权发信号）· **改了**判死规则：只有 ESRCH 才算「创建者没了」，EPERM 当活——共享 /tmp 里别的用户的目录不会被误删。
- 仓库内先例 `electron/assets/scratchCleanup.ts:24-30,62-79`（上传暂存目录 `.nomi-upload-p<pid>-xxxxxx` + `process.kill(pid, 0)` 判存活，EPERM 当活）· **确认了**「目录名带创建进程号 + 按进程是否存活回收」；**改了**两处：脚本侧多一道 uid 校验与 `lstat`（不跟符号链接），因为系统临时目录是共享的，而它的目录在用户项目根下。
- npm `tmp` 的 README：<https://github.com/raszi/node-tmp#graceful-cleanup>（`setGracefulCleanup()`："tmp will remove all controlled temporary objects on process exit"，没谈被信号杀死）· **确认了**主流 Node 临时目录库走的也是「退出钩子」路线，换库解决不了被杀；决定不引依赖。
- pytest `tmp_path` 文档：<https://docs.pytest.org/en/stable/how-to/tmp_path.html#temporary-directory-location-and-retention>（"By default, the last 3 temporary directories are kept"，按次数留，不看创建者死活）· **改了**不用「留最近 N 个」的数量法：我们的泄漏单位是 0.85G，留 3 个就是 2.5G，而进程号能直接回答「还有没有人要」。
- systemd `tmpfiles.d` 的 Age：<https://www.freedesktop.org/software/systemd/man/latest/tmpfiles.d.html#Age>（"If a file or directory is older than the current time minus the age field, it is deleted."）· **确认了**系统兜底是按年龄的，粗且慢（天级），而一次门岗超时就漏 0.85G；所以必须由创建者、杀手、下一个分配者按进程号自己收，不指望系统。

## ★1 用户怎么用

当我（或协调、或 CI）反复跑推送前快检、门岗、走查，其中有的被门岗超时 `SIGKILL` 杀掉，我想让这些进程建出来的系统临时目录在被杀之后也会被收回，以便磁盘不再一天涨 1.7G、不再要人手跑清理脚本。

1. 测试 / 走查进程用 `makeTempDir` 要临时目录，拿到的目录名带自己的进程号：`nomi-<前缀>-p<进程号>-<随机6位>`（前缀已以 `nomi-` 开头的不重复加；不以 `nomi-` 开头的调用方前缀会被补上，所以本仓库发放的目录都认得出）。
2. 进程正常退出：退出钩子立刻删自己建的目录（即时清理，和以前一样）。
3. 进程被 SIGKILL 杀掉（单门超时 / 整体超时）：`pre-push-contracts.mjs` 杀完整个进程组，等组里的进程真的没了，再回收「创建者已死」的目录。
4. 杀它的是别人（`git-hook` 分发器超时、手动 `kill -9`、崩溃、断电）：下一个任意进程第一次 `makeTempDir` 时，顺带回收同一系统临时目录下「创建者已死」的目录。
5. 创建者还活着的目录、别的用户的目录、不是这个命名形状的目录（包括形状碰巧一样、但名字不以 `nomi-` 开头的别的程序的目录）、符号链接，一律不动。

**不做什么**：不回收没带进程号的老泄漏（现存 10 份旧泄漏由清理脚本处理）；不按年龄猜；不改 `electron/`、`src/`（视频原生导入 `electron/assets/localFileImport.ts:163` 的暂存等 #14 合入后另派）；不改 vitest 的 `nomi-vitest-run-*`（`tests/setup/tempWorkspace.ts`，另议）；不动 `evals/`；`nomi-prompt-undo-mut*` 是验收线手抄的副本，仓库里没有创建点，由协调改派工通用规则。**已知坑**：进程号被别的活进程复用只会让回收变慢（把死进程当活），不会误删；PID 命名空间不同而共享 /tmp 的容器会误判，本仓不用容器（`.github/workflows` 无 `container:`）。

**真实任务**（真文件、真进程，不是合成夹具）：① 本机真跑一次 `NOMI_PR_BODY_FILE=<草稿> node scripts/pre-push-contracts.mjs`，前后各数一次 `nomi-prepush-*`；② 人为让 `pre-push-contracts.node-test.mjs` 那一步超时被杀一次（驱动脚本调真的 `runNode`，超时压到克隆建好之后），前后各数一次；③ 两个进程并发：一个活着、一个新来的，活着的目录不被收。

**指标**（目标 → 信号 → 指标，每个点名量具）：
- 主：被 SIGKILL 杀掉的测试进程树遗留的带进程号目录数 → 0。量具：`scripts/_test-temp.node-test.mjs` 的「真杀」两条 + 实测前后 `ls -d "$TMPDIR"/nomi-prepush-* | wc -l`。基线：10-24～10-28 漏 10 份、约 8.6G。
- 质量：误删数 = 0（创建者活着的、别的用户的、不是命名形状的、符号链接）。量具：同一测试文件的「不动」断言 + 反例 ②④⑤⑥。
- 护栏：每个进程第一次分配多一次 `readdir`（每个进程一次，不是每次分配）。量具：**未验证：缺入库量具**（时间断言被 `check:test-waits` 禁），本线用一次性脚本量 `readdir` 的耗时记进报告；入库的是结构性保证（反例 ⑦：第二次分配不再扫）。

## ★2 谁说了算

- 概念「测试与走查的临时目录归属」（`docs/engineering/concept-owners/delivery.test-temp-roots.json`）的唯一 owner 仍是 `scripts/_test-temp.mjs` 的 `makeTempDir`。本线碰这 1 个概念，不新增概念。
- 「这个目录归谁、还有没有人要」这件事**存 1 份**：创建者进程号写在目录名里，不另设登记文件、不另设注册表。谁允许读：只有 `_test-temp.mjs` 的回收函数 `reclaimAbandonedTestTemp`；杀进程的一方（`pre-push-contracts.mjs` 的 `terminateAndReclaim`）调用同一个函数，不自己重写判据。
- 门表（`node scripts/door-map.mjs makeTempDir makeTempDirAsync --roots=scripts,tests,evals --include-tests`）：写入口 384 扇、读入口 1 扇，**全部汇到 `makeTempDir` / `makeTempDirAsync` 两个符号**，所以改它们一处就覆盖全部；杀进程树的入口 7 扇（`node scripts/door-map.mjs killProcessTree --roots=scripts,tests,evals --include-tests`），本线只收 `pre-push-contracts.mjs` 的两处（其余五处靠「下一次分配时回收」结构性覆盖，见 ★9 C）。
- 没有靠「东西不见了 / 状态变了」去猜用户意图：判死用的是 `process.kill(pid, 0)` 的明确错误码 ESRCH，不是年龄、不是目录是否在被写。
- 产品侧同形实现 `electron/assets/scratchCleanup.ts`（上传暂存，另一个 owner、另一个概念）本线不动。

## ★3 一致与复用

- 同一件事的另一处做法：`electron/assets/scratchCleanup.ts:24-30,62-79`（目录名 `p<pid>-` + `process.kill(pid, 0)`）。**评估能不能共用一份实现：不能，照抄**——① 它是 TypeScript，住在 Electron 主进程里，依赖 `../jsonFile` 的 `retryOnSharingViolation` 与 `../logging/logger`；`scripts/_test-temp.mjs` 是纯 `node` 直接跑的 `.mjs`，没有 TS 加载器，也不许 import 产品代码；② 反过来产品代码不许 import `scripts/`；③ `_test-temp.mjs` 被构建链用到（`scripts/package-build-stamp.mjs:1`），并且被 `scripts/electron-build.test.mjs:50` 单文件拷进夹具，必须零依赖。共用要么动 `electron/` 的结构（本单不碰，也是任务书的停点），要么新建一个两边都能 import 的跨运行时模块——它需要一个构建步骤，代价远大于这 10 行判据。所以两份，各管一边：`scratchCleanup.ts` 管用户项目根下的上传暂存，`_test-temp.mjs` 管系统临时目录里的测试 / 走查目录；在 `docs/engineering/self-written.json` 登记 `test-temp-owner-reclaim`，写清为什么是两份。
- 脚本侧已有三份 `process.kill(pid, 0)` 存活判断（`scripts/vitest-fair-share.mjs:44` 的 `isAlive`、`scripts/lib/nomiClient.mjs:44`、`scripts/git-delivery.mjs:480`）。不复用它们的理由：`_test-temp.mjs` 必须零依赖（同上 ③），而且回收要的是比它们更保守的口径（只有 ESRCH 才算死、EPERM 与一切未知错误都算活）。这是第四份，登记在案；合并为一份是另一刀（需要先决定放哪、怎么随构建链拷贝），不在本单。
- 第二份定义：没有。旧的「只靠 exit 钩子」路径同一提交处理：目录一律带进程号、一律可回收；退出钩子保留为「创建者自己的即时那一半」——它只删本进程自己登记的目录（即时，不等下一个进程），回收删「创建者已死」的目录，两者对着同一批带进程号的目录、同一种 `fs.rmSync` 递归删除，没有第二份命名、登记或判据，`scripts/_test-temp.mjs` 抬头注释写清分工；`check-test-temp-static.node-test.mjs` 里只认几个固定写法的正则同提交删掉，换成按语法树的 `systemTempBypasses`。
- 复用的现成品：`typescript` 语法树（仓库已有依赖，`repoWriteScan.mjs` 同款），`killProcessTree`（`scripts/lib/processTree.mjs`），`fix-churn` / 棘轮基线的既有形状（`scripts/*-baseline.json`）。

## ★4 全状态

开发者工具，没有界面；输出中文，和 runner 现有输出一致，不进 i18n。

| 状态 | 看到什么 |
|---|---|
| 空（没有遗留） | 一次 `readdir`，没有匹配，不输出任何东西 |
| 加载中 | 不适用（同步一次扫描，每个进程每个临时根只做一次） |
| 成功 | 回收了 N 个：helper 静默；runner 在超时那一行后追加「；已回收 N 个被杀进程留下的临时目录」 |
| 失败 | 某个目录删不掉（被占用 / 权限）：吞掉，留给下一次分配时回收，不影响调用方 |
| 部分成功 | 逐个目录独立，一个失败不影响其余 |
| 取消中（刚杀完） | runner 先等整组进程真的没了（最多 5 秒）再回收；等不到就不回收，输出「有进程 N 秒内没退出，它们的临时目录留给下一次分配时回收」 |
| 过期 | 不按年龄；只看创建者死活 |
| 能力不可用 | 不适用 |

## ★9 验收与回滚

**回滚**：revert 本线的实现提交即恢复修前行为（只改 `scripts/` 与 `docs/`，无数据迁移）。已经带进程号的目录在回滚后只是名字多一段，旧助手照常用，不影响。

**验收**：另一条线 / 协调用下面的命令一字不改地复核。独立验收线不强制（不属于花钱 / 长跑 / 可打断 / 新界面四类）。

### A 验收项（实现线逐条自验，报告贴「命令 + 退出码」）

1. 单测：`makeTempDir` / `makeTempDirAsync` 建出的目录名带**本进程号**（`nomi-<前缀>-p<pid>-<6位>`；前缀没带横线、没带 `nomi-`、是空串都一样）。
2. 单测：第一次分配时，同一临时根下「命名形状对（`nomi-` 开头、带进程号尾巴）、创建者进程号已死」的目录被删；创建者**活着**的、进程号为 1（EPERM）的、别的程序的（不以 `nomi-` 开头）、形状不对的、没有进程号的老目录、普通文件、符号链接，全部不动，符号链接指向的外部目录内容也在。
3. 单测：只在这个进程第一次用某个临时根时扫，第二次分配不再扫（热循环里不反复 `readdir`）。
4. 单测：别的用户的目录不收（把 `process.getuid` 换成别人，创建者已死的目录也不删；Windows 跳过）。
5. 真杀：起一个子进程用 `makeTempDir` 建目录后被 `SIGKILL`，目录仍在（退出钩子没机会跑，这是症状本身）；**不经 runner**，下一个任意进程第一次分配就把它收掉。
6. 真杀（经 runner）：一棵进程树（组长 + 孙进程，**孙进程**建目录——和 `node --test` 起文件子进程同形），`terminateAndReclaim` 杀完后目录没了；创建者还活着的另一份目录不动。
7. 结构：`pre-push-contracts.mjs` 里所有 `killProcessTree(` 调用都在 `terminateAndReclaim` 里（单门超时、整体超时两处都走它，不留直接杀进程的口子）；整体超时的收尾期间任务池不能抢先 resolve、期限之后不再起新任务（`pre-push-structure.node-test.mjs` 的同形快用例，实现中被 `pnpm run gates` 的 `check:claude-hooks` 抓出来后补的）。
8. 门岗：`pnpm run check:test-temp-static` 绿；往 `tests/` 加一处 `mkdtemp(path.join(os.tmpdir(), 'x'))` → 红，还原后绿；基线只减不增（比基线多一处红，比基线少一处也红，要求同提交改小基线）。
9. 实测（经锁）：`NOMI_PR_BODY_FILE=<草稿> node scripts/pre-push-contracts.mjs` 跑完，`ls -d "$TMPDIR"/nomi-prepush-* | wc -l` 没有新增本线的目录；再用驱动脚本让真的 `runNode` 在 `pre-push-contracts.node-test.mjs` 那一步超时被杀一次，跑完同样没有残留。前后计数贴报告。
10. 交回前：`pnpm run gates` 退出码 0；推送前快检（`node scripts/pre-push-contracts.mjs`）最后几行贴报告；PR 正文草稿 `.tmp-pr-body.md` 过 `check:pr-judgement`。

### B 反例（必须真红，再**按字节还原**后回绿；每条记「反例 → 哪几条红 → 证据」）

| 反例 | 预期红的用例 |
|---|---|
| ① 目录名不带进程号 | A1，A5（带不进回收） |
| ② 回收不判创建者是否存活（会误删活进程的） | A2（活进程的目录被删） |
| ③ runner 杀完不回收 | A6 |
| ④ 把 EPERM 当「已死」 | A2 里进程号为 1 的那条 |
| ⑤ `lstat` 换成会跟符号链接的 `stat` | A2 里符号链接那条 |
| ⑥ 去掉 uid 校验 | A4 |
| ⑦ 每次分配都扫 | A3 |
| ⑧ 门岗：往 `tests/` 加一处直接 `mkdtemp(os.tmpdir())` | A8；另一反例：把基线某行改大 / 去掉对应文件 → 红 |
| ⑨ 在 `terminateAndReclaim` 之外直接调 `killProcessTree` | A7 |
| ⑩ 回收不认 `nomi-` 前缀（别的程序形状碰巧一样的目录会被碰） | A2 里 `foreign-tool-…` / `p<pid>-…` 那两条 |

### C 这一类会从哪些入口、形状、边界、版本回来（逐条写了对策，没有「只修这一处」）

| 回来的路 | 对策 | 状态 |
|---|---|---|
| 407 个调用方（门表 384 扇写入口）各自的清理 | 全部汇到 `makeTempDir` / `makeTempDirAsync`，一处改全覆盖 | 本单覆盖 |
| 新代码直接 `mkdtemp(os.tmpdir())` 绕开分配口 | `check:test-temp-static` 按语法树拦（含别名、`process.env.TMPDIR`、`/tmp` 字面量），存量登记为只减不增的基线 | 本单覆盖（`scripts/` 与 `tests/`） |
| 别的杀手：`git-hook` 分发器超时（`scripts/git-hook.mjs:39`）、`git-delivery.mjs:68`、`daily-radar-session.mjs:82`、`lib/nomiClient.mjs:133`、手动 `kill -9`、崩溃、OOM、断电 | 不逐个改：结构性靠「下一个进程第一次分配时回收」兜住 | 本单覆盖（结构性，延迟到下一次分配） |
| 进程号复用 | 只会把死进程当活（回收变慢），不会误删；活的永远不动 | 已分析 + 反例 ④ |
| 跨用户共享的 /tmp | EPERM 当活 + uid 校验 + `lstat` 不跟链接 | 反例 ④⑤⑥ |
| 符号链接 / 目录里带指向真仓库的链接（`pre-push-contracts.node-test.mjs` 的 `node_modules` junction） | `rmSync` 只摘链接不跟进；A2 钉住「外部内容还在」 | 反例 ⑤ |
| 同一提交没处理的旧泄漏（没带进程号） | 不追溯；现存 10 份由清理脚本处理 | 不归本单 |
| 其它根：`electron/assets/localFileImport.ts:163`（产品）、`tests/setup/tempWorkspace.ts`（vitest 运行根）、`evals/`（10 个文件 / 19 处）、`electron/` + `src/`（332 个文件 / 457 处，多为 vitest 运行根里的夹具）、`registerTestTemp` 登记的外部目录、Python 脚本 | 门岗登记 / 豁免 / 注明；不在本单改 | **残余风险**，写进报告与根因合同 |
| Windows | `process.kill(pid, 0)` 与 `taskkill` 的语义看官方文档；没有 Windows 机器 | **unverified**，写进报告 |

### D 真实条件

- macOS 本机 + 隔离的临时根（`TMPDIR` 指到本线 tmp 目录）+ 真的 `$TMPDIR`（前后计数）。
- Windows / 英文界面 / 最小窗口 / 真付费 / 键盘全程：不适用或 `unverified`（开发者工具，无界面、不花钱）。

### E 自验命令

```
node --test scripts/_test-temp.node-test.mjs scripts/check-test-temp-static.node-test.mjs
node --test scripts/pre-push-structure.node-test.mjs
pnpm run check:test-temp-static
pnpm run check:root-cause-contracts
pnpm run check:self-written
pnpm run check:pr-judgement
pnpm run gates          # 自己拿锁，不再套一层
```
