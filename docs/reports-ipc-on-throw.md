# IPC fire-and-forget 异常修复报告

日期：2026-10-04
分支：`fix/ipc-on-untrusted-sender-dialog`

## 发送方与复现证据

历史 crash 收据在 `/Users/aoqimin/Library/Logs/nomi/nomi-crash.log:23829-23830`（另一次同形收据在 23831）显示 Electron 43.4.1 主进程由 `electron/logging/rendererLog.js` 的 `ipcMain.on` 收到了 `UntrustedIpcSenderError`。同一份日志前面紧邻的是 dev renderer `http://127.0.0.1:5273` 的模块加载 `SyntaxError`（23805-23828）。主窗口在 `electron/main.ts:300` 先登记到 `appWindowRegistry`，再在 `:332` 加载 renderer；因此最符合现有证据的发送方是重载/导航期间的主窗口 renderer 旧 frame（登记表只承认当前顶层 webContents、routingId 与 origin），不是离屏捕获窗、画中画或 iframe。旧 crash 格式没有 senderId/frameRoutingId/origin，不能仅凭历史行反推出具体窗口 id，这一点保持未证实。

用修复后的真实 Electron 构建做了受控复现：`/tmp/repro-real-unregistered-sender-evidence.json` 记录 pid `97437`、主窗口 URL `file:///Users/aoqimin/Desktop/Nomi-ipc-guard/dist/index.html#/studio`，通过 Electron `app.evaluate` 创建未登记 `BrowserWindow` id `2`，其 preload 从 frame routingId `1` 发 `nomi:log:renderer`；主进程日志记录 `ipc-untrusted-sender-dropped ... senderId=2 frameRoutingId=1 senderOrigin=-`，发送后 `processStillAlive=true` 且无 `uncaughtException`。这证明实际 Electron 事件路径会命中丢弃边界，并给出窗口、frame 与 origin 证据；它验证的是不可信窗口的边界行为，不冒充历史 3D-BOX 构建的逐字节重放。

## 类根因与处理

`ipcMain.on` 是 fire-and-forget，没有 invoke 的 reject 面。同步调用 `assertTrustedSender/assertTrustedUiSender` 抛出的 `UntrustedIpcSenderError` 会沿 Electron 主进程事件循环冒泡成默认 `Uncaught Exception` 对话框。`handle` 通道继续直接守卫，异常由 invoke reject；守卫判据（登记表、窗口 webContents、顶层 routingId、origin、角色）没有放宽。

在最早共享边界 `electron/ipcSenderGuard.ts` 增加 `assertTrustedFireAndForget`：只捕获 `UntrustedIpcSenderError`，丢弃消息并按通道每 60 秒最多记录一条带 senderId/frameRoutingId/origin 的 warning；其它异常继续抛出。同步 `ipcMain.on` 返回值入口改用 `assertTrustedSync`，维持错误 envelope。`rendererLog`、事件/交接队列、主窗口动作、canvas reply 和浏览器视图 on 入口均迁移到共享 fire-and-forget 版本。

浏览器视图的记录消失属于正常生命周期竞态：销毁窗口/视图会先移除登记，渲染层已经排队的 resize/navigate/chrome 消息仍可能晚到；这类消息没有可安全执行的效果，按 `BrowserViewUnavailableError` 丢弃并按通道限流警告。其它同步异常仍由 `runBrowserViewFireAndForget` 调 `logCrash("ipc:" + channel, error)` 留证，不把真实业务 bug 静默吞掉，也不让任何 on 处理函数把异常抛回 Electron。

## 门表与防复发

- `node scripts/door-map.mjs electron/ipcSenderGuard.ts electron/browser/core/browserViewUtils.ts`：99 扇（17 read、82 write），合同已写入 `docs/fixes/2026-10-04-ipc-on-untrusted-sender-dialog.root-cause.json`。
- `node scripts/check-ipc-sender-binding.mjs`：257 个注册，248 个已守卫，9 个既有 baseline unguarded；棘轮通过。
- R17 红测：临时把 `nomi:app:reopen-library-window` 的 fire-and-forget 调用替换为 `assertTrustedSender(event)`，门岗输出 `electron/main.ts:427 ... 直接调用会抛异常` 并以 exit 1 失败；恢复后通过。负向测试固化在 `scripts/check-ipc-sender-binding.test.mjs`。

## 改动与验证

改动集中在 sender guard、renderer log、浏览器视图生命周期边界、canvas reply 入口和静态门岗；没有触碰 3D-BOX 开关启动或 preload。新增/更新回归测试覆盖不可信 sender 不抛且限流、浏览器视图记录缺失分类、门岗红测，以及既有 canvas reply 行为。

已通过：

- `pnpm install`
- `pnpm run delivery:preflight`
- `pnpm run build:electron`
- `pnpm run build:renderer`
- focused Vitest：6 个文件、113 项全绿
- `pnpm run check:root-cause-contracts`
- `node scripts/check-ipc-sender-binding.mjs`
- `git diff --check`

`pnpm run review:branch` 当前仓库已没有这个 script（命令返回 `ERR_PNPM_NO_SCRIPT`）；仓库文档说明该评审在 2026-10-02 起由设计卡/独立验收和 `merge-preflight` 取代。`pnpm run gates` 已整合最新 `origin/main=ea3e7c4db66b` 后运行；本次改动相关门通过，整套 gates 的既有 `check:design-lab` 像素基线测试仍有多项失败，另有一次旧的 `check:filesize` 因 main.ts 格式化膨胀已修回并单独通过，完整 gates 收据待最终命令结束后补写。

未验证：尚未用原始 3D-BOX 旧 dist-electron 产物逐字节重放历史 crash；受控真实 Electron 已验证新边界和进程不阻塞。

PR：draft PR #981 — https://github.com/aqm857886159/Nomi/pull/981

提交：`c26bde60c`（随后合入最新 `origin/main=d88493c…`，当前 head `6d59a1390a89136a646e934ac48bd1ca81e2449e`）。
