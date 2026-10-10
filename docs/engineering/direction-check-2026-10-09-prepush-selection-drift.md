# 方向检查：推送前钩子「声明的选择范围」与「实际执行」脱节（RW，第 3 轮修）

> 触发：同一条线（#1141 推送前钩子加固）第 3 轮修补；`scripts/pre-push-contracts.mjs`、`scripts/install-git-hooks.cjs` 14 天内第 3 个 fix。
> 原则（协调会话 2026-10-09 定）：推送前钩子是加速器，CI 才是最终裁判。目标是「常见改动在本机就红」，故意绕过不在范围内，靠评审抓。

### 0. 一句话根因

推送前这一层有好几份「手写清单」（选哪些门、每道门看哪些目录、钩子里写哪些脚本名、gates:contracts 里有哪些门），每份都和它所描述的正本各自演化，声明的范围和实际执行就脱节了；前几轮每次都是修一份清单的某一行，下一轮另一份又漂开。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / 评审条目 | 直接原因 | 类 |
|---|---|---|
| 旧钩子静默放行（10-09） | 钩子文件里写死脚本名 | 手写清单（钩子 ↔ 脚本） |
| 复审 1：tokens 漏 .css、vocabularies 漏 .mts / .cts | 选择器和扫描器各写一份路径规则 | 手写清单（选择器 ↔ 扫描器） |
| 复审 2 #1：typecheck 选中的文件有一大半没有任何 tsc program 编译 | 选择输入手写目录，没读 tsconfig | 手写清单（选择器 ↔ tsconfig） |
| 复审 2 #2：结构测试只认 check / lint / typecheck 前缀 | 过滤条件是另一份手写规则 | 手写清单（测试 ↔ gates:contracts） |
| 复审 2 #3 #4：写入边界只在 --all-worktrees；空表不生成 pre-push | 检查放在入口而不是共享边界；必需钩子没有正本 | 校验放错层 |

### 2. 为什么这一类会一直出现

推送前钩子不是产品功能，没人对着它的「实际覆盖」做验收；每次出事只补出事的那一行。三条体验铁律不适用（不是用户界面行为）；对应的逃逸是「3 个 PR 推送前全绿、CI 才红」，结账挂在 `scripts/pre-push-contracts.node-test.mjs` 的结构测试和探针测试上。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 有人改 tsconfig include 或新增 program，选择器不跟 | 探针测试：每份 tsconfig 取一个根文件，选择器选中它且 `tsc --listFilesOnly` 真列出它 |
| 有人在 gates:contracts 加一道不带 check: 前缀的门 | 结构测试解析完整门列表，没声明就红 |
| 有人删了 git-hooks.json 里的 pre-push | `hookTableProblems` 在加载时就抛错；测试覆盖空表 / 缺 pre-push |

### 4. 靶子独立性检查

门岗和测试是同一条线写的；所以探针用外部事实当尺子（`tsc --listFilesOnly`、`gates:contracts` 的真实字符串、真 git 仓库里的 junction），评审线（R-review-1141）独立复核。

### 5. P0：这些是我们独有的吗

不是。husky / lefthook 的做法（钩子一行转交配置）已参考；整库类型检查用 tsc 自带的 `--incremental`；解析 tsconfig 用 TypeScript 自己的 `parseJsonConfigFileContent`。自写的只有「推送前跑哪些门」的选择表（本仓交付流水线的领域约束）。

命中的自写登记：`gate-family`（`docs/engineering/self-written.json`，本仓的门岗家族）。为什么现在换不了现成方案：门岗清单、基线棘轮、根因合同这套是本仓交付纪律的领域约束，husky / lefthook 只管“钩子调用什么”，不管“哪些门按哪些改动选、每道门读哪些文件”；所以只换掉其中通用的部分（钩子分发、tsc 增量、tsconfig 解析），选择表继续自写。哪天换：当门清单能由一个现成的任务图工具（如 nx affected / turbo）从 import 图推出受影响门，再重新评估，预计在门岗家族合并整理（门岗账本复审）时。

### 6. 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 引入 husky / lint-staged | 要换掉三个已有钩子脚本和 worktree 隔离安装 | 失去 junction / 外部 hooksPath 的边界检查 | 否 |
| 补 | 再手写一行清单 | 最小 | 下一轮另一份清单再漂 | 否（这是前 2 轮的做法） |
| 换（推荐） | 所有清单从正本派生：tsconfig（TYPECHECK_PROJECTS）、gates:contracts（完整门列表）、git-hooks.json（必需钩子）；写入检查放进共享边界 installHooks | 中等（本轮已做） | 派生逻辑自己要被探针测试盯住 | 是 |
| 删 | 不做推送前钩子 | 回到每次 40 分钟 CI | 本线起因 | 否 |

### 7. 用户要权衡的核心

推送前钩子要多严：它是加速器，不是裁判——我们选择「不追求语义等价证明、不防故意绕过」，换来的是钩子简单、跑得快（典型 PR 约 45 秒）。

## 特征测试清单

`scripts/pre-push-contracts.node-test.mjs`（结构 / 探针 / 超时 / 必红）、`scripts/git-hook.node-test.mjs`（分发器 / 安装边界 / 写入失败 / 必需钩子）、`scripts/pr-body-gates.node-test.mjs`（gh 错误分类）。

## 追记 2026-10-10：判据不分「推送」和「合并」两步

- 症状：#1141 合入后，四类 PR（新界面 / 花钱 / 长跑 / 可打断）推送前钩子跑 check:pr-judgement，「独立验收没有带报告链接」必红；验收线要验推上去的分支，报告链接只能事后回填——推送这一步永远满足不了。
- 类根因：同一份正文判据被推送前钩子和 CI / 合并前扫描共用，但有的判据只在合并时才可能满足，判据本身不知道自己跑在哪一步。
- 改法：判据加「哪一步」（resolveJudgementStage）。推送前钩子注入 NOMI_PR_JUDGEMENT_STAGE=push，只把「缺报告链接」降成提醒；这一节缺失、没写验收线、验收线等于实现线照样红；CI 里一律按合并判。
- 命中的自写登记仍是 `gate-family`；换不换现成方案的结论同上文，不变（这一刀是在自写判据上加时机维度，没有现成库管 PR 正文判据）。

## 追记 2026-10-10：推送前不跑「和改动相关的单测」、也不跑钩子自己的结构用例

- 症状（同一天三次推送前全绿、CI 才红）：#1148 改了 `scripts/build-electron.mjs`，`scripts/electron-build.test.mjs` 必红，钩子只跑固定几条测试；#1147 新加门岗并在 `GATE_INPUTS` 登记，`pre-push-contracts.node-test.mjs` 里「SCANNER_READS 与 GATE_INPUTS 同集合」的契约用例在 CI 红；#1141 合 main 后新门岗没在门表声明，结构用例在 CI 红。
- 类根因：推送前这一层只认「门岗清单里写了的东西」。两类东西没有人声明过它们该在本机跑：一是按改动文件才相关的单测（没有「改了谁就跑谁的测试」这条通路），二是钩子自己的结构 / 契约用例（它们和 90 秒以上的慢用例同在一个测试文件里，整份只能放 CI）。
- 改法：
  - 相关单测：改了 src / electron / scripts / tests 下的源码，就按「改动的测试自己 + 同名测试（foo.mjs ↔ foo.test.mjs / foo.node-test.mjs）+ `git grep` 按引号提到改动文件主名的测试」挑，vitest 与 node:test 分两路并行跑，总上限 75 秒，超了不算红、如实写「相关单测没跑完，CI 会跑」并列出文件（`scripts/pre-push-related-tests.mjs`）。
  - 结构用例：把纯函数 / 读文件的快用例从慢文件拆成 `scripts/pre-push-structure.node-test.mjs`（约 10 秒），作为推送前门岗 `test:pre-push-structure` 登记进 SCAN_TESTS + GATE_INPUTS；输入范围 = package.json、分发表，加上它自己的 import 闭包（门表、输入声明、入口脚本）——改了其中任何一个就跑。慢用例留在原文件，CI 照跑。结构测试盯着这两项的登记不许被删。
- 为什么不换成现成方案：这次接的就是现成能力，但接不全。实测（本机 Windows，约 2000 个测试文件）`vitest related` 先给全部测试文件建依赖图，空转 110–140 秒，位置参数的过滤不会提前缩小范围（带一个测试文件名参数仍跑了 6 分钟、跑进无关的 tests/ux），超出 60–90 秒预算；而且它根本选不中 `electron-build.test.mjs`（该测试用计算路径动态 import + 拷贝文件名清单），也就是今天的实证它漏。所以选择用 git 自带的 grep 和文件名约定，没有自己写 import 图。已知残留：只覆盖到「直接提到」这一跳，不含传递依赖，也看不见按文本读被测文件但没写出文件名的测试；CI 是裁判。哪天 vitest 的 related 能按范围提前缩小、或有可持久化的依赖图缓存，再换。
- 命中的自写登记仍是 `gate-family`：门岗选择表是本仓交付纪律的领域约束，没有现成工具管「哪些门按哪些改动选」；换不换的结论同上文，不变。
- 同批补：超时不等于类型错。合 origin/main 后第一次推送，typecheck 的增量缓存是冷的，240.5 秒撞上单门上限被当红拦下，重推同一提交就过了。类根因：门岗结果只有「过 / 红」两态，没有「本机没跑完」。改法：SCAN_TESTS 里冷缓存才慢的门标 `softTimeout`（现在只有 typecheck），超时按「没跑完，CI 会跑」放行并写明，真红照拦；其它门挂住仍按红。单门上限 240 秒未改（冷启动约 100 秒，机器忙时会超；超了现在只是少一次本机检查）。

## 追记 2026-10-10（2）：钩子环境的 GIT_* 泄进测试子进程，把真仓库改成 bare

- 症状：推送 #1142 时，推送前钩子的 test:related 挑中 scripts/check-vocabularies.node-test.mjs；它在临时目录 `git init`、`git config user.name Test`，但继承了 git 给钩子导出的 GIT_DIR（worktree 里指向真仓库）→ 真仓库被重初始化为 core.bare=true、用户名邮箱被改成测试身份，所有 worktree 同时失效。协调会话按会话开始时的身份与今天提交的作者原样恢复了配置。
- 类根因：推送前钩子起子进程时原样继承钩子环境；git 钩子环境里的仓库定位变量（GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE / GIT_COMMON_DIR…）对「在临时目录里自建仓库」的测试是毒药。#1154 让钩子开始跑按改动挑出的任意测试后，暴露面从几道固定门岗变成了任何测试。
- 改法：所有门岗与测试子进程只经 runNode 起（已有结构测试钉住），runNode 一律删掉 GIT_* 再起；必红测试在 scripts/pre-push-structure.node-test.mjs。
- 为什么不在 git-hook 分发器里统一清：pre-commit 一类钩子要靠 GIT_INDEX_FILE 读暂存区，清了会读错索引；推送前门岗与测试都按 cwd 找仓库，不需要它们。
- 命中的自写登记仍是 `gate-family`；换不换现成方案的结论同上文。

## 追记 2026-10-10（3）：只在 Windows 上红的六道门岗，和相关单测的运行方式

- 症状：check:storyboard-owner / mcp-operation-constructible / model-face-frozen / verb-host-conformance / transport-assembly / spend-receipt 在 Windows 本机必红、Linux CI 绿，所以 10-09 被登记成「只在 CI」；#1154 让推送前钩子按改动挑相关单测后，挑中它们的 node-test 就拦推送。另外相关单测里的 node:test 一律 `node --test`，而 check:model-schema 这类 CI 里是 `tsx --test`（要加载 .mts），被选中时报 ERR_UNKNOWN_FILE_EXTENSION 误红。
- 类根因：脚本里「路径 / URL / 命令」没有唯一入口，各写各的。三种手写法恰好在 Linux 上都对：`new URL(import.meta.url).pathname`（Windows 得到 /D:/…，受检文件被误报不存在）、`path.relative()` 的结果直接比含 `/` 的清单（Windows 是反斜杠，恒不等）、`execFileSync('pnpm')` 不开 shell（Windows 是 pnpm.cmd，ENOENT，门岗自检的输出为空、全红）；`import(裸盘符路径)` 同类。CI 只在 Linux 跑，没人拦得住。推送前相关单测的运行方式则是手写的第二份，没从 CI 的命令推。
- 改法：
  - 删：六道门岗与同类脚本里手写的路径 / import / spawn 写法，统一走新增的 `scripts/lib/repoPaths.mjs`（repoRoot、repoRelativePosix、toFileUrl、importLocal）与 `process.execPath --import tsx`；同类另改 check-model-schema.ts、check-walkthrough-tool-args.ts、check-control-contract.mjs、comfyui-video-input-walkthrough.mjs、skills-format-lib.mjs、若干 tests/ux 走查与 evals 的裸 import / 裸 pnpm。
  - 门岗自动拦：并进现有的 `check:main-guard`（它本来就管「手拼 file URL」这一族，AST 判据，已在门表里）新增四条规则 url-pathname-as-path / import-bare-path / bare-cmd-spawn（含 import 手拼 file URL）；阳性 / 阴性对照在 check-main-guard.node-test.mjs。
  - 相关单测：node:test 统一 `node --import tsx --test`（tsx 是超集，纯 .mjs 照跑），不分档不手写名单；pre-push-structure.node-test.mjs 加必红用例（被选中的 node-test 加载 .mts 要能真跑通）。
  - 门表：storyboard-owner / transport-assembly / spend-receipt 实测 1–3 秒且输入范围精确，收回「Windows 假红只在 CI」的理由、接进推送前（GATE_INPUTS + SCANNER_READS + PRE_PUSH_GATES）；其余三道改写理由为「太贵」（TS 导入闭包 + 变异自检 5–43 秒、输入是 electron 全树）。
- 为什么不换成现成库：路径 ↔ URL 转换用的就是 node:url 的 fileURLToPath / pathToFileURL，新模块只是把它们收成一个入口；没有现成库管「本仓脚本的相对路径规范」。
- 命中的自写登记仍是 `gate-family`（门岗族）；换不换现成方案的结论同上文，不变。

## 追记 2026-10-10（4）：扫全仓 / 扫目录的守卫测试，推送前「相关单测」挑不中它们

- 症状：同一天漏 4 个，本机推送全绿、CI 才红（每次白耗约 40 分钟）：#1156 electron/offLedgerEgress.structure.test.ts（新增 child_process 出网口没登记）；#1142 electron/fileIdentity.test.ts（手写 dev / ino 比较）、electron/shared/mcpClientRegistry.test.ts（手抄客户端清单）、scripts/check-network-entry.test.mjs（Node 网络调用没走共用传输）。
- 直接原因：推送前「相关单测」只挑「引用了改动文件」的测试（pre-push-related-tests.mjs 三种引用法）。这类守卫自己遍历源码、对全集断言，不引用任何具体文件；新增一个违规文件，没有测试「引用」它。SCAN_TESTS 本来就是给这类测试留的位置，但登记全靠人记得，没登记的没有任何东西报警。
- 类根因：「哪些测试要在推送前跑」有两套正本——相关单测按引用挑，SCAN_TESTS 按人工登记挑；扫目录型测试天然落在两者的缝里，而且「某个测试是不是扫目录型」这件事没有任何自动判定，只能靠写测试的人事后想起来去登记。全仓实数：119 个测试文件被识别为扫描型，其中 54 个本来就在推送前某道门岗的命令或实现里，另外 65 个没有任何去处（本次：登记 53、CI_ONLY 2、被门岗覆盖 1、识别器误判 9）。
- 改法（强弱依次）：
  - 门岗自动拦：scripts/lib/scanGuardDetect.mjs 用 TypeScript 语法树识别「起点锚在仓库里的 readdir / glob / git ls-files / git grep」（沿同文件变量与函数形参追来路，临时目录不算，只钻拼路径的调用、不钻任意函数实参；间接扫描顺着 import 进 scripts / tests / evals 里的扫描器模块找），scripts/pre-push-scan-guards.mjs 的 scanGuardProblems 核对：每个扫描型测试必须在 SCAN_GUARDS（推送前跑，写明扫哪些目录）/ SCAN_GUARD_CI_ONLY（附理由）/ SCAN_GUARD_COVERED_BY_GATE / NOT_SOURCE_SCANS（附理由）之一，或本来就是推送前某门岗的命令；陈旧项、重复声明、空理由一并红。核对写在 pre-push-structure.node-test.mjs（它自己是推送前门岗），新写一个扫描型测试忘了登记，本机推送前就红。
  - 补：SCAN_GUARDS 登记 53 个，扫描目录用运行时桩（给 fs.readdirSync 打桩记录）实测，不是读代码猜的；批量门岗 test:scan-guards（SCAN_TESTS 里一条，一个 vitest 进程）按改动只带该带的：改到它扫的目录、测试自己或它 import 的模块才带上它。逐个起进程实测改一个 electron 文件墙钟 +29 秒，批量跑同样 15 个文件 18 秒。
  - 顺手修一个同类缝：相关单测的 exclude 原来无条件排除全部 SCAN_TESTS 的入口文件，没被选中的扫描门岗会连带吞掉相关单测对它的挑选；改为只排除这次真会被选中的。
- 为什么不「删」/ 「结构上做不出来」：理想是所有扫仓库的测试都走同一个 scanRepo(roots) 助手，目录写在助手参数里、推送前直接从参数派生；那要改 50 多个存量测试，且每个的遍历写法不同，一次改风险大、收益和上面的自动识别重叠。留作后续（识别器 + 核对已经把「不走助手」变成红灯）。
- 为什么不换成现成库：「测试是否遍历仓库」是本仓测试写法的领域事实，没有现成工具；vitest related 已在 pre-push-related-tests.mjs 里评估过（慢，且依赖图看不见 readdir）；ESLint 规则只能看单文件，看不到「这个测试导入的扫描器模块里在遍历」。识别器是本仓 gate-family 的一部分，沿用既有登记。
- 命中的自写登记仍是 `gate-family`；换不换现成方案的结论同上文，不变。
