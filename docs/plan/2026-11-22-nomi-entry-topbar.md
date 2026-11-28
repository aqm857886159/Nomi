# 设计卡：Nomi 入口收进顶栏（删右下小球）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：Nomi 入口收进顶栏            线/负责人：实现 L-nomi-entry-topbar（清单线 B-nomi-entry-board 写卡）            类别：[新界面]
```

> 2026-11-22。拍板：用户「全部收进顶栏」（D-1122-agent-ball-to-topbar）、「放顶栏」（D-1122-nomi-entry-in-topbar）、「照这版拍板」（D-1122-topbar-entry-approved，画布 v14：一、入口长相；二、让位顺序 ①–④，③ 先于 ④）；同日补定「C 不出胶囊」（D-1122-topbar-open-pending-c）、「放在顶栏入口的脸上」（D-1122-entry-blink-on-face），画布改到 v16。
> 拍板图清单：`docs/design/boards/2026-11-22-nomi-entry-topbar/NomiEntryTopbar.board.json`；逐态对照表（实现合同）：`docs/design/boards/2026-11-22-nomi-entry-topbar/NomiEntryTopbar.mapping.md`（下文「对照表 X」= 那张表的格号）。
> 四类里碰「新界面」→ 9 格全填；新增功能 → ★0、★7 也填。合并前要另一条线独立验收。
> 调用方：已有函数大多不改行为，有三处例外：
>   - `UpdatePillView` 不再自己按 `max-[899px]` 藏字，只认传进来的 `compact`；
>   - 居民活动投影 `setResidentDockBadge` 多带一个「脸状态」，面板开着也投影；
>   - 形态字面量 `'ball'` 改名 `'collapsed'`，只换名字。
>
> 其余旧函数要么整个删掉（见「删除清单」），要么只换调用方式、自己的行为不变。每个函数和它的全部调用处都在「调用方表」。格子：08-ui。

## ★0 先查别人

- LibTV（同一块界面，协调 2026-11-15 亲自打开截的图，截图 sha256 `16ad8d21…6061623`，面板开着那张 `9546a407…df2f1`，截图不进仓库）· Agent 收起时是画布底部工具条上一颗带名字的按钮；开着时右侧面板头有「—」收起，入口和面板头两处都能关 · **确认了**「入口是开关、面板头也能关」两处都留（设计系统 §1.5.2「一个功能一个家」不冲突）；**改了**位置：它在底部，我们放顶栏，因为我们底部已被画布工具条和时间轴占着，三页里只有顶栏都在。
- TapNow（https://docs.tapnow.ai/zh/docs/agent/chat-with-agent）· 收起时右下角一颗浮动图标，⌘J 叫出 · **改了**：不照做，我们今天就是右下浮球，它压住了生成框的「生成 / 剩余」，这次就是要根治这件事；**确认了**⌘J 不变。
- Google Flow（https://support.google.com/labs/answer/17093911）· Agent 开关在常驻输入栏里，点开是侧面板，生成前先问 · **确认了**：入口住在每页都在的常驻栏里，点开是侧面板，不浮在内容上。
- 仓库先例：`src/ui/app-shell/shell/ShellTopBar.tsx:68–104` `useExportCompact` · 一个 ResizeObserver 量「右簇左沿 − 分段右沿」，收起后按「放回去以后的宽度」判断能不能展开（:88–93 `fullWidth`），不在每一帧算 · **确认了**：让位沿用同样的量法和回差，放进 `topbarYield.ts`，只是把一步扩成四步。
- 出口：不涉及：这次没有新增、扩大或挪动会挡住人的保护。入口只是换了地方，⌘J / ⌘\ 和别处的「叫回」照旧能打开面板；面板开着时点入口就收起。

## ★1 用户怎么用

当我在创作、生成或预览页干活，Nomi 在后台做事或等我点头时，我希望不用找它，一眼就看到它在干什么、有几件事在等我，点一下就打开，并且它不压住我要点的东西。

1. 进项目，顶栏最右是一张 28px 的脸（空闲），右边留 8px；项目库页顶栏没有它。
2. 让 Nomi 做事：脸变圆，外圈蓝弧在转；做完压扁眯眼笑，2.4 秒后回到空闲；出错是歪倒的脸加红点；有新回复时是蓝点。
3. 有事等我确认：放得下（≥900、面板没开）时是浅橙胶囊「等你确认 N」，写全数；窄于 900、放不下或面板开着时是脸加角标（最多写 9+），悬停提示写全数。
4. 点入口（或按 ⌘J）打开到这一页上次的摆法（停靠 / 浮窗）；面板开着时入口是按下的底色，悬停提示是「收起面板（⌘\）…」，再点一下就收起。
5. 窗口变窄时，顶栏按 ① 导出收成图标 → ② 分段往左挪、项目名变短再藏 → ③ 藏进度数字 → ④「新版本」收成小点 的顺序让出位置，分段离左右两簇始终 ≥12px。
6. 面板收起后，内容区占满整宽，右下角不再有东西压着「生成 / 剩余」。

不做：
- 底部入口；
- 拖动、记位置；
- 眼睛跟鼠标；
- 画布 v14 里提过的「先连一个模型」胶囊，以及按镜头增长的进度弧（今天代码里也没有）；
- 浅色下悬停看不出（ink-05 等于顶栏底色）这件事：整条顶栏都一样，另记，这次不改；
- Windows 700 宽英文、几件事全开时那一格（deferred，等 Windows 真机量窗口钮宽度）。

已知坑：
- 今天 `resolveDockStatus`（`src/workbench/ai/v4/agentPanelV4DockStatus.ts:51`）让「等你确认」压过「失败 / 在做」，画布要的是「在做 + 角标」「失败 + 角标」。入口的脸要按「不算待确认」去求状态，见调用方表。
- `ProjectAgentResidentShell.tsx:382` 面板开着时报 `null`，入口在开着时拿不到待确认数，要改成开着也报。
- ① 和 ② 会互相影响：分段左移后 ① 的量会变，必须带回差（★7、对照表 E12）。

真实任务（实现线和验收线都照这三条跑，用真窗口和真项目，不用合成夹具）：
- T1：在生成页让 Nomi 生成 3 个镜头，中途有 2 张付费卡等确认。把窗口从 1440 拖到 700，再拖回来；这期间看入口从胶囊变成角标，再变回来，看顶栏怎么让位。
- T2：英文界面、深色、900 宽，「新版本」装失败（「Last install failed · Click to retry」），预览页带进度数字，3 个任务在跑，还有 120 条等确认。确认走到第 ④ 步，分段不压右簇，胶囊带字。
- T3：用 0.24.1 收成小球、并拖过位置的老用户数据升级，进项目后看三页：没有球、入口在顶栏、面板收着、不报错。

指标（目标 → 信号 → 指标；每条都写了量具）：

| 指标 | 目标 | 量具 | 基线（今天） |
|---|---|---|---|
| 主：内容区里的球 | 没有球：src 生产代码里没人渲染 `data-agent-ball`、`AgentBallFace.tsx` 不在；别的形状的浮动叫回按钮由下一行「被压住的格子」按每个可点控件查 | `src/ui/app-shell/shell/nomiEntryLook.test.ts`「没有球（I1 结构判据）」（主分支上红）。原写的走查量 `[data-agent-ball]` 个数 = 0 是空话（锚点删掉后永远是 0，`check:walkthroughs` 的「锚点已无人渲染」门岗也不许），实现线 11-22 改，★9 第一行、对照表 I1 同步 | 收起时每页 1 个 |
| 主：被压住的格子 | 内容区每个可点控件，在它露出来的那块（被滚动区 / 窗口裁掉的不算）取中心加四个 1/4 点做 `elementFromPoint`，任一点落到别的东西上就算压住；压住的个数 = 0。只取中心点量不出今天的病（1100 分镜表「生成剩余」被球压住右半截字，中心点刚好露在球下沿外，实现线 11-22 在主分支上量得 0），协调 11-22 定改成五点 | 同上走查 | 今天收起时，生成页「生成 / 剩余」被球压住（改后不被压的那颗是画布 Wide1100 候选 1246，对照表 I1） |
| 质量：分段离两簇 | 每一行分段离左、离右都 ≥12px，取最小值 | 同上走查（`board:NomiEntryTopbar/topbar.yield-order`）；板上量值在对照表「分段离两簇」一节 | 900 英文装失败那一格压上 88px（对照表里 Bar900「今天 · 英文 · 没装上」量得离右 −88）；Windows 700 中文预览压上 52px（推算） |
| 护栏：让位顺序 | 每种「几件事全开」走到第几步，和对照表 E 组一致；①↔② 来回拖窗，每个阈值只翻一次 | `src/ui/app-shell/shell/topbarYield.test.ts`（700→1440→700 每 1px 一步）；走查里读 `data-shell-yield-step` | 今天只有 ①，没有回差测试覆盖 ② |
| 护栏：整窗鼠标监听 | 入口和顶栏新增的 window 级 `pointermove` 监听 = 0 | perf 场景 `topbar-yield-resize` 的结构断言；外加 `src/ui/app-shell/shell/nomiEntryLook.test.ts` 旁边的结构测试，用 `git grep` 断言 `pointermove` 不出现在入口文件里 | 1 个（`useAgentBallEyeFollow.ts:80`） |
| 护栏：拖窗手感 | 1440↔700 来回拖窗，帧间隔 p95 ≤33ms，>50ms 的长任务 0 个 | perf 场景 `topbar-yield-resize`（新），见 ★7 | 未验证：缺量具（实现线先建场景再跑基线） |

新手 / 老手：
- 新手第一次进项目，看到右上一张脸，悬停能读到「打开 Nomi（⌘J）· Nomi 在这儿」。
- 老手原来靠右下小球，升级后发现球没了、在顶栏最右，⌘J、⌘\ 照旧。

记录方式：走查每一步截一张图（zh / en 两轨），对照表每个格号旁边写「预期 → 实际」。

### ★1b 连带界面

- 面板头形态切换（`ShellAgentHost.tsx:80–137` FormSwitch）：第一个图标从「一个点」改成「收起」，用 `IconLayoutSidebarRightCollapse`；文案「缩成小球 / Shrink to a bubble」（`src/i18n/locales/appShell.ts:40`、`:107`）改成「收起 / Collapse」。「⋯」菜单（`ShellAgentHost.tsx:348`）跟着改。
- 小球右键菜单（「改成浮窗 / 改成停靠」，`ShellAgentHost.tsx:170–175`）不搬到入口上。入口点开就回到这一页上次的摆法，要换摆法在面板头三选一里换。画布没画入口的右键，这是清单线按「一个功能一个家」定的默认，协调可以改。
- 窄窗提示：「窗口窄，Nomi 先收在这里」（`ballNarrow`，`appShell.ts:49`、`:116`）删掉。窄窗时停靠钮灰掉的提示 `dockNarrow`（`:48`、`:115`）保留，并进面板头。
- 节点指路「回到对话」（`NodePointerReturnDock`）：行为不变。设计系统 `docs/design/nomi-design-system.md:1065` 里「对话先收成小球」改成「对话先收起（入口在顶栏）」。
- 任务中心「定位」和 Agent 自己的 layout.write「叫回」（`agentRecallNonce`，`ShellAgentHost.tsx:286–288`）：行为不变，叫回就是打开到上次的摆法。
- 设计实验室有三屏画了小球，要换成入口：`src/devlab/designLab/nodePointer/nodePointerLabKit.tsx`、`src/devlab/designLab/v4/states/01-vocabulary.tsx`、`src/devlab/designLab/v4/states/03-flow.tsx`。
- 设计系统要改四处：
  - `:881` NomiAgentFace 那一行「右下小球的活形象」改成「顶栏入口的活形象」；
  - `:1248–1249` 两行里的「小球右键菜单」删掉；
  - §6 登记 `IconLayoutSidebarRightCollapse`：Agent 形态「收起」，面板头三选一第一个，`AgentPanelV4Panel.tsx:418–419` 已在用；
  - `:487`「Agent 输入坞的还原是顶栏角标展开面板」和这次一致，不改。
- 概念登记 `docs/engineering/concept-owners/shell.recall-entry.json`：notes 里「顶栏不再放 Agent 角标」「收起 = 内容区右下的小球」改成「收起 = 顶栏最右的入口」；`allowed_consumers` 删 `AgentBallFace.tsx`，加 `ShellNomiEntry.tsx`。
- 旧拍板板上和小球有关的元素，实现线在同一次提交里处理。
  - 不处理的后果：走查删掉小球后，这些元素的断言字串会一起消失，`check:board-parity` R4 会红。
  - 依据：把全部旧清单的 elements 按 `ball|orb|小球` 查一遍，再逐条读说明分组；`states.media-expired` 是「Volleyball」误中，已排除。
  - 分三组：
  - **改 dropped**：`userDecision` 写「全部收进顶栏」，日期 2026-11-22。这一组讲的是小球本身，新设计里没有了，共 12 个：
    - 2026-10-08：Chrome / Main / List / ListDetail 的 `agent.orb`（4 个）。
    - 2026-10-27：AgentPersona 的 `persona.size`（44px 球）、`persona.eyes`（眼睛跟鼠标，本次删）、`ball.behaviors`（拖动 / 点 / 右键）。
    - 2026-10-29：DirectorInPage 的 `agent.ball-above`。
    - 2026-11-07：WindowNarrow 的 `agent.ball-narrow`、`agent.pill-confirm`（窄窗胶囊，现在窄窗出角标）、`agent.ball-hover-tip`、`agent.collapse-motion`。
  - **保留 implemented，断言改到入口上**：这一组的意思新设计照样成立，只是落点从小球换到顶栏入口，走查跟着改，共 14 个：
    - AgentPersona 的 `persona.body`、`persona.tooltip`、`persona.on-dark`、`motion.morph-token`、`state.idle` / `state.running` / `state.needs-confirm` / `state.done` / `state.failed`、`variant.unread`。断言今天都在 `tests/ux/_agentPersonaWalk.mjs`；`state.needs-confirm` 改指入口的胶囊 / 角标，`state.needs-confirm` 和 `variant.unread` 在 `agent-form-switch-state.walk.mjs` 里还各有一处。
    - NodePointer 的 `pointer.narrow.collapse`：机器让开时收起面板，以前收成小球，现在收到入口。
    - SpendCardQ1 的 `dock.pending-count`：收着时看得到待确认数，现在是入口的胶囊 / 角标。
    - DirectorInPage 的 `layer.fills-cell`：9 种组合里「小球」那一列换成「收起」。
    - WindowNarrow 的 `agent.float-narrow`：窄窗点入口打开浮窗。
  - **仍是 missing，说明里的落点改成入口**，共 6 个：
    - AgentPersona 的 `variant.long-task`、`variant.setup`；
    - Onboarding 的 `entry.persona-setup`；
    - 2026-10-08 Creation / CreationDoc 的 `agent.dock.form`、CanvasAgent 的 `agent.float.form`（形态切换第一项改成「收起」）。
    - 这几个是还没做的功能。本板不画也不做，但它们也不是用户否掉的，所以不改 dropped。

### ★1c 老用户

- 存档键 `nomi:shell-agent-form:v1`（版本 2）。
  - 每页的 `collapsed` 照旧读：收着的，升级后面板还是收着，入口在顶栏。
  - v1 里 `form:'ball'` 照今天的规整（`agentFormStore.ts:105`）读成 `collapsed: true`。
  - 每页存的小球位置 `ball`（`:52`、`:93` `readBallPoint`、`:128`）不再读，下次写回时自然丢掉。
  - 不升存档版本，不写迁移。
- 不报错：唯一的规整函数 `normalizeStoredAgentForm` 只读认识的键，多出来的 `ball` 直接忽略。
- 退回 0.24.x：老版本读不到 `ball` 时走 `defaultBallPoint`，球出现在默认的右下角，其余照常。
- 证据：
  - 用真实旧版本落下的数据：`tests/fixtures/old-user-data/agent-form/v0.24.1-local-storage/all-ball.json`、`mixed.json`。
  - `src/ui/app-shell/shell/agentFormStore.migrate.test.ts` 要改两处今天的期望，再加一条新的：
    - `:65` 现在断言 `prefs.ball` 等于旧值，改成「结果里没有 `ball`」；
    - `:88` 存下来的键是 `['ball','collapsed','float','placement']`，改成去掉 `ball`；
    - 新加：all-ball 读进来，每页 `collapsed === true`，不抛错。
  - PR 交 `upgrade-path` 证据。

## ★2 谁说了算

| 概念 | 唯一 owner | 允许谁读 | 这个「1」靠什么保持 |
|---|---|---|---|
| 这一页的面板收着还是开着（形态） | `src/ui/app-shell/shell/agentFormStore.ts`（`useShownForm` / `shownForm`），概念 `shell.recall-entry`，不变 | 外壳宿主、`WorkbenchShell`、入口（按下底色 = 形态不是收起） | 写只走 `openAgent` / `collapseAgent` / `machineHold`（`node scripts/door-map.mjs collapseAgent`：1 个文件；`machineHold`：2 处写）；入口只调 `openAgent` / `collapseAgent`，自己不存形态 |
| 入口的脸、角标、点、胶囊还是角标 | `src/ui/app-shell/shell/nomiEntryLook.ts`（新，一个纯函数），取代 `agentBallIsPill` / `agentBallLook`（`agentFormStore.ts:341–359`，同一次提交删掉） | 只有 `ShellNomiEntry.tsx` | 原料只有一处：`useResidentActivityStore`（`src/workbench/ai/residentActivity.ts`），由 `ProjectAgentResidentShell` 投影。别处拿不到 pending / unread / 状态，也就做不出第二套 |
| 顶栏让到第几步 | `src/ui/app-shell/shell/topbarYield.ts`（新），取代 `useExportCompact`（`ShellTopBar.tsx:68–104`，同一次提交删掉；door-map：唯一调用 `:255`） | `ShellTopBar`（导出、分段位置、进度数字、`UpdatePill compact`） | 只有这一个函数量和判；`UpdatePillView` 原来自己按 `max-[899px]` 藏字（`UpdatePill.tsx:59`、`:61`），改成只认传进来的 `compact`，不再自己按断点判 |
| 待确认条数、未读条数 | `ProjectAgentResidentShell`（`:351` 算、`:382` 投影），不变 | 入口 | 只是开着也投影，数的口径不变 |

- 碰了 1 个已登记概念（`shell.recall-entry`），只改 notes 和读者名单，不新增概念。
- 不靠「东西不见了」猜用户意图：收起 / 打开都是用户点了或按了快捷键的显式事件。
- 到点以后谁跟：「刚做完」2.4 秒回空闲由 `useV4DockStatus` 掐表（`V4_DOCK_DONE_HOLD_MS`），不变。
- 不知道当没有：
  - `residentActivity` 没挂载（没开项目）时报 `null`，入口不画，项目库就是这样，对。
  - 挂载了但还没算出来时，按空闲画，不当失败。

## ★3 一致与复用

以前定过的（清单 `priorDecisions` 全文 12 条，这里只列会改动作的）：
- 10-08 外壳：「顶栏不放 Agent 角标；收起就是内容区右下的小球」。这次和它冲突，同一次提交改掉（概念 notes、旧板元素，见 ★1b）。
- 10-27 形象：44px 小球、132px 胶囊、眼睛跟鼠标，不算数了，尺寸按本板的 28px 按钮、26px 脸重定。五种状态、不报预计时间、面板身份行用静态脸，这几条照旧算数。
- 窄窗：导出离分段不足 12px 就收图标，项目名放不下两个字就藏。照旧算数，就是 ① 和 ②。「分段整窗居中」在挤的时候不再成立，宽的时候照旧。
- 设计系统「工作区浮层必须可关闭」和 §1.8.1「一屏一个主动作」都一致：顶栏主动作仍只有「导出 MP4」，胶囊和「新版本」只是状态提示。

三条路：
- 沿原方向修（让小球避开内容，比如贴边或自动躲）：设计系统 `:487` 说「避让只是次选，不能代替关闭权」。不管躲到哪，总会压到另一块内容，同一类问题会从另一个控件回来。不选。
- **换做法（选）**：入口住进每页都在的顶栏，内容区里不再有浮着的东西，压住内容这件事从结构上就做不出来。
- 删掉（只留 ⌘J）：创作者看不到 Nomi 在做什么、几件事在等，等确认的付费卡会卡着没人知道。这就是 ★9 的反例「全部拦下」。不选。

复用：

| 东西 | 位置 | 怎么用 |
|---|---|---|
| `NomiAgentFace`（live） | `src/design/identity.tsx` | 复用；眨眼 `useAgentBlink` 在 `:225`，只在空闲 / 有新消息时眨（`:252`），符合 D-1122-entry-blink-on-face |
| `DotMark` | — | 复用 |
| `BarTooltip` | `ShellTopBar.tsx` | 复用 |
| `BAR_ICON_BUTTON` | `ShellTopBar.tsx:43`（真在用的那份，带 `ICON_TIER_CLASSES.bar`） | 复用；静止、悬停、按下、焦点四态和旁边图标钮一致。`src/ui/app-shell/shell/barIconButton.ts` 是一份没人引用的副本（`git grep barIconButton` 在 src 里 0 处引用），还少了图标档位。入口拆在自己的文件里，要引这份样式，所以同一次提交把 `ShellTopBar.tsx:43` 那份连同图标档位搬进 `barIconButton.ts`，`ShellTopBar` 和入口都从这里引，原处删掉，只留一个家 |
| `UpdatePillView` 的 `compact` 入参 | `UpdatePill.tsx:29`、`:36` | 已有；`UpdatePill`（`:67`）今天没往下传，改成传 |
| 胶囊长相 | `AgentBallFace` | 照搬后删原件 |
| `NomiStepper` | `identity.tsx:372` | 加「藏数字」开关，`title`（`:405`）照旧带数字 |

- 自写登记：没有新的通用能力，不涉及（让位是顶栏自己的布局规则，量法沿用现有 ResizeObserver）。
- 查不到：有没有人试过「顶栏入口」又退回去。`git log --grep` 找「顶栏 Agent」只找到 10-08 那次删顶栏角标，原因是「顶栏不放 Agent 角标」，这次用户明确改了这条。

## ★4 全状态

| 状态 | 用户看到什么 |
|---|---|
| 空 | 项目库页：没有入口（对照表 H1）。进项目什么事都没有：一张空闲的脸，透明底，无点无角标（A1）。 |
| 加载 / 在做 | 脸变圆，外圈蓝弧转；减弱动效下不转（A3）。 |
| 成功 | 刚做完压扁眯眼笑，2.4 秒回空闲（A4）。 |
| 失败 | 歪倒 + 红点；有待确认时只出角标，不叠红点（A5、B6）。 |
| 部分成功 | 不适用：入口只报 Agent 整体状态，哪一步成哪一步没成在面板里看。 |
| 取消中 | 用户在面板里停掉一轮：回合结束前仍是「在做」，结束后回空闲；入口自己没有取消动作。 |
| 过期 | 不适用：入口不显示时间、不缓存结果。 |
| 能力不可用（没连模型） | 入口照样是空闲的脸，点开面板，面板里已有「先连一个模型」的下一步。入口不画专门的胶囊，画布 v14 没画，不做。 |
| 等你确认 | 放得下且面板没开：胶囊「等你确认 N」（C1），120 条也写全数（116px，B4）。窄于 900、放不下或面板开着：脸 + 角标，最多写 9+（B3、C2、C4、C5）。 |
| 面板开着 | 按下底色，悬停「收起面板（⌘\）· …」（D3、C4）。 |
| 「新版本」三种字 | 有新版本 / 更新下载中 / 上次没装上 · 点一下重试，第 ④ 步收成点（F1–F3）。 |

会被数据撑开的地方：角标 9+；胶囊 120 条（「等你确认 120」116px、「Confirm 120」115px）；最长的「新版本」（「上次没装上 · 点一下重试」，900 中文宽 184px）；最长悬停提示（「Open Nomi (Ctrl+J) · Nomi is here · New messages: 120」）；项目名（900 宽只剩 35–50px 或藏起）。逐条在清单 `boundarySheet` 和对照表 B4、D5、F3。

文案（zh / en）：
- 原来的 `appShell.agent.ballOpen` / `ballPending` / `ballUnread` 改名为 `entryOpen` / `entryPending` / `entryUnread`，文字不变。
- `toBall` 改成「收起 / Collapse」。
- 删 `ballNarrow`。
- 面板开着时借 `agentPanelV4.collapsePanel`。
- 快捷键前缀按平台写（⌘ / Ctrl+）。
- 不写任何谈钱的字。
- 证据：`pnpm run check:i18n`。

## 5 中途表

| 状态 \ 打断 | 停（在面板点停） | 关窗 | 断网 | 重启 | 连点入口 |
|---|---|---|---|---|---|
| 空闲 | 不适用 · 不花钱 · — | 下次打开照存档的收 / 开 · 不花钱 · — | 不影响入口 · 不花钱 · — | 同关窗 · 不花钱 · — | 开 / 收来回切，每次点一下就是一次切换，不排队 · 不花钱 · 形态存进 `agentFormStore` |
| 在做 | 回合结束后回空闲 · 花费照面板那一轮的规则 · 回执在面板 | 回合随项目关掉而停，下次是空闲的脸 · 同面板 · 面板流里 | 面板报错，入口变「有一步没成」+ 红点 · 同面板 · 面板错误带 | 同关窗 · 同面板 · 面板流里 | 只切面板开关，不影响回合 · 不花钱 · — |
| 等你确认 N | 待确认还在，角标不变 · 没点确认就不扣 · 面板里的确认卡 | 待确认随项目恢复，按面板规则 · 没点就不扣 · 面板 | 角标不变 · 没点就不扣 · 面板 | 同关窗 · 没点就不扣 · 面板 | 只切面板，不会帮你点确认 · 不扣 · 面板 |
| 有一步没成 | 红点留到你看过面板 · 同面板 · 面板错误带 | 下次是空闲的脸（失败是这一轮的） · — · 面板流里 | 照旧红点 · — · 面板 | 同关窗 · — · 面板 | 只切面板 · — · — |
| 面板开着 | 照旧按下底色 · — · — | 下次照存档开着 · — · — | 不影响 · — · — | 同关窗 · — · — | 收起再打开，回到上次的摆法 · — · `agentFormStore` |

入口自己不花钱、不发请求，花费一律跟面板里那一轮走。证据：真窗口走查（实现线按这张表走一遍，记 `unverified` 的格子写原因）。

## 6 外部数据与失败

- Windows 窗口钮宽度：靠 `env(titlebar-area-width)` 让出（`ShellTopBar.tsx:263–264`）。画布按常见的 138px 推算，偏差未知，Windows 700 英文那一格因此推迟。拿不到 env 时退回今天的右边距，入口照样在最右。规范：https://developer.mozilla.org/docs/Web/CSS/env （titlebar-area-*）。
- 更新状态：来自 electron 更新器（`UpdatePill` 的 phase：available / downloading / error），这次不改，只改「放不下时收成点」由谁判。
- 没有供应商 API，也没有用户输入。

## ★7 性能

1. 新增的用户操作：点入口（开 / 收面板）、悬停入口出提示、拖窗口边触发让位、Agent 流式输出时入口跟着变（状态、待确认、未读）。
2. 最坏规模：700 宽，几件事全开（新版本 + 3 个任务 + 等你确认 120 + 分段进度数字）；同时 Agent 在流式吐字（12 字一帧、120ms 一帧）；项目里 96 个节点。
3. 预算：
   - 点入口到面板可见：≤100ms，p95 ≤150ms。
   - 拖窗口边时帧间隔 p95 ≤33ms，>50ms 的长任务 0 个。
   - 流式输出期间，只有状态、待确认数、未读数这三样变了入口才重渲；`setResidentDockBadge` 同值短路（`residentActivity.ts:50`），不跟每个 token 动。
   - 没有 window 级鼠标监听，删掉 `useAgentBallEyeFollow.ts:80` 那一个。
   - 让位不每帧算：只在 ResizeObserver 回调里量（顶栏、左右簇、分段），一次回调最多改一次步数，不开 rAF 循环。
4. 场景：
   - 新登记 `tests/perf/scenarios/topbar-yield-resize.json`：照 `window-narrow-drag.json` 的写法，进预览页、几件事全开，1440 ↔ 700 来回三次。
     - 量 `frameGapP95` 和 `longTasks`，预算 33（`budgetStatus: proposed`）。
     - 结构断言：`data-shell-yield-step` 每个阈值来回只翻一次；整窗 `pointermove` 监听数 = 0。
   - 同一次提交删掉 `tests/perf/scenarios/agent-ball-eye-follow.json`、`tests/perf/canvas-scale/agentBallEyeFollowScenario.mjs`，以及 `tests/perf/canvas-scale-bench.mjs:43` 的 import 和 `:998–1004` 的硬断言。
   - 基线：未验证，量具待建，由实现线建好后跑 `pnpm run perf:scenarios -- --id topbar-yield-resize`。PR 交 `perf-scenario：topbar-yield-resize 中位数 X / p95 Y / 预算 33`，超预算不合并。

## 8 真实条件

| 条件 | 状态 |
|---|---|
| Windows | `unverified`：窗口钮 138px 是推算，Windows 900 也没画；要伙伴机真机量（只量，不在 #1586 留言，D-1121-partner-off） |
| 英文界面 | 走查 zh / en 两轨 |
| 最小窗口 | 700 |
| 深色 | 走查浅 / 深两轨 |
| 键盘全程 | Tab 到入口有 2px 描边；⌘J 打开并聚焦输入框；⌘\ 开 / 收 |
| 干净安装 | 项目库页没有入口 |
| 老数据 | 0.24.1 的真实存档 |
| 真付费 | 不适用：入口不花钱；T1 里的付费卡用免费演练夹具摆出来，只看角标 |

截图由实现线自己亲眼 Read 过再交。

## 拍板图清单：链接

- 清单：`docs/design/boards/2026-11-22-nomi-entry-topbar/NomiEntryTopbar.board.json`，23 个元素：missing 18、deferred 1、dropped 4。
- 逐态对照表：`docs/design/boards/2026-11-22-nomi-entry-topbar/NomiEntryTopbar.mapping.md`，42 格。
- 板源：画布 v16 原样（`source/`），每张板的图在 `preview/`。
- 门岗：`pnpm run check:board-parity`。

## ★9 验收与回滚

验收（另一条线，编号不得和实现线相同）：只核对照表的 42 格和下面这份清单。走查 `tests/ux/nomi-entry-topbar.walk.mjs` 每条断言名是 `board:NomiEntryTopbar/<元素 id>`，跑 zh / en × 浅 / 深 × 700 / 900 / 1100 / 1440；单测 `nomiEntryLook.test.ts`、`topbarYield.test.ts`、`agentFormStore.migrate.test.ts`；perf `topbar-yield-resize`。

验收清单：

| 检查项 | 判据 | 对照表格 |
|---|---|---|
| 没有球 | src 生产代码里没有人渲染 `data-agent-ball`、`AgentBallFace.tsx` 不在（结构单测 `nomiEntryLook.test.ts`「没有球（I1 结构判据）」；走查里量 `[data-agent-ball]` = 0 是空话——锚点删掉后永远是 0，`check:walkthroughs` 的「锚点已无人渲染」门岗也不许，实现线 11-22 改） | I1 |
| 不压内容 | 内容区可点控件被压住的个数 = 0 | I1 |
| 入口在最右 | 入口右沿到顶栏右沿 = 8px（Windows 让出窗口钮后同样 8px）；项目库没有入口 | D1、H1 |
| 五种脸 | `data-status` = idle / unread / running / done / failed，各有截图 | A1–A5 |
| 待确认 | 1 / 9 / 12 / 120；角标 9+，提示写全数；胶囊写全数 | B1–B4 |
| 状态和待确认并存 | 在做 + 2 → 脸 running + 角标 2；没成 + 1 → 无红点 | B5、B6 |
| 胶囊还是角标 | ≥900 放得下 → 胶囊；<900 → 角标；第 ④ 步后胶囊照样带字；面板开着（宽、窄）→ 按下的脸 + 角标，提示以「收起面板（⌘\）」开头 | C1–C5 |
| 交互 | 静止、悬停、按下、焦点和旁边「设置」钮的样式一致 | D1–D4 |
| 最长提示 | 一行不截断 | D5 |
| 让位 | 每个宽度最挤那一行走到第几步和左列一致；分段离两簇 ≥12px；宽窗不让；来回拖不抖 | E1–E12（E6 推迟，只记量值） |
| 「新版本」 | 三种字；900 英文装失败今天压 88px，改后 = 0 | F1–F3 |
| 平台 | Windows 写 Ctrl+ | G1 |
| 形态切换 | 只有收起 / 浮窗 / 停靠，没有 ball | K1 |
| 老用户 | 存过位置 / 形态的数据不报错，面板照收 | J1、J2 |

反例（验收线先把实现换成这几种没做成的版本跑目标测试，都必须红）：

| 反例 | 怎么做出来 | 应该红在哪 | 为什么红 |
|---|---|---|---|
| **什么都不做** | 留着今天的代码 | I1：`[data-agent-ball]` ≥1；1100 生成页小球压住「生成 / 剩余」，被压住的格子 ≥1；A–D 组全部红 | 顶栏没有 `[data-shell-nomi-entry]` |
| **全部拦下** | 删掉小球，顶栏也不放入口，只剩 ⌘J | I1 会过（没有球、没压住），但 A1–A5、B1–B6、C1–C5、D1–D5、G1 全红；K1 点「收起」后找不到入口 | 入口个数 = 0；这一版正是用户否掉的「只剩快捷键」 |
| 入口还浮在内容区（比如挪到右上角） | 入口 fixed 定位在内容区 | I1 被压住的格子 ≥1；D1「入口在顶栏里」红 | 入口不是 header 的子元素 |
| 脸照旧用 `resolveDockStatus` | 不改求状态的方式（`resolveDockStatuses` 的 faceStatus 照合并规则求） | B5 红：单测 `agentPanelV4DockStatus.test.ts`「在做 + 待确认 2 → 脸 running」（走查直接往 store 写脸的状态，量不到宿主怎么求） | 在做 + 待确认时脸变成 needs-confirm，不转 |
| 面板开着仍出胶囊 | 不改形状规则 | C4 红 | `data-shape=capsule` 且 aria-pressed=true |
| ④ 先于 ③ | 让位顺序写反 | E9 红 | 900 中文装失败那一格会提前收「新版本」 |
| 让位只看当前宽度、不带回差 | 去掉回差 | E12 红 | 来回拖时同一宽度结果不一致，阈值翻不止一次 |
| 老数据里有 `ball` 就抛错 | 规整函数不认 `ball` 键时报错 | J1 红 | all-ball 读进来抛错 |
| 只改了中文文案 | 英文漏改 | G1、D5 英文轨红 | `check:i18n` 也会红 |

这一类会从哪里回来：
- 别的页面自己再放一个浮动叫回按钮：概念 `shell.recall-entry` 写明「页面不许再各放一个叫回按钮」，`allowed_consumers` 只有外壳、入口和 `WorkbenchShell`。
- 新的浮在内容上的东西压住控件：走查的「被压住的格子」检查是按每个可点控件查的，不是只查「生成 / 剩余」这一个。
- 新的状态源绕过 `residentActivity`：入口只读那一个 store。

回滚：revert 实现 PR 的合并提交。存档前后兼容（不升版本，老版本读不到 `ball` 就走默认位置），回滚后不用迁移。

独立验收报告：实现 PR 的 `## 独立验收` 一节放链接和验收线编号。

## 删除清单（实现线同一次提交删掉，不留并行版）

`src/ui/app-shell/shell/agentFormStore.ts`：

| 行 | 东西 | 处理 |
|---|---|---|
| :45 | `BallPoint` | 删 |
| :52 | `SurfacePrefs.ball` | 删 |
| :65 | `BALL_SIZE` | 删 |
| :77、:139 | `setBallPoint` | 删 |
| :93 | `readBallPoint` | 删 |
| :128 | 规整时读 `ball` | 删 |
| :195 | `useNarrowHeldBall` | 删 |
| :289 | `defaultBallPoint` | 删 |
| :293 | `clampBall` | 删 |
| :301 | `BALL_CLICK_SLOP_PX` | 删 |
| :308 | `createBallDragClickGuard` | 删 |
| :341 | `agentBallIsPill` | 删 |
| :345 | `AgentBallLook` | 删 |
| :352 | `agentBallLook` | 删 |
| :40、:160–168、:234、:257–269 | 形态名 `'ball'`（内存里的形态、机器让开的参数，不落盘） | 定：同一次提交改名 `'collapsed'`，只换名字，不改行为（★9 K1 要求界面和代码里都没有 ball 这一态）。连带 `ShellAgentHost.tsx:287`、`:317`、`:321`，`revealNodeFromChat.ts:52–53`、`:70` 的字面量 |
| :105 | v1 存档里的 `form === 'ball'` | **不改**：这是老用户磁盘上真实存着的值，读的时候要认它（★1c）。改了老数据会退回默认摆法 |
| :67 | `EDGE_GAP` | 浮窗还在用（:275–277），保留 |
| :70 | `NARROW_MOTION_CLEAR_MS` | 停靠的滑入还在用，保留，注释里删掉 gather |

`src/ui/app-shell/shell/ShellAgentHost.tsx`：

| 行 | 东西 | 处理 |
|---|---|---|
| :38、:42、:43 | `clampBall` / `createBallDragClickGuard` / `defaultBallPoint` 的 import | 删 |
| :58 | `PILL_WIDTH` | 删 |
| :75 | `BallIcon` | 删 |
| :139–209 | `AgentBall` 整个，含 :178 小球的 `Rnd` 拖动、:197 收拢动画、:198 `data-agent-ball-narrow`、:170–175 和 :206 右键菜单 | 删 |
| :365 | 渲染小球 | 删 |
| :84 | FormSwitch 第一项 | 换成「收起」 |
| :348 | 菜单 `form-ball` | 换成「收起」 |
| :218 | 浮窗的 `Rnd` | 保留 |

其它文件：

| 文件 | 行 | 东西 | 处理 |
|---|---|---|---|
| `src/ui/app-shell/shell/AgentBallFace.tsx` | 整个（:55 `data-agent-ball`） | 小球外观 | 删，连同 `AgentBallFace.test.ts` |
| `src/ui/app-shell/shell/useAgentBallEyeFollow.ts` | 整个（:80 整窗 `pointermove`） | 眼睛跟鼠标 | 删，连同 `useAgentBallEyeFollow.browser.test.ts` |
| `tailwind.config.ts` | :901、:931 | `nomi-agent-gather` 关键帧和动画 | 删 |
| `src/i18n/locales/appShell.ts` | :49、:116 | `ballNarrow` | 删 |
| 同上 | :40、:107 | `toBall` | 改成「收起 / Collapse」 |
| 同上 | :43–45、:110–112 | `ballOpen` / `ballPending` / `ballUnread` | 改名为 `entry*`，文字不变 |
| `src/ui/app-shell/shell/ShellTopBar.tsx` | :68–104 | `useExportCompact` | 搬进 `topbarYield.ts`，原处删 |
| 同上 | :43 | 本地的 `BAR_ICON_BUTTON` | 搬进 `barIconButton.ts`（覆盖那份没人引用的旧副本），原处删 |
| 同上 | :296–300 | 分段死居中的绝对定位 | 改成按让位走 |
| 同上 | :352 | `<UpdatePill host="appbar" />` | 改成传 `compact` |
| `src/ui/app-shell/UpdatePill.tsx` | :59、:61 | 自己按 `max-[899px]` 藏字 | 删，只认 `compact` |
| perf | — | 小球眼睛跟随场景 | 删三处，见 ★7 |
| `tests/ux/_shell.mjs` | :44 | `AGENT_BALL` | 改成入口选择器 |
| 走查 / 测试 | — | 小球相关写法 | 同一次提交改，见下 |

要同一次提交改的走查 / 测试（按 `git grep` 查得含 `data-agent-ball`、`AgentBallFace`、`agentBallLook` 等写法）：
- 走查：
  - `tests/ux/shell-redesign.walk.mjs`
  - `tests/ux/window-narrow-shell.walk.mjs`
  - `tests/ux/director-layer-in-page.walk.mjs`
  - `tests/ux/agent-v4-short-film.walk.mjs`
  - `tests/ux/agent-form-switch-state.walk.mjs`
  - `tests/ux/agent-spend-card.walk.mjs`
  - `tests/ux/agent-timeline-ops.walk.mjs`
  - `tests/ux/agent-timeline-receipt.walk.mjs`
  - `tests/ux/agent-runtime-walk-support.mjs`
  - `tests/ux/_agentPersonaWalk.mjs`
  - `tests/ux/design-lab-node-pointer.walk.mjs`
  - `tests/ux/docs-media.record.mjs`
  - `tests/ux/editing-real-user-pass.walk.mjs`
  - `tests/ux/layout-timeline-panel-span.walk.mjs`
  - `tests/ux/_shell.test.mjs`
- 脚本：`scripts/check-walkthroughs.node-test.mjs`
- 单测：
  - `src/ui/app-shell/shell/ShellAgentHost.formProbe.test.tsx`
  - `src/ui/app-shell/shell/agentFormStore.test.ts`
  - `src/ui/app-shell/shell/agentFormProbe.testkit.ts`（:134、:140）
  - `src/workbench/ai/v4/agentPanelV4Blocks.test.ts`
  - `src/workbench/modalInputLayerCensus.test.ts`
  - `src/design/loadingMark.structure.test.ts`（:37 期望的使用者名单里 `AgentBallFace.tsx` 换成入口文件）
- 基线：`scripts/accent-outline-baseline.json`、`scripts/vocabularies-baseline.json`，只减不增。

## 调用方表

调用方：已有函数大多不改行为，例外三处，表里「行为」一列标了 **变**。下表是这次碰到的每个函数和它的全部生产调用处，由 `node scripts/door-map.mjs <符号>` 数出来（2026-11-22，扫 src 和 electron，不含测试）。设计实验室的调用也算，一起列。

| 函数 | 全部调用处 | 这次怎么动 | 行为 |
|---|---|---|---|
| `clampBall` | `ShellAgentHost.tsx:158` | 删 | 随小球一起删，没有别的调用方 |
| `agentBallLook` | `AgentBallFace.tsx:29` | 删，由 `nomiEntryLook` 取代 | 新函数：脸按「不算待确认」求，待确认单独出胶囊 / 角标 |
| `agentBallIsPill` | `ShellAgentHost.tsx:153`、`agentFormStore.ts:353`（`agentBallLook` 里） | 删，由 `nomiEntryLook` 取代 | 新规则：胶囊 = 有待确认 && 放得下 && 面板没开（D5） |
| `useExportCompact` | `ShellTopBar.tsx:255` | 搬进 `topbarYield`（成为 ①） | ① 的判据和回差不变 |
| `useV4DockStatus` | `ProjectAgentResidentShell.tsx:352` | **变**：返回 `{ status, faceStatus }` | 一次求两份（纯函数 `resolveDockStatuses`）：合并状态给悬停提示中段，脸的状态不算待确认；宿主只调这一次，同一个「刚做完」2.4 秒的表。原写法「同一个 hook 再调一次、传 `pendingCount: 0`」没人测、能悄悄改回去，协调 11-22 定合成一个（B5 反例因此能红） |
| `resolveDockStatus` | `agentPanelV4DockStatus.ts:105`（只在 `useV4DockStatus` 里） | 不改 | 优先级和测试（`agentPanelV4DockStatus.test.ts:22`、`:26`）一字不动 |
| `dockStatusLabel` | `ShellAgentHost.tsx:163`（小球提示，搬到入口）、设计实验室 `01-vocabulary.tsx:264`、`03-flow.tsx:93` | 不改 | 入口提示中段 = `dockStatusLabel(合并状态, 待确认数)`，和今天小球一样。所以「在做 + 等确认 2」的提示是「打开 Nomi（⌘J）· 等你确认 2 条」（画布候选 634） |
| `setResidentDockBadge` | `ProjectAgentResidentShell.tsx:382`（经 `:380` 取出的 `publishDockBadge`）、`:384`（卸载清零） | 多带一个「脸状态」参数；`:382` 从「收起才报」改成「一直报」 | **变**：投影的形状多一个字段。读它的只有今天的 `ShellAgentHost.tsx:142–144`（随小球删）和新入口 |
| `collapseAgent` | `ShellAgentHost.tsx:109`（形态切换）、`:322`（⌘\）、`:338`（E2E 桥）、`:348`（「⋯」菜单） | 不改 | 收起后形态叫 collapsed，入口在顶栏 |
| `openAgent` | `ShellAgentHost.tsx:160`（点小球，搬到入口）、`:287`（叫回）、`:317`（⌘J）、`:321`（⌘\）、`:338`（E2E 桥）、`revealNodeFromChat.ts:95` | 不改 | — |
| `shownForm` | `agentFormStore.ts:258`、`ShellAgentHost.tsx:287`、`:314`、`:338`、`revealNodeFromChat.ts:52` | 不改 | 只随改名换字面量（`'ball'` → `'collapsed'`） |
| `useShownForm` | `ShellAgentHost.tsx:266`、`WorkbenchShell.tsx:234` | 不改 | 入口用它判断按下底色：形态不是 collapsed，就是面板开着 |
| `machineHold` | `revealNodeFromChat.ts:70`（让开）、`ProjectAgentResidentShell.tsx:284`（`'open'`） | 不改 | 让开就是收起面板，以前收成小球，以后收到顶栏入口；参数随改名换成 `'collapsed'` |
| `useMachineGaveWay` | `NodePointerReturnDock.tsx:20` | 不改 | 「回到对话」那一枚照旧按让位算 |
| `UpdatePill` | `ShellTopBar.tsx:352` | 加可选 `compact` 往下传 | 不传 = 带字 |
| `UpdatePillView` | `UpdatePill.tsx:75`、设计实验室 `updateReminderLabKit.tsx:210`、`:243`（都已显式传 `compact`） | 删掉自己的 `max-[899px]:hidden`（:59、:61） | **变**：窄于 900 收不收字只看 `compact`。生产里由 `topbarYield` 第 ④ 步给；实验室两处本来就传，不受影响 |
| `NomiStepper` | `ShellTopBar.tsx:301`、设计实验室 `03-structure.tsx:83` | 加可选的「藏数字」开关，默认不藏 | 不传就和今天一样 |
| `ShellTopBar` | `WorkbenchShell.tsx:332`、`ProjectLibraryPage.tsx:684`、设计实验室 `updateReminderLabKit.tsx:232` | 加入口槽，只有工作台传 | 项目库和实验室不传，所以没有入口 |
| 形态字面量 `'ball'` | 见删除清单那一行 | 改名 `'collapsed'` | **变**（只是名字）：v1 存档里的 `form === 'ball'` 照旧认 |

## 实现线备注

- ①↔② 回差：判断要不要收，看「现在的空当 <12」；判断能不能放回，按「放回以后的宽度」算出的空当仍 ≥12 才放。和 `ShellTopBar.tsx:88–93` 的 `fullWidth` 同一个写法，四步每一步都这么做。② 挪了分段以后，① 的量要在同一次回调里重算，不能等下一次 resize。
- ③ 的数字来自 `useStepperMeta`（`WorkbenchShell.tsx:165` 定义、`:238` 调用），藏的只是显示，`title` 照旧带数字。
- ④ `UpdatePillView` 已有 `compact`（`UpdatePill.tsx:29`、`:36`），今天 `UpdatePill`（`:67`）没往下传，`ShellTopBar.tsx:352` 也没传。
- 「等你确认」胶囊在 Mac 所有画过的格子里都不用收，只有窄于 900 才换角标。Windows 900 没画，推算要走到第 ④ 步。
- Windows 700 英文全开时，四步走完还差约 28px（对照表 E6，推迟）。等 Windows 真机量了窗口钮宽度再定，这次不另想第 ⑤ 步。
- 今天就有的毛病，这次顺带修好：
  - 900 宽英文「Last install failed · Click to retry」：导出收成图标以后，分段仍压上 88px（对照表 Bar900「今天 · 英文 · 没装上」量得离右 −88）。中文同一格正好贴边，差 0.1px。
  - Windows 700 中文预览压上 52px（推算）。
- 量具：协调量画布用的是 `/Users/aoqimin/Nomi-coord/tmp/coord-topbar/measure.mjs`，量的是分段连「画布 / 列表」钮离左右两簇的距离，不取整。走查的「分段离两簇 ≥12」照同一口径量。
- 设计系统 §6 登记 `IconLayoutSidebarRightCollapse`（Agent 形态「收起」，`AgentPanelV4Panel.tsx:418–419` 已在用）。
- 角标右沿收在按钮里（right 0、top −4），不探进右边 8px 留白。
- 悬停文案照今天 `ShellAgentHost.tsx:163–169` 的拼法 `[动作, 状态, 未读].join(' · ')`：
  - 胶囊时动作 =「等你确认 N」（今天的 `ballPending`，改名 `entryPending`）；
  - 面板开着时动作 =「收起面板（⌘\）」，借 `agentPanelV4.collapsePanel`，这是它唯一的新用法；
  - 中段「状态」用合并状态（待确认压过在做 / 失败，和今天一样）。脸用的是不算待确认的状态。所以入口要拿两样：合并状态给提示，脸状态给脸。见调用方表 `useV4DockStatus` 一行。
  - 画布便签 638 写「在做看悬停提示」，但画出来的提示（候选 634、706）是「打开 Nomi（⌘J）· 等你确认 2 条」，没有「在做」。清单和对照表 B5 按画出来的提示写，因为画布组件的拼法就是这样，而且在做已经由转圈的脸表达了。这处不一致已报协调。
- 眨眼只在入口这张脸上，只在空闲 / 有新消息时眨（D-1122-entry-blink-on-face）；面板身份行（`NomiIdentityRow`）仍是静态脸。
