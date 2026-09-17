# 全局 HID 不带目标应用：发 Cmd+Q 之前不确认前台是谁，你退掉的是自己的宿主

> 📎 教训 · 首次记录 2026-09-17 · 状态：🟡 待固化（候选：`tests/ux` 走查任务书模板里把「HID 前必验前台」写成硬步骤；更早的那层防线是**根本不用全局 HID 发退出类快捷键**）
> **触发场景**：你准备用 Quartz `CGEvent` / `osascript keystroke` / `cliclick` 之类「真鼠标真键盘」驱动一个桌面 App，尤其是要按 `Cmd+Q` / `Cmd+W` / `Cmd+Delete`；或者一批后台 agent 毫无征兆地集体断线、而用户看到某个 App「闪退」了。

**结论**：全局 HID 事件**不带目标应用**——它落在当时的前台窗口上，和你以为在驱动哪个 App 无关。
在这台机器上，前台十有八九是承载会话的 Claude 桌面端。所以「像真人一样退出被测 App」这句话，
用全局键事件去实现，实际含义是「退出用户此刻正在看的那个 App」，而那个 App 就是你自己的宿主。

## 症状

2026-09-17 19:49，一个走查工人在真实资料库上点完 MCP「撤销接入」，接着 `python3 hid.py` 发 `Esc` + `Cmd+Q`，意图是退出 Nomi：

- 19:49:57 系统日志 `Claude[47512] Exiting exit handler` + loginwindow `appDeath com.anthropic.claudefordesktop`
- 这是**干净退出**，不是崩溃（DiagnosticReports 里没有任何报告）——所以现场没有崩溃日志可查，看起来像「闪退」
- macOS 19:50:05 自动重启 Claude；会话与当时在跑的三个后台 agent（J 块 / W-03 / MCP 点击）**全部断线**
- Nomi.app（pid 59238）**纹丝不动还在跑**——这就是反证：`Cmd+Q` 一次都没落到它身上

用户那一侧看到的只有「Claude 闪退了」。工人那一侧看到的是「我发了退出快捷键」。两边都没有任何一行日志把这两件事连起来。

## Why（结构原因，不是这一次手滑）

1. Quartz `CGEvent` 是**全局输入 API**：它往系统事件队列里塞一个按键，由 WindowServer 派发给**当前前台窗口**。API 签名里根本没有「目标应用」这个参数，所以调用方无从表达意图，也就无从出错提示。
2. 我们写下的走查规则是「真人路径 = 真鼠标真键盘」（见 [[tests-must-drive-ui-like-a-human]]），但这条规则**没有配套的前置检查**。规则本身完全正确——缺的是「在发出第一个事件之前先确认前台是谁」。
3. 因此这是一类问题：任何走查工人、在任何一轮、只要用全局 HID 驱动任何 App，都可能重蹈。修「这一次」没有意义，要修的是发事件之前那个缺失的闸。

## How to apply

1. **全局 HID 动作（点击 / 按键）之前必须确认前台应用是目标应用**：
   `osascript -e 'tell application "Nomi" to activate'`，再用 `System Events` 读 `frontmost` 校验，
   **不是目标就中止**。每一段动作之前都查一次，不是开头查一次就一路信到底——用户随时会切窗口。
2. **退出 / 关窗 / 删除类快捷键（`Cmd+Q` / `Cmd+W` / `Cmd+Delete`）永远不用全局键事件发。**
   退出走按应用名定向的 `osascript -e 'quit app "Nomi"'`，或直接 `kill` 你自己起的那个 pid；
   退出时如果弹「关闭 Nomi?」确认窗，`osascript quit` 不会替你过它，要再用**定向**点击。
3. 走查任务书模板里写死一句：**「Claude.app 是你自己的宿主；任何可能落到它身上的输入，都会同时杀掉你自己和同批工人。」**
4. 优先级顺序：能用页面级驱动（Playwright 在 Electron 窗口里点）就别用全局 HID——同一天的 J 块走查全程 Playwright 页面级驱动、零全局 HID，一次事故都没有。全局 HID 只留给「非它不可」的系统级弹层。

关联 [[tests-must-drive-ui-like-a-human]] [[think-structural-and-user-lens]] [[assert-you-are-in-the-situation-you-claim]]
