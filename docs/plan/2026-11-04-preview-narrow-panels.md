# 预览页窄窗：左栏不再被压成一条缝 · 设计卡

改动名：预览页侧栏按真实空间收放　　线 / 负责人：预览页窄窗修复线（协调会话派）　　类别：[其他]（修 bug，带可见改动）

拍板画布（Claude Design）：<https://claude.ai/artifact/7GS3EXDGtMrK86Bu6csVSF>（拍板后截图与源码落 `docs/design/boards/2026-11-04-preview-narrow-panels/`）

## 现场

- 发现：11-04 付费确认卡 PR 的独立验收线在范围外截到（1280×933、Nomi 停靠、预览页），协调会话亲眼核过截图，记进待办。
- 复现：已装 0.24.0 打包 App + 隔离临时资料，1280×933、Nomi 开着、空项目进预览页。中英两轨都复现：左栏实测 32px，里面仍画标签栏和空态说明，逐字竖排；从 1440 缩回 1280 也一样。
- 量到的同类问题：
  - 1280 关 Nomi：左 / 预览 / 属性 = 240 / 550 / 420。属性被按比例撑到上限，这个宽度还被当成用户拖的存下。
  - 1440 关 Nomi：338 / 677 / 355，同样在漂。
  - 1100 开 Nomi、两栏都收着：属性收起条被拉到 192px 的空白，预览只有 460，低于 480 下限。

## 根因（三层）

- 症状：窄窗时侧栏内容挤在 32px 里竖排；开关 Nomi 后栏宽漂移、被写回存档。
- 直接原因：
  1. 1280 宽、Nomi 开着时，舞台行只有 814px，而三栏最小宽要 240 + 480 + 200 = 920，放不下。面板库（react-resizable-panels 4.12.3）的约束求解按面板顺序，把第一块可收起的左栏吸到 collapsedSize 32。
  2. 左栏画「展开还是收起条」读的是 store 的 `visibility.source`（仍是 true），所以画成展开内容。
  3. 回写口 `onResize` 不分谁触发：同步期间被 `syncing` 屏蔽，丢了「已被收起」；不同步时又把窗口变化当成用户的选择写回（宽度漂移）。
- 类根因：一块面板「画成什么」和「实际多宽」由两份真相各自决定。存档里是用户意图，面板库按空间算出实际宽度，两边没有同一个求解点。任何让两边不一致的入口都会再犯：窗口变窄、开关 Nomi、首次挂载、预设切换、Agent `layout.write`、旧项目带回的宽度。

## ★0 先查别人

- Apple `NSSplitViewItem.canCollapseFromWindowResize`（<https://developer.apple.com/documentation/appkit/nssplitviewitem/cancollapsefromwindowresize>）：侧栏默认随窗口变窄自动收起，检查器默认不收。→ **确认了**：窄窗先收左栏、属性留着（Q1）；窗口变窄不改用户意图，变宽自动回来。
- VS Code #1029（<https://github.com/microsoft/vscode/pull/1029>）：侧栏挤到最窄时按钮被裁掉，没有任何提示。→ **确认了**：宁可收成收起条，也不在不够宽的列里硬画。
- react-resizable-panels v4 类型文档（`node_modules/react-resizable-panels/dist/react-resizable-panels.d.ts`）：库只改尺寸、不管内容。`onLayoutChanged` 的 `isUserInteraction` 只在用户拖分隔条 / 按键时为 true，约束重算、命令式调用、首次挂载都是 false。`groupResizeBehavior: "preserve-pixel-size"` 让面板在容器变化时保住像素宽。→ **改了**：
  - 写回只认 `isUserInteraction`，删掉 `syncing` 屏蔽和 `onResize` 写回；
  - 两侧栏改为 `preserve-pixel-size`，容器的宽度差额全给预览。
- Obsidian「hide sidebars when narrow」插件（<https://dev.obsidianstats.com/plugins/obsidian-hide-sidebars-when-narrow>）：窗口低于阈值隐藏侧栏，变宽恢复。→ **确认了**：自动收起不写回存档。

## ★1 用户怎么用

- 当我在 13–14 寸笔记本（1280–1512 宽）上开着 Nomi 剪片时，我想左右两栏要么读得清、要么干脆收成条，以便把镜头拖进时间轴、看属性，而不是对着一列竖排的字。
- 步骤：
  1. 打开项目，进「预览」页（Nomi 默认停靠）。
  2. 窄窗下看到左边是「素材」收起条，属性栏照常。
  3. 点左边收起条，左栏展开；属性让成收起条。
  4. 从「镜头」拖一段到轨道。
  5. 点属性收起条看这段的属性，左栏让回收起条。
  6. 把窗口拉宽，两栏都回来，宽度还是我之前定的。
- 不做什么：
  - 不改收起条、标签、空态的样子和文案；
  - 不改布局菜单 / 预设 / 撤销；
  - 不改 Agent 的 layout 契约形状；
  - 不做「浮层抽屉」式的侧栏。
- 已知坑：面板库在窗口拖动的同一帧里会先按自己的顺序求解一次，下一帧才被我们的求解覆盖。内容以真实宽度为准，所以最多一帧裁切，不会竖排。
- 真实任务：
  - T1：1280 开 Nomi 空项目进预览（逃逸原场景）；
  - T2：有已出片镜头的项目，1280 下点左收起条，把镜头拖进轨道，再点属性收起条；
  - T3：1440 ↔ 1280 来回拉窗口、开关 Nomi，重开项目后宽度不漂。
- 指标与量具：
  - 主指标：任一时刻、每块侧栏「收起条」或「宽度 ≥ 它的最小宽」的比例应为 100%。量具：新走查 `tests/ux/preview-narrow-panels.walk.mjs`，1100 / 1280 / 1440 × Nomi 开关 × 中英，按实测矩形判，基线 0.24.0 在 1280 开 Nomi 时为 0/2。
  - 质量指标：开关 Nomi、改窗口宽之后，存档里的宽度与开合不变的比例应为 100%。量具：同一走查读落盘 `project.json` 对比。
  - 护栏：点收起条后那一栏真的展开的比例应为 100%（C1）。量具：同上。
  - 纯函数全宽扫：量具 `src/workbench/preview/panelLayout.test.ts`。

### ★1b 连带界面

- 顶栏「布局」菜单的勾仍表示用户意图。窄窗被自动收起的栏，菜单里仍是勾，不加新文案。
- Agent `layout.read` 返回意图（不变）；`layout.write` 打开一栏，等同于「点开这一边」。回执文案不变：「布局已更新 · ⌘Z 可撤销」。

### ★1c 老用户

- 旧项目落盘的 `editingPanelLayout` 原样读，不迁移。
- 0.24.0 及以前被漂移写进存档的宽度（比如属性 420），升级后照常读，用户可拖回。读进来时仍按现有上下限夹一遍。
- 退回上一版也能打开：存档形状不变。
- 证据：真实旧版本数据（`tests/fixtures/old-user-data/` 里带 `editingPanelLayout` 的项目）在走查里打开一次。

## ★2 谁说了算

- 用户意图：`workbenchStore.editingPanelLayout`（唯一 owner：`editingPanelLayoutSlice`，落盘 + Agent 契约）。
- 新增会话态 `editingPanelKeep: 'source' | 'inspector'`：「放不下时留哪边」，不落盘，默认 `'inspector'`。
- 实际布局：纯函数 `resolveEditingStageLayout(意图, 舞台行宽, keep)`（`panelLayout.ts`）派生，不存储。驱动面板库的是它，内容画收起条还是展开也由它决定。
- 同一份事实存几份：意图 1 份；实际布局不存，每次派生。
- 写意图的口：
  - 用户点击（收起 / 收起条 / 布局菜单 / 预设 / 撤销）；
  - 用户拖分隔条，只认 `onLayoutChanged(isUserInteraction)`；
  - Agent `layout.write`；
  - 打开项目时还原。
- 删掉的写口：`Panel.onResize → syncEditingPanelSize`。
- 门表：`node scripts/door-map.mjs editingPanelLayout`（14 扇读，写集中在 slice）、`syncEditingPanelSize`（2 扇）、`editingPanelResizeEffect`（1 扇）。改后 `onResize` 不再写 store。
- 不靠「状态变了」猜意图：keep 只由显式动作设置，即点收起条、布局菜单打开、`openPreviewSourceTab`、拖开收起条。

## ★3 一致与复用

- 以前定过什么：
  - 合同 §2.1（`docs/design/2026-09-05-editing-panel-design-contract.md`）定了默认 / 最小宽：300 / 240、480、240 / 200，基准 1680×842。窄窗没定过，仍算数。
  - 09-25 修复（`4b2462f90`）定了「拖过最小宽 → 写回收起」。仍算数，改为只认用户拖动。
  - `assistantWidthBounds.ts` 定了「窄窗只收上限，从不偷改当前宽」。本修复把同一原则用到左右两栏。
  - 预览 480 由自动收栏继续使用；只有用户点开的那一边才可让到 400（Q3，待拍板）。
- 三条路：
  1. 沿原方向修：继续在 `onResize` 回写里补特例。否决，这是第 3 次同类，补特例只换一个入口。
  2. 换做法：意图与实际分开，一个纯函数求解，写回只认用户动作。**选这条**，接面板库自带的 `isUserInteraction` 与 `preserve-pixel-size`，同提交删 `syncing` 屏蔽和 `onResize` 写回。
  3. 删掉左栏：否决，它是剪辑页取镜头的主入口，左栏「目录」只是第二扇门。
- 复用：`PanelRail`、`editingPanelResizeEffect`（改为比对「求解结果 vs 用户拖后」）、`usePanelLayoutSync`（改喂求解结果）。没有第二份定义。

## ★4 全状态

| 状态 | 用户看到什么 |
|---|---|
| 空（画布无镜头） | 左栏展开时显示原空态；收起时显示「素材」收起条。不再出现竖排空态。 |
| 加载（素材 tab 懒加载） | 与今天相同。 |
| 成功 | 两栏可读，或一栏收成条。 |
| 失败 | 量不到舞台行宽（首帧、页面隐藏）时不求解，保持上一次布局，不写存档。 |
| 部分成功 / 取消中 / 过期 | 不适用：纯本地布局，无异步任务。 |
| 能力不可用 | 不适用：不依赖模型或外部资源。 |

文案：不新增、不改，`check:i18n` 无变化。

## 拍板图清单

`docs/design/boards/2026-11-04-preview-narrow-panels/PreviewNarrowPanels.board.json`（拍板后生成；`pnpm run check:board-parity`）。

## ★9 验收与回滚

### 真实场景复现

- 发现时的流程：验收线 1280×933、Nomi 停靠、空项目、预览页、开快捷键面板时截到（验收报告证据 04、05 两张）。
- 我走的：已装 0.24.0 打包 App、隔离资料、同尺寸、空项目，中英两轨，加 Nomi 关、1440、1100。
- 差别：没开快捷键面板，与布局无关；资料是隔离的，不是验收线的那份。
- 修前：左栏 32px 竖排，已截图。
- 修后：同一脚本跑本分支打包产物（`pnpm run dist:mac:dir`）。

### 验收清单（实现线按它自验，验收线只核它）

| # | 检查 | 反例（出现即红） |
|---|---|---|
| 1 | 1280×933 开 Nomi（中英）：左栏是收起条（32px，有 `.workbench-panel-rail`，无标签栏）；属性 ≥ 200 展开；预览 ≥ 480 | 任一侧栏宽 < 最小宽却画展开内容 |
| 2 | 同上点左收起条：左栏 ≥ 240 展开；属性变收起条；预览 ≥ 400 | 点了没变化（C1） |
| 3 | 再点属性收起条：换回 | 两栏同时挤在最小宽以下 |
| 4 | 1440 开 Nomi：两栏都展开、都 ≥ 最小宽 | 左栏被收 |
| 5 | 1280 / 1440 关 Nomi：宽度等于存档意图（默认 300 / 240），预览吃差额 | 属性被撑到 420 |
| 6 | 开 → 关 → 开 Nomi、1440 → 1280 → 1440 拉窗：落盘 `project.json` 的 `editingPanelLayout` 不变；变宽后自动收的栏回来 | 窗口变化写进存档 |
| 7 | 1100 开 Nomi：默认左栏收起条、属性 ≥ 200；点左收起条，左栏 ≥ 240、预览 ≥ 400 | 收起条被拉宽成空白块（今天 192px） |
| 8 | 拖分隔条：拖过最小宽收起，并写进存档；拉宽窗口后仍收着；从收起条拖开展开并记宽 | 用户拖的收起被窗口变宽撤销 |
| 9 | 布局菜单 / 预设 / ⌘Z / Agent `layout.write` 打开一栏：该栏展开，另一栏按需让成收起条 | 打开了却仍是收起条 |
| 10 | 类级单测：`resolveEditingStageLayout` 全宽扫（1100…2560 × Nomi 宽 300…上限 × 意图 8 种 × keep 2 种）：每栏要么收起条要么 ≥ 最小宽；预览 ≥ 400，自动收栏时 ≥ 480；总和 = 舞台行宽；keep 那栏只要意图打开就展开 | 任一组合违反 |
| 11 | 旧版本真实数据项目打开不报错，布局照读 | 迁移改写了老存档 |

### 回滚与门岗

- 回滚：revert 本 PR 的合入提交；无数据迁移，无开关。
- 门岗：单测（类级）+ 走查 `preview-narrow-panels.walk.mjs`，挂进常规走查。门岗只证布局规则，不证体验好坏。
