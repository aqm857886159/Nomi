# 应用内更新提醒（实现卡）

线：I-update。拍板：用户 2026-10-08（更新提醒画布三点按推荐）；样张分支 design/update-reminder（devlab「update-reminder」屏，已并入本分支，格子改为渲染生产组件）。

## 三问

1. 近 14 天修过几次：`fix-churn` 对 `electron/quitTeardown.ts` 命中（12 个 fix）。本线**不改该文件**，只通过它已有的 `registerQuitDrain` 登记一个排空项；`electron/update/`、`UpdaterDialog`、`AboutSection` 未命中。
2. 是不是我们独有：不是。检查 / 下载 / 安装用现成的 `electron-updater`（`fullChangelog`、`install(isSilent)`），发版说明 HTML 解析用 `parse5`（依赖树里本来就有，升为直接依赖），状态用 `zustand`。我们只写「更新提醒的呈现与流程」。
3. 补 / 换 / 删：**换 + 删**。新的状态持有（主进程 hub + 快照）和四个组件同提交替掉旧的 `UpdaterDialog`、`useUpdater` 内的渲染层状态机、`AboutSection` 里整套重复的更新 UI、devlab 样张里的临时组件；不留并行版。

## 先查别人（≥3，带出处）

- electron-updater 6.8.9 源码 `out/BaseUpdater.js`：`autoInstallOnAppQuit` 在库内部订阅 `app.once("quit")` 静默安装；`install(isSilent, isForceRunAfter)` 是公开同步方法，可以在任意时刻起安装程序。结论：我们保持 `autoInstallOnAppQuit=false`，由退出 owner 的排空项调 `install(true,false)`，库不另订阅 quit。
- `GitHubProvider.js`：`fullChangelog=true` 时 `releaseNotes` 是「当前版本之后每个版本一段」的数组；否则只有最新一段。结论：打开它，跳版的「已更新」卡才有各版内容。
- VS Code：后台获取、重启是明确可延后的动作，https://code.visualstudio.com/docs/configure/extensions/extension-marketplace 。
- Obsidian：新版本在重启时安装，https://obsidian.md/help/teams/deploy 。
- Slack：有更新时帮助图标加角标 → 重启应用，release notes 按安全等级分类，https://slack.com/help/articles/360048367814-Update-the-Slack-desktop-app 。
- Linear Desktop：版本发布后提示，changelog 分新增 / 修复 / 改进，https://linear.app/changelog/page/21 。

结论与拍板一致：发现放在已有表面不弹窗、重启可延后、用分类的收益解释「为什么更新」。

## 设计卡（新界面 + 长跑 / 可打断：9 格）

| 格 | 结论 |
|---|---|
| ★1 用户怎么用 | 打开 Nomi 想继续做片时，知道有没有修掉我遇到的问题的新版，并在不打断生成的前提下用上。真实任务：①Mac 用户见热修横幅，按三步换上 0.23.1；②Windows 用户有视频在生成，点「下载更新」，生成照跑，晚上退出时自动装好，次日见「已更新」卡；③英文界面只看到英文说明。不做：自动下载、启动弹窗、画布内提示、Mac 就地更新。指标：新版发布 3 天内升级比例；护栏：更新导致项目打不开 = 0、中断生成 = 0。 |
| ★2 谁说了算 | 更新状态 owner = 主进程 `electron/update/updateHub.ts`（共享 reducer 记真相，广播事件，提供快照）；跨重启记忆（横幅 ✕ 过的版本、已更新卡）归 `updateReminderStore`（settings 根 `update-reminder.json`，走配置读写原语）；「退出时安装」归退出 owner 的排空项（`installOnQuit.ts`）；渲染层只读 `useUpdater`（zustand 存储，一次订阅）。「同意更新」= 点「下载更新」这个显式事件，不推断。 |
| ★3 一致与复用 | 复用 DecisionBar（取消左、主动作右）/ WorkbenchButton / DesignProgress / useOverlayEscape；胶囊照抄宿主顶栏两族控件；横幅和卡片用项目库状态条同一组 token；设置→关于不再自带一套下载 / 重启 UI，只报一句状态 + 「查看」打开同一个弹窗；文案一套（`updateReminder.*`）。 |
| ★4 全状态 | 无新版：无胶囊；有新版（攒批）：胶囊；有新版（热修，适用本平台、未 ✕）：胶囊 + 项目库横幅；检查中 / 已是最新 / 离线 / 开发版（设置页就地说明）；下载中：胶囊进度 + 弹窗进度；下载失败：胶囊「重试」+ 弹窗（网络 / 其他两种话术）；已下载待安装：胶囊「重启以更新」；有任务在跑：只说明、「知道了」；安装失败：胶囊 + 弹窗「更新没装上」；Mac：官网 + 三步；预览版 / 开发版不显示；更新后：一次性卡（跳版合并）；zh / en、亮 / 暗、窄屏图标态。 |
| 5 中途表 | 见下表。 |
| 6 外部数据与失败 | 外部：GitHub Atom feed 里的 releaseNotes HTML、`latest.yml` 的文件大小。结构对不上（无标题 / 无英文段 / 无加粗）→ 摘要为空，界面只显示版本号 + 「完整说明」链接，不贴乱 Markdown。发版说明门岗 `check:release-notes`（≥0.23.0 必须有中文标题句、英文标题句、中英条目）。 |
| 7 性能预算 | 不适用：只在顶栏 / 弹窗渲染，摘要在主进程一次解析（单版本 HTML 几 KB）。 |
| 8 真实条件 | 本机：devlab 真组件截图（zh/en、亮/暗）；主进程接线用真实 `autoUpdater.ts` + 真实退出 owner + 真实记忆文件，假 electron / electron-updater。真安装包退出时安装、Mac 引导：unverified，交独立验收与 Mac 发版测试。 |
| ★9 验收与回滚 | 独立验收线在本地更新源上走 Windows 下载 → 退出自动装 → 更新卡出现一次；Mac 走三步。回滚：revert 实现 PR；删 `UpdateReminderHost` 一行即回到无提醒。 |

## 中途表

| 中途 | 结果 | 证据 |
|---|---|---|
| 下载中关窗 | 下载在主进程继续；窗口重开用快照补回进度 | `autoUpdater.flow.test.ts` 快照用例 |
| 下载中断网 / 失败 | 错误带「哪一步 + 是否网络」；状态保留新版信息；撤销同意（退出不装）；重试 = 直接重下（不先重新检查），一次点击生效 | flow 测试「下载失败…重试」 |
| 连点「下载更新」 | 只开一次下载（`downloadInFlight`） | flow 测试 |
| 连点「重启以更新」 | 只触发一次；没下好不装；随后退出不重复装 | flow 测试 |
| 下载中退出 | 不装半截；下次启动重新检查，缓存的包由库校验复用 | 库行为，unverified（真机） |
| 下好后正常退出 | 排空项静默安装（不自动重开） | `installOnQuit.test.ts`（真实退出 owner） |
| 系统关机 / 登出 | 只跑关键排空项，不装 | `installOnQuit.test.ts` |
| 有任务在跑时 | 弹窗不给「重启」，说明「退出时自动装」；退出安装由用户自己退出触发 | 组件 + 夹具截图 |
| 装包程序没起来 | 排空项报失败（退出收据可见），下次退出再试 | `installOnQuit.test.ts` |
| 装的时候断电 | NSIS 自己的行为，unverified | — |
| 排空项顺序 | 点下载时才登记，排在启动期排空项之后，装包程序启动时 Nomi 已收尾 | 同上顺序断言 |

## 已知取舍

- 非 0 退出码（致命错误退出）时排空项也会装：退出 owner 未暴露退出码，不为此改热点文件；后果是装一个用户已同意的更新。
- 外壳线合入后：把 `NomiAppBar` 右簇、`ProjectLibraryPage` 窗口栏里各一行 `<UpdatePill />` 按新顶栏重摆；把 `<HotfixBanner />`、`<UpdatedCard />` 摆进项目库通知位。
- 失败话术按原因分三种（没连上网 / 连接中断了 / 其他）+ 安装失败一种；原文折叠在「技术详情」里，不承诺「会接着下」（缓存复用 unverified）。
