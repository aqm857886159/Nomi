# 方向检查：退出生命周期排空

## 0. 一句话根因

结束进程这件事没有唯一 owner：任何模块都能订阅退出事件、各自 `preventDefault` 无限等待，或者直接 `app.exit` 跳过所有排空；同类修补只会继续增加状态机和旁路。

## 1. 归类表

| 提交 / bug | 直接原因 | 类根因 |
|---|---|---|
| 0.23.0 macOS 退出卡死 | task / Antigravity 各自拦截 will-quit 并等待未定界 Promise | 退出没有单一 owner 和总截止时间 |
| 关窗失联永久拦截 | 每个 close 请求都等待 renderer，没有超时 | 关窗确认没有活性判定 |
| 关窗确认等用户时偷偷算进退出预算（第 2 轮评审） | 到点强制关窗，丢未保存内容 | 用户思考时间和排空预算混在一起 |
| Windows 关机 / 注销不排空（第 5 轮评审） | Windows 会话结束不发 before-quit / will-quit，没人接 | 进程结束入口没有数全 |
| MCP stdio、父进程看门狗直接 `app.exit`（第 5 轮评审） | 绕过 owner，导出的 ffmpeg 子进程和 Agent 会话没人收 | 允许 owner 之外直接结束进程 |
| 真机 `app.quit()` 后进程不退（第 6 轮，独立验收 V-1125） | owner 排空完再调一次 `app.quit()`；排空在 will-quit 派发的微任务里就结束，Electron 此刻仍在「退出中」，把这次调用吞掉。main 上同样被吞，靠 3 秒兜底计时器掩盖（每次退出 3.2 秒 + 假 quit-timeout） | owner 自己的结束方式不唯一（quit 与 exit 两条）；单元测试的假 app 把 quit 当成独立记录器，不模拟 Electron 的重入规则；真进程测试只查「5 秒内退出」，兜底计时器就能让它绿 |

## 2. 为什么会反复出现

每个资源 owner 都能直接订阅 Electron 生命周期或直接退出，局部实现看起来简单，却无法证明所有结束路径共享同一排空和上限。修法是把「结束进程」本身收成结构：订阅和退出只在 `electron/quitTeardown.ts`，其他模块只能登记排空或调用 owner 的函数，ESLint 拦新的旁路。

| 铁律 | 回答 | 证据 |
|---|---|---|
| ①说的=摆的 | 正常退出从 will-quit 起最多 3 秒；无人值守退出（系统会话结束、启动器没了）最多 500ms；超时记步骤名后继续下一步。 | `electron/quitTeardown.test.ts` |
| ②能选到 | 调用方不能自选结束方式：`registerQuitDrain` / `requestQuit` / `exitWithoutConfirmation` 三个入口，别的写法 lint 不过。 | `eslint.config.mjs`、`electron/quitLifecycleGuard.test.ts` |
| ③点了=以为的 | 点退出：渲染层确认后关窗并真的退出；取消则什么都不释放；渲染层失联弹原生框、默认取消。 | `electron/windowCloseConfirmation.test.ts` |

## 3. 不改结构的可验证预测

| 预测 | 验证 |
|---|---|
| 新增任意 `app.on("will-quit")` / `win.on("session-end")` 会绕过共享上限 | `electron/quitLifecycleGuard.test.ts` 的 ESLint 反例（含 addListener / prependOnceListener） |
| 新增直接 `app.exit` 会跳过排空 | 同上，`main.ts` / `mainProcessLifecycle.ts` / `mcpStdioServer.ts` 写 `app.exit` 必红 |
| 一个永不 resolve 的排空会再次卡死 | quitTeardown 挂起矩阵，要求到点 `app.exit` |
| renderer 失联会让 close 永久卡住或静默丢内容 | 关窗测试：1500ms 无 ACK 弹原生框，默认取消 |

## 4. 验收线独立性

实现线只验证单元行为与静态结构；Windows 真关机、Linux 真关机、macOS 打包版 ⌘Q / Dock / 更新安装需要另一条验收线，PR 正文写「独立验收待派」。

## 5. P0 与现成方案

Electron 生命周期事件和 electron-updater 是现成能力，直接用；「哪些排空、什么顺序、多少预算、谁能结束进程」是 Nomi 的约束，没有现成库覆盖。没有引入新依赖。

自写登记 `mcp-protocol`（to-replace）：本刀只把 `electron/capabilityCore/mcpStdioServer.ts` 传输关闭后的 `app.exit(0)` 换成 `requestQuit()`，不碰 MCP 协议装配。协议本身已交官方 SDK v2；这个文件按登记计划在「第 3 段（宿主配置迁移、旧启动器当转发器）」完成后收成薄转发口，届时退出仍只调 `requestQuit`。现在换不了的原因不在退出：第 3 段未完成。

## 6. 方案对比与推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 补丁 | 给每个 listener / 每个 exit 各加 timer 和清理 | 重复状态机和多个 fallback | 竞态与超时不一致，新入口照样漏 | |
| 单一 owner（换） | owner 独占订阅与结束进程，串行排空、分步上限，静态守卫禁止旁路 | 迁移所有监听和直接退出 | 资源必须声明 required / optional | **推荐（已实现）** |
| 删除确认 | 关窗直接关闭 | 丢失未保存内容保护 | 用户数据风险 | |

## 7. 用户要权衡的核心

保住「有未保存内容先问一句」，同时退出永远有界。剩一个待定：Windows / Linux 关机时不弹确认、直接排空退出，渲染层自上次自动保存后的改动可能丢——要不要在那 500ms 里让渲染层静默存一次（见 PR 正文「待拍板」）。

## 第 6 轮补法（V-1125）

- 删：owner 结束进程只剩一个 `finish()` → `app.exit(code)`，删掉排空后再 `app.quit()` 的分支；总时限只有一个 owner 计时器，无人值守退出会重设（只缩不延）它。
- 结构：假 app 按 Electron 规则建模（退出进行中再调 `app.quit()` 被忽略），旧写法在单元里必红。
- 门岗：`tests/ux/quit-teardown-real.e2e.mjs` 改为离屏真进程、要求「排空完成」回执、内置四步顺序和 1500ms 内退出——靠兜底计时器退出的 main 也是红的。ESLint 改为按事件名拦（别名、计算属性、bind 都绕不过），`app.exit` 各种取法与给 app 起别名都拦。

## 特征测试清单

- `electron/quitTeardown.test.ts`：正常 / 抛错 / 永不 resolve × 第一次 / 连点 / 取消后再退出；分步上限与剩余预算；Windows / Linux / macOS 会话结束；带退出码的 requestQuit；关窗确认后续退。
- `electron/windowCloseConfirmation.test.ts`：ACK 后长时间确认 / 取消 / 无 ACK 原生框 / 连点 / 确认后续完退出。
- `electron/quitLifecycleGuard.test.ts`：订阅与直接退出的静态守卫反例与豁免。
- `electron/ai/antigravityIpc.test.ts`、`electron/tasks/taskIpcHandlers.test.ts`、`electron/mainProcessLifecycle.test.ts`：经真 owner 驱动的取消、等待、拒新、看门狗退出。
