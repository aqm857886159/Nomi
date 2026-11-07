# 方向检查：Agent 面板宽度被窗口大小写回存档（WorkbenchShell 第 3 刀）

写于 2026-11-08，origin/main 745b3c5b4。作者：没参与过前几轮的复盘线。材料：用户 11-07 原话、调研线真截图（R-window-narrow §2.3）、代码、git 历史、一次浏览器实测（见 §6）。放进 PR 时拷到 `docs/engineering/direction-checks/`，提交里写 `Direction-Check: docs/engineering/direction-checks/2026-11-08-workbench-shell-width-writeback.md`。

## 0. 一句话根因

「视口钳过的宽度」（显示值）和「用户拖出来的宽度」（意图）共用同一个存档字段 `editingPanelLayout.assistantWidth`，而写这个字段的口把视口也算进了钳：窗口一变窄，显示值就被当成用户的选择写进项目文件。11-05 预览页侧栏刚按同一个原则修过（只有亲手拖才写），Agent 面板宽度这一份当时没人扫到。

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| e57081ef0（10-30）WorkbenchShell +2 行 | 快捷键各自判断谁在输入，这里给槽位加输入面属性 | 键盘输入面，与本题无关 |
| 3f78e2e06（10-29）WorkbenchShell | 导演台和全景查看器没收进画布那一格 | 页内全屏层归属，与本题无关 |
| 本次：窗口一窄面板宽被写成 300，拉回来还是 300 | `WorkbenchShell.tsx:278-287` 的 resize 监听 + `clampEditingPanelLayout` 的 `window.innerWidth` 钳，都把视口钳后的值写回存档 | 派生值被当意图写回 |
| 同类：c97089ff7（11-05）预览页窗口变化改存档 | onResize 不分来源一律写回 | 同上，已修，修在预览页侧栏 |

结论：WorkbenchShell 这个文件的 3 刀不是同一类，前两刀与宽度无关；真正的同类前科是 c97089ff7，在 `preview/` 目录。「第 3 个 fix」是文件口径命中，类口径上这是同一个类的第 2 次出现，修的是上次漏扫的第二份存档字段。

## 2. 为什么会一直出现

- 设计早就定了：09-01 §11.2「面板宽度从不自动变，只收拖宽上限」（`docs/design/2026-09-01-agent-ui-final-redesign.md:389`），`assistantWidthBounds.ts` 注释、`PreviewWorkspace.tsx:35` 注释都这么写。行为相反：09-06 e0082f822 加了 resize 监听，把「收上限」实现成了「改存档」。
- 测试钉错了层：`assistantWidthBounds.test.ts:24`「窄窗只收上限，不偷改没超限的当前宽」测的是纯函数 `clampAssistantWidth`，函数确实不改没超限的宽；会写存档的是 store 的写入口，没有任何测试走过它。注释、测试、设计三处都说「不偷改」，实际偷改，因为尺子量的不是会出事的那一层。
- 写入口没有单一出处。我数到的写 `assistantWidth` 的路径：
  1. `WorkbenchShell.tsx:278-287` resize 监听 → `setAssistantWidth`（实现线说的门 ①）。
  2. `setAssistantWidth`（`workbenchStore.ts:366`）→ `syncEditingPanelSize` → `clampEditingPanelLayout`。调用方：AssistantPane 手拖和键盘（用户亲手，该留）、上面第 1 条（窗口，该删）。
  3. `clampEditingPanelLayout`（`panelLayout.ts:189-198`，实现线说的门 ②）是真正的咽喉：`assistantWidth: clampAssistantWidth(…, window.innerWidth)`。它被 `setEditingPanelLayout`（`editingPanelLayoutSlice.ts:195`）和 `syncEditingPanelSize`（:242）调用。上游：Agent `layout.write`（`capabilityApplyHandler.ts:462`）、打开项目还原（`workbenchProjectSession.ts:39`）、预览页开合栏（`PreviewWorkspace.tsx:184`）、预览页拖左栏 / 属性栏 / 时间轴后同步（`syncSize`，:125）。也就是说，在窄窗里拖一下左栏分隔条，也会把 Agent 宽度顺手钳小并写盘。
  4. 不钳视口、也能写的：`replaceLayout`（预设 / 重置 / ⌘Z / 开合）、`devlab` 直接 `setState`。它们写的是预设值或旧值，不依赖窗口大小，不是这一类。
- 核实实现线的「3 扇门」：对，但数法有一处要补。`door-map.mjs setAssistantWidth` 只数出 2 扇（AssistantPane 读、WorkbenchShell 写），`clampEditingPanelLayout` 只数出 1 扇（2 处出现），这两条符号数法看不到 `setEditingPanelLayout` / `syncEditingPanelSize` 的 4 个上游。实现线的 ② 实际背着 4 个调用方。它们都要靠「咽喉不再认视口」一次解决，不是各修各的。没漏掉第 4 扇：`electron/shared/agentCapabilities/layout.ts:20` 的 Agent 契约 `min(320)` 与界面下限 300 不一致，不写窗口值，不属这一类，单独记。
- 副作用：每次写都 `bumpPersist`，所以改窗口大小会让项目变「脏」、触发落盘。
- 为什么 WorkbenchShell 老挨刀：它 390 行，是四个工作区槽 + 外壳 + Agent 宿主的组合根，8 个 effect（URL 同步、挂载记录、宽度钳、Skill 库事件、perf 场景……）。每个跨工作区的 fix 都得在这里补一行，所以文件阈值会命中。但这是「组合根被所有人路过」，不是「同一个 bug 反复回来」：这 3 刀分属 3 个概念。宽度钳挂在这里的理由（「四个面共用 assistantWidth」，注释自己写的）本身就是要被删的东西。

### 铁律对照
⑫ 点了=以为的：拖到 450、窗口缩一下再拉回，用户以为面板还是 450，实际 300。⑩ ⑪ 不适用。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 只删 WorkbenchShell 那段，窄窗下打开项目 / 拖左栏 / Agent layout.write 仍把宽度写小（咽喉没改） | 在 jsdom 设 `window.innerWidth=700`，调 `setEditingPanelLayout({ sourceWidth: 300 })` 后读 `editingPanelLayout.assistantWidth`，目前应得 300（且 `persistRevision` 加 1） |
| 只做显示钳、不动 AssistantPane：窄窗里显示 340、存的是 500，用户一拖手柄，从 500 起算，面板宽度「跳」 | 窄窗里 pointerdown 后 pointermove 1px，读 dock 宽度跳变（AssistantPane.tsx:36 `drag.current = { width }` 取的是存档宽） |
| Generation 页用 `clamp()` 当动画值：`GenerationWorkspace.tsx:124` 用 framer 把 `--generation-assistant-width` 从 `0px` 动画到目标，目标是 clamp()/minmax 字符串时没法逐帧插值，收起 / 展开 Agent 变成瞬切 | 生成页点收起 Agent 看是否瞬切；`prefers-reduced-motion` 关闭对照 |

## 4. 靶子独立性

- 「窄窗不偷改」的测试量的是纯函数（见 §2），不是 store 写入口；尺子需要换成「设窗口宽 → 调每个写入口 → 读 store 里的 assistantWidth 与 persistRevision」。窄窗 PR 的新测试要在 store 层按 §2 的 4 个上游各写一条。
- 没有评分类尺子，也没有「修对反掉分」的先例。

## 5. P0

不是我们独有的：「容器太窄时让一个轨道让步」是 CSS Grid 自带的能力。`docs/engineering/self-written.json` 里没有宽度钳的登记，不需要新登记。面板宽度本身（Agent 面板随项目落盘、Agent 可读写）是领域约束，留在 store。

## 6. 三条路

实测（Chrome headless，一次性 HTML，不在仓库里）：容器宽 W 时用 `grid-template-columns: minmax(700px,1fr) minmax(308px, 存档宽+8px)`，得到：

| 容器宽 | 存档宽 | 内容列 | 停靠栏 |
|---|---|---|---|
| 1300 | 390 | 902 | 398 |
| 1040 | 390 | 700 | 340 |
| 1040 | 300 | 732 | 308 |
| 900 | 390 | 700 | 308 |
| 1700 | 600 | 1092 | 608 |

内容先保底（700），停靠栏吃剩下的，不超过存档宽，不低于 308。也就是不用任何 resize 监听、也不用 `100vw` 公式，浏览器自己做「放得下就是存档宽、放不下就让」。

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 1 沿原方向修（实现线现方案） | 删 effect；显示用 `clamp(308px, calc(100vw − 752px), 宽+8px)`；5 处各改一个词；`clampEditingPanelLayout` 改不认视口 | 碰 GenerationWorkspace（第 4 个 fix）、PreviewWorkspace（第 3 个）、panelLayout | `100vw` 不是舞台真实宽：左栏抽屉打开时（`SHELL_DRAWER_WIDTH` 280）内容区比视口小，公式仍按全视口算，仍会挤；Generation 动画见 §3；AssistantPane 手柄跳变 | 备选 |
| 2a 换一种做法（小）：把「让步」交给 Grid，几何出处只留一份 | ① `assistantWidthBounds.ts` 出一个函数（如 `assistantDockTrack(width)`），返回 `minmax(308px, 宽+8px)`，四个工作区的 `gridTemplateColumns` 都引它，内容列写 `minmax(700px,1fr)`（地板数来自 `ASSISTANT_CONTENT_FLOOR` 减去外壳左栏 / 缝，在同一处定义）；② 删 `WorkbenchShell.tsx:278-287` 整段与 `assistantWidthMaxFor` 的 import；③ `clampEditingPanelLayout` 去掉 `window.innerWidth`，只用静态 300–600；`setAssistantWidth` 的视口钳留着（手拖时手柄跟手，就是实现线的门 ③）；④ AssistantPane 在 pointerdown 时取 dock 的实际宽度当起点（不取存档宽）；⑤ Generation 的动画用 `minmax(min(var(--w), 308px), var(--w))` 保持逐帧可插值 | 同样碰那 5 个文件，但每个文件只是把「公式」换成「引用同一个函数」，总行数是净减；比方案 1 多的只有第 ④ 条与一个测试 | 低：按容器真实宽度让步，抽屉打开也对；地板数要在真 App 里量一次（1100–1400 × 抽屉开 / 关）；⑤ 要用生成页收起 / 展开真点一次 | **推荐** |
| 2b 换一种做法（大）：把 assistantWidth 搬进 `shellLayoutStore` / `shellGeometry` | 面板宽成为「这台机器的界面偏好」，不随项目 | `assistantWidth` 目前随项目落盘（`editingPanelLayoutSchema`）、是 Agent `layout.read/write` 契约字段；要迁数据、改契约，老项目里的值怎么办要一个迁移 | 高，且收益不在本题 | 不现在做；窄窗稳定后单独评估 |
| 3 删 | 删掉「视口决定上限」这个概念：`assistantWidthMaxFor`、`clampAssistantWidth` 的视口参数、aria-valuemax 全删，上限恒 600，窄窗全交给 Grid | 手拖：1100 宽时拖到 500，显示被 Grid 压回 340，手柄不跟手 | 中：「拖了没反应」是新的 ⑫ 问题 | 不选；手拖这一扇要留视口钳 |

### 老用户怎么过
- 已经被写成 300（窗口窄过）或 340（1100 宽）的人，和亲手选 300 的人，在存档里分不出来：300 是合法最小值，340 是旧默认。猜错的代价（把别人手选的改掉）比留着的代价（要自己拖一下）大，所以不做迁移。
- 新行为只对此后生效：升级后窗口变窄不再写；已经是 300 的项目保持 300，用户可拖或用顶栏「布局」菜单的「重置」（`resetEditingPanelLayout` → 390）。要写进更新说明，让人知道这一点。
- 项目文件：schema 只要求 finite 数字，旧项目照常读。在窄窗打开项目也不再把值写小。
- 拍板稿 N9「拉宽回来面板还是原来的宽度」只对新写入的宽度成立，验收时用「全新项目」，不要用旧项目对照。

### 特征测试（动手前先钉）
没钉：在 store 层，窄窗下 `setEditingPanelLayout` / `syncEditingPanelSize` / Agent `layout.write` / 还原项目是否改写 `assistantWidth` 与 `persistRevision`——这是 §3 第 1 条要先写的红测试，修后转绿。已钉但量错层：`assistantWidthBounds.test.ts:24`。

### 逃逸账本 / 结账挂的类检查
这是用户 11-07 原话报的问题，要挂结构性预防：建议「写面板宽度的咽喉不读 `window`」一条静态检查（`panelLayout.ts` 与 `editingPanelLayoutSlice.ts` 内不得出现 `window.innerWidth`，只有 `setAssistantWidth` 可以），加上 §4 的 store 层测试。

## 7. 用户要权衡的核心

窗口变窄时，Agent 面板是「让一让、拉回来还是你原来拖的宽度」，代价是已经被旧版本悄悄写成 300 的老项目分不出来、不替他们改回去。

## 批准

用户 2026-11-08 原话「都按推荐」（经协调会话转达）：选 2a；老用户不迁移，更新说明写「顶栏「布局」菜单的「重置」把面板宽回到 390」。实现在窄窗 PR（feat/window-narrow-shell），根因合同 `docs/fixes/2026-11-08-assistant-width-writeback.root-cause.json`。

实现与本文 §6 的差异：内容地板按外壳几何算成 684（= 760 − 左栏 60 − 外壳右缝 8 − 停靠栏左缝 8），保证窗口正好 1060 时放得下最窄停靠栏 308；写成 `minmax(min(684px, 100%), 1fr)`，停靠栏收起（生成页动画到 0）时容器比地板窄也不撑破。左栏抽屉是浮层（Mantine Drawer，不挤工作面），抽屉开关不改容器宽。
