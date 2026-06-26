# 白板巨壳拆分（Rule 9 / R12）— 2026-06-25

## 背景
PR#21 引入白板节点时为过门岗把两个巨壳临时入了白名单：
- `WhiteboardLeaferCanvas.tsx` — **3406 行**
- `WhiteboardDrawingTool.tsx` — **1032 行**

两者都远超 ≤800 硬上限。本计划按 Rule 9 拆分，目标两文件都 < 800，清出白名单。

## 现状结构（勘查结论）
两文件同构：**大组件 + 一长串纯函数尾巴**。
- **DrawingTool**：组件 246-894（~648 行）+ 尾巴纯函数 896-1032（~136 行）+ 顶部两个展示型子组件 `AspectRatioPopover`(102-189)/`ToolIconButton`(195-210) + `TOOL_ITEMS`。
- **LeaferCanvas**：类型/常量 17-126 + `LeaferCanvas` forwardRef 组件 128-2231（~2100 行，含一个 ~320 行 leafer 初始化 effect + 指针绘制/框选/多选拖拽/右键菜单/快捷键 handler）+ 尾巴纯函数 2231-3406（~1175 行，全 pure）。
- 组件靠 50+ 个 `useRef` 大袋子耦合（refs 在 effect/handler 间共享）。

## 不动项
- 不改任何运行时行为 / 公开 API（`LeaferCanvasHandle`、`WhiteboardDrawingToolHandle`、props 签名保持逐字不变）。
- 不动 `lib/canvas.ts`、`lib/pointer.ts`、`lib/stroke.ts` 的既有导出（只新增同级模块）。
- 纯搬运 + 改 import，**零逻辑改动**；任何顺手优化都不在本计划。

## 阶段（每阶段独立过五门 `pnpm run gates`，绿了再下一阶段）

### Phase A — DrawingTool.tsx（易，先做）
1. 尾巴纯函数（`groupTargetsIntoLayer`/`deleteTargetFromState`/`getAssetPanelItems`/`stripFileExtension`/`isWhiteboardAssetDrag`/`parseLibraryDragPayload`/`clampCanvasPosition`）→ 新 `whiteboardStateOps.ts`。
2. 展示型子组件 `AspectRatioPopover` + `ToolIconButton` + `TOOL_ITEMS` + `AspectRatioPopoverProps`/`ToolIconButtonProps` → 新 `WhiteboardToolbarControls.tsx`。
- 预期壳：~790 < 800 → 出白名单。

### Phase B — LeaferCanvas 纯函数尾巴（中，搬运）
按职责切进新模块（全 pure，零闭包）：
- `leafer/leaferTypes.ts` — `Leafer*` 类型别名 + `CanvasObject*`/`CanvasPoint`/`SnapGuide` 等域类型 + 常量（`SNAP_DISTANCE` 等）。
- `lib/canvasBounds.ts` — offset/render-bounds/normalize/union/intersect/svg-rect 几何。
- `lib/canvasSnap.ts` — `getSnapGuides`/`getNearestSnapDelta`/`getSnappedCanvasMove`/水平垂直线。
- `lib/canvasHitTest.ts` — `getSelectableCanvasObjectsInBounds`/`getTopmostEditableCanvasObjectAtPoint`/resize handle 命中。
- `lib/leaferNode.ts` — `getCanvasNode*` 访问器 + 交互状态读写。
- `lib/canvasStrokeGeometry.ts` — 橡皮/点在笔画内/线段距离/`getSvgPathBounds`/path 平移（`translatePath*`）。
- `lib/canvasExport.ts` — 视口导出/截图/`hide|restoreEditorOverlays`/文件名。
- 预期壳：~2231（仍超，进 Phase C）。基线先 ratchet 到实际值锁战果。

### Phase C — LeaferCanvas 组件本体 hook 化（难，核心）

**C1（已做，低风险，已并 main）：** 渲染树构建 `useLayoutEffect`（~305 行）→ `whiteboardSceneRender.ts`
的 `renderWhiteboardScene(params)`，壳留薄 effect（guard + 一次调用 + deps 不变）。显式 params（context +
assets/strokes/layers/dimensions + 三个 ref-map 值 + 四个 node-map ref 对象），行为逐字不变，typecheck 绿、
lint 零新增。壳 2220→1921。

**C2（已做，已并 main）：** 交互层按「自定义 hook 收一个 refs 对象（顶部解构 → 函数体逐字不动）」抽出四个 hook：
`useWhiteboardDrawing`（绘制/光标/草稿）、`useWhiteboardBoxSelection`（框选/多选拖拽/stage 指针捕获）、
`useWhiteboardSelectionActions`（选择/翻转/编组/右键菜单/键盘）、`useWhiteboardSceneSync`（editor 选择同步 + 工具切换
同步 + 交互禁用同步 + editor 事件）。壳保留 refs/state/imperativeHandle/init effect/paintSnapGuides/渲染薄 effect/JSX +
四个 hook 装配。每抽一个跑 typecheck + lint（exhaustive-deps 同款 file-level disable）+ 清孤儿 import。
**壳 1921→740 < 800，LeaferCanvas 出白名单，两巨壳债清零。** 五门全绿（filesize/tokens/lint/typecheck/test 1892✓）+ R13 走查。

下方为 C2 落地前的盘点记录（保留作背景）：交互层**不是**可独立搬运的纯逻辑，而是相互依赖的 React hook 链：
- 选择动作链：`getEditableSelectedTarget → moveSelectedTarget / deleteSelectedTarget / flipSelectedTarget /
  groupSelectedTargets → handleGroupMenu*`，全是 `useCallback`，彼此 deps 串联。
- 键盘 / 右键菜单 / editor 事件 / 框选 / 多选拖拽 / 绘制：`useEffect` + `useCallback`，闭包 50+ 个共享 ref + 多个
  state setter（setContextMenu/setSelectionBox/setRenderReadyVersion/updateSelectedObjectTargets）。

这些**无法**像 C1 那样抽成纯函数；唯一干净做法是抽成自定义 hook（`useWhiteboardSelectionActions` /
`usePointerDrawing` / `useBoxSelection`），每个收一个较大的共享 ctx（refs + props + setters）。机制可行但：
① 改的是白板最易碎的指针/选择/键盘行为；② 必须配 R13 真机走查（画笔/橡皮/框选/多选拖拽/右键翻转编组/截图）才能
证明零回归；③ 当前主干被并行会话（audio-first-class-timeline）改红（test/filesize），不宜在红仓上叠大重构。

故 C2 留作**专项后续**：单独 session、干净仓、做完配 R13。基线已 ratchet 到 1921 锁住战果，不强行硬切坏行为（守 P3）。

## 验收门
- 每阶段：`pnpm run gates`（filesize→tokens→lint→typecheck→test→build）全绿。
- 收尾：R13 真机走查白板节点（打开白板 → 画笔/橡皮 → 框选/多选拖拽 → 右键翻转/编组 → 截图导出），人眼确认行为零回归。
- `check-file-sizes.mjs` 白名单移除两条目（或下调基线到实际值）。

## 回滚
纯搬运，逐 commit 可单独 revert；行为零改动，回滚无数据/状态风险。
