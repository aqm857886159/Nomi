# 方向检查：桌面启动身份分流与后台 MCP 单实例聚焦（Issue #1629）

> 触发：`node scripts/fix-churn.mjs electron/main.ts` 命中（`electron/main.ts` 近 14 天已有 2 个独立主题的 fix：`302497119` 主窗口唯一主人、`e7acb6480` 模型可用状态收口，本次是第 3 个；其余修改文件均未命中热点）。

**这一处的全图在哪**：表外（桌面进程入口与 `second-instance` 单实例交接，详见主窗口生命周期复盘 `docs/engineering/direction-checks/2026-11-09-app-reopen-owner.md`）。

## 0. 一句话根因

桌面启动入口与单实例交接没有统一的「进程启动身份」边界：入口只靠易被外部宿主剥离的 `ELECTRON_RUN_AS_NODE` / `NOMI_MCP_STDIO` 环境变量判断是否进入无头 MCP 模式，且 `second-instance` 无条件叫回主窗，导致外部宿主（macOS ChatGPT Desktop / Codex）拉起 `Nomi Helper` 却未保留环境变量时，子进程误入 GUI 启动流程抢单实例锁并自杀（`single-instance-exit`），同时把已有 Nomi 的收起主窗拉到前台。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| GitHub Issue #1629（macOS 启动 ChatGPT Desktop 把收起的 Nomi 窗口切到前台） | ChatGPT Desktop 拉起 Codex 的 `Nomi Helper` + `mcpNodeLauncher.js` 时未进入 bare-Node 且无 `NOMI_MCP_STDIO=1`，落入 `electron/main.ts` 调 `app.requestSingleInstanceLock()` 失败退出，并触发已有实例 `productionRunDesktopLifecycle.ts` 无条件 `revealMainWindow("second-instance")` | 启动身份只认易丢失的环境变量 + `second-instance` 不区分前台用户打开与后台/MCP 调用 |
| 同类隐患：Claude Desktop 转发口（`mcpHttpForwarder.js`） | `electron/capabilityCore/mcpHostEntries.ts` 生成的转发口条目只设 `ELECTRON_RUN_AS_NODE=1`、未设 `NOMI_MCP_STDIO=1`，宿主剥离 `ELECTRON_RUN_AS_NODE` 即必然撞同一路径 | 同上 |
| 同类隐患：后台冷启单实例锁竞争（`NOMI_LAUNCH_BACKGROUND=1`） | 两个 `mcpNodeLauncher` 并发冷启或实例刚起尚未写完广告时，后台拉起的 `Nomi` 输掉单实例锁但未传 `additionalData`，老实例仍无条件亮窗 | 单实例锁未传递启动身份（`additionalData`） |

## 2. 为什么这一类会一直出现

「这次启动是不是后台 MCP stdio / 后台冷启」此前分散在 5 处各自读环境变量（`electron/main.ts`、`electron/backgroundLaunch.ts`、`electron/mainProcessLifecycle.ts`、`electron/diagnostics/stallMonitor.ts`、`electron/telemetry/sessionExit.ts`），而 `electron/productionRun/productionRunDesktopLifecycle.ts` 的 `second-instance` 回调完全不检查 `commandLine` 和 `additionalData`。只要任意外部宿主过滤了环境变量（或旧版配置只传脚本路径），所有 5 处一起误判。

### 三条体验铁律

落在 **⑫ 点了=以为的**：用户在启动 ChatGPT Desktop（未点 Nomi Dock、未点 `nomi://` 链接）时，预期已收起的 Nomi 窗口保持原状；主动点击 Dock 或再次打开 Nomi 应用时才应恢复并聚焦主窗。⑩ / ⑪ 不适用（与模型参数无关）。

## 3. 不改结构的话，接下来会冒出什么（可验证预测）

| 预测 | 怎么验证 |
|---|---|
| 1. Claude Desktop 转发口（`mcpHttpForwarder.js`）在宿主剥离 `ELECTRON_RUN_AS_NODE` 时必定触发 `single-instance-exit` 并抢焦点 | 传入 `argv=[Nomi Helper, .../mcpHttpForwarder.js]` 且 `env={}` 跑 `classifyProcessLaunch` / `second-instance` 单测 |
| 2. Windows/Linux 上宿主剥离 `ELECTRON_RUN_AS_NODE` 拉起 `Nomi.exe .../mcpNodeLauncher.js` 时同样抢焦点且 MCP 断开 | 传入 `argv=[Nomi.exe, .../mcpNodeLauncher.js]` 且 `env={}` 跑同组单测 |
| 3. 两个 MCP 助手并发后台冷启 Nomi 发生单实例锁竞争时，已隐藏的后台主窗被无意弹到前台 | 模拟 `requestSingleInstanceLock({ launchIntent: "background" })` 的 `second-instance` 回调验证主窗保持隐藏 |

## 4. 靶子独立性检查

- 原测试 `electron/productionRun/productionRunDesktopLifecycle.test.ts` 只覆盖「用户再次启动必须叫回主窗（#62）」，没有反例覆盖「后台 MCP / Helper / 后台冷启的 `second-instance` 不得叫回主窗」。
- 本次按先红后绿补充了 Issue #1629 与同类入口回归测试及正对照（用户显式打开与 `nomi://` 深链仍必叫回），确保「全部拦下」与「什么都不做」都通不过。

## 5. 这一整块归谁（P0）

这一整块：Electron 桌面进程启动模式分流与单实例锁身份交接（`requestSingleInstanceLock` + `second-instance` + `app.dock.hide`）。
归谁：Electron 43.4.1 官方 `app` 单实例与 macOS Dock API（https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata ）+ 仓库内统一启动身份分类边界 `electron/productionRun/desktopLaunchIntent.ts:1` 与主窗口唯一主人 `electron/mainWindowPresence.ts:129`。
我们哪里绕开了它：`electron/main.ts:111`、`electron/mainProcessLifecycle.ts:62`、`electron/diagnostics/stallMonitor.ts:214`、`electron/telemetry/sessionExit.ts:106` 与 `electron/backgroundLaunch.ts:10` 此前各自手写 `process.env.NOMI_MCP_STDIO === "1"` / `NOMI_LAUNCH_BACKGROUND === "1"`，没有把 Electron 原生 `process.argv` 与 `requestSingleInstanceLock(additionalData)` 统一收口，且 `electron/productionRun/productionRunDesktopLifecycle.ts:87` 在 `second-instance` 中忽略了 `commandLine` 与 `additionalData`。

## 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 只在 `productionRunDesktopLifecycle.ts` 的 `second-instance` 里硬编码忽略含 `mcpNodeLauncher.js` 的命令行 | 小 | 会：`Nomi Helper` 仍进 GUI 抢锁自杀，导致 MCP 本身连不上；且 `mcpHttpForwarder.js`、后台冷启锁竞争、Dock 弹跳、`stallMonitor`/`sessionExit` 仍误判 | MCP 在剥离 env 的宿主上继续失败 | 否 |
| 换一种做法 | 收成单一纯函数边界 `electron/productionRun/desktopLaunchIntent.ts`：① 入口（`main.ts`）在 `requestSingleInstanceLock` 和 `app.whenReady` 之前按 env + argv 分流，命中 MCP stdio 立刻 `app.dock?.hide?.()` 并直转 stdio / forwarder，老用户配置文件零改动（★1c）；② `mainProcessLifecycle` / `stallMonitor` / `sessionExit` / `backgroundLaunch` 全部改读同一边界；③ 后台冷启经 Electron 原生 `requestSingleInstanceLock({ launchIntent: "background" })` 传递身份，`second-instance` 经 `classifySecondInstance(commandLine, additionalData)` 守卫不抢焦点，仅用户显式打开、`nomi://` 深链与 Dock `activate` 正常恢复主窗 | 中（6 个现有文件 + 1 个纯分类模块 + 完整测试） | 同类环境变量剥离、转发口、后台锁竞争均由同一边界覆盖；未覆盖仅限第三方完全不带脚本参数也非 Helper 可执行文件的未知后台调用 | 低；不改变 `mcpConfig.ts` 现有配置契约，老用户无需重配 | **推荐** |
| 删掉 | 删掉 `second-instance` 里的 `revealMainWindow` | 极小 | 会直接破坏 #62「双击应用图标叫回主窗」的既有核心不变量 | 高（产品回归） | 否 |

## 7. 用户要权衡的核心

不改动老用户已写入 Codex / Claude / Cursor 的 MCP 配置文件（★1c），在 Electron 入口与 `second-instance` 双向用同一份启动身份边界隔离后台 MCP 与用户显式打开，既阻止收起窗口被抢焦点，也让被宿主剥离环境变量的 MCP 连接本身安静工作。

## 特征测试清单（动结构前先锁住）

- 已有：`electron/productionRun/productionRunDesktopLifecycle.test.ts`（#62 零窗/最小化/辅助窗/深链叫回）、`electron/mainWindowPresence.test.ts`（93 条主窗主人状态机与门岗测试）、`electron/mainProcessLifecycle.test.ts`、`electron/diagnostics/stallMonitor.test.ts`、`electron/telemetry/sessionExit.test.ts`。
- 新增：`electron/productionRun/desktopLaunchIntent.test.ts` 及 `productionRunDesktopLifecycle.test.ts` / `mainProcessLifecycle.test.ts` / `stallMonitor.test.ts` 中的 #1629 与同类入口回归测试。
