# 模态弹层的输入优先：设计卡

改动名：模态弹层开着时工作区面不接键盘、粘贴、指针手势　线/负责人：I-modal-input-priority　类别：[其他：既有缺口，逻辑 bug]（路径启发式另命中「新界面」「花钱」，见「功能分类」；没有界面变化）

方向已由协调裁定（修在共享输入边界，开关状态来自浮层宿主自己），独立验收待协调派线。方向说明见 [direction-checks/2026-10-31-modal-input-priority.md](../engineering/direction-checks/2026-10-31-modal-input-priority.md)。

## 先查别人（★0）

全部实查，不凭记忆。结论：方向没有被推翻，有两条改了原先的做法（第 2、4 条）。

- [WAI-ARIA APG 模态对话框](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)：框下的窗口是 inert 的，用户不能与框外内容交互；`aria-modal="true"` 只在应用代码真的阻止了所有框外交互时才能写。影响：**确认了**目标。仓库里写着 `aria-modal="true"` 的宿主一直在做一个代码没兑现的承诺。
- [HTML 标准 inert 与 showModal](https://html.spec.whatwg.org/multipage/interaction.html) 加 Electron 43.4.1（Chrome 150）隐藏窗口实测：inert 只管命中测试、选择和焦点；键盘事件永远打到焦点元素，再冒泡到 window。`showModal()` 且焦点在框内、`inert` 工作区且焦点在门户框内、焦点落回 body 三种情形下，window 捕获 / document 冒泡 / window 冒泡都收到 Delete、Backspace、Meta+z、Meta+a，paste 也到 window；指针点在 inert 区，目标变成 BODY，监听仍然触发。影响：**改了**「能不能用原生 inert 或顶层元素代替」这个决定：不能，规则必须住在监听的共享边界上。
- [tldraw useKeyboardShortcuts](https://raw.githubusercontent.com/tldraw/tldraw/main/packages/tldraw/src/lib/ui/hooks/useKeyboardShortcuts.ts) 与 [dialogs.tsx](https://raw.githubusercontent.com/tldraw/tldraw/main/packages/tldraw/src/lib/ui/context/dialogs.tsx)：`areShortcutsDisabled` 读 `editor.menus.hasAnyOpenMenus()`，每个动作和工具快捷键都查它；对话框宿主在 `addDialog` 里 `addOpenMenu`，`removeDialog` 里 `deleteOpenMenu`。影响：**确认了**「宿主登记进状态，快捷键读状态，不查 DOM」。
- 已装 `@radix-ui/react-dismissable-layer@1.1.19` 的 `dist/index.mjs`（`layers` Set，`isHighestLayer = index === layers.length - 1`，`disableOutsidePointerEvents`）与 `@radix-ui/react-focus-scope` 的 `dist/index.mjs:196`（`focusScopesStack`）：用一个栈记录谁在最上层。影响：**改了**「直接复用 Radix」的设想，只取形状：它是传递依赖、不是公开原语，Mantine Modal 不往里登记，焦点栈也不管全局按键，不加新包。
- 已装 `node_modules/@mantine/core/esm/components/ModalBase/use-modal.mjs`：每个开着的 Modal 只在 window 捕获期管自己的 Esc，没有「现在有没有 Modal 开着」的读接口。影响：**确认了**登记口放在 `DesignModal`（仓库里唯一引入 Mantine `Modal` 的地方）。
- [Excalidraw Modal.tsx](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/components/Modal.tsx) 与 `App.tsx` 的 `onKeyDown`：弹窗只在 Esc 上 `stopImmediatePropagation`，其它键靠 `isInteractionEnabled()`、可写目标判断，外加逐弹窗特例（`openDialog?.name === "elementLinkSelector"`）。影响：**确认了**不走逐弹窗特例，这正是要避开的形状。
- 已装 `node_modules/@xyflow/react/dist/esm/index.js:387`（`useKeyPress`）与 `@xyflow/system/dist/esm/index.mjs:898`（`isInputDOMNode`、`.nokey`）：只看目标元素，没有模态概念；仓库设 `deleteKeyCode={null}`（`GenerationCanvasReactFlowViewport.tsx`）。影响：**确认了**画布的删除键完全归我们自己的边界，框架帮不上也不添乱。

## ★1 用户怎么用

当创作者面前开着一个弹层（确认框、设置、付费确认、看大图）时，我想手上按的键只对这个弹层起作用，以便不会在没看见的地方删掉、撤销或粘贴了东西。

1. 在画布或时间轴选中东西。
2. 触发一个弹层（删除确认、设置、花钱确认卡）。
3. 顺手按了 Delete、Backspace、Cmd+Z、Cmd+Shift+Z、Cmd+A 或 Cmd+V。
4. 工作区什么也没变；Esc 只关最上面那层。
5. 在弹层的输入框里打字、粘贴、全选，都照常。
6. 关掉弹层，下一次按键立刻回到工作区。

**不做什么**：不改弹层的样子、文案、焦点陷阱；不改模态之间的 Esc 仲裁（`hasOpenDialogAbove`）；不把导演台、全景这类「页面里的一块」算作模态（页层合同写明它们不是）；不做非模态浮层（菜单、任务中心、Agent 面板）的输入隔离，它们开着时工作区仍要能用。

**已知坑**：① 原生 inert 不拦 window 监听（★0 第 2 条）；② 灯箱只盖画布那一格，当成全窗模态会把旁边能点的时间轴和 Agent 一起弄死；③ 被盖住的面不能把「最近指针归属」让给没盖住的面，否则灯箱开着时按 Delete 会删时间轴片段；④ 弹层开在手势中途，不收尾就会留下卡住的拖动；⑤ 时间轴 `?` 帮助框的关闭原来靠面上的监听，登记后要归框自己；⑥ 手写模态没有焦点陷阱的，焦点可能留在框后（只隔离全局监听，焦点问题不在这一单）。

**真实任务**（真 Electron、隔离资料目录、真键盘，中英两轨）：① 选中真实图片节点 → 真确认框 → 六个键 → 节点、选区、撤销栈都不动；② 时间轴选中真实片段 → 真确认框 → 六个键 → 片段、选区都不动；③ 设置开着再叠确认框 → Esc 只关确认框 → 关设置 → 快捷键第一下就生效。

**指标**：
- 主指标：模态开着时，四面（画布、生成时间轴、预览时间轴、列表）× 六键造成的工作区变化次数。基线：修前 Delete 节点 1→0；目标 0。量具：`src/workbench/shortcutSurface.modalLayer.matrix.test.ts`，`tests/ux/modal-input-priority.walk.mjs`。
- 质量指标：关闭后第一下按键生效的比例，目标 100%。量具：同一走查的恢复段。
- 护栏指标：① 非模态浮层和未被盖住的面不被误挡，量具同上加 `tests/ux/hidden-surface-input.walk.mjs`；② 手写模态漏登记数为 0，量具 `src/workbench/modalInputLayerCensus.test.ts`；③ 输入路径没有变慢，量具 `pnpm run perf:scenarios`（★7）。

### ★1b 连带界面

不新增文字或状态。Agent 回执、通知、任务列表、错误卡、撤销提示都不变：工作区没有发生动作，也就没有回执。时间轴快捷键帮助框内容不变，只是关闭的归属挪到框本身。

## ★2 谁说了算

- 概念「模态输入层」（新登记 `docs/engineering/concept-owners/ui.modal-input-layer.json`）：唯一 owner 是 `src/design/modalInputLayer.ts`。写入只有 `useModalInputLayer(opened, covers)`，由持有 `opened` 状态的宿主调用；模块外读不到栈本身。
- 读的只有两处：`src/workbench/shortcutSurface.ts` 的 `workspaceInputSurfaceIsActive`（唯一一条层级优先规则）和窗口级快捷键 `ShellAgentHost`。灯箱读自己这层的 `isTopLayer()`。
- 概念「工作区输入面」`workspace.input-surface` 的 owner 不变，只是它的判断多了一项。碰了 2 个概念。
- 同一份事实存几份：1 份，开着的状态只在宿主，层是宿主状态的登记，随宿主卸载而消失。没有靠 DOM class、`[role=dialog]`、`aria-modal` 或 z-index 推断开关，也没有靠「东西不见了」猜意图。
- door-map（修前）：`node scripts/door-map.mjs shortcutSurfaceMayHandle workspaceInputSurfaceIsActive canvasSurfaceMayHandleInput canvasWindowInput canvasDocumentInput workspaceInputAttributes installShortcutSurfaceTracker` → 3067 文件，写 14、读 28，共 42 门 133 处。修后重数写进根因合同。全局监听的全表由普查测试钉死，见 ★9。

## ★3 一致与复用

- 手势打断复用 #1384 的那一对：`cancelCanvasInputGestures()`、`cancelCanvasDraggingWithin()`，和「宿主把面藏起来」走同一条语义，不写第二套收尾。
- `DesignModal` 仍是 Mantine `Modal`；Esc 原语 `useOverlayEscape` 不动（非模态的 `NodePointerGroup` 也在用，所以不把登记塞进它）。
- 栈本身是自写（Mantine 没有读接口，Radix 不是公开原语），登记进 `docs/engineering/self-written.json`，理由与退出条件写在条目里。
- 普查照 `src/workbench/pageLayerCensus.test.ts` 的 AST 办法，不另造扫描器。

## ★4 全状态

- 空（没有弹层）：栈为空，边界的判断与修前完全相同。
- 加载中（弹层代码还在懒加载）：弹层还没画出来，层也还没登记，工作区照常；提交那一帧才生效。
- 成功（弹层开着）：工作区面不接键盘、粘贴、指针手势；弹层里的输入框、按钮照常。
- 失败（宿主抛错或被错误边界卸载）：effect 清理会关掉这层，工作区恢复，不会永远锁死。
- 部分成功（嵌套或队列）：确认框排队换下一条时层不掉；上层关了，下层还在，工作区继续不接；灯箱之上再开确认框，灯箱自己的 Esc 也让路。
- 取消中：不适用：弹层关闭是同步的状态变化，没有取消中这一拍。
- 过期（灯箱开着切到别的工作区）：画布宿主不活动，灯箱的层只盖它那一格，别的页快捷键照常；切回来灯箱还在。
- 能力不可用：不适用：只读宿主状态，不依赖模型或外部资源。

## 5 中途表

不涉及花费，「花费」一律不扣不退；走查和单测是回执。

| 状态 | 停（关弹层） | 关窗 | 断网 | 重启 | 连点 / 连按 |
|---|---|---|---|---|---|
| 确认框开着 | 工作区恢复，第一下按键生效 | 进程结束，栈在内存里没有残留 | 无关 | 栈从空开始 | 连按 Delete 工作区不动 |
| 嵌套（设置 + 确认框） | 关一层剩一层，仍不接 | 同上 | 无关 | 同上 | Esc 连按逐层关 |
| 手势中途开弹层 | 手势已被打断，不会粘手 | 同上 | 无关 | 同上 | 松手不产生提交 |
| 灯箱开着 | Esc 关灯箱，画布恢复 | 同上 | 无关 | 同上 | 连按方向键翻页照常 |

## 6 外部数据与失败

不适用：本单不收外部数据，没有供应商 API、文件或用户内容。唯一的外部行为是浏览器的输入派发，规范链接和实测见 ★0 第 2 条，我们的偏差为零（不靠 inert 改派发），失败时用户看到的就是工作区没动。

## ★7 性能

①新增用户操作：没有。每次键盘、粘贴和指针事件经过边界时多一次 `Array.some`，开着 0 层时立即结束，手势热路径上不查 DOM。②最坏规模：3 层嵌套，150 节点画布多选拖动。③预算：沿用现有场景，帧间隔 p95 ≤33ms、长任务 0。④场景：现有 `canvas-drag-20-nodes`（`canvasWindowInput` 的 `pointermove` 就在这条路径上），数字进 PR 正文 `## 验收证据`，不改基线。

## 8 真实条件

英文界面、键盘全程：走查中英两轨都跑。真规模：不适用，判断量是层数不是节点数，性能场景另量 150 节点。Windows：`unverified`（本单只有 Mac，判断逻辑不分平台）。最小窗口：`unverified`（没有布局变化）。干净安装：`unverified`。真付费：不跑；付费确认卡只加一行登记，零花费走查照跑，真付费抽检交协调裁定。

拍板图清单：不适用：`pure-bugfix`，不改布局、元素、文案，只修行为。

## ★9 验收与回滚（实现前合同）

验收线（另一条线）对着下面逐项核，命令见每项。

**验收清单**

| # | 条目 | 量具 |
|---|---|---|
| A1 | 真确认框开着，画布选中节点，按 Delete / Backspace / Cmd+Z / Cmd+Shift+Z / Cmd+A / Cmd+V：节点、选区、撤销栈都不动（Cmd+V 等过 120ms 兜底计时器） | 走查 + 矩阵 |
| A2 | 同样六键，生成页时间轴选中片段：片段、选区都不动 | 走查 + 矩阵 |
| A3 | 同样六键，预览页时间轴：不动 | 走查 + 矩阵 |
| A4 | 列表视图开着确认框按 Esc：只关确认框，列表检查器还在 | 走查 |
| A5 | 关确认框后快捷键马上恢复（正向断言：Cmd+A 全选、Delete 真的删） | 走查 |
| A6 | 嵌套：设置里再开确认框，Esc 只关确认框，设置还开着时六键仍不动；关掉设置后恢复 | 走查 + 矩阵 |
| A7 | 模态里的输入框打字、Backspace、Cmd+A、Cmd+V 正常，画布不动 | 走查 |
| A8 | 手写模态和灯箱：付费确认卡；看大图灯箱（Delete 不删节点，Esc 关，方向键翻页；灯箱开着点时间轴，时间轴能用） | 走查 + 矩阵 |
| A9 | 确认框排队：第一条答完第二条接上，中间层不掉 | 走查 + 单测 |
| A10 | 手势中途弹层打开：`data-dragging` 不残留，手势不提交 | 走查 + 单测 |
| A11 | 非模态不误挡：Agent 面板、任务中心、菜单开着时，画布快捷键照常 | 走查 |
| A12 | 灯箱开着切到别的工作区：别的页快捷键活着，切回来灯箱还在 | 走查 |
| A13 | Mod+J 在窗口级模态下不响应，灯箱下照常响应 | 走查 |
| A14 | 普查：每个模态写法的宿主都调了登记（或在带理由的豁免表里，过期的豁免也红）；每个全局键盘、粘贴、指针监听都分了类；只有 `overlays.tsx` 引入 Mantine `Modal` | `src/workbench/modalInputLayerCensus.test.ts` |

命令：`pnpm exec vitest run src/workbench/shortcutSurface.modalLayer.matrix.test.ts src/workbench/modalInputLayerCensus.test.ts src/design/modalInputLayer.test.ts`；真窗 `WALK_LOCALE=zh-CN node tests/ux/modal-input-priority.walk.mjs`，`WALK_LOCALE=en` 同一条。

**反例（真跑，做完按字节还原，留 SHA256 收据）**

| # | 改动 | 必须红 |
|---|---|---|
| M1 | 去掉 `workspaceInputSurfaceIsActive` 里的层级优先判断 | 矩阵、走查 |
| M2 | `DesignModal` 不登记 | 普查、走查 |
| M3 | 任一手写模态删掉登记 | 普查 |
| M4 | 层关不掉（`close` 变空操作） | 栈单测、矩阵恢复段 |
| M5 | 把只盖画布格的层当全窗层（`covers` 判断恒真） | 矩阵 |
| M6 | 「最近指针归属」改用带层级的判断 | 矩阵 |
| M7 | 弹层打开不打断手势 | 矩阵 |
| M8 | 新增一个裸 `window.addEventListener('keydown', …)` | 普查 |

**硬门对账**：⑩ 说的 = 摆的：不适用，不是意图或草稿参数；⑪ 能选到：不适用，不是模型档案入口；⑫ 点了 = 以为的：按 Delete，用户以为作用在眼前的弹层，真窗断言工作区不动。

**回滚**：revert 本单的产品提交，没有开关，没有兜底路径。独立验收报告链接在 PR 正文 `## 独立验收`，由协调派线后填。

### 功能分类

路径启发式推出的类别（本单没有新增操作或界面）：

- [x] 新界面 / 改交互
- [x] 花钱
- [x] 大数据量 / 画布 / 长列表
- [x] 新增功能 / 性能
- [x] 生成效果
