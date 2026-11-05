用户 11-05 拍板：按推荐做

# 桌面打开与关窗生命周期：类根因复盘（待拍板）

基线 47da82ad9d29be2bfbca6000b051fc2db86f2733。保住：打开可见真正主窗、空闲关窗能退出、在途生成不丢、显式退出有效。最新「有生成时关窗问一句（留后台 / 退出，可记住）」须先批准样张。

### 0. 一句话根因

缺少把打开／关闭意图收口成可见结果的生命周期边界：任意窗口代替主窗、平台默认代替关窗策略，已有生产工作事实未接入关闭判据。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| d55aa3248（10-22，本地时区） | 预热接线从 main.ts 移到文本 IPC | 装配边界；非窗口恢复回归 |
| b8f13d128（10-27） | 提取提示词旧入口没有确认／授权令牌 | 付费准入；非窗口恢复回归 |
| 点开无窗 | activate 只 ensure；guard 看全部窗口；二次启动挑首窗 | 主窗身份／可见性契约缺失 |
| 关窗不退 | main.ts:654–657 在 Mac 保留进程 | 确认关窗与退出意图未衔接 |

fix-churn 实查退出码 1、文件 2 票；不能说同一窗口问题已修两轮。相关历史：3901a3019 零窗补建、626c55db5 后台启动、df3222dc8 退出唯一 owner；保留其并发去重、后台冷启和有界排空。

### 2. 为什么这一类会一直出现

已有 appWindowRegistry.ts:79–105，恢复却绕开它；mainWindowPresence.test.ts 接受任意 `{}`，productionRunDesktopLifecycle.test.ts 把 registry 固定为 null，测试和实现共同认错目标。window-all-closed 又受辅助窗牵制，不能单独代表用户关主窗。机器数门扫 3094 个文件：ensureMainWindow 为 3 门／5 处；getMainWindow 为 6 读门／8 处。继续一跳核了重建、深链、关闭，以及两个通知入口的任意首窗分支。

| 铁律 | 对照 |
|---|---|
| ⑩ 说的=摆的 | 生成参数不适用 |
| ⑪ 能选到 | 模型选项不适用 |
| ⑫ 点了=以为的 | 打开→主窗可见；确知空闲且确认关窗→进程退出；取消→保存与 IPC 可用。结账挂 electron/mainWindowPresence.test.ts、electron/productionRun/productionRunDesktopLifecycle.test.ts、electron/windowCloseConfirmation.test.ts 类矩阵及 tests/ux/full-walk/catalog.mjs 的期望／实测；缺真机证据不转 fixed |

### 3. 不改结构会冒什么

| 预测 | 验证 |
|---|---|
| 隐藏主窗激活无显示；二次启动／通知误显辅助窗 | 当前源码合成断言已见 mainShown=0、auxShown=1；后续隔离打包 App 走 Finder／Dock／二次启动／通知 |
| 只改 window-all-closed，辅助窗会继续挡空闲退出 | 留辅助窗、确认关主窗，核主 PID 与退出收据 |
| busy 被说成生成，纯导出／空 ready Run／读取失败都会误报 | 三种合成输入均 true；另补主进程未接单但画布排队的反例，禁止只凭主进程 false 自动退出 |

### 4. 靶子独立性检查

旧尺子认任意窗，须改成 registry 主窗与最终可见结果；未找到本窗口修复因掉分回滚的证据。原排查 21 组与本轮 10 个合成断言均非原生复现，不能认定用户现场或归因升级；实现前还须以正确预期先见红。

### 5. P0：现成能力与生成事实的主人

接现有 Electron 43.4.1：[app 同版本文档](https://github.com/electron/electron/blob/v43.4.1/docs/api/app.md)区分 activate／second-instance，Finder 再打开不能只靠后者；[BrowserWindow 同版本文档](https://github.com/electron/electron/blob/v43.4.1/docs/api/browser-window.md)提供 restore/show/focus。保存确认复用 windowCloseConfirmation，退出复用 quitTeardown.requestQuit/isQuitRequested；自写登记 nomi-quit-teardown-boundary 的领域排空理由仍成立，无新依赖或第二退出 owner。保留运行时；若打包矩阵定位原生缺陷，再按上游修复版本升级（retain-with-exit）。

**目前没有精确「正在生成」的唯一读面。** 生命周期聚合主人是 backgroundLaunch.ts:44–54 的 hasInFlightProductionWork，原始事实由 taskCache、ProductionRun repository.jobs/status、exportJobs 各自持有。其 true 含导出、ready、unknown，false 又不覆盖渲染层排队，**不能直接当生成／关窗判据**。最小办法：在既有主人复用 updateBusyGate 的单例、上报与未知保护（autoUpdater.ts:90,265–271），只派生事实，不另建计数／缓存；第二刀细分生成时复用 shared/productionShotPhase.ts，不能再手抄 Run 状态表；submission_unknown／待取回不能冒充空闲。更新／后台闲退保留宽判据。第一刀只对主、渲染两端确知全空闲自动退，纯导出／未知保守保活；这比「无生成就退出」窄，须明示拍板。

### 6. 三条路比较与推荐

| 选项 | 改／删 | 风险与两刀拆分 |
|---|---|---|
| 沿原方向补 | main.ts、productionRunDesktopLifecycle、mainWindowInteractions／windowCloseConfirmation 各加 show／退出判断，替换当地旧分支，约 4–5 个产品文件 | 能拆；重复策略仍漏通知、辅助窗、保存取消、重建。否 |
| **换做法：复用既有边界** | mainWindowPresence 管主窗恢复；main.ts、productionRunDesktopLifecycle 转交意图；删任意首窗与散落恢复。windowCloseConfirmation 保存成功后、销毁前复核工作，经原 owner 退出；backgroundLaunch 承接原 busyGate，autoUpdater 转交上报 | **第一刀约 10 个现有产品文件，零新增产品模块**：左列 6 个核心文件，另有 notificationIpc.ts、productionRun/productionNotificationsDesktop.ts、capabilityCore/appIntegration.ts、screenshot/screenshotHotkey.ts 的薄调用接线，外加测试／合同。后两者保留原窗口／项目租约，只共享显示操作。推荐 |
| 删用户关窗后留存 | main.ts／windowCloseConfirmation 确认后一律 requestQuit，删留存分支；保留独立的后台冷启功能 | 可先交恢复，但全退出会打断在途任务，旧用户无安全迁移，违反已批需求。否 |

推荐的**第一刀**只做统一召回＋确知全空闲退出；保护并发／重建不抢前台、保存取消／失败、显式退出、保存间工作变化。忙／未知不新增自动隐藏策略，不能称有活关窗已交付。**第二刀**在样张批准后改既有关闭交互、受信桥、词表与设置，做选择／记忆／可见后台，替换过渡行为。第一刀不加监督进程、版本握手、安装器、托盘或自动强杀；reject 可重试，但主线程卡死、坏 renderer、永久 pending 仍未验证，不能承诺都能召回。赶不上版本不等待，不省真实验证。

### 7. 用户要权衡的核心

先交统一召回与保守空闲退出，接受导出／未知暂不自动退、选择框稍后交；还是把健康监督与完整后台体验一起做、扩大本次范围。**推荐前者，结构及临时语义待拍板。**

## 特征测试清单

本轮临时夹具直接编译当前生产函数，10 个合成断言：隐藏主窗激活；二次启动的仅辅助窗／辅助窗排首／零窗；空闲／纯导出／空 ready／读取失败；两种通知辅助窗排首。均钉住旧行为，不是修复绿灯。上述现有单测在实施时补并发、深链就绪后投递、维护重建、保存失败／取消、显式退出、辅助窗、渲染层排队、保存间变化及原目标身份的先红矩阵；后台／更新判据另回归 electron/backgroundLaunch.inflight.test.ts、electron/update/updateBusyGate.test.ts。未改仓库或逃逸账本；实现时登记 candidate，挂⑫类检查。真实 Mac／Windows 均 unverified。

## 与 10-29 草稿对照

独立初稿封存后才读取旧稿。一致：⑫、registry、统一恢复、保存后复核、不另造计数、保留 renderer、复用退出 owner。不同：第一刀不必新增 desktopLifecycle／desktopWorkState／desktopLaunchEntry／desktopLaunchSupervisor／desktopRecovery 五模块并改造启动链；用现有 6 个核心文件＋4 个调用者即可，也不能硬压四文件而漏通知。旧稿自动留后台已被最新「问一句、可记住」收窄，须先样张。旧稿纯导出走退出排空会中止导出；本建议暂保活，须批准且不冒充生成。未知最终应可见解释，但第一刀不另造错误面。主线程卡死确需进程外处理的判断成立，尚无用户现场证据，单列后续；未验平台矩阵不写「同类不能回来」。
