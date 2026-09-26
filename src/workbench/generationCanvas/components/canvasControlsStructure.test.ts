import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function readSource(path: string | URL): string {
  return readFileSync(path instanceof URL ? fileURLToPath(path) : path, 'utf8')
}

function source(relativePath: string): string {
  return readSource(new URL(relativePath, import.meta.url))
}

function productionSources(directory: string): Array<[path: string, contents: string]> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionSources(path)
    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || entry.name.includes('.test.')) return []
    return [[path, readSource(path)]]
  })
}

describe('generation canvas control structure', () => {
  it('keeps React Flow as the only production generation-canvas renderer', () => {
    const entry = source('./GenerationCanvas.tsx')
    const renderer = source('../reactFlow/GenerationCanvasReactFlowViewport.tsx')
    const generationCanvasRoot = fileURLToPath(new URL('../', import.meta.url))
    const forbiddenLegacySymbols = [
      'CanvasEdgeLayer',
      'generationCanvasEngineFlag',
      'isReactFlowCanvasEnabled',
      'LegacyGenerationCanvas',
    ]

    expect(entry.match(/\.\.\/reactFlow\/GenerationCanvasReactFlow/g)).toHaveLength(1)
    expect(renderer).toContain("from '@xyflow/react'")
    expect(renderer).toContain('<ReactFlow')
    for (const [path, contents] of productionSources(generationCanvasRoot)) {
      for (const symbol of forbiddenLegacySymbols) {
        expect(contents, `${relative(generationCanvasRoot, path)} must not restore ${symbol}`).not.toContain(symbol)
      }
    }
  })

  it('synchronizes business projections into the uncontrolled React Flow kernel', () => {
    const renderer = source('../reactFlow/GenerationCanvasReactFlowViewport.tsx')
    const sync = source('../reactFlow/canvasNodeProjectionSync.ts')

    expect(renderer).toContain('defaultNodes={flowNodes}')
    expect(renderer).toContain('<CanvasNodeProjectionSync')
    expect(sync).toContain('flow.setNodes((current) =>')
    expect(sync).toContain('isDragging')
  })

  it('keeps node drag ticks in React Flow draft geometry until drag stop', () => {
    const generationCanvas = source('../reactFlow/GenerationCanvasReactFlow.tsx')
    const dragDraft = source('../reactFlow/canvasDragDraft.ts')
    const dragHandler = generationCanvas.match(/const handleNodesChange:[\s\S]*?\n\x20\x20}, \[[^\n]+\]\)/)?.[0] || ''

    expect(dragDraft).toContain('applyNodeChanges')
    const activeDrag = dragHandler.split('if (positionChanges.length && draggingRef.current) {')[1]?.split('} else if')[0] ?? ''
    expect(activeDrag).toContain('dragDraft')
    expect(activeDrag).toContain('applyCanvasDragKernelPositionChanges')
    expect(activeDrag).not.toContain('moveNode(')
    expect(activeDrag).not.toContain('commitPersistedChange(')
  })

  it('lets React Flow exclusively own mounted node placement and interaction controls', () => {
    const baseNode = source('../nodes/BaseGenerationNode.tsx')
    const dragResize = source('../nodes/useNodeDragResize.ts')
    const flowStyles = source('../reactFlow/generationCanvasReactFlow.css')

    expect(dragResize).toContain('return { flowManagedDrag, handlePointerDown')
    expect(baseNode).toContain("flowManagedLayout ? 'relative' : 'absolute'")
    expect(baseNode).toContain('transform: flowManagedLayout ? undefined : `translate(')
    expect(baseNode).toContain('selected && !readOnly && !flowManagedLayout')
    // 连线把手只有一份：React Flow 节点壳里的 GenerationFlowConnectionHandle（2026-09-21 删掉了
    // 节点卡内那几份靠 CSS display:none 挡住的旧磁吸把手——P1，不留两套）。
    for (const file of ['../nodes/BaseGenerationNode.tsx', '../nodes/ClipNode.tsx', '../nodes/director/DirectorNode.tsx']) {
      expect(source(file)).not.toContain('MagneticConnectionHandle')
      expect(source(file)).not.toContain('generation-canvas-v2-node__handle')
    }
    expect(flowStyles).not.toContain('.generation-canvas-v2-node__magnetic-handle')
    expect(flowStyles).not.toContain('.generation-canvas-v2-node__handle,')
  })

  // 2026-09-25 反转：复制变体 / 重新生成副本不再自动聚焦过去（程序不主动移动画布）；聚焦只剩用户自己点的定位。
  // 允许谁移动视口的完整名单在 canvasViewportMovers.structure.test.ts。
  it('duplicating a variant does not jump the viewport; explicit locate still resolves through the focus effect', () => {
    const runner = source('../runner/generationRunController.ts')
    const toolbar = source('../nodes/NodeFloatingToolbar.tsx')
    const focusEffects = source('../reactFlow/useGenerationCanvasReactFlowEffects.ts')
    expect(runner).not.toContain('FOCUS_GENERATION_NODE_EVENT')
    expect(toolbar).not.toContain('FOCUS_GENERATION_NODE_EVENT')
    expect(focusEffects).toContain('window.addEventListener(FOCUS_GENERATION_NODE_EVENT, handleFocusNode)')
    expect(focusEffects).toContain('resolvePendingCanvasFocus(')
  })

  it('keeps viewport panning independent from connection cancellation', () => {
    // owner 从已删的 useCanvasViewportGestures 搬到 React Flow 的辅助平移 hook（2026-09-11 回填①）。
    // 不变量没变：平移这条路不许顺手把「正在连的那根线」取消掉。
    const pointer = source('../reactFlow/useGenerationCanvasReactFlowPointer.ts')

    expect(pointer).not.toContain('cancelConnection')
    expect(pointer).not.toContain('pendingConnectionSourceId')
  })

  it('keeps the auxiliary pan chord from swallowing the primary pointer', () => {
    // 旧判据（useDragToConnect 的 shouldFinishCanvasConnection + 旧手势内核的和弦真值表）
    // 随死岛一起删（2026-09-11 回填①）：连线完成今天归 React Flow 的 onConnectEnd + 落点模型，
    // 裸左键平移归内核的 panOnDrag。这里守住剩下那半条——辅助平移只认中键/右键/空格+左键，
    // 裸左键必须原样交还内核，否则节点拖拽和按钮点击会被一起吞掉。
    const pointer = source('../reactFlow/useGenerationCanvasReactFlowPointer.ts')

    expect(pointer).toContain(
      "const isAuxiliaryPan = event.button === 1 || event.button === 2 || (event.button === 0 && spaceHeldRef.current)",
    )
    expect(pointer).toContain('if (!isAuxiliaryPan || !event.isPrimary) return')
    const primary = pointer.slice(pointer.indexOf('if (isBlankPrimaryPan) {'), pointer.indexOf('const isAuxiliaryPan ='))
    expect(primary).toContain('active: false')
    expect(primary).toContain('takeoverAfterWheel: false')
    expect(primary).toMatch(/return\s*\}/)
    expect(primary).not.toContain('preventDefault(')
    expect(primary).not.toContain('stopPropagation(')
  })

  it('cleans both pan and marquee state on pointer cancellation', () => {
    const host = source('../reactFlow/GenerationCanvasReactFlow.tsx')
    const generationCanvas = source('../reactFlow/GenerationCanvasReactFlowViewport.tsx')

    // 框选状态归 React Flow 自己；我们只需保证辅助平移在 pointercancel 上有收尾入口。
    expect(host).toContain('onPointerCancel={handleCanvasPointerEnd}')
    expect(generationCanvas).toContain('onMoveStart={(event) => {')
    expect(generationCanvas).toContain('beginCanvasDragging(hostRef.current, CANVAS_DRAGGING_OWNER.reactFlowViewport, { onCancel:')
    expect(generationCanvas).toMatch(/onMoveEnd=\{[^]*?viewportLeaseRef\.current\?\.release\(\)/)
    // 2026-09-21：中断路径不许再整段 return。它原来跳过的是**整个** onMoveEnd —— 连 NaN 守卫
    // 和 rememberCategoryViewport 一起——于是「屏幕上的视口」和「记住的视口」分家，下一次视口
    // 同步 effect 一跑画布就跳回中断前的位置。现在中断照样记，只是记到手势开始时那个分类头上。
    expect(generationCanvas).not.toContain('if (viewportCancelledRef.current) return')
    expect(generationCanvas).toContain('viewportGestureCategoryRef.current = activeCategoryId')
    expect(generationCanvas).toMatch(/rememberCategoryViewport\(viewportGestureCategoryRef\.current \?\? activeCategoryId,/)
  })

  it('replaces the persistent hint with one contextual help entry', () => {
    const generationCanvas = source('../reactFlow/GenerationCanvasReactFlow.tsx')
    const navigationStack = source('./CanvasNavigationStack.tsx')
    const onboardingState = source('../../onboarding/onboardingState.ts')
    const canvasStyles = source('../styles/generationCanvas.css')

    expect(generationCanvas).not.toContain('CanvasGestureHint')
    expect(navigationStack).toContain('<CanvasControlsHelpPopover />')
    expect(onboardingState).not.toContain('CANVAS_GESTURE_HINT_KEY')
    expect(canvasStyles).not.toContain('generation-canvas-v2__gesture-hint')
  })

  it('keeps settings copy focused on the selected wheel gesture', () => {
    const settings = source('../../../i18n/locales/settings.ts')

    // 08-07 的 selection-first 文案已被 08-08 用户拍板推翻，不许回潮。
    expect(settings).not.toContain('空白处左键拖动直接框选')
    expect(settings).not.toContain('left-drag empty space directly box-selects')
    expect(settings).toContain('滚轮以光标为中心缩放。')
    expect(settings).toContain('Wheel zooms around the cursor.')
    expect(settings).toContain('滚轮/双指滑平移；捏合或 ⌘/Ctrl+滚轮缩放。')
    expect(settings).toContain('Wheel/two-finger swipe pans; pinch or ⌘/Ctrl+wheel zooms.')
  })

  it('gives disabled tooltip triggers a name', () => {
    // 原本同一条 it 还断「空格对焦点控件仍可用」，判据在已删的 useCanvasViewportGestures 上。
    // 那条行为的 owner 今天是 reactFlow/useGenerationCanvasReactFlowPointer 的 keydown，
    // 它**还没有**这层守卫——记在 docs/plan/2026-09-11-canvas-migration-audit.md，另轨处理，
    // 不在这里留一条指向死文件的假绿。
    const tooltipButton = source('./CanvasNavigationTooltipButton.tsx')

    expect(tooltipButton).toContain('aria-disabled={disabled || undefined}')
    expect(tooltipButton).not.toContain('tabIndex={disabled ? 0 : undefined}')
  })

  it('defers the blank-canvas menu without swallowing native menus inside controls', () => {
    const generationCanvas = source('../reactFlow/GenerationCanvasReactFlow.tsx')
    // 菜单层（右键菜单 + 连线创建菜单的开合与 stage 指针链）住在 useGenerationCanvasReactFlowMenus，
    // 画布壳只保留把它接到 stage/React Flow 上的那几个 prop。
    const canvasMenus = source('../reactFlow/useGenerationCanvasReactFlowMenus.ts')
    const contextMenu = source('./useCanvasContextNodeMenu.ts')

    expect(contextMenu).toContain('isCanvasContextMenuPointer(event.button, event.ctrlKey, navigator.platform)')
    expect(contextMenu).toContain('if (!contextMenuPointer || pendingConnectionSourceId) return false')
    expect(contextMenu).toContain('return event.button === 0')
    expect(contextMenu).toContain('if (!suppressMenu && pendingMenuRef.current)')
    expect(contextMenu).toContain(
      'if (!pending && !suppressNextContextMenuRef.current && !active?.suppressContextMenu) return',
    )
    expect(contextMenu).toContain('pending.contextMenuSeen = true')
    expect(contextMenu).toContain(
      'if (activeContextPointerRef.current) activeContextPointerRef.current.contextMenuSeen = true',
    )
    expect(contextMenu).toContain('suppressMenu && !activeContextPointerRef.current?.contextMenuSeen')
    expect(contextMenu).toContain('const secondaryChord = (event.buttons & 3) === 3')
    expect(contextMenu).toContain('active.suppressContextMenu = true')
    expect(contextMenu).toContain('!active?.suppressContextMenu')
    expect(contextMenu).toContain('event.preventDefault()')
    expect(canvasMenus).toContain('useCanvasContextNodeMenu({')
    expect(canvasMenus).toContain('if (prepareContextMenuPointerDown(event))')
    expect(canvasMenus).toContain('finishContextMenuPointerUp(event, suppressContextMenu)')
    expect(canvasMenus).toContain("if (event.key === 'Escape') closeMenus()")
    expect(generationCanvas).toContain('useGenerationCanvasReactFlowMenus({')
    expect(generationCanvas).toContain('onContextMenu={handleStageContextMenu}')
    expect(generationCanvas).toContain('onPaneContextMenu={handleFlowContextMenu}')
  })

  it('routes the right-click landing through one three-way arbiter so a marquee selection survives it', () => {
    // 2026-09-06 真机 bug：框选后 React Flow 铺的 nodesselection-rect 盖住节点，右键取不到
    // data-node-id → 被「不是节点 = 空白」吞掉 → 清选择 + 弹添加菜单，「建组」当场不可达。
    // 判据必须只有一份（模型层），且清选择只准发生在真空白这一支。
    const contextMenu = source('./useCanvasContextNodeMenu.ts')
    const overlays = source('../reactFlow/GenerationCanvasReactFlowOverlays.tsx')

    expect(contextMenu).toContain('resolveCanvasContextMenuTarget({')
    expect(contextMenu).toContain('selectionOverlay: isCanvasSelectionOverlayTarget(target)')
    expect(contextMenu).toContain('target: menuTarget')
    expect(contextMenu).toContain("else if (pending.menu.target === 'blank') clearSelection()")
    // 落点判定不许在 hook 里再长第二份清单（模型层是唯一 owner）。
    // 先剥注释再扫：不变量管的是代码行为，不该被记录这个 bug 的注释反噬。
    const contextMenuCode = contextMenu.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(contextMenuCode).not.toContain('nodesselection')
    // 菜单选型跟着落点走，不再拿 nodeId 当「是不是节点菜单」的替身。
    expect(overlays).toContain("contextNodeMenu && contextNodeMenu.target !== 'blank'")
    expect(overlays).not.toContain('contextNodeMenu?.nodeId ?')
  })

  it('keeps one arbiter for blank-canvas pointers', () => {
    // 「平移 / 框选 / 画框 该归谁」的仲裁今天分两层：平移与框选归 React Flow 内核
    // （panOnDrag / selectionKeyCode），画框归框工具——而两者共用**同一张**真值表
    // （canvasPointerGestureModel.resolveCanvasPointerDownAction）。原本断在
    // useCanvasPointerInteractions 上的两条随死岛一起删（2026-09-11 回填①）；
    // 真正要守的是「真值表只有一份、框工具不另长一张」。
    const model = source('./canvasPointerGestureModel.ts')
    const frameTool = source('./useCanvasFrameTool.ts')

    expect(model).toContain('export function resolveCanvasPointerDownAction')
    expect(frameTool).toContain('resolveCanvasPointerDownAction({')
    expect(frameTool).toContain('interactiveTarget: isCanvasInteractiveTarget(event.target)')
    expect(frameTool).not.toContain('EMPTY_TARGET_GUARD')
  })

  // 「平移必须增量、不能用按下那一刻的绝对基准」（2026-08-08 用户报的抖动）今天由下面
  // 「keeps post-zoom panning incremental …」那条守（nativePanReconciler.queueDelta）。
  // 原本还有一条断在 useCanvasViewportGestures 上，随死岛一起删，不留两份同义判据。

  it('keeps panning off the React store hot path', () => {
    const generationCanvas = source('../reactFlow/GenerationCanvasReactFlowViewport.tsx')

    const flowStyles = source('../reactFlow/generationCanvasReactFlow.css')
    expect(flowStyles).toContain('will-change')
    expect(generationCanvas).toContain('onMoveEnd')
    expect(generationCanvas).toContain('rememberCategoryViewport')
    expect(generationCanvas).not.toContain('setCanvasTransform(zoom, offset)')
  })

  it('keeps post-zoom panning incremental and maps React Flow states to Nomi visuals', () => {
    const pointer = source('../reactFlow/useGenerationCanvasReactFlowPointer.ts')
    const takeover = source('../reactFlow/panZoomTakeoverReconciler.ts')
    const viewport = source('../reactFlow/GenerationCanvasReactFlowViewport.tsx')
    const flowStyles = source('../reactFlow/generationCanvasReactFlow.css')
    const groupFrame = source('./GroupFrame.tsx')
    const groupFrameHeader = source('./GroupFrameHeader.tsx')
    const groupContract = source('./groupVisualContract.ts')
    const collapsedGroup = source('./CollapsedGroupCard.tsx')
    const stackPeeks = source('./CardStackPeeks.tsx')
    const marqueeRule = flowStyles.match(/\.generation-canvas-react-flow \.react-flow__selection\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(pointer).toContain('takeoverAfterWheel')
    expect(pointer).toContain('nativePanReconciler.queueDelta({ x: deltaX, y: deltaY })')
    expect(pointer).toContain('nativePanReconciler.flush() ?? flow.getViewport()')
    expect(takeover).toContain('const current = pendingViewport ?? readViewport()')
    expect(takeover).toContain('frameId = requestFrame')
    expect(viewport).toContain('resolveSelectionToolbarPlacement')
    expect(viewport).not.toMatch(/<ViewportPortal>[\s\S]{0,160}<CanvasSelectionToolbar/)
    expect(marqueeRule).toContain('var(--nomi-ink)')
    expect(marqueeRule).not.toContain('var(--nomi-accent)')
    expect(flowStyles).toContain('.react-flow__nodesselection-rect')
    expect(flowStyles).toContain('color-mix(in oklab, var(--nomi-ink) 32%, transparent)')
    expect(flowStyles).toContain('--xy-connectionline-stroke: var(--nomi-accent)')
    expect(groupFrame).toContain('GROUP_VISUAL_CLASS.frame')
    // 头部胶囊 2026-09-06 抽进 GroupFrameHeader（框工具第一档：它自己带两个字段的编辑态）。
    // 视觉合同跟着搬，不许在新文件里另配一套皮肤。
    expect(groupFrameHeader).toContain('GROUP_VISUAL_CLASS.label')
    expect(groupFrameHeader).toContain('GROUP_VISUAL_CLASS.marker')
    expect(groupFrame).not.toContain('groupColor')
    expect(groupFrame).not.toContain('box.group.color')
    expect(groupFrameHeader).not.toContain('group.color')
    // 框的常驻装饰仍然中性：accent 只允许出现在**拖动中的临时反馈**那一条分支上
    // （groupVisualContract 的注释就是这么写的）。多一处就是把强调色变成了组的身份色。
    expect(groupFrame.match(/workbench-accent/g) ?? []).toHaveLength(2)
    expect(groupFrame).toMatch(/preview\.change === 'join'[\s\S]{0,120}workbench-accent/)
    expect(collapsedGroup).toContain('GROUP_VISUAL_CLASS.collapsedCard')
    expect(collapsedGroup).not.toContain('card.color')
    expect(stackPeeks).toContain('GROUP_VISUAL_CLASS.stackRear')
    expect(stackPeeks).not.toContain('border-nomi-accent/50')
    expect(groupContract).toContain('Persistent group chrome is deliberately neutral')
    expect(groupContract).not.toContain('nomi-accent')
  })

  it('keeps React Flow edge labels explicit and accessible', () => {
    const edgeRenderer = source('../reactFlow/GenerationCanvasReactFlowNodes.tsx')

    expect(edgeRenderer).toContain('const showLabel = !readOnly && (menuOpen || (mode !== \'reference\' && (incident || selected)))')
    expect(edgeRenderer).toContain('{!readOnly ? (')
    expect(edgeRenderer).toContain("aria-label={t('generationCommon.canvas.edge.modeMenu')}")
    expect(edgeRenderer).toContain("aria-label={t('generationCommon.canvas.edge.changeMode'")
    expect(edgeRenderer).not.toContain('EDGE_TAG_DENSE_THRESHOLD')
    expect(edgeRenderer).not.toContain('hoveredEdgeId')
  })

  it('uses one compact geometry contract for canvas segmented controls and inputs', () => {
    const segmented = source('../../../design/NomiSegmented.tsx')
    const modeBar = source('../nodes/controls/ModeBar.tsx')
    // 参数控件的几何住在控件本体那层（R9 拆巨壳后），不在编排壳里。
    const parameterBody = source('../nodes/controls/ParameterControlBody.tsx')
    const composer = source('../nodes/NodeGenerationComposer.tsx')

    expect(segmented).toContain("density?: 'compact' | 'default'")
    expect(segmented).toContain("density === 'compact' ? 28 : 32")
    expect(modeBar).toContain('min-h-7 rounded-nomi-sm px-3 py-1 text-caption')
    expect(parameterBody).toContain('style={{ height: 28 }}')
    expect(parameterBody).toContain('density="compact"')
    expect(composer).toContain('min-h-7 rounded-nomi-sm px-2.5 py-1 text-caption')
    expect(composer).not.toContain('NomiSegmented')
    expect(composer).not.toContain('h-[22px]')
  })

  it('hides every node overlay from one canvas-level dragging flag', () => {
    const dragResize = source('../nodes/useNodeDragResize.ts')
    const selectionDrag = source('./useCanvasSelectionDrag.ts')
    const pointer = source('../reactFlow/useGenerationCanvasReactFlowPointer.ts')
    const generationCanvas = source('../reactFlow/GenerationCanvasReactFlow.tsx')
    const composer = source('../nodes/NodeGenerationComposer.tsx')
    const floatingToolbar = source('../nodes/NodeFloatingToolbar.tsx')
    const resultStack = source('../nodes/NodeResultStack.tsx')

    // 四条拖动路径（单节点 / 选区框 / 组框 / 画布平移）升同一个画布级标志，浮层各自声明隐身——
    // 不再是「只有被拖的那张卡收起来」（2026-08-09 用户：拖 B 的时候 A 的面板也不该杵着；平移同理）。
    expect(dragResize).toContain('beginCanvasDragging(event.currentTarget, CANVAS_DRAGGING_OWNER.node, { pointerId: event.pointerId, active: false')
    expect(selectionDrag).toContain('beginCanvasDragging(event.currentTarget, CANVAS_DRAGGING_OWNER.group, { pointerId: event.pointerId, active: false')
    expect(pointer).toContain('beginCanvasDragging(event.currentTarget, CANVAS_DRAGGING_OWNER.reactFlowPan, { pointerId: event.pointerId, active: false')
    expect(generationCanvas).toContain('beginCanvasDragging(hostRef.current, CANVAS_DRAGGING_OWNER.reactFlowNode, { onCancel:')
    for (const overlay of [composer, floatingToolbar, resultStack]) {
      expect(overlay).toContain('group-data-[dragging=true]/canvas:invisible')
    }
    // 平移那条必须在**跨过阈值之后**才升：按下就升 = 点一下空白也白写两次属性（08-08 的坑）。
    expect(pointer).toMatch(
      /auxiliaryPan\.moved = true\s+panLeaseRef\.current\?\.activate\(\)/,
    )
    // 旧的按节点作用域已删干净（P1：不留并行版）
    expect(composer).not.toContain('/node:invisible')
    expect(dragResize).not.toContain('setDragging(')
  })

  it('routes every icon-only navigation action through a styled tooltip component', () => {
    const navigationStack = source('./CanvasNavigationStack.tsx')
    const tooltipButtons = navigationStack.match(/<CanvasNavigationTooltipButton/g) ?? []

    // 5 = 适配 / 重置 / 画框 / 整理 / 小地图开关（2026-09-06 加入「画框」——它和缩放适配同族：
    // 都在回答「你怎么看、怎么摆这块画布」，而不是「往画布上加什么」）。
    expect(tooltipButtons).toHaveLength(5)
    expect(navigationStack).not.toContain('title=')
  })

  it('keeps the keyboard icon available through the runtime Tabler allowlist', () => {
    const tablerIcons = source('../../../vendor/tablerIcons.ts')

    expect(tablerIcons).toContain(
      "export { default as IconKeyboard } from '@tabler/icons-react/dist/esm/icons/IconKeyboard.mjs'",
    )
  })

  it('keeps the help panel above every canvas chrome layer and its rows overlap-free in any locale', () => {
    const helpPopover = source('./CanvasControlsHelpPopover.tsx')

    // 层级：走 design 层的 AnchoredPopover（Portal + overlayLayers.popover），不在导航竖列里原地 absolute——
    // 原地写法被困在竖列 z-8 的层叠上下文里，Agent 收起坞 / 批量生成条一出现就把它盖住半截（2026-09-21 实拍）。
    expect(helpPopover).toContain('<AnchoredPopover anchorRef={anchorRef}')
    expect(helpPopover).not.toMatch(/absolute bottom-\[calc\(100%/)
    expect(helpPopover).not.toMatch(/z-\[\d+\]/)
    // 行布局：说明列可以折行（minmax(0,1fr) + min-w-0），键位列不折行。两边都 nowrap 时英文长说明
    // 会压到键位上（2026-09-21 EN「Box select」行实拍；2026-08-08 那次只加宽了面板，治的是同一个症状）。
    expect(helpPopover).toContain('grid-cols-[minmax(0,1fr)_auto]')
    expect(helpPopover).toContain('min-w-0 text-caption text-nomi-ink-60')
    expect(helpPopover).not.toContain('text-caption whitespace-nowrap text-nomi-ink-60')
    expect(helpPopover).toContain('text-caption font-medium leading-none whitespace-nowrap text-nomi-ink')
  })

  it('keeps the shot table as the sole deconstruction result surface', () => {
    const table = source('../nodes/shotTable/ShotTableNode.tsx')
    const toolbar = source('../nodes/NodeVideoFrameToolbar.tsx')
    expect(table).toContain('data-testid="shot-table-node"')
    expect(table).toContain('data-kind="shot_table"')
    expect(toolbar).toContain('deconstructToShotTable')
    expect(toolbar).not.toContain('openVideoDeconstruction')
  })
})
