# 常驻交互驱动升级成各线验证的默认工具（短版设计卡）

实现线写，2026-11-15。只改测试仪器（`tests/ux/ui-driver.mjs`、`tests/ux/ui.mjs`、`tests/ux/uiDir.mjs`、`tests/ux/_shell.mjs` 补出口）、加一份验证技能和功能地图（`.agents/skills/verify-nomi/`）、一个量用量的脚本；产品代码一个字不改。

## ★0 先查别人

1. Lauren Tan 的 `create-verification-skill`（cursor/plugins 仓库 pstack 目录）· 每个项目一份验证技能，固定六节：起、自检（这个实例值不值得驱动）、驱动、取证、清理、助手；外加功能地图，每个功能一份文件、四节（子功能、从用户角度怎么走到、用驱动怎么做、坑）；生成后必须自己照着跑通一遍、清理后证据还在 · 技能和地图就照这个形状写；第 9 步「照着技能做一次真验证」就是它的第 4 节。
2. 微软 `playwright-cli`（github.com/microsoft/playwright-cli，README 核过：`attach --cdp=<地址>` 接已开着的浏览器，`snapshot` 出带 `e<编号>` 的页面快照，`click <编号>` / `fill <编号> <字>` / `screenshot --filename=`，`detach` 不关对方；本地 playwright ≥ 1.59 可用 `npx playwright cli`）· 先试接：接得上我们的 Electron 窗口就把驱动里自写的「列可点元素 / 按文字点 / 填」删掉换它；接不上照实写卡在哪。
3. 我们自己 10-15 的方向检查（`docs/engineering/direction-check-2026-10-15-walkthrough-instruments.md`）· 外壳可达操作只有一个出口 `tests/ux/_shell.mjs` · `goto` 只调 `_shell.mjs` / `_canvasHit.mjs` 的出口，缺的补进 `_shell.mjs`，驱动里不另写选择器。
4. 补核：Playwright 的 Electron 启动器自己就带 `--remote-debugging-port=0`（playwright-core 1.60 `electronArguments`），Chromium 的调试口默认只绑 127.0.0.1；所以试接不需要再开新端口，读现有那个口即可，打包配置不沾。

## ★1 用户怎么用（这里的「用户」是做验证的线）

当我要验证一处界面改动时，我想一条命令起一个隔离、安静的 Nomi，按名字走到那一屏、点、截图，以便把力气花在验证本身，而不是重新摸「怎么起、怎么走到、选择器是什么」。

| 指标 | 量具 |
| --- | --- |
| 每条线现写驱动脚本个数 / 行数（目标：用技能的线 0） | `node scripts/verify-line-meter.mjs <线目录>`；基线 `--lines /…/tmp --prefix V- --days 14` |
| 每条线调这只驱动的次数（目标：> 0） | 同一量具，数证据目录里的 `commands.jsonl` |
| 从 `up` 到可驱动秒数 | `ui.mjs up` 打印的 `ready in Ns` |
| 第 9 步：命令条数 / 现写行数 / 分钟 | 同一量具 + 计时（报告里） |

不做什么：不改 461 条回归走查；不改 `_launchApp.mjs` 的能力目录和隔离那几行（另一条线在改）；不往 `package.json` 加依赖。老用户：装好的应用和存着的项目碰不到；以前裸跑这只驱动的人会得到隔离空实例，启动第一行写明怎么要回真实资料。

## ★2 唯一 owner、读写边界

驱动的启动默认值、单实例锁、证据落点 = `tests/ux/ui-driver.mjs`（参数解析放在它旁边的 `tests/ux/uiDriverOptions.mjs`，纯函数可测）；命令表 = `tests/ux/ui.mjs`；IPC 目录 = `tests/ux/uiDir.mjs`；功能名 → 出口 = `tests/ux/verifyFeatures.mjs`（只调 `_shell.mjs` / `_canvasHit.mjs`）。驱动只写 IPC 目录、自己建的临时资料目录、证据目录；不读不写真实资料。证据：`node scripts/door-map.mjs tests/ux/ui-driver.mjs`。

## ★3 以前定过什么、选哪条路

定过：驱动「默认真实资料、前台」是 10-27 抢前台根因合同里写明的既定设计（为了能开已有项目）；10-15 定外壳只走 `_shell.mjs`。现在任务书要求各线默认不碰真实资料，所以翻默认：隔离 + 安静为默认，真实资料要显式 `--real-profile` 且仍要 `NOMI_WALK_FOREGROUND_OK=1`（走原有 `launchNomiApp({ isolate: false, foreground })`，不新开路径）。三条路：沿原方向（只改文档提醒加环境变量）——不解决「没人用」；换成现成工具（playwright-cli）——先试接再定；删掉驱动让各线自写——就是今天的浪费。选：翻默认 + 试接现成工具 + 地图。复用的既有边界：`launchNomiApp` 的 `tempRoot` / `capabilityDir` / `viewportSize` / `initialLocalStorage` 入参、`assertFreshBuild`、`_shell.mjs`。

## ★4 各状态一句

空：`--data empty` 起空项目库；加载：`up` 等到窗口可驱动才返回，超时打印主进程日志尾；成功：`goto` 回一行「现在在哪 + 截图路径」；失败：`goto` 说清卡在第几步、哪个出口报的什么；取消：`down` 只关自己起的实例，证据留下；过期：`doctor` 报构建戳和源码不一致；能力不可用：同一工作树已有实例时 `up` 明确报错、不抢。

## ★9 验收清单与反例（动手前写全）

验收：另一条线只用 `.agents/skills/verify-nomi/SKILL.md` 里的命令，做「英文深色、700×720：进分镜页，把一镜图片镜的方式从图生图切成文生图，确认红框消失」，现写脚本 0 行。

| # | 反例（改坏） | 期望 |
| --- | --- | --- |
| 1 | 把默认改回开真实资料 | `tests/ux/uiDriverOptions.test.mjs` 红 |
| 2 | 功能地图里写一个不存在的 `goto` 名字 | 地图静态检查（`check:walkthroughs` 里的 `verify-features.node-test.mjs`）红 |
| 3 | 删掉 `_shell.mjs` 里一个被地图引用的出口 | 同上红 |
| 4 | `shot` 默认落回仓库里 | 驱动选项测试红 |
| 5 | 同一工作树起第二个实例 | `up` 退出非零、打印已在跑的 pid，第一个实例不受影响 |
| 6 | 外面设了 `NOMI_CAPABILITY_DIR` 再起 | 隔离实例用自己的 `<tempRoot>/capability`（驱动显式传 `capabilityDir`，选项测试钉住） |
| 7 | `--real-profile` 但没设 `NOMI_WALK_FOREGROUND_OK=1` | 按 125 跳过，不起 App（只测代码路径，不真起） |
| 8 | `--data` 传任意路径 | 报错并列出可选夹具名 |

回滚：revert 本 PR 的提交即可，产品代码未动。
