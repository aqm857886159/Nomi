# 方向检查：导演台（和全景查看器）是页面里的东西，却挂成了盖住整窗的 body 层（2026-10-29）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 触发：`src/workbench/generationCanvas/nodes/director/` 目录近 14 天 18 个 fix（`git log --since=2026-10-15`，诊断线 R-blockers-repro 第 7 节同口径）；`node scripts/fix-churn.mjs` 对 `src/ui/app-shell/windowChrome.ts` 实测命中（目录 `src/ui/app-shell/` 14 天已有 2 个 fix，这一刀碰它是第 3 个）。同一族上两次：2026-09-04 Windows 窗口栏（全屏层盖住拖拽带）、2026-10-27 开屏「跳过」（顶栏压住它）。
> 例外条款：要改的文件本身（`DirectorEditor.tsx`、`DirectorNode.tsx`、`WorkbenchShell.tsx`、`ShellAgentHost.tsx`）14 天内 fix 数为 0；改法是「换」——portal 目标换成生成页那一格，同提交删掉自己算位置的那一套，不新增分支或特例；适用协调代批，用户也已当面拍了方向（第 7 节原话）。
> 设计卡：[`2026-10-29-director-layer-in-page.md`](2026-10-29-director-layer-in-page.md)。证据：`coord-handoff/reports/R-blockers-repro.md` 第 3–5 节（复现与截图）。

### 0. 一句话根因

导演台是「生成页里的一块」，却被做成挂在 body 上的 fixed 层：它自己用一个口径不对的旗子算右边留多少、用节点本地 state 管什么时候消失，既不属于外壳的版面、也不属于任何页面——外壳一改（10-08 的 Agent 三形态 + 40px 顶栏），它就悄悄错位、切页就出不去。缺的是「页面里的全屏层归页格管」这一层。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| `7e8e58590`（10-04）导演台壳写 `right: assistantCollapsed ? 0 : assistantPaneWidth(…)`；`f59b38d80`（10-08 外壳重设计）把这面旗子改成「小球 ⇔ 收起」（`ShellAgentHost.tsx:248`） | 浮窗不占停靠列，旗子却为假 → 导演层右边白留 `assistantWidth + 8`，露出可点的真画布（用户项目 608px） | 版面自己算（和生成页网格是两份判法） |
| `f59b38d80`：顶栏合一后导航才点得到，导演层仍挂 body、`left: 0`、`open` 是 `DirectorNode` 本地 state | 点「创作」「预览」页面在导演层底下切，导演层不动；左栏整块被盖住点不到 | 生命周期靠节点本地 state，不跟页面走 |
| 小球形态：`projectAgentDockCollapsed` 为真时 `right: 0` | Agent 小球被导演层盖住，在导演台里叫不出 Agent | 同上（层级 / 版面自己算） |
| `PanoramaViewer.tsx:586`：节点持有 + `createPortal(…, document.body)` + `fixed inset-x-0 bottom-0`（诊断线未跑） | 本 PR 先复现，见报告 | 同形 |
| 2026-09-04 窗口栏、2026-10-27 开屏「跳过」 | 全屏层不知道顶栏有多高 / 谁压谁 | 同一家族：body 级层各自算「我占窗口哪一块」 |

### 2. 为什么这一类会一直出现

外壳里放东西有两种办法：生成页网格里的一格（版面由网格给，跟着槽位 `hidden` 走），或 body 上的 fixed 层（自己算、自己管生命）。全屏编辑器 / 查看器图方便挂了后者，于是外壳每变形一次，它们就要被回头改一次：09-04 顶栏、10-08 Agent 三形态、10-27 顶栏层级——每次只修眼前那个读方（补一个旗子、补一个顶偏移），层本身还是 body 级。门岗也只认字面量 `fixed inset-0`，导演层写的 `fixed inset-x-0 bottom-0` 漏网，左 / 右 / 下三边和生命周期没人守。

| 铁律 | 判断 | 最小证据 |
|---|---|---|
| ⑩ 说的=摆的 | 不适用：不涉及意图抽取 | — |
| ⑪ 能选到 | 不适用：不涉及模型参数 | — |
| ⑫ 点了=以为的 | 适用：点「创作」以为切页，实际页面在导演层底下切；点左栏点不到 | 设计卡 ★9 第 4、5 条；走查 `tests/ux/director-layer-in-page.walk.mjs` |

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 外壳再变一次（第四种 Agent 形态、左栏宽、顶栏高）→ 导演台 / 全景再次错位或盖住新东西 | 走查里「导演层矩形 = 页格矩形」在 3 形态 × 多尺寸上量；在没改结构的树（main 的构建）上它红，改后绿 |
| 下一个节点持有的全屏层（新查看器、新编辑器）图方便 `createPortal(…, document.body)` → 切页出不去 | 普查测试 `src/workbench/pageLayerCensus.test.ts`：`src/workbench` 里新增未登记的 body portal 即红 |
| 全景查看器同样：点「创作」「预览」，查看器还留在最上面 | 走查的全景一段：改前红（复现）、改后绿 |

### 4. 靶子独立性检查

- 尺子（几何 + 命中测试）由诊断线 R-blockers-repro 先写（`d-director.mjs`），本线把它落成仓库里的走查，不是同一条线给自己出题；症状和截图是用户看过的。
- 「修对了反而红」的先例（靶子跟着旧行为写）：`tests/ux/shell-redesign.walk.mjs` #50 断言导演层 `left <= 1` 且 `bottom >= 窗口高`（盖住左栏、铺到窗底）；`src/ui/app-shell/windowChrome.test.ts` 里导演台 / 全景查看器必须用 `currentFullscreenOverlayTopOffset` 那两条。二者随新版面要改：前者改成「等于页格矩形」，后者搬到「页格内」名单。
- 门岗自身的洞：`windowChrome.test.ts` 的整窗 fixed 根分类只认字面量 `fixed inset-0`——本刀同时补成认 `fixed inset-x-0` 这一形，并加「body portal 必须登记」的普查。

### 5. P0：这些是我们独有的吗？现成方案有哪些

不是通用能力。「页面里的层挂在哪一格」是我们生成页网格（领域版面）的事；portal 用 React 自带的 `createPortal`（生成页里已有三处旧例就是这么挂在 `.workbench-generation__canvas` 上的），层级沿用 `overlayLayers` 刻度和 Agent 层（`z-[60]`），不新增库、不命中 `docs/engineering/self-written.json` 的登记。

React `<Activity>`（`WorkspaceSlot` 已对分镜页用）也考虑过：R3F 9.8 的 `<Canvas>` 已能承受 Activity 隐藏（根不销毁，见 `node_modules/@react-three/fiber` 的插入 effect 注释），但 3D 场景树是它自己的 React 根，Activity 管不到里面的 effect 和渲染循环；同时它的 effect 清理会连带停掉导演台的自动保存、外部写入登记和手机桥——语义变化比这一刀要的大。所以不用它，只在五处全局键盘监听、渲染循环、暗色锁上显式跟随「这一格现在看不看得见」。

### 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | React `createPortal` 到生成页那一格 + R3F 自带 `frameloop`；挂载点由 `GenerationWorkspace` 提供并命名，页内全屏层经它挂 | 中：导演台 / 全景各换一处挂法；删 `assistantPaneWidth` 与 `projectAgentDockCollapsed` 在导演层里的读法、顶偏移、`FULLSCREEN_Z_INDEX` | 层级要和 Agent 层、时间轴窄条核；导演台可用面积从整窗变成那一格 | **推荐** |
| 补 | 旗子改读 `useEffectiveAgentForm('generation') !== 'dock'`；导演层订阅 `workspaceMode` 离开就 `onClose()`；`left` 取左栏宽 | 小 | 三个洞各补各的；离开就关会丢视图态；全景要再补一遍；层仍是 body 级，下一次外壳变形还会错位 | 否决 |
| 重写 | 导演台回到节点卡内联 | 大 | 推翻 10-04 起的全屏导演台形态 | 否 |
| 删 | 删全屏导演台 | — | 没有替代入口 | 否 |

### 7. 用户要权衡的核心

导演台是「生成页里的一块面板，切页就收、回来还开着」，还是「盖住整窗的模态，必须自己管关」。用户 2026-10-29 当面选了前者，原话：「2.导演台 我打开以后 画布右侧还有漏出」「点入导演台之后呢？然后我点其他页面我都出不去了。我点创作也出不去，预览也出不去。」，并在对比里选了「**收进生成页（推荐）**」。代价：导演台的可用面积从整窗减到生成页那一格（顶栏、左栏、停靠的 Agent 不再被盖，生成页底部时间轴窄条也在）。

## 特征测试清单（动结构前先锁住）

- 已钉住（现状）：`src/ui/app-shell/windowChrome.test.ts`（全屏层分类，随本刀改名单）、`tests/ux/director-windowbar.walk.mjs`（导演台顶栏整条落在窗口栏之下，新版面下仍成立）、`src/workbench/generation/generationWorkspaceLayout.structure.test.ts`、`src/workbench/WorkspaceSlot.freeze.structure.test.ts`。
- 本刀先写后改：`tests/ux/director-layer-in-page.walk.mjs`（几何 + 命中测试 + 切页 + 左栏，中英），先在未改的 main 构建上跑出红，再改结构跑绿；普查测试 `src/workbench/pageLayerCensus.test.ts` 随挂载点一起落。
- 没钉住的写原因：Windows 真机拖拽带（本机是 macOS，两平台顶栏同为 40px，页格在顶栏之下由构造保证，真机记 `unverified`）。
