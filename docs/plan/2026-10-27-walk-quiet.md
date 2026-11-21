# 2026-10-27 走查后台安静设计卡

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## ★1 用户怎么用 / 怎么量

走查脚本经 `tests/ux/_launchApp.mjs` 启动隔离 Nomi 时，默认窗口屏外、不可聚焦，且所有会把控制权交给 macOS 的出口只留记录。用户可以继续在前台使用 Claude 或其它应用。真实前台行为走查必须写 `launchNomiApp({ foreground: '<原因>' })`，并由 `NOMI_WALK_FOREGROUND_OK=1` 明确放行。

量具：Mac 上启动后、运行中每秒、关闭前各执行一次 `lsappinfo front`，再用 `lsappinfo info -only pid <ASN>` 取最前应用 PID，用 `lsappinfo info -only ApplicationType <ASN>` 取 Dock/前台类型。成功标准是普通走查全程没有走查 PID 在最前；应用类型不是 `Foreground`；走查记录数组中没有被执行的外部打开。指标是「抽样中走查 PID 占全部抽样的比例 = 0%」。真实任务：模型接入 J04、技能库/提示词库排版走查各跑一次；中英文结果分别留原始日志。

出处与决定：Electron 官方 `showInactive()`、`focusable`、`app.focus({ steal })`、`app.setActivationPolicy('accessory')`；Playwright Electron 官方文档。Playwright 没有不激活启动选项，所以在主进程入口前注入同一仪表。

## ★2 谁说了算

走查控制权的 owner 是 `tests/ux/_launchApp.mjs` 的 `launchNomiApp`：它决定是否注入仪表、是否接受 `foreground` 声明、是否启动 Mac 前台门岗。仪表记录的事实唯一存于主进程 `globalThis.__nomiQuietWalk`，走查通过 `electronApp.evaluate()` 读取；不在渲染层复制状态。外部打开、通知、对话框替身和窗口调用都经过同一份注入模块。

## ★3 一致与复用

复用现有 `mainRequireArgs`、打包形态的 `requireBeforePackagedMain`、`closeElectronWithin` 和 `_launchApp.test.mjs`，把 `_quietWalk.cjs` 从可选模块提升为默认注入。不改 `electron/` 或 `src/` 产品代码，不新增 npm 包，不保留旧屏外开关。

前台门岗、外部出口记录、原生对话框 fail-closed 和窗口包装都只在 `_quietWalk.cjs` / `_launchApp.mjs` 定义，不在每条走查里复制。

## ★4 全状态

- 默认走查：窗口放屏外、不可聚焦、全透明（`opacity: 0`）、鼠标穿透；`show()` 转为 `showInactive()`，`focus()` / `moveTop()` 无动作，App 自己的 `setOpacity` / `setIgnoreMouseEvents` 只记录；`app.focus()`、Dock bounce、外部打开、系统通知只记录；未替身的原生对话框抛出「走查要先替身这个对话框」；`showErrorBox` 写主进程日志。
- 为什么还要透明 + 穿透（第 2 轮真机发现）：macOS 不认屏外坐标，会把窗口夹回主屏可见区左缘（实测窗口落在 x=-1240、y=33、1280×863，主屏左边露出 40px 宽一条），`showInactive()` 又把它排到用户窗口上面。透明 + 穿透之后这一条看不见、点不着；窗口照旧算「显示中」（`isVisible()` 为真），不改成永不显示——task-center-states 的 `capturePage`、canvas-follow-hand 的躲光标都按可见窗口找。
- 激活策略（第 3 轮，方案 B）：Mac 上仪表在 `will-finish-launching`（AppKit 的 applicationWillFinishLaunching，早于启动即激活）切 `prohibited`（BackgroundOnly：不进 Dock，系统不许激活它），`ready` 切回 `accessory`（UIElement：窗口照常上屏，不进 Dock / Cmd-Tab）。App 自己调 `app.setActivationPolicy` 只记录、不生效，不然 prohibited 那一段会被它提前结束。起进程到 `will-finish-launching` 之间系统仍先登记成 `Foreground`（开发版 Electron.app 的 Info.plist 没有 LSUIElement，改不了），Dock 可能闪一下图标。单测钉住三个时刻：模块刚装上不切、`will-finish-launching` 只切 prohibited、`ready` 再切 accessory，App 自己要 `regular` 只进记录。
- **启动即激活（第 2 轮真机发现；第 3 轮方案 B，真机未验证）**：用户正在用的应用就是起走查的那个 App（Claude 桌面版——Claude Code、node、走查的 Electron 都是它的子进程）时，走查 App 一登记完就被 macOS 激活成最前应用（第 2 轮 3 次里 3 次；用户在 Chrome 时 3 次里 0 次）。主进程这边没有任何聚焦调用，激活来自 AppKit 原生的启动即激活：LaunchServices 把父 App 推断成 Claude，Claude 在最前时系统放行。第 3 轮改成上面的激活策略（prohibited → accessory）；管没管住要用户在 Claude 里试跑才量得到，第 3 轮按规矩每分钟看一次、等了 30 分钟（10-27 04:50–05:20），最前一直是 loginwindow（屏幕锁着），0 次试跑，结论 unverified。管不住时按方向检查往下走：先试变体（prohibited 留到第一扇窗口上屏后约 1 秒再切 accessory，要核窗口可见、页面 `visible`、截图不空白），再上 A（Mac 上经临时 LaunchAgent 起，换掉发起方）。门岗照样当场判红（退出码 1），当量具。
- 前台声明缺失放行变量：不启动 Electron，打印「未跑：这条走查需要前台，会打扰正在用电脑的人」，退出码 125。
- 前台声明并显式放行：窗口/应用前台动作恢复真实行为，仍保留外部打开、通知和未替身对话框的安静边界；门岗不把这条走查判成抢前台。
- 门岗发现普通走查抢前台：记录时间、PID、应用类型；在进程 `'exit'` 回调里把退出码钉成 1——走查结尾自己 `process.exit(0)` 或 `exit(125)` 都盖不掉，其它非零红码保留走查自己的；不杀用户进程。
- 门岗关门（`close()`）时打一行抽样汇总：全程最前应用「名字(pid)×次数」、走查 App 自己的 `ApplicationType`（关门后那次 App 已退出，记「已退出」）、判定（没抢前台 / 抢了几次 / foreground 豁免）。
- 跑走查的终端 export 了 `NOMI_WALK_FOREGROUND_OK=1`：没声明 foreground 的走查起的 App 环境里仍是空串（`buildNomiLaunchEnv` 排在 baseEnv / extraEnv 之后钉死），仪表照样安静；声明了的才是 `'1'`。
- 非隔离启动（`isolate: false`，真实资料）：mainRequire 只许装进隔离资料，仪表装不上。没声明 foreground → 起 App 之前抛错「非隔离启动装不了安静仪表，要声明 foreground」；声明了没放行 → 退出码 125、不起 App；放行 → 起真实资料 App，门岗豁免。8 个入口（ui-driver、mcp-client-activation `--real-connect`、scripts 下 4 个、evals 下 2 个）都已声明。
- 依赖真焦点 / 真窗口的旧走查（app-page-zoom、attention-sound、window-drag、windows-freeze-sweep）：声明 foreground，没放行按 125 退出，不在安静模式下悄悄不测还报绿；windows-freeze-sweep 在清掉上一轮报告之前先判放行。
- 不经 launchNomiApp、直接 spawn Electron 的三处（plan-gate、p4-s6p5-multishot-paid 的 stdio MCP 子进程，memory.e2e 量内存的那个实例，第 3 轮）：一律经 `spawnQuietElectron`——`-r` 装同一份仪表；子进程环境里的放行位钉成空串，排在调用方 env 之后，终端 export 的 `1` 漏不进来；起跑前和 launchNomiApp 开发版同一套核对（构建戳、构建产物、Electron.app 签名）。仓库里直接 spawn Electron 又装仪表的只许经它，单测扫描钉住。
- 评测借真实资料的 app 桥（`evals/loop/appBridge.mjs`，第 3 轮）：没放行时真实资料一个字节都不读——探可用性的（`resolveModels` / `modelLabels` / `textAvailable`，loop 和 report 拿来打标签、选规则版）一律答「没配」；要发请求的（`chatText` / `chatVision` / `genImage`）在读 catalog 之前按 125 跳过，不起 App。
- 屏外仪表只剩一份（第 3 轮，P1）：`tests/ux/full-walk/offscreenWindow.cjs` 和装它的地方（9 条走查的 `mainRequire`、full-walk 启动器的 `offscreen` 选项、用这个选项的两条剧本）都删了，这些走查照旧经启动器默认装 `_quietWalk.cjs`。单测钉住「挂 `browser-window-created` 的主进程走查仪表全仓只有 `_quietWalk.cjs`」。
- 屏外窗口的页面可见性：没碰上遮挡。第 2 轮真机 6 次启动（含透明 + 穿透之后的 4 次），每 3 秒取一次 `document.visibilityState`，全部是 `visible`（共 76 次），截图完整；所以没加 `backgroundThrottling: false` 和三个 Chromium 开关。
- Windows/Linux：不启用 `lsappinfo` 门岗，窗口/出口仪表仍工作；残余风险写在报告。

## ★9 验收与回滚

验收清单（实现线先跑，验收线逐项复核）：

1. 反例：去掉 `show()` → `showInactive()` 替换，单测必须红；保留替换时单测绿。去掉透明 + 穿透、去掉 `setOpacity` / `setIgnoreMouseEvents` 两扇门的包装，各自的单测也必须红（激活策略的反例见第 16 条）。
2. 反例：去掉前台 PID 相等判定，门岗单测必须红；PID 不相等时单测绿。
3. 主进程假 Electron：构造选项含 `show:false`、屏外坐标、`focusable:false`、`opacity:0`；调用 `show()` 只触发 `showInactive()`；仪表自己调一次 `setOpacity(0)` / `setIgnoreMouseEvents(true)`，App 后来的改动只进记录；`will-finish-launching` 切 prohibited、`ready` 切 accessory（第 3 轮），App 自己改激活策略只进记录。
4. `app.focus`、Dock `bounce`、`shell.openExternal/openPath/showItemInFolder`、`Notification.show` 只进记录数组且不调用原方法。
5. 原生对话框未替身抛出固定中文错误；`electronApp.evaluate()` 替身后调用走替身；`showErrorBox` 不开窗口而写日志。
6. `foreground` 没有 `NOMI_WALK_FOREGROUND_OK=1` 时不调用 Electron 启动；有放行变量时允许启动。
7. Mac 真机不设任何屏外变量，排门岗锁跑 `node tests/ux/model-access-journeys/run-journeys.mjs J04` 和 `node tests/ux/library-layout.walk.mjs`：全程最前应用不是走查 PID，`ApplicationType` 不是 `Foreground`，外部打开记录为空。
8. 反例边界：所有经 `_launchApp.mjs` 的开发版 / 打包版入口都装同一模块；显式 `mainRequire` 不重复注入；旧屏外模块 `_offscreenWindows.cjs` 和环境开关全仓不存在。（第 2 轮更正：另有一份 `tests/ux/full-walk/offscreenWindow.cjs`，9 条走查经 `mainRequire` 显式装，和 `_quietWalk.cjs` 叠着跑；第 3 轮已删，见第 12 条。）

第 2 轮（协调审 diff 补的 4 件 + 真机）：

9. 反例，各自拿掉后对应单测必须红、恢复后全绿：
   - 去掉门岗的 `process.once('exit', …)`：子进程判红后 `process.exit(0)` 退出码变回 0；
   - 去掉 `buildNomiLaunchEnv` 里 `NOMI_WALK_FOREGROUND_OK` 的钉死：baseEnv / extraEnv 里的 `'1'` 漏进 App 环境；
   - 去掉非隔离断言：没声明 foreground 的 `isolate: false` 不再被拒；
   - 去掉 8 个非隔离入口的声明：AST 扫描（仓库里每个 `isolate: false` 选项都带 foreground）红；
   - 去掉 4 条真焦点走查的声明：名单单测（含「用到 bringToFront 的走查都要声明」）红。
10. Mac 真机三条，不设任何屏外变量、不带 `NOMI_WALK_FOREGROUND_OK`，排门岗锁、先 `pnpm build`：
    - J04、library-layout：门岗抽样全程最前应用不是走查 PID；走查 App 的 `ApplicationType` 是 `UIElement`；`__nomiQuietWalk.events` 里没有被执行的外部打开；记下页面 `document.visibilityState`；library-layout 截图亲眼看过、不是空白；
    - `mcp-key-window`：退出码 125，打印「未跑：…」，不起 App；
    - 量具：门岗自己的收尾汇总行，加一份独立于门岗的 `lsappinfo` 外部抽样（每 0.5 秒：最前应用 + 这棵工作树的 Electron 的类型），两份对得上才算；再加两路独立观察：CGWindowList 窗口元数据（每 0.5 秒：走查 PID 上屏窗口的坐标、alpha、层级，不取画面）和 `lsappinfo listen` 的系统通知（应用登记 / 类型变化 / 成为最前，事件驱动，不靠抽样碰运气）。
    - 窗口：走查 PID 的上屏窗口 alpha 全程为 0（看不见）；系统通知里走查 App 没有一次「成为最前」；类型只在起进程到 `ready` 那约 0.5 秒是 `Foreground`，之后一直是 `UIElement`。
    - 实测（第 2 轮）：窗口 alpha 全程 0、页面全程 `visible`、截图完整；「没有一次成为最前」只在用户不在 Claude 里时成立（见 ★4「没管住的一条」），未达标，按停点交协调。
11. 本轮改过的走查 / 入口都真跑一次跳过路径（不带放行变量）：退出码 125、不起 App；window-drag 在非 Windows 上照旧 0；windows-freeze-sweep 不清上一轮报告。不跑声明了 foreground 的真前台路径（用户就在这台电脑上）。

第 3 轮（第 2 轮发现的问题一起收掉）：

12. 删旧模块（P1）：`tests/ux/full-walk/offscreenWindow.cjs` 删掉；9 条走查只删 `mainRequire: [offscreen]` 和那一行声明；full-walk 启动器的 `offscreen` 选项、两条剧本的 `offscreen: true`、`eslint-suppressions.json` 里那一条一起删。9 条里真跑 2 条（中英各一段，量具同第 10 条的门岗收尾行），其余靠静态门岗和单测。反例：放回一个挂 `browser-window-created` 的屏外模块，单测红。
13. 直接 spawn Electron 的三处经 `spawnQuietElectron`。反例：去掉子进程环境里的放行位钉死，单测红（终端 export 的 `1` 漏进子进程）；把任一处改回自己 `spawn(require('electron'), ['-r', <仪表>, …])`，扫描单测红。
14. `evals/loop/appBridge.mjs`：没放行时 `resolveModels` / `modelLabels` / `textAvailable` 不读真实 catalog、答「没配」；`chatText` / `chatVision` / `genImage` 读 catalog 之前按 125 退出、不起 App（单测换掉 `readRealCatalog` 和 `launchNomiApp` 数调用次数）。反例：去掉可用性探测前的放行判断、或去掉发请求前的放行判断，单测红。
15. 文档：`docs/release-process.md` 的 Windows 卡顿巡检命令带上 `NOMI_WALK_FOREGROUND_OK=1`（PowerShell 写法另注）；`docs/engineering-rules.md` 写 `ui-driver.mjs` 的地方写明它默认开真实资料、要带放行变量。
16. 激活策略（方案 B）：单测钉住三个时刻（模块刚装上不切；`will-finish-launching` 只切 prohibited；`ready` 再切 accessory；App 自己要 `regular` 只进记录）。反例，各自拿掉后单测必须红：去掉 prohibited、把 prohibited 挪到 `ready`、去掉 `ready` 的 accessory、让 App 自己的 `setActivationPolicy` 照真的走。真机：用户在 Claude 里（试跑前 `lsappinfo front` 是 Claude、`vm.loadavg` 第二个数 < 10）J04、library-layout 各跑一次，四份量具（门岗收尾行、外部 `lsappinfo` 抽样、CGWindowList 窗口元数据、`lsappinfo listen`）里走查 App 成为最前 0 次才算管住；管住了再在用户用别的 App 时各跑一次，确认没回退。第 3 轮实测：等了 30 分钟用户不在 Claude 里（屏幕锁着），0 次试跑，unverified。

自验命令与回滚：单测、改动文件 ESLint、`check-e2e-launch`、`check-walkthroughs`、`check-file-sizes`、`git diff --check`、`check-root-cause-contracts`、`check-concept-owners`、推送前快检及三条真机走查。回滚为在任务分支上 `git revert <实现提交>`；不改用户资料、不推送、不合并。

### 功能分类

- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为（`evals/` 下两个评测入口 verify-shot-smoke、loop/appBridge 加了放行判断与 125 跳过；不改 Agent 的说法、摆法或方案）
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

### 外部出处

- Electron BrowserWindow API：<https://www.electronjs.org/docs/latest/api/browser-window>（`showInactive`、`focusable`、`show`/`focus` 语义）。
- Electron app API：<https://www.electronjs.org/docs/latest/api/app>（`app.focus({ steal })`、`setActivationPolicy('accessory')`、Dock 语义）。
- Electron shell / Notification / dialog API：<https://www.electronjs.org/docs/latest/api/shell>、<https://www.electronjs.org/docs/latest/api/notification>、<https://www.electronjs.org/docs/latest/api/dialog>。
- Playwright Electron API：<https://playwright.dev/docs/api/class-electron>（无不激活启动选项；原生 dialog 需 `electronApplication.evaluate()` 替身）。
- Electron 43.4.1 macOS 源码：<https://github.com/electron/electron/blob/v43.4.1/shell/browser/native_window_mac.mm>（`Show()` / `ShowInactive()` / `Focus()` 的激活路径）。
