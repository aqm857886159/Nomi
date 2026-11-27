# NomiEntryTopbar 逐态对照表（实现合同）

> 元素身份、状态与生产锚点见 [NomiEntryTopbar 清单](NomiEntryTopbar.board.json)。下面保留拍板时的分镜、量值与判据。
> 拍板：用户 2026-11-22「照这版拍板」（入口长相 + 让位顺序 ①–④，③ 先于 ④）；「全部收进顶栏」；「放顶栏」；同日补定「C 不出胶囊」「放在顶栏入口的脸上」（见文末）。板源是画布 v16。
> 按分镜名查看 `preview/<板名>.png`，走查为 `tests/ux/nomi-entry-topbar.walk.mjs`。

## 逐态

### A 五种脸

| 格 | 状态 | 板上在哪（分镜） | 生产组件 | 断言 · 判据 |
|---|---|---|---|---|
| A1 | 空闲 | States「打开 Nomi（⌘J） · Nomi 在这儿」；States「打开 Nomi（⌘J） · Nomi 在这儿」；Main「打开 Nomi（⌘J） · Nomi 在这儿」；TopBar「打开 Nomi（⌘J） · Nomi 在这儿」；NomiEntry「打开 Nomi（⌘J） · Nomi 在这儿」 | `src/ui/app-shell/shell/ShellNomiEntry.tsx`（新）+ `src/ui/app-shell/shell/nomiEntryLook.ts`（新，取代 agentBallLook）+ NomiAgentFace（`src/design/identity.tsx`，复用） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.face`：入口 data-status=idle，无角标、无点；`src/ui/app-shell/shell/nomiEntryLook.test.ts`：五态 × 有无未读 全表 |
| A2 | 有新消息（蓝点） | States「打开 Nomi（⌘J） · Nomi 在这儿 · 3…」；States「打开 Nomi（⌘J） · Nomi 在这儿 · 3…」；Bar700ZhDark「打开 Nomi（⌘J） · Nomi 在这儿 · 3…」；Wide1440「Open Nomi (⌘J) · Nomi is h…」 | `src/ui/app-shell/shell/ShellNomiEntry.tsx`（新）+ `src/ui/app-shell/shell/nomiEntryLook.ts`（新，取代 agentBallLook）+ NomiAgentFace（`src/design/identity.tsx`，复用）；点：`src/ui/app-shell/shell/DotMark.tsx`（复用） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.dot`：data-status=unread 且点在按钮内、蓝色 token |
| A3 | 在做（变圆 + 蓝弧转） | States「打开 Nomi（⌘J） · Nomi 正在做」；States「打开 Nomi（⌘J） · Nomi 正在做」；Main「打开 Nomi（⌘J） · Nomi 正在做」；Windows700「打开 Nomi（Ctrl+J） · Nomi 正在做」 | `src/ui/app-shell/shell/ShellNomiEntry.tsx`（新）+ `src/ui/app-shell/shell/nomiEntryLook.ts`（新，取代 agentBallLook）+ NomiAgentFace（`src/design/identity.tsx`，复用） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.face`：data-status=running；弧只在 running 时转（减弱动效下不转） |
| A4 | 刚做完（压扁眯眼笑，2.4 秒回空闲） | States「打开 Nomi（⌘J） · 刚做完」；States「打开 Nomi（⌘J） · 刚做完」；Bar700EnLight「Open Nomi (⌘J) · Just fini…」；Wide1100「打开 Nomi（⌘J） · 刚做完」；Wide1440「Open Nomi (⌘J) · Just fini…」 | `src/ui/app-shell/shell/ShellNomiEntry.tsx`（新）+ `src/ui/app-shell/shell/nomiEntryLook.ts`（新，取代 agentBallLook）+ NomiAgentFace（`src/design/identity.tsx`，复用） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.face`：data-status=done，V4_DOCK_DONE_HOLD_MS 后回 idle |
| A5 | 有一步没成（歪倒 + 红点） | States「打开 Nomi（⌘J） · 有一步没成」；States「打开 Nomi（⌘J） · 有一步没成」；Bar700ZhDark「打开 Nomi（⌘J） · 有一步没成」 | `src/ui/app-shell/shell/ShellNomiEntry.tsx`（新）+ `src/ui/app-shell/shell/nomiEntryLook.ts`（新，取代 agentBallLook）+ NomiAgentFace（`src/design/identity.tsx`，复用） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.dot`：data-status=failed 且点是 danger token |

### B 待确认数

| 格 | 状态 | 板上在哪（分镜） | 生产组件 | 断言 · 判据 |
|---|---|---|---|---|
| B1 | 1 条（窄：角标 1） | States「打开 Nomi（⌘J） · 等你确认 1 条」；States「打开 Nomi（⌘J） · 等你确认 1 条」；Bar700EnLight「Open Nomi (⌘J) · 1 waiting…」 | `src/ui/app-shell/shell/ShellNomiEntry.tsx` 角标（新） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.pending-badge`：角标文字 = 1，data-pending=1；角标右沿不超出按钮右沿（right 0、top −4，角标比按钮高 4px），不探进右边 8px 留白 |
| B2 | 9 条（角标 9） | States「打开 Nomi（⌘J） · 等你确认 9 条」；States「打开 Nomi（⌘J） · 等你确认 9 条」；Bar700ZhDark「打开 Nomi（⌘J） · 等你确认 9 条」 | `src/ui/app-shell/shell/ShellNomiEntry.tsx` | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.pending-badge`：角标文字 = 9 |
| B3 | 12 条（角标 9+，提示写全数） | States「打开 Nomi（⌘J） · 等你确认 12 条」；States「角标封顶写 9+，提示写全数：…等你确认 12 条」；States「打开 Nomi（⌘J） · 等你确认 12 条」；Main「打开 Nomi（⌘J） · 等你确认 12 条」；States「打开 Nomi（⌘J） · 等你确认 12 条」 | `src/ui/app-shell/shell/ShellNomiEntry.tsx` + `src/ui/app-shell/shell/nomiEntryLook.ts` | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.pending-badge`：角标 = 9+，提示含「12 条」；`src/ui/app-shell/shell/nomiEntryLook.test.ts`：9→「9」、10→「9+」、120→「9+」 |
| B4 | 120 条（角标 9+ / 提示全数 / 胶囊写全数） | States「打开 Nomi（⌘J） · 等你确认 120 条」；States「打开 Nomi（⌘J） · 等你确认 120 条」；Bar900「等你确认 120 · 等你确认 120 条」；Bar900「Confirm 120 · 120 waiting …」 | `src/ui/app-shell/shell/ShellNomiEntry.tsx` | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.pending-capsule`：胶囊文字 = 等你确认 120 / Confirm 120，宽 ≤116px，不截断 |
| B5 | 在做 + 等确认 2（脸照样转、角标盖右上） | States「打开 Nomi（⌘J） · 等你确认 2 条」；States「角标盖住转圈的右上角；在做看悬停提示」；States「打开 Nomi（⌘J） · 等你确认 2 条」 | `src/ui/app-shell/shell/nomiEntryLook.ts`（行为变化：脸的状态不再被「等你确认」顶掉，见设计卡调用方表） | `src/ui/app-shell/shell/nomiEntryLook.test.ts`：running + pending 2 → 脸 running、角标 2；`tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.face`：data-status=running 且 data-pending=2，提示是「打开 Nomi（⌘J） · 等你确认 2 条」（中段用合并状态；便签 638「在做看悬停提示」和画出来的提示不符，按画出来的，已报协调） |
| B6 | 没成 + 等确认 1（角标占角，红点不叠） | States「打开 Nomi（⌘J） · 等你确认 1 条」；States「角标占角，红点不再叠」；States「打开 Nomi（⌘J） · 等你确认 1 条」；Bar700EnDark「Open Nomi (⌘J) · 1 waiting…」 | `src/ui/app-shell/shell/nomiEntryLook.ts` | `src/ui/app-shell/shell/nomiEntryLook.test.ts`：failed + pending 1 → 无点；`tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.dot`：有角标时 [data-nomi-entry-dot] 个数 0 |

### C 胶囊还是角标

| 格 | 状态 | 板上在哪（分镜） | 生产组件 | 断言 · 判据 |
|---|---|---|---|---|
| C1 | ≥900 且放得下 → 带字胶囊 | Bar900「等你确认 2 · 等你确认 2 条」；Bar900「Confirm 2 · 2 waiting for …」；States「等你确认 2 · 等你确认 2 条」<br>Bar900 / 改后 · 预览 · 中文：量得 ①✗ ②✗ ③— ④—，分段左移 0px，离左 242px / 离右 17px，胶囊 99px<br>Bar900 / 改后 · 预览 · 英文：量得 ①✓ ②✗ ③— ④—，分段左移 -0.5px，离左 170px / 离右 52px，胶囊 98px | `src/ui/app-shell/shell/ShellNomiEntry.tsx` + `src/ui/app-shell/shell/topbarYield.ts` | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.pending-capsule`：900/1100/1440 下 data-shape=capsule；胶囊宽 = 99 / 98px（±2） |
| C2 | <900 → 脸 + 角标 | Main「打开 Nomi（⌘J） · 等你确认 2 条」；Bar700EnLight「Open Nomi (⌘J) · 2 waiting…」；Windows700「打开 Nomi（Ctrl+J） · 等你确认 2 条」<br>Main / 改后 · 预览：量得 ①✓ ②✗ ③— ④—，分段左移 0px，离左 142px / 离右 56px，角标 2 | `src/ui/app-shell/shell/ShellNomiEntry.tsx` | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.pending-badge`：700 / 899 下 data-shape=face 且角标 2 |
| C3 | 走到第 ④ 步后胶囊照样带字 | Bar900「Confirm 120 · 120 waiting …」；Bar900「Last install failed · Clic…」；Bar900「藏了进度数字还差 41px，第 ④ 步「新版本」收成…」<br>Bar900 / 最挤 · 预览 · 英文 · 上次更新没装上：量得 ①✓ ②✓ ③✓ ④✓，分段左移 36.5px，离左 172px / 离右 13px，胶囊 115px | `src/ui/app-shell/shell/topbarYield.ts`（胶囊不在让位顺序里） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/topbar.yield-order`：900 英文没装上全开：data-shell-yield-step=4 且入口 data-shape=capsule |
| C4（D5） | 面板开着 + 有待确认 + 放得下（1440）→ 不出胶囊：按下底色的脸 + 角标，悬停「收起面板（⌘\） · 等你确认 N 条」 | Wide1440「Collapse panel (⌘\) · 2 wa…」；Wide1440「」；Wide1440「2」；Wide1440「按下底色 + 角标 2（面板开着不出胶囊，悬停「Co…」<br>Wide1440 / 改后 · 创作 · 面板开着：量得 ①— ②✗ ③— ④✗，分段左移 -0.5px，离左 277px / 离右 324px，角标 2 | `src/ui/app-shell/shell/ShellNomiEntry.tsx` + `src/ui/app-shell/shell/nomiEntryLook.ts`（形状 = 有待确认 && 放得下 && 面板没开 → 胶囊；其余有待确认 → 角标） | `src/ui/app-shell/shell/nomiEntryLook.test.ts`：open + pending 2 + 放得下 → shape=face、角标 2；`tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.pending-badge`：1440 面板停靠开着 + 等你确认 2：data-shape=face、aria-pressed=true、角标 2、提示以「收起面板（⌘\） · 等你确认 2 条」/「Collapse panel (⌘\) · 2 waiting for you」开头 |
| C5（D5） | 面板开着 + 窄于 900 + 有待确认 | 画布没画 | 画布没画；同 C4（D5：面板开着不出胶囊，和宽窗一个样） | 画布没画；判据同 C4：`tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.pending-badge`：700 浮窗开着 + 等你确认 2：data-shape=face、aria-pressed=true、角标 2 |

### D 交互

| 格 | 状态 | 板上在哪（分镜） | 生产组件 | 断言 · 判据 |
|---|---|---|---|---|
| D1 | 静止（透明底，同旁边图标钮） | States「打开 Nomi（⌘J） · Nomi 在这儿」；States「透明底，和旁边的图标钮一样」；States「打开 Nomi（⌘J） · Nomi 在这儿」 | `src/ui/app-shell/shell/barIconButton.ts` BAR_ICON_BUTTON（复用） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry`：静止背景 = 旁边「设置」钮的背景（computed style 相等） |
| D2 | 悬停（ink-05 底） | States「打开 Nomi（⌘J） · Nomi 在这儿」；States「浅色下悬停底色（ink-05）和顶栏底色是同一个数值…」；States「打开 Nomi（⌘J） · Nomi 在这儿」；Bar700EnDark「Open Nomi (⌘J) · Nomi is h…」 | BAR_ICON_BUTTON（复用） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry`：悬停背景 = 「设置」钮悬停背景；浅色下看不看得出：unverified（画布便签 651，全顶栏同样） |
| D3 | 面板开着 = 按下底色 + 提示「收起面板（⌘\）」 | States「收起面板（⌘\） · Nomi 在这儿」；States「按下底色（同任务面板开着）；提示借用面板头收起钮今天…」；States「收起面板（⌘\） · Nomi 在这儿」；Wide1100「收起面板（⌘\） · Nomi 在这儿」；Wide1100「面板开着时入口是按下的底色（同任务面板开着）。点入口…」 | `src/ui/app-shell/shell/ShellNomiEntry.tsx`（aria-pressed）+ 文案 agentPanelV4.collapsePanel | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry`：面板开着 aria-pressed=true，背景 = 任务钮开着时的背景；提示以「收起面板（⌘\）/ Collapse panel (⌘\)」开头；点一下面板收起 |
| D4 | 键盘焦点（2px 墨色描边） | States「打开 Nomi（⌘J） · Nomi 在这儿」；States「2px 墨色描边，同顶栏其它钮」；States「打开 Nomi（⌘J） · Nomi 在这儿」；Bar700EnDark「Open Nomi (⌘J) · Nomi is h…」 | BAR_ICON_BUTTON（复用 focus-visible） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry`：Tab 到入口：outline 2px，颜色 = 「设置」钮 focus-visible |
| D5 | 最长提示：中文 Mac / 英文 Windows | States「原大 · 悬停出提示（中文，Mac）」；States「打开 Nomi（⌘J） · 等你确认 120 条」；States「打开 Nomi（⌘J） · 等你确认 120 条」；States「原大 · 悬停出提示（英文，Windows，最长一句…」；States「Open Nomi (Ctrl+J) · Nomi …」；States「Open Nomi (Ctrl+J) · Nomi …」 | BarTooltip（`src/ui/app-shell/shell/ShellTopBar.tsx`，复用） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry.tooltip`：提示一行不截断（scrollWidth ≤ clientWidth），zh / en、Mac ⌘ / Windows Ctrl+ 各一次 |

### E 让位（每个宽度「最挤」那一行）

| 格 | 状态 | 板上在哪（分镜） | 生产组件 | 断言 · 判据 |
|---|---|---|---|---|
| E1 | Main 700 中文浅色：应走到 ①② | Main / 最挤 · 预览：量得 ①✓ ②✓ ③✗ ④—，分段左移 57px，离左 44px / 离右 13px，角标 9+ | `src/ui/app-shell/shell/topbarYield.ts`（新）+ `src/ui/app-shell/shell/ShellTopBar.tsx`（改） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/topbar.yield-order`：同样几件事全开（新版本 + 3 个任务 + 待确认 + 进度数字）：data-shell-yield-step 与左列一致；分段离左右两簇都 ≥12px |
| E2 | 700 中文深色：应走到 ①② | Bar700ZhDark / 最挤 · 预览：量得 ①✓ ②✓ ③✗ ④—，分段左移 57px，离左 44px / 离右 13px，角标 9+ | `src/ui/app-shell/shell/topbarYield.ts`（新）+ `src/ui/app-shell/shell/ShellTopBar.tsx`（改） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/topbar.yield-order`：同样几件事全开（新版本 + 3 个任务 + 待确认 + 进度数字）：data-shell-yield-step 与左列一致；分段离左右两簇都 ≥12px |
| E3 | 700 英文浅色：应走到 ①②③ | Bar700EnLight / 最挤 · 预览：量得 ①✓ ②✓ ③✓ ④—，分段左移 49.5px，离左 59px / 离右 13px，角标 9+ | `src/ui/app-shell/shell/topbarYield.ts`（新）+ `src/ui/app-shell/shell/ShellTopBar.tsx`（改） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/topbar.yield-order`：同样几件事全开（新版本 + 3 个任务 + 待确认 + 进度数字）：data-shell-yield-step 与左列一致；分段离左右两簇都 ≥12px |
| E4 | 700 英文深色：应走到 ①②③ | Bar700EnDark / 最挤 · 预览：量得 ①✓ ②✓ ③✓ ④—，分段左移 49.5px，离左 59px / 离右 13px，角标 9+ | `src/ui/app-shell/shell/topbarYield.ts`（新）+ `src/ui/app-shell/shell/ShellTopBar.tsx`（改） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/topbar.yield-order`：同样几件事全开（新版本 + 3 个任务 + 待确认 + 进度数字）：data-shell-yield-step 与左列一致；分段离左右两簇都 ≥12px |
| E5 | Windows 700 中文：应走到 ①②③ | Windows700 / 最挤 · 预览：量得 ①✓ ②✓ ③✓ ④—，分段左移 153px，离左 53px / 离右 12px，角标 9+ | `src/ui/app-shell/shell/topbarYield.ts`（新）+ `src/ui/app-shell/shell/ShellTopBar.tsx`（改） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/topbar.yield-order`：同样几件事全开（新版本 + 3 个任务 + 待确认 + 进度数字）：data-shell-yield-step 与左列一致；分段离左右两簇都 ≥12px |
| E7 | 900 中文：应走到 ①② | Bar900 / 最挤 · 预览 · 中文：量得 ①✓ ②✓ ③✗ ④✗，分段左移 134px，离左 67px / 离右 13px，胶囊 116px | `src/ui/app-shell/shell/topbarYield.ts`（新）+ `src/ui/app-shell/shell/ShellTopBar.tsx`（改） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/topbar.yield-order`：同样几件事全开（新版本 + 3 个任务 + 待确认 + 进度数字）：data-shell-yield-step 与左列一致；分段离左右两簇都 ≥12px |
| E8 | 900 英文：应走到 ①②③ | Bar900 / 最挤 · 预览 · 英文：量得 ①✓ ②✓ ③✓ ④✗，分段左移 131.5px，离左 77px / 离右 12px，胶囊 115px | `src/ui/app-shell/shell/topbarYield.ts`（新）+ `src/ui/app-shell/shell/ShellTopBar.tsx`（改） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/topbar.yield-order`：同样几件事全开（新版本 + 3 个任务 + 待确认 + 进度数字）：data-shell-yield-step 与左列一致；分段离左右两簇都 ≥12px |
| E9 | 900 中文 · 没装上：应走到 ①②③ | Bar900 / 最挤 · 预览 · 中文 · 上次更新没装上：量得 ①✓ ②✓ ③✓ ④✗，分段左移 150px，离左 92px / 离右 12px，胶囊 116px | `src/ui/app-shell/shell/topbarYield.ts`（新）+ `src/ui/app-shell/shell/ShellTopBar.tsx`（改） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/topbar.yield-order`：同样几件事全开（新版本 + 3 个任务 + 待确认 + 进度数字）：data-shell-yield-step 与左列一致；分段离左右两簇都 ≥12px |
| E10 | 900 英文 · 没装上（Mac 最挤一格）：应走到 ①②③④ | Bar900 / 最挤 · 预览 · 英文 · 上次更新没装上：量得 ①✓ ②✓ ③✓ ④✓，分段左移 36.5px，离左 172px / 离右 13px，胶囊 115px | `src/ui/app-shell/shell/topbarYield.ts`（新）+ `src/ui/app-shell/shell/ShellTopBar.tsx`（改） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/topbar.yield-order`：同样几件事全开（新版本 + 3 个任务 + 待确认 + 进度数字）：data-shell-yield-step 与左列一致；分段离左右两簇都 ≥12px |
| E6 | Windows 700 英文全开：走完还差约 28px | Windows700「最挤 · 预览 · 英文（推算）」；Windows700「Open Nomi (Ctrl+J) · 12 wa…」；Windows700「同样几件事全开：藏了进度数字、分段挪到离项目钮 12…」；Windows700「中文最挤一格走到第 ③ 步（藏进度数字）就放得下。英…」 | 推迟（deferred，「照这版拍板」2026-11-22：窗口钮宽度是推算，等 Windows 真机量） | 不写判据；走查在这一格只记量得的差值，不判红 |
| E11 | 宽窗不让：1100 / 1440 分段整窗居中 | Wide1100 / 收起之后：量得 ①— ②✗ ③— ④—，分段左移 0px，离左 196px / 离右 343px<br>Wide1440 / 改后 · 预览 · 面板收起：量得 ①✗ ②✗ ③— ④—，分段左移 -0.5px，离左 277px / 离右 310px | `src/ui/app-shell/shell/topbarYield.ts` | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/topbar.yield-order`：1100 / 1440 下 data-shell-yield-step=0，分段中心与顶栏中心差 ≤1px |
| E12 | ①↔② 来回拖窗不抖（回差） | 画布没画 | `src/ui/app-shell/shell/topbarYield.ts`：收看「现在的空当 <12」，放回按「放回后的宽度」算仍 ≥12 才放（同 ShellTopBar.tsx:88–93 fullWidth 写法） | `src/ui/app-shell/shell/topbarYield.test.ts`：700→1440→700 每 1px 一步，同一宽度来回结果一致、每个阈值只翻一次；`tests/perf/scenarios/topbar-yield-resize.json` 计步变次数 |

### F「新版本」三种字

| 格 | 状态 | 板上在哪（分镜） | 生产组件 | 断言 · 判据 |
|---|---|---|---|---|
| F1 | 有新版本：≥900 带字 / <900 只留点 | Wide1440「Update 0.25.0」；Wide1440「Update 0.25.0」；Main「新版本 0.25.0」 | `src/ui/app-shell/UpdatePill.tsx`（改：compact 由让位决定） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/topbar.update-pill`：1440 带字；700 只有点，悬停出全句 |
| F2 | 更新下载中 100% | 画布没画 | 画布没画（TopBar.dc.html 有 downloading 选项，没有实例）；文案已在 updateReminder.badge.downloading | 按 F1 同样的宽度规则；走查补一格截图，不新判据 |
| F3 | 上次没装上 · 点一下重试（红三角 + 红点） | Bar900「上次没装上 · 点一下重试」；Bar900「Last install failed · Clic…」；Bar900「「上次没装上 · 点一下重试」+ 3 个任务 + 等…」；Bar900「900 是带字的最挤一档。「新版本」那颗最长会写「上…」 | `src/ui/app-shell/UpdatePill.tsx`（phase=error 的红三角 + 红点已有） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/topbar.update-pill`：900 中文带字 184px 不压分段；900 英文第 ④ 步收成红点，悬停出全句；今天这一格压上 88px（Bar900 1115）改后 = 0 |

### G 语言 / 深浅 / 平台

| 格 | 状态 | 板上在哪（分镜） | 生产组件 | 断言 · 判据 |
|---|---|---|---|---|
| G1 | 中文浅色 · 中文深色 · 英文浅色 · 英文深色 · Windows（Ctrl） | Main「打开 Nomi（⌘J） · Nomi 在这儿」；Bar700ZhDark「打开 Nomi（⌘J） · Nomi 在这儿 · 3…」；Bar700EnLight「Open Nomi (⌘J) · Just fini…」；Bar700EnDark「Open Nomi (⌘J) · Nomi is h…」；Windows700「打开 Nomi（Ctrl+J） · Nomi 在这儿」；Wide1440「Open Nomi (⌘J) · Nomi is h…」 | i18n：appShell.agent.* / agentPanelV4.collapsePanel（快捷键前缀按平台） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/nomi-entry`：zh / en × 浅 / 深 各跑一遍；Windows 提示写 Ctrl+；`pnpm run check:i18n` |

### H 项目库

| 格 | 状态 | 板上在哪（分镜） | 生产组件 | 断言 · 判据 |
|---|---|---|---|---|
| H1 | 项目库页没有入口 | Main「顶栏」；Main「全局操作」<br>Main / 改后 · 项目库：量得没有分段、没有入口<br>Bar700EnDark / 改后 · 项目库：量得没有分段、没有入口 | `src/workbench/library/ProjectLibraryPage.tsx`（不改） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/library.topbar-no-entry`：项目库页 [data-shell-nomi-entry] 个数 0 |

### I 不压内容

| 格 | 状态 | 板上在哪（分镜） | 生产组件 | 断言 · 判据 |
|---|---|---|---|---|
| I1 | 收起后右下没有东西压着「生成 / 剩余」 | Wide1100「生成剩余」；Wide1100「面板关上，内容区占满整宽；入口回到静止底色，Nomi…」 | `src/ui/app-shell/shell/ShellAgentHost.tsx`（删 AgentBall） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/shell.content-uncovered`：700 / 900 / 1100 / 1440 × 四页：内容区每个可点控件露出那块的中心 + 四个 1/4 点 elementFromPoint 都落回它自己（任一点落到别的东西上就算压住；协调 11-22 定，只取中心点在主分支上量不红），被压住的格子 0；「没有球」改量源码（`nomiEntryLook.test.ts`「没有球（I1 结构判据）」：src 里没人渲染 `data-agent-ball`、`AgentBallFace.tsx` 不在；走查里量锚点个数 0 是空话，`check:walkthroughs` 不许，实现线 11-22 改） |

### K 面板头形态切换

| 格 | 状态 | 板上在哪（分镜） | 生产组件 | 断言 · 判据 |
|---|---|---|---|---|
| K1 | 第一个图标「收起」（原来是小球的点） | Wide1100「收起（⌘\）」；Wide1100「」；Wide1100「浮窗：可拖动、可改大小」；Wide1100「停靠在右侧」；Wide1100「面板头的形态切换（三个图标）：第一个原来是一个点（小…」 | `src/ui/app-shell/shell/ShellAgentHost.tsx` FormSwitch（改；图标 IconLayoutSidebarRightCollapse 进设计系统 §6） | `tests/ux/nomi-entry-topbar.walk.mjs` · `board:NomiEntryTopbar/panel.form-switch`：[data-agent-form-to] 只有 collapse / float / dock，没有 ball；点「收起」面板回到顶栏入口 |

### J 老用户

| 格 | 状态 | 板上在哪（分镜） | 生产组件 | 断言 · 判据 |
|---|---|---|---|---|
| J1 | 存过小球位置（每页一个点） | 数据：`tests/fixtures/old-user-data/agent-form/v0.24.1-local-storage/all-ball.json` | `src/ui/app-shell/shell/agentFormStore.ts`（改：规整时不再读 ball） | `src/ui/app-shell/shell/agentFormStore.migrate.test.ts`：all-ball / mixed 读进来不报错、结果里没有 ball 键、collapsed 照旧；不升存档版本（merge 时丢掉） |
| J2 | 存过小球形态（v1 form=ball / v2 collapsed=true） | 数据：`tests/fixtures/old-user-data/agent-form/v0.24.1-local-storage/mixed.json` | `src/ui/app-shell/shell/agentFormStore.ts` | `src/ui/app-shell/shell/agentFormStore.migrate.test.ts`：升级后这一页面板是收着的、入口在顶栏；⌘J 打开回到这一页默认摆法（生成页浮窗、其余停靠） |

## 分段离两簇（拍板时的逐行量值）

| 行 | 宽 | 入口 | 走到 | 分段左移 | 离左簇 | 离右簇 |
|---|---|---|---|---|---|---|
| Main / 改后 · 创作 | 700 | 脸 | ①— ②✗ ③— ④— | 0 | 142 | 143 |
| Main / 改后 · 生成 | 700 | 脸 | ①— ②✗ ③— ④— | 0 | 142 | 107 |
| Main / 改后 · 预览 | 700 | 角标 2 | ①✓ ②✗ ③— ④— | 0 | 142 | 56 |
| Main / 最挤 · 预览 | 700 | 角标 9+ | ①✓ ②✓ ③✗ ④— | 57 | 44 | 13 |
| Bar700ZhDark / 改后 · 创作 | 700 | 脸 | ①— ②✗ ③— ④— | 0 | 142 | 143 |
| Bar700ZhDark / 改后 · 生成 | 700 | 脸 | ①— ②✗ ③— ④— | 0 | 142 | 107 |
| Bar700ZhDark / 改后 · 预览 | 700 | 角标 9 | ①✓ ②✗ ③— ④— | 0 | 142 | 56 |
| Bar700ZhDark / 最挤 · 预览 | 700 | 角标 9+ | ①✓ ②✓ ③✗ ④— | 57 | 44 | 13 |
| Bar700EnLight / 改后 · 创作 | 700 | 脸 | ①— ②✗ ③— ④— | -0.5 | 109 | 109 |
| Bar700EnLight / 改后 · 生成 | 700 | 角标 1 | ①— ②✗ ③— ④— | -0.5 | 109 | 74 |
| Bar700EnLight / 改后 · 预览 | 700 | 角标 2 | ①✓ ②✗ ③— ④— | -0.5 | 109 | 22 |
| Bar700EnLight / 最挤 · 预览 | 700 | 角标 9+ | ①✓ ②✓ ③✓ ④— | 49.5 | 59 | 13 |
| Bar700EnDark / 改后 · 创作 | 700 | 脸 | ①— ②✗ ③— ④— | -0.5 | 109 | 109 |
| Bar700EnDark / 改后 · 生成 | 700 | 角标 1 | ①— ②✗ ③— ④— | -0.5 | 109 | 74 |
| Bar700EnDark / 改后 · 预览 | 700 | 脸 | ①✓ ②✗ ③— ④— | -0.5 | 109 | 22 |
| Bar700EnDark / 最挤 · 预览 | 700 | 角标 9+ | ①✓ ②✓ ③✓ ④— | 49.5 | 59 | 13 |
| Windows700 / 改后 · 创作 | 700 | 脸 | ①— ②✓ ③— ④— | 7 | 199 | 12 |
| Windows700 / 改后 · 生成 | 700 | 脸 | ①— ②✓ ③— ④— | 43 | 163 | 12 |
| Windows700 / 改后 · 预览 | 700 | 角标 2 | ①✓ ②✓ ③— ④— | 94 | 112 | 12 |
| Windows700 / 最挤 · 预览 | 700 | 角标 9+ | ①✓ ②✓ ③✓ ④— | 153 | 53 | 12 |
| Windows700 / 最挤 · 预览 · 英文（推算） | 700 | 角标 9+ | ①✓ ②✓ ③✓ ④— | 158.5 | 14 | -16 |
| Bar900 / 改后 · 预览 · 中文 | 900 | 胶囊 99px | ①✗ ②✗ ③— ④— | 0 | 242 | 17 |
| Bar900 / 最挤 · 预览 · 中文 | 900 | 胶囊 116px | ①✓ ②✓ ③✗ ④✗ | 134 | 67 | 13 |
| Bar900 / 改后 · 预览 · 英文 | 900 | 胶囊 98px | ①✓ ②✗ ③— ④— | -0.5 | 170 | 52 |
| Bar900 / 最挤 · 预览 · 英文 | 900 | 胶囊 115px | ①✓ ②✓ ③✓ ④✗ | 131.5 | 77 | 12 |
| Bar900 / 最挤 · 预览 · 中文 · 上次更新没装上 | 900 | 胶囊 116px | ①✓ ②✓ ③✓ ④✗ | 150 | 92 | 12 |
| Bar900 / 最挤 · 预览 · 英文 · 上次更新没装上 | 900 | 胶囊 115px | ①✓ ②✓ ③✓ ④✓ | 36.5 | 172 | 13 |
| Wide1100 / (板头) | 1100 | 脸 | ①— ②✗ ③— ④— | 0 | 196 | 343 |
| Wide1100 / 收起之后 | 1100 | 脸 | ①— ②✗ ③— ④— | 0 | 196 | 343 |
| Wide1440 / 改后 · 创作 · 面板开着 | 1440 | 角标 2 | ①— ②✗ ③— ④✗ | -0.5 | 277 | 324 |
| Wide1440 / 改后 · 生成 · 面板收起 | 1440 | 脸 | ①— ②✗ ③— ④— | -0.5 | 277 | 444 |
| Wide1440 / 改后 · 预览 · 面板收起 | 1440 | 脸 | ①✗ ②✗ ③— ④— | -0.5 | 277 | 310 |
| TopBar / (板头) | 700 | 脸 | ①— ②✗ ③— ④— | 0 | 142 | 143 |

「离左簇」= 分段左沿 − 项目菜单右沿；「离右簇」= 右簇左沿 − 分段（连同「画布 / 列表」）右沿。Windows 700 英文那一行是推迟的格，不判。

## 11-22 补定（画布 v16）

- D5「C 不出胶囊」（D-1122-topbar-open-pending-c）：v14 里 Wide1440「改后 · 创作 · 面板开着」画成「Confirm 2」胶囊、没有按下底色，和「面板开着 = 按下 + 收起面板」冲突；用户选 C。画布 v16 的组件规则：胶囊 = 有待确认 && 放得下 && 面板没开；角标 = 有待确认 && 不出胶囊。C4 指 Wide1440 第 2 行，C5（窄窗）画布没画、同 C4。
- D6「放在顶栏入口的脸上」（D-1122-entry-blink-on-face）：眨眼只在入口这张脸上、空闲 / 有新消息时；面板身份行仍是静态脸（A1、A2 两格的脸照此）。

## 画布没画的格

- C5：跟 C4 一个样，实现线不另定长相。
- F2「更新下载中」：按 F1 的宽度规则，走查补一格截图，不新判据。
- E12 回差、J1 / J2 老用户：本来就画不出来，判据在单测和老数据夹具。

