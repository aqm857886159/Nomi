# 画布快捷键对齐 LibTV（2026-09-21）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实现未推送 → 见分支 `feat/canvas-shortcut-parity-20260921`（基于 `feat/canvas-handles-alt-drag-20260921`）。
> 实施中的两处调整写在「实施结果」一节（⌘L 只认选中两个；⌘D 后主动露出副本）。
> 用户拍板原话：「做对照，缺的都补上」。输入：用户发来的 LibTV 快捷键面板截图（四组：创作 / 缩放 / 移动画布 / 其他）。

## 为什么做（D1）

用户从 LibTV 过来，手上带着一套肌肉记忆。我们很多能力其实有（成组、撤销、缩放、整理、适应画布），但要么没键、要么键不一样、要么帮助面板里没写——
用户按下去没反应，就会以为「Nomi 没有这个功能」（群反馈里「坏了」多半是「找不到」的同一类）。
所以这次的活分三种：**有但没写 → 写进帮助面板**；**缺而语义清楚 → 补上**；**键位冲突或要新 UI → 列出来等拍板，不擅自定**。

## 范围 / 不动项 / 回滚 / 验收门

- 范围：`src/workbench/generationCanvas/components/useCanvasShortcuts.ts`（按键分发）、新增 `canvasShortcutActions`（⌘D/⌘L/Tab/⌘Enter/⌥⇧F 的动作体，R9 不喂 766 行的宿主）、帮助面板模型 `canvasControlsHelpModel.ts` + 文案 `src/i18n/locales/generationCommon.ts`、`src/design/platformShortcut.ts`（⌥/⇧ 字形按平台派生）。
- 不动：⌥+拖动复制 / ⌘⌥+拖动（另一工人的分支 `feat/canvas-handles-alt-drag-20260921` 负责；后者语义待用户确认）；Electron 主进程的缩放拦截（⌘0 冲突待拍板）；不新造工具模式系统；不画新 UI（⌘F 只交方案+样张）。
- 回滚：新快捷键全部集中在一个分发函数的新增分支里，revert 该 commit 即回到现状，无数据迁移。
- 验收门：单测（分发 + 编辑器聚焦不触发 + 阳性对照）、真机走查 `tests/ux/canvas-shortcut-parity.walk.mjs`（zh/en 帮助面板截图）、`pnpm run gates`、`pnpm run review:branch`。

## 对照表

判据列说明——「我们」列一律给实现 file:line（基于 `origin/main@1d7c1e2a5`）；「帮助」= 画布左下键盘图标弹出的帮助面板（`CanvasControlsHelpPopover.tsx` 渲染 `canvasControlsHelpModel.ts` 的行，文案在 `generationCommon.ts` 的 `canvas.controlsHelp`）。

### 创作

| LibTV 键位 | 含义 | 我们有没有（file:line） | 键位不同？ | 帮助写了？ | 处置 |
|---|---|---|---|---|---|
| ⌘G | 成组 | 有：`useCanvasShortcuts.ts:147-152`（≥2 个选中才成组） | 同 | 没写 | 已有，只补说明 |
| ⌘⌥G | 合并分镜组 | 没有「合并」动作。等价物「分镜组」= `NodeGroup`（`model/generationCanvasTypes.ts:195-230`，多镜物化会打 `materializationOperationId` 章），store 只有建组/解组/删组/移入移出（`store/canvasStoreTypes.ts:96-113`），没有 merge | — | — | **待拍板**（见下）——合并后框名、框边界、组入参/出参怎么并是产品语义，不擅自定 |
| ⌘⇧G | 解组 | 有：`useCanvasShortcuts.ts:141-146`（选中整组才解） | 同 | 没写 | 已有，只补说明 |
| ⌘L | 连线 | 没有键。手势有：点输出口进入待连态 `store.startConnection`，再点目标输入口 `completeNodeConnection`（`nodes/completeNodeConnection.ts:21`，`nodes/BaseGenerationNode.tsx:305-335`），Esc 取消（`useCanvasShortcuts.ts:107-111`） | — | — | 缺失，实现：选 2 个 → 左边的连到右边的（按画布 x 排序，走 `completeNodeConnection` 同一条校验与人话反馈）。选 1 个**不做**：React Flow 画布里 `connectOnClick={false}`（`reactFlow/GenerationCanvasReactFlowViewport.tsx:193`），点输入口完成连线的旧把手已随卡内把手删除，待连态进去了只能 Esc 出来，是死胡同 |
| ⌘D | 复制节点和连线 | 没有键。原语有：`buildSelectedClipboard`（`store/canvasClipboard.ts:37-48`，只带**选中节点之间**的边）+ `pasteNodes`（`store/generationCanvasStore.ts:106-`，偏移 + 整簇避让 + 一个撤销点）；`duplicateNodesForDrag`（同文件 `:72-86`）已示范「借剪贴板复制但不污染用户剪贴板」 | — | — | 缺失，实现：复用同一组原语做原地偏移复制，一次撤销，不覆盖用户的 ⌘C 剪贴板 |
| ⌘Enter | 生成 | 没有键。入口有：浮条「生成」= `useCanvasProductionActions.ts:48-54` → `confirmAndRunPlan`（`components/batchPlanPreview.ts:129-165`，先 `confirmAndMintGrant` 花钱确认再跑） | — | — | 缺失，实现：有选中时走**同一个** `production.generate()`（同一张花钱确认卡）；没选中不做任何事（不偷偷「全部生成」） |
| Tab | 新建节点 | 没有键。菜单有：空白右键「添加节点」菜单（`components/useCanvasContextNodeMenu.ts:99-230`，`target: 'blank'`） | — | — | 缺失，实现：在鼠标处打开同一个「添加节点」菜单；焦点在按钮/输入等可交互控件上时 Tab 保持原生焦点切换（可访问性） |
| ⌥+拖动节点 | 节点复制 | 有：`reactFlow/GenerationCanvasReactFlow.tsx:520-522`（`duplicateNodesForDrag`） | 同 | 没写 | **不归本分支**：另一工人在 `feat/canvas-handles-alt-drag-20260921` 扩展并补帮助行 |
| ⌘⌥+拖动 | 创建副本 | 没有 | — | — | **不做**：语义待用户确认（与 ⌥+拖动的差别不清楚） |

### 缩放

| LibTV 键位 | 含义 | 我们有没有（file:line） | 键位不同？ | 帮助写了？ | 处置 |
|---|---|---|---|---|---|
| ⌘+ | 放大 | 有：渲染层 `useCanvasShortcuts.ts:48-53,135-140`；Electron 主进程先拦下再转发 `electron/windowZoomShortcuts.ts:10,27` | 同 | 没写 | 已有，只补说明 |
| ⌘- | 缩小 | 同上 `windowZoomShortcuts.ts:11,27` | 同 | 没写 | 已有，只补说明 |
| ⌘0 | 适应画布 | 适应视图有，但只有按钮：`components/CanvasNavigationStack.tsx:90-99` → `reactFlow/GenerationCanvasReactFlow.tsx:336-354`。**⌘0 被占**：主进程把它留作「整页缩放回 100%」保险 `electron/windowInput.ts:6-12,22-25` + `electron/windowZoomShortcuts.ts:9,23-25`，渲染层根本收不到 | **冲突** | — | **待拍板**（见下） |
| 触控板捏合 | 缩放 | 有：`reactFlow/canvasViewportGestureProps.ts:11-12,36-43` | 同 | 写了（`pinch`） | 已有 |
| ⌘+滚轮 | 缩放 | 有：同上（「触控板优先」档 ⌘+滚轮缩放；「鼠标优先」档裸滚轮即缩放，⌘+滚轮同样缩放） | 同 | 写了（`modWheel` / `wheel`） | 已有 |

### 移动画布

| LibTV 键位 | 含义 | 我们有没有（file:line） | 键位不同？ | 帮助写了？ | 处置 |
|---|---|---|---|---|---|
| Space+拖 | 键盘平移 | 有：`reactFlow/useGenerationCanvasReactFlowPointer.ts:193-215` | 同 | 写了（`spaceDrag`） | 已有 |
| 触控板双指 | 平移 | 有：「触控板优先」档 `canvasViewportGestureProps.ts:36-43` | 同 | 写了（`wheelOrTwoFinger`，仅该档） | 已有 |
| 鼠标拖 | 平移 | 有：空白左键拖即平移（`canvasControlsHelpModel.ts:24`），中键/右键拖也平移 | 同 | 写了（`blankDrag`/`middleOrRightDrag`） | 已有 |
| V | 移动（选择）工具 | 没有工具模式。唯一的「模式」是画框工具 F（`components/useCanvasFrameTool.ts:93-112`，画一次自动收） | — | — | **不做，报告**：我们的默认手势已经是「空白拖 = 平移、Shift+拖 = 框选」（`canvasControlsHelpModel.ts:22-39`），V/H 两个工具在 LibTV 里是在「拖 = 框选」和「拖 = 平移」之间切；我们不需要切就同时有两者。为这两个键新造一套工具模式系统违反 P1/D4。见待拍板 |
| H | 抓手工具 | 同上 | — | — | 同上 |
| ⌥⇧F | 整理画布 | 有，只有按钮：`CanvasNavigationStack.tsx:129-137` → `components/useTidyCanvas.ts:21-30` → `store/canvasNodeActions.ts:248-274`（已有撤销点） | — | — | 已有功能，补键 ⌥⇧F（按 `event.code` 认，macOS ⌥ 组合键的 `event.key` 是 `Ï`） |

### 其他

| LibTV 键位 | 含义 | 我们有没有（file:line） | 键位不同？ | 帮助写了？ | 处置 |
|---|---|---|---|---|---|
| ⌘Z | 撤销 | 有：`useCanvasShortcuts.ts:178-182` | 同 | 没写 | 已有，只补说明 |
| ⌘⇧Z | 重做 | 有：`useCanvasShortcuts.ts:173-177`（另有 ⌘Y `:183-186`） | 同（我们多一个 ⌘Y） | 没写 | 已有，只补说明 |
| ⌘F | 画布节点搜索 | 没有；仓库也没有可复用的搜索/命令面板组件（`git grep -i "commandpalette\|cmdk\|nodeSearch"` 零命中，`package.json` 无 cmdk） | — | — | **要新画 UI → 只交方案+样张，不实现**：见 [样张](2026-09-21-canvas-node-search-mockup.html) |
| ⌫ | 删除 | 有：`useCanvasShortcuts.ts:112-133`（多选删除给撤销 toast） | 同 | 写了（`delete`） | 已有 |

**另外发现（我们有、LibTV 面板没列、我们帮助面板也没写）**：⌘X 剪切（`useCanvasShortcuts.ts:164-168`，帮助只写了 ⌘C/⌘V）、F 画框（`useCanvasFrameTool.ts:93-112`，只在按钮 tooltip 里写了）。一并补进帮助面板。

### 汇总

| 处置 | 条数 | 条目 |
|---|---|---|
| 已有，帮助已写 | 7 | 捏合、⌘+滚轮、Space+拖、双指、鼠标拖、⌫、（⌥+拖动 由另一分支补说明） |
| 已有，只补帮助说明 | 6 | ⌘G、⌘⇧G、⌘+、⌘-、⌘Z、⌘⇧Z（外加 ⌘X、F 两条我们独有的） |
| 已有功能缺键，补键 | 1 | ⌥⇧F 整理 |
| 缺失，实现 | 4 | ⌘D、⌘L（只认选中两个）、⌘Enter、Tab |
| 冲突 / 要新 UI / 语义不清 → 待拍板 | 5 | ⌘0、⌘⌥G、V/H、⌘F、⌘⌥+拖动 |

## 待用户拍板

1. **⌘0 适应画布 vs 现在的「整页缩放回 100%」**。现状：主进程把 ⌘0 截走做页面缩放保险（`electron/windowInput.ts:6-12`）。但同一个守卫已经让 ⌘+/⌘-/⌘0 **都不会**改页面缩放（每次都强制回 1），所以 ⌘0 的「保险」作用今天几乎落空。
   - 默认建议：⌘0 在画布可见时 = 适应画布（同时仍把页面缩放复位，两件事不打架）；画布不可见时行为不变。
   - 代价：动 Electron 主进程的一条转发（与 ⌘+/⌘- 同一条通道），需要重新打包才能在装机版生效。反方先例：tldraw 把适应画布放在 ⇧1、100% 放在 ⇧0（https://github.com/tldraw/tldraw/blob/6d1c6ae341478debd9d2166b09a162b1c12df110/packages/tldraw/src/lib/ui/context/actions.tsx#L1196-L1220），正是为了躲开浏览器的 ⌘0。
2. **⌘⌥G 合并分镜组**。我们有分镜组（`NodeGroup`），没有合并。要做得先定：合并后叫什么名（取第一个？）、框边界（并集）、组入参/出参（并集去重）、合并能不能撤销成原来两组。默认建议：**先不做**——今天可以 ⌘⇧G 解组再 ⌘G 成组达到同样效果；等真有人要再做。
3. **V / H 工具**。默认建议：**不做**（理由见对照表：我们的默认手势不用切工具就同时有平移和框选）。若要照顾 LibTV 用户，可以只在帮助面板写一句「Nomi 里空白拖就是平移，Shift+拖框选」，不加键。
4. **⌘F 画布节点搜索**：要新画一个浮层，见样张 [2026-09-21-canvas-node-search-mockup.html](2026-09-21-canvas-node-search-mockup.html)。拍板后再实现。
5. **⌘⌥+拖动 创建副本**：与 ⌥+拖动 的区别不清楚，需用户说明想要的效果（另一工人的分支也在等这条）。

## 实施结果（2026-09-21）

| 键 | 实现 | 验证 |
|---|---|---|
| ⌘D | store 新原语 `duplicateSelectedNodes`，与拖动复制共用「借剪贴板走 pasteNodes」（`pasteThroughBorrowedClipboard`），一次撤销、不动用户 ⌘C。真机发现：整簇避让把副本推到原件右边，窄舞台下副本整簇落在视口外（React Flow 只渲染可见卡）→ 按了像没反应；补 `useRevealCreatedNodes`，由这次手势显式露出副本（几何复用 `revealCreatedSequenceViewport`） | 单测 + 走查：副本完整出现在视口、内部边一起复制、原件不动、⌘Z 一次撤掉 |
| ⌘L | 只认选中两个（左 → 右；同列上 → 下） | 单测（方向、1/3 个不动）+ 走查 |
| Tab | 在鼠标处打开空白右键同一个「添加节点」菜单（菜单几何抽成 `buildMenuAt`，右键与键盘共用）；焦点在按钮/菜单/输入上时仍是焦点切换 | 单测 + 走查（菜单落在鼠标处、选第一项建卡、⌘Z） |
| ⌘Enter | 调浮条「生成」同一个 `production.generate()` → `confirmAndRunPlan` 花钱确认卡 | 走查：先弹「开始生成」确认卡，取消后零生成 |
| ⌥⇧F | 调左下「整理」按钮同一个动作；字母按 key 认、非 ASCII 回退 code（Mac 上是 `Ï`） | 单测（Mac/Win 两种事件）+ 走查（位置变化、⌘Z 还原、未误开画框工具） |
| 帮助面板 | 分组对齐 LibTV：选择 / 移动画布 / 缩放 / 创作 / 编辑；新增 13 行；修饰键字形按平台派生（`platformShiftKey` / `platformAltGlyph`） | 单测 + 走查 zh/en 截图 |

顺带修掉的两个帮助面板真 bug（根因合同见 `docs/fixes/2026-09-21-canvas-help-popover-layer.root-cause.json`、`docs/fixes/2026-09-21-timeline-handle-vertical-band.root-cause.json`）：
1. 面板原地 `absolute` 在导航竖列 `z-8` 的层叠上下文里，Agent 收起坞 / 批量条都盖得住它；英文长说明两侧都 `nowrap` 压到键位上 → 改走 `AnchoredPopover`（Portal + `overlayLayers.popover`），行改成「说明可折行｜键位不折行」两列网格。
2. 1280 宽 + Agent 面板展开时时间轴胶囊压住帮助按钮：`resolveTimelineHandleLeft` 把浮在上一排、几乎横跨全宽的批量条也当成挡路的横向区间 → 只算与胶囊同一水平带的停靠区。

## 实施要点（阶段 2）

- **分发只有一个 owner**：新键全部进 `createCanvasKeydownHandler`（与 ⌘G/⌘Z 同一个函数），走同一个 `shouldIgnoreCanvasShortcut`（输入框 / 提示词编辑器 / contentEditable / 白板弹窗 / 画布隐藏时一律放行），不另起监听。另加：`event.isComposing`（输入法组字中）一律放行——借 tldraw 的 `shouldSkipEvent`。
- **字母键按 `event.key` 认，⌥ 组合回退 `event.code`**：macOS 上 ⌥⇧F 的 `event.key` 是 `Ï`、⌘⌥G 是 `©`；只认 key 会在 Mac 上失灵，只认 code 会在 Dvorak/AZERTY 上按错键（tldraw 同一裁决，见下「先查别人」）。
- **⌘D** 不碰用户剪贴板：与 `duplicateNodesForDrag` 同法（临时换入、用完换回），落点走 `pasteNodes()` 的默认偏移 + 整簇避让，一次撤销。两个入口共用一个 store 原语，不写第二份复制逻辑。
- **⌘Enter** 只调 `production.generate()`，不直接碰 runner——花钱确认 / 托管同意 / 授权令牌全在 `confirmAndRunPlan` 里，快捷键绕不过去。
- **Tab**：只在焦点不在任何可交互控件上时接管（`document.activeElement` 是 body / 画布本身 / React Flow 节点外壳）；否则把 Tab 还给浏览器做焦点切换。
- **帮助面板**：修饰键字形从 `src/design/platformShortcut.ts` 派生（Mac `⌘ ⌥ ⇧`，Windows `Ctrl Alt Shift`），不写字面量。

## 先查别人

- 依赖里已有？React Flow 12.11.5 自带的键只有删除 / 框选 / 平移激活 / 多选 / 缩放激活（`node_modules/@xyflow/react/dist/esm/index.mjs:3745` 的 `deleteKeyCode='Backspace'`、`selectionKeyCode='Shift'`、`panActivationKeyCode='Space'`），没有复制 / 连线 / 生成 / 搜索这类应用级快捷键，得我们自己分发；我们已在 `reactFlow/GenerationCanvasReactFlowViewport.tsx:209` 关掉它的 `deleteKeyCode`，删除统一走 `useCanvasShortcuts`。结论：不引新库，沿用现有单一分发函数。
- 仓库里已有？分发：`src/workbench/generationCanvas/components/useCanvasShortcuts.ts:81-189`；复制原语：`src/workbench/generationCanvas/store/generationCanvasStore.ts:72-86`、`src/workbench/generationCanvas/store/canvasClipboard.ts:37-48`；生成入口：`src/workbench/generationCanvas/components/useCanvasProductionActions.ts:48-54`；整理：`src/workbench/generationCanvas/components/useTidyCanvas.ts:21-30`；添加菜单：`src/workbench/generationCanvas/components/useCanvasContextNodeMenu.ts:99-158`；平台字形：`src/design/platformShortcut.ts:13-19`。全部复用，不新写。
- 生态里已有？tldraw 的动作表同样是「⌘D 复制 / ⌘G 成组 / ⌘⇧G 解组 / ⌘⌥G 包成 frame」：https://github.com/tldraw/tldraw/blob/6d1c6ae341478debd9d2166b09a162b1c12df110/packages/tldraw/src/lib/ui/context/actions.tsx#L530-L620 ；V 选择 / H 抓手是工具切换：https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/ui/hooks/useTools.tsx#L89-L115 ；输入框聚焦时跳过快捷键、组字中跳过、⌥ 组合键回退 `event.code`：https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/ui/hooks/useKeyboardShortcuts.ts#L405-L450 。
- 反方：tldraw 的 ⌘Enter 不是「生成」而是可访问性动作（`actions.tsx#L1653-L1660`），适应画布放在 ⇧1 而不是 ⌘0——说明 ⌘0 在浏览器/Electron 宿主里本来就是被占的键，所以我们把 ⌘0 列为待拍板而不是直接抢。
- 结论：全部用已有原语 + 已有单一分发函数；只有 ⌘F 需要新 UI（先出样张）。
