# 方向检查：测试与走查的临时目录被 SIGKILL 后没人收（RW）· 2026-10-28

> 触发：`node scripts/fix-churn.mjs scripts/_test-temp.mjs` 命中概念「测试与走查的临时目录归属」（含 3 个文件，近 14 天 6 个 fix，这一刀是第 7 个）。**协调代批：概念口径命中、要改的文件本身不是热点，改法是「换」（只靠 exit 钩子的清理换成「进程号归属 + 回收」，同提交删旧路径，不新增分支或特例）**——按 CLAUDE.md P1 例外由协调会话代批（10-28）、事后报用户。
> 事实来源：调查报告 R-test-tmp-leak（2026-10-24～10-27 本机实测），本线逐条对过 origin/main 94eb65a88 的文件:行。设计卡：`docs/plan/2026-10-28-test-temp-reclaim.md`。

## 0. 一句话根因

临时目录有「分配边界」（`scripts/_test-temp.mjs` 是系统临时目录的唯一分配口，静态门岗守着）却没有「回收边界」：清理只活在创建者自己的进程里（`process.once('exit')`），进程一旦被 SIGKILL（门岗超时、手动杀、崩溃、断电）就没有任何人知道这个目录该归谁、还要不要，所以每次被杀都漏一份，而每份是 0.85G。

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| f75249952 / 151244f28 / 0055544a4 / 199e6bf0e（10-08）把各脚本自建自删的临时目录收进共享助手 | 清理散在各脚本，漏删 | 分配分散 → 收口到唯一分配口（加上退出钩子） |
| d16ec7395（10-09）清理交给 Node 的 `maxRetries` | Windows 上 Chromium 刚退出时文件还被占（EBUSY） | 正常退出路径的瞬时占用 |
| 3875a2e42（10-18）共享临时目录返回真路径 | 丢了四处 `realpath`，只在 Mac 红 | 规范路径 |
| 近 14 天其余 5 个 fix（b414e0862 核构建戳 / a78ba1604 Playwright 保活 / a3a58cb89 假凭据 / 38ad6698d 走查收尾上限 / af3571247 宿主配置变量） | 全在 `tests/ux/_launchApp.mjs`（走查启动器）里，af3571247 另在 `tests/setup/tempWorkspace.ts` 里摘掉宿主环境变量；改的是启动、凭据、宿主配置 | **不是同一类**：概念把启动器算进来了，这 5 个的热度是启动器的，和临时目录归属无关；真正碰 `_test-temp.mjs` 的只有 3875a2e42 一个 |
| **本次：10-24～10-28 漏 10 份、约 8.6G，磁盘两天到 99%** | 门岗超时用 `killProcessTree` 对进程组发 SIGKILL（`scripts/pre-push-contracts.mjs:337,378`），创建目录的进程（`pre-push-contracts.node-test.mjs:38` 整仓克隆进 `nomi-prepush-`）被杀，退出钩子不跑 | **清理只有「进程内」一层，没有「进程外归属」** |

本次和上面不是同一个 bug：之前每次修的是「正常退出时怎么删得干净」，这次是「根本没走到正常退出」。#1114 加的退出钩子只覆盖正常退出，这是它的设计边界，不是它的 bug；缺的是它外面那一层。

## 2. 为什么这一类会一直出现

- **表示层**：目录名里没有「谁建的」。系统临时目录是共享的，一个叫 `nomi-prepush-AbCdEf` 的目录，事后没有任何人能回答「它的创建者还活着吗」，所以没人敢删，只能等人手跑清理脚本（按「30 分钟没动过 + 没有进程在里面」两道闸）。
- **所有权层**：回收被当成「创建者的收尾动作」，而不是「这个目录的属性」。收尾动作依赖创建者活到最后；属性（目录名带创建者进程号）不依赖。仓库里已经有正确答案——`electron/assets/scratchCleanup.ts:24-30,62-79` 的 `.nomi-upload-p<pid>-xxxxxx` + 按进程是否存活回收——只用在了上传暂存上，没成为通用做法。
- **方向层**：泄漏单位太大。整仓克隆 0.85G、视频转码产物 GB 级；清理一旦漏一次代价是 GB 而不是 KB，所以平时没感觉、攒两天就满盘。
- **门岗视野**：`check:test-temp-static` 守「别绕开唯一分配口」，但它只认几个固定写法的正则、只扫 `tests/` 下文件名带 `.test|.walk|.e2e|.probe|.paid` 的 `.mjs`，`.cjs` / `.mts` / `.ts` 的测试、不带后缀的辅助文件、别名（`const tmp = os.tmpdir()`）、`process.env.TMPDIR` 的写法都漏过去（本线实测：四种写法同时存在，旧门岗 14 条全绿）。
- 铁律 ⑩ ⑪ ⑫：不适用（开发者工具，不涉及意图参数、可选项、可点目标）。逃逸账本：这条是协调在跑清理脚本时发现的磁盘问题，是否登 `tests/ux/full-walk/escapeLedger/` 由协调定；若登，结账挂的类检查是本卡 ★9 的 A1–A8（目录名带进程号、首次分配回收、runner 杀完回收、门岗按语法树拦绕过）。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 下一次任何门岗被超时 / 手动 SIGKILL，又留下一份带随机后缀的 `nomi-*` 目录，没有任何进程会来收 | 小驱动用真的 `runNode` 杀一个 `makeTempDir` 之后挂住的进程：旧助手实测留下目录（`/Users/aoqimin/Nomi-coord/tmp/I-test-tmp-leak/mini-driver.mjs`，修前 `leftover: ["nomi-prepush-kbsAIA"]`）；`node scripts/door-map.mjs killProcessTree --roots=scripts,tests,evals --include-tests` 另有 5 个杀进程树的入口（`git-delivery.mjs:68`、`daily-radar-session.mjs:82`、`lib/nomiClient.mjs:133`、`tests/ux/memory.e2e.mjs` 两处），它们杀的进程树里要是有 `makeTempDir` 的创建者，同样漏 |
| 新加的走查 / 测试照旧会绕开分配口，因为门岗看不见它们 | 在 `tests/ux/` 下放一个文件名不带 `.walk` 的辅助文件、一个 `.cjs`、一个 `.mts`（别名）、一个 `process.env.TMPDIR` 写法：旧 `check-test-temp-static.node-test.mjs` 14 条全绿（本线修前实测：四个探针文件同时放进工作树跑旧门岗，全绿，随后删掉；新门岗对应的红绿证明是设计卡 ★9 B⑧） |
| 同形的泄漏在别的根继续出：产品侧 `electron/assets/localFileImport.ts:163`（用户机器上 GB 级）、vitest 的 `nomi-vitest-run-*`、`evals/` 的 10 个文件 / 19 处（本线语法树只读扫描；`electron/` + `src/` 另有 332 个文件 / 457 处，绝大多数是落在 vitest 运行根里的测试夹具） | `grep -rn "mkdtemp" electron scripts tests src evals`；本卡把前两者列为残余风险，产品侧等 #14 合入后另派 |

## 4. 靶子独立性检查

- 尺子是什么：① 带进程号的目录名 + 回收判据——判据是 `process.kill(pid, 0)` 的明确错误码，不是本线自己定的阈值；② 「真杀」用例起真的子进程、真发 SIGKILL，不 mock；③ 静态门岗的反例是在真文件里加探针再按字节还原。调查报告（读数据的一方）和本线（写修复的一方）不是同一条线。
- 没有「修对了反而掉分」的先例：这条不碰任何评测。
- 靶子本身有没有错：门岗旧的正则是靶子的一部分，它漏的比拦的多——本线先把靶子换成语法树判据，再把存量登记成基线，而不是往旧正则上再补一条。

## 5. P0：这些是我们独有的吗？现成方案有哪些

测试 / 走查的临时目录回收是**通用能力，不是领域**。现成方案查过（详见设计卡「先查别人」）：

- Node 的 `fs.mkdtemp` + `process.on('exit')`：就是现状，`'SIGKILL' cannot have a listener installed`（<https://nodejs.org/api/process.html#signal-events>）。
- npm `tmp`：`setGracefulCleanup()` 只在进程退出时清理（<https://github.com/raszi/node-tmp#graceful-cleanup>），解决不了被杀。
- pytest `tmp_path`：按次数留最近 3 份（<https://docs.pytest.org/en/stable/how-to/tmp_path.html#temporary-directory-location-and-retention>），在我们这里 3 份就是 2.5G。
- systemd `tmpfiles.d` 的 Age（<https://www.freedesktop.org/software/systemd/man/latest/tmpfiles.d.html#Age>）：按年龄清理，天级。
- 仓库内：`electron/assets/scratchCleanup.ts` 的做法就是答案。

**为什么现在是两份、而且登记自写**（`docs/engineering/self-written.json` 的 `test-temp-owner-reclaim`）：产品那份是 TypeScript，在 Electron 主进程里，依赖 `retryOnSharingViolation` 与日志；脚本这份是纯 `node` 直接跑的 `.mjs`，被构建链用到（`scripts/package-build-stamp.mjs:1`）并被 `scripts/electron-build.test.mjs:50` 单文件拷进夹具，必须零依赖，也不许 import 产品代码。共用要么动 `electron/` 的结构（任务书停点），要么新造一个需要构建步骤的跨运行时模块。判据只有十行，两份各管一边；哪天脚本侧能直接 import 一份编译产物，再合并。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 引 `tmp` 等库 | 新依赖 | 解决不了被杀（同样走退出钩子） | ❌ |
| 补（再补一个清理器） | 门岗 / 每天一次清扫脚本回收 `nomi-*` | 小 | 靠命名约定与年龄猜，不是结构；是第二个清理器，和退出钩子平行 | ❌（最弱的兜底，留给存量） |
| **换（协调已定）** | 目录名带创建进程号；第一次分配时回收「创建者已死」的同形目录；杀进程的一方杀完等树没了再用同一个回收函数收；退出钩子保留为「创建者自己的即时那一半」（只删本进程自己登记的目录，和回收作用在同一批带进程号的目录上，没有第二份命名、登记或判据）；门岗按语法树拦绕过 | 约 60 行助手 + 约 40 行 runner + 门岗换判据 | 进程号被复用只会让回收变慢，不会误删；跨用户靠 EPERM 当活 + uid 校验 + 不跟符号链接 | ✅ |
| 重写（限一个模块） | 让所有走查 / 测试改用一个统一的"会话临时根" | L：改 400 个调用方的约定 | 不必要：调用方全部汇到 `makeTempDir` 一个符号 | ❌ |
| 删 | 不再往系统临时目录建（比如整仓克隆改成稀疏检出、或放进仓库内的 `.tmp`） | 每条测试单独改 | 缩小泄漏单位可以另做（调查报告建议 3），但不能代替归属 | 另做 |

**推荐**：换。理由：它不新增依赖、不新增特例分支，把「还有没有人要」从创建者的收尾动作变成目录自己的属性，一次覆盖 384 个分配入口和所有杀手。

## 7. 用户要权衡的核心

要不要让「下一个跑测试的进程」顺手删别人留下的、创建者已经不在的临时目录。要，磁盘不会再因为被杀的门岗涨满；代价是这条路径上多了一个会删目录的函数，必须保证它只删「命名形状对、创建者确实已死、属于当前用户、不是符号链接」的目录——本卡把这四条都写成了会真红的反例。

## 特征测试清单（动结构前先锁住）

- `scripts/_test-temp.node-test.mjs`：目录名带本进程号；首次分配回收创建者已死的同形目录（活进程的、进程号为 1 的、别的形状的、老格式的、文件、符号链接不动）；只在第一次分配时扫；别的用户的不收；真 SIGKILL 后目录还在、下一个进程首次分配收走；经 runner（`terminateAndReclaim`）杀进程树后目录被收、活着的不动。
- `scripts/check-test-temp-static.node-test.mjs`：按语法树认 `mkdtemp(<系统临时目录>…)`（`os.tmpdir()`、`tmpdir()`、`process.env.TMPDIR/TEMP/TMP`、`/tmp` 字面量、同文件别名、参数默认值）；`scripts/` 与 `tests/` 下全部源码；存量基线只减不增；豁免只剩分配口自己和 vitest 运行根。
- `scripts/pre-push-structure.node-test.mjs`：`pre-push-contracts.mjs` 里每一处 `killProcessTree(` 都在 `terminateAndReclaim` 里。
