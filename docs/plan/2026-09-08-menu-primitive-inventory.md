# 菜单原语现状清单（刀 1 第 ① 步 · 只清点不动手）

> 状态：📋 方案待拍板
>
> 上游方案：[2026-09-07-design-system-component-authority.md](2026-09-07-design-system-component-authority.md) 的**刀 1**（建 `WorkbenchMenu`，行为走 Radix `react-dropdown-menu` / `react-context-menu`，外观走 Nomi token + Tabler）。
> 本文只做**可对账的现状清单**与三个判断题的答案，**一行生产代码都没改，也没装包**（`@radix-ui/react-dropdown-menu` / `react-context-menu` 目前**不在** `package.json`，已装的只有 `react-switch` / `react-tooltip`，见 `package.json:228-229`）。
> 铁律（用户 2026-09-07 原话精神）：**只换实现、不动形态**。所以本文第 §4「形态差异清单」里的每一条都**只列不改**，等用户拍板。

## 先查别人

> 本文是刀 1 的**现状清单**，不新增能力；「买还是自研」的完整论证在
> [component-authority 方案](2026-09-07-design-system-component-authority.md) §2 四列表与 §3 三问，
> 这里把判据与出处收在一处备核。

- **依赖里已有？** `src/theme/nomiTheme.ts:221` 已给 Mantine `Menu` 配好 defaultProps，而全仓 import 它的地方是 0 个——我们既配置了它、又手写了 24 个菜单。不选它是实测：`node_modules/@mantine/core/lib/components/Menu/index.d.ts:1` 六行导出里没有 `MenuSub`（四个 `MenuSub*` 目录在包里但未导出），而我们已有多层菜单。
- **仓库里已有？** 本文 §1 全表 17 文件 / 24 实例逐条带 file:line；三个数字是方向键 0/24、点外关闭缺 2、定位 5 套，其中 `src/workbench/timeline/TimelineContextMenu.tsx:121` 用 `items*34` 估算菜单高度，`src/workbench/generationCanvas/nodes/useCanvasContextNodeMenu.ts:76` 另写一份尺寸。
- **仓库里已有？（既有原语）** `src/design/AnchoredPopover.tsx:7` 自称唯一定位机制但只有 4 个消费者，且它贴锚点、右键菜单贴指针，不是同一件事。
- **生态里已有？** Radix 的 dropdown-menu / context-menu 提供 roving tabindex、typeahead、边缘避让（<https://www.radix-ui.com/primitives/docs/components/dropdown-menu>），正是 0/24 没人写的那部分；我们已在用它的 switch 与 tooltip，`node_modules/@radix-ui/react-tooltip/package.json:17` 已带 popper 与 dismissable-layer，加菜单等于零新内核。
- **TikHub 自媒体里怎么说？** component-authority 方案已实抓 96 条，结论是这一族没有可借的公开经验（零条讨论 Mantine vs Radix 或多菜单迁移，命中率约 4%）；最接近的是抖音「用了 10 年 AntD 之后」把选型拆成快交付派与自有代码派（<https://www.douyin.com/video/7640088811422141748>）。本文不重复抓。
- **结论：用已有（Radix）+ 自写换肤壳。** 行为全买、外观全自写；理由是领域约束——菜单的难点（ARIA/键盘/避让）没有一条和 AI 视频有关，不在护城河上，而视觉必须是 Nomi 的，否则等于引进第二套设计语言。详见 [component-authority 方案](2026-09-07-design-system-component-authority.md)。

## 0. 一句话结论

`grep -rln 'role="menu"' src --include='*.tsx'` 命中 **18 个文件**，其中 `WorkflowGraphCanvas.tsx:104,138` 是**误报**（`closest('[role="menu"] …')` 的守卫选择器字符串，不是菜单本体）。
真正的手写菜单是 **17 个文件 / 24 个菜单实例**。这 24 个里：**处理方向键的 0 个**（全仓 `ArrowUp|ArrowDown` 在这 17 个文件里命中 0 次）；Esc 能关的 15 个、不能关的 6 个、只在「焦点恰好在菜单所属子树里」时才能关的 3 个；定位机制 5 种混用（`fixed`+clientX/Y、stage 相对 `absolute`+手写夹边、`createPortal`+`getBoundingClientRect`、纯 CSS `absolute` 贴父、`ResizeObserver` 量高度）。

---

## 1. 24 个菜单实例总表

「Esc」列：✅ = 读得出闭环；⚠️ = 只在焦点落在该子树内才生效；❌ = 代码里没有任何 Escape 路径。
「点外」列：✅ = 有 window/document 级 pointerdown/click 关闭；❌ = 没有。

| # | 菜单 | 位置（file:line） | 触发 | 项数 | 图标 | 快捷键列 | 分隔线 | 禁用项 | 子菜单 | Esc | 点外 | 定位 | 边缘避让 | 面 | 迁移风险 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 节点右键菜单 | `src/workbench/generationCanvas/components/NodeContextMenu.tsx:90` | 画布右键落在节点/选中罩上（pointer**up** 提交，`useCanvasContextNodeMenu.ts:186-201`） | 5 | ✅ Tabler | ✅ 右对齐 | 1 条（倒数第 2 项前） | 粘贴/建组 + `title` 解释 | 无 | ✅ `useGenerationCanvasReactFlowMenus.ts:198-199` | ✅ 同上 `:201` | stage 相对 `absolute`，坐标由 `Overlays.tsx:101` 注入 | ✅ 手写夹边 `useCanvasContextNodeMenu.ts:138-139`（高度**写死 196**，`:79`） | 画布 | **中**：组件本身极干净，风险全在宿主的右键手势编排 |
| 2 | 空白右键「添加节点」 | `CanvasToolbar.tsx:189`（`NodeAddMenu`） | 画布右键落在空白 | 3 段共 ~9 项 | ✅ | ❌ | ❌（靠段名分段，`role="group"` `:103`） | 无 | 无 | ✅ 同上 | ✅ 同上 | 同上 | ✅ 高度写死 330（`useCanvasContextNodeMenu.ts:77`） | 画布 | **中**：含 `<input type=file>` 项（`:65-89`），Radix `onSelect` 必须 `preventDefault` 才来得及 `.click()` |
| 3 | 连线落空「接什么」 | 同 `CanvasToolbar.tsx:189`（`kinds=['image','video']` 受限档） | 拖连线松手在空白（`useGenerationCanvasReactFlowMenus.ts:235-260`） | 2 | ✅ | ❌ | ❌ | 无 | 无 | ✅ | ✅ | 同上 | ⚠️ 用的是节点菜单那套夹边常数 | 画布 | **高**：**没有触发元素**，是程序化在某点开——Radix 只能用受控 open + virtual anchor |
| 4 | 框菜单（⋯ / 框边右键同一份） | `FrameContextMenu.tsx:90` | 框头 ⋯（`GroupFrameHeader.tsx:225`）或框边右键（`useCanvasContextNodeMenu.ts:189-193`） | 5 | ✅ | ❌ | 1 条（最后一项前） | 生成/进时间轴 + `title` | 无 | ✅ `useCanvasFrameActions.ts:133` | ✅ `:135` | stage 相对 `absolute`（`Overlays.tsx:121`） | ✅ `useCanvasFrameActions.ts:72-73` | 画布 | **中**：唯一带「项内灰字副标题」的菜单（`FrameContextMenu.tsx:124-126`） |
| 5 | 左缘工具条「更多」 | `CanvasToolbar.tsx:378` | **hover 200ms** 展开（`:342-349`）+ 点击切换（`:364-367`） | 2 段 | ✅ | ❌ | ❌（段名） | 无 | 无 | ⚠️ `:304-306` 是容器 `onKeyDown`，鼠标 hover 打开时焦点不在里面 → 按 Esc 无效 | ❌（靠 `onPointerLeave`） | 纯 CSS `absolute left-[calc(100%+8px)]`（`:375`） | ❌ | 画布 | **高**：hover-open 不是 Radix DropdownMenu 的原生形态，得自己接 trigger |
| 6 | 连线模式菜单 | `reactFlow/GenerationCanvasReactFlowNodes.tsx:356` | 点连线标签胶囊（`:345-348`），或点连线本体（`:313-325`） | 模式数 + 1 删除 | ✅ `IconCheck` | ❌ | ❌ | 无 | 无 | ❌ | ❌ | `EdgeLabelRenderer` + CSS | ❌ | 画布 | **中**：**只能靠点菜单项或再点一次胶囊关**，点画布别处不关 |
| 7 | 节点浮条分组下拉（切图▾/变换▾） | `nodes/NodeFloatingToolbar.tsx:145` | 点分组按钮（`:131`） | 由调用方传 | ✅ 调用方传 | ❌ | ❌ | ✅ `item.disabled`（`:154`，无解释文案） | 无 | ❌ | ✅ capture 阶段（`:119`，注释说明为何必须 capture） | CSS `absolute` 居中向下（`:141`） | ❌ | 画布 | **低**：结构最干净的按钮触发下拉之一 |
| 8 | 提示词库选择器 | `nodes/NodeGenerationComposer.tsx:179` | 点 composer 里的按钮（`:606` `aria-haspopup="menu"`） | 提示词条数 | ✅ 缩略图 | ❌ | ❌ | 无 | 无（但有**悬停预览副面板**） | ✅ `:414` | ✅ capture（`:416`） | `createPortal` + `getBoundingClientRect` 上下翻转（`:381-403`） | ✅ 手写 | 画布 | **高**：它其实**不是菜单**（hover 出图文预览卡、长列表滚动）——建议不迁，见 §3.4 |
| 9 | 白板右键菜单 | `nodes/whiteboard/WhiteboardLeaferCanvas.tsx:732` | 白板内右键（Leafer 层） | 1 或 3 | ❌ | ❌ | ❌ | 无 | 无 | ✅ `useWhiteboardSelectionActions.ts:362-366` | ✅ `:370`（**延迟注册**跳过同批 pointerdown） | 相对白板 `absolute`（`:733`） | ❌ | 画布（白板节点内） | **中**：项集随选中数变（>1 只有「组合」，=1 才有翻转/抠图） |
| 10-14 | 3D 工具条「添加」+ 4 个子层 | `nodes/scene3d/scene3dToolbar.tsx:235 / 362 / 392 / 423 / 456` | 底部「添加」按钮（`:573-578`），子层由父项点击展开 | 5 / 6 / N / N / 2 | ✅ | ❌ | ❌ | 无 | ✅ **全仓唯一真子菜单**（父层 `:235` → 子层 `left-[164px]`），且「群众」叶子是**带数字输入的表单浮层**（`:489+`），不是菜单项 | ❌ | ✅ capture（`:198`，注释：r3f 冒泡阶段 stopPropagation） | 全部纯 CSS `absolute bottom-[calc(100%+8px)] left-[164px]` | ❌ | 画布（3D 节点内） | **高**：子菜单 + 非菜单叶子；建议排到批 3 |
| 15 | 侧栏右键菜单（分类/节点/子组） | `src/workbench/sidebar/CategoryTree.tsx:358` | 右键分类/节点/子组（`:423/433/453/454`） | 1-4（按 type 分支） | ❌ | ❌ | ✅ `:373/385/393` | 无 | 无 | ✅ `:104` | ✅ 但监听的是 **`click`** 不是 pointerdown（`:106`） | `fixed` + 裸 clientX/Y（`:117,360`） | ❌ **完全没有夹边** | 侧栏 | **低**：结构简单，且迁完顺手修好贴边被切 |
| 16 | 原稿/分镜方案菜单 | `src/workbench/creation/DocumentListSidebar.tsx:158` | 行内 ⋯ 按钮（`:140-148`） | 2-3 | ❌ | ❌ | ✅ `:195` | ✅ 只剩一份原稿时禁删 + `title`（`:201-202`） | 无 | ✅ `:54` | ✅ `:56`，另有 `resize` 关（`:57`） | `createPortal(document.body)` + `getBoundingClientRect` | ✅ 手写夹边（`:130-137`，高度按 kind **猜 120/88**） | 创作面侧栏 | **低**：最典型的「按钮触发下拉」样本 |
| 17 | 时间轴右键菜单 | `src/workbench/timeline/TimelineContextMenu.tsx:122` | 时间轴右键（`TimelinePanel.tsx:296-312`），4 种 target 各一套项 | 2 / 3 / 4 / 8 | ❌ | ✅ 右对齐 `<kbd>` | ❌ | 无 | 无 | ✅ `TimelinePanel.tsx:290` | ❌ **全仓唯一没有点外关闭的菜单** | `fixed` + clientX/Y | ⚠️ `Math.min` 夹边，但高度是 `items*34-12` **估算**（`:121`） | 时间轴 | **低**：单一调用点（`TimelinePanel.tsx:511`），宿主表面最小 |
| 18 | 预览控件「文字▾」 | `src/workbench/preview/PreviewControlBar.tsx:103` | 点「文字」按钮（`:100`） | 2 | ✅ | ❌ | ❌ | 无 | 无 | ❌ | ✅ 由父持有（`TimelinePreview.tsx:235-241`） | CSS `absolute bottom-full right-0` | ❌ | 预览控件条 | **低** |
| 19 | 顶栏「布局」菜单 | `src/workbench/preview/EditingLayoutMenu.tsx:77` | 顶栏按钮（`:61-64`） | 3 复选 + 4 单选 + 1 动作 | ✅ `IconCheck` | ❌ | ✅ `:99` | 无 | 无 | ✅ `:39` | ✅ `:40` | CSS `absolute right-0 top-full` | ❌ | 应用顶栏 | **低**：**唯一同时用到 checkbox + radio + 分组标题**的菜单，最能验 API 完整度 |
| 20 | Agent 会话列表 | `src/workbench/ai/ProjectAgentResidentShell.tsx:514` | 面板头「会话」按钮 | 会话数 | ❌ | ❌ | ❌ | 无 | 无 | ⚠️ `:429-434` 是面板根 `onKeyDownCapture` | ❌ | CSS `absolute right-2 top-10` | ❌ | Agent 面板 | **高**：**它不是菜单**——每行两个按钮（切换 + 删除）、头部还有「新会话」动作。见 §3.4 |
| 21 | 浏览器 · 提示模式选择 | `src/ui/browser/dialog/NomiBrowserDialogView.tsx:511` | 截图后弹（`useBrowserDialogActions.ts:452`） | 2 | 由子组件 | ❌ | ❌ | 无 | 无 | ✅ `NomiBrowserDialog.tsx:325`（**分层 Esc**：素材站 → 模式 → 标签菜单 → 收藏菜单 → 关整窗） | ✅ `:104` | `fixed` + x/y | 读不出来（未见夹边） | 浏览器窗口 | **中**：分层 Esc 顺序是刻意设计，Radix 的 modal 焦点栈会改变这个顺序 |
| 22 | 浏览器 · 标签右键 | 同上 `:594` | 标签右键 | 2-3 | ✅ | ❌ | ✅ `:631`（仅 tabs>1 时） | ✅ 已收藏/无 URL 时禁收藏（`:604`） | 无 | ✅ `NomiBrowserDialog.tsx:329` | ✅ `:350` | `fixed` + x/y | ✅ `NomiBrowserDialogModel.tsx:185` | 浏览器窗口 | **中** |
| 23 | 浏览器 · 收藏右键 | 同上 `:650` | 收藏项右键 | 2 | ✅ | ❌ | ❌ | 无 | 无 | ✅ `:333` | ✅ `:361` | `fixed` + x/y | 读不出来 | 浏览器窗口 | **低** |
| 24 | 浏览器素材 · 资源右键 | `src/ui/browser/popover/BrowserAssetPopoverView.tsx:273` | 资源格右键 | 1-2 | ✅ | ❌ | ❌ | 无（改为**条件不渲染**，`:274`） | 无 | ✅ `NomiBrowserAssetPopover.tsx:251` | ✅ `:411-419` | 相对浮窗 `absolute` | ✅ `useBrowserAssetActions.ts:163` | 浏览器素材浮窗 | **低** |
| — | ComfyUI 工作流节点菜单 | `src/ui/onboarding/workflowPage/WorkflowNodeMenu.tsx:101` | 点图上的节点卡 | 2 段（角色 radio + 字段 checkbox） | ✅ | ❌ | ✅ `:159` | 无 | 无 | ✅ `:85`（capture + stopPropagation，防冒到设置对话框） | ❌（靠点画布空白清 selectedNodeId） | 容器相对 `absolute` + `ResizeObserver` 量真实高度（`:57-79`） | ✅ 唯一「量出来」而非猜出来的 | 设置 · 工作流页 | **高**：头部有 ✕ 关闭钮、字段行是 mono 值预览——形态更像面板 |

> 表里第 25 行（ComfyUI）不计入「24 个实例」的编号是因为它就是第 24 个之后的那一个；实际实例总数 **24**（17 个文件）。校验：browser dialog 3 + browser popover 1 + WorkflowNodeMenu 1 + CategoryTree 1 + edge 1 + FloatingToolbar 1 + Composer 1 + Whiteboard 1 + scene3d 5 + Frame 1 + CanvasToolbar 2 + NodeContextMenu 1 + DocumentList 1 + AgentShell 1 + EditingLayout 1 + PreviewControlBar 1 + TimelineContextMenu 1 = **24**。

### 1.1 行为现状的三个数字

| 能力 | 有 | 没有 | 备注 |
|---|---|---|---|
| **方向键导航** | **0 / 24** | 24 | 17 个文件里 `ArrowUp\|ArrowDown` 命中 **0** 次。用户说的「键盘完全不能用」属实。 |
| **Escape 关闭** | 15 ✅ + 3 ⚠️ | 6 ❌ | ❌ 的是：连线模式菜单、节点浮条下拉、scene3d 5 个中的全部（共用一个 `addMenuOpen`，算 1 组）、预览「文字▾」。⚠️ 的是 CanvasToolbar 更多菜单、Agent 会话列表、（部分）——都是「焦点得在子树里」。**订正上游方案的说法**：文件内自带 Escape 的确实只有 7 个，但另有 8 个实例的 Escape 由**宿主**处理（`TimelinePanel.tsx:290`、`useGenerationCanvasReactFlowMenus.ts:199`、`useCanvasFrameActions.ts:133`、`NomiBrowserDialog.tsx:318`、`NomiBrowserAssetPopover.tsx:233`、`useWhiteboardSelectionActions.ts:363`）——所以「Esc 有时候能关有时候关不掉」的体感来源是**每个面各写各的**，不是全都没写。 |
| **点外关闭** | 22 | 2 | 没有的是 **时间轴右键菜单**（`TimelineContextMenu`，只能 Esc 或点项）和 **连线模式菜单**。另外 `CategoryTree.tsx:106` 监听的是 `click` 而其余全是 `pointerdown`——同一个手势在两个面响应时机不同。 |

### 1.2 定位机制五套（刀 1 会引入第六套 = Radix）

1. `fixed` + 裸 `event.clientX/Y`：`CategoryTree.tsx:117,360`（**无夹边**）、browser 三个菜单（有夹边，`NomiBrowserDialogModel.tsx:185`）、`TimelineContextMenu.tsx:121`（**按估算高度**夹边）。
2. stage 相对 `absolute` + 手写夹边常数：`useCanvasContextNodeMenu.ts:76-80,138-139`（`MENU_WIDTH=148 / MENU_HEIGHT=330 / NODE_MENU_HEIGHT=196` 全是硬编码）、`useCanvasFrameActions.ts:72-73`。
3. `createPortal` + `getBoundingClientRect`：`DocumentListSidebar.tsx:146,156`、`NodeGenerationComposer.tsx:169,384`。
4. 纯 CSS `absolute` 贴父：`CanvasToolbar.tsx:375`、`NodeFloatingToolbar.tsx:141`、`scene3dToolbar.tsx:232,359,389,420,453`、`EditingLayoutMenu.tsx:73`、`PreviewControlBar.tsx:103`、`ProjectAgentResidentShell.tsx:512`、`GenerationCanvasReactFlowNodes.tsx:355`、`WhiteboardLeaferCanvas.tsx:733`、`BrowserAssetPopoverView.tsx:273`。
5. `ResizeObserver` 量真实高度：`WorkflowNodeMenu.tsx:57-79`（**唯一不猜高度的**）。

---

## 2. 判断题 A：分批怎么切

上游方案点名的三个是 `NodeContextMenu` / `TimelineContextMenu` / `CanvasToolbar`。**实读之后我的建议是：换掉第三个。**

### 2.1 第一个该迁的：`TimelineContextMenu`（不是 NodeContextMenu）

理由三条，按重要性排：

1. **它今天坏得最明显，而修它不需要碰任何手势代码。** 全仓唯一「点外面不关」的菜单（§1.1），高度靠 `menuItems.length * 34 - 12` 估算（`TimelineContextMenu.tsx:121`）——项数一变夹边就错。Radix 一接上，点外关闭 + 真实测量避让 + 方向键三样一起有了。
2. **宿主表面最小。** 只有一个调用点（`TimelinePanel.tsx:511`），触发是一个朴素的 `onContextMenu`（`TimelinePanel.tsx:296-312`），可以 1:1 映射到 `ContextMenu.Trigger`。反观 `NodeContextMenu`，它的宿主 `useCanvasContextNodeMenu.ts` 是全仓最难的指针编排之一（Chromium 在 pointerdown 就派 `contextmenu`、右键平移和弦、node/frame/blank/selection 四分流、pointer**up** 才提交），刀 1 第一刀就动它，等于把「原语设计对不对」和「右键手势有没有回归」两件事绑在一起验——出问题分不清是谁的锅。
3. **它一个菜单就把 API 的一半打完了**：4 套按 target 分支的项集、右对齐快捷键 `<kbd>`、危险项（一次出现 5 个）、无图标形态。

### 2.2 建议的三个（刀 1）

| 顺序 | 菜单 | 验证什么 | 为什么是它 |
|---|---|---|---|
| ① | `TimelineContextMenu` | `ContextMenu` 包、右对齐快捷键、危险项、项集按上下文分支 | 见上 |
| ② | `NodeContextMenu`（+ 同宿主的 `FrameContextMenu`） | 图标 + 禁用 + 禁用原因 + 分隔线；**并逼出「Radix 到底吃掉多少 `useCanvasContextNodeMenu`」这个决定** | 组件本身最干净（135 行、纯 props），但宿主最难——放第二个，此时原语已被①验过 |
| ③ | `EditingLayoutMenu` **或** `DocumentListSidebar`（**不是 `CanvasToolbar`**） | `DropdownMenu` 包、checkbox/radio 项、分组标题、按钮触发 + portal + 夹边 | 见 §2.3 |

### 2.3 为什么把 `CanvasToolbar` 挪出刀 1

它是三个里**最不典型**的：①「更多」是 **hover 200ms 打开**（`CanvasToolbar.tsx:342-349`），Radix `DropdownMenu` 的 Trigger 没有 hover-open 语义，得自己接受控 open——第一批就撞上原语的边界；②同一份 `NodeAddMenu` 被用在三种模式（工具条更多 / 空白右键 / **连线落空的程序化点位**），其中第三种**没有触发元素**，只能走 virtual anchor；③里面还有个 `<input type="file">` 项（`:65-89,199`），Radix 的 `onSelect` 默认会关菜单，`.click()` 会赶不上——需要 `event.preventDefault()`。这三条都是「原语要不要支持某某」的问题，适合在①②把原语定型之后再谈。

如果只能三选一保留 `CanvasToolbar`：**建议只迁它的「更多」那一个菜单（`:378`），`NodeAddMenu` 留到批 2 和连线菜单一起。**

---

## 3. 判断题 B：`WorkbenchMenu` 要支持什么

「需要」= 现役至少一处在用且属于已拍板形态；「不需要」= 现役没有，别提前造。

### 3.1 必须有（每条都指得出现役消费者）

| 能力 | 现役出处 |
|---|---|
| 普通项：图标（**可选**）+ 文案 | 有图标：#1 #2 #4 #6 #10-14 #18 #19 #22-24；无图标：#9 #15 #16 #17 #20 |
| **右对齐快捷键提示** | `NodeContextMenu.tsx:127`（`⌘ C` 等）、`TimelineContextMenu.tsx:127`（`<kbd>`：S/⌘D/⌫/⇧⌫/Q/W） |
| **危险项（红）** | `NodeContextMenu.tsx:116`、`TimelineContextMenu.tsx:126`、`CategoryTree.tsx:355`、`DocumentListSidebar.tsx:154`、`NomiBrowserDialogView.tsx:634,671`、`BrowserAssetPopoverView.tsx:280` |
| **禁用 + 禁用原因** | `NodeContextMenu.tsx:104`（外包一层 `<span title>` 才触发得了 tooltip）、`FrameContextMenu.tsx:105`、`DocumentListSidebar.tsx:201-202`、`NomiBrowserDialogView.tsx:604`。**注意**：Radix `Item` 不是 `<button disabled>`，`title` 直接挂得上——外包那层可以顺手删掉（属于「只换实现」范围内的净收益） |
| **分隔线** | 7 处：#1 #4 #15 #16 #19 #22 及 `WorkflowNodeMenu.tsx:159` |
| **分组标题（段名）** | `CanvasToolbar.tsx:103-106`（`role="group"` + 标题）、`EditingLayoutMenu.tsx:80,100`、`WorkflowNodeMenu.tsx:122,160` |
| **checkbox 项** | `EditingLayoutMenu.tsx:87`、`WorkflowNodeMenu.tsx:169` |
| **radio 项** | `EditingLayoutMenu.tsx:108`、`GenerationCanvasReactFlowNodes.tsx:363`、`WorkflowNodeMenu.tsx:135` |
| **项内第二行灰字说明** | `FrameContextMenu.tsx:124-126`（「解散」下面那句「框没了，节点和连线都留着」——这是拍过板的、最容易被误当删除的一项） |
| **程序化在某点打开（无触发元素）** | #3 连线落空菜单、#17 时间轴（clientX/Y）、#15 侧栏、#21-24 浏览器。→ 原语必须同时暴露 `ContextMenu`（真右键）与 `DropdownMenu + 虚拟锚点`（给点位）两条路 |
| **选中后不关菜单** | `EditingLayoutMenu.tsx:93`（面板开关是多选，**有意**不关；同文件的预设选完就关，`:115`）→ 需要 `closeOnSelect` 开关 |
| **`onSelect` 可阻止关闭以便同步调 `.click()`** | `CanvasToolbar.tsx:199,204`（文件选择器） |

### 3.2 建议**先不做**（刀 1 不进 API）

- **子菜单**：全仓只有 `scene3dToolbar` 一处（#10-14），而且它的「群众」叶子是**带数字输入的表单浮层**（`:489+`），本来就不该是菜单项。等 scene3d 排到批 3 时再决定是 `DropdownMenu.Sub` 还是拆成「菜单 + 独立弹层」。
- **长列表虚拟化 / 搜索框 / 项内缩略图预览**：`NodeGenerationComposer` 提示词选择器（#8）在用，但见 §3.4——它不该是菜单。
- **多级嵌套（>1 层）、项内头像/徽标、菜单内 header 动作按钮**：现役 0 处需要（`ProjectAgentResidentShell` #20 和 `WorkflowNodeMenu` 有，但同样见 §3.4）。

### 3.3 顺带能删的重复代码（迁完自然消失，不额外做）

`useCanvasContextNodeMenu.ts:76-80` 的 `MENU_WIDTH/MENU_HEIGHT/NODE_MENU_HEIGHT/MENU_EDGE_GAP`、`useCanvasFrameActions.ts` 的同名常数、`DocumentListSidebar.tsx:130-131` 的 `menuWidth/menuHeight`、`TimelineContextMenu.tsx:121` 的 `items*34`、`NomiBrowserDialogModel.tsx:133,185`、`browserAssetPopoverConstants.ts:20` —— **六处各写一遍「菜单多高多宽」的猜测**，Radix 的 collision detection 量的是真实盒子，这些常数全部可删。这是刀 1 最实在的一笔账。

### 3.4 三个「顶着 `role="menu"` 但不是菜单」的（建议不迁，列出来备案）

| 它 | 为什么不是菜单 | 建议 |
|---|---|---|
| `ProjectAgentResidentShell.tsx:514` 会话列表 | 每行两个可聚焦按钮（切换 + 删除，`:527,534`）、头部还有「新会话」动作（`:518`）。菜单项语义是「一项一动作」 | 改成 popover + list，**另开任务**，不属刀 1 |
| `NodeGenerationComposer.tsx:179` 提示词选择器 | hover 出图文预览副面板（`:144-166`）、`max-h-[310px]` 滚动长列表 | 是 listbox/picker，另开任务 |
| `WorkflowNodeMenu.tsx:101` | 头部有 ✕ 关闭钮（`:112-119`）、字段行是 mono 值预览、自己 `tabIndex={-1}` 抢焦点（`:94`） | 是节点属性面板，另开任务 |

**如果这三个也套 `WorkbenchMenu`，会把原语撑成一个大而全的 API——正是任务书要避免的。**

---

## 4. 判断题 C：必须问用户的形态差异（**一条都没自行统一**）

> 每条都是「同一件事在不同面长得不一样」。刀 1 的铁律是只换实现，所以下面每条的默认处置都是**照抄现状**；要不要统一，请用户逐条拍板。

### 4.1 同一个动作，文案不同

| # | 差异 | 出处 |
|---|---|---|
| C1 | **「复制」是三个不同动作**：画布 `复制` = 剪贴板 copy（⌘C，`resources.ts:377`）；时间轴 `复制` = duplicate（⌘D，`timelineEditor.ts:27 duplicate`）；侧栏 `复制` = 复制到别的分类（`libraries.ts:157`）。三处**同字不同义** | `NodeContextMenu.tsx:60` / `TimelineContextMenu.tsx:53` / `CategoryTree.tsx:382` |
| C2 | **「删除」四种写法**：`删除`（画布/时间轴/浏览器/侧栏节点）、`删除原稿`（`creationAi.ts:11`）、`删除分类`（`libraries.ts:156`）、`删除（连节点）`（`libraries.ts:160`） | 表中 #1 #15 #16 #17 #22-24 |
| C3 | **「建组」四种写法**：`建组`（`resources.ts:381`，⌘G）、`组合`（白板，`generationCommon.ts:764`）、`新建子组`（`libraries.ts:154`）、`创建分组 (⌘G)`（选中浮条，`generationCommon.ts:1130`） | #1 / #9 / #15 |
| C4 | **「解散组」三种写法**：`解散`（框，`generationCommon.ts:213`）、`解组（保留节点）`（`libraries.ts:159`）、`解除分组 (⇧⌘G)`（`generationCommon.ts:1129`） | #4 / #15 |
| C5 | **「重命名」两种**：`重命名`（侧栏/浏览器/原稿列表）vs `改名 / 说明`（框菜单，`generationCommon.ts:209`） | #4 vs #15 #16 #23 |

### 4.2 同一类项，顺序/结构不同

| # | 差异 | 出处 |
|---|---|---|
| C6 | **危险项与分隔线的关系三种**：`NodeContextMenu` 分隔线在**倒数第 2 项前**（删除独占一段，`:101`）；`FrameContextMenu` 分隔线在**最后一项前**，但那一项（解散）**不是红的**（`:101`）；`TimelineContextMenu` clip 分支**连排 5 个危险项、一条分隔线都没有**（`:61-64`） | — |
| C7 | **`TimelineContextMenu` 的 clip 菜单里 4 个红项连排**（删除 / 涟漪删除 / 删除左侧 / 删除右侧），「删除播放头左/右侧」这类范围操作是否该同为危险色，无一致规则 | `TimelineContextMenu.tsx:61-64` |
| C8 | **选完是否关菜单不一致**：`EditingLayoutMenu` 面板开关**不关**、预设**关**（`:93` vs `:115`，注释说是有意）；scene3d 子层选完**全关**（`:204,408`）；白板抠图关（`:764`）、翻转**不关**（`:754,757`） | — |

### 4.3 视觉不一致（同一 token 系统里各写各的）

| # | 差异 | 出处 |
|---|---|---|
| C9 | **有无图标**：画布/框/浏览器/3D/预览有图标；**时间轴 / 侧栏 / 原稿列表 / 白板 完全没有** | #17 #15 #16 #9 |
| C10 | **快捷键提示写法**：`NodeContextMenu` 走 `platformModifier(navigator.platform)` 生成「⌘ C」（**带空格**，`:49,60`）；`TimelineContextMenu` 是**硬编码字面量**「⌘D」（无空格、**无平台适配**，Windows 上仍显示 ⌘，`:53`）；删除键一处写 `Del`（`NodeContextMenu.tsx:78`）另一处写 `⌫`（`TimelineContextMenu.tsx:61`） | — |
| C11 | **菜单宽度 12 种**：124 / 132 / 148 / 156 / 168 / 172 / 176 / 188 / 212 / 244 / 280 / `min-w-52` | 见 §1 各行 |
| C12 | **分隔线三种画法**：`h-px bg-nomi-line`（#1 #4 #15 #16）、`h-px bg-nomi-line-soft`（#22）、`border-t border-[var(--workbench-border)]`（#19）、`border-t border-nomi-line-soft`（WorkflowNodeMenu） | — |
| C13 | **悬停底色三种**：`hover:bg-nomi-ink-05`（多数）、`hover:bg-[var(--workbench-hover)]`（#17 #18 #19）、`hover:bg-nomi-accent-soft` + 变强调色文字（#9 白板） | — |
| C14 | **项字号/行高**：`text-caption` + `h-8`（多数）vs `text-micro` + `py-1.5`（#17 时间轴）vs `py-1`（#15 侧栏）vs `py-1.5`（#16） | — |
| C15 | **有无 `aria-label`**：10 个有；**6 个没有**（#17 时间轴、#15 侧栏、#7 浮条下拉、#18 预览文字、#20 Agent 会话、#9 白板） | — |

### 4.4 行为不一致（属于「Esc 有时候能关」的直接来源）

| # | 差异 | 出处 |
|---|---|---|
| C16 | **点外关闭：时间轴右键菜单没有**（只能 Esc 或点项）；**连线模式菜单也没有**（只能点项或再点胶囊） | `TimelinePanel.tsx` 全文无 outside-click；`GenerationCanvasReactFlowNodes.tsx:353-390` |
| C17 | **右键菜单的打开时机两派**：画布在 **pointerup** 才提交（为兼容右键平移/连线，`useCanvasContextNodeMenu.ts:186-201`）；时间轴/侧栏/浏览器在 **contextmenu 事件**立刻开 | — |
| C18 | **点外关闭听的事件不同**：`CategoryTree.tsx:106` 听 `click`，其余全听 `pointerdown`（其中 #7 #10-14 #8 必须用 **capture** 才收得到，各自都写了注释解释原因） | — |
| C19 | **浏览器窗口有一套分层 Esc 顺序**（素材站 → 提示模式 → 标签菜单 → 收藏菜单 → 关整窗，`NomiBrowserDialog.tsx:318-338`），别处没有分层概念 | — |

**建议问用户的方式**：C1/C2/C3/C4/C5（文案）与 C6/C9/C10（形态）合成一轮，其余（C11-C15 纯视觉、C16-C19 纯行为）我的判断是**行为类可以直接按 Radix 的统一语义收敛**（这正是刀 1 要解决的病），**视觉类跟着原语的 token 走**，只有**文案与项的排布**必须用户拍。

---

## 5. `AnchoredPopover` 的注释怎么写（刀 1 之后）

现状：`src/design/AnchoredPopover.tsx:7-30` 刚被改成诚实版，列了四套定位机制。刀 1 引入 Radix 菜单后会有**第五套**（严格说 Radix 已经在了——`src/design/tooltip.tsx`，所以刀 1 是让第②类**多一个用途**，不是新增第五套）。

**建议的分界线（一句能被机器验的话，而不是又一句 P1）：**

> **按「浮层里放的是什么」分，不是按「谁先写的」分：**
> - **一列可执行的动作** → Radix（`WorkbenchMenu`）。判据：内容是 `menuitem` / `menuitemcheckbox` / `menuitemradio` 的列表，选一项就发生一件事并（默认）收起。
> - **一块要读、要填、要拖的内容** → `AnchoredPopover`。判据：里面有输入框、滑块、画布、多焦点的富内容。
> - **居中模态** → `DesignModal`（Mantine），不锚点。
> - **纯提示文字** → Radix Tooltip。

**为什么这么划才不会又变成假话**：上一版那句「一律用它」管不住 8 个反例；「菜单走 Radix / 其余走 AnchoredPopover」如果按**组件名**划，`WorkflowNodeMenu`、`ProjectAgentResidentShell` 会议列表、提示词选择器这三个名字里带 menu、role 也写着 menu 的东西马上就是反例（§3.4）。按**内容形态**划则三个都干净落在 `AnchoredPopover` 一侧。

**建议注释同时写死两件事**（否则下一个人还是判断不了）：
1. 刀 1 之后**剩几个手写 `getBoundingClientRect` + `createPortal`**、分别是谁（现在是 8 个文件，注释里已点名）——迁完必须把这份名单**当场改数**，数对不上就是注释又过期了；
2. 明说「`role="menu"` 不等于菜单」，并把 §3.4 那三个反例的 file:line 写进去——这是这份注释唯一能防住的复发。

**更硬的做法（建议但不属刀 1）**：把这段注释里的名单做成 `check:` 门岗的一行登记（和 `check:framework-boundary` 同一套路），注释只说规则、名单交给脚本数。否则「四套 / 五套」这个数字每合一个 PR 就有可能过期一次，而没有任何东西会红。

---

## 6. 本文没做的事

- 没改任何生产代码，没装包，没跑走查。
- 没有统一任何文案、顺序、图标、宽度——§4 全部原样留着等拍板。
- 没有评估 `scene3dToolbar` 的子菜单该怎么迁（建议批 3 再看）。
- 没有核实各菜单在**真机**上的实际观感（本文结论全部来自读码；表中任何「读不出来」的格子都如实写了）。

---

## 6. 用户裁决（2026-09-08）

三条已拍板，刀 1 起生效。**除下列明确列出的改动外，其余文案/图标/项的排布一律照抄现状。**

### 6.1 C1「复制」按真实行为改名（同字不同义 → 消歧）

| 出处 | 现文案 | 新文案 | 实际行为 |
|---|---|---|---|
| `NodeContextMenu.tsx:60` | 复制 | **复制**（不变） | ⌘C 进剪贴板，需再粘贴 |
| `TimelineContextMenu.tsx:53` | 复制 | **创建副本** | ⌘D 当场生成副本 |
| `CategoryTree.tsx:382` | 复制 | **复制到…** | 复制到别的分类 |

理由（用户口径）：前两处都在做视频、都叫「复制」，按下去一个看不见反应、一个当场多一个，用户会点错。

### 6.2 C2–C5 文案收敛为单一说法

- **建组**：`建组` / `组合` / `新建子组` / `创建分组` → 统一 **`建组`**（侧栏语境保留 `新建子组`，因为它建的是**子**组，属宾语差异不是说法差异）
- **解散组**：`解散` / `解组（保留节点）` / `解除分组` → 统一 **`解散组`**；`libraries.ts:159` 保留括注 `（保留节点）`，因为它确实与另一条「删除（连节点）」成对，去掉会产生歧义
- **删除**：统一 **`删除`**；只有当同一菜单里有多个可删对象时才带宾语（`删除分类` / `删除（连节点）` 保留；`删除原稿` → `删除`，该菜单内无歧义）
- **重命名**：`改名 / 说明` → **`重命名`**（该项打开的对话框同时含名称与说明，说明字段在对话框里自明，不必进菜单文案）

原则：**带宾语只用于消歧，不用于修饰。**

### 6.3 C9 图标：本轮不补

时间轴 / 侧栏 / 原稿列表 / 白板四处继续无图标。补图标属形态改动，另行出样张拍板。

### 6.4 无需拍板、直接修的

- **C10 是 bug**：`TimelineContextMenu.tsx:53` 硬编码 `⌘D`，Windows 上照样显示 ⌘ → 改走 `platformModifier`，与 `NodeContextMenu` 同一函数。删除键 `Del` / `⌫` 一并按平台 derive。
- C6/C7（危险项与分隔线）、C8（选完是否关）、C11–C15（视觉）、C16–C19（行为）：跟原语的 token 与 Radix 统一语义收敛，不逐条问。

### 6.5 §6 的落地进度（刀 1 收尾时结算）

| 裁决 | 状态 | 落点 |
|---|---|---|
| C1 时间轴「复制」→「创建副本」 | ✅ 已落 | `i18n/locales/timelineEditor.ts:27`（en 原本就是 `Duplicate`，无歧义，不动） |
| C1 侧栏「复制」→「复制到…」 | ✅ 已落 | `i18n/locales/libraries.ts:157,339` |
| C1 画布「复制」保持不变 | ✅ 按裁决不动 | — |
| C10 菜单里的 `⌘D` 平台适配 | ✅ 已落 | `platformModifier` 从画布层挪到 `src/design/platformShortcut.ts`（连同 `isMacCanvasPlatform`→`isMacPlatform`，旧定义已删），时间轴与画布菜单共用同一来源 |
| C2–C5 文案收敛（删除/建组/解散/重命名） | ⏳ 刀 2 | 落在侧栏/白板/框/原稿列表等 17 个文件里，跟批量迁移一起做 |
| C10 剩余：i18n 词条里的 ⌘ 字面量 | ⏳ 刀 2 | `timelineEditor.duplicateShortcut` `shortcuts.*Key` 及 `generationCommon` / `settings` / `storyboardEditor` / `agentPanelV4` 五个 locale 文件仍有硬编码 ⌘（快捷键面板同族 bug）；**刀 2 要顺带加棘轮门岗：新增硬编码 ⌘ 即红** |
| C10 空格写法（`⌘ C` vs `⌘D`） | ⏳ 刀 2 | 等原语统一渲染 shortcut 时一次定；现在两处各保持原样 |
| C9 图标 | 按裁决本轮不补 | — |

**`⌫` vs `Del` 不属于要统一的差异**：查过 `timelineShortcuts.ts:49,57,58`，时间轴的删除**同时**接受
`Backspace` 与 `Delete`，两种字形都没写错，是字形选择不是不一致。
