import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

describe('generation canvas control structure', () => {
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
    const generationCanvas = source('./GenerationCanvas.tsx')

    expect(pointerInteractions).toContain('onPointerCancel')
    expect(generationCanvas).toContain('onPointerCancel={pointer.onPointerCancel}')
  })

  it('replaces the persistent hint with one contextual help entry', () => {
    const generationCanvas = source('./GenerationCanvas.tsx')
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
    expect(settings).toContain('空白处左键拖动都是平移画布，Shift+左键拖是框选')
    expect(settings).toContain('left-drag empty space pans the canvas, Shift+left-drag box-selects')
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
    const generationCanvas = source('./GenerationCanvas.tsx')
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
    expect(generationCanvas).toContain(
      'finishContextMenuPointerUp(event, event.button === 2 && pointer.shouldSuppressContextMenu())',
    )
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
    const generationCanvas = source('./GenerationCanvas.tsx')

    expect(generationCanvas).toContain('will-change-transform')
    expect(generationCanvas).toContain('useCanvasTransformStoreSync(zoom, offset)')
    expect(generationCanvas).not.toContain('setCanvasTransform(zoom, offset)')
  })

  it('gates edge labels on selection instead of density plus hover', () => {
    const edgeLayer = source('./CanvasEdgeLayer.tsx')

    expect(edgeLayer).toContain('selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target)')
    expect(edgeLayer).not.toContain('EDGE_TAG_DENSE_THRESHOLD')
    expect(edgeLayer).not.toContain('hoveredEdgeId')
  })

  it('hides every node overlay from one canvas-level dragging flag', () => {
    const dragResize = source('../nodes/useNodeDragResize.ts')
    const selectionDrag = source('./useCanvasSelectionDrag.ts')
    const viewportGestures = source('./useCanvasViewportGestures.ts')
    const generationCanvas = source('./GenerationCanvas.tsx')
    const composer = source('../nodes/NodeGenerationComposer.tsx')
    const floatingToolbar = source('../nodes/NodeFloatingToolbar.tsx')
    const imageStack = source('../nodes/ImageResultStack.tsx')

    // 四条拖动路径（单节点 / 选区框 / 组框 / 画布平移）升同一个画布级标志，浮层各自声明隐身——
    // 不再是「只有被拖的那张卡收起来」（2026-08-09 用户：拖 B 的时候 A 的面板也不该杵着；平移同理）。
    expect(dragResize).toContain('setCanvasDragging(event.currentTarget, true)')
    expect(selectionDrag).toContain('setCanvasDragging(null, true)')
    expect(viewportGestures).toContain('setCanvasDragging(stageRef.current, true)')
    expect(generationCanvas).toContain("'group/canvas'")
    for (const overlay of [composer, floatingToolbar, imageStack]) {
      expect(overlay).toContain('group-data-[dragging=true]/canvas:invisible')
    }
    // 平移那条必须在**跨过阈值之后**才升：按下就升 = 点一下空白也白写两次属性（08-08 的坑）。
    expect(viewportGestures).toMatch(/start\.moved = true[\s\S]{0,220}setCanvasDragging\(stageRef\.current, true\)/)
    // 旧的按节点作用域已删干净（P1：不留并行版）
    expect(composer).not.toContain('/node:invisible')
    expect(dragResize).not.toContain('setDragging(')
  })

  it('routes every icon-only navigation action through a styled tooltip component', () => {
    const navigationStack = source('./CanvasNavigationStack.tsx')
    const tooltipButtons = navigationStack.match(/<CanvasNavigationTooltipButton/g) ?? []

    expect(tooltipButtons).toHaveLength(4)
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
})
