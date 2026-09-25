# 渲染层失败证据落盘（诊断包里看得到「为什么保存失败」）

> 状态：🚧 进行中（2026-09-24，分支 `claude/beautiful-leakey-53510b`）。根因合同 `docs/fixes/2026-09-24-renderer-failure-evidence.root-cause.json`。

## 症状

2026-09-24 一位 Windows 用户发来的诊断包（manifest.json + logs/nomi-crash.log + logs/nomi-日期.log + model-catalog.json）
只有主进程日志。用户看到的是「项目保存失败，请检查本地磁盘权限」，包里却**一行都没有**说为什么——
那天真正的原因是 `WorkspaceManifestLockBusyError`（PR #862 修掉的锁残留），是靠别的线索猜出来的。

## 根因

- 直接原因：`NomiStudioApp.tsx` 的 `onSaveError` 只做两件事——`console.error('project save error', error)` + 弹本地化文案。
- 类根因：**渲染层没有「失败证据」的持久出口**。渲染层 54 处 `console.error/warn` 在打包版里没人接（`devDiagnostics.ts` 的 console 转发只在开发态、只喷 stderr）。
  主进程 2026-09-06 已经把 99 处 console 收进 `electron/logging/logger.ts` 并用 `check:main-console` 守住，渲染层这一半一直空着。
- 唯一一条渲染层→主进程的日志通道 `nomi:log:renderer-crash` 只给崩溃边界用，且收的是自由文本（被 200 字上限截断，栈基本丢光）。

## 先查别人（R5）

- **生态里已有**：electron-log（Context7 `/megahertz/electron-log`）https://github.com/megahertz/electron-log/blob/master/docs/initialize.md ——
  渲染层日志**只走一条 IPC 通道**（`__ELECTRON_LOG__`）送到主进程，由主进程统一写文件。我们照同一形状做：一条通道、主进程一处写手。
- **生态里已有**：electron-log 的 `errorHandler.startCatching` https://github.com/megahertz/electron-log/blob/master/docs/errors.md ——
  两个进程都要接「没人 catch 的异常 / 拒绝」。对应我们的 `installRendererErrorCapture`（此前全仓没有 `unhandledrejection` 处理）。
- **有意不同**（同一出处）：electron-log 的报文是任意 `data: [...]`（自由文本）；我们只收「短事件名 + 摊平的错误 + 标量字段」，
  因为主进程日志的隐私约定是**API 形状先拦**、脱敏兜底（`electron/logging/logger.ts:1` 头注释）。领域约束：日志进诊断包、由用户发给我们。
- **依赖里已有**：Electron 自带 `ipcRenderer.send`（`node_modules/electron/electron.d.ts:9272`，单向、无返回）——日志不需要回执，用 send 不用 invoke；不引入 electron-log 这个新依赖。
- **仓库里已有**：主进程出口 `electron/logging/logger.ts:190`（`logError`）与脱敏 `electron/logging/redact.ts:1` 直接复用；
  旧的渲染层崩溃通道 `electron/crashLog.ts:224`（`registerRendererCrashIpc`，本次删掉并入新通道）；
  开发态 console 转发 `electron/logging/devDiagnostics.ts:35` 只喷 stderr、刻意不落盘（自由文本有隐私风险）——所以不能靠「把 console 转发落盘」来补这个洞。
- 自媒体（TikHub）：不适用——这是内部诊断链路，不是用户可感知的功能。
- **结论**：用已有（Electron IPC + 我们自己的 logger/redact owner）+ 照 electron-log 的通道形状，不引新依赖。

## 方案

一条通道、两端各一个 owner：

| 层 | owner | 做什么 |
|---|---|---|
| 渲染层 | `src/desktop/rendererLog.ts`（`logRendererError / logRendererWarn / logRendererCrash`） | 本地 DevTools 照打；把错误摊平成 `{name, message, code, stack}` + 标量字段，经桥送出。**仓库里唯一调用 `bridge.log.report` 的地方。** |
| 报文 | `electron/shared/contracts/rendererLog.ts`（`RendererLogEntry`） | 三级：`warn` / `error` / `crash` |
| 通道 | `nomi:log:renderer`（preload `log.report`） | **替换**旧的 `nomi:log:renderer-crash` / `logRendererCrash`（P1 同 commit 删旧） |
| 主进程 | `electron/logging/rendererLog.ts`（`registerRendererLogIpc`） | sender 守卫 → 形状校验（不合格记一行 `renderer-log-rejected`）→ 按事件限流 → `logWarn/logError("renderer", …)`；`crash` 级走 `logCrash`（崩溃文件 + 通用日志）。脱敏只在这里做一次，复用 `redact.ts`。 |

第二扇门：渲染层**没人接住**的异常与 Promise 拒绝（此前全仓没有 `unhandledrejection` 处理）由 `installRendererErrorCapture` 在入口装上，走同一个出口（对应 electron-log 的 `errorHandler.startCatching`）。

防复发：`eslint.config.mjs` 对 `src/**` 开 `no-console`（`error`/`warn` 硬零，`log/info/debug` 放行），唯一例外是 owner 本身。
存量 54 处全部迁完，不留基线。

实施中发现并一并修掉的同类洞：`redact.ts` 遇到**带空格的路径**只抹得掉空格前半段——默认项目根就叫 `Nomi Projects`，
`…/Nomi Projects/猫咪短片/…` 会漏成 `<path> Projects/猫咪短片/…`，项目名进日志（主进程的 fs 错误早就这样，渲染层错误进日志后只会更多）。
改为：引号内的绝对路径整段抹；盘符路径与 `/Users`、`/home` 等用户根下的路径按段认、段内允许空格。

## 界面文案：锁被占时不再说「检查磁盘权限」（2026-09-24 用户拍板）

真机复现时发现：锁被别处占着（另一个 Nomi 窗口 / 另一台电脑经同步盘），界面也说「项目保存失败，请检查本地磁盘权限」，
把人支去查一个根本没坏的东西。用户定的文案：**「项目正被别处占用」**（en：This project is in use elsewhere）。

- 身份：主进程锁忙错误的名字定在 `electron/shared/contracts/workspaceBusy.ts`（`WORKSPACE_MANIFEST_BUSY_ERROR_NAME`），
  锁类用它命名、渲染层用 `isWorkspaceBusyError` 认——Electron invoke 只带回「名字: 信息」，认的是我们自己的类名，不匹配英文句子。
- 挑文案只有一处：`src/workbench/project/projectSaveFailureText.ts`，四条保存路径（自动保存、改名后保存、关窗、刷新）共用；
  其它失败（真的权限问题等）仍是原句。

## 概念占用表（R33）

| 概念 | 唯一 owner | 允许谁消费 |
|---|---|---|
| 渲染层失败证据（进主进程日志的那一行） | `src/desktop/rendererLog.ts` · `forwardToMainLog`（对外 `logRendererError / Warn / Crash`、`installRendererErrorCapture`） | 所有渲染层失败处；**不许**别处直接调 `bridge.log.report` |
| 渲染层日志报文的校验 / 限流 / 分级 | `electron/logging/rendererLog.ts` · `createRendererLogRecorder` | 仅 IPC 注册 |
| 日志落盘与脱敏规则 | `electron/logging/logger.ts` / `redact.ts`（既有 owner；本次只补带空格路径） | 主进程各处、渲染层记录器、反馈与遥测投影 |

已登记进 `docs/engineering/concept-owners.json`。

## 范围 / 不动项

- 动：上表四个文件 + preload + `bridge.ts` 类型 + `crashLog.ts`（删旧注册、`logCrash` 可带字段）+ `main.ts` 一行 + `main.tsx` 装全局捕获 + 54 处迁移 + 相关测试 + eslint 规则 + `check-error-surface.mjs` 把新 owner 认作「诊断出口」+ 诊断包日志条目的说明文字 + `redact.ts` 带空格路径（见上）。
- 不动：日志文件滚动/保留期、诊断包的收录范围、界面布局；界面文案只动「锁被占时」那一句（见上）。
- 顺带：`scripts/door-map.mjs` 入口判断在 Windows 上恒不成立（静默零输出），本次要用它出门表，改成 `pathToFileURL`；同族另 7 个脚本已开独立任务。
  两个错误边界各有一份一字不差的 `reloadRendererWindow`（都 cast window 绕过类型化的桥），合成一份放进 `src/desktop/bridge.ts`（症状簇触发的结构评审 `docs/audit/2026-09-24-src-desktop-ui-structure-review.md`）。
  `tests/ux/diagnostics-bundle.walk.mjs` 找的按钮文案「导出诊断包」早已改成「导出诊断」，这条走查一直是红的，顺手改对并实跑通过。

## 回滚

单 PR 回滚即可：通道名、owner、lint 规则同进同退，没有数据迁移。

## 验收门

1. 单测：渲染层一次保存失败 → 主进程日志**恰好一行**，含 `ERROR renderer project-save-failed`、错误名与码，**不含**绝对路径 / 提示词字段 / 密钥形串。
2. 单测：非法报文、非受信 sender、刷屏限流。
3. 真机（中英各一遍）：隔离实例里人为占住项目的 manifest 锁 → 触发保存失败 → 界面是「项目正被别处占用」→ 导出诊断包 → 包里 `logs/nomi-日期.log` 有那一行（`tests/ux/renderer-failure-diagnostics.walk.mjs [zh-CN|en]`）。
4. `pnpm run gates`（contracts + focused unit + build）。
