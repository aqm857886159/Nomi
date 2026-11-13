# 方向检查：桌面主窗口的生命周期（叫回 / 关窗 / 退出）——#1424 三轮没过后的独立复盘

> 本文件由实现线 I-app-reopen-owner 落库：第 0–8 节是独立复盘线 D-app-reopen-direction-r2 的原文（事实照搬；只把私有待办编号换成问题描述，公开仓库不收编号）；文末「结论（拍板原话）」和「设计卡」两节是实现线补的，结论只写用户和协调的原话。

- 线：D-app-reopen-direction-r2（Claude Opus，只读）。写于 2026-11-09。
- 概念：桌面主窗口的生命周期（私有待办里「点开没反应、关窗退不出」那一条 / PR #1424）。
- 读的代码：main = `origin/main` 23fe40178；PR 头 = `refs/remotes/pr/1424` 7053ad799（merge-base 45bf882e4）。都用 `git show` / `git archive` 读，没切分支、没改工作树。
- 独立性声明：第 0–7 节写在读原方案（`D-app-reopen-direction.md`、旧 `direction-check.md`、两份 V 报告、PR 里的 `docs/engineering/direction-checks/2026-11-05-*.md`）之前。只读了任务书允许的材料：用户原话、R-app-reopen-export-crash、R-app-reopen-launch-hang、R-app-wont-open（排查报告，原始数据）、代码、Electron 文档、外部开源代码。**有一处污染照实写**：私有待办里这条问题的那一行里，除了用户原话，还夹着一段 11-05 原方案的摘要（「复用既有边界、约 10 个文件、导出中或读不清保守不退、不改 Windows 关窗即退」），找用户原话时看到了。第 8 节对照时会写清哪些结论可能受它影响。

## 0. 一句话根因

主窗口从「建」到「销毁」有好几个状态（建中 / 开着〔可见、藏、最小化〕/ 关窗确认中 / 正在关 / 已销毁），整个 App 又有「退出中」，但没有任何一处代码拥有这些状态。叫回窗口的入口有 8 处，每处都是「自己找一个窗口对象，再对它调 show / focus」；关窗又允许出现「渲染层销毁了、进程还活着」这种中间态。所以每修一轮，只是把某一个入口的选窗规则改对、或补上一个状态判断，下一轮就撞上下一个没人管的状态。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| #62 `3901a3019`（08-11）「关窗后 app 再也打不开」 | 进程活着、零窗口、攥着单实例锁；second-instance 只 focus 已有窗口，零窗口时什么也不做 | A：叫回入口自己选窗，没覆盖「零窗」这个状态 |
| R-app-wont-open（10-29，0.23.2 起就有）「更新后点开没反应」最具体的已复现缺口 | macOS `activate` 守卫见到「有任意窗口」就直接返回、不 show 藏起来的主窗（`mainWindowPresence.ts:17`）；second-instance 拿 `getAllWindows()[0]`，可能挑到藏着的辅助窗（ComfyUI 转换窗） | A：选窗规则不对，没覆盖「主窗藏着」「只剩辅助窗」 |
| 用户在 Mac 上：应用里关窗退不出 | `window-all-closed` 在 darwin 不退（`main.ts:654-657`），Electron 的 macOS 惯例 | 产品取舍（不是 bug）。用户 10-29 拍板改成「空闲关窗即退」 |
| #1424 第 2 轮验收：导出中关窗再叫回，主进程 SIGSEGV（修后 3 次，修前 0 次） | PR 让 macOS 关窗确认后「判不忙 → `requestQuit()` + `forceClose`」（PR `windowCloseConfirmation.ts:82-86`）；退出途中 `activate` 进守卫，登记表要到 `closed` 才清（`main.ts:300`），拿到的是正在关的旧主窗，`isDestroyed()` 还是 false，调 show 就崩（日志最后一行 `showWindow.before-show`） | A：没覆盖「正在关 / 退出中」 |
| 同上：导出在 planning 阶段关窗被当成空闲，直接退出 | `activeExportCount()` 只数编码阶段的 AbortController（`exportJobs.ts:417-419`，写入在 `finishExportTempInput` `:470`）；渲染层上报也没算这一段 | B（姊妹类）：「有活在跑」有 3 份不全的定义，没有一个覆盖导出全程的真相 |
| #1424 第 1 轮验收的启动超时（R-app-reopen-launch-hang：修前 4/8、修后 5/8 同一机制） | 走查启动器显式传 `executablePath`，Playwright 没注入 loader，导航事件等不到 | 靶子（量具）问题，不是产品类，见 §4 |

## 2. 为什么这一类会一直出现

**数门（`node scripts/door-map.mjs`，在 `git archive` 出来的 main / PR 树上跑，原始输出在 `tmp/D-app-reopen-direction-r2/door-map-main.txt`、`door-map-pr.txt`）**

main 上「找到一个窗口 → show / focus」的入口，一共 8 处叫回加 2 处附带，选窗规则有 4 种，状态判断最多只有 `isDestroyed()`：

| # | 入口（用户动作） | 位置（main） | 怎么选窗 | 查了什么状态 |
|---|---|---|---|---|
| 1 | Dock / Finder 再打开（macOS `activate`） | `main.ts:648` → `mainWindowPresence.ts:16-17` | 有任意窗口就返回，**不 show** | 无 |
| 2 | 再次双击 / 任务栏（`second-instance`） | `productionRunDesktopLifecycle.ts:94-111` | `getAllWindows()[0]` | 无 |
| 3 | `nomi://` 深链（`open-url` `:76`；second-instance 命令行 `:96`） | 同文件 `:26-42` | `getMainWindow()` | `isDestroyed` |
| 4 | 系统通知点击（画布任务） | `notificationIpc.ts:17-24` | 第一个没销毁的窗口（可能是辅助窗） | `isDestroyed` |
| 5 | 制作流程通知点击 | `productionNotificationsDesktop.ts:12-18` | 同上 | `isDestroyed` |
| 6 | 截图快捷键 | `screenshotHotkey.ts:192` 先拿窗口，`:199 / :216 / :257` 才 show，中间隔着 `captureScreenshotProject`、`desktopCapturer.getSources`、`writeGeneratedAsset` 三个 await | `getMainWindow()` | 只在开头查一次 `isDestroyed`（先查后用，中间窗口可能已经在关） |
| 7 | 外部 Agent 让 Nomi 打开凭据页（MCP RPC） | `capabilityCore/appIntegration.ts:654-664` | `getMainWindow()` + `app.focus({steal:true})` | `isDestroyed` |
| 8 | 渲染层重建（维护） | `main.ts:337-364` | 销毁旧窗口 → 新建 → focus | 只有重建标记 |
| 附 | 关窗确认期间 focus 自己 | `windowCloseConfirmation.ts:36/93/107` | 正在关的那扇窗 | 无 |
| 附 | 后台冷启动（MCP）的隐藏主窗 | `backgroundLaunch.ts:25-33`、`appIntegrationLandFirst.ts:23` | 不 show，只发消息 | `isDestroyed` |

机器数出来的门：`getMainWindow` 6 扇读门 / 8 处；`ensureMainWindow` 3 扇 / 5 处（PR 后 4 扇 / 9 处）；`getAllWindows` 13 扇 / 15 处，其中 4 处拿来选「要叫回的窗」；`createWindow` 3 扇 / 4 处；PR 新增的 `showWindow` 3 扇 / 5 处；`requestQuit` main 上 2 扇，PR 后 3 扇（多出 `windowCloseConfirmation.ts:84`）。另外更新安装走 `installGate.ts` → `quitAndInstall`；Electron 文档写明这条路是**先关完所有窗口，再发 before-quit**，和普通退出的顺序相反。

**追到结构这一层**

1. **叫回拿到的是窗口对象，不是一个意图。** 每个入口手里都有一个 `BrowserWindow`，能直接调 show。只要「拿到引用」和「调用」之间窗口的状态变了，不管是 await 了一下、事件交错，还是正在关，就会出事。PR 把 6 个入口的选窗改成同一张登记表，方向是对的；但 `showWindow(win)` 还是导出给了截图和 MCP 两个入口，让它们对自己先拿到的引用调用；`ensureMainWindow` 也把窗口对象返回给调用方。所以这个「能做出来」的口子还在。
2. **登记表只有两态。** 登记表在 `closed` 时才清（`main.ts:300`、`appWindowRegistry.ts:101-106`）；Electron 文档说的是「收到 `closed` 之后才不该再用」，从 `close` 放行到 `closed` 之间，对象还在、`isDestroyed()` 还是 false。表和 `isDestroyed()` 都分不出「正在关」，PR 的单元测试假窗口也只有 `isDestroyed` 一个状态（PR `mainWindowPresence.test.ts:11-14`），「正在关」在量具里根本写不出来。
3. **关窗的决定和叫回的决定不在一处。** 「关了要不要退」放在 `windowCloseConfirmation.ts`，「叫回时怎么做」放在 `mainWindowPresence.ts`，两边只靠 Electron 的事件先后连起来。PR 还在同一个同步块里连做了三件事：放行、`requestQuit()`、`forceClose()`。而 `requestQuit` 本身会让 Electron 去关所有窗口，等于一扇窗被关了两次。
4. **「渲染层没了、进程还活着」这个中间态本来不该有。** macOS 惯例下关窗会销毁窗口、进程留着，于是有了零窗口态（#62）；PR 在忙的时候也这么做。可是 Nomi 的活有一部分在渲染层里：画布里排队、还没交给主进程的生成；导出从开始到主进程接手编码之前，也要靠渲染层推下一步（`exportJobs.ts:101-104`：webm 那条路要渲染层录完，filtergraph 那条路也要渲染层调 `finishExportTempInput` `:463-470` 才开始编码）。窗口一销毁，这些活就跟着停了。崩溃现场的作业一直停在 planning，就是这个原因。所以「忙就销毁窗口、只留进程」既救不回活，又凭空多出一段叫回必须猜的中间态。
5. **「有活在跑」有 3 份不全的定义**：`hasInFlightProductionWork`（任务缓存 + 编码中的导出 + 制作 Run）、渲染层上报、退出开始那一刻的快照。导出在编码之前那一段，哪一份都没算进去。

**三条体验铁律**：落在 ⑫「点了 = 以为的」。用户点 Dock、双击、点通知，预期都是「Nomi 的窗口回来」；实际看到的是没反应（main 上藏着的主窗、辅助窗）或者崩溃（PR 上退出途中）。点关闭，预期「没活就退、有活就留着」；实际是 Mac 上不退（main），或者导出准备阶段被直接退掉（PR）。逃逸账本 `tests/ux/full-walk/escapeLedger/USER-20261029-desktop-window-lifecycle.json` 由 PR 新增；结账要挂的类检查见 §6 的门岗和 4 态测试。⑩ ⑪ 不适用（和模型参数无关）。

## 3. 不改结构的话，接下来会冒出什么（可验证预测）

| 预测 | 怎么验证 |
|---|---|
| P1 截图快捷键这扇门会同样崩：按下快捷键，在 `getSources` / `writeGeneratedAsset` 的 await 期间空闲关窗（触发退出），之后 `showWindow(win)` 打在正在关的旧窗上 | 单测：4 态假窗口，在 await 中途切到 closing，断言不调 show（PR 代码上应该是红的）；走查：快捷键后立刻关窗并确认，扫 `~/Library/Logs/DiagnosticReports` 有没有对应 PID 的 `Electron-*.ips` |
| P2 通知点击这扇门同样会崩：生成完成弹通知 → 用户关窗（此时已空闲，进入退出）→ 3 秒内点通知 → 守卫从登记表拿到正在关的窗口 → show | 走查：完成一个免费任务，关窗确认后马上调通知的 onClick；扫 ips |
| P3 更新安装那条路反过来：`quitAndInstall` 先关完窗口才发 before-quit，如果中间来了一次二次启动，登记表已经清了，守卫会在退出途中**新建**一个窗口，出现一闪而过的空窗，或者拖住安装交接 | 单测：模拟「窗口已 closed、before-quit 还没到」时来叫回，断言不建窗；Windows 真安装器：未验证，缺量具 |
| P4 只修「退出中」不修忙的判据和窗口去留：导出在 webm 录制 / filtergraph 等渲染层发起编码那一段关窗，在「忙就销毁窗口留进程」的做法下，作业会永远停在 planning、不出 MP4，用户以为它在后台导出 | 走查：开始导出，在 `finishExportTempInput` 之前关窗，等 2 分钟，看作业状态和项目里有没有 MP4（崩溃报告 §4 已经看到作业停在 planning） |

## 4. 靶子独立性检查

- 单元测试的量具和实现出自同一条线（PR `mainWindowPresence.test.ts`），假窗口只有「没销毁 / 已销毁」两态，所以「正在关」这个状态写不进测试。**先修靶子**：新测试的假窗口至少要有 creating / open(visible, hidden, minimized) / closing / destroyed，外加 App 的 quitting。
- 独立验收线（V）是另一条线，第 2 轮正是它发现了崩溃，这条靶子是有效的。
- 走查这把尺本身有噪声：R-app-reopen-launch-hang 测出修前 4/8、修后 5/8 启动超时，是同一个启动器竞态（显式 `executablePath` → 没注入 loader）。不先修它，「连续 5 次不崩」这种验收会被启动超时搅乱，一轮可能白白烧掉。启动器竞态单独修，修在共享启动器上（那份报告里推荐的就是这个）；修好之前，启动超时既不算过也不算不过，单独计数。
- 崩溃走查用 `_quietWalk.cjs` 把 `show()` 换成了 `showInactive()`，`activate` 也是 Playwright 合成的；真实 Dock 点击和真 `show()` 都没验证过。验收里必须单列，不能拿合成事件顶替。
- 没有「修对了反而掉分」的先例。

## 5. P0：这些是我们独有的吗？现成方案有哪些（先查别人）

窗口生命周期是通用能力，不是 Nomi 独有的。Electron 自带全套事件和 API：单实例锁 + `second-instance`、`activate(hasVisibleWindows)`、`window-all-closed`、`before-quit`、`app.relaunch`、`BrowserWindow.hide/show`、`Tray`。Nomi 独有的只有一件：**什么算「有活在跑」**（生成、导出、制作 Run）。所以要写的只是一层很薄的胶水，一个主人加一张状态表，没有可以直接引进的库。我没找到有哪个成熟库包下了「关窗按忙闲决定藏还是退」，开源应用都是各自写这几十行。

| 出处 | 它怎么做 | 对我们哪个决定有影响 |
|---|---|---|
| Electron 官方教程「Managing your app's window lifecycle」（electronjs.org/docs/latest/tutorial/tutorial-first-app）+ app 文档 `activate` / `window-all-closed` | `activate` 里「没有打开的窗口就新建」；Windows/Linux 窗口全关就退，macOS 不退；`app.quit()` 先发 `before-quit`，「Emitted before the application starts closing its windows」，但 `autoUpdater.quitAndInstall()` 是先关窗、后发 before-quit | 叫回只对「活着、没在关」的窗口做事，否则新建。macOS 关窗即退是用户有意偏离惯例，偏离了就得自己守住退出途中的叫回。「进入退出」要在 before-quit 和安装入口两处都标上 |
| Electron BrowserWindow 文档 `close` / `closed` / `destroy()` | `close` 可以 preventDefault；`closed`：「After you have received this event you should remove the reference to the window and avoid using it any more」；`destroy()` 保证会发 `closed` | 登记表等到 `closed` 才清，正是能拿到「正在关」窗口的直接原因。主人必须在**决定关**的那一刻就把它划出可叫回的范围；更好的办法是不留「关了但进程还活着」这个态 |
| Electron app 文档 `requestSingleInstanceLock` 示例 / `app.relaunch` | 示例在 second-instance 里对唯一的 `myWindow` 变量做 restore + focus，不判断是否在退出中。`relaunch`：「Relaunches the app when the current instance exits」，要配合 quit；「called multiple times, multiple instances will be started」 | 二次启动也走同一个主人。退出途中被叫回，不碰旧窗，只登记一次 relaunch（只能调一次） |
| VS Code `src/vs/code/electron-main/app.ts`、`platform/lifecycle/electron-main/lifecycleMainService.ts`（GitHub main） | `activate` 用 Electron 给的 `hasVisibleWindows`，没有可见窗口就 `openEmptyWindow`，开一个新窗口，不去 show 记住的旧窗；macOS 最后一个窗关掉不退，「we only quit when quit was requested」；`_quitRequested` 只在窗口 veto 时复位；二次启动不用 Electron 单实例锁，走自己的 node IPC `launch` 通道。窗口表在 `onDidClose` 时才删 | 支持「叫回不碰旧窗」。VS Code 不做「空闲关窗即退」，所以没有我们这个竞态；它的窗口表也是 closed 才删，「正在关」时去 show 它会不会出事，**不知道** |
| Signal Desktop `app/main.main.ts`（GitHub main） | 主窗 `close`：除非已经 `shouldQuit`，否则在 macOS 或开了托盘时 `preventDefault` + `hide()`，不销毁；`before-quit` 里 `markShouldQuit()`，之后 close 才真关；`activate` / `second-instance`：有 mainWindow 就 show，没有就新建 | 「进程活着时主窗不销毁，关窗只有藏或退两种结果」是成熟先例，正好解决渲染层里的活随窗口一起死的问题。Signal 也没对「退出途中被叫回」做判断，有没有因此崩过，**不知道** |
| 仓库内先例 `electron/update/installGate.ts:1-8` | 注释原话：「三轮评审问题是同一类——『判忙』和『真正调用安装』不在同一时刻（TOCTOU）」，修法是唯一入口、入口里不 await、同步判忙后立刻执行，再用结构测试钉住唯一调用点 | 叫回照这个办：只留唯一入口，入口里不在 await 之后用旧引用，结构门岗钉住 |

另外，网上没搜到 Electron 官方承认「对正在关的窗口调 show 会崩」的 issue，只搜到几条关窗途中弹对话框或弹窗会崩的修复。**不知道上游会不会修，不能赌上游。**

## 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 改哪些文件（量级） | 能不能从结构上让「对正在销毁的窗口调 show」做不出来 | 对 10-29 三条拍板（A 空闲关窗真退 / B 有生成留后台且看得见 / C 再双击一定叫回） | 推荐 |
|---|---|---|---|---|---|
| **沿原方向修** | 在 PR #1424 上补：守卫调 show 之前查 `isQuitRequested()` 或「正在关」标记；导出全程算忙 | 在 PR 已改的约 16 个产品文件之上，再改 `mainWindowPresence.ts`、`quitTeardown.ts`、`windowCloseConfirmation.ts`、`appWindowRegistry.ts`、`exportJobs.ts` 和测试，约 5–6 个 | **不能**。`showWindow(win)` 还在导出，截图、MCP 入口仍然对先拿到的引用调用（P1）；新入口照样能直接 `.show()`；这是往守卫里加第 3 个状态判断，正好是「第三个特例分支」那条触发 | A：仅 macOS。B：忙时还是销毁窗口留进程，渲染层里的排队生成和导出前半段会停（P4），「留后台」只留住一半；Windows 没做。C：退出途中被叫回不崩了，但这次点击会丢 | 否 |
| **换做法：主窗口只有一个主人；关窗只有「藏」和「退」两种结果；叫回只发意图** | ① `mainWindowPresence.ts` 改成唯一主人：只有它拿着完整的主窗对象，状态是 absent / creating / open（可见、藏、最小化）/ quitting。② 唯一叫回入口 `revealMainWindow(entry)`，**不返回窗口对象**：open → restore/show/focus；absent → 新建再显示；creating → 等建好再显示；quitting → 不碰任何窗口，若不是更新安装导致的退出，就 `app.relaunch()` 一次，否则只记日志。③ 用户确认关窗后由主人决定：空闲 → `requestQuit()`（窗口只在退出流程里由 Electron 关，不再另外 forceClose）；忙（macOS）→ `hide()`，藏着且忙的时候关掉后台节流，活干完自动退（复用 `backgroundIdleExit` 的机制，换一个时限）。④ 进入 quitting 有两处：`before-quit` 和 `installGate` 调安装之前。⑤ 「有活在跑」只认一个真相：本进程里建的导出从建任务到终态都算忙，以前会话留下的作业不算，加上渲染层上报。⑥ 8 个入口全部改调 `revealMainWindow`；删掉 `showWindow` 导出，删掉拿 `getAllWindows()` 选窗的写法；要给渲染层发消息，走主人提供的 `sendToMainWindow`。⑦ 新门岗：`electron/` 非测试文件里，对 BrowserWindow 调 `.show( .focus( .restore( .showInactive(` 和 `app.focus(`，只允许出现在主人文件和白名单里自管子窗的文件（浮层、chrome 菜单、截图选区），附红绿反例 | 约 12 个产品文件：`mainWindowPresence.ts`（重写）、`main.ts`、`windowCloseConfirmation.ts`、`productionRunDesktopLifecycle.ts`、`notificationIpc.ts`、`productionNotificationsDesktop.ts`、`screenshotHotkey.ts`、`appIntegration.ts`、`backgroundLaunch.ts`、`exportJobs.ts`、`update/installGate.ts` 或 `autoUpdater.ts`、`appWindowRegistry.ts`；加 1 个门岗脚本和 4 态测试。和 PR 的改动面差不多。建议从最新 main 新开分支，PR 里能用的拿过来（入口收口、辅助窗测试），PR 关掉，不留并行版 | **能**，两层都有：入口手里没有窗口引用，从结构上就调不了 show；没收口的新入口由门岗拦。进程活着时，主窗在用户关窗时不再被销毁，「正在关但进程活着」这个态被删掉；剩下唯一会销毁主窗的路是退出，退出一开始主人就进 quitting，从此不碰窗口。维护重建在主人内部完成，状态是 creating | A：macOS 和 Windows 都做到（Windows 本来就退）。B：macOS 第一刀就做到，窗口和渲染层都活着，活真的继续，Dock 上能看到；Windows 要托盘（新界面），第一刀保持现状（关窗即退），第二刀做托盘 + 「留后台 / 退出」问一句（用户 10-29 晚改拍的就是这个），走设计流程。C：藏着的主窗、辅助窗、退出途中三种情况都能叫回，退出途中是旧进程退完后自动重开，不用再点第二次；主进程卡死不在这一刀里（见「已知限制」） | **推荐** |
| **删掉** | 最小可删单位：删掉 PR 新加的「macOS 空闲关窗 → requestQuit」，回到 macOS 惯例（关窗销毁窗口、进程留在 Dock、⌘Q 退），叫回改成「没有活着的主窗就新建」（Electron 文档和 VS Code 的写法） | 在 PR 上约 2–3 个文件，或直接从 main 只修 activate / second-instance 的选窗 | **部分能**：不再由关窗触发退出，崩溃那条竞态没了；但 8 个入口手里仍然有窗口对象，截图的「先查后用」照旧，⌘Q 后 3 秒内点 Dock 理论上还是同一个竞态（概率低） | A：**违背**，用户本人那条「关掉退不出」没解决。B：Mac 上进程本来就留着，但窗口销毁后渲染层里的活照样停。C：能做到 | 否（和用户拍板的 A 冲突，要用户自己改拍才行） |

**推荐：换做法。** 下面是可以直接派实现的说明。

> 对照后修正（写于第 8 节之后，原文不动）：④「进入 quitting 的时机」改了；③ 补了一条「看不见的窗口不发问」；验收清单补了第 11–13 条。以 §8.3 为准。

**用户在那一刻看到什么**
- Dock / 再次双击 / 点通知，Nomi 还开着、窗口藏着（忙时关的窗，或 MCP 后台启动的窗）：**还是原来那个窗口**立刻回到最前面，项目和画面都在，不重新加载。
- 窗口最小化了或者被挡在后面：还原并拿到前台。
- 刚空闲关窗、Nomi 正在退（最多 3 秒左右）：不会弹崩溃框；旧进程退完后 Nomi 自己重新启动，用户看到的是一次正常的冷启动，不用再点一次。
- 通知点击：同上，并跳到对应的任务或 Run。
- Nomi 没在运行：正常冷启动。

**导出或生成中关窗会怎样**
- macOS：关窗确认后，窗口藏起来（不是销毁）。导出和生成照常跑，包括画布里还没交给主进程的排队生成，以及导出在编码之前那一段。Dock 上的 Nomi 图标还在、带运行点。活干完 Nomi 自己退出。中途点 Dock 或通知，原窗口回来，进度都在。
- Windows（第一刀）：和今天一样，关窗确认后退出，导出会被中止。这是今天的现状，不是新的退步。第二刀加托盘图标，并在关窗时问一句「留在后台 / 退出（可记住）」，这是新界面，先出 Claude Design 样张、用户拍板后再做。
- 空闲时关窗：两个平台都真退出。

**老用户升级后的变化**
- macOS：空闲关窗从「留在 Dock」变成「真退出」，下次点开是冷启动，会慢几秒，这就是用户要的那一条。忙时关窗，原来是销毁窗口、进程留着、排队的活会断，现在窗口藏起来、活继续，点回来不用重新加载。⌘Q 不变。
- 接着外部 Agent（MCP）的 Mac 用户：空闲关窗后 RPC 服务跟着进程一起停；下次 Agent 请求时，由现有的 MCP 启动器按需后台冷启动（`mcpNodeLauncher.ts` 有 respawn）。**这一点要验证，没验证过。**
- Windows：第一刀只有两处变化：叫回认准主窗（不再挑到辅助窗），退出途中被叫回会自动重开。
- 不碰任何存盘数据，不需要迁移。

**已知限制（照实标）**：老主进程主线程卡死时，进程内的任何代码都救不了，要靠进程外的监督；这条另列，不在这一刀里（R-app-wont-open §6 第 4 条）。Windows 托盘、关窗时问一句，放第二刀。

**验收清单与反例（实现线照这个自验，验收线只核这个）**

先决条件：先单独修好走查启动器的竞态（R-app-reopen-launch-hang 推荐的修法），或者把启动超时单独计数、不算进分母，只数真正走到关窗那一步的样本。

| # | 验收项 | 量具 |
|---|---|---|
| 1 | 导出中关窗再叫回不崩，**连续 5 次**：macOS 导出中（分别覆盖 planning / webm 录制中 / 编码中）关窗确认 → 窗口藏着、进程活着 → 叫回 → 还是同一个 `webContents.id`、窗口可见 → 导出完成，MP4 能解码 | 生命周期走查导出那一档，锁内跑 5 次；每次按 PID 和时间扫 `~/Library/Logs/DiagnosticReports/Electron-*.ips`（沿用崩溃报告的 crash-matches 做法）；`ffprobe` 退出 0。真实 Dock 点击：**未验证，缺量具**。真 `show()`（不经安静仪表换成 `showInactive`）：走查若能关掉这一处替换就跑一次，不能就记**未验证，缺量具** |
| 1b | 反例：空闲关窗后**立刻**叫回，连续 5 次，同步 emit 和 setImmediate 各一组：不崩；旧进程退出码 0；新进程起来，窗口可见 | 同一个走查加 relaunch 检测（看到新 PID）；Playwright 跟不了 relaunch 出来的新进程的话，记**未验证，缺量具**，只验「不崩 + 退出码 0 + relaunch 被调用一次」（单测） |
| 2 | 生成中关窗留后台、看得见：macOS 有一个免费的在途任务（假供应商加网络闸）→ 关窗 → 进程活着、主窗没销毁、`isVisible()=false`、`app.dock.isVisible()=true` → 叫回还是同一个窗口 → 任务完成 → 窗口藏着时，活干完进程自己退出（退出码 0） | 走查 + 退出收据 `quit-exit`。Dock 图标肉眼可见：安静走查截不到 Dock，**未验证，缺量具**（可以由协调人手看一次）。Windows 托盘：**第二刀，这一刀不做** |
| 3 | 空闲关窗真退出：两平台空闲 → 关窗 → 确认 → 5 秒内退出，退出码 0，日志里 `quit-exit reason=completed`，没有 ips | macOS 走查；Windows 有 CI 走查就用，没有就记**未验证，缺量具** |
| 4 | 更新后点开有反应：(a) 老实例主窗藏着（`NOMI_LAUNCH_BACKGROUND=1`）时，用同一份 user-data 真起第二个进程 → 老实例的主窗显示出来；(b) 有藏着的辅助窗、主窗关着 → 叫回显示的是主窗不是辅助窗；(c) 真安装器交接（Windows NSIS 覆盖安装、macOS DMG 替换）；(d) 老进程主线程卡死 | (a) 真实第二实例走查（崩溃报告里 control-destroy-second 的做法）；(b) 4 态单测；(c) **未验证，缺量具**；(d) 不在这一刀，已知限制 |
| 5 | 反例：任何入口改回直接对窗口 `.show()` → 门岗红；改回来 → 绿 | 新门岗脚本加红绿日志 |
| 6 | 反例：4 态假窗口处在 closing / quitting，8 个入口逐个叫回 → 不调 show、不建窗（quitting 只 relaunch 一次）。这条测试放在 PR #1424 的代码上应该是红的 | vitest |
| 7 | 反例：项目里有一个以前会话留下、停在 planning 的 `job.json` → 空闲关窗照样真退出 | 走查或单测 |
| 8 | 反例：更新安装（`quitAndInstall`）途中来二次启动 → 不建窗、不 relaunch | 单测（模拟安装先关窗、后发 before-quit 的顺序） |
| 9 | 反例：MCP 后台冷启动时，维护重建仍不显示窗口；10 分钟空闲退出照旧 | 现有 `backgroundIdleExit` / `backgroundLaunch` 测试 + 新增一条 |
| 10 | 反例：主窗藏着且忙时点通知 → 深链只投递一次 | vitest |

## 7. 用户要权衡的核心

要不要让「关窗」在 Nomi 里只有两种结果：没活就真退，有活就把窗口原样藏起来、让活继续？换来的是叫回永远落在一个活着的窗口上，不再崩、不再断活；代价是 Mac 空闲关窗从「留在 Dock」变成「真退出」（这就是你要的），Windows 的「留后台 + 托盘」要等第二刀的新界面。

## 特征测试清单（动结构前先锁住）

- 已有：PR 的 `electron/mainWindowPresence.test.ts`（辅助窗、零窗、并发建窗、维护建窗）。它锁的是「选对窗」，没锁「正在关」。
- 已有：`electron/backgroundIdleExit` 相关测试（busy=false 10 分钟退、busy=true 不退，R-app-wont-open 用生产函数复现过）。
- 动手前要先补、现在还没有：4 态假窗口的叫回矩阵（8 个入口 × absent / creating / open-hidden / closing / quitting），关窗决策矩阵（忙 / 闲 × 平台），导出阶段算忙矩阵（queued / preparing / planning / 录制 / encoding / 终态 / 以前会话的残留）。没补的原因：这一轮是只读复盘，改动文件数为 0。

## 8. 和原方案对照（读完原方案和两份验收报告之后写）

这一节写在第 0–7 节之后。读过的材料：`coord-handoff/reports/D-app-reopen-direction.md`、`tmp/D-app-reopen-direction/direction-check.md`（下称「原方案」，基线 47da82ad9）、`V-app-reopen-cut1.md`、`V-app-reopen-cut1-r2.md`。还有 V-r2 引用的用户真机记录 `tmp/R-nomi-stuck-quit/observed-2026-11-05.md`：它不在任务书列的原始材料里，到这一步才读，所以 §8.3 是对照阶段的新发现，不算独立稿。

### 8.1 一致的地方

- 叫回只认登记表里的主窗，不去挑辅助窗。原方案是 6 个核心文件加 4 个薄入口，本复盘是 8 个入口，范围相同。
- 两种通知、截图、MCP 凭据页这 4 个容易漏的入口都要收进来。
- 复用现有的退出主人（`quitTeardown.requestQuit`）和忙闲门（busyGate），不另建计数表。
- 都承认 `hasInFlightProductionWork` 不是精确的「有活」主人，也没算渲染层里的排队。
- Windows 第一刀不动；托盘和「关窗问一句」放第二刀，先出设计样张。
- 主进程卡死不在这一刀里，要靠进程外处理。
- 「删掉」路线都否决（原方案的删法是关窗一律 requestQuit，本复盘的删法是回到 macOS 惯例），理由都是和 10-29 拍板冲突，或者会断活。

### 8.2 不同的地方和依据

| # | 原方案 | 本复盘 | 依据 |
|---|---|---|---|
| 1 | 只统一「选哪扇窗」，没给「正在关 / 退出中」建模，也没提 await 期间攥着旧引用的问题 | 主人持有状态；叫回只发意图，拿不到窗口对象；门岗拦直接 `.show()` | V-r2 崩溃日志最后一行是 `showWindow.before-show`，打在退出中的旧主窗上；PR 的单测假窗口只有 `isDestroyed` 一个状态；截图入口在 `screenshotHotkey.ts:192` 拿到窗口，隔了 3 个 await 才在 `:199/:216/:257` 调 show |
| 2 | 截图、MCP 凭据页「保留原窗口／项目租约，仅共享显示操作」，也就是继续把窗口对象和 `showWindow` 交给它们 | 两处都改成只发意图。截图签发项目租约（`issueWindowProject(win)`）仍然需要窗口，改用主人提供的同步借用：借用回调里不许 await，靠类型和门岗拦；显示一律走 `revealMainWindow` | 同 #1；§3 的 P1 预测 |
| 3 | 第一刀「忙 / 未知不新增自动隐藏」，「藏起来」放第二刀，并且要求明确批准。PR 实际做的是忙时 `forceClose`，窗口销毁、进程留着 | 第一刀里，macOS 忙时关窗就 `hide()`，窗口不销毁 | 导出在编码之前要靠渲染层推进（`exportJobs.ts:101-104`、`:463-470`），V-r2 现场的作业停在 planning；渲染层里的排队生成同理；Signal 有先例。不藏的话，拍板 B「有生成留后台」只做到一半（P4）。**这一点和原方案冲突，交协调拍板，见 §8.5** |
| 4 | 「纯导出或读不清就保守不退」，靠 `activeExportCount` 判断 | 本进程里建的导出，从建任务到终态都算忙；以前会话留下的残留不算 | `activeExportCount` 只数编码那一段（`exportJobs.ts:417-419`，写入在 `:470`）；V-r2 里导出在 `finishTempInput` 之前关窗，被当成了空闲 |
| 5 | 退出途中被叫回，没有规则 | 不碰旧窗；只要不是更新安装、MCP、E2E 触发的退出，就 `app.relaunch()` 一次 | V-r2 崩溃现场；Electron 文档说 relaunch 调几次就起几个实例；`quitAndInstall` 是先关窗、后发 before-quit（P3） |
| 6 | 没提量具的问题 | 先修靶子：4 态假窗口；启动器竞态先修，修好前启动超时单独计数 | V-r1 整轮被启动超时烧掉（launch-hang 测出修前 4/8、修后 5/8）；PR 的测试里写不出 closing 这个状态 |
| 7 | 约 10 个产品文件 | 约 12 个，另外删掉 `showWindow` 导出、删掉拿 `getAllWindows` 选窗的写法，再加一个门岗 | 量级差不多，多出来的都是删旧加拦 |
| 8 | 原方案的「换做法」是复用边界、统一叫回，PR 就是它的实现，相当于本复盘的「沿原方向修」那一档 | 本复盘的「换做法」换的是窗口去留的模式（不销毁，只藏或退），外加叫回不给窗口对象 | 三轮验收卡在同一类问题上：持有引用 + 中间态（§1） |

### 8.3 对照时的新发现：用户 11-05 真机现场的两个症状，都能从代码推出来；原方案和 PR 都只盖住一半

现场：0.24.0 打包版，由外部 MCP 后台冷启动，跑了约 18 小时，窗口曾经被叫出来过。用户点 Dock 没反应；协调发正常退出（osascript quit），8 秒后进程还在；`sample` 显示主线程停在正常事件循环里，没有原生模态框。

- **症状一「点 Dock 没反应」**：Electron 的 `applicationShouldHandleReopen` 原样返回 `hasVisibleWindows`（electron 源码 `shell/browser/mac/electron_application_delegate.mm`），所以主窗最小化或藏着时，AppKit 不会自己把窗口还原，全靠应用的 `activate` 处理。main 上的守卫只要看到有窗口就返回（`mainWindowPresence.ts:16-17`），于是什么都不发生。PR 的 `showWindow` 会先 restore 再 show，**这一半 PR 盖住了**。
- **症状二「正常退出被吞」**：⌘Q 或 osascript quit 发出后，链条是这样的：
  1. 主窗的 `close` 被 `preventDefault`（`windowCloseConfirmation.ts:96`），按 Electron 的语义，这一步就把这次退出取消了。
  2. 接着调 `mainWindow.focus()`（`:107`）。Electron 的 `NativeWindowMac::Focus` 在窗口不可见时直接返回，而 `IsVisible()` 对最小化的窗口返回 false（electron `native_window_mac.mm`），所以这一步什么也没做。
  3. 渲染层收到 close-request，preload 立刻回 ack（`preload.ts:44-46`），于是 1.5 秒后的原生兜底框永远不会出现（`:99-104`）。
  4. 渲染层无条件弹出「关闭 Nomi？」（`useProjectWindowLifecycle.ts:37`），但这个框画在一个看不见的窗口里，没人能点，退出就一直挂着。

  这和 sample 的结果对得上：主线程空闲，没有原生模态框。PR 没改这段（diff 只在确认后加了 macOS 空闲 requestQuit），原方案也没提到。
- **这是静态推断，没有复现。** 免费的复现办法：启动 → 把主窗最小化（或者后台冷启后叫出来再藏起）→ `app.quit()` 或 osascript quit → 10 秒后进程还在，就算复现。实现线修之前先在 main 上跑一次。
- **对推荐方案的影响（重要）**：我推荐的「忙时藏窗」会让「主窗看不见」变得更常见，不补这一条，吞退出的问题会被放大。所以主人要再加一条规则：**看不见的窗口不发问。** 退出请求碰到藏着或最小化的主窗时，主人先把窗口亮出来，再让渲染层去问。那句文案本来就是在提醒「未完成的生成或导出可能会中断」，正该让人看见。只有一种情况不问、直接存盘放行：后台冷启动、用户从没见过、又空闲的实例。
- **修正 §6 第 ④ 条**：「进入 quitting」不能放在 before-quit。before-quit 之后还有关窗确认，用户可能点「取消」（`resetQuitRequest`），而确认框就在主窗里，这段时间来的叫回必须照常把主窗亮出来。改成：before-quit 只记「有人要退」；到主人放行主窗关闭的那一刻（用户确认了关窗或退出，或者 installGate 调安装之前）才进入 quitting，从那以后不碰窗口。这和 VS Code「只有窗口 veto 时才复位 quit 请求」的做法一致。
- **验收清单补 3 条**：

| # | 验收项 | 量具 |
|---|---|---|
| 11 | 主窗分别处在最小化、忙时藏起、后台冷启叫出过再藏起三种状态，发 osascript quit 或 ⌘Q：10 秒内要么进程退出（退出码 0），要么主窗亮出来并显示确认框。每种连续 3 次 | 走查 + osascript；修前要先在 main 上跑出「进程还在」才算复现。真实 Dock 右键菜单退出：**未验证，缺量具** |
| 12 | 退出确认框弹出后点「取消」→ Nomi 回到正常状态，之后从 Dock 或通知叫回，照常显示同一个窗口（说明没有提前进入 quitting） | vitest（主人状态机）+ 走查 |
| 13 | 用户那条真实流程：外部 MCP 后台冷启 → 叫出过窗口 → 最小化或关窗 → 点 Dock / ⌘Q（V-r2 要求补核） | 免费路径能跑的部分用 `NOMI_LAUNCH_BACKGROUND=1` 走查；ChatGPT → codex → 启动器这整条链路：**未验证，缺量具** |

### 8.4 第 0 节那处污染可能影响了什么

- 可能受影响的结论只有一条：「Windows 第一刀不动」。我的依据是独立的：托盘是新界面，必须走设计流程（CLAUDE.md P5）；而且 Windows 关窗即退，今天就已经满足拍板 A。
- 原方案的「保守不退」我没有沿用，改成了「藏起」；文件数我按自己的改动清单数出来约 12 个，不是照搬「约 10」。说明这两处没有被那段摘要带着走。

### 8.5 要协调拍板的

1. **忙时藏窗放不放第一刀**（原方案放第二刀，并要求明确批准）。
   - 推荐放第一刀。不藏，渲染层里的活救不回来（P4 必现），拍板 B 只做到一半。这里没有新控件，关窗那一瞬间看起来和今天一样，叫回反而更快（不用重新加载），所以我判断不需要样张。代价：macOS 上忙时关窗后，Dock 图标会多留一阵，活干完自己退出。
   - 另一个选项是按原方案，第一刀不藏，忙时保留 PR 现在的做法（窗口销毁、进程留着）。代价是导出编码之前那一段和画布里的排队生成会停下，用户以为在后台跑，其实没有。
2. **关窗确认文案**：「当前窗口将关闭，未完成的生成或导出任务可能会中断」。macOS 改成忙时藏窗以后，这句话就不准了。推荐第一刀不改：「可能」仍然覆盖 Windows 和 ⌘Q 两种情况。等第二刀出「关窗问一句」的样张时一起重写。

## 结论（拍板原话）

- 用户原话：
  - 微信用户：「更新后点开没反应，重启电脑才好」。
  - 用户本人：应用里关掉退不出，只有 Dock「退出」才行。
  - 10-29 拍板三条：A 空闲关窗真退；B 有生成在跑就留后台，但要看得见；C 再双击一定能叫回。
  - 11-07：「做，换做法」。
- 协调 11-09 拍板（对 §8.5 两问）：
  1. 忙时藏窗（macOS）放第一刀。
  2. 关窗确认框文案第一刀不改。
  - Windows 托盘和「关窗时问一句」放第二刀，这一刀不碰。
- 取的路：§6「换做法」——主窗口只有一个主人（`electron/mainWindowPresence.ts`），关窗只有「藏」和「退」，叫回只发意图；取代 PR #1424（只读参考，不 cherry-pick）。

## 设计卡（实现线 I-app-reopen-owner，9 格全填）

**★0 先查别人**（详表见 §5，这里只列改了或确认了决定的几条）
- Electron 官方教程 + `app` 文档（electronjs.org/docs/latest/api/app）· `activate` 里没有可见窗口就建；`autoUpdater.quitAndInstall()` 先关窗、后发 before-quit · **确认了**：叫回只对活着、没在关的主窗做事，否则新建；「进入退出」在主人放行关窗和 installGate 两处标。
- Electron 源码 `shell/browser/mac/electron_application_delegate.mm`（`applicationShouldHandleReopen` 原样返回 `hasVisibleWindows`）· 最小化或藏着时 AppKit 不自己还原 · **改了**：`activate` 不再「有窗就返回」，一律走 `revealMainWindow("activate")`。
- 仓库先例 `electron/update/installGate.ts:1-8` · 唯一入口、入口里不 await、同步判完立刻执行，结构测试钉住 · **确认了**：叫回唯一入口不交出窗口对象；截图签发项目租约走同步借用 `borrowMainWindow`，回调里不许 await。
- VS Code 主进程（`lifecycleMainService` 只在窗口 veto 时复位 quit 请求）· before-quit 只记「有人要退」 · **改了**：quitting 不在 before-quit 进，在主人放行主窗关闭那一刻进。
- 出口：不涉及：这一刀没有新增、扩大或挪动挡人的保护；反而删掉一处挡人的（看不见的窗口里弹确认框吞掉退出，§8.3），改成先亮窗再问。

**★1 用户怎么用**
- 当我在 Mac 上做完活关掉 Nomi 窗口，我想它真退出；当它还在导出或生成时我关窗，我想活继续、Dock 上还看得见；之后我再点 Dock、双击图标、点通知，我想原来那个窗口一定回来。
- 步骤：① 打开项目 → ② 发起导出或生成 → ③ 点红色关闭 → ④ 确认框点「关闭」→ ⑤ 窗口藏起、Dock 图标在 → ⑥ 点 Dock / 双击 / 点通知 → ⑦ 原窗口回来，进度都在 → ⑧ 活干完，窗口还藏着就自己退出。
- 不做什么：Windows 托盘、关窗时问一句（第二刀，新界面）；不改确认框文案；不加任何新界面；主进程主线程卡死（要进程外监督，已知限制）。
- 已知坑：藏着的窗口活干完后走「无人值守退出」（只跑关键排空项：存盘、导出收尾、Agent 通道，预算 500ms），非关键排空项（如目录对账）跳过；空闲关窗和 ⌘Q 走完整退出。「重启以更新」照旧弹关窗确认、存盘后再装（主人在安装前进 quitting，但关窗仍等用户确认，确认框是存盘点）。
- 真实任务：(1) 用户 11-05 现场：MCP 后台冷启 → 叫出过 → 最小化 → ⌘Q / osascript quit（§8.3）；(2) 微信用户：更新后点开没反应（second-instance 落到藏着的主窗）；(3) 导出中关窗再点 Dock（V-r2 崩溃现场）。
- 指标与量具：
  - 主指标：叫回成功率（叫回后主窗可见、同一个 `webContents.id`）= 5/5 —— 量具：`tmp/I-app-reopen-owner/` 免费生命周期走查（导出三段各跑），外加 `electron/mainWindowPresence.test.ts` 4 态矩阵。
  - 质量指标：空闲关窗到进程退出 ≤5s —— 量具：同一走查记 PID 退出时间。
  - 护栏指标：崩溃数 0（按 PID、时间扫 `~/Library/Logs/DiagnosticReports/Electron-*.ips`）；导出产物 `ffprobe` 退出 0。
  - 基线：main 上 §8.3 复现（10 秒后进程还在）；PR #1424 上导出中关窗叫回崩溃（V-r2）。
  - 启动器竞态修好前，启动超时单独计数，不进分母。
- ★1b 连带界面：关窗确认框（文案不改）；Dock 图标（藏窗时留着，系统自带，不新增）；通知点击（落到主窗）；更新弹窗「重启以更新」（照旧弹关窗确认、存盘后安装）。
- ★1c 老用户（照复盘报告 §七）：
  - macOS：空闲关窗从「留在 Dock」变成真退出（用户要的就是这个）；忙时关窗不再断活。⌘Q 不变。
  - 接外部 Agent（MCP）的 Mac 用户：空闲关窗后 RPC 服务跟着停，下次由启动器按需冷启动。**未验证。**
  - Windows：只改两处：叫回认准主窗；退出途中被叫回会自动重开。
  - 不碰任何存盘数据，不需要迁移；退回上一版照常打开。

**★2 谁说了算**
- 概念「桌面主窗口的生命周期」→ 唯一主人 `electron/mainWindowPresence.ts`：只有它持有主窗对象，状态 absent / creating / open（可见、藏、最小化）/ quitting；入口只发意图 `revealMainWindow(入口名)`、`sendToMainWindow`，拿不到窗口对象。`appWindowRegistry.getMainWindow()` 留作只读（受信发送方校验、对话框父窗），不能拿来显示。
- 「有活在跑」只认一份：`autoUpdater` 的 busyGate（主进程 `hasInFlightProductionWork` + 渲染层上报），主人的关窗决策、后台空闲退出、更新安装都读它；导出从建任务（本次运行）到终态都算忙。
- 退出仍归 `quitTeardown`（唯一调 `app.exit`/`app.relaunch` 的地方）。
- 门表：`node scripts/door-map.mjs getMainWindow` / `ensureMainWindow` / `getAllWindows`（复盘 §2，原始输出在 `tmp/D-app-reopen-direction-r2/door-map-*.txt`）。

**★3 一致与复用**
- 以前定过：10-29 拍板 A/B/C、11-07「做，换做法」、协调 11-09 两条（见上「结论」），都算数。PR #1424 的「选对窗」方向保留，`showWindow` 公共函数不要。
- 三条路选「换做法」（§6）；复用 `quitTeardown`（退出主人）、`createUpdateBusyGate`（忙闲门）、`backgroundIdleExit`（后台冷启空闲退出）、`exitWithoutConfirmation`（无人值守退出）、ESLint `no-restricted-syntax`（门岗），不新建计数表、不自写门岗脚本。
- 删掉的第二份定义：入口各自「从所有窗口里挑一个」的 4 处；`activate` 的零窗口守卫；`activeExportCount` 只数编码段的那份忙；后台空闲退出只看主进程的那份忙；关窗确认里的 `forceClose`（关一次窗再强制关一次）。

**★4 全状态**（这一刀不新增界面和文案，状态都是窗口本身）
- 空（没有主窗，进程活着）：叫回就新建一个并显示。
- 加载（主窗正在建）：叫回等它建好再显示，不建第二个。
- 成功：主窗可见并在最前。
- 失败（建窗失败）：记日志；从 absent 再建一次，不留零窗口。
- 部分成功：不适用（窗口要么回来要么新建）。
- 取消中（确认框里点「取消」）：主窗留在原处，之后叫回照常。
- 过期（正在退出）：不碰旧窗；不是更新安装、后台冷启、E2E 触发的退出，就在进程退完后自动重开一次。
- 能力不可用：不适用（不依赖模型和外部资源）。

**5 中途表**

| 状态 \ 打断 | 停（确认框点取消） | 关窗 | 断网 | 重启（⌘Q / 更新安装） | 连点（连续叫回） |
|---|---|---|---|---|---|
| 空闲、窗口可见 | 窗口留着 · 不花钱 · 无回执 | 确认后真退出 · 不花钱 · `quit-exit` 日志 | 无影响 | 确认后退出；更新安装后由安装器重开 | 同一窗口，不建第二个 |
| 忙、窗口可见 | 窗口留着，活继续 · 已发出的生成照常计费 · 任务卡 | macOS 藏窗、活继续；Windows 照旧退出（导出中止，和今天一样）· 已发出的照常计费 · 任务卡 / 通知 | 生成按原有重试和失败处理，与本刀无关 | ⌘Q 照旧弹确认，确认后退出、导出中止 | 同一窗口 |
| 忙、窗口藏着（macOS） | 不适用（没有确认框） | 不适用（窗口已藏） | 同上 | ⌘Q：先亮出窗口再问 | 原窗口回来，不重新加载 |
| 正在退出 | 不适用 | 不适用 | 不适用 | 不适用 | 不碰旧窗；退完自动重开一次（更新安装、E2E 除外） |

**6 外部数据与失败**
- Electron 窗口与应用生命周期（electronjs.org/docs/latest/api/browser-window、/api/app）· 偏差：macOS 关窗即退（用户有意偏离惯例）· 失败时：叫回落到退出途中 → 不崩，退完重开。
- electron-updater `quitAndInstall`（先关窗后 before-quit）· 偏差：无 · 失败时：安装途中来的叫回不建窗、不重开，由安装器重开。
- 渲染层上报的忙（`nomi:update:report-busy`）· 偏差：渲染层崩了就没有上报 → 只剩主进程那份 · 失败时：按主进程判忙，最坏是活还在跑时真退出（和今天一样）。

**★7 性能**：不适用：没有新增用户操作和渲染路径；藏窗期间关掉后台节流只在忙时、且活干完就退，额外的只是每 2 秒一次的同步忙闲查询。

**8 真实条件**：macOS 免费走查（本线自己的构建、隔离资料目录）；英文界面 zh/en 两轨走查；Windows `unverified`（这一刀 Windows 只改叫回选窗和退出途中重开，靠单测）；真付费不涉及；真安装器交接 `unverified`（缺量具）。

**拍板图清单**：不适用：不改界面、不改文案（协调 11-09 拍板第 2 条）。

**★9 验收与回滚**（照复盘报告 §八 1–14 条全抄）

先决条件：启动器竞态（R-app-reopen-launch-hang）修好前，启动超时单独计数，不算进分母，只数走到关窗那一步的样本。

| # | 验收项 | 量具 |
|---|---|---|
| 1 | 导出中关窗再叫回不崩，连续 5 次，planning、webm 录制、编码三段都要覆盖 | `tmp/I-app-reopen-owner/` 免费生命周期走查（本线构建，锁内跑）；按 PID、时间扫 `Electron-*.ips`；`ffprobe` 退出 0；同一个 `webContents.id` |
| 2 | 空闲关窗后立刻叫回，连续 5 次，不崩、只 relaunch 一次 | vitest（主人：quitting 下叫回 5 次只登记一次重开，`finish` 里 relaunch 只调一次）；真进程 relaunch 跟踪：**未验证，缺量具** |
| 3 | 生成中关窗：留在后台、看得见，叫回还是同一个窗口，活干完自己退 | vitest（关窗决策矩阵 + 藏窗后忙→闲触发退出）；免费在途生成走查：**未验证，缺量具**（没有免费的假供应商在途任务夹具）；Dock 图标肉眼：**未验证，缺量具** |
| 4 | 空闲关窗 5 秒内真退出 | 免费走查（关窗 → 确认 → 记 PID 退出时间、退出码、`quit-exit`） |
| 5 | 更新后点开有反应：(a) 真第二实例；(b) 有辅助窗时叫回的是主窗；(c) 真安装器交接**未验证，缺量具**；(d) 主线程卡死是已知限制 | (a) 免费走查：同一份 user-data 起第二个进程；(b) vitest 4 态矩阵（假辅助窗）；(c)(d) 如左 |
| 6 | 门岗红绿反例：任一入口改回直接 `.show()` → 红，改回来 → 绿 | `electron/mainWindowPresence.test.ts` 里的 ESLint `lintText` 红绿 + 手工改坏一次跑 eslint 的日志 |
| 7 | 4 态矩阵：closing / quitting 状态下 8 个入口叫回都不调 show（这条放在 PR #1424 的代码上应该是红的） | vitest |
| 8 | 有以前会话残留的 planning 作业时，照样能退出 | vitest（`exportJobs` 算忙矩阵：残留不算忙） |
| 9 | 更新安装途中来二次启动：不建窗、不 relaunch | vitest（模拟安装先关窗、后发 before-quit） |
| 10 | 后台冷启动时维护重建不显示窗口；10 分钟空闲退出照旧 | 现有 `backgroundIdleExit` / `backgroundLaunch` 测试 + 主人的重建测试 |
| 11 | 窗口藏着时点通知，深链只投递一次 | vitest |
| 12 | 主窗最小化、藏起、后台叫出过三种状态下发退出：10 秒内要么退出，要么亮出窗口并显示确认框 | 免费走查 + `app.quit()`；修前先在 main 上跑出「进程还在」 |
| 13 | 在确认框里点「取消」后，叫回照常显示同一个窗口 | vitest（主人状态机） |
| 14 | 用户 11-05 那条真实流程（MCP 后台冷启 → 叫出过 → 最小化或关窗 → Dock / ⌘Q） | `NOMI_LAUNCH_BACKGROUND=1` 免费走查能跑的部分；ChatGPT → codex → 启动器整条链路：**未验证，缺量具** |

以下**未验证，缺量具**：真实 Dock 点击、真 `show()`（走查里换成了 `showInactive`）、肉眼看到 Dock 图标、ChatGPT → codex → 启动器整条链路。

- 真实场景复现：用户 11-05 现场（`tmp/R-nomi-stuck-quit/observed-2026-11-05.md`）：后台冷启、叫出过、最小化后 osascript quit，8 秒后进程还在。我走：本线构建 + 隔离资料目录，启动 → 最小化 → `app.quit()`；差在：不是打包版、没有 18 小时运行、没有真 MCP 冷启。修前：10 秒后进程还在 = 复现；修后：10 秒内退出，或者窗口亮出并显示确认框。
- 反例从哪回来：新入口（门岗拦）、新子窗（白名单要登记）、更新安装顺序（单测）、以前会话残留（算忙矩阵）、平台（关窗决策矩阵分 darwin / win32）。
- 回滚：revert 本 PR 的合并提交；没有数据迁移，回退无损。
