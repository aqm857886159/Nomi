# 保存路径的确定性故障扫描与主进程同步等待棘轮

状态：协调裁定后恢复实现；同步等待改用已装 ESLint 批量抑制，不新增自写门岗类别。基线 `d13bba332ca3444a485fc3bbf015d3e5fe35d1b2`。

本卡只覆盖测试、已有 ESLint 核心规则与批量抑制、性能路由配置及说明文档。产品保存行为、诊断包、遥测、Electron 场景、新性能指标和 Windows 作业均不在范围内；不花钱、不用真实用户资料、不加包。

## ★1 用户怎么用

当开发者修改保存与落盘路径，希望合并前看见确定性的同步工作量及故障后完整性，避免只有渲染层性能证据而主进程堵塞无人检查。

步骤：路径路由推出性能证据要求 → 在隔离目录真跑 `saveWorkspaceProject` 的第 N 次 I/O 故障扫描 → 检查精确计数和完整性 → 提交证据。这里只为后续修复建立量具，不证明某次用户卡顿的触发点。

| 指标 | 量具与判据 |
|---|---|
| 单次保存请求同步睡眠毫秒 | `electron/workspace/saveFaultSweep.test.ts` 的 `Atomics.wait` 桩；推进假 Date，只累计请求毫秒，不测墙钟。目标 0；实测整链重试最大 5200ms、注册表 3010ms，按精确源码路径与出处登记，只许降 |
| ≥1MB JSON stringify / parse 次数 / 次保存 | 同一测试包住真实 JSON 方法，按产生或解析的 UTF-8 字节量分类；夹具构造与事后校验不进计量窗。次数基线只许降；1MiB 合成文本实测 stringify 12 / parse 14 次 |
| 故障确实命中 | 同一测试按操作类别与隔离目录前缀计数；路径参数收前缀，fd 操作按打开时所属路径归因，不能把 fd 当字符串路径过滤。窗内匹配调用和注入次数均须 >0 |
| 有界退出、锁与临时文件清理、旧 JSON 完整 | 同一测试记录成功或有类别错误；检查保存前后完整快照、锁目录和暂存文件。假时钟驱动异步重试；保留轮次安全上限，不能静默跳过 |
| 主进程同步等待静态存量 | `eslint.config.mjs` 的内置 `no-restricted-syntax`，六处存量记在 `eslint-suppressions.json`；新增违规红，删掉不 prune 也红 |
| 保存路径必须交性能证据 | `scripts/pr-judgement-lib.mjs` 的 `inferRoutes` 与证据判据；覆盖保存、工作区、资产、事件、日志、制作流程和 workbench project 路径 |

真实开发任务：① 改 JSON 原子落盘后执行扫描；② 删除同步等待并同提交降低基线；③ 修改注册表保存后由路由要求性能证据。本卡没有新增用户操作；用户侧交互与真实 Electron 任务闭环未验证，交后续场景线。

## ★2 谁说了算

- 保存语义继续由 `saveWorkspaceProject` 与现有事务、JSON、注册表模块拥有，测试不得复制或替换保存实现。
- 扫描参数、睡眠豁免和大 JSON 次数基线集中在新增测试；上限相对可信 git 基线只能降低，不能只用被改高的表自证通过。
- 静态规则归已有 ESLint 主进程配置，六处存量归已有 `eslint-suppressions.json`；不改 heavy-path 脚本及其基线，不新增门岗脚本。
- 路由唯一来源是 `docs/engineering/test-routing.json` 的 `pathRules`；不改 `validation-policy.mjs`。
- 已运行 `node scripts/door-map.mjs saveWorkspaceProject retryOnSharingViolation rememberWorkspace`：9 扇写入口、15 处出现。共享重试还服务资产、上传、配置和 manifest 锁；扫描只覆盖真实保存链，不宣称这 9 扇都已有性能场景。

## ★3 一致与复用

复用 Vitest spy、假时钟、真实隔离文件系统、ESLint `no-restricted-syntax` 与 bulk suppressions、`check-renderer-sync-ipc` 的双向身份棘轮和现有路由判据。不新增 npm 包，不自写 profiler。不创建第二套保存实现或通用性能框架。

故障集合固定为 `{EBUSY, EPERM, EACCES, ENOSPC, EEXIST}` × `{一次, 持续}`；每个操作类别与隔离路径前缀分别从 N=1 扫到注入点落在保存末尾之后且保存跑通。open/write/fsync/rename/rm/mkdir/read 均须证明计量不为空；隔离 settings 注册表也属于夹具，真实 settings 与用户目录不在注入范围。

已核实源码重试延迟 `[10,30,60,100,200]` 合计 400ms；注册表每轮请求 10ms、截止条件为 `Date.now() > deadline`。外部故障注入曾观察约 420ms / 3008ms，含真实 I/O 与调度；本卡精确睡眠读数应单独报告，不能放宽或更改判据去凑墙钟数。

## ★4 全状态

无故障：保存成功、窗内调用 >0、请求睡眠 0。注入故障：成功或有类别错误，不能挂住。已知超标：打印精确路径、实测量、上限与出处，不拦无关 PR；未登记睡眠点、上限上调、工作量恶化：红。注入未命中、没有有效样本：红。未实现或缺真实资源：未验证，不能算通过。

测试不真睡，不测墙钟，不把忙机器当代码退化。大 JSON 使用合成工程并明确不是用户真实工程；Windows 真句柄、NTFS/同步盘/杀软行为未验证。

## ★9 验收与回滚（实现前清单）

1. 真跑保存的完整故障集合；各操作类别 + 路径前缀逐个推进 N，直到一个未注入且成功的末轮；打印轮数、调用数、注入数、睡眠毫秒、JSON 次数及完整性结果。
2. 四条判据：精确睡眠毫秒有界；结果成功或有类别错误；故障后紧接的无注入保存成功且零锁/候选/release/暂存，再由真实新 pid 保存并同样零残留；旧 `project.json` 完整（完整旧快照或完整预期新快照，不能只核一个 payload 字段）。注入超过保存提交边界时必须区分已提交的新完整快照，不能将保存返回失败等同所有文件没更新。
3. 分别报告 `jsonFile.ts` 重试、`workspaceRegistry.ts` 自旋和大 JSON 遍数的现状；只为测得的旧债登记精确路径、上限、出处，不扩大豁免。
4. 反例：临时关闭注入但保留扫描断言，命令必须退出非零，由窗内注入计数 >0 断言报错。
5. 反例：新增第七处 `Atomics.wait`，ESLint 必须红；换到不同文件而总数不变也不能通过文件身份校验。主进程含 quitTeardown 和已有退出豁免文件，测试不在禁用范围。
6. 反例：删掉一处却不降低基线，棘轮必须红；同步降低对应文件次数后应绿。
7. 反例：调高豁免上限，必须红；降低才可通过。大 JSON 次数基线也不得上调。
8. 反例：构造覆盖文件改动，用现有路由与证据判据证明推出 `perf` 且要求 `perf-scenario`；测试、文档及无关路径应保持原路由。
9. 忙机器连续三次执行扫描，逐次保存原始输出，精确计数完全一致。负载数字只报告，不作为本测试放行条件；禁止用真实睡眠和墙钟预算。
10. 跑 `pnpm run gates`，退出 0 后在门岗锁中跑 `NOMI_PR_BODY_FILE=.tmp-pr-body.md node scripts/pre-push-contracts.mjs`，保留尾行与退出码。每次提交前跑 `node scripts/fix-churn.mjs --staged`。
11. 范围核对：产品代码差异为零；只本地提交、不推送。正文不提交，不含内部编号、报告名或本机临时路径。用户真实资料、探针原型保持不动。
12. 未覆盖边界写进性能说明：生成完成落地、自动保存触发次数、大工程真实 Electron、manifest 长窗口、旧数据迁移、其他资产调用者、平台与真盘差异；不能用本扫描替代这些场景。

回滚：revert 本卡后续测试/门岗提交即可，产品没有新增运行时逻辑。独立验收由协调另排，本线不得自签独立验收。

## 开工前方向检查

`node scripts/fix-churn.mjs --json scripts/check-heavy-path.mjs docs/engineering/test-routing.json scripts/heavy-path-baseline.json electron/workspace/saveFaultSweep.test.ts docs/engineering/perf-scenarios.md` 退出 1：仅命中自写登记 `gate-family`，状态 `under-review`，近 30 天 95 个 fix，本次为第 96 个。

文件自身未命中，但本卡新增门岗类别，不满足任务允许的“换或删、不新增分支”例外。依任务停止实现；方向复盘见 [方向检查](../engineering/direction-checks/2026-10-30-save-fault-sweep.md)。上述为原暂停记录。协调已裁定用 ESLint 核心规则和原生 bulk suppressions 接入；Context7 的 ESLint v10.2.1 文档已核实 `--suppress-rule` / `--prune-suppressions`，本机已装 10.4.1，源码亦支持。后续仍须逐项留下实跑收据；不得修改被点名排除的 heavy-path 文件。

## 实现进度与收据

协调裁定后已接入 ESLint 核心语法限制和原生 bulk suppressions（现有六个文件各 1 处），路由规则和类测试已落地；不改 heavy-path。Context7 来源：[ESLint CLI v10.2.1](https://github.com/eslint/eslint/blob/v10.2.1/docs/src/use/command-line-interface.md)，本机 10.4.1 已实跑。

静态规则测试 14/14；路由及缺失证据测试 13/13。新增 wait、删除但不 prune、关闭注入、睡眠上限 5200→5201 四条变异均实际报红，修改按字节还原。

整链扫描测得 JSON 12/14 次、同步请求睡眠最大 5200/3010ms；不是孤立墙钟值。旧“错误当下零残留”口径曾产生 44 红，现已按源码合同撤回该判据和产品缺陷判断。最小 ENOSPC（project/open N=3）旧 JSON 完整，出错当下有锁元数据；必须验证下一次保存成功并严格清零。
前缀边界复核：包含隔离目录本身及其子路径，排除同名前缀兄弟目录；对应纯边界测试已加入。健康保存 settings/mkdir 为 3 次（此前只计子路径会漏根目录的两次 mkdir），I/O 合计 63 次。前缀退化变异必须红，不能让正计数掩盖漏掉根路径。

## 本轮恢复合同（实现前更新 ★9）

`workspaceManifestLock.ts:105–120` 的 own-abandoned nonce 判据、`:229–233` 的 release 下次清理合同及 `:277/:353` 的死进程回收，规定残留不得挡住后续保存；不是错误当下必须没有元数据。原“出错当下零残留”断言删除，不并存两套口径。

每个实际命中的 N：①当前 manifest 必须为完整旧快照或完整已提交新快照；②保存最终失败必须返回有类别错误，若既有重试后实际写成则允许成功，但成功返回值必须与落盘一致；③关闭注入后，立即在同进程再保存，必须成功且锁/候选/release/quarantine/临时文件严格零；④真实子进程以新 pid 冷加载保存实现，再保存一次，必须成功且同样严格零。原始请求睡眠/JSON 计量窗在恢复前关闭，不能将恢复工作混进原基线。

反例：注入关闭仍必须由命中计数 >0 报红；恢复保存拒绝、恢复后残留、新进程保存拒绝均必须导致扫描红。进程 pid 由真实 Node 子进程返回，并验证不同于父 pid；不得模拟 fresh-module 充作重启。另用真实子进程持锁后退出、下一进程接手的对照核查 dead-owner 回收。

全扫描仍红则按“旧快照/结果真实性/同进程恢复/新进程恢复/恢复后残留”分组给最小 N 及用户影响，不改产品、不放入性能旧债。全部通过才继续完整 gates 和推送前快检。此前 44 红仅保留为旧口径历史，不再称产品已证实缺陷。参考任务给的 try-model-intent-restart.mjs 在当前工作树与当前 origin/main 都未找到，本线以已装 tsx 的真实 Node 冷加载实现同等进程边界，不增加包。
