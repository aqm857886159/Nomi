> 用户 10-27 拍板：可以在用户用 Claude 时试跑，偶尔抢一下焦点也行；路线先 B 后 A。

# 方向检查：走查抢前台——第 3 轮（macOS 的启动即激活）

> 2026-10-27，实现线 I-walk-quiet 第 3 轮。触发：同一条线派第 3 轮（模板「触发」第 4 条，人工判）。第 1 轮 bbc3bbb34 让每个隔离走查默认装安静仪表；第 2 轮 db1bc23f6 补了门岗判红、放行位钉死、非隔离入口、透明 + 穿透，真机证实还剩一条 JS 拦不到。用户原话：「能不能让那个后台开那个东西的时候不要影响我前面的页面呀」。
> 本轮实现提交都带 `Direction-Check: docs/engineering/direction-checks/2026-10-27-walk-quiet-r3.md`。设计卡：`docs/plan/2026-10-27-walk-quiet.md`；根因合同：`docs/fixes/2026-10-27-walk-steals-foreground.root-cause.json`。

## 0. 一句话根因

从 Agent 的进程链起的 GUI 程序，macOS 会把 Agent 的宿主 App 认成发起方；宿主在最前时，系统就放行这个程序原生的「启动即激活」。这一步在 AppKit / LaunchServices 里，走查主进程的 JS 仪表管不到。

## 1. 归类表：现象 → 直接原因 → 类

| 轮次 / 现象 | 直接原因 | 类 |
|---|---|---|
| 用户投诉：后台一起走查，前面的页面被打断 | 屏外模块是选配；窗口按 `show: true` 构造，Electron 的 `Show()` 会激活 App；桌面出口（通知、外部打开、对话框）没统一 | JS 出口没收口（第 1 轮收） |
| 第 2 轮真机：「屏外」窗口在主屏左缘露出 40px 一条，还排在用户窗口上面 | macOS 不认屏外坐标，把窗口夹回主屏可见区 | JS 出口没收全（第 2 轮改成透明 + 穿透） |
| 第 2 轮真机：用户在 Claude 里 3/3 被激活成最前，在 Chrome 里 0/3 | 走查主进程零聚焦调用；LaunchServices 把走查 Electron 的父 App 推断成 Claude（`LSParentASNWasInferred=true`），Claude 在最前时系统放行启动即激活 | **发起方归属**：系统层的激活，不是 JS 出口（本轮） |

## 2. 为什么这一类会一直出现

- **类根因**：从 Agent 的进程链起的 GUI 程序，系统把 Agent 宿主 App 认成发起方；宿主在最前时，原生的启动即激活就会放行。走查的进程链是 Claude 桌面版 → Claude Code → shell → 门岗锁 → node → Electron，LaunchServices 一路往上找，找到的第一个 App 就是 Claude。JS 层的仪表只能管主进程自己发起的调用，管不到这一层。
- **系统哪里没拦住**：前两轮只假设 JS 出口是全部出口，把「抢前台」当成主进程调用的问题，一路在 `_quietWalk.cjs` 里包方法；真焦点的量具到第 1 轮才有（门岗的 `lsappinfo` 抽样），事件驱动的系统通知（`lsappinfo listen`）到第 2 轮才有。之前只看得见「窗口在不在屏幕上」，看不见「键盘焦点归谁、是谁让系统放行的」。
- 能复现它的条件恰好是「用户正在用起走查的那个 App」：夜跑、CI、用户在别的 App 里都碰不到，所以前两轮的自验全绿也没暴露。
- 三条体验铁律（⑩ ⑪ ⑫）不适用：这是测试夹具和桌面之间的边界，不是产品参数、模型档案或可点目标。类级检查挂在启动器的单测矩阵（`tests/ux/_launchApp.test.mjs`）和仪表单测（`tests/ux/_quietWalk.test.mjs`）上；真机四份量具是每轮必跑的验收，不进 CI（CI 是 Linux，没有这条路）。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 用户在 Claude 里时，每起一条走查都会被激活一次；门岗把走查的退出码钉成 1，用例本身的结果被盖掉 | 用户在 Claude 里跑 J04，看门岗收尾行和 `lsappinfo listen` 里走查 Electron 的 `BecameFrontmost` |
| 不经 `launchNomiApp`、直接起 Electron 的子进程（夹具加密测试 key 的短命 Electron、plan-gate / multishot 的 stdio MCP 子进程）同样会被系统激活，而门岗只盯 GUI 那一个 PID，看不见它们 | 用户在 Claude 里跑一条用 `agent-runtime-fixture` 的走查，看 `lsappinfo listen` 里有没有短命 Electron 的 `BecameFrontmost` |
| 换一个宿主（终端、别的 Agent 桌面版）同样复现：哪个 App 起的走查、它此刻在最前，系统就放行 | 在终端里起走查、终端在最前时看 `lsappinfo listen` |

## 4. 靶子独立性检查

- 量具和被测的不是同一份代码：门岗在启动器里抽样，另有三路外部观察（外部 `lsappinfo` 抽样、CGWindowList 窗口元数据、`lsappinfo listen` 系统通知），各自独立，第 2 轮 6 次启动结论一致。
- 靶子是对的：键盘焦点确实被拿走了（系统通知里菜单栏仍归 Claude、最前应用是走查 Electron）。不改靶子，门岗判红照留，当量具。

## 5. P0：这些是我们独有的吗

- 不是。「后台起 GUI 程序不抢焦点」是通用能力，系统给了现成手段：激活策略（AppKit `NSApplicationActivationPolicyProhibited`，Electron 暴露为 `app.setActivationPolicy('prohibited')`），以及换发起方（launchd 起的进程不在宿主的进程链里，LaunchServices 推断不到宿主）。两条都用现成的，不自写激活拦截。
- Playwright 的 Electron 启动没有「不激活」选项、也不能接管别人起的 Electron（第 1 轮已查），所以不在 Playwright 那层解决。

## 6. 选项与推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 B：激活策略 | 仪表在 `will-finish-launching` 切 `prohibited`（不许激活），`ready` 切回 `accessory`；切回之后仍被激活，就试变体：保持 `prohibited` 到第一扇窗 `showInactive` 之后约 1 秒再切 | 只改 `tests/ux/_quietWalk.cjs` 和单测 | `prohibited` 下窗口能不能上屏、延迟的激活会不会在切回后生效，只能真机验；变体要核窗口可见、页面 `visible`、截图不空白 | **先试** |
| 接入现成方案 A：换发起方 | 只在 Mac 上，走查经临时 LaunchAgent 起（`launchctl bootstrap gui/$(id -u) <plist>` 再 `kickstart`），进程链里没有 Claude；退出码、stdout、stderr 原样回到调用方；门岗锁的持有者等 launchd 起的子进程跑完才放锁；临时 plist 用完 `bootout` 并删掉 | 改门岗锁 / 走查跑器 / `_launchApp.mjs` 其中一层，比 B 大；改哪层先写进设计卡 | `launchctl asuser` 要 root，不用；不装常驻 LaunchAgent、不改系统设置 | B 管不住再上 |
| 补 | 激活之后立刻 `deactivate`，把焦点还回去 | 小 | 事后补救，用户照样被抢一下 | 否 |
| 删（只认门岗） | 保持现状：抢了就判红 | 零 | 原始投诉没解决 | 否 |

## 7. 用户要权衡的核心

为了让 macOS 从源头就不放行这次激活，要在用户正用 Claude 的时候试跑几次，修不对的那几次会抢一下焦点（用户 10-27 已同意；全程合计不超过 8 次）。

## 这轮补什么

- **换**：启动激活由「事后判红」换成「从源头不让系统放行」——先 B，B 管不住才上 A。门岗的判红照留，当量具。不留开关，不留回退。
- **删**（P1，不留并行版）：`tests/ux/full-walk/offscreenWindow.cjs` 和装它的那几行；安静仪表已对所有隔离启动默认装。
- **门**：直接 spawn Electron 的三处（plan-gate、p4-s6p5-multishot-paid、memory.e2e）钉死放行位，单测扫描钉住「直接 spawn Electron 的入口也拿不到外面 export 的放行位」；`evals/loop/appBridge.mjs` 的调用方把放行判断提到读真实 catalog 之前，跳过路径一个字节不读。
- **量具**：四份（门岗收尾行、外部 `lsappinfo` 抽样、CGWindowList 窗口元数据、`lsappinfo listen`）写进设计卡 ★9，用户在 Claude 里、不在 Claude 里各跑一次，做不到的写 `unverified`。

## 特征测试清单（动结构前先锁住）

- `tests/ux/_launchApp.test.mjs`、`tests/ux/_quietWalk.test.mjs`：第 2 轮 60/60，本轮动手前在 db1bc23f6 上再跑一遍作基线。
- 真机基线：第 2 轮报告的真机量具（r2-j04、r2-library-layout、r3-j04 三次在 Claude 里被激活；r1 两次、r3-library-layout 在 Chrome 里没被激活）。
