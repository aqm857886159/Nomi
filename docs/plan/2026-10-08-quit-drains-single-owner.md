# 退出排空单一 owner 设计卡

改动名：结束进程归一到 quitTeardown（架构评审 H1 第一刀）
负责人：实现线
类别：可打断 / 长跑

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成结果
- [ ] 数据格式

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 点退出或关窗：渲染层 1500ms 内回 ACK 就由用户决定、不计时；不回 ACK 弹原生「强制退出 / 取消」框（默认取消）；确认后关窗并真的退出。关机 / 注销时不弹框，最多 500ms 收尾后退出。 | `electron/windowCloseConfirmation.ts`、`electron/quitTeardown.ts` |
| ★2 谁说了算 | `quitTeardown` 独占 before-quit / will-quit / 会话结束订阅和 GUI 进程的 `app.exit`；其余模块只登记排空或调 `requestQuit` / `exitWithoutConfirmation`。 | door-map、ESLint 守卫 |
| ★3 一致与复用 | 所有排空用同一登记接口声明 required / optional 与单项截止时间；不保留调用方退出状态机。 | `registerQuitDrain` |
| ★4 全状态 | 正常、抛错、永不 resolve、重复退出、取消后再退出、无 ACK、系统会话结束、启动器消失、带退出码退出都有测试，且都在预算内结束。 | 相关 Vitest |
| ★9 验收与回滚 | 相关 Vitest、typecheck、lint、build、根因合同门；真机（Windows 关机、macOS 打包版退出）交独立验收线。回滚 = 整体回退本 PR，旧多 owner 监听不得与新实现并存。 | PR 正文 |

### 设计决定

- 正常退出：预算从 will-quit 起算（默认 3000ms）。内置四步串行：background-lifecycle → capability-core → active-exports（各 250ms 上限）→ desktop-lane-ipc（拿剩余全部，它的 workspace.close 落盘 Agent 会话 transcript / trace）；再串行跑登记的必需排空，可选排空并行、超时只记日志。某步超时记 `<步骤>-timeout` 后继续；有超时则 `quit-timeout` + `app.exit`，否则 `app.quit()`（带退出码时 `app.exit(code)`）。
- 无人值守退出（Windows `query-session-end` / `session-end`、Linux `powerMonitor` `shutdown`、开发启动器消失）：只跑 active-exports → desktop-lane-ipc，总上限 500ms，然后 `app.exit(0)`；Windows / Linux 先 `preventDefault` 让系统等这 500ms。macOS 关机 / 注销走正常退出流程（会问未保存内容）。
- 关窗确认：被阻止的窗口 close 会取消 Electron 正在进行的 quit，所以用户确认关窗、窗口关掉后，若之前请求过退出，owner 续发一次 `app.quit()`（幂等）。

## 先查别人

- 依赖里已有：Electron 自带退出事件 `before-quit`（`node_modules/electron/electron.d.ts:202`）和 `will-quit`（`node_modules/electron/electron.d.ts:990`），还有 `app.quit()` / `app.exit(code)`（https://www.electronjs.org/docs/latest/api/app#appexitexitcode）。它们只给「要退出了」这个时机，不负责「几件异步收尾按什么顺序、各给多少时间、超时怎么办」。
- 生态里已有：Windows 关机 / 注销时 Electron 发 `query-session-end` / `session-end`（https://www.electronjs.org/docs/latest/api/browser-window#event-query-session-end-windows）；VS Code 把退出收尾做成生命周期服务，各模块登记「退出前要等我做完」再统一放行（https://github.com/microsoft/vscode/blob/main/src/vs/platform/lifecycle/electron-main/lifecycleMainService.ts）。本方案照这个「登记排空、统一放行」的模式做，不另起写法。
- 仓库里已有：退出前 `electron/mainProcessLifecycle.ts:80` 只挂了一个 `will-quit` 去停父进程看门狗；各模块原来各自监听退出事件，没有统一顺序和总预算——这正是本方案要收成一个 owner 的原因。
- 结论：时机和结束进程用 Electron 自带的；只自写排空登记表、顺序和总预算（`electron/quitTeardown.ts`），理由是要保证 Nomi 自己的项目落盘和 Agent 会话记录在限时内写完（领域约束），已登记在 `docs/engineering/self-written.json`。
