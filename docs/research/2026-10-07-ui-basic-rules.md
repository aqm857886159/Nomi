# Nomi UI 基本规则（草案 · 2026-10-07）

> 状态：**用户 10-07 对 §4 冲突点按推荐拍板 6 条，已写进设计系统 §1.9 / §1.8 与 `Design.md`**（见 §4 开头的「已拍板」表）；其余规则仍是草案。第一阶段（调研 + 普查）之后，第二阶段第一批「所有对话框 / 确认卡底栏」已做，结果见 §8。
> **方向（用户 10-07 补充）：规则重点放在「组件级的小规则」——图标放哪边、和文字怎么对齐、尺寸 / 描边是否统一、按钮内边距、顺序、禁用态、悬停 / 按下 / 焦点态、截断与 tooltip、弹层不压触发钮。不做布局结构、侧栏、页面重排这类大改，也不出整页样张。普查按组件（文件 / 控件族）出清单，每条违例直接定位到「改哪个组件的哪一处」。**
> 范围：和视觉风格无关、几家官方都认的基本规则（按钮顺序、破坏性操作、状态反馈、图标语义、点击目标 / 焦点 / 键盘 / 对比度、文案、间距 / 层级）。**不碰 Nomi 的风格**（色板、圆角、字体、密度都不动）。
> 规则正本是本文件；机器可数的那一半在 `scripts/census-ui-rules.mjs`（静态扫 `src/`）和 `tests/ux/ui-rules-census.dom.mjs`（设计实验室 DOM 普查），两个都是只读脚本，不是门岗。

## 0. 先说结论（给要快速拍板的人）

1. **整理出 36 条基本规则（UI-R01…R36）**；新补的 R32–R36 全是组件级小规则（图标位置 / 尺寸描边 / 按钮覆写 / 悬停态 / 图标与文字中线对齐）。能静态扫的 26 条、能在设计实验室 DOM 里量的 12 条、只能人工的 5 条（有交叉，见 §3 末表）。
2. **对话框按钮顺序，各家官方并不一致**：Apple 和 Material 把主动作放在**右**（行尾）、取消在它左边；微软（Win32 指南与 WinUI ContentDialog）正好相反，「do it」在**左**、取消在**右**。NN/g 的态度是「一致比最优重要，跟平台走」。Nomi 是 Windows + macOS 同一套自绘对话框，**只能选一个**。建议沿用你 10-06 已定的「主动作最右」（理由和代价见 §2）。
3. **和现有设计系统有 9 处冲突 / 缺口**（§4），其中最需要你定的三条：①「否定动作一律 ×」与「取消在主动作左边」打架；②「次动作一律 icon + hover 名字」在键盘 / 触屏上看不到名字；③「破坏性操作一律弹确认」与官方「能撤销就别弹确认」相反。
4. 普查数字、最典型的 3 处截图和修复优先级见 §5。

## 1. 官方来源（只认官方；没读到的单独写明）

编号在后文「各家怎么说」里引用。所有链接我在 2026-10-07 当天逐个打开读过正文（Apple 页面正文是脚本渲染的，我读的是它背后的官方 JSON 数据源 `developer.apple.com/tutorials/data/design/human-interface-guidelines/<页>.json`，内容与网页一致，下表给的是网页链接）。

| 编号 | 来源 | 链接 |
|---|---|---|
| A-alerts | Apple HIG · Alerts | https://developer.apple.com/design/human-interface-guidelines/alerts |
| A-buttons | Apple HIG · Buttons | https://developer.apple.com/design/human-interface-guidelines/buttons |
| A-menus | Apple HIG · Menus | https://developer.apple.com/design/human-interface-guidelines/menus |
| A-ctx | Apple HIG · Context menus | https://developer.apple.com/design/human-interface-guidelines/context-menus |
| A-toolbars | Apple HIG · Toolbars | https://developer.apple.com/design/human-interface-guidelines/toolbars |
| A-popovers | Apple HIG · Popovers | https://developer.apple.com/design/human-interface-guidelines/popovers |
| A-sheets | Apple HIG · Sheets | https://developer.apple.com/design/human-interface-guidelines/sheets |
| A-a11y | Apple HIG · Accessibility | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| A-kbd | Apple HIG · Keyboards | https://developer.apple.com/design/human-interface-guidelines/keyboards |
| A-focus | Apple HIG · Focus and selection | https://developer.apple.com/design/human-interface-guidelines/focus-and-selection |
| A-writing | Apple HIG · Writing | https://developer.apple.com/design/human-interface-guidelines/writing |
| A-feedback | Apple HIG · Feedback | https://developer.apple.com/design/human-interface-guidelines/feedback |
| A-loading | Apple HIG · Loading | https://developer.apple.com/design/human-interface-guidelines/loading |
| A-undo | Apple HIG · Undo and redo | https://developer.apple.com/design/human-interface-guidelines/undo-and-redo |
| A-help | Apple HIG · Offering help（tooltip） | https://developer.apple.com/design/human-interface-guidelines/offering-help |
| A-icons | Apple HIG · Icons | https://developer.apple.com/design/human-interface-guidelines/icons |
| A-symbols | Apple HIG · SF Symbols | https://developer.apple.com/design/human-interface-guidelines/sf-symbols |
| A-pointer | Apple HIG · Pointing devices | https://developer.apple.com/design/human-interface-guidelines/pointing-devices |
| A-rtl | Apple HIG · Right to left | https://developer.apple.com/design/human-interface-guidelines/right-to-left |
| M-dialogs | Material Design（1/2 代存档）· Dialogs | https://m1.material.io/components/dialogs.html |
| M-grid | Material Design（1/2 代存档）· Metrics & keylines | https://m1.material.io/layout/metrics-keylines.html |
| M-snack | Material Design（1/2 代存档）· Snackbars & toasts | https://m1.material.io/components/snackbars-toasts.html |
| M-web | Material Web（M3 官方组件库）· Dialog 文档 | https://github.com/material-components/material-web/blob/main/docs/components/dialog.md |
| M-android | Android 开发者 · 无障碍（含 48dp 点击目标、对比度、图标 contentDescription） | https://developer.android.com/guide/topics/ui/accessibility/apps |
| W-dialog | Microsoft · Windows 7 对话框（Win32 UX 指南） | https://learn.microsoft.com/en-us/windows/win32/uxguide/win-dialog-box |
| W-confirm | Microsoft · Confirmations（Win32 UX 指南） | https://learn.microsoft.com/en-us/windows/win32/uxguide/mess-confirm |
| W-cmd | Microsoft · Command buttons（Win32 UX 指南） | https://learn.microsoft.com/en-us/windows/win32/uxguide/ctrl-command-buttons |
| W-winui | Microsoft · Dialog controls（WinUI / 当前 Windows 应用指南） | https://learn.microsoft.com/en-us/windows/apps/design/controls/dialogs-and-flyouts/dialogs |
| W-kbd | Microsoft · Keyboard accessibility（Windows 应用） | https://learn.microsoft.com/en-us/windows/apps/design/accessibility/keyboard-accessibility |
| F-dialog | Microsoft Fluent 2 · Dialog（web / React） | https://fluent2.microsoft.design/components/web/react/core/dialog/usage |
| N-10 | NN/g · 10 Usability Heuristics | https://www.nngroup.com/articles/ten-usability-heuristics/ |
| N-confirm | NN/g · Confirmation dialogs | https://www.nngroup.com/articles/confirmation-dialog/ |
| N-tip | NN/g · Tooltip guidelines | https://www.nngroup.com/articles/tooltip-guidelines/ |
| N-empty | NN/g · Designing empty states | https://www.nngroup.com/articles/empty-state-interface-design/ |
| N-state | NN/g · Button states | https://www.nngroup.com/articles/button-states-communicate-interaction/ |
| N-icon | NN/g · Icon usability | https://www.nngroup.com/articles/icon-usability/ |
| N-okcancel | NN/g · OK/Cancel 还是 Cancel/OK | https://www.nngroup.com/articles/ok-cancel-or-cancel-ok/ |
| G-* | WCAG 2.2（W3C 推荐标准，AA 档） | https://www.w3.org/TR/WCAG22/ （条款锚点见各规则；2.5.8 / 1.4.13 / 2.4.3 另读了 Understanding 页 https://www.w3.org/WAI/WCAG22/Understanding/） |

**没查到 / 读不出来的（诚实标注）**
- **Material Design 3 站点（m3.material.io）正文是脚本渲染的，我的抓取工具只读得到页面标题**，所以 M3 的原文我没读到。Material 的口径我用的是：1/2 代官方存档（上表 M-dialogs / M-grid / M-snack，M3 的对话框操作区沿用同一约定，但这一句是我的推断，**没有 M3 原文佐证**）、M3 官方组件库 Material Web 的文档（M-web，没写按钮顺序）、Android 官方无障碍文档（M-android）。
- **Fluent 2（F-dialog）读到了，但它没有规定按钮顺序**——只说页脚「最多三个操作」「模态对话框可 Esc / 点外面 / 页脚按钮关闭，警示对话框只能点页脚按钮关」。微软对按钮顺序的明确规定在 Win32 指南和 WinUI 页（W-dialog / W-winui）。
- **中英文混排的空格**：Apple / Microsoft / Google 的官方指南我没查到「中文与英文 / 数字之间要不要加空格」的统一规定（各家中文本地化风格指南各自写，我没逐个读到），所以 UI-R21 只按「全仓一致」来判，不声称有官方依据。
- **「更多」图标用横三点还是竖三点**：没查到官方强制。NN/g（N-icon）只说「少数几个图标有通用含义，更多图标含义因平台不同」，所以 UI-R19 的依据是「一个语义一个图标」的一致性原则，不是某家规定了用哪一个。

## 2. 最需要先定的一件事：对话框按钮顺序

各家原话（节选，出处见 §1）：

| 来源 | 怎么说 | 主动作在 | 取消在 |
|---|---|---|---|
| Apple（A-alerts） | 「Always place the default button on the trailing side of a row or at the top of a stack. Cancel buttons are typically on the leading side of a row」 | 行尾（LTR 里是右） | 行首 |
| Apple 工具栏（A-toolbars） | 「Only specify one primary action, and put it on the trailing side of the toolbar」 | 行尾 | — |
| Material 1/2（M-dialogs） | 「Affirmative actions are placed on the right side… Dismissive actions are placed directly to the left of affirmative actions」 | 右 | 紧挨主动作的左边 |
| Microsoft Win32 指南（W-dialog） | 提交按钮顺序「1. OK/[Do it]/Yes 2. [Don't do it]/No 3. Cancel 4. Apply 5. Help」，且「Right-align commit buttons in a single row」 | 最左（在这一排里 OK 排第一） | 靠右 |
| Microsoft WinUI（W-winui） | 「The "do it" action button(s) should appear as the leftmost buttons. The safe, nondestructive action should appear as the rightmost button.」 | 最左 | 最右 |
| Fluent 2（F-dialog） | 没规定顺序，只规定页脚最多三个操作 | — | — |
| NN/g（N-okcancel） | 「Do what the platform owner tells you to do」；强调一致比最优重要；对网页应用它当年建议 OK 在前 | 看平台 | 看平台 |

**读法**：Apple 和 Material 同一边（主动作在行尾 / 右），微软在另一边；这是 Windows 和 macOS 长期的真实分歧，不是谁记错。NN/g 的原则是**别在同一个产品里混用**。

**给 Nomi 的选择依据**
- Nomi 的对话框是**自绘的同一套组件**（`confirmDialog` / `DesignModal` / 卡片内决定栏），不是系统原生对话框，Windows 和 macOS 用户看到的是同一个界面。同一个组件跟平台换顺序，等于每个对话框都要写两种布局、截图 / 走查翻倍，而且同一台机器上的用户（Windows 用户用 macOS 截图的教程）会看到两种。
- 你 10-06 已拍板「主动作最右、取消在它左边」，和 Apple + Material 一致。
- 代价：习惯微软顺序的 Windows 用户会觉得反。缓解：主动作用实心 / 深色填充（Apple「主动作视觉最突出」）、回车 = 主动作、Esc = 取消（这两条各家都认，见 UI-R29），这样顺序错位的伤害最小。
- **建议：全产品固定「主动作最右、取消紧挨它左边」，不跟平台换。**（待你确认。）

## 3. 规则清单

> 读法：**一句话规则 · 各家怎么说（来源编号）· 为什么 · 自动检查方式**。
> 「自动检查」三种：**静态**＝`scripts/census-ui-rules.mjs`；**DOM**＝`tests/ux/ui-rules-census.dom.mjs`（设计实验室全部格）；**人工**＝只能人看（走查 / 样张评审 / 真 App）。

### A. 按钮顺序与主次

**UI-R01 决定栏：主动作在最右，取消紧挨它左边。**
各家：Apple 与 Material 如 §2；微软相反；NN/g 要求一致（A-alerts、M-dialogs、W-winui、N-okcancel）。
为什么：用户靠位置而不是读字来决定，同一产品里位置必须可预期（N-10 第 4 条「一致性与标准」）。
检查：静态（同一容器里取消类按钮出现在主动作之后）+ DOM（同一行里取消按钮在实心按钮右边）。

**UI-R02 「取消」只叫「取消 / Cancel」（可带宾语，如「取消录制」），不叫「不要 / 不用 / 算了 / No」。**
各家：Apple「Always use "Cancel" to title a button that cancels the alert's action」（A-alerts）；微软「Use Cancel or Close for negative commit buttons instead of specific responses」「Don't rename the Cancel button if the meaning of cancel is unambiguous」（W-dialog、W-cmd）；Apple 另说信息型提示才可用 OK，避免 Yes / No（A-alerts）。
为什么：用户不必读完所有按钮就能找到「安全出口」。
检查：静态（i18n 里 cancel / dismiss / decline 类键的文案分布）。

**UI-R03 动作条里常用动作在左，删除类固定在最右并和其它动作隔开；决定栏里删除放最左并隔开，不夹在取消和主动作之间。**（10-07 落地口径：普查只抓「夹在中间」。）
各家：Apple 上下文菜单「list them at the end of the menu and identify them as destructive」（A-ctx，注明仅 iOS / iPadOS / visionOS）；微软「physically separate destructive commands from other commands」（W-confirm「Prevent errors」）；Apple 工具栏「Group toolbar items logically by function and frequency of use」（A-toolbars）。
为什么：危险动作放在固定、远离高频动作的位置，减少误点。
检查：静态（同一容器里删除类按钮后面还有别的按钮）+ DOM（同一行里删除按钮右边还有按钮）。「隔开」的距离只能人工。

**UI-R04 ✓（对勾）只表示「状态 / 已选 / 已完成」，不当「动作」按钮的图标。**
各家：Apple 菜单「use a checkmark to show that an attribute is currently in effect」（A-menus）；NN/g「图标要有文字，含义不通用的图标会歧义」（N-icon）；微软「Avoid combining text labels and graphics… cancel graphic adds nothing」（W-cmd）。
为什么：对勾同时被读成「已经好了」和「点我确认」，位置还常在文字左边，用户用来判断「现在是什么状态」的信号被拿去当按钮。
检查：静态（可点击控件里无条件出现的 IconCheck 系）+ DOM（按钮里的 check 图标，标出在文字左边的）。

**UI-R26 主动作写具体动词（「保存」「删除这张」），不写泛词「确认 / 确定 / OK」。**
各家：Apple「Avoid using OK as the default button title unless the alert is purely informational」「Prefer verbs and verb phrases that relate directly to the alert text」（A-alerts）；微软「Use specific responses to the main instruction…」（W-dialog、W-winui）；NN/g「Delete file / Keep file」（N-confirm）；Apple Writing「almost always best to use a verb」（A-writing）。注意：微软对**确认类**对话框有一个反向例外——故意用 Yes/No 逼用户读问题（W-confirm）；Nomi 的确认卡如果要用泛词，必须是这种「逼读」的理由，而不是偷懒。
检查：静态（按钮文案是 `common.confirm` / 「确认」「确定」「OK」）。

**UI-R27 一屏（一张卡）只有一个主动作。**
各家：Apple「Assign the primary role to the button people are most likely to choose」「Only specify one primary action」（A-buttons、A-toolbars）；微软「Only one command button in a window can be the default」（W-cmd）。Nomi 现有 §1.8 规则 1 已写。
检查：人工（构图判断，AST / DOM 判不出「重」）。

### B. 破坏性操作

**UI-R28 能撤销的用撤销（撤销 toast），不能撤销、代价大的才弹确认；确认框写清后果，主动作不要设成默认。**
各家：微软「Provide undo… deleting a file usually doesn't require a confirmation because deleted files can be recovered」「Unnecessary confirmations are annoying」（W-confirm）；NN/g「Reserve confirmation dialogs for actions with serious consequences… pair with undo」（N-confirm）；Apple「Warn people when they initiate a task that can cause data loss that's unexpected and irreversible. In contrast, don't warn people when data loss is the expected result」（A-feedback）；Apple「Don't assign the primary role to a button that performs a destructive action」（A-buttons）；微软「Don't make a destructive action the default command button unless there is an easy way to undo」（W-cmd）；Material 对话框「Delete this conversation?」这类具体问句 + 按钮写结果（M-dialogs）；Apple 撤销要「描述结果并让结果可见」（A-undo）。
为什么：确认框对低风险动作是噪音，用户学会不读；撤销对所有动作都安全。
检查：人工（判断「这个删除能不能撤销」）+ 静态 UI-R05（禁用原生 confirm）辅助。

**UI-R05 禁用原生 `window.confirm / alert / prompt`。**
各家：**没有官方条文直接规定**（微软只说用 ContentDialog、别用旧的 MessageDialog，W-winui）；这是 Nomi 自己的工程纪律（设计系统 §3.5，原因：脱离设计系统、E2E 测不到、Electron 下焦点丢失史）。
检查：静态。

### C. 状态反馈

**UI-R06 禁用的控件要让人知道为什么；而且这个「为什么」键盘和触屏也能读到（不能只靠 `title` 悬停）。**
各家：NN/g「Tooltips that appear only on mouse hover are inaccessible for users that rely on keyboards」（N-tip）；WCAG 1.4.13 内容悬停 / 聚焦须可关闭、可悬停、持久（G-1.4.13）；Apple 菜单「Show people when a menu item is unavailable」（A-menus，灰显而不是消失）；Apple「Show people when a command can't be carried out and help them understand why」（A-feedback）；NN/g 禁用态要视觉上可区分，且加 `aria-disabled`（N-state）；微软 Win7 指南反过来倾向「Don't disable commit buttons」而用报错说明（W-dialog，除少数例外）。
检查：静态（禁用按钮没有 title / 说明）+ DOM（渲染出来的禁用控件没有 title / aria-describedby / 带 title 的祖先）。

**UI-R30 异步动作要有忙态（点了立刻看到在做事）、结果要在原地告诉用户。**
各家：微软「Display a busy pointer if the result of clicking a command button isn't instantaneous. Without feedback, users might assume that the click didn't happen」（W-cmd）；Apple「Always include a press state… Without a press state, a button can feel unresponsive」（A-buttons）；Apple「Show something as soon as possible」（A-loading）；Apple 状态反馈「near the items it describes」「confirm significant tasks」（A-feedback）；N-10 第 1 条；WCAG 4.1.3 状态消息要能被辅助技术读到（G-4.1.3）；Apple 错误信息「display it as close to the problem as possible, avoid blame, and be clear about what someone can do」（A-writing）。
检查：人工（Nomi 已有 `loading` 属性与 §4.5 通知策略）；静态可查「忙态是否自动禁用」，Nomi 已在设计实验室里断言。

**UI-R31 空状态要说清「现在什么情况」并给一个下一步。**
各家：NN/g 三条——说明系统状态、给学习线索、给直达关键任务的入口（N-empty）。
检查：人工（设计实验室样张评审）。

### D. 图标语义

**UI-R19 同一个语义全仓一个图标（更多 / 关闭 / 删除 / 添加 / 设置 / 复制 / 编辑 / 刷新 / 下载 / 收藏）。**
各家：NN/g「icons carry inconsistent meanings across platforms… prevents users from reliably interpreting icons」（N-icon）；N-10 第 4 条一致性；WCAG 3.2.4「Components that have the same functionality are identified consistently」（G-3.2.4）。
通用含义（官方明确说了的只有这些）：✓ = 当前生效 / 已选（A-menus）；✕ = 关闭 / 取消（W-cmd 例子里 X 图标作取消的图形）；垃圾桶 = 删除；其余（图钉、星标、更多）NN/g 明确说**不通用**，必须配文字或 tooltip（N-icon）。
检查：静态（家族统计 + 少数派用法清单）；`check:icon-semantics` 门岗已经管「同一 i18n key 两个图标」，本规则管「同一语义不同 key」。

**UI-R07 纯图标按钮必须有可读名字（aria-label / title / label），且名字在键盘聚焦时也能出现。**
各家：WCAG 1.1.1 非文本内容有文本替代（G-1.1.1）、4.1.2 名称 / 角色 / 值；Android「Always include contentDescription… purpose and result」（M-android）；微软「Label every command button… graphic label only → assign its Name property」（W-cmd）；NN/g 图标要配可见文字（N-icon）。
检查：静态 + DOM（交互控件算不出名字）。

### E. 点击目标 / 焦点 / 键盘 / 对比度

**UI-R10 点击目标不小于 24×24 CSS px（WCAG 2.2 AA 底线）；Nomi 目标值 ≥28（macOS 默认控件 28）。**
各家：WCAG 2.5.8「at least 24 by 24 CSS pixels」，例外：间距够（24px 圆不与别的目标相交）、行内、等效控件、用户代理控件、必要（G-2.5.8）；Apple macOS 最小 20×20 pt、默认 28×28 pt，触屏 44×44（A-a11y、A-buttons）；Material 触屏 48×48dp、控件间 ≥8dp（M-grid、M-android；我没读到 Material 对桌面端点击目标的数字，不引用）。
Nomi 是桌面 + 鼠标为主，所以 24 是底线（AA）、28 是目标；触屏 / 触控笔不是目前的目标设备（若将来要，44 / 48）。
检查：DOM（量渲染后矩形，带 WCAG 的间距例外）+ 静态（className 里写死的小尺寸，候选）。

**UI-R09 焦点要看得见：键盘聚焦必须有可见指示；不许在组件上摘掉焦点环。**
各家：WCAG 2.4.7 焦点可见（G-2.4.7）、2.4.11 焦点不被完全遮住（G-2.4.11）；Apple「The halo focus effect — also known as the focus ring」「Rely on system-provided focus effects」（A-focus）；微软「Any focusable custom control should expose a clear visual focus indicator」（W-kbd）；NN/g 按钮状态里的 focus（N-state）。
检查：静态（`outline-none` 且同串里没有 `focus-visible:` 替代）+ DOM（真 Tab 走前 10 站，聚焦前后自身及 3 层祖先的 outline / 阴影 / 边框 / 背景都没变就记一条）。

**UI-R08 鼠标能点的，键盘必须能到、能触发；不要给 div / span 裸挂 onClick。**
各家：WCAG 2.1.1 键盘（G-2.1.1）、2.1.2 无键盘陷阱（G-2.1.2）；微软「Any UI that can be activated by pointer should also be invokable by keyboard… instead of handling pointer input directly on an Image, place it inside a Button」（W-kbd）；Apple「Support Full Keyboard Access」（A-kbd）。
检查：静态（div/span/li/img/svg 上有 onClick 且没有 role + tabIndex）。

**UI-R29 键盘约定：Esc = 取消 / 关闭；回车 = 主动作；Tab 顺序 = 阅读顺序（左→右、上→下）；打开浮层时焦点进去、关闭后回到触发处。**
各家：Apple Esc「Cancel the current action or process」（A-kbd）；Apple 主按钮响应 Return（A-buttons）；微软 Esc 关闭 / 回车默认按钮、「tab order should flow in a logical order, generally from left to right, top to bottom」（W-winui、W-dialog）；WCAG 2.4.3 焦点顺序（G-2.4.3）；Material Web「Focus trapping is recommended」「dialogs can be dismissed by clicking the scrim or pressing Escape」（M-web）；Fluent 2 模态可 Esc / 点外面关，警示对话框只能点页脚按钮关（F-dialog）。
检查：人工（真 App 键盘走查）；设计实验室的静态样张量不到交互。

**UI-R23 文字对比度 ≥ 4.5:1（大字 ≥ 3:1）；非文本控件边界 / 图标 ≥ 3:1。**
各家：WCAG 1.4.3「4.5:1, large text 3:1」、1.4.11「UI components and graphical objects 3:1」（G-1.4.3、G-1.4.11）；Apple 对照 WCAG AA 的同一张表（A-a11y）；Android「4.5:1 / 3:1」（M-android）；Apple / WCAG 1.4.1「不要只靠颜色传达信息」（A-a11y、G-1.4.1）。
检查：DOM（逐文字节点：前景色 × 不透明度链 × 逐层合成背景色，渐变 / 图片背景跳过不报）。非文本对比度（1.4.11）这一轮没量，列在 §6。

**UI-R24 字号不低于 11px（Nomi token `micro`）；正文类 ≥12px。**
各家：这一条**没查到官方硬数字**——WCAG 不规定最小字号（只规定缩放 200% 不失能，G-1.4.4）；Apple 的最小字号在排版页（我没读该页）。所以这是 Nomi 自己的底线（设计系统已有 `micro=11` / feel 门岗 12px 可读下限），这里只量「低于 token 最小档」的。
检查：DOM（计算字号）。

**UI-R25 弹层不盖住触发它的按钮 / 它所在的那一排工具条，整块在窗口里。**
各家：Apple「Ideally, a popover doesn't cover the element that revealed it」（A-popovers）；WCAG 2.4.11（G-2.4.11）。
检查：**现成** `tests/ux/design-lab/popupGeometry.census.mjs`（2026-10-06 已立，本次不重做，直接引用它的结果）。

### F. 文字

**UI-R16 被截断的文字，用户必须有办法看到全文（title / tooltip / 展开），且键盘聚焦也能触发；tooltip 只放辅助信息，不放必须读的。**
各家：NN/g「Users shouldn't need to find a tooltip in order to complete their task」「be consistent and provide tooltips for all the elements」（N-tip）；Apple tooltip：说明控件做什么、60–75 字以内、不重复控件名、句首大写、省略句末标点（A-help）；WCAG 1.4.13（G-1.4.13）。
检查：静态（truncate / line-clamp 且 8 层内没有 title / Tooltip）+ DOM（真被截断且没有 title）。

**UI-R20 省略号写「…」不写「...」；带「…」的按钮 / 菜单项表示「还要你提供信息才能做」；按钮这类短标签不带句末标点。**
各家：Apple 菜单「Append an ellipsis… when the action requires more information… The ellipsis character (…)」（A-menus）；微软「Indicate a command that needs additional information by adding an ellipsis… Use an ellipsis only when additional information is required… Don't use ending punctuation」（W-cmd）。
检查：静态（i18n 里的 `...`、短标签的句末标点）。

**UI-R22 同类 UI 文案大小写一个风格。**
各家：Apple 菜单用 Title Case（A-menus），Apple tooltip 用句首大写（A-help），Apple Writing 说「选一个风格、每类控件用一致」（A-writing）；微软按钮用句首大写（W-cmd）。**各家自己在不同控件上就不一致**，所以规则只能是「Nomi 自己选一种、全仓一致」。（建议英文按钮 / 菜单 / 标题统一句首大写，与微软按钮规范、Apple tooltip 相同，也最省事；这是建议，不是官方强制。）
检查：静态（i18n 短标签里 Title Case 的）。

**UI-R21 中文与英文 / 数字之间要不要空格：全仓一个写法。**
各家：没查到官方统一规定（见 §1）。当前 Nomi 文案绝大多数写成「AI 拼片」带空格，规则按多数派定。
检查：静态（i18n 里少数派写法）。

### G. 间距、层级、一致

**UI-R13 间距只用 4 的倍数 token，不写魔法数。**
各家：Material「All components align to an 8dp square baseline grid… typography and iconography 4dp」（M-grid）；Apple 控件间留白 12pt / 24pt 的建议（A-a11y、A-pointer）。设计系统 §2.2 已定。
检查：静态（arbitrary 值里不是 4 的倍数的）+ DOM（flex / grid 的 gap 不是 4 的倍数，信息档）。

**UI-R14 字号只走 token。**　**UI-R15 颜色只走 token。**　**UI-R12 z-index 只走 `NOMI_OVERLAY_Z_INDEX`。**
（设计系统 §2.0 / §2.1 / §2.3 已定，没有官方「应该这样」的条文，这是 Nomi 自己的工程纪律；列在这里是为了普查一次它们现在的实情。）
检查：静态。

**UI-R11 同类控件全仓一个组件（按钮、下拉、复选 / 单选）；同一个标签（「取消」「保存」「删除」）在不同面上长得一样。**
各家：N-10 第 4 条；微软「If the same command button appears in more than one window, try to use the same label text and access key, and locate it in approximately the same place in each window」（W-cmd）；WCAG 3.2.4（G-3.2.4）。
检查：静态（散装 `<button>` / `<select>` / checkbox 数）+ DOM（同一个短标签在不同格里出现 ≥2 种外观指纹：高度 / 圆角 / 背景 / 字色 / 字号 / 字重 / 描边）。

**UI-R17 图片要有 alt。**　**UI-R18 对话框要有名字（aria-label / aria-labelledby）。**
各家：WCAG 1.1.1；Material Web「Dialogs are labelled by their headlines. Add an aria-label attribute to dialogs without a headline」（M-web）。
检查：静态 + DOM（对话框算不出名字）。

### H. 图标与按钮的组件级小规则（用户 10-07 补充的重点）

**UI-R32 按钮里的图标统一放文字左边；右边只留「结构性」图标（下拉箭头、箭头、外链、展开）。同一类按钮图标位置一致。**
各家：**没查到官方规定图标该在文字左还是右**（Apple 的 SF Symbols / Icons 页讲权重、对齐、一致，没讲位置；微软只说「Avoid combining text labels and graphics… prefer text, but use either text or graphics」，W-cmd）。所以这条是 Nomi 自己的约定，依据是 N-10 第 4 条「一致性」：同一族按钮图标位置不一致，用户每遇到一个都要重新读一遍。设计系统现状：`WorkbenchButton` 的 `[&>svg]` 默认 16px 就是为「图标在左」设计的。
检查：静态（非结构图标出现在文字之后或 `rightSection`）+ DOM（渲染后图标中心在文字中心右边、且不是 chevron / arrow / external / dots 类）。

**UI-R33 图标尺寸、描边走登记档位，同一场景同一档；不用 `strokeWidth`。**
各家：Apple「all interface icons in your app need to use a consistent size, level of detail, stroke thickness (or weight)」「match the weights of interface icons and adjacent text」（A-icons）；Apple SF Symbols 的尺寸 / 权重跟相邻文字走（A-symbols）。Nomi 设计系统 §6 已登记：16/stroke 2（工作区按钮）、13/1.8（角标）、18/1.5-1.6（工具栏）、24-32/1.5（大图标），并禁 13.5 / 17 这类非标准。
检查：静态（`size` 不在 12/13/14/16/18/20/24/28/32；`stroke` 不在 1.5/1.6/1.8/1.9/2；`strokeWidth`）+ DOM（按钮里 svg 实际渲染尺寸 / 描边分布）。

**UI-R34 按钮不自己覆写尺寸 / 圆角 / 内边距，走 `variant` + `size`。**
各家：微软「use a minimum button width and the standard command button height… Don't use narrow, short, or tall command buttons… Try to work with the default widths and heights」（W-cmd）；N-10 第 4 条。设计系统 `actions.tsx` 注释已把「各处 ad-hoc className 各覆写一套」认定为「明显不是一个设计风格」的根因。
检查：静态（`WorkbenchButton` / `DesignButton` / `Button` 的 className 里有 `h-` / `px-` / `py-` / `rounded-`）。

**UI-R35 自己画的按钮要有悬停态（和按下 / 焦点 / 禁用态）。**
各家：NN/g 按钮五态：enabled / hover / focus / disabled / pressed，缺哪个用户都会怀疑「点上了吗」（N-state）；Apple「Always include a press state for a custom button. Without a press state, a button can feel unresponsive」（A-buttons）；Apple 指针「hover effect」（A-pointer）。
检查：静态（散装 `<button>` 的 className 里没有 `hover:` / `active:`；仅为候选，有的靠父级 `group-hover` 或全局样式）。

**UI-R36 图标和文字在垂直方向对齐到同一条中线（偏差 ≤1.5px）。**
各家：Apple「automatically aligning with text in all weights and sizes」「add padding to a custom interface icon to achieve optical alignment… adjustments are typically very small, but they can have a big impact」（A-symbols、A-icons）。「1.5px」是我定的容差，不是官方数字。
检查：DOM（按钮里图标矩形中心与文字矩形中心的垂直差）。

### 规则一览与检查方式

| 规则 | 一句话 | 静态 | DOM | 人工 |
|---|---|:-:|:-:|:-:|
| UI-R01 | 决定栏顺序 | ✓ | ✓ | |
| UI-R02 | 取消只有一种说法 | ✓ | | |
| UI-R03 | 删除类固定最右 | ✓ | ✓ | 隔开的距离 |
| UI-R04 | ✓ 只表状态 | ✓ | ✓ | |
| UI-R05 | 禁用原生对话框 | ✓ | | |
| UI-R06 | 禁用要说明原因 | ✓ | ✓ | |
| UI-R07 | 纯图标按钮有名字 | ✓ | ✓ | |
| UI-R08 | 能点的键盘到得了 | ✓ | | |
| UI-R09 | 焦点环可见 | ✓ | ✓ | |
| UI-R10 | 点击目标 ≥24 | ✓（候选） | ✓ | |
| UI-R11 | 同类控件一个组件 / 同标签同外观 | ✓ | ✓ | |
| UI-R12 | z-index 走 token | ✓ | | |
| UI-R13 | 间距 4 的倍数 | ✓ | ✓（信息档） | |
| UI-R14 | 字号走 token | ✓ | | |
| UI-R15 | 颜色走 token | ✓ | | |
| UI-R16 | 截断要能看全文 | ✓ | ✓ | |
| UI-R17 | 图片有 alt | ✓ | | |
| UI-R18 | 对话框有名字 | ✓ | ✓ | |
| UI-R19 | 同语义一图标 | ✓ | | 盲测 |
| UI-R20 | 省略号 / 标点 | ✓ | | |
| UI-R21 | 中英空格一致 | ✓ | | |
| UI-R22 | 英文大小写一致 | ✓ | | |
| UI-R23 | 文字对比度 | | ✓ | 非文本对比度 |
| UI-R24 | 最小字号 | | ✓ | |
| UI-R25 | 弹层不盖触发钮 | | ✓（已有普查） | |
| UI-R26 | 主动作写具体动词 | ✓ | | |
| UI-R27 | 一屏一个主动作 | | | ✓ |
| UI-R28 | 先撤销后确认 | （R05 辅助） | | ✓ |
| UI-R29 | Esc / 回车 / Tab 顺序 | | | ✓（真 App） |
| UI-R30 | 忙态与结果反馈 | | | ✓ |
| UI-R31 | 空状态有下一步 | | | ✓ |
| UI-R32 | 图标在文字左边 | ✓ | ✓ | |
| UI-R33 | 图标尺寸 / 描边走档位 | ✓ | ✓（分布） | |
| UI-R34 | 按钮不自己覆写尺寸 | ✓ | | |
| UI-R35 | 自绘按钮有悬停态 | ✓（候选） | | |
| UI-R36 | 图标与文字中线对齐 | | ✓ | |

## 4. 和现有设计系统（`docs/design/nomi-design-system.md`、`Design.md`）冲突 / 缺口的地方

> 下面是第一阶段列的冲突点。**用户 10-07 已按推荐拍板其中 6 条，并已落进文档：**
>
> | 拍板 | 落在哪 |
> |---|---|
> | ① 标题栏 × 只关窗口，决定栏必须有文字「取消」放主动作左边（= C1） | 设计系统 §1.8 规则 4、§1.8.2 表、新 §1.9.1 |
> | ② 纯图标按钮键盘聚焦时也显示名字（= C2） | §1.8 规则 2 补充 |
> | ③ 能撤销的不弹确认、给撤销提示，不可逆或花钱的才弹（= C4） | 新 §1.9.2、§3.5（**行为未改**，候选清单见 §7） |
> | ④ 主动作仍在最右，不跟微软 | §1.9.1 第一行 |
> | ⑤ `Design.md`「Light-only」改成光 / 暗双模式（= C6） | `Design.md` Principles |
> | ⑥ 最小点击目标 24px（= C9） | 新 §1.9.3 |
>
> 未拍板、仍待定：C3（禁用说明改成可聚焦原因）、C5（「确认」词）、C7（间距半档）、C8（文本框焦点）。以下原文保留当时的分析。

**C1 · §1.8 规则 4「拒绝 / 取消 / 关闭 / 丢弃一律 ×，或统一的次按钮样式」+ §1.8.2 正例「弹窗右上角一个 × 收掉所有否定路径」 与 你 10-06 的「取消在主动作左边」打架。**
官方：Apple「Always use the title "Cancel"」（A-alerts）；微软「Use Cancel or Close for negative commit buttons」（W-dialog）；Apple 弹出层「Use a Close button for confirmation and guidance only」（A-popovers）。
建议：**两件事分开**——标题栏右上角 × = 「关掉这个窗口、不做决定」（等同 Esc）；决定栏里有主动作时必须有文字「取消」，在主动作左边。规则 4 改成「否定动作只有两种画法：标题栏 ×（无决定）和决定栏文字『取消』（有决定）」。

**C2 · §1.8 规则 1/2「次动作 / 工具动作一律 icon + hover 名字」。**
官方：NN/g「A text label must be present alongside an icon… avoid relying on hover effects, especially for touch devices」（N-icon）；NN/g tooltip 在键盘上必须也出现（N-tip）；WCAG 1.4.13；Apple 工具栏倾向符号但要求有 tooltip / 名字（A-toolbars）。
Nomi 的取舍（有公认图形的才用 icon）和 Apple 工具栏一致，没问题；缺口是**没有要求 tooltip 键盘聚焦也要出现**。
建议：保留规则，**补一条「icon-only 控件的名字必须同时在键盘聚焦时出现」**（并入 UI-R07）。

**C3 · §1.6 C1 / C4「禁用并用 `title` 说明」的写法（`<span title>` 包一层）。**
官方：NN/g 与 WCAG 1.4.13：只靠悬停的提示键盘 / 触屏看不到；禁用的 `<button>` 本来就不触发 title（设计系统自己也写了）。
建议：禁用说明改成**可聚焦的原因**（`aria-disabled` + 就近可见 hint 文字，或 tooltip 可由聚焦触发），而不是 `disabled` + 悬停 `title`。C4 目前「没做成硬门」，DOM 普查可以做成软提示。

**C4 · §3.5「破坏性操作确认一律用 confirmDialog」 vs 官方「能撤销就别确认」。**
官方：微软 W-confirm、NN/g N-confirm、Apple A-feedback 三家一致：可撤销的不要弹确认，用撤销；确认留给不可逆 / 高代价。设计系统自己 §5.4 / §4.5 已有撤销 toast，但 §3.5 没写「先撤销后确认」的分流。
建议：加分流规则（UI-R28）：可撤销 → 撤销 toast；不可撤销 / 花钱 / 影响面大 → 确认框，确认框写后果、主动作不是默认。

**C5 · §1.8 词表把「确认」定为规范词；官方鼓励具体动词。**
官方：Apple A-alerts / 微软 W-dialog：用具体回应，别用 OK / 确认（微软确认类对话框有「故意用 Yes/No 逼读」的例外）。
建议：`确认` 保留为「对一个已经读过的东西点头」（例如花钱确认卡），其它场景要求具体动词（UI-R26 的 10 处清单可作为首批）。

**C6 · `Design.md` 写「Light-only」，而 `CLAUDE.md` 和设计系统 §2.1.2 都在讲光 / 暗双模式。**
这是文档之间的内部矛盾，不是官方规则问题；影响对比度检查要不要按两套主题各量一遍。普查这轮只量了 light（实验室默认），暗色没量。

**C7 · §2.2「Tailwind 标准 spacing 已经是 4 的倍数（`p-1`=4px、`gap-3`=12px）」不完全对。**
`gap-1.5`=6px、`gap-0.5`=2px、`p-2.5`=10px 都不是 4 的倍数；`WorkbenchButton` 自己就用 `gap-1.5`，DOM 普查里 6px 的 gap 一格就能数出上百处。Material 的口径是「组件 8dp 网格、图标 / 文字 4dp」。
建议：明确写「允许半档（2 / 6 / 10px）还是禁止」，我倾向允许 2、6、10（半档）并在普查里降级为信息档。待你定。

**C8 · §8 焦点环：文本类控件「鼠标与键盘聚焦一致，不出外圈 outline，只改已有边框色」；无边框编辑器「保留插入光标，不强行加框」。**
WCAG 2.4.7 要求「键盘焦点指示可见」；文本框只靠边框换色是否算「足够可见」要看对比度（WCAG 2.4.13「焦点外观」要求焦点指示面积 ≥ 未聚焦控件 2px 周长、且聚焦 / 未聚焦像素对比 ≥3:1，但它是 AAA 档，不在 AA 底线里），无边框编辑器只靠光标是否算指示，**WCAG 条文本身没有给定论，我没查到官方明确答案**——标注为「待人工判断」，不下结论。DOM 焦点普查会把「聚焦前后样式无变化」的候选列出来供人看。

**C9 · 设计系统没有任何「最小点击目标」条文。**
WCAG 2.5.8（24px，AA）是硬底线。`WorkbenchIconButton` sm = 28px（`size-7`）、md = 32px，都过；违例来自散装控件（见普查）。
建议：在 §1.5 或 §1.8 加一行「点击目标 ≥24，目标 ≥28」。

另外两条**不是冲突、只是发现**：
- 设计系统 §6「语义图标登记」目前只覆盖「同一 i18n key 配两个图标」，不覆盖「同一语义不同 key」（UI-R19 补这一层）。
- §4.5 toast：Material 的 snackbar 规定「只一个操作、不能是 Dismiss / Cancel、不放图标」（M-snack），Nomi 的 toast 有语义图标——这是风格差异，不是基本规则，不建议动。

## 5. 全仓普查结果与修复优先级

### 5.1 怎么跑的、跑了多少

| 普查 | 范围 | 结果文件 |
|---|---|---|
| 静态 `node scripts/census-ui-rules.mjs` | `src/` 下 1460 个 ts/tsx（458 个 tsx，不含设计实验室夹具与测试）+ 12530 条 i18n 文案 | `docs/research/2026-10-07-ui-rules-census-shots/static-report.json`（含 `byComponent`：按文件归拢） |
| DOM `node tests/ux/ui-rules-census.dom.mjs` | 设计实验室 22 屏 **343 格**，3031 个交互控件，亮色；**跳过** `director-3dbox` / `director-refine` 两屏（3D 画面，格内几乎没有控件，渲染很慢），0 格渲染失败 | `…/dom-report.json` |
| 已有 `popupGeometry.census.mjs`（UI-R25） | 74 个整屏截图格 | **0 条违例**（弹层没有压住触发钮 / 工具条、都在窗口内） |
| 取证截图 `node tests/ux/ui-rules-census.shots.mjs` | 每条规则命中最多的 3 个格，红框圈出 | `docs/research/2026-10-07-ui-rules-census-shots/`（31 张 + `index.json`） |

**怎么用来定位「改哪个组件」**：`node scripts/census-ui-rules.mjs --by-component` 按文件排序；`--component StoryboardShotRow` 列出某个组件里所有命中；`--list UI-R04` 列出某条规则全部 `文件:行号`。DOM 报告里每条命中带格 id + 渲染后矩形 + 文字，截图里红框就是那一处。

### 5.2 违例数一览

静态（启发式、会有误报；合计 1943 处，其中 R11「散装 button」605 处是系统性存量，不当单项缺陷）：

| 规则 | 处 | 文件 | | 规则 | 处 | 文件 |
|---|--:|--:|---|---|--:|--:|
| R01 取消在主动作右边 | 10 | 9 | | R15 写死颜色 | 2 | 2 |
| R02 取消的非标准说法 | 21 | 5 | | R16 截断没全文（候选） | 185 | 98 |
| R03 删除后面还有按钮 | 7 | 7 | | R17 img 没 alt | 0 | 0 |
| R04 ✓ 当动作 | 9 | 9 | | R18 对话框没名字 | 2 | 2 |
| R05 原生 confirm | 1 | 1 | | R19 同语义不同图标 | 5 | 5 |
| R06 禁用没说明 | 77 | 46 | | R20 省略号 / 句末标点 | 74 | 11 |
| R07 纯图标钮没名字 | 2 | 2 | | R21 中英空格少数派 | 73 | 10 |
| R08 键盘到不了 | 11 | 9 | | R22 英文 Title Case | 44 | 13 |
| R09 摘掉焦点环 | 34 | 28 | | R26 主动作写「确认」 | 10 | 9 |
| R10 写死小尺寸（候选） | 31 | 25 | | R32 图标在文字右边 | 0 | 0 |
| R11 散装控件 | 605 | 208 | | R33 图标尺寸 / 描边越档 | 364 | 104 |
| R12 z-index 魔法数 | 152 | 73 | | R34 按钮自己覆写尺寸 | 38 | 20 |
| R13 间距不是 4 的倍数 | 93 | 41 | | R35 自绘按钮无悬停态（候选） | 88 | 47 |
| R14 字号魔法数 | 5 | 5 | | | | |

决定栏顺序统计（R01）：全仓能配对的「主动作 + 取消」26 对，**取消在左（对）16 对，取消在右（错）10 对**。
取消词（R02）：zh「取消」17 处是标准；非标准的有「不要」×2、「不用」「不分享」「这次不答」「跳过」×2「稍后」「不用了，收起」「不再提示」等；en 同理有 `No`×2、`Not now`、`Don't share`。设计系统 §1.8 明令禁的「不要 / 不用」还各活着 1-2 处。
图标家族（R19）：关闭 `IconX` 全仓 64 处一个样、添加 `IconPlus` 43 处一个样、删除 `IconTrash` 42 处一个样、复制 `IconCopy` 17 处一个样——**这几个基本统一**；不统一的只有「更多」（竖三点 4 处 / 横三点 3 处）、「设置」（齿轮 5 处，另有滑杆类 7 处是另一语义）、「刷新」（Refresh 31 / Repeat 1）、「下载」（Download 14 / CloudDownload 1）、「编辑」（Pencil 7 / Writing 1）、「收藏」（Star 7 / Pin 4，语义没分清）。

DOM（设计实验室 343 格）：

| 规则 | 命中 | 涉及格 | 读法 |
|---|--:|--:|---|
| R10 点击目标 <24 且间距不满足例外 | 395 | 81 | **真问题**，见 5.3 |
| R10 点击目标 <24 但满足 WCAG 间距例外 | 577 | 151 | 合规，不算违例（仅记账） |
| R23 文字对比度不足 | 29 | 6 | 29 条全部是找参考面「白字压在视频缩略图上」，脚本量不到图片背景，**判为误报** |
| R04 按钮里有 ✓ | 24 | 20 | 见 5.3 |
| R06 禁用没原因 | 61 | 53 | 一半是 fixture 里「别的动作在忙所以这颗也灰了」 |
| R36 图标与文字中线偏差 >1.5px | 42 | 25 | 大多是两行内容 / 头像加两行字的卡片按钮，**量法对多行内容不准，需人看**；截图里挑的那 3 张都是误报，不要当证据 |
| R09 聚焦前后没有任何可见变化 | 14 | 3 | 弹层里的滑杆 / 文本输入，需人工确认（见 C8） |
| R03 删除右边还有按钮 | 7 | 7 | 与静态互证 |
| R07 无名字控件 | 4 | 3 | |
| R16 被截断没全文（省略号 / 行数截断）| 6 | 2 | 另有「硬切」6 条（`overflow:hidden` 没省略号）4 格 |
| R24 字号 <11px | 6 | 1 | 状态徽标里的 10px |
| R32 图标在文字右边（非结构图标）| 4 | 4 | 转场选择器的「叠化 / 硬切 / 甩镜」、Skill 浮层的「管理」 |
| R01 取消在实心主动作右边 | 1 | 1 | 隐私同意卡「愿意 / 不分享」 |

图标实际渲染（按钮内 svg，组件级一致性）：位置 左 387 / 右 4（另有 298 个右侧结构图标，合规）；尺寸 11/12/13/14/15/16/18 并存（16px 476 个、12px 467 个、13px 260、15px 245、14px 137、18px 138、11px 183）；描边 1.6×734、2×650、1.8×310、1.7×181、1.9×20、1.5×16；图标和文字间距 6px×319、4px×242、8px×48。同一族按钮里图标尺寸 / 描边 / 间距并不一致，这是 5.3 第 4 项。
间距（R13 信息档）：flex / grid 的 gap 不是 4 的倍数——6px 3277 处、10px 392、2px 438、5px 8；也就是半档（2/6/10）是**事实上的标准**，见 C7。

### 5.3 修复优先级（按「用户最容易看到 / 最影响信任」排；范围都是小组件级）

1. **删除 / 生成按钮上的 ✓（UI-R04）**——最扎眼：Agent 面板「要删掉画布上的 3 个节点 · 不可逆」的确认卡，主按钮是「✓ 删除 ↵」（删除配对勾，用户的 10-06 原话就是这个）。DOM 24 处 / 20 格（Agent 干预卡「删除」「生成」、生成确认「生成这段 ¥0.30」等）；静态 9 处是保存 / 采纳 / 确认裁剪钮带 ✓：`BrowserPromptExtractionSettingsModal.tsx:179`、`ComfyuiLocalCard.tsx:231`、`CustomCallEditor.tsx:427`、`IntegrationSelfCheckPanel.tsx:134`、`ModelPickerScreen.tsx:429`、`WorkflowSidebar.tsx:163`、`StoryboardPlanStrategyPanel.tsx:195`、`ImageCropGridOverlay.tsx:284`、`StoryboardOverrideBadge.tsx:22`。截图：`UI-R04__2__agent-panel-v4__v4-intervention-irreversible.png`。
2. **取消在主动作右边（UI-R01）**：隐私同意卡「愿意 | 不分享」（`AgentPanelV4Consent.tsx:60`，截图 `UI-R01__1__…consent-first-ask.png`）、遥测「删除全部」行内确认「确认 | 取消」（`TelemetrySection.tsx:75`，还是 11px 无边框文字钮）、`AddComfyuiInstanceButton.tsx:100`、`ComfyuiLocalCard.tsx:232`、`CustomCallEditor.tsx:408`、`VendorBaseUrlField.tsx:128`、`WorkflowSidebar.tsx:165`、`NodeErrorReport.tsx:363`、`ProductionRunTaskCard.tsx:330/339`。一共 10 处，可一批改完（只换顺序）。
3. **点击目标太小（UI-R10，DOM 395 处）**：集中在 4 个组件——`StoryboardShotRow.tsx` 左侧三件套（拖动把手 15×15、勾选「本次跳过」12×12、「镜头操作 ⋯」16×16，每行 3 个，一屏几十个）、分镜表「选择第 N 镜」勾选框 8×8、`AgentPanelV4Panel.tsx:393/396` 的「历史会话」「收起面板」15×15，再加静态扫到的 31 处写死 <24px 的散装按钮（`TimelineSelectionChip.tsx:55` 16px、`AgentPanelV4FocusTag.tsx:30` 20px 等）。修法是不动视觉、把点击热区撑到 ≥24（padding / 伪元素），小组件级。
4. **图标尺寸 / 描边不统一（UI-R33 / R36 邻近）**：静态 364 处越档（`size=15` 132 处、`17` 36 处、`stroke=1.7` 101 处……），渲染分布显示 11–18px 七八种并存。最集中的组件：`NomiBrowserDialogView.tsx`（23）、`BrowserAssetPopoverView.tsx`（21）、`richTextActions.tsx`（14）、`FeedbackShareContent.tsx`（13）、`ModelSettingsHome.tsx`（12）。是「所有图标按钮」这一族批量收口的首选对象。
5. **禁用的按钮没说原因（UI-R06）**：静态 77 / DOM 61。集中：`NomiBrowserDialogView.tsx`（6）、`ModelPickerScreen.tsx`（6）、`AgentPanelV4Cards.tsx`（4）、`NodeShotCutPanel.tsx`（4）、`ProjectLocationSection.tsx`（4）。截图 `UI-R06__1__agent-panel-v4__v4-rendering.png`。
6. **取消 / 主动作的措辞（UI-R02 / R26）**：「不要」「不用」「No」「不分享」等 21 处；主动作写「确认」10 处（`SpendConfirmDialog.tsx:299/424`、`confirmDialog.tsx:152`、`TelemetrySection.tsx:75` 等）。纯文案，一批改完。
7. **删除类不在最右（UI-R03）**：分镜多选条 `StoryboardSelectionToolbar.tsx:126`「删除已选」排在第一个、后面还有 4 个按钮（DOM 同一处互证，截图 `UI-R03__1__storyboard__sb-zone-06-selection-toolbar.png`）；节点快捷浮条里删除类夹在中间（`qa-21-…`）；还有 `SkillDetail.tsx:37`、`ProjectLibraryPage.tsx:522`、`SceneObjectsTab.tsx:286`、`CustomCallEditor.tsx:394`、`BrowserPromptExtractionSettingsModal.tsx:172`。
8. **按钮自己覆写尺寸（UI-R34）**：38 处，`NomiAppBar.tsx` 7 处（`h-[30px] px-2.5 rounded-[var(--nomi-radius-sm)]`）、`AgentTopbarChip.tsx:108`、`SpendConfirmDialog.tsx` 5 处、`ModelPickerScreen.tsx` 4 处。顶栏那一族可以收成一个 size 档。
9. **键盘到不了 / 摘焦点环（UI-R08 / R09）**：`ClipNode.tsx:481/513`、`ProjectLibraryPage.tsx:583`、`TimelineClip.tsx:314`、`TimelineTrack.tsx:253` 等 11 处 div/span 裸挂 onClick；34 处 `outline-none` 无替代（`NomiAppBar.tsx:181`、`AgentPanelV4Composer.tsx:255` 等）。
10. **截断没全文（UI-R16）**：静态 185 候选（需人工复核有多少已被父级 tooltip 覆盖）；DOM 实测 6 条真被截断且无 title（找参考面作品标题、`导出为 MP4` tooltip 自身被硬切等）。

靠后（量大但不是用户一眼能看见的信任问题）：R11 散装 button 605（`NomiBrowserDialogView.tsx` 19、`SceneObjectsTab.tsx` 14 起；是「同类控件一个组件」的存量）、R12 z-index 魔法数 152、R13 间距魔法数 93、R35 悬停态 88（`CategoryTree.tsx` 10、`ProjectExplorerSidebar.tsx` 5）、R20 / R21 / R22 文案风格 191 处。
零违例（可以放心）：R05（静态报的那 1 处 `BatchPlanOverlay.tsx:148` 是组件自己的本地函数 `confirm()`，不是原生对话框，**判为误报**，实际 0 处）、R17、R25（弹层不压触发钮 74 格全过）、R14 / R15 / R18 个位数。

### 5.4 每个重点组件族「各处用法放一起看」（供第二阶段按族分批小修）

| 组件族 | 命中集中在哪（改哪些组件） | 对应规则 |
|---|---|---|
| 所有图标按钮（`WorkbenchIconButton` / `IconActionButton` / 散装图标 `<button>`） | 热区 <24：`StoryboardShotRow.tsx`、`AgentPanelV4Panel.tsx`、`TimelineSelectionChip.tsx`、`AgentPanelV4FocusTag.tsx`；尺寸 / 描边越档：`NomiBrowserDialogView.tsx`、`BrowserAssetPopoverView.tsx`、`richTextActions.tsx`；无名字：`FindReferencePanel.tsx:321`、`SelectionPromptSaveController.tsx:209` | R07 R10 R33 |
| 所有对话框 / 卡片底栏（决定栏） | 顺序：`AgentPanelV4Consent.tsx`、`TelemetrySection.tsx`、`AddComfyuiInstanceButton.tsx`、`ComfyuiLocalCard.tsx`、`CustomCallEditor.tsx`、`VendorBaseUrlField.tsx`、`WorkflowSidebar.tsx`、`NodeErrorReport.tsx`、`ProductionRunTaskCard.tsx`；对勾：同上加 `ModelPickerScreen.tsx`、`IntegrationSelfCheckPanel.tsx`；措辞：`SpendConfirmDialog.tsx`、`confirmDialog.tsx`；覆写：`SpendConfirmDialog.tsx` | R01 R02 R04 R26 R34 |
| 动作条 / 选中条 / 节点浮条 | `StoryboardSelectionToolbar.tsx`、`ImageQuickActionsToolbar` 一族、`SkillDetail.tsx`、`ProjectLibraryPage.tsx` | R03 R19 |
| 顶栏按钮 | `NomiAppBar.tsx`、`AgentTopbarChip.tsx`（覆写 h / px / rounded，且 `outline-none`） | R09 R34 |
| 带图标的文字按钮 | 位置右侧：`editing` 转场选择器三格、Skill 浮层「管理」；中线对齐：需人工看（DOM 量法对多行不准） | R32 R36 |

### 5.5 最典型的 3 处截图（设计实验室，红框 = 违例；文件在 `docs/research/2026-10-07-ui-rules-census-shots/`）

设计实验室里**大多数格只有中文**（格 id 里带 `-zh` / `-en` 的才是双语；这次命中最多的格里只有 `qa-26-narrow-zoomed-top-refine-en`、`qa-21-…-en` 带英文），所以多数截图只有 zh 一轨；英文轨需要第二阶段修完后在带双语的格里补。

| 规则 | 3 张（文件名都在上面目录里，格式 `<规则>__<序号>__<屏>__<格>.png`） |
|---|---|
| R04 ✓ 当动作 | `UI-R04__2__agent-panel-v4__v4-intervention-irreversible`（删除 ✓，真问题）、`UI-R04__3__editing__picker-03-unsupported`；`UI-R04__1__catalog-liveness__…` 是**误报**（模型选中小标签的 ✓ 是已选状态，符合 R04，脚本分不出）。DOM 24 条里已确认有 6 条是这类「已选标签」（catalog-liveness 亮 / 暗各 3），其余 18 条未逐条复核，但抽到的「删除 ✓ / 生成 ✓」是真问题 |
| R01 取消在右 | `UI-R01__1__agent-panel-v4__v4-consent-first-ask`（只有 1 格命中，样本不足 3 张） |
| R10 小点击目标 | `UI-R10__1__storyboard__sb-zone-05-scene-groups`（每行左侧三件套）、`UI-R10__2__storyboard-reuse__sbr-01-rows-wide`、`UI-R10__3__node-quick-actions__qa-26-narrow-zoomed-top-refine-en`（en） |
| R06 禁用没原因 | `UI-R06__1__agent-panel-v4__v4-rendering`、`UI-R06__2__settings__privacy-02-exporting`、`UI-R06__3__primitives-actions__pa-02-workbench-button-busy` |
| R03 删除不在最右 | `UI-R03__1__storyboard__sb-zone-06-selection-toolbar`、`UI-R03__2__node-quick-actions__qa-21-top-edge-more-effects-en`（en）、`UI-R03__3__primitives-actions__pa-07-icon-action-button` |
| R07 无名字 | `UI-R07__1__agent-panel-v4__v4-rendering`、`UI-R07__2__primitives-surfaces__ps-07-modal`、`UI-R07__3__primitives-surfaces__ps-11-confirm-dialog` |
| R09 焦点 | `UI-R09__1…ps-09-anchored-popover`、`…pf-01-text-input-four-states`、`…pf-02-textarea-number` |
| R32 图标在右 | `UI-R32__1__agent-panel-v4__v4-composer-skill-popover`、`__2__editing__picker-03-unsupported`、`__3__editing__picker-01-dissolve` |
| R16 / R24 | `UI-R16__*`（找参考面）、`UI-R16-clipped__*`、`UI-R24__1__primitives-surfaces__ps-01-status-badge-tones` |

注意：`UI-R36__*` 三张和 `UI-R23__*` 是**误报样本**（多行卡片 / 白字压缩略图），留着只是证明脚本的盲区，不要拿去当缺陷证据。


## 6. 这一轮没做 / 做不到的

- **不是门岗**：两个脚本都是只读普查，启发式、会有误报；没有接进 `gates`，也没有基线棘轮。要不要门岗化、哪几条先上，等你定规则再做第二阶段。
- **只量了亮色主题**（设计实验室默认），暗色没量（见 C6）。
- **非文本对比度（WCAG 1.4.11）没量**：需要识别「控件边界 / 图标」这类图形对象，脚本里没有可靠判据。
- **Esc / 回车 / Tab 顺序（UI-R29）**：静态样张里没有真交互，只能真 App 键盘走查；本轮没起真 App（不起可见窗口的约束）。
- **M3 原文没读到**（§1）；中文空格、图标「更多」横竖没有官方依据（§1）。
- 设计实验室只覆盖它登记的格（380 格、24 屏），**没覆盖的真实界面**（设置的大部分页、项目库、导出页等）只有静态扫描能看到。

## 7. ③「能撤销就不弹确认」候选清单（本批**不改行为**，只列）

规则已写进设计系统 §1.9.2。下面是全仓 45 处 `confirmDialog(` 里**可能**能换成撤销提示的；判据是「操作有撤销栈或能恢复」。**我没有逐个验证撤销栈**，标「需确认」的要对应线先查。

| 候选（可能换成撤销 toast） | 位置 | 备注 |
|---|---|---|
| 删画布节点 / 分组 / 分类 | `sidebar/CategoryTree.tsx:284/318/341` | 设计实验室里 ps-11 的确认卡文案自己写着「可用 Cmd+Z 撤销」却仍弹确认，最该先换 |
| 删结果栈里的一张结果 | `generationCanvas/nodes/NodeResultStack.tsx:351` | 需确认能否恢复 |
| 删分镜行（仅已生成过的才弹） | `creation/storyboard/StoryboardShotTable.tsx:231/404` | 需确认撤销栈覆盖 |
| 删创作文档 | `creation/DocumentListSidebar.tsx:92` | 需确认有无回收 |
| 删系统提示词 | `ai/systemPrompt/SystemPromptSection.tsx:207` | 需确认能否恢复 |
| 删素材（多选 / 单个） | `assets/AssetLibraryPanel.tsx:449/481`、`browser/popover/useBrowserAssetActions.ts:190` | 若是删文件本体则不可逆，**保留确认** |

**必须保留确认**（不可逆 / 花钱 / 丢未保存内容）：未保存离开（`settings.unsaved`：`SettingsDialog.tsx:103`、`ModelSettingsDetailDialog.tsx:36`、`CustomCallEditor.tsx:124/376`、`ModelCapabilityEditor.tsx:144`）；断开 / 删除供应商与密钥（`VendorOnboardCard.tsx:148`、`CustomVendorManage.tsx:113`、`vendorDeleteAction.ts:18`、`ComfyuiLocalCard.tsx:165/186`、`ComfyuiWorkflowSettingsPage.tsx:268/286`）；删项目（`NomiStudioApp.tsx:497`）；制作线取消 / 放行（`production/useProductionStatus.ts:115/177/203/214/429`）；导演台那几处（`nodes/director/*`，本批不碰，UAL 线在改）。
落地顺序建议：先换 CategoryTree 三处（用户天天碰、且已有撤销栈），验证 `showUndoToast` 的撤销真能恢复后再扩。

## 8. 第二阶段第一批：「对话框 / 确认卡底栏」做了什么（2026-10-07）

**开工三问**
- **fix-churn（近 14 天这些文件被改的次数，其中 fix 类）**：`confirmDialog.tsx` 4（1）、`AgentPanelV4Cards.tsx` 8（2）、`AgentPanelV4Consent.tsx` 4（1）、`CustomCallEditor.tsx` 4（1）、`StoryboardSelectionToolbar.tsx` 5（2）、`TelemetrySection.tsx` 4（1）、`ComfyuiLocalCard.tsx` 4（1）；**`NodeErrorReport.tsx` 12（5）已超过「第三次」线**——这次只动它的「放行确认」那一小排（换成共享决定栏，顺序对调），没有加特例分支，也没有碰它别的逻辑。根因判断：这些不是各自的 bug，是「决定栏没有共用组件，每处手写一份」这一个类根因，所以修在共享边界（`DecisionBar`），不是逐处补丁。
- **成熟方案**：顺序 / 措辞 / ✓ 语义全部照 Apple HIG、Material、微软、NN/g 的官方条文（§2、§3）；点击目标照 WCAG 2.2 AA。组件本身是 Nomi 领域外的通用能力，所以只做一个 40 行的薄壳（包 `WorkbenchButton`），不引新库。
- **补 / 换 / 删**：**补** `DecisionBar`（`src/design/decisionBar.tsx`）；**换** `confirmDialog` 与 9 处手写底栏改走它；**删** 这 9 处手写按钮排、4 处 ✓ 图标 + 两处 ✕ 图标按钮、`AgentPanelV4Cards` 里的 ✓。

**改了哪些底栏**（每处「改前 → 改后」）
| 位置 | 改动 |
|---|---|
| `design/confirmDialog.tsx`（全产品确认框，共享） | 迁入 `DecisionBar`（取消在左、主动作在最右；行为与锚点 `data-confirm-dialog-*` 不变） |
| `ai/v4/AgentPanelV4Cards.tsx`（Agent 删除 / 付费 / 计划 / 凭证 / 偏差 / 全自动确认卡） | **去掉右上角 ×**（内联卡片不是窗口，× 干的就是取消，留着是两个入口做一件事）；底栏右组最左加文字「取消」（点它 = 原 × 的拒绝 / 停下，锚点仍是 `slot-dismiss`）；主按钮去掉 ✓。付费卡排法：左「生成剩下 N 段」，右「取消 · 去掉这段 · 生成」；批量发出中只剩提示 +「取消」（提示文案由「按 ×」改成「点『取消』」）。反问卡（`V4AskCard`）有自己的壳，仍保留右上 ×，不在本批 |
| `ai/v4/AgentPanelV4Consent.tsx` | 「愿意 \| 不分享」→「不分享 \| 愿意」，提示文字移到左边 |
| `onboarding/AddComfyuiInstanceButton.tsx` | 「接入检测 \| 取消」→「取消 \| 接入检测」 |
| `onboarding/ComfyuiLocalCard.tsx`、`workflowPage/WorkflowSidebar.tsx` | 地址行内编辑：✓ ✕ 两个小图标钮 → 文字「取消 \| 保存地址 / 保存」 |
| `onboarding/VendorBaseUrlField.tsx` | 「保存 \| 取消」→「取消 \| 保存」 |
| `onboarding/CustomCallEditor.tsx` | 底栏顺序改为「删除（最左，隔开）… 取消 \| 保存草稿 \| 主动作」，去掉主动作 ✓ |
| `browser/prompt/BrowserPromptExtractionSettingsModal.tsx` | 底栏走 `DecisionBar`：恢复默认 / 删除住最左隔开，取消 \| 保存，去掉 ✓ |
| `settings/TelemetrySection.tsx` | 删除全部的行内确认：「确认 \| 取消」(11px 无边框字) → 「取消 \| 删除全部」(危险色，≥28px) |
| `generationCanvas/nodes/NodeErrorReport.tsx` | 放行确认：「继续 \| 取消」→「取消 \| 继续」 |
| `generationCanvas/nodes/render/ImageCropGridOverlay.tsx` | 画布上 ✕ ✓ 两个圆形图标钮 → 文字「取消 \| 确认裁剪 / 确认切图」 |
| `creation/storyboard/StoryboardSelectionToolbar.tsx` | 删除固定最右（清除选择 × 挪到计数旁）；间距收到 `gap-1.5`，英文不再把整条挤成两行 |
| `onboarding/IntegrationSelfCheckPanel.tsx`、`ModelPickerScreen.tsx`、`StoryboardPlanStrategyPanel.tsx`、`StoryboardOverrideBadge.tsx` | 去掉动作按钮里的 ✓；后两个同时把命中区撑到 ≥24px |
| `onboarding/VendorFieldLossNotice.tsx` | 纯告知的「确认」→「知道了」 |
| `i18n/locales/agentPanelV4.ts` | 「不要 / 不用 / No / Not now」→「取消 / Cancel」（3 个键 × 2 语言）；「确认不要 / Confirm no」→「确认拒绝 / Confirm decline」；批量停止提示去掉「×」 |

**没动的（同样是普查命中，但不是本批范围或不该动）**：`ProductionRunTaskCard`（任务控制条，不是决定栏）、`SpendConfirmDialog`（顺序与文案本来就对，只是还没迁进 `DecisionBar`，下一批）、导演台 `nodes/director/*`（UAL 线在改，`SceneObjectsTab` 的 R03 命中留着）、画布落地链、门岗脚本、两本账本。

**普查前后对比**（同一份脚本，改前在 `ffd01e2aa` 的干净副本上跑，改后在本分支跑）
| 规则 | 静态 前 → 后 | DOM 前 → 后（agent-panel-v4 / storyboard / primitives-surfaces / settings 四屏，171 格） |
|---|---|---|
| R01 取消在主动作右边 | 8 → **0** | 1 → **0** |
| R02 口语否定词 | 6 → **0** | — |
| R03 删除夹在中间 | 3 → 1（剩导演台，不碰） | 1 → **0** |
| R04 ✓ 当动作 | 9 → **0** | 15 → **0** |
| R26 主动作「确认」 | 3 → **0** | — |
| R10 点击目标 <24 | 31 → 31 | 212 → 212（**没动**：命中集中在分镜行把手 / 勾选、Agent 面板「历史会话 / 收起」，不是决定栏，留给下一批「图标按钮」） |
| R33–R35 | 图标越档 364 → 359 | 图标按钮渲染尺寸分布基本不变 |

**验证**：`pnpm typecheck` 绿、`eslint`（改到的文件）0 警告；`vitest` 312 个测试文件 3127 条全绿（`src/design`、`ai/v4`、`ui/onboarding`、`settings`、`creation/storyboard`、`generationCanvas/nodes`、`ui/browser`）；`check:controls`、`check:icon-semantics`、`check:tokens`（中途抓到我写的 `ml-auto` 违反「行尾贴边」，已改）、`check:i18n`、`check:filesize`、`check:feel` 绿。`check:concept-owners`（8 处历史 root-cause 声明边界未登记）与 `check:walkthroughs`（C0 凭证类 2 条）红，**指向的文件都不是本批改的**，未在 main 上复核；本批不碰账本与门岗。前后对比截图：`docs/research/2026-10-07-decision-bar-shots/pairs/`（11 张，每张 左改前 / 右改后，zh / en × 亮 / 暗 4 行），原图在同目录 `before/` `after/`。设计实验室基线若因此变化只记清单：受影响的格 = `agent-panel-v4`（v4-intervention-* / v4-spend-params-* / v4-panel-spend-* / v4-flow-generation / v4-consent-first-ask）、`primitives-surfaces/ps-11-confirm-dialog`、`storyboard/sb-zone-06-selection-toolbar`（darwin 基线由 Mac 录，本机没录）。

**证据修正（协调会话 10-07 复核后）**：第一版里 `ps-11-confirm-dialog`（confirmDialog 本来顺序就对）和 `settings/privacy-01-idle`（idle 态根本不出现我改的删除确认）改前改后肉眼一样，**已从对比图里撤掉**，不拿没变化的图充数；`DecisionBar` 迁入 `confirmDialog` 的正确性靠单测与 `ps-11` 的类型 / 锚点不变来保证，没有可见差异的截图。顺带记一笔（**不在本批改**）：`ps-11` 的英文轨标题与正文仍是中文，是设计实验室夹具写死了中文。

**重截的格（zh / en × 亮 / 暗，我都 Read 过）**：`v4-intervention-{irreversible,spend,reversible,reject-reason,plan,credential,deviation}`、`v4-spend-params-single`、`v4-panel-spend-batch`、`v4-consent-first-ask`、`v4-auto-mode-confirm`、`storyboard/sb-zone-06-selection-toolbar`，以及 4 个组件级取证页（`scratch__add / vendor / crop / prompt`）。consent 卡本来就是「不分享 | 愿意」两颗文字按钮、没有 ×，符合 ①，不需要再加「取消」。

**没有截图验证的（诚实标注）**：批量发出中的「只剩提示 + 取消」态（设计实验室没有这一格，真 App 点一遍「生成剩下 N 段」再取消）、`TelemetrySection` 删除确认态（实验室只有 idle 格，未截到，验收线真 App 点）、`ComfyuiLocalCard` / `WorkflowSidebar` 地址编辑态、`CustomCallEditor` 底栏、`NodeErrorReport` 放行确认、`StoryboardPlanStrategyPanel` / `StoryboardOverrideBadge`、`IntegrationSelfCheckPanel` / `ModelPickerScreen` ——实验室没有这些格，我只做了类型 / 单测 / 普查验证；`DecisionBar` 在这些位置的真实观感需要用户或独立验收线在真 App 里点一遍。

## 9. 第二批（#1082 独立验收有条件通过后收尾，2026-10-07）

验收条件逐条处理：

| 条件 | 处理 |
|---|---|
| A 英文窄行：Comfy「接入地址」行主动作被裁成「Save ad」 | `DecisionBar` 换行规则：取消 + 次动作 + 主动作为**不拆整组**，放不下整组换行并靠右；行内用法 `inline` 自带 `grow justify-end`，父行 `flex-wrap`、输入框 `min-w-[10rem] flex-[1_1_10rem]`；Comfy 卡外层行也改成可换行。规则写进设计系统 §1.9.1，调用方不特判 |
| B 首次询问卡英文「I'm in」折到左下 | 同一条换行规则：主动作永远在最后一行最右。窄 300px / 360px 的 zh/en × 亮/暗已重截（上一版 vs 本版成对图） |
| 3 `runtime.design.gotIt` 字面是「确认」 | 改成 zh「知道了」/ en「Got it」；`confirmDialog` 的 alert 默认按钮与 `VendorFieldLossNotice` 同步生效 |
| 4 文档 / 注释不符 | §1.8 例外段与正例改为付费卡实际排法「取消 · 去掉这段 · 生成」；`AgentPanelV4Cards.tsx` 三处与 `tests/ux/agent-runtime-walk-support.mjs` 的「× 在右上」旧注释已改 |
| 5 成对决定栏没迁的 | 已迁入 `DecisionBar`：ModelPickerScreen、CustomCallEditor（含删除 leading、保存草稿 middle、测试 / 保存主动作与禁用原因 `primaryHint`）、UserPromptComposer、SelectionPromptSaveController、WorkflowLibraryContent（后两个去掉 IconX / 软盘图标）、BatchPlanOverlay、CommittedProposalCard；凭证输入行 VendorOnboardCard（单段 + 多段）、CustomVendorManage、TikhubConnectorCard（输入框 + 取消 + 主动作同一行、窄位换行右对齐）。**看过、不属于决定栏、没迁**：AiSceneBar（Run ↔ Stop 同一个槽位的切换，不是成对）、ModelEnableEditor（选择模式工具条的「全选 / 取消」）、DreaminaMemberCard（单个「取消授权」文字链，没有主动作）、ScreenshotCropOverlay（整屏覆盖层右上 ×，窗口关闭语义）、ProductionRunTaskCard / TaskCenterPanel / ShotTableNode（任务控制）、SpendConfirmDialog、SceneObjectsTab（按指示不动） |
| 7 `agent-panel-missing-card` 走查 | 在 main 上同样红（取消后「节点数应为 0」超时），**不是本 PR 的事**，协调会话另开线 |

**前后截图**（上一版 `98ac5dcab` vs 本版；1100×720 最小窗口；zh/en × 亮/暗；我都 Read 过）：`docs/research/2026-10-07-decision-bar-shots-r2/pairs/`——首次询问卡（lab 格 + 300 / 360px 窄位）、付费确认卡、Comfy 接入地址行（360 / 520px，行容器按上一版写法复刻对比）、供应商地址行（300 / 420px）、新建提示词（UserPromptComposer）、添加 Comfy 实例、裁剪浮层。注意：Comfy 行是**逐字复刻**行标记而非真卡（真卡要桌面桥，起不来），其余是真组件。
**没有设计实验室格、也没截到的迁移位置（验收线真 App 点）**：ModelPickerScreen、CustomCallEditor 底栏、SelectionPromptSaveController、WorkflowLibraryContent 编辑弹窗、BatchPlanOverlay、CommittedProposalCard、三处凭证输入行。

**普查前后（静态）**：R01 0、R02 0、R04 0、R26 0 保持；R03 剩 1（导演台 SceneObjectsTab，按指示不动）；R34（按钮自己覆写尺寸）38 → 33；R11（散装 `<button>`）605 → 573。
**验证**：`pnpm typecheck` 绿；`src/design`、`src/workbench`、`src/ui`、`src/i18n` 的 vitest 全绿（3 条源码结构断言随 CustomCallEditor 迁移改成 `onPrimary: saveTestedScript` / `onCancel={...requestClose}`）。
