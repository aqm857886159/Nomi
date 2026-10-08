# 关机静默存项目 设计卡

改动名：系统关机 / 注销时静默保存一次项目（F-shutdownsave，#1125 PR 正文「关机时的未保存改动」）
类别：可打断 / 长跑
依据：#1125 方案 B；架构评审 #1119（生命周期只有一个 owner，排空登记进 `registerQuitDrain`）

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成结果
- [ ] 数据格式

## ★ 5 格 + 可打断类全格

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 用户什么都不用做：Windows 关机 / 注销时不弹框，Nomi 在系统给的约 500ms 里把渲染层自上次自动保存以来的改动写进项目文件；没有欠的改动就不写盘。下次开机项目里是关机前最后一刻的样子。 | `electron/shutdownProjectFlush.ts`、`flushPendingWorkbenchProjectSaves` |
| ★2 谁说了算 | 退出归 `quitTeardown`；本改动只往它登记一条 `renderer-project-flush`（必需 + `critical`）。写盘仍是渲染层既有保存队列 → 主进程项目单写口（#1096），不新写一套写盘。 | door-map、`registerQuitDrain` |
| ★3 一致与复用 | 请求 / 回执模式照搬 `nomi:window:close-request`（渲染层经 preload 订阅，主进程等回执）。保存入口复用 `subscribeWorkbenchProjectPersistence` 的 `flushOwned`，不另起采样。 | `electron/preload.ts`、`workbenchProjectSession.ts` |
| ★4 全状态 | 见下方中途表；必红测试覆盖：有改动 / 无回执 / 无改动 / 存盘失败。 | `electron/shutdownProjectFlush.test.ts`、`electron/quitTeardown.test.ts` |
| ★9 验收与回滚 | 相关 Vitest、typecheck、build；真机 Windows 关机交独立验收线。回滚 = 整体回退本 PR（owner 的 `critical` 选项与这条排空一起走）。 | PR 正文 |
| 中途表 | 见下 | |
| 失败路径 | 见下（超时 / 失败只记日志，不拦关机） | |
| 性能数字 | 预算：整条关机路径 500ms（`CRITICAL_EXIT_TIMEOUT_MS`）；本排空自己上限 400ms，与 Agent 会话收尾并行，互不挤占。 | `SHUTDOWN_FLUSH_TIMEOUT_MS` |
| 真实条件 | 真机 Windows 关机 / 注销、Linux logind shutdown：unverified（见 PR 正文）。测试走真 owner + 真渲染层保存队列 + 真项目文件，只伪造 Electron 事件源与 IPC 线。 | 测试头注释 |

## 中途表

| 中途状态 | 行为 |
|---|---|
| 保存进行中又来关机 | 渲染层 `flushOwned` 先等在途保存队列，再补写排队的最新内容；一次关机请求只发一轮（owner 已有 `teardownStarted` 去重，query-session-end + session-end 两次只跑一遍） |
| 两个窗口 | 主进程给每个活窗口各发一条请求，并行等各自回执；每个窗口只存自己名下的项目 |
| 项目只读 / 磁盘满 | 保存抛错 → 渲染层回 `ok:false` → 主进程记 `renderer-project-flush-failed`，关机照走；失败的保存留在队列里，下次启动不会假装存过 |
| 渲染层卡死没回执 | owner 的单项截止（400ms）到点记 `renderer-project-flush-timeout`，整体 500ms 到点 `app.exit` |
| 渲染层已崩溃 / 窗口已销毁 | 不发请求（窗口过滤掉） |
| 没有欠的改动 | `flushPendingWorkbenchProjectSaves` 只冲「已排队 / 在途 / 上次失败」的保存，不重新采样，不写盘 |
| 普通退出（will-quit） | `critical` 排空在 will-quit 链里被明确排除，请求次数为 0（测试钉住 win32 / darwin / linux 与关窗确认后退出）；关窗确认里的保存不变 |

## Mac 结论

macOS 关机 / 注销走正常退出流程：`before-quit` → 关窗，关窗触发既有「关闭确认」（`useProjectWindowLifecycle` 的 close-request），用户确认后 `persistActiveWorkbenchProjectNow()` 存盘再放行。所以 Mac 已经会保存，本刀不改 Mac；`critical` 排空只在 Windows `session-end` / Linux `shutdown` 的无人值守路径触发。

## 先查别人

- Electron 自带：Windows `query-session-end` / `session-end`（https://www.electronjs.org/docs/latest/api/browser-window#event-query-session-end-windows）、Linux `powerMonitor` 的 `shutdown` 事件（https://www.electronjs.org/docs/latest/api/power-monitor#event-shutdown-linux-macos），以及 `app` 的 `before-quit` / `will-quit`（https://www.electronjs.org/docs/latest/api/app#event-before-quit；类型注释 `node_modules/electron/electron.d.ts:202` 写明 Windows 关机 / 注销不发 before-quit）。只给「要结束了」的时机，不管渲染层有没有欠的保存。
- 操作系统层：Windows 关机先发 WM_QUERYENDSESSION，应用可以延迟放行但时间很短（https://learn.microsoft.com/en-us/windows/win32/shutdown/wm-queryendsession），所以这一刀只能是几百毫秒内的静默落盘，不能弹框。
- 同类桌面应用：VS Code 的生命周期服务把「关闭前要等我做完」做成登记式、带截止时间（https://github.com/microsoft/vscode/blob/main/src/vs/platform/lifecycle/electron-main/lifecycleMainService.ts）；本刀沿用这个登记模式，不另起监听。
- 仓库里已有：渲染层保存队列与主进程项目单写口（`src/workbench/project/workbenchProjectSession.ts` 的 `flushOwned`）、退出 owner 的 `registerQuitDrain`（`electron/quitTeardown.ts:75`）、关窗确认的请求 / 回执写法（`electron/windowCloseConfirmation.ts`）。本刀不新增写盘逻辑。
- 结论：时机用 Electron 自带的，登记和预算用现有 owner，写盘用现有保存口；自写的只有「请求渲染层冲掉已欠保存」这一条登记排空（`electron/shutdownProjectFlush.ts`、`electron/quitOwnerMain.ts`）和 owner 的 `critical` 选项，理由是创作者的未保存项目改动不能因关机丢失（领域约束），已登记在 `docs/engineering/self-written.json`。
