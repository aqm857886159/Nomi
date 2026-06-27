/* eslint-disable react-hooks/exhaustive-deps -- Migrated Leafer canvas keeps imperative renderer state in refs to avoid recreating the editor on every pointer update. */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from 'react'

import type { AspectRatioKey, CanvasAsset, CanvasDimensions, LayerItem, ToolKey } from './lib/canvas'
import { getCanvasPointFromClient } from './lib/pointer'
import type { PointerPoint } from './lib/stroke'
import type {
  CanvasAssetTransform,
  CanvasNodeInteractionState,
  CanvasObjectFlipState,
  CanvasObjectOffset,
  CanvasObjectTarget,
  CanvasPoint,
  CanvasStroke,
  LeaferApp,
  LeaferBox,
  LeaferGroup,
  LeaferRenderContext,
  MutableDraftEraserPath,
  SnapGuide,
} from './whiteboardCanvasTypes'
import {
  createViewportScreenshotFilename,
  exportViewportFileWithoutEditorOverlays,
  exportViewportWithoutEditorOverlays,
  fitLeaferCanvasToHost,
} from './whiteboardCanvasExport'
import {
  shouldBlockErasedSelection,
} from './whiteboardCanvasNodeOps'
import {
  areCanvasTargetArraysEqual,
  getCanvasTargetsUnionBounds,
  getMinimumAssetScale,
  getSnappedCanvasMove,
  getSvgRectAttributes,
  normalizeCanvasBounds,
  shouldBlockEditorTargetInteraction,
} from './whiteboardCanvasGeometry'
import { renderWhiteboardScene } from './whiteboardSceneRender'
import { useWhiteboardDrawing } from './useWhiteboardDrawing'
import { useWhiteboardBoxSelection } from './useWhiteboardBoxSelection'
import { useWhiteboardSelectionActions } from './useWhiteboardSelectionActions'
import { useWhiteboardSceneSync } from './useWhiteboardSceneSync'

export type { CanvasObjectTarget, CanvasStroke } from './whiteboardCanvasTypes'

type LeaferCanvasProps = {
  ratio: AspectRatioKey
  dimensions: CanvasDimensions
  fitMode?: 'bounded' | 'natural'
  activeTool: ToolKey
  activeLayerId: string
  layers: LayerItem[]
  assets: CanvasAsset[]
  color: string
  brushSize: number
  strokes: CanvasStroke[]
  activeObjectTarget?: CanvasObjectTarget | null
  removingBackgroundTargetId?: string | null
  removingBackgroundProgress?: number | null
  onStrokeCommit: (stroke: CanvasStroke) => void
  onLayerSelect?: (layerId: string) => void
  onObjectSelect?: (target: CanvasObjectTarget, layerId: string) => void
  onObjectsGroup?: (targets: CanvasObjectTarget[]) => void
  onObjectDelete?: (target: CanvasObjectTarget) => void
  onRemoveBackground?: (target: CanvasObjectTarget) => void
}

export type LeaferCanvasHandle = {
  captureViewport: (filename?: string) => Promise<void>
  captureViewportFile: (filename?: string) => Promise<File>
  clientPointToCanvasPoint: (clientX: number, clientY: number) => { x: number; y: number } | null
}

type CanvasContextMenuState = {
  x: number
  y: number
  targets: CanvasObjectTarget[]
}
type CanvasSelectionBox = {
  start: CanvasPoint
  current: CanvasPoint
}

export const LeaferCanvas = forwardRef<LeaferCanvasHandle, LeaferCanvasProps>(function LeaferCanvas({
  ratio,
  dimensions,
  fitMode = 'natural',
  activeTool,
  activeLayerId,
  layers,
  assets,
  color,
  brushSize,
  strokes,
  activeObjectTarget,
  removingBackgroundTargetId,
  removingBackgroundProgress,
  onStrokeCommit,
  onLayerSelect,
  onObjectSelect,
  onObjectsGroup,
  onObjectDelete,
  onRemoveBackground
}: LeaferCanvasProps, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const pointerLayerRef = useRef<HTMLDivElement | null>(null)
  const appRef = useRef<LeaferApp | null>(null)
  const renderContextRef = useRef<LeaferRenderContext | null>(null)
  const activePointerRef = useRef<number | null>(null)
  const pointsRef = useRef<PointerPoint[]>([])
  const strokesRef = useRef(strokes)
  const assetsRef = useRef(assets)
  const layersRef = useRef(layers)
  const dimensionsRef = useRef(dimensions)
  const activeToolRef = useRef(activeTool)
  const activeObjectTargetRef = useRef(activeObjectTarget)
  const onLayerSelectRef = useRef(onLayerSelect)
  const onObjectSelectRef = useRef(onObjectSelect)
  const onObjectsGroupRef = useRef(onObjectsGroup)
  const onObjectDeleteRef = useRef(onObjectDelete)
  const objectOffsetsRef = useRef<Map<string, CanvasObjectOffset>>(new Map())
  const assetTransformsRef = useRef<Map<string, CanvasAssetTransform>>(new Map())
  const layerGroupsRef = useRef<Map<string, LeaferGroup>>(new Map())
  const canvasObjectNodesRef = useRef<Map<string, LeaferBox>>(new Map())
  const layerObjectTargetsRef = useRef<Map<string, CanvasObjectTarget>>(new Map())
  const pointerBoundsRef = useRef<DOMRect | null>(null)
  const selectionPointRef = useRef<CanvasPoint | null>(null)
  const selectedObjectTargetsRef = useRef<CanvasObjectTarget[]>([])
  const multiSelectedObjectTargetsRef = useRef<CanvasObjectTarget[]>([])
  const contextMenuTargetsRef = useRef<CanvasObjectTarget[]>([])
  const groupMenuActionHandledRef = useRef(false)
  const multiSelectionInteractionSnapshotsRef = useRef<Map<string, CanvasNodeInteractionState>>(new Map())
  const boxSelectStartRef = useRef<CanvasPoint | null>(null)
  const boxSelectCurrentRef = useRef<CanvasPoint | null>(null)
  const boxSelectPointerRef = useRef<number | null>(null)
  const isBoxSelectingRef = useRef(false)
  const multiSelectionDragRef = useRef<{
    pointerId: number
    lastPoint: CanvasPoint
    totalDelta: CanvasPoint
    targets: CanvasObjectTarget[]
  } | null>(null)
  const shouldBlockSelectionRef = useRef<(target: unknown) => boolean>(() => false)
  const strokeLayerIdRef = useRef(activeLayerId)
  const objectFlipStatesRef = useRef<Map<string, CanvasObjectFlipState>>(new Map())
  const draftFrameRef = useRef<number | null>(null)
  const pendingDraftPointsRef = useRef<PointerPoint[]>([])
  const draftPathRef = useRef<SVGPathElement | null>(null)
  const draftEraserPathRef = useRef<MutableDraftEraserPath | null>(null)
  const cursorGroupRef = useRef<SVGGElement | null>(null)
  const eraserHaloRef = useRef<SVGCircleElement | null>(null)
  const eraserOutlineRef = useRef<SVGCircleElement | null>(null)
  const multiSelectionOutlineRef = useRef<SVGRectElement | null>(null)
  const snapGuideGroupRef = useRef<SVGGElement | null>(null)
  const snapGuideTimeoutRef = useRef<number | null>(null)
  const [renderReadyVersion, setRenderReadyVersion] = useState(0)
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null)
  const [selectionBox, setSelectionBox] = useState<CanvasSelectionBox | null>(null)
  const [selectedObjectTargets, setSelectedObjectTargets] = useState<CanvasObjectTarget[]>([])

  useImperativeHandle(
    ref,
    () => ({
      async captureViewport(filename = createViewportScreenshotFilename()) {
        const app = appRef.current
        if (!app) {
          throw new Error('画布还未准备好')
        }

        const result = await exportViewportWithoutEditorOverlays(app, filename)

        if (result.error) {
          throw result.error instanceof Error ? result.error : new Error('截图失败')
        }
      },
      async captureViewportFile(filename = createViewportScreenshotFilename()) {
        const app = appRef.current
        if (!app) {
          throw new Error('画布还未准备好')
        }

        return exportViewportFileWithoutEditorOverlays(app, filename)
      },
      clientPointToCanvasPoint(clientX: number, clientY: number) {
        const stage = stageRef.current
        if (!stage) return null
        const point = getCanvasPointFromClient(clientX, clientY, stage.getBoundingClientRect(), dimensionsRef.current)
        return { x: point[0], y: point[1] }
      }
    }),
    []
  )

  const updateSelectedObjectTargets = useCallback((targets: CanvasObjectTarget[]) => {
    if (targets.length > 1) {
      multiSelectedObjectTargetsRef.current = targets
    }
    selectedObjectTargetsRef.current = targets
    setSelectedObjectTargets((currentTargets) =>
      areCanvasTargetArraysEqual(currentTargets, targets) ? currentTargets : targets
    )
  }, [])

  strokesRef.current = strokes
  assetsRef.current = assets
  layersRef.current = layers
  dimensionsRef.current = dimensions
  activeToolRef.current = activeTool
  activeObjectTargetRef.current = activeObjectTarget
  strokeLayerIdRef.current = activeLayerId
  onLayerSelectRef.current = onLayerSelect
  onObjectSelectRef.current = onObjectSelect
  onObjectsGroupRef.current = onObjectsGroup
  onObjectDeleteRef.current = onObjectDelete
  selectedObjectTargetsRef.current = selectedObjectTargets
  shouldBlockSelectionRef.current = (target) =>
    shouldBlockErasedSelection(
      target,
      selectionPointRef.current,
      strokesRef.current,
      assetsRef.current,
      objectOffsetsRef.current
    )

  function paintSnapGuides(guides: SnapGuide[]): void {
    const group = snapGuideGroupRef.current
    if (!group) {
      return
    }

    if (snapGuideTimeoutRef.current !== null) {
      window.clearTimeout(snapGuideTimeoutRef.current)
      snapGuideTimeoutRef.current = null
    }

    group.replaceChildren()

    if (guides.length === 0) {
      group.style.display = 'none'
      return
    }

    const namespace = 'http://www.w3.org/2000/svg'

    for (const guide of guides) {
      const line = document.createElementNS(namespace, 'line')
      line.setAttribute('vector-effect', 'non-scaling-stroke')
      line.setAttribute('stroke', 'var(--accent-strong)')
      line.setAttribute('stroke-width', '1.4')
      line.setAttribute('stroke-dasharray', '9 7')
      line.setAttribute('opacity', '0.9')

      if (guide.axis === 'x') {
        line.setAttribute('x1', String(guide.position))
        line.setAttribute('x2', String(guide.position))
        line.setAttribute('y1', '0')
        line.setAttribute('y2', String(dimensions.height))
      } else {
        line.setAttribute('x1', '0')
        line.setAttribute('x2', String(dimensions.width))
        line.setAttribute('y1', String(guide.position))
        line.setAttribute('y2', String(guide.position))
      }

      group.appendChild(line)
    }

    group.style.display = 'block'
    snapGuideTimeoutRef.current = window.setTimeout(() => {
      group.replaceChildren()
      group.style.display = 'none'
      snapGuideTimeoutRef.current = null
    }, 220)
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    let isDisposed = false

    host.replaceChildren()
    renderContextRef.current = null
    appRef.current = null

    Promise.all([import('leafer-ui'), import('@leafer-in/editor'), import('@leafer-in/export')]).then(([module]) => {
      if (isDisposed || hostRef.current !== host) {
        return
      }

      const { App, Group } = module
      const hostStyle = window.getComputedStyle(host)
      const accentColor = hostStyle.getPropertyValue('--nomi-accent').trim() || '#3b82f6'
      const paperColor = hostStyle.getPropertyValue('--nomi-paper').trim() || '#ffffff'
      const app = new App({
        view: host,
        width: dimensions.width,
        height: dimensions.height,
        fill: paperColor,
        tree: { type: 'draw' },
        wheel: {
          disabled: true,
          preventDefault: false
        },
        touch: {
          preventDefault: false
        },
        move: {
          disabled: true,
          holdSpaceKey: false,
          holdMiddleKey: false,
          holdRightKey: false,
          drag: false,
          dragEmpty: false
        },
        zoom: {
          disabled: true
        },
        keyEvent: false,
        editor: {
          keyEvent: false,
          moveable: true,
          resizeable: false,
          lockRatio: true,
          flipable: false,
          rotateable: false,
          skewable: false,
          selector: true,
          hover: true,
          multipleSelect: false,
          boxSelect: false,
          stroke: accentColor,
          strokeWidth: 1.5,
          pointFill: paperColor,
          pointSize: 10,
          pointRadius: 3,
          hideRotatePoints: true,
          hideResizeLines: true,
          beforeMove: ({ target, x, y }: { target?: unknown; x: number; y: number }) =>
            getSnappedCanvasMove({
              target,
              x,
              y,
              dimensions,
              layers: layersRef.current,
              assets: assetsRef.current,
              strokes: strokesRef.current,
              offsets: objectOffsetsRef.current,
              assetTransforms: assetTransformsRef.current,
              onSnapGuides: paintSnapGuides
            }),
          beforeScale: ({ target, scaleX, scaleY }: { target?: unknown; scaleX?: number; scaleY?: number }) =>
            getMinimumAssetScale(target, scaleX, scaleY, assetTransformsRef.current, assetsRef.current),
          beforeSelect: ({ target }: { target?: unknown }) =>
            shouldBlockEditorTargetInteraction(
              target,
              selectedObjectTargetsRef.current,
              isBoxSelectingRef.current,
              Boolean(multiSelectionDragRef.current),
              shouldBlockSelectionRef.current
            )
              ? false
              : undefined,
          beforeHover: ({ target }: { target?: unknown }) =>
            shouldBlockEditorTargetInteraction(
              target,
              selectedObjectTargetsRef.current,
              isBoxSelectingRef.current,
              Boolean(multiSelectionDragRef.current),
              shouldBlockSelectionRef.current
            )
              ? false
              : undefined
        }
      })
      const rootGroup = new Group()

      fitLeaferCanvasToHost(app)
      app.tree.add(rootGroup)
      appRef.current = app
      renderContextRef.current = {
        app,
        Box: module.Box,
        Group: module.Group,
        Image: module.Image,
        Path: module.Path,
        PathCommandMap: module.PathCommandMap,
        PathConvert: module.PathConvert,
        PathNumberCommandLengthMap: module.PathNumberCommandLengthMap,
        Rect: module.Rect,
        rootGroup
      }
      setRenderReadyVersion((version) => version + 1)
    })

    return () => {
      isDisposed = true
      if (snapGuideTimeoutRef.current !== null) {
        window.clearTimeout(snapGuideTimeoutRef.current)
        snapGuideTimeoutRef.current = null
      }
      snapGuideGroupRef.current?.replaceChildren()
      renderContextRef.current = null
      appRef.current?.destroy?.()
      appRef.current = null
      host.replaceChildren()
    }
  }, [dimensions.height, dimensions.width])

  useLayoutEffect(() => {
    const context = renderContextRef.current
    if (!context) {
      return
    }

    renderWhiteboardScene({
      context,
      assets,
      strokes,
      layers,
      dimensions,
      objectOffsets: objectOffsetsRef.current,
      assetTransforms: assetTransformsRef.current,
      objectFlipStates: objectFlipStatesRef.current,
      layerGroupsRef,
      canvasObjectNodesRef,
      layerObjectTargetsRef,
      draftEraserPathRef,
    })
  }, [assets, dimensions.height, dimensions.width, layers, renderReadyVersion, strokes])

  useWhiteboardSceneSync(
    {
      renderContextRef,
      activeObjectTargetRef,
      layerObjectTargetsRef,
      canvasObjectNodesRef,
      isBoxSelectingRef,
      selectedObjectTargetsRef,
      multiSelectedObjectTargetsRef,
      multiSelectionInteractionSnapshotsRef,
      multiSelectionDragRef,
      objectOffsetsRef,
      assetsRef,
      assetTransformsRef,
      strokesRef,
      onLayerSelectRef,
      onObjectSelectRef,
    },
    {
      activeTool,
      activeLayerId,
      activeObjectTarget,
      contextMenu,
      selectedObjectTargets,
      renderReadyVersion,
      assets,
      layers,
      strokes,
      updateSelectedObjectTargets,
      setContextMenu,
      setSelectionBox,
      paintSnapGuides,
    },
  )

  const {
    flipSelectedTarget,
    handleGroupMenuPointerDown,
    handleGroupMenuPointerUp,
    handleGroupMenuMouseDown,
    handleGroupMenuClick,
    showContextMenu,
  } = useWhiteboardSelectionActions(
    {
      activeObjectTargetRef,
      assetsRef,
      strokesRef,
      layersRef,
      objectFlipStatesRef,
      canvasObjectNodesRef,
      objectOffsetsRef,
      assetTransformsRef,
      selectedObjectTargetsRef,
      multiSelectedObjectTargetsRef,
      contextMenuTargetsRef,
      groupMenuActionHandledRef,
      renderContextRef,
      stageRef,
      onObjectDeleteRef,
      onObjectsGroupRef,
      onLayerSelectRef,
      onObjectSelectRef,
    },
    { activeTool, dimensions, contextMenu, updateSelectedObjectTargets, setContextMenu, setRenderReadyVersion },
  )

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }

    const suppressRightClickSelection = (event: PointerEvent) => {
      if (
        activeToolRef.current !== 'select' ||
        event.button <= 0 ||
        selectedObjectTargetsRef.current.length < 2
      ) {
        return
      }

      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    stage.addEventListener('pointerdown', suppressRightClickSelection, true)

    return () => {
      stage.removeEventListener('pointerdown', suppressRightClickSelection, true)
    }
  }, [])

  const activeLayer = layers.find((layer) => layer.id === activeLayerId)
  const canDraw = (activeTool === 'brush' || activeTool === 'eraser') && Boolean(activeLayer && !activeLayer.locked)
  const removeBackgroundBounds = removingBackgroundTargetId
    ? getCanvasTargetsUnionBounds(
        [{ kind: 'asset', id: removingBackgroundTargetId }],
        layers,
        assets,
        strokes,
        objectOffsetsRef.current,
        assetTransformsRef.current
      )
    : null

  const { hideToolCursor, updateToolCursor, handlePointerDown, handlePointerMove, finishStroke } =
    useWhiteboardDrawing(
      {
        activePointerRef,
        pointsRef,
        pointerBoundsRef,
        draftFrameRef,
        pendingDraftPointsRef,
        draftPathRef,
        draftEraserPathRef,
        cursorGroupRef,
        eraserHaloRef,
        eraserOutlineRef,
        pointerLayerRef,
        renderContextRef,
        layerGroupsRef,
        strokeLayerIdRef,
        layersRef,
        assetsRef,
        strokesRef,
        objectOffsetsRef,
        assetTransformsRef,
        onLayerSelectRef,
      },
      { activeTool, brushSize, color, dimensions, activeLayerId, canDraw, onStrokeCommit },
    )

  const aspect = ratio.replace(':', ' / ')
  const aspectValue = dimensions.width / dimensions.height
  const stageStyle = {
    '--stage-width': `${dimensions.width}px`,
    '--stage-aspect': aspect,
    '--stage-ratio': String(aspectValue),
    ...(fitMode === 'bounded'
      ? {
          width: `min(100cqw, calc(100cqh * ${aspectValue}))`,
          height: `min(100cqh, calc(100cqw / ${aspectValue}))`,
        }
      : {}),
  } as CSSProperties

  const { handleStagePointerDownCapture, handleStagePointerMoveCapture, handleStagePointerUpCapture } =
    useWhiteboardBoxSelection(
      {
        stageRef,
        selectionPointRef,
        multiSelectionOutlineRef,
        multiSelectionDragRef,
        boxSelectStartRef,
        boxSelectCurrentRef,
        boxSelectPointerRef,
        isBoxSelectingRef,
        selectedObjectTargetsRef,
        multiSelectedObjectTargetsRef,
        activeObjectTargetRef,
        objectOffsetsRef,
        assetTransformsRef,
        canvasObjectNodesRef,
        assetsRef,
        strokesRef,
        layersRef,
        renderContextRef,
        onLayerSelectRef,
        onObjectSelectRef,
      },
      { activeTool, dimensions, updateSelectedObjectTargets, setSelectionBox, setContextMenu, setRenderReadyVersion },
    )

  return (
    <div
      className={[
        'touch-none overflow-hidden border border-nomi-line bg-[var(--canvas)] shadow-nomi-lg [aspect-ratio:var(--stage-aspect)]',
        fitMode === 'bounded'
          ? 'rounded-nomi'
          : 'rounded-nomi [width:min(100%,var(--stage-width),calc(100cqh_*_var(--stage-ratio)))]',
      ].join(' ')}
      style={stageStyle}
    >
      <div
        ref={stageRef}
        className="relative h-full w-full"
        onContextMenu={showContextMenu}
        onPointerDownCapture={handleStagePointerDownCapture}
        onPointerMoveCapture={handleStagePointerMoveCapture}
        onPointerUpCapture={handleStagePointerUpCapture}
        onPointerCancelCapture={handleStagePointerUpCapture}
      >
        <div
          ref={hostRef}
          className="h-full w-full overflow-hidden [&_.leafer-app-view]:!block [&_.leafer-app-view]:!h-full [&_.leafer-app-view]:!max-h-full [&_.leafer-app-view]:!max-w-full [&_.leafer-app-view]:!w-full [&_canvas]:!block [&_canvas]:!h-full [&_canvas]:!max-h-full [&_canvas]:!max-w-full [&_canvas]:!w-full"
          aria-label="Leafer 画板"
        />
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          data-testid="draft-layer"
          aria-hidden="true"
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          preserveAspectRatio="none"
        >
          <g ref={snapGuideGroupRef} className="pointer-events-none" style={{ display: 'none' }} />
          {selectionBox ? (
            <rect
              className="fill-[rgba(24,199,184,0.12)] stroke-[var(--accent-strong)] [stroke-dasharray:8_6] [stroke-width:1.5]"
              data-testid="box-select-rect"
              vectorEffect="non-scaling-stroke"
              {...getSvgRectAttributes(normalizeCanvasBounds(selectionBox.start, selectionBox.current))}
            />
          ) : null}
          {selectedObjectTargets.length > 1 ? (
            <rect
              ref={multiSelectionOutlineRef}
              className="fill-transparent stroke-[var(--accent-strong)] [filter:drop-shadow(0_2px_4px_rgba(0,0,0,0.24))] [stroke-dasharray:7_5] [stroke-width:1.8]"
              data-testid="multi-selected-outline"
              vectorEffect="non-scaling-stroke"
              {...getSvgRectAttributes(
                getCanvasTargetsUnionBounds(
                  selectedObjectTargets,
                  layers,
                  assets,
                  strokes,
                  objectOffsetsRef.current,
                  assetTransformsRef.current
                ) ?? { x: 0, y: 0, width: 1, height: 1 }
              )}
            />
          ) : null}
          {removeBackgroundBounds ? (
            <rect
              data-testid="remove-bg-target-pending"
              fill="white"
              style={{ animation: 'remove-bg-pulse 1.5s ease-in-out infinite' }}
              {...getSvgRectAttributes(removeBackgroundBounds)}
            />
          ) : null}
          {activeTool === 'brush' ? (
            <path ref={draftPathRef} fill={color} style={{ display: 'none' }} />
          ) : null}
          {activeTool === 'eraser' ? (
            <g ref={cursorGroupRef} data-testid="tool-cursor-preview" style={{ display: 'none' }}>
              <circle
                ref={eraserHaloRef}
                cx="0"
                cy="0"
                r={brushSize / 2}
                fill="rgba(251,251,250,0.22)"
                stroke="rgba(255,255,255,0.95)"
                strokeWidth="6"
              />
              <circle
                ref={eraserOutlineRef}
                cx="0"
                cy="0"
                r={brushSize / 2}
                fill="none"
                stroke="rgba(15,23,42,0.88)"
                strokeDasharray="10 6"
                strokeWidth="2.4"
              />
            </g>
          ) : null}
        </svg>
        <div
          ref={pointerLayerRef}
          className={`absolute inset-0 cursor-crosshair ${
            activeTool === 'select' ? 'pointer-events-none cursor-default' : ''
          } ${activeTool === 'eraser' ? 'cursor-none' : ''}`}
          role="application"
          aria-label="绘图操作层"
          onPointerDown={handlePointerDown}
          onPointerEnter={updateToolCursor}
          onPointerLeave={hideToolCursor}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
        />
        {contextMenu ? (
          <div
            className="absolute z-20 grid w-[124px] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper p-1 text-body-sm text-nomi-ink shadow-nomi-lg [&>button]:h-8 [&>button]:rounded-nomi-sm [&>button]:bg-transparent [&>button]:px-2 [&>button]:text-left [&>button]:text-inherit [&>button]:transition [&>button]:duration-150 [&>button]:ease-out [&>button:focus-visible]:bg-nomi-accent-soft [&>button:focus-visible]:text-nomi-accent [&>button:focus-visible]:outline-none [&>button:hover]:bg-nomi-accent-soft [&>button:hover]:text-nomi-accent"
            data-canvas-context-menu="true"
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y } as CSSProperties}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {contextMenu.targets.length > 1 ? (
              <button
                type="button"
                role="menuitem"
                onPointerDown={handleGroupMenuPointerDown}
                onPointerUp={handleGroupMenuPointerUp}
                onMouseDown={handleGroupMenuMouseDown}
                onClick={handleGroupMenuClick}
              >
                组合
              </button>
            ) : null}
            {contextMenu.targets.length === 1 ? (
              <>
                <button type="button" role="menuitem" onClick={() => flipSelectedTarget('x')}>
                  水平翻转
                </button>
                <button type="button" role="menuitem" onClick={() => flipSelectedTarget('y')}>
                  垂直翻转
                </button>
                {contextMenu.targets[0].kind === 'asset' && onRemoveBackground ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { onRemoveBackground(contextMenu.targets[0]); setContextMenu(null) }}
                  >
                    抠图
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
})
