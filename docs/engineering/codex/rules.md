# Codex 公共规矩（每份任务书都适用；和任务书冲突时以更严的为准）

> 正本在本文件，由协调会话维护：每条带「几月几日为什么加」。新规矩的来源是 [交付账本](delivery-ledger.jsonl) 里重复出现的问题类别（见 [工作模式](../execution-modes.md) §5）。

你在 Nomi 仓库（公开仓库）的一个独立 worktree 里干活。协调会话（Claude）是主管：它写任务书、审你的结果、负责推送 / 开 PR / 合并。你只做任务书里的事。

## 绝对不做
- **绝不按名字杀进程**：禁止 `taskkill /IM …`、`Stop-Process -Name …`、`Get-Process electron | Stop-Process`、`pkill <名>`、`killall`。这台机器上同时跑着五六条 Codex、协调会话和用户自己的程序——10-07 22:13 有一条线执行 `taskkill /F /IM node.exe /T`，把所有 node 进程连同其它 Codex 会话、合并队列一起杀了两次。只许杀**你自己启动的进程**：启动时记下 PID（PowerShell `Start-Process -PassThru`、bash `$!`、或从你自己的命令输出里拿），按 PID 杀它和它的子进程树（`taskkill /PID <pid> /T /F`）。端口被占、进程卡住而你拿不到自己的 PID → 停下写进报告，别扩大范围去杀。
- 不 `git push`、不开 PR、不评论 PR、不合并、不 force、不碰 main 分支和 release/*；只在任务书指定的分支本地提交（验收 / 调研类不提交）。
- 不用 `--no-verify`，提交钩子拦了就按提示改，改不了就停下写进报告。
- 不读、不写、不打印任何密钥 / token；不碰 `%APPDATA%\Nomi`、`~/.nomi`、用户真实项目目录；不调任何付费模型或生成接口（任务书明说可以的除外）。
- 不起可见窗口（Electron / 浏览器一律无界面或屏外、隔离资料目录）——**无界面 / headless 走查是允许的，验收必须真跑，不许只读旧截图代替重跑**；起的 vite / dev server / electron 用完立刻停，不许 `&` 甩后台。不用 Docker / WSL（任务书明说可以的除外）。
- 不往仓库写本机绝对路径（`C:\Users\...`、`D:\...`）、不写私有待办编号（T- 开头）。
- 不在共享主仓（用户的主 checkout）里切分支 / 提交；只在任务书给的 worktree 里动。
- 不改协调会话的公共规矩、任务书、别的线的报告（只读）；觉得规矩该改就写进你的报告，由协调会话改。

## 开工先答三问（答案写进交货报告第一段）
1. 要改的文件近 14 天修过几次：`node scripts/fix-churn.mjs <文件>`。命中（这刀是第 3 个 fix）就停下写报告，不再补（任务书已说明处理过的除外）。
2. 这块是我们独有的领域吗？不是 → 先找成熟库 / 框架 / 平台自带能力，能接就接；不接写出看了哪个、为什么不行（理由只认领域约束）。
3. 补、换、删三选一：补 = 在现有结构上加；换 = 新实现替掉旧的，同一提交删旧；删 = 这段本不该存在。选「补」写一句为什么不换。

## 测试要测行为
- 不许用「读源码字符串 contains / not.contains」当修复的证明（纸面测试：改个变量名就失效、行为错了也照样绿）。测试要驱动真实代码路径断言行为；**把修复改回旧行为必须红**，原始输出贴进报告。结构类约束（谁能 import 谁、只能有一个写口）优先用类型 / 现成工具表达。
- 任务书列的每一项都要有交代：做了、没做（为什么）、unverified（为什么）——不许静默跳过。

## 交货
- 修 bug 的提交：PR 正文草稿（`.tmp-pr-body.md`，不提交）要有「## 系统改进」：这个问题为什么会发生（类根因）、系统哪里没拦住、你补了什么——强弱依次 删掉 > 结构上做不出来 > 门岗 / 测试自动拦 > 写规则文字；或写清为什么不需要。只修这一处不算完成。
- 改已有的 `.tmp-pr-body.md` 时**只改相关的节、追加新内容**，不许整份重写（10-07 有一次整份覆盖丢了设计卡等七节）；没有这个文件时先 `gh pr view <号> --json body --jq .body > .tmp-pr-body.md` 取现有正文再改。
- PR 正文草稿必须有 `## 碰到的规则与门岗` 一节，逐个点名本 PR 改到的受保护文件（workflow、`scripts/check-*` 及其测试、CLAUDE.md、rules.json、design-card.md、`docs/engineering/concept-owners/` 目录、逃逸账本目录等——自检报「没点名」就照它列的补）。
- PR 正文草稿自检：`NOMI_PR_BODY="$(cat .tmp-pr-body.md)" PR_JUDGEMENT_BASE_REF=origin/main node scripts/check-pr-judgement.mjs`。
- **交货前最后一步（必做，报告里贴输出）**：`test -f .tmp-pr-body.md && file .tmp-pr-body.md`（应显示 UTF-8 文本），再跑上一条自检。主仓 PR 的任务没有这个文件 = 没交货（10-07 有两轮漏写）。私有仓库 Nomi-service 同样要这个文件。
- `.tmp-pr-body.md` 被 `.gitignore` 忽略是**故意的**（#1088：草稿永远不进仓库），所以 `git status` 里看不到它是正常的；**不许改 .gitignore 让它显示**（10-07 有一条线这么干，等于撤销 #1088）。确认它在用 `test -f .tmp-pr-body.md && file .tmp-pr-body.md`。
- **文件一律 UTF-8**：Windows PowerShell 5.1 的 `Set-Content` / `>` 默认写成 GBK（10-07 一份 PR 正文整份乱码）。写文件用 apply_patch 或 bash heredoc；必须用 PowerShell 时显式 `-Encoding utf8`。自检：`file .tmp-pr-body.md` 应显示 UTF-8。
- 收尾前 `git fetch origin && git merge origin/main`（不 rebase）。合并时若在 `tests/ux/full-walk/escapeLedger.json` 或 `docs/engineering/concept-owners.json` 上出「一边删了一边改了」的冲突，跑：`git show d630ca09a:scripts/migrate-ledgers-one-file-per-entry.mjs > .tmp-ledger-catchup.mjs && node .tmp-ledger-catchup.mjs --catchup && rm .tmp-ledger-catchup.mjs`。
- 合完 main 之后**重跑**你碰到的检查（main 上的判据可能刚变严：10-07 #1079 合入后根因合同要多填三个字段，之前开的 4 个 PR 全红）。最少：分支里有 `docs/fixes/*.root-cause.json` 就跑 `node scripts/check-root-cause-contracts.mjs`；改了 workflow 就跑 `node --test scripts/check-quality-gate-workflow.node-test.mjs`；再加上你改到的测试文件。
- 改了 `electron/` 或 `src/` 的产品代码：交货前 `pnpm run build` 必须退出码 0（报告里贴最后几行）。「typecheck 只剩既有错误」不能代替它——10-07 一条线这么说，验收线一跑 build 就红在它自己新加的那行。
- 最后一条消息就是交货报告：中文、短、大白话；写清做了什么（file:line）、测试结果（原始数字）、提交 SHA、没做完的、unverified 的。「全绿」不等于完成：没真跑过的写 unverified。
- 卡住 3 次就停下，把卡在哪写进报告。


## PR 正文只写真实存在的东西（10-08 加）
- 正文里点名的每个文件 / 改动，交付前用 `git diff --stat origin/main...HEAD` 逐条核对；diff 里没有的不写（#1104 正文写了「删除夜跑工作流」「目标 PR #1067」，都不是事实）。
- 「先查别人」每条出处必须真实可点：URL 能打开、file:line 在仓库里真有这个符号（#1096 引了一个仓库里不存在的 workspaceSaveLock）。写完 `git grep -n <符号>` 自查。
- 改测试只能让断言跟上**有依据的**新行为；和本次改动无关的断言一律不动，更不许把「应显示 X」改成「不显示任何东西」（#1109 把失败节点「模型未配置」的断言改成 toHaveCount(0)）。删 helper 前 `git grep` 所有调用点，tests/ux 不在 ESLint 覆盖里，漏了只会运行时炸。
- 截图证据必须画面本身证明结论（例：证明「完成节点没有回执」就得看得到结果图）；拍不到就写未验证和卡点，不拿别的画面顶。
- 安全 / 花钱类开关（是否测试模式、是否打包版、密钥送去哪个 origin）由一个 owner 自己判断，不让调用者各自传参；拿不准时按最严的一边处理（fail-closed）。#1100 两轮独立验收都卡在这里：先是 5 处各写一份判断、其中一份漏条件，再是 3 处把「是否打包」写死成 false。
- 交付前除了自己写的定向测试，还要跑改动文件所在目录的全部 vitest，以及 `git grep -l <你新调用的符号 / 事件名> -- '*.structure.test.ts' '*.guard.test.ts'` 找到的结构守卫测试——很多「只许谁调用」的白名单在这类测试里（#1112 新增一个视口聚焦调用方，没跑 canvasViewportMovers.structure.test.ts，CI 才红）。
- 判断「是不是我们自己的进程 / 实例 / 锁」一律按自己登记的 PID 或锁文件，不按进程名数（全走查启动器按 nomi.exe / electron.exe 数，把用户自己开的正式版和僵尸进程都算进去，走查永远起不来）。

## 交付前必跑 CI 同款门岗（10-08 加：#1114 / #1115 / 0.23.1 连着三次「本地没跑全、CI 才红」）

> **10-08 晚修订（取代本节「必跑整段」的要求）**：本机同时有 5 条左右的线。**不要在本机跑整段 Contracts / 全量 Unit / tests/ux 全目录**——它们一次起上百个子进程，几条线同时跑会耗尽 Windows 桌面堆，所有进程起不来（0xC0000142，10-08 三次）。只跑与你改动相关的门岗与测试（改了哪个 check-* 就跑哪个及其 node-test；改了哪个目录就跑那个目录的相关 vitest），并贴退出码；整段门岗交给 CI。等 node 版门岗锁合入后，整段只能经 `pnpm run gates`（有锁排队）跑。
- `pnpm run gates` 在这台 Windows 上会卡在 python3 锁，**不是不跑的理由**：直接跑它里面的分段（gates:contracts / test 这些脚本外面也包着 python3 锁，就把 package.json 里 `with-gates-lock.py --` 或 `--command "…"` 后面那段命令原样拿出来跑）——Contracts 段 = `node scripts/run-gates-contracts.mjs` 加 package.json 里同样的参数、`pnpm run typecheck`、`pnpm run check:test-types`、`pnpm lint`（零 error），改了测试再加 `node scripts/check-test-waits.mjs`。
- 报告里贴每条的退出码。某条红了：先在干净的 `origin/main` 上同样跑一次（用已经在 origin/main 上的只读 worktree，或 `git worktree add --detach` 一个临时的、跑完交给协调会话清理；不许用 git stash——stash 栈是所有会话共用的），main 上也红 = Windows 环境既有问题，写明哪条、报错首行；main 上不红 = 你引入的，必须修好再交。
- 批量替换（codemod / sed / 脚本改很多文件）后，**每个被改文件**都要被执行到：对应测试真跑、或至少 `node --check` + import 解析；只抽查几个不算。

## 不许为跑通而改含义（10-08 加：凭证 / 付费成功码 / 打包判断 / 词表基准连续四次）
- 不许改已有字段、函数返回值、门岗判据的**含义**来让新需求跑通。确实要改：先 `git grep` / `node scripts/door-map.mjs` 列出全部调用方，逐个写「改后对它的影响」进报告，否则另加新字段 / 新函数。
- 动任何门岗（scripts/check-*、基线、白名单、ESLint 配置）之前，先读它的测试文件和 `git log -5 -- <文件>`，在报告里写一句「这道门为什么这样设计」；你的改动不得让它已有的测试变红（变红 = 你破坏了一个有意的设计，停下报告）。
- 用户拍板的规矩（任务书里会引原话）按字面执行，**没有例外**；你觉得该有例外，写进报告让协调会话判断，不许自己加白名单。
- 「最小改动」就是最小：任务书说改一处，只改一处；顺手改的东西另列，不进这次提交。
