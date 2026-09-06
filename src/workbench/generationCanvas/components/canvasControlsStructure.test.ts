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
    expect(dragHandler).toContain('dragDraft')
    expect(dragHandler).not.toContain('moveNode(')
  })

  it('lets React Flow exclusively own mounted node placement and interaction controls', () => {
    const baseNode = source('../nodes/BaseGenerationNode.tsx')
    const dragResize = source('../nodes/useNodeDragResize.ts')
    const flowStyles = source('../reactFlow/generationCanvasReactFlow.css')

    expect(dragResize).toContain('return { flowManagedDrag, handlePointerDown')
    expect(baseNode).toContain("flowManagedLayout ? 'relative' : 'absolute'")
    expect(baseNode).toContain('transform: flowManagedLayout ? undefined : `translate(')
    expect(baseNode).toContain("!flowManagedLayout && !readOnly && node.kind !== 'panorama'")
    expect(baseNode).toContain('selected && !readOnly && !flowManagedLayout')
    expect(flowStyles).toContain(
      '.generation-canvas-react-flow__node-shell .generation-canvas-v2-node__magnetic-handle',
    )
    expect(flowStyles).not.toMatch(
      /\.generation-canvas-react-flow \.generation-canvas-v2-node__magnetic-handle[,{]/,
    )
  })

  it('routes every duplicated variant through the shared focus recovery contract', () => {
    const runner = source('../runner/generationRunController.ts')
    const toolbar = source('../nodes/NodeFloatingToolbar.tsx')
    const focusEffects = source('../reactFlow/useGenerationCanvasReactFlowEffects.ts')

    expect(runner).toMatch(
      /duplicateNodeForRegeneration\(nodeId\)[\s\S]{0,320}FOCUS_GENERATION_NODE_EVENT[\s\S]{0,120}nodeId: dup\.id/,
    )
    expect(toolbar).toMatch(
      /const duplicate = duplicateAsVariant\(nodeId\)[\s\S]{0,260}FOCUS_GENERATION_NODE_EVENT[\s\S]{0,120}nodeId: duplicate\.id/,
    )
    expect(focusEffects).toContain('window.addEventListener(FOCUS_GENERATION_NODE_EVENT, handleFocusNode)')
    expect(focusEffects).toContain('resolvePendingCanvasFocus(')
  })

  it('keeps viewport panning independent from connection cancellation', () => {
    const viewportGestures = source('./useCanvasViewportGestures.ts')

    expect(viewportGestures).not.toContain('cancelConnection')
    expect(viewportGestures).not.toContain('pendingConnectionSourceId')
  })

  it('only completes drag-to-connect from a primary pointer-up', () => {
    const dragToConnect = source('./useDragToConnect.ts')
    const viewportGestures = source('./useCanvasViewportGestures.ts')

    expect(dragToConnect).toContain('shouldFinishCanvasConnection(event.button, event.defaultPrevented)')
    expect(viewportGestures).toContain('resolveCanvasPanButtonFromMove')
    expect(viewportGestures).toContain('isCanvasPanButtonHeld')
    // 空格中途松手只收尾「空格发起的」那次平移——裸左键平移不能被它打断（08-08 语义）。
    expect(viewportGestures).toContain('panStartRef.current?.spaceInitiated')
    expect(viewportGestures).toMatch(
      /const handlePointerUp[\s\S]*?if \(!isPanningRef\.current\) return[\s\S]*?if \(event\.button === 0\) event\.preventDefault\(\)/,
    )
  })

  it('cleans both pan and marquee state on pointer cancellation', () => {
    const pointerInteractions = source('./useCanvasPointerInteractions.ts')
    const generationCanvas = source('../reactFlow/GenerationCanvasReactFlowViewport.tsx')

    expect(pointerInteractions).toContain('onPointerCancel')
    expect(generationCanvas).toContain('onMoveStart={() => {')
    expect(generationCanvas).toContain('setCanvasDragging(hostRef.current, true, CANVAS_DRAGGING_OWNER.reactFlowViewport)')
    expect(generationCanvas).toContain('setCanvasDragging(hostRef.current, false, CANVAS_DRAGGING_OWNER.reactFlowViewport)')
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

  it('keeps settings copy aligned with drag-pans-first gestures', () => {
    const settings = source('../../../i18n/locales/settings.ts')

    // 08-07 的 selection-first 文案已被 08-08 用户拍板推翻，不许回潮。
    expect(settings).not.toContain('空白处左键拖动直接框选')
    expect(settings).not.toContain('left-drag empty space directly box-selects')
    expect(settings).toContain('生成画布和 ComfyUI 工作流设置共用此滚轮/双指手势')
    expect(settings).toContain('The generation canvas and ComfyUI workflow settings share this wheel/two-finger gesture')
    expect(settings).toContain('在生成画布中，空白处左键拖动为平移，Shift+左键拖动为框选')
    expect(settings).toContain('On the generation canvas, left-drag empty space to pan, Shift+left-drag to add a box selection')
  })

  it('keeps Space available to focused controls and gives disabled tooltip triggers a name', () => {
    const viewportGestures = source('./useCanvasViewportGestures.ts')
    const tooltipButton = source('./CanvasNavigationTooltipButton.tsx')

    expect(viewportGestures).toContain('input, textarea, select, button, a[href]')
    expect(viewportGestures).toContain('isInteractiveTarget(event.target) && activePointerButtonsRef.current === 0')
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

  it('cancels marquee when an explicit pan chord takes ownership after primary down', () => {
    const pointerInteractions = source('./useCanvasPointerInteractions.ts')

    expect(pointerInteractions).toContain('const panOwnsPointer = gestures.handlePointerMove(event)')
    expect(pointerInteractions).toContain('marquee.cancel()')
  })

  it('keeps one arbiter for blank-canvas pointers', () => {
    const pointerInteractions = source('./useCanvasPointerInteractions.ts')
    const marquee = source('./useMarqueeSelection.ts')

    expect(pointerInteractions).toContain('resolveCanvasPointerDownAction')
    expect(pointerInteractions).toContain('gestures.handleEmptyPanPointerDown(event)')
    expect(pointerInteractions).toContain('marquee.handlePointerDown(event)')
    // 「什么算画布空白」只在模型层定义一次；框选 hook 不再自带第二份守卫清单。
    expect(marquee).not.toContain('EMPTY_TARGET_GUARD')
  })

  it('keeps panning incremental so a mid-pan zoom cannot fight it', () => {
    const viewportGestures = source('./useCanvasViewportGestures.ts')

    // 绝对式基准（按下时的 offset + 指针总位移）会被任何外部改写 offset 的动作作废——
    // 平移中滚轮缩放时每帧互相抹回去 = 抖动（2026-08-08 用户报）。
    expect(viewportGestures).toContain('scheduleOffset({ x: offsetRef.current.x + deltaX, y: offsetRef.current.y + deltaY })')
    expect(viewportGestures).not.toContain('start.offsetX')
    expect(viewportGestures).not.toContain('start.offsetY')
  })

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
    expect(flowStyles).toContain('color-mix(in oklch, var(--nomi-ink) 32%, transparent)')
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
    const parameterBar = source('../nodes/InlineParameterBar.tsx')
    const composer = source('../nodes/NodeGenerationComposer.tsx')

    expect(segmented).toContain("density?: 'compact' | 'default'")
    expect(segmented).toContain("density === 'compact' ? 28 : 32")
    expect(modeBar).toContain('min-h-7 rounded-nomi-sm px-3 py-1 text-caption')
    expect(parameterBar).toContain('style={{ height: 28 }}')
    expect(parameterBar).toContain('density="compact"')
    expect(composer).toContain('min-h-7 rounded-nomi-sm px-2.5 py-1 text-caption')
    expect(composer).not.toContain('NomiSegmented')
    expect(composer).not.toContain('h-[22px]')
  })

  it('hides every node overlay from one canvas-level dragging flag', () => {
    const dragResize = source('../nodes/useNodeDragResize.ts')
    const selectionDrag = source('./useCanvasSelectionDrag.ts')
    const viewportGestures = source('./useCanvasViewportGestures.ts')
    const generationCanvas = source('../reactFlow/GenerationCanvasReactFlow.tsx')
    const composer = source('../nodes/NodeGenerationComposer.tsx')
    const floatingToolbar = source('../nodes/NodeFloatingToolbar.tsx')
    const resultStack = source('../nodes/NodeResultStack.tsx')

    // 四条拖动路径（单节点 / 选区框 / 组框 / 画布平移）升同一个画布级标志，浮层各自声明隐身——
    // 不再是「只有被拖的那张卡收起来」（2026-08-09 用户：拖 B 的时候 A 的面板也不该杵着；平移同理）。
    expect(dragResize).toContain('setCanvasDragging(event.currentTarget, true, CANVAS_DRAGGING_OWNER.node)')
    expect(selectionDrag).toContain('setCanvasDragging(null, true, CANVAS_DRAGGING_OWNER.group)')
    expect(viewportGestures).toContain('setCanvasDragging(stageRef.current, true, CANVAS_DRAGGING_OWNER.viewport)')
    expect(generationCanvas).toContain('setCanvasDragging(hostRef.current, true, CANVAS_DRAGGING_OWNER.reactFlowNode)')
    for (const overlay of [composer, floatingToolbar, resultStack]) {
      expect(overlay).toContain('group-data-[dragging=true]/canvas:invisible')
    }
    // 平移那条必须在**跨过阈值之后**才升：按下就升 = 点一下空白也白写两次属性（08-08 的坑）。
    expect(viewportGestures).toMatch(/start\.moved = true[\s\S]{0,260}setCanvasDragging\(stageRef\.current, true, CANVAS_DRAGGING_OWNER\.viewport\)/)
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

  it('keeps help actions and keycaps legible in the two-column panel', () => {
    const helpPopover = source('./CanvasControlsHelpPopover.tsx')

    // 布局断言随 2026-08-08 溢出修复更新：w-96 → w-[30rem]（长 kbd 如「Delete / Backspace」
    // 在 174px 列宽下必溢出右缘）、right-0 → left-1/2 -translate-x-1/2（居中防左右遮挡）。
    expect(helpPopover).toContain("'absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-[12] w-[30rem] p-3'")
    expect(helpPopover).toContain('text-caption whitespace-nowrap text-nomi-ink-60')
    expect(helpPopover).toContain('text-caption font-medium leading-none whitespace-nowrap text-nomi-ink')
  })

  it('keeps the C-02 deconstruction node anchors canonical', () => {
    const badge = source('../nodes/NodeDeconstructionBadge.tsx')

    expect(badge).toContain('data-decon-node-stub={nodeId}')
    expect(badge).toContain('data-decon-node-badge={nodeId}')
    expect(badge).not.toContain('data-deconstruct-stub')
    expect(badge).not.toContain('data-deconstruct-result-badge')
  })
})
