# 画布：「+」拉环一致化 + Alt/⌥ 拖动复制 + 粘贴到鼠标处（2026-09-21）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实现（分支 `feat/canvas-handles-alt-drag-20260921`，未开 PR）
> 根因合同：[`docs/fixes/2026-09-21-connection-handle-visibility.root-cause.json`](../fixes/2026-09-21-connection-handle-visibility.root-cause.json)
> 走查：`tests/ux/canvas-handles-alt-drag.walk.mjs`（真 Electron + 登记真素材，zh / en 各一遍）

## 用户原话与要解决的摩擦

- 「+」拉环时有时无：选中图片卡后鼠标一移开，「+」就没了；视频 / 文本 / 音频卡永远只有小圆点。
- 「Alt 是万能的，不管是在节点上还是素材上，拖动就会复制一个出来，比 Ctrl+C/V 顺手很多，因为 Ctrl+C/V 的时候粘贴的位置会乱跑，Alt 拖出来的位置就是 100% 我要放的位置。」

## 先查别人

#### 竞品（一手）

- **LibTV 快捷键面板**（用户 2026-09-21 截图，证据：[`2026-09-21-alt-drag-duplicate-evidence/libtv-shortcuts-panel.webp`](2026-09-21-alt-drag-duplicate-evidence/libtv-shortcuts-panel.webp)）：
  「节点复制 = Option 选项 + 拖动节点」——与我们的 Alt/⌥ 拖一致，按此做。
  「创建副本 = ⌘ + Option + 拖动」——**语义未知**（可能是「带上游连线一起复制」），见下「待用户确认」，本轮不做。
  「复制节点和连线 = ⌘D」——原地复制所选节点及其内部连线，见下「后续候选」，本轮不做。
  面板把 Option + 拖动直接写进快捷键帮助——我们的提示照这个形式进「画布操作」帮助面板。
- **LibTV 网页版实测**：未实测。原因：https://www.liblib.tv/ 打开项目需微信 / 手机号登录（2026-09-21 用内置浏览器打开，点「项目」即弹登录框），按约定不登录。
- **TapNow 网页版实测**：未实测。原因：https://app.tapnow.ai/ 「工作空间」显示「尚未登录 · 登录以开始使用」，按约定不登录。

#### 开源白板（读源码，file:line）

- tldraw `packages/tldraw/src/lib/tools/SelectTool/childStates/Translating.ts:101-106,135-138,166-186`（commit 9bf849f）：
  拖动开始时按着 Alt → `startCloning()`：打一个历史标记、`duplicateShapes(选中)`、之后搬的是副本；拖动中松开 Alt 还能回退成「搬原件」。
  **复制发生在「开始移动」那一刻，不是按下那一刻**——只点不拖不会多出东西。我们框的 Alt 拖同样是「第一次真的移动时才复制」。
- tldraw `packages/editor/src/lib/editor/Editor.ts:10012-10041`：粘贴落点 `point` 与内容外接盒**中心**对齐（`offset = point - pageCenter`）；
  `packages/tldraw/src/lib/ui/hooks/useClipboardEvents.ts:39-47,896,910`：`pasteAtCursor` 时 point = 当前指针页面坐标，否则落视口中心（默认偏好 `isPasteAtCursorMode: false`，Alt 反转）。
- Excalidraw `packages/excalidraw/components/App.tsx:4816-4838`（commit 97c68dd）：粘贴 `position: "cursor"` 用 `viewport.lastPosition`（最后一次指针位置），否则视口中心；
  `packages/excalidraw/components/App.duplicate.ts:86-93`：以元素外接盒**中心**对准该点。
  `App.tsx:11119-11121` + `App.duplicate.ts:163-209`：拖动中 `event.altKey && !hasBeenDuplicated` → 原地复制所选（含框内元素 `includeElementsInFrames: true`）再继续拖。

#### 与我们默认的取舍

- 粘贴：tldraw 默认「视口中心」、Excalidraw 默认「指针处」。用户原话要的是「位置 100% 是我要放的」，所以采用 Excalidraw 那一派：**鼠标在画布上 → 粘在鼠标处；不在画布上 → 画布中央**。两家都以**中心**对准该点，我们同样。
- Alt 拖框：Excalidraw 复制框时连框内元素一起复制，我们同样（成员 + 成员之间的连线 + 框矩形）。

## 做了什么

### A. 「+」拉环（bug 修复，走 root-cause）

四个条件同时成立才可见（真机证实）：① 选中 ② 唯一主选中 ③ kind 是图片类 ④ 鼠标悬停在卡上（CSS `opacity:0` 只在 hover/focus 才露）。

- 唯一 owner `reactFlow/generationCanvasReactFlowVisualContract.ts`：不再读 kind——**能起线的卡（画布内核里每张非只读卡都是 connectable）唯一选中即 magnetic**；多选 / 起线源 → 小圆点；折叠编组占位 → hidden。
- CSS 去掉悬停门：选中即常驻（0.82 不透明），跟手保留。
- 删掉 BaseGenerationNode / ClipNode / DirectorNode 里被 `display:none` 挡住的旧磁吸把手副本（P1）。
- 走查发现并修掉：带子常驻后，选中卡伸出卡外的「2 版」版本胶囊落在带子命中区里，点它会变成起线——选中卡的卡面抬到带子之上（卡面与带子不重叠，不吃起线入口）。

几何（旧 = 迁移前 `8f9365aeb`，新 = 本分支，画布坐标）：

| 部件 | 旧 | 新 |
|---|---|---|
| 未选中圆点命中 | 28×28（`w-7 h-7` 按钮） | 28×28（真机量 28） |
| 未选中可见圆点 | 14×14 | 14×14（真机量 14） |
| 选中磁吸带 | 112 × min(168, h+28)，每侧 | 同 |
| 「+」圈 | 29×29，**默认 opacity 0，hover 卡才 0.82** | 29×29，**常驻 0.82**，hover / 跟手 / 吸附 1.0 |
| 谁有带子 | 选中的图片类（每张） | 唯一选中的**任意**可连线卡 |

各种卡的处置表见本节末。

### B. Alt/⌥ 拖动复制 + 粘贴到鼠标处

1. **Alt 拖节点**：已有（`duplicateNodesForDrag`），本轮只补走查与提示。
2. **Alt 拖框**：`store/canvasGroupMoveActions.ts` 新增 `duplicateGroupForDrag`——复用剪贴板的 build/clone 原语（与 ⌘C/⌘V、节点 Alt 拖同一份），同一次事务里建新框、装副本、带成员之间的连线，**一个撤销点**；`useCanvasSelectionDrag` 在按着 Alt 的框拖动**第一次真正移动**时调用它，然后搬副本。
3. **Alt 拖结果堆叠里的单个版本**：现有语义——版本托盘里的拖动什么也不做（托盘带 `nodrag`），点一下是「设为当前版本」。新增：按着 Alt 拖一行 → HTML5 拖放进画布舞台 `onDrop`（`components/canvasResultDrag.ts`），松手点经内核 `screenToFlowPosition` 换算，新素材卡**中心**压在松手点，按缩略图读到的真实像素定卡面比例；原节点与版本堆叠不变；一个撤销点。不按 Alt 拖 = 什么也不发生（保持现状）。
4. **⌘V 粘贴到鼠标处**：`reactFlow/useCanvasPastePlacement.ts` 记住鼠标最后一次在舞台里的位置（离开舞台即清空）；节点粘贴与剪贴板媒体粘贴共用这一个落点来源。`pasteNodes(point, anchor)` 按粘贴簇**看得见的**外接盒中心对准该点。右键菜单「粘贴」同样改为以右键点为中心（一个点只有一种含义）。
5. **提示**：「画布操作」帮助面板「节点操作」组加一行「⌥ Option + 拖动 / Alt + 拖动 → 拖出副本」，键名按平台（`design/platformShortcut.ts` 的 `platformAltKey`）；zh / en。不加常驻控件（§1.5：快捷键是加速器不是入口）。

「落点」共用词汇：`model/canvasPlacement.ts`（`{ point, anchor }` + 中心锚），拖入 / 粘贴 / 结果拖出都用它，对齐结构评审 `docs/audit/2026-09-21-canvas-node-placement-structure.md` §3 提议的「放置意图」形状。

## 待用户确认

- **LibTV「创建副本 = ⌘ + ⌥ + 拖动」** 语义未知（带上游连线一起复制？复制成变体？）。未实现，等用户说清。
- **收起的编组卡**的把手：它不在画布内核里、也没有选中态（点它不选中成员），所以「唯一选中才有带子」这条规则没有输入。现状保留（带子常驻、悬停露「+」）。要不要给它加选中态、或改成常驻「+」，需要拍板。

## 后续候选

- LibTV「复制节点和连线 = ⌘D」：原地复制所选节点及其内部连线。
- 结构评审 §3「放置意图」：视频元数据回填后按锚点补位（目前视频卡尺寸回填时保持左上角）。

## 各种卡的「+」拉环处置表

| 种类 | 改前 | 能否作连线源 | 改后 | 说明 |
|---|---|---|---|---|
| image / keyframe / character / scene / asset / whiteboard / director（图片类或提供图片参考） | 选中 magnetic（悬停才见） | 能 | 选中 magnetic，常驻 | |
| panorama | dot（kind 例外） | 能 | 选中 magnetic | 带子在卡外侧，不碰卡内 360° 拖动，无领域冲突 |
| video | dot | 能 | 选中 magnetic | 用户点名 |
| text / audio / model3d / shot / output / clip / shot_table / agent-artifact | dot | 能（内核 connectable，完成连线时再判合法） | 选中 magnetic | |
| 插件节点（typeId） | 按 kind | 能 | 选中 magnetic | 同一 owner |
| 折叠编组占位节点（内核里） | hidden | 否（真把手在编组卡上） | hidden | |
| 收起的编组卡（投影层 CollapsedGroupCard） | 自带 MagneticConnectionHandle，常驻带子、悬停露「+」 | 能（连到组） | 不变 | 不是内核节点，无选中态；见「待用户确认」 |
| ClipNode / DirectorNode / BaseGenerationNode 卡内旧把手 | 挂载但 `display:none` | — | 删除 | 只剩内核壳里一套把手 |

## 验收

- 单测：`reactFlow/generationCanvasReactFlowVisualContract.test.ts`（全表逐种）、`reactFlow/useCanvasPastePlacement.test.ts`、`store/canvasDuplicatePlacement.test.ts`、`components/canvasControlsHelpModel.test.ts`、`components/canvasControlsStructure.test.ts`。阳性对照：改回只给图片类 → 15 条红；忽略 anchor → 红；忽略指针 → 红；框复制去掉撤销点 → 红。
- 走查：`tests/ux/canvas-handles-alt-drag.walk.mjs zh-CN|en`，截图在 `tests/ux/shots/canvas-handles-alt-drag/`。

## 不动项 / 回滚

- 不动：节点 Alt 拖的既有实现、连线完成的合法性判定、右键菜单结构。
- 回滚：revert 本分支提交即可，无数据迁移。
