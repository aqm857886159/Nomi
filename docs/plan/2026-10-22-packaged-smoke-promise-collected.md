# 打包冒烟「Execution context was destroyed」——主进程 evaluate 的结果被 GC 收掉（R-mac-smoke-flake）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：Playwright 主进程 evaluate 结果保活 + 打包冒烟每夜跑　　线：R-mac-smoke-flake　　类别：[其他]（测试基础设施 / CI）

## 根因（证据在前）

- **症状**：CI「Mac Package」打包冒烟 `tests/ux/packaged-mcp-smoke.e2e.mjs` 读主进程 env 那一行偶发报
  `electronApplication.evaluate: Execution context was destroyed, most likely because of a navigation.`
- **直接原因**：Node 调试协议对 `Runtime.callFunctionOn` 回了 `{"code":-32000,"message":"Promise was collected"}`；
  Playwright 的 `crExecutionContext.rewriteError` 把一切认不出的协议错误都改写成「context destroyed」，所以报错和导航无关。
  本机 Windows 打包产物 30 次启动挂 3 次，三次的原始协议错误全是这一句（`DEBUG=pw:protocol`）。
- **类根因**：Playwright 每次 evaluate 都带 `awaitPromise: true`；V8 调试器把返回值包成一个 promise，**只弱引用它**，
  等微任务回调再回包。Electron 主进程（Node 调试器）在 JS 正忙时用中断插队处理调试消息，回包要等这段同步代码跑完；
  这期间任何一次 GC 都会把那个 promise 收掉，结果就丢了。渲染进程（Chromium 在任务之间派发）不受影响。
  所以凡是「主进程正忙时的 Playwright 主进程 evaluate」都会偶发挂——打包冒烟恰好在启动后主进程最忙的那一两秒里读 env。
- **确定性复现**：开发版 Electron 起一个只在主进程忙循环的最小 main，`app.evaluate(() => process.pid)` 30/30 挂；
  纯 Node 版同样 239/240 挂；返回值改成「先强引用、落定后下一个宏任务再放」的 promise，120/120 成功。
- **上游**：microsoft/playwright#41826（同一错误，维护者认为是 V8 行为、不改）；#27867（2023 同一现象的修补 PR，未合）；
  tlockney/cdp-kernel#55 写清了「普通返回值也被弱持有」。
- **#1264 不是原因**：10-18 已在 #1244 合入提交和 v0.23.2 版本提交上各挂一次（同一句、同一位置），早于 #1264；
  近 30 天 Linux 的 Canvas Acceptance / Core Smoke / 画布跟手也各出现过这句（主进程 browserWindow / evaluate）。
- **09-12 那条「热启动 URL 改写」说明多半认错了**：`app.browserWindow(win)` 的句柄在主进程，不绑页面上下文；
  当时的「重启那次起不来」与本类同形（主进程热启动更忙）。

## ★1 用户怎么用

当我（任何跑走查 / 冒烟 / 打包门的 agent 或 CI）对 Electron 主进程做 `app.evaluate` / `browserWindow` / 主进程句柄 evaluate 时，
我想拿到结果或真实错误，以便门岗红只因为产品错。不做：不改产品主进程启动顺序（忙是正常的，换个时刻还会忙）；
不加重试吞错（evaluate 体可能有副作用，丢的是回包不是执行）。真实任务：①打包冒烟 `dist:mac:dir`；②Linux 画布验收的 `browserWindow`；
③`canvas-follow-hand` 的主进程内存读。主指标：打包冒烟此类报错率，基线 CI 10-18 起约 6/78、本机打包探针 3/30，目标 0；
量具：本机探针（`tests/ux` 下临时诊断脚本，实验后删）+ 新增类回归测试 + CI 实验运行号。

## ★2 谁说了算

「主进程 evaluate 的结果送达」唯一 owner = Playwright 注入的 UtilityScript（`playwright-core` 的 `UtilityScript.evaluate`）；
所有入口（启动器、冒烟、走查、评测里的 `app.evaluate` / `app.browserWindow` / 主进程 JSHandle）都经过它，改这一处覆盖全部入口。
门表见根因合同 `doors`（`node scripts/door-map.mjs` 输出）。

## ★3 一致与复用

不自写：用 pnpm 自带的 `patchedDependencies` 给 `playwright-core@1.60.0` 打补丁（仓库已有先例 `patches/img-fx@0.5.1.patch`）。
上游已明确不修，换库无替代（Electron 主进程只有 Playwright 这条官方通道）。补丁随 Playwright 升级强制复核（pnpm 打不上即装依赖失败）。

## ★4 全状态

不适用：无界面。失败形态只剩两种：主进程真抛错（原样冒出）、会话真断（Playwright 原有「已关闭」错误）。
另把改写后的错误带上原始协议消息，下次一眼看出是不是导航。

## ★9 验收与回滚

见下「验收清单」。回滚：revert 本 PR 的提交（删补丁与 package.json 一行即回到原行为）。

## 验收清单（实现前写）

| # | 检查项 | 怎么验 | 通过标准 |
|---|---|---|---|
| 1 | 类回归测试先红后绿 | 新测试：开发版 Electron 起「主进程忙循环」最小 main，`app.evaluate` 30 次 + `browserWindow` 句柄 evaluate；先在不带补丁的依赖上跑 | 补丁前 ≥1 次失败（实测 30/30），补丁后 0 次 |
| 2 | 补丁真的打进了装好的依赖 | 同一测试里断言注入的 UtilityScript 源码含保活标记；`pnpm install --frozen-lockfile` 干净通过 | 断言通过；lockfile 有 patch hash |
| 3 | 报道案例：本机 Windows 打包产物 | `electron-builder --win dir` 后跑探针 30 次（每次启动后 6 秒连续主进程 evaluate） | 0 次失败（基线 3/30） |
| 4 | 报道案例：Mac CI | 实验分支跑 Mac Package，打包后同一探针 20 轮 + 正式冒烟 | 0 次失败；运行号写进报告 |
| 5 | 语义不变 | 返回 promise / 抛错 / 返回 handle / returnByValue 四种 evaluate 结果与补丁前一致（类测试覆盖）；渲染进程 `page.evaluate` 不受影响 | 全部一致 |
| 6 | 误导报错修正 | 构造协议错误（同一测试的未打补丁形态或直接 CDP），确认 Playwright 报错里带原始协议消息 | 报错含 `Promise was collected` 原文 |
| 7 | 旧的错误归因清掉 | `_launchApp.mjs` 里 09-12「热启动 URL 改写」那段注释改成真实机制；那次 `waitForURL` 等待若只为躲这个类就删掉（P1），删前跑核心冒烟 + 两条走查确认不依赖它 | 注释与机制一致；删 / 留有证据 |
| 8 | 缺口：打包冒烟谁来跑 | 每夜工作流加一格 macOS 打包冒烟，结果走现有每夜汇总 / issue；不动 `validation-policy.mjs`（热点，近 30 天第 6 刀） | `check:quality-gate-workflow` 绿；工作流手动触发跑通一次（运行号） |
| 9 | 根因合同 | `docs/fixes/2026-10-22-playwright-main-evaluate-promise-collected.root-cause.json`（v3，含 door-map、retain-with-exit 依赖决定、退出条件） | `pnpm run check:root-cause-contracts` 绿 |
| 10 | 门 | `pnpm run gates`（Windows 上走不完的部分如实记 unverified） | 记录结果 |

协调 10-22 回复：1–10 全认；第 7 项默认删、第 8 项走每夜工作流均批；实验分支不推，第 4 项改为本 PR 的 Mac Package 跑 3 次（首跑 + 重跑 2 次）0 挂算过。

反例（这一类还会从哪回来）：①别的调用者——所有主进程 evaluate 走同一 UtilityScript，补丁覆盖；②别的平台——Linux / Windows / Mac 同一 V8 行为，类测试三平台都能跑；
③Playwright 升级——补丁打不上 pnpm 直接失败，逼人复核；上游若改成强引用，删补丁；④有人绕过 UtilityScript 直接发 CDP `awaitPromise`——仓库里目前只有 `requireBeforePackagedMain` 一处自发 CDP，它用的是 `evaluateOnCallFrame` 不带 awaitPromise，不受影响。
