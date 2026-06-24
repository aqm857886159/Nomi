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
import { createSmoothStrokePath, normalizePointerPoint, type PointerPoint } from './lib/stroke'

export type CanvasStroke = {
  id: string
  layerId: string
  color: string
  size: number
  path: string
  tool: 'brush' | 'eraser'
  points?: PointerPoint[]
}

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
  onStrokeCommit: (stroke: CanvasStroke) => void
  onLayerSelect?: (layerId: string) => void
  onObjectSelect?: (target: CanvasObjectTarget, layerId: string) => void
  onObjectsGroup?: (targets: CanvasObjectTarget[]) => void
  onObjectDelete?: (target: CanvasObjectTarget) => void
}

export type LeaferCanvasHandle = {
  captureViewport: (filename?: string) => Promise<void>
  captureViewportFile: (filename?: string) => Promise<File>
  clientPointToCanvasPoint: (clientX: number, clientY: number) => { x: number; y: number } | null
}

type LeaferEditorOverlayState = {
  visible?: unknown
}

type LeaferEditorOverlay = {
  visible?: unknown
}

type LeaferUiModule = typeof import('leafer-ui')
type LeaferApp = InstanceType<LeaferUiModule['App']>
type LeaferBox = InstanceType<LeaferUiModule['Box']>
type LeaferBoxChild = Parameters<LeaferBox['add']>[0]
type LeaferGroup = InstanceType<LeaferUiModule['Group']>
type LeaferPath = InstanceType<LeaferUiModule['Path']>
type LeaferPathCommandData = ReturnType<LeaferUiModule['PathConvert']['parse']>
type LeaferPathTools = Pick<LeaferUiModule, 'PathCommandMap' | 'PathConvert' | 'PathNumberCommandLengthMap'>
type LeaferRenderContext = Pick<
  LeaferUiModule,
  'Box' | 'Group' | 'Image' | 'Path' | 'PathCommandMap' | 'PathConvert' | 'PathNumberCommandLengthMap' | 'Rect'
> & {
  app: LeaferApp
  rootGroup: LeaferGroup
}
type CanvasObjectKind = 'asset' | 'stroke' | 'group'
type CanvasObjectOffset = {
  x: number
  y: number
}
type CanvasAssetTransform = CanvasObjectBounds
type CanvasObjectFlipState = {
  x: boolean
  y: boolean
}
type CanvasPoint = {
  x: number
  y: number
}
export type CanvasObjectTarget = {
  kind: CanvasObjectKind
  id: string
}
type CanvasObjectBounds = {
  x: number
  y: number
  width: number
  height: number
}
type CanvasNodeInteractionState = {
  editable?: unknown
  draggable?: unknown
  hittable?: unknown
  hitFill?: unknown
}
type MutableDraftEraserPath = LeaferPath & {
  path?: string
  visible?: boolean
  remove?: () => void
}
type SnapGuide = {
  axis: 'x' | 'y'
  position: number
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

const SNAP_DISTANCE = 18
const MIN_ASSET_SIZE = 24
const EDITOR_RESIZE_HANDLE_HIT_RADIUS_PX = 16

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
  onStrokeCommit,
  onLayerSelect,
  onObjectSelect,
  onObjectsGroup,
  onObjectDelete
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

    const { Box, Group, Image, Path, PathCommandMap, PathConvert, PathNumberCommandLengthMap, Rect, rootGroup } =
      context
    const pathTools = { PathCommandMap, PathConvert, PathNumberCommandLengthMap }
    rootGroup.clear()
    layerGroupsRef.current = new Map()
    canvasObjectNodesRef.current = new Map()
    layerObjectTargetsRef.current = new Map()
    draftEraserPathRef.current = null

    const assetsByLayer = groupItemsByLayer(assets)
    const strokesByLayer = groupItemsByLayer(strokes)
    const objectOffsets = objectOffsetsRef.current
    const assetTransforms = assetTransformsRef.current
    const layerGroups = new Map<string, LeaferGroup>()

    for (const layer of layers) {
      const layerCanEdit = layer.kind !== 'background' && layer.visible && !layer.locked
      const layerGroup = new Group({
        opacity: layer.opacity,
        visible: layer.visible
      })

      if (layer.kind === 'background') {
        layerGroup.add(
          new Rect({
            x: 0,
            y: 0,
            width: dimensions.width,
            height: dimensions.height,
            fill: '#fbfbfa'
          })
        )
      }

      const layerAssets = assetsByLayer.get(layer.id) ?? []
      const layerStrokes = strokesByLayer.get(layer.id) ?? []
      const layerIsGroup = isCanvasGroupLayer(layer)

      if (layerIsGroup) {
        const groupBaseBounds = getLayerBaseBounds(layer.id, assetsByLayer, strokesByLayer, objectOffsets, assetTransforms)

        if (groupBaseBounds) {
          const groupOffset = getObjectOffset(objectOffsets, 'group', layer.id)
          const groupBounds = {
            ...groupBaseBounds,
            x: groupBaseBounds.x + groupOffset.x,
            y: groupBaseBounds.y + groupOffset.y
          }
          const groupTarget: CanvasObjectTarget = { kind: 'group', id: layer.id }
          const groupBox = new Box({
            x: groupBounds.x,
            y: groupBounds.y,
            width: Math.max(1, groupBounds.width),
            height: Math.max(1, groupBounds.height),
            fill: 'rgba(0,0,0,0)',
            editable: layerCanEdit,
            draggable: layerCanEdit,
            hittable: layerCanEdit,
            hitFill: 'all',
            hitChildren: false,
            resizeChildren: true,
            editConfig: {
              resizeable: false,
              flipable: false,
              rotateable: false,
              skewable: false
            },
            canvasObjectKind: 'group',
            canvasObjectId: layer.id
          })
          const groupContent = new Group(getFlippedContentGroupProps(
            groupBaseBounds,
            getObjectFlipState(objectFlipStatesRef.current, groupTarget)
          ))

          for (const asset of layerAssets) {
            const assetBounds = getAssetRenderBounds(asset, objectOffsets, assetTransforms)
            const assetFlipState = getObjectFlipState(objectFlipStatesRef.current, { kind: 'asset', id: asset.id })
            const assetGroup = new Box({
              x: assetBounds.x - groupBaseBounds.x,
              y: assetBounds.y - groupBaseBounds.y,
              width: Math.max(1, assetBounds.width),
              height: Math.max(1, assetBounds.height),
              fill: 'rgba(0,0,0,0)',
              editable: false,
              draggable: false,
              hittable: false,
              hitFill: 'none',
              hitChildren: false,
              resizeChildren: true,
              canvasObjectKind: 'asset',
              canvasObjectId: asset.id
            })

            addCanvasObjectGroup(
              groupContent,
              assetGroup,
              {
                kind: 'asset',
                id: asset.id,
                bounds: assetBounds
              },
              new Image({
                x: 0,
                y: 0,
                width: assetBounds.width,
                height: assetBounds.height,
                url: asset.url,
                cornerRadius: 8,
                hittable: false
              }),
              layerStrokes.filter((stroke) => stroke.tool === 'eraser'),
              Group,
              Path,
              assetFlipState,
              objectOffsets,
              pathTools
            )
          }

          for (const stroke of layerStrokes.filter((item) => item.tool !== 'eraser')) {
            const offset = getObjectOffset(objectOffsets, 'stroke', stroke.id)
            const strokeBounds = getSvgPathBounds(stroke.path)
            if (!strokeBounds) {
              continue
            }

            const strokeFlipState = getObjectFlipState(objectFlipStatesRef.current, { kind: 'stroke', id: stroke.id })
            const strokeGroup = new Box({
              x: strokeBounds.x + offset.x - groupBaseBounds.x,
              y: strokeBounds.y + offset.y - groupBaseBounds.y,
              width: Math.max(1, strokeBounds.width),
              height: Math.max(1, strokeBounds.height),
              fill: 'rgba(0,0,0,0)',
              editable: false,
              draggable: false,
              hittable: false,
              hitFill: 'none',
              hitChildren: false,
              canvasObjectKind: 'stroke',
              canvasObjectId: stroke.id
            })

            addCanvasObjectGroup(
              groupContent,
              strokeGroup,
              {
                kind: 'stroke',
                id: stroke.id,
                bounds: strokeBounds
              },
              new Path({
                x: 0,
                y: 0,
                path: translatePathToLocal(stroke.path, strokeBounds, pathTools),
                fill: stroke.color,
                hittable: false
              }),
              layerStrokes.filter((item) => item.tool === 'eraser'),
              Group,
              Path,
              strokeFlipState,
              objectOffsets,
              pathTools
            )
          }

          groupBox.add(groupContent)
          layerGroup.add(groupBox)
          canvasObjectNodesRef.current.set(getObjectKey('group', layer.id), groupBox)
          layerObjectTargetsRef.current.set(layer.id, groupTarget)
        }

        rootGroup.add(layerGroup)
        layerGroups.set(layer.id, layerGroup)
        continue
      }

      for (const asset of layerAssets) {
        const assetBounds = getAssetRenderBounds(asset, objectOffsets, assetTransforms)
        const flipState = getObjectFlipState(objectFlipStatesRef.current, { kind: 'asset', id: asset.id })
        const assetGroup = new Box({
          x: assetBounds.x,
          y: assetBounds.y,
          width: Math.max(1, assetBounds.width),
          height: Math.max(1, assetBounds.height),
          fill: 'rgba(0,0,0,0)',
          editable: layerCanEdit,
          draggable: layerCanEdit,
          hittable: layerCanEdit,
          hitFill: 'all',
          hitChildren: false,
          resizeChildren: true,
          lockRatio: true,
          widthRange: [MIN_ASSET_SIZE, dimensions.width * 2],
          heightRange: [MIN_ASSET_SIZE, dimensions.height * 2],
          editConfig: {
            resizeable: layerCanEdit,
            lockRatio: true,
            flipable: false,
            rotateable: false,
            skewable: false
          },
          canvasObjectKind: 'asset',
          canvasObjectId: asset.id
        })

        addCanvasObjectGroup(
          layerGroup,
          assetGroup,
          {
            kind: 'asset',
            id: asset.id,
            bounds: assetBounds
          },
          new Image({
            x: 0,
            y: 0,
            width: assetBounds.width,
            height: assetBounds.height,
            url: asset.url,
            cornerRadius: 8,
            hittable: false
          }),
          layerStrokes.filter((stroke) => stroke.tool === 'eraser'),
          Group,
          Path,
          flipState,
          objectOffsets,
          pathTools
        )
        canvasObjectNodesRef.current.set(getObjectKey('asset', asset.id), assetGroup)
        layerObjectTargetsRef.current.set(layer.id, { kind: 'asset', id: asset.id })
      }

      for (let strokeIndex = 0; strokeIndex < layerStrokes.length; strokeIndex += 1) {
        const stroke = layerStrokes[strokeIndex]
        if (!stroke.path) {
          continue
        }

        if (stroke.tool === 'eraser') {
          continue
        }

        const offset = getObjectOffset(objectOffsets, 'stroke', stroke.id)
        const flipState = getObjectFlipState(objectFlipStatesRef.current, { kind: 'stroke', id: stroke.id })
        const strokeBounds = getSvgPathBounds(stroke.path) ?? {
          x: 0,
          y: 0,
          width: 1,
          height: 1
        }
        const strokeGroup = new Box({
          x: strokeBounds.x + offset.x,
          y: strokeBounds.y + offset.y,
          width: Math.max(1, strokeBounds.width),
          height: Math.max(1, strokeBounds.height),
          fill: 'rgba(0,0,0,0)',
          editable: layerCanEdit,
          draggable: layerCanEdit,
          hittable: layerCanEdit,
          hitFill: 'all',
          hitChildren: false,
          editConfig: {
            resizeable: false,
            flipable: false,
            rotateable: false,
            skewable: false
          },
          canvasObjectKind: 'stroke',
          canvasObjectId: stroke.id
        })

        addCanvasObjectGroup(
          layerGroup,
          strokeGroup,
          {
            kind: 'stroke',
            id: stroke.id,
            bounds: strokeBounds
          },
          new Path({
            x: 0,
            y: 0,
            path: translatePathToLocal(stroke.path, strokeBounds, pathTools),
            fill: stroke.color,
            hittable: false
          }),
          layerStrokes.slice(strokeIndex + 1).filter((item) => item.tool === 'eraser'),
          Group,
          Path,
          flipState,
          objectOffsets,
          pathTools
        )
        canvasObjectNodesRef.current.set(getObjectKey('stroke', stroke.id), strokeGroup)
        layerObjectTargetsRef.current.set(layer.id, { kind: 'stroke', id: stroke.id })
      }

      rootGroup.add(layerGroup)
      layerGroups.set(layer.id, layerGroup)
    }

    layerGroupsRef.current = layerGroups
  }, [assets, dimensions.height, dimensions.width, layers, renderReadyVersion, strokes])

  useEffect(() => {
    const editor = renderContextRef.current?.app.editor
    if (!editor) {
      return
    }

    if (activeTool !== 'select') {
      paintSnapGuides([])
      editor.cancel()
      return
    }

    if (isBoxSelectingRef.current || selectedObjectTargetsRef.current.length > 1) {
      paintSnapGuides([])
      editor.cancel?.()
      return
    }

    const objectTarget = activeObjectTargetRef.current ?? layerObjectTargetsRef.current.get(activeLayerId)
    const node = objectTarget ? canvasObjectNodesRef.current.get(getObjectKey(objectTarget.kind, objectTarget.id)) : null

    if (node) {
      editor.select?.(node)
    } else {
      editor.cancel?.()
    }
  }, [activeLayerId, activeObjectTarget, activeTool, assets, layers, renderReadyVersion, selectedObjectTargets, strokes])

  useEffect(() => {
    setContextMenu(null)
    setSelectionBox(null)

    if (activeTool !== 'select') {
      multiSelectedObjectTargetsRef.current = []
      updateSelectedObjectTargets([])
      return
    }

    const multiTargets = getActiveMultiSelectionTargets(
      selectedObjectTargetsRef.current,
      multiSelectedObjectTargetsRef.current
    )
    if (
      activeObjectTarget &&
      multiTargets.length > 1 &&
      multiTargets.some((target) => areCanvasTargetsEqual(target, activeObjectTarget))
    ) {
      updateSelectedObjectTargets(multiTargets)
      return
    }

    if (activeObjectTarget) {
      multiSelectedObjectTargetsRef.current = []
    }
    updateSelectedObjectTargets(activeObjectTarget ? [activeObjectTarget] : [])
  }, [activeObjectTarget, activeTool, updateSelectedObjectTargets])

  useEffect(() => {
    const snapshots = multiSelectionInteractionSnapshotsRef.current
    const disabledKeys =
      activeTool === 'select' && selectedObjectTargets.length > 1
        ? new Set(selectedObjectTargets.map((target) => getObjectKey(target.kind, target.id)))
        : new Set<string>()

    for (const [key, snapshot] of snapshots) {
      if (disabledKeys.has(key)) {
        continue
      }

      const node = canvasObjectNodesRef.current.get(key)
      if (node) {
        setCanvasNodeInteractionState(node, snapshot)
      }
      snapshots.delete(key)
    }

    for (const key of disabledKeys) {
      const node = canvasObjectNodesRef.current.get(key)
      if (!node) {
        continue
      }

      if (!snapshots.has(key)) {
        snapshots.set(key, getCanvasNodeInteractionState(node))
      }
      setCanvasNodeInteractionState(node, {
        editable: false,
        draggable: false,
        hittable: false,
        hitFill: 'none'
      })
    }
  }, [activeTool, assets, layers, renderReadyVersion, selectedObjectTargets, strokes])

  useEffect(() => {
    const editor = renderContextRef.current?.app.editor
    if (!editor) {
      return
    }

    const handleEditorMove = (event: unknown) => {
      const moveEvent = event as {
        moveX?: number
        moveY?: number
        target?: {
          canvasObjectKind?: CanvasObjectKind
          canvasObjectId?: string
        }
      }
      const kind = moveEvent.target?.canvasObjectKind
      const id = moveEvent.target?.canvasObjectId

      if (!kind || !id) {
        return
      }

      const key = getObjectKey(kind, id)
      const offset = objectOffsetsRef.current.get(key) ?? { x: 0, y: 0 }
      objectOffsetsRef.current.set(key, {
        x: offset.x + (moveEvent.moveX ?? 0),
        y: offset.y + (moveEvent.moveY ?? 0)
      })

      if (kind === 'asset') {
        const asset = assetsRef.current.find((item) => item.id === id)
        const currentTransform = assetTransformsRef.current.get(id)

        if (asset && currentTransform) {
          assetTransformsRef.current.set(id, {
            ...currentTransform,
            x: currentTransform.x + (moveEvent.moveX ?? 0),
            y: currentTransform.y + (moveEvent.moveY ?? 0)
          })
        }
      }
    }

    const handleEditorScale = (event: unknown) => {
      const scaleEvent = event as {
        scaleX?: number
        scaleY?: number
        target?: unknown
      }
      const objectTarget = getCanvasObjectTarget(scaleEvent.target)

      if (objectTarget?.kind !== 'asset') {
        return
      }

      const asset = assetsRef.current.find((item) => item.id === objectTarget.id)
      if (!asset) {
        return
      }

      const currentBounds = getAssetRenderBounds(asset, objectOffsetsRef.current, assetTransformsRef.current)
      const targetBounds = getCanvasNodeBounds(scaleEvent.target)
      const nextBounds = normalizeAssetBounds({
        x: targetBounds.x ?? currentBounds.x,
        y: targetBounds.y ?? currentBounds.y,
        width: targetBounds.width ?? currentBounds.width * Math.abs(scaleEvent.scaleX ?? 1),
        height: targetBounds.height ?? currentBounds.height * Math.abs(scaleEvent.scaleY ?? 1)
      })

      assetTransformsRef.current.set(asset.id, nextBounds)
      objectOffsetsRef.current.set(getObjectKey('asset', asset.id), {
        x: nextBounds.x - asset.x,
        y: nextBounds.y - asset.y
      })
    }

    const handleEditorSelect = (event: unknown) => {
      const selectEvent = event as {
        value?: unknown
        target?: unknown
      }
      const selectedTarget = Array.isArray(selectEvent.value) ? selectEvent.value[0] : selectEvent.value
      const objectTarget = getCanvasObjectTarget(selectedTarget ?? selectEvent.target)
      const layerId = objectTarget
        ? getLayerIdForCanvasObject(objectTarget, assetsRef.current, strokesRef.current)
        : null

      if (
        objectTarget &&
        shouldBlockEditorTargetInteraction(
          objectTarget,
          getActiveMultiSelectionTargets(selectedObjectTargetsRef.current, multiSelectedObjectTargetsRef.current),
          isBoxSelectingRef.current,
          Boolean(multiSelectionDragRef.current),
          () => false
        )
      ) {
        return
      }

      if (objectTarget && layerId) {
        multiSelectedObjectTargetsRef.current = []
        activeObjectTargetRef.current = objectTarget
        updateSelectedObjectTargets([objectTarget])
        onLayerSelectRef.current?.(layerId)
        onObjectSelectRef.current?.(objectTarget, layerId)
      }
    }

    editor.on?.('editor.move', handleEditorMove)
    editor.on?.('editor.scale', handleEditorScale)
    editor.on?.('editor.select', handleEditorSelect)

    return () => {
      editor.off?.('editor.move', handleEditorMove)
      editor.off?.('editor.scale', handleEditorScale)
      editor.off?.('editor.select', handleEditorSelect)
    }
  }, [renderReadyVersion])

  const getEditableSelectedTarget = useCallback(() => {
    const target = activeObjectTargetRef.current
    if (!target || activeTool !== 'select') {
      return null
    }

    const layerId = getLayerIdForCanvasObject(target, assetsRef.current, strokesRef.current)
    const layer = layerId ? layersRef.current.find((item) => item.id === layerId) : null

    if (!layer || layer.locked || !layer.visible || layer.kind === 'background') {
      return null
    }

    return target
  }, [activeTool])

  const moveSelectedTarget = useCallback(
    (deltaX: number, deltaY: number) => {
      const target = getEditableSelectedTarget()
      if (!target) {
        return false
      }

      const key = getObjectKey(target.kind, target.id)
      const offset = objectOffsetsRef.current.get(key) ?? { x: 0, y: 0 }
      objectOffsetsRef.current.set(key, {
        x: offset.x + deltaX,
        y: offset.y + deltaY
      })

      if (target.kind === 'asset') {
        const currentTransform = assetTransformsRef.current.get(target.id)
        if (currentTransform) {
          assetTransformsRef.current.set(target.id, {
            ...currentTransform,
            x: currentTransform.x + deltaX,
            y: currentTransform.y + deltaY
          })
        }
      }

      setRenderReadyVersion((version) => version + 1)
      return true
    },
    [getEditableSelectedTarget]
  )

  const deleteSelectedTarget = useCallback(() => {
    const target = getEditableSelectedTarget()
    if (!target) {
      return false
    }

    renderContextRef.current?.app.editor.cancel?.()
    activeObjectTargetRef.current = null
    onObjectDeleteRef.current?.(target)
    return true
  }, [getEditableSelectedTarget])

  const flipSelectedTarget = useCallback(
    (axis: 'x' | 'y') => {
      const target = contextMenu?.targets.length === 1 ? contextMenu.targets[0] : getEditableSelectedTarget()
      if (!target) {
        setContextMenu(null)
        return
      }

      const key = getObjectKey(target.kind, target.id)
      const currentFlip = getObjectFlipState(objectFlipStatesRef.current, target)
      objectFlipStatesRef.current.set(key, {
        ...currentFlip,
        [axis]: !currentFlip[axis]
      })

      const node = canvasObjectNodesRef.current.get(key) as
        | (LeaferBox & { flip?: (axis: 'x' | 'y', transition?: boolean | number) => void })
        | undefined
      node?.flip?.(axis)
      setContextMenu(null)
      setRenderReadyVersion((version) => version + 1)
    },
    [contextMenu?.targets, getEditableSelectedTarget]
  )

  const groupSelectedTargets = useCallback(() => {
    if (groupMenuActionHandledRef.current) {
      return
    }

    const menuTargets = contextMenu?.targets.length ? contextMenu.targets : contextMenuTargetsRef.current
    const selectedTargets = selectedObjectTargetsRef.current
    const multiTargets = getActiveMultiSelectionTargets(selectedTargets, multiSelectedObjectTargetsRef.current)
    const targets = menuTargets.length > 1 ? menuTargets : multiTargets
    const groupableTargets = targets.filter(
      (target) => target.kind === 'asset' || target.kind === 'stroke' || target.kind === 'group'
    )

    if (groupableTargets.length < 2) {
      setContextMenu(null)
      return
    }

    groupMenuActionHandledRef.current = true
    onObjectsGroupRef.current?.(groupableTargets)
    multiSelectedObjectTargetsRef.current = []
    contextMenuTargetsRef.current = []
    updateSelectedObjectTargets([])
    setContextMenu(null)
  }, [contextMenu?.targets, updateSelectedObjectTargets])

  const handleGroupMenuPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      groupSelectedTargets()
    },
    [groupSelectedTargets]
  )

  const handleGroupMenuPointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      groupSelectedTargets()
    },
    [groupSelectedTargets]
  )

  const handleGroupMenuMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      groupSelectedTargets()
    },
    [groupSelectedTargets]
  )

  const handleGroupMenuClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      groupSelectedTargets()
    },
    [groupSelectedTargets]
  )

  const showContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (activeTool !== 'select') {
        return
      }

      event.preventDefault()
      const stage = stageRef.current
      if (!stage) {
        return
      }

      const stageBounds = stage.getBoundingClientRect()
      const point = getCanvasPointFromClient(
        event.clientX,
        event.clientY,
        stageBounds,
        dimensions,
        0.5
      )
      const canvasPoint = { x: point[0], y: point[1] }
      const selectedTargets = selectedObjectTargetsRef.current
      const multiTargets = getActiveMultiSelectionTargets(selectedTargets, multiSelectedObjectTargetsRef.current)
      const selectedGroupBounds =
        multiTargets.length > 1
          ? getCanvasTargetsUnionBounds(
              multiTargets,
              layersRef.current,
              assetsRef.current,
              strokesRef.current,
              objectOffsetsRef.current,
              assetTransformsRef.current
            )
          : null

      if (selectedGroupBounds && isPointInsideBounds(canvasPoint, selectedGroupBounds)) {
        event.stopPropagation()
        contextMenuTargetsRef.current = multiTargets
        groupMenuActionHandledRef.current = false
        updateSelectedObjectTargets(multiTargets)
        setContextMenu({
          x: Math.min(stageBounds.width - 132, Math.max(8, event.clientX - stageBounds.left + 8)),
          y: Math.min(stageBounds.height - 88, Math.max(8, event.clientY - stageBounds.top + 8)),
          targets: multiTargets
        })
        return
      }

      const hit = getTopmostEditableCanvasObjectAtPoint(
        canvasPoint,
        layersRef.current,
        assetsRef.current,
        strokesRef.current,
        objectOffsetsRef.current,
        assetTransformsRef.current
      )

      if (!hit) {
        contextMenuTargetsRef.current = []
        groupMenuActionHandledRef.current = false
        setContextMenu(null)
        return
      }

      event.stopPropagation()
      const shouldUseMultiSelection =
        multiTargets.length > 1 && multiTargets.some((target) => areCanvasTargetsEqual(target, hit.target))
      const menuTargets = shouldUseMultiSelection ? multiTargets : [hit.target]

      if (!shouldUseMultiSelection) {
        multiSelectedObjectTargetsRef.current = []
        activeObjectTargetRef.current = hit.target
        updateSelectedObjectTargets([hit.target])
        onLayerSelectRef.current?.(hit.layerId)
        onObjectSelectRef.current?.(hit.target, hit.layerId)
      }

      contextMenuTargetsRef.current = menuTargets
      groupMenuActionHandledRef.current = false
      setContextMenu({
        x: Math.min(stageBounds.width - 132, Math.max(8, event.clientX - stageBounds.left + 8)),
        y: Math.min(stageBounds.height - 88, Math.max(8, event.clientY - stageBounds.top + 8)),
        targets: menuTargets
      })
    },
    [activeTool, dimensions, updateSelectedObjectTargets]
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableKeyboardTarget(event.target)) {
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (deleteSelectedTarget()) {
          event.preventDefault()
        }
        return
      }

      const step = event.shiftKey ? 10 : 1
      const moveDelta = getKeyboardMoveDelta(event.key, step)
      if (!moveDelta) {
        return
      }

      if (moveSelectedTarget(moveDelta.x, moveDelta.y)) {
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [deleteSelectedTarget, moveSelectedTarget])

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const closeContextMenu = (event?: PointerEvent) => {
      if (isCanvasContextMenuEvent(event)) {
        return
      }

      setContextMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu()
      }
    }

    window.addEventListener('pointerdown', closeContextMenu)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointerdown', closeContextMenu)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

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

  const hideToolCursor = useCallback(() => {
    if (activePointerRef.current !== null) {
      return
    }

    const cursorGroup = cursorGroupRef.current
    if (cursorGroup) {
      cursorGroup.style.display = 'none'
    }
    pointerBoundsRef.current = null
  }, [])

  const clearDraftPreview = useCallback(() => {
    if (draftFrameRef.current !== null) {
      window.cancelAnimationFrame(draftFrameRef.current)
      draftFrameRef.current = null
    }

    pendingDraftPointsRef.current = []

    const draftPath = draftPathRef.current
    if (draftPath) {
      draftPath.removeAttribute('d')
      draftPath.style.display = 'none'
    }

    const draftEraserPath = draftEraserPathRef.current
    if (draftEraserPath) {
      draftEraserPath.path = ''
      draftEraserPath.visible = false
      draftEraserPath.remove?.()
      draftEraserPathRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!canDraw) {
      activePointerRef.current = null
      pointsRef.current = []
      clearDraftPreview()
      hideToolCursor()
    }
  }, [canDraw, clearDraftPreview, hideToolCursor])

  useEffect(() => {
    return () => {
      clearDraftPreview()
    }
  }, [clearDraftPreview])

  const getPointFromPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, preferCachedBounds = false): PointerPoint => {
      const pointerLayer = pointerLayerRef.current
      if (!pointerLayer) {
        return normalizePointerPoint(0, 0, event.pressure)
      }

      const bounds =
        preferCachedBounds && pointerBoundsRef.current
          ? pointerBoundsRef.current
          : pointerLayer.getBoundingClientRect()
      pointerBoundsRef.current = bounds

      return getCanvasPointFromClient(
        event.clientX,
        event.clientY,
        bounds,
        dimensions,
        event.pressure
      )
    },
    [dimensions.height, dimensions.width]
  )

  const paintToolCursor = useCallback(
    (point: PointerPoint) => {
      const cursorGroup = cursorGroupRef.current
      if (!cursorGroup) {
        return
      }

      if (activeTool === 'eraser') {
        const radius = brushSize / 2
        cursorGroup.style.display = 'block'
        setCircleGeometry(eraserHaloRef.current, point, radius)
        setCircleGeometry(eraserOutlineRef.current, point, radius)
        return
      }

      cursorGroup.style.display = 'none'
    },
    [activeTool, brushSize]
  )

  const updateToolCursor = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canDraw) {
        hideToolCursor()
        return null
      }

      const point = getPointFromPointer(event, activePointerRef.current === event.pointerId)
      paintToolCursor(point)

      return point
    },
    [canDraw, getPointFromPointer, hideToolCursor, paintToolCursor]
  )

  const ensureDraftEraserPath = useCallback(() => {
    if (draftEraserPathRef.current) {
      return draftEraserPathRef.current
    }

    const context = renderContextRef.current
    const layerGroup = layerGroupsRef.current.get(strokeLayerIdRef.current)
    if (!context || !layerGroup) {
      return null
    }

    const draftEraserPath = new context.Path({
      path: '',
      fill: '#000000',
      eraser: 'path',
      editable: false,
      draggable: false,
      hittable: false,
      hitFill: 'none',
      visible: false
    }) as MutableDraftEraserPath

    layerGroup.add(draftEraserPath)
    draftEraserPathRef.current = draftEraserPath

    return draftEraserPath
  }, [])

  const updateDraftPreview = useCallback(
    (nextPoints: PointerPoint[]) => {
      pendingDraftPointsRef.current = nextPoints

      if (draftFrameRef.current !== null) {
        return
      }

      draftFrameRef.current = window.requestAnimationFrame(() => {
        draftFrameRef.current = null

        const path = createSmoothStrokePath(pendingDraftPointsRef.current, brushSize)

        if (activeTool === 'eraser') {
          const draftEraserPath = ensureDraftEraserPath()
          if (draftEraserPath) {
            draftEraserPath.path = path
            draftEraserPath.visible = Boolean(path)
          }
          return
        }

        const draftPath = draftPathRef.current
        if (!draftPath) {
          return
        }

        if (!path) {
          draftPath.removeAttribute('d')
          draftPath.style.display = 'none'
          return
        }

        draftPath.setAttribute('d', path)
        draftPath.setAttribute('fill', color)
        draftPath.style.display = 'block'
      })
    },
    [activeTool, brushSize, color, ensureDraftEraserPath]
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canDraw) {
        return
      }

      event.preventDefault()
      pointerBoundsRef.current = event.currentTarget.getBoundingClientRect()
      activePointerRef.current = event.pointerId
      const point = updateToolCursor(event)
      if (!point) {
        activePointerRef.current = null
        return
      }

      const canvasPoint = { x: point[0], y: point[1] }
      const eraserHit =
        activeTool === 'eraser'
          ? getTopmostEditableCanvasObjectAtPoint(
              canvasPoint,
              layersRef.current,
              assetsRef.current,
              strokesRef.current,
              objectOffsetsRef.current,
              assetTransformsRef.current
            )
          : null
      const nextStrokeLayerId = eraserHit?.layerId ?? activeLayerId
      strokeLayerIdRef.current = nextStrokeLayerId
      if (eraserHit && eraserHit.layerId !== activeLayerId) {
        onLayerSelectRef.current?.(eraserHit.layerId)
      }

      event.currentTarget.setPointerCapture?.(event.pointerId)
      pointsRef.current = [point]
      updateDraftPreview(pointsRef.current)
    },
    [activeLayerId, activeTool, canDraw, updateDraftPreview, updateToolCursor]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const point = updateToolCursor(event)
      if (activePointerRef.current !== event.pointerId) {
        return
      }

      if (!point) {
        return
      }

      if (shouldAppendPoint(pointsRef.current, point, brushSize)) {
        pointsRef.current.push(point)
        updateDraftPreview(pointsRef.current)
      }
    },
    [brushSize, updateDraftPreview, updateToolCursor]
  )

  const finishStroke = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (activePointerRef.current !== event.pointerId) {
        return
      }

      updateToolCursor(event)
      const finalPath = createSmoothStrokePath(pointsRef.current, brushSize)
      const committedStroke: CanvasStroke = {
        id: crypto.randomUUID(),
        layerId: strokeLayerIdRef.current,
        color,
        size: brushSize,
        path: finalPath,
        tool: activeTool === 'eraser' ? 'eraser' : 'brush',
        points: [...pointsRef.current]
      }

      activePointerRef.current = null
      strokeLayerIdRef.current = activeLayerId
      pointsRef.current = []
      clearDraftPreview()

      if (finalPath) {
        onStrokeCommit(committedStroke)
      }
    },
    [activeLayerId, activeTool, brushSize, clearDraftPreview, color, onStrokeCommit, updateToolCursor]
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

  const rememberSelectionPoint = useCallback(
    (clientX: number, clientY: number, pressure?: number) => {
      if (activeTool !== 'select') {
        return
      }

      const stage = stageRef.current
      if (!stage) {
        selectionPointRef.current = null
        return
      }

      const point = getCanvasPointFromClient(
        clientX,
        clientY,
        stage.getBoundingClientRect(),
        dimensions,
        pressure
      )
      selectionPointRef.current = { x: point[0], y: point[1] }
    },
    [activeTool, dimensions]
  )

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }

    const handlePointerEvent = (event: PointerEvent) => {
      rememberSelectionPoint(event.clientX, event.clientY, event.pressure)
    }

    stage.addEventListener('pointerdown', handlePointerEvent, true)
    stage.addEventListener('pointermove', handlePointerEvent, true)

    return () => {
      stage.removeEventListener('pointerdown', handlePointerEvent, true)
      stage.removeEventListener('pointermove', handlePointerEvent, true)
    }
  }, [rememberSelectionPoint])

  const handleStagePointerCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      rememberSelectionPoint(event.clientX, event.clientY, event.pressure)
    },
    [rememberSelectionPoint]
  )

  const setMultiSelectionOutlineOffset = useCallback((offset: CanvasPoint | null) => {
    const outline = multiSelectionOutlineRef.current
    if (!outline) {
      return
    }

    if (!offset || (offset.x === 0 && offset.y === 0)) {
      outline.removeAttribute('transform')
      return
    }

    outline.setAttribute('transform', `translate(${offset.x} ${offset.y})`)
  }, [])

  const moveCanvasTargetsByDelta = useCallback((targets: CanvasObjectTarget[], delta: CanvasPoint) => {
    if (delta.x === 0 && delta.y === 0) {
      return
    }

    const movedKeys = new Set<string>()

    for (const target of targets) {
      const key = getObjectKey(target.kind, target.id)
      if (movedKeys.has(key)) {
        continue
      }
      movedKeys.add(key)

      const offset = objectOffsetsRef.current.get(key) ?? { x: 0, y: 0 }
      objectOffsetsRef.current.set(key, {
        x: offset.x + delta.x,
        y: offset.y + delta.y
      })

      if (target.kind === 'asset') {
        const asset = assetsRef.current.find((item) => item.id === target.id)
        const currentTransform = assetTransformsRef.current.get(target.id)

        if (asset && currentTransform) {
          assetTransformsRef.current.set(target.id, {
            ...currentTransform,
            x: currentTransform.x + delta.x,
            y: currentTransform.y + delta.y
          })
        }
      }

      const node = canvasObjectNodesRef.current.get(key)
      if (node) {
        const mutableNode = node as LeaferBox & { x?: number; y?: number }
        const nodeBounds = getCanvasNodeBounds(node)
        mutableNode.x = getFiniteNumber(mutableNode.x ?? Number.NaN, nodeBounds.x ?? 0) + delta.x
        mutableNode.y = getFiniteNumber(mutableNode.y ?? Number.NaN, nodeBounds.y ?? 0) + delta.y
      }
    }
  }, [])

  const finishMultiSelectionDrag = useCallback(
    (pointerId: number) => {
      const dragState = multiSelectionDragRef.current
      if (!dragState || dragState.pointerId !== pointerId) {
        return false
      }

      const stage = stageRef.current
      if (stage?.hasPointerCapture?.(pointerId)) {
        stage.releasePointerCapture?.(pointerId)
      }

      multiSelectionDragRef.current = null
      setMultiSelectionOutlineOffset(null)

      if (dragState.totalDelta.x !== 0 || dragState.totalDelta.y !== 0) {
        setRenderReadyVersion((version) => version + 1)
      }

      return true
    },
    [setMultiSelectionOutlineOffset]
  )

  const clearBoxSelectionInteraction = useCallback(() => {
    const pointerId = boxSelectPointerRef.current
    const stage = stageRef.current
    if (pointerId !== null && stage?.hasPointerCapture?.(pointerId)) {
      stage.releasePointerCapture?.(pointerId)
    }

    boxSelectPointerRef.current = null
    boxSelectStartRef.current = null
    boxSelectCurrentRef.current = null
    isBoxSelectingRef.current = false
    setSelectionBox(null)
  }, [])

  const getCanvasPointFromStagePointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): CanvasPoint | null => {
      const stage = stageRef.current
      if (!stage) {
        return null
      }

      const point = getCanvasPointFromClient(
        event.clientX,
        event.clientY,
        stage.getBoundingClientRect(),
        dimensions,
        event.pressure
      )

      return { x: point[0], y: point[1] }
    },
    [dimensions]
  )

  const finishBoxSelection = useCallback(
    (pointerId: number, clientX: number, clientY: number, pressure?: number) => {
      if (boxSelectPointerRef.current !== pointerId) {
        return false
      }

      const wasBoxSelecting = isBoxSelectingRef.current
      const startPoint = boxSelectStartRef.current
      const stage = stageRef.current
      const pointerPoint =
        stage && startPoint
          ? getCanvasPointFromClient(clientX, clientY, stage.getBoundingClientRect(), dimensions, pressure)
          : null
      const currentPoint = pointerPoint
        ? { x: pointerPoint[0], y: pointerPoint[1] }
        : boxSelectCurrentRef.current
      if (stage?.hasPointerCapture?.(pointerId)) {
        stage.releasePointerCapture?.(pointerId)
      }
      boxSelectPointerRef.current = null
      boxSelectStartRef.current = null
      boxSelectCurrentRef.current = null
      isBoxSelectingRef.current = false
      setSelectionBox(null)

      if (!wasBoxSelecting || !startPoint || !currentPoint) {
        return false
      }

      const selectedTargets = getSelectableCanvasObjectsInBounds(
        normalizeCanvasBounds(startPoint, currentPoint),
        layersRef.current,
        assetsRef.current,
        strokesRef.current,
        objectOffsetsRef.current,
        assetTransformsRef.current
      )

      if (selectedTargets.length < 2) {
        multiSelectedObjectTargetsRef.current = []
      }
      updateSelectedObjectTargets(selectedTargets)
      renderContextRef.current?.app.editor.cancel?.()

      if (selectedTargets.length === 1) {
        const layerId = getLayerIdForCanvasObject(selectedTargets[0], assetsRef.current, strokesRef.current)
        if (layerId) {
          activeObjectTargetRef.current = selectedTargets[0]
          onLayerSelectRef.current?.(layerId)
          onObjectSelectRef.current?.(selectedTargets[0], layerId)
        }
      }

      return true
    },
    [dimensions, updateSelectedObjectTargets]
  )

  const updateBoxSelectionDrag = useCallback(
    (pointerId: number, currentPoint: CanvasPoint) => {
      const startPoint = boxSelectStartRef.current
      if (boxSelectPointerRef.current !== pointerId || !startPoint) {
        return false
      }

      boxSelectCurrentRef.current = currentPoint

      if (!isBoxSelectingRef.current) {
        isBoxSelectingRef.current = true
        stageRef.current?.setPointerCapture?.(pointerId)
        renderContextRef.current?.app.editor.cancel?.()
        setContextMenu(null)
        updateSelectedObjectTargets([])
      }

      setSelectionBox({
        start: startPoint,
        current: currentPoint
      })

      return true
    },
    [updateSelectedObjectTargets]
  )

  const handleStagePointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isCanvasContextMenuEvent(event.nativeEvent)) {
        return
      }

      handleStagePointerCapture(event)

      if (activeTool !== 'select') {
        return
      }

      if (event.button > 0) {
        event.stopPropagation()
        return
      }

      const startPoint = getCanvasPointFromStagePointer(event)
      if (!startPoint) {
        return
      }

      const selectedTargets = selectedObjectTargetsRef.current
      const stageBounds = event.currentTarget.getBoundingClientRect()
      if (
        isPointNearSingleAssetResizeHandle(
          startPoint,
          selectedTargets,
          layersRef.current,
          assetsRef.current,
          strokesRef.current,
          objectOffsetsRef.current,
          assetTransformsRef.current,
          getCanvasHitRadiusFromStageBounds(dimensions, stageBounds)
        )
      ) {
        clearBoxSelectionInteraction()
        return
      }

      const selectedGroupBounds =
        selectedTargets.length > 1
          ? getCanvasTargetsUnionBounds(
              selectedTargets,
              layersRef.current,
              assetsRef.current,
              strokesRef.current,
              objectOffsetsRef.current,
              assetTransformsRef.current
            )
          : null
      const hit = getTopmostEditableCanvasObjectAtPoint(
        startPoint,
        layersRef.current,
        assetsRef.current,
        strokesRef.current,
        objectOffsetsRef.current,
        assetTransformsRef.current
      )

      const hitIsSelected = hit
        ? selectedTargets.some((target) => areCanvasTargetsEqual(target, hit.target))
        : false

      if (
        selectedTargets.length > 1 &&
        selectedGroupBounds &&
        isPointInsideBounds(startPoint, selectedGroupBounds) &&
        (!hit || hitIsSelected)
      ) {
        clearBoxSelectionInteraction()
        multiSelectionDragRef.current = {
          pointerId: event.pointerId,
          lastPoint: startPoint,
          totalDelta: { x: 0, y: 0 },
          targets: selectedTargets
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        renderContextRef.current?.app.editor.cancel?.()
        setContextMenu(null)
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (hit) {
        clearBoxSelectionInteraction()
        return
      }

      boxSelectStartRef.current = startPoint
      boxSelectCurrentRef.current = startPoint
      boxSelectPointerRef.current = event.pointerId
      isBoxSelectingRef.current = false
    },
    [
      activeTool,
      clearBoxSelectionInteraction,
      dimensions,
      getCanvasPointFromStagePointer,
      handleStagePointerCapture,
      updateSelectedObjectTargets
    ]
  )

  const handleStagePointerMoveCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isCanvasContextMenuEvent(event.nativeEvent)) {
        return
      }

      handleStagePointerCapture(event)

      const multiDragState = multiSelectionDragRef.current
      if (multiDragState && multiDragState.pointerId === event.pointerId) {
        if (event.buttons === 0) {
          finishMultiSelectionDrag(event.pointerId)
          return
        }

        const currentPoint = getCanvasPointFromStagePointer(event)
        if (!currentPoint) {
          return
        }

        const delta = {
          x: currentPoint.x - multiDragState.lastPoint.x,
          y: currentPoint.y - multiDragState.lastPoint.y
        }

        if (delta.x !== 0 || delta.y !== 0) {
          moveCanvasTargetsByDelta(multiDragState.targets, delta)
          multiDragState.lastPoint = currentPoint
          multiDragState.totalDelta = {
            x: multiDragState.totalDelta.x + delta.x,
            y: multiDragState.totalDelta.y + delta.y
          }
          setMultiSelectionOutlineOffset(multiDragState.totalDelta)
        }

        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (boxSelectPointerRef.current !== event.pointerId || !boxSelectStartRef.current) {
        return
      }

      if (event.buttons === 0) {
        clearBoxSelectionInteraction()
        return
      }

      const currentPoint = getCanvasPointFromStagePointer(event)
      if (!currentPoint) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      updateBoxSelectionDrag(event.pointerId, currentPoint)
    },
    [
      clearBoxSelectionInteraction,
      finishMultiSelectionDrag,
      getCanvasPointFromStagePointer,
      handleStagePointerCapture,
      moveCanvasTargetsByDelta,
      setMultiSelectionOutlineOffset,
      updateBoxSelectionDrag
    ]
  )

  const handleStagePointerUpCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isCanvasContextMenuEvent(event.nativeEvent)) {
        return
      }

      handleStagePointerCapture(event)

      if (finishMultiSelectionDrag(event.pointerId)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (finishBoxSelection(event.pointerId, event.clientX, event.clientY, event.pressure)) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    [finishBoxSelection, finishMultiSelectionDrag, handleStagePointerCapture]
  )

  useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      if (boxSelectPointerRef.current !== event.pointerId || !boxSelectStartRef.current) {
        return
      }

      if (event.buttons === 0) {
        clearBoxSelectionInteraction()
        return
      }

      const stage = stageRef.current
      if (!stage) {
        return
      }

      const point = getCanvasPointFromClient(
        event.clientX,
        event.clientY,
        stage.getBoundingClientRect(),
        dimensions,
        event.pressure
      )
      const currentPoint = { x: point[0], y: point[1] }
      updateBoxSelectionDrag(event.pointerId, currentPoint)
    }
    const handleWindowPointerDone = (event: PointerEvent) => {
      if (finishMultiSelectionDrag(event.pointerId)) {
        return
      }

      finishBoxSelection(event.pointerId, event.clientX, event.clientY, event.pressure)
    }
    const handleWindowBlur = () => {
      const dragState = multiSelectionDragRef.current
      if (dragState) {
        finishMultiSelectionDrag(dragState.pointerId)
      }

      clearBoxSelectionInteraction()
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerDone)
    window.addEventListener('pointercancel', handleWindowPointerDone)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerDone)
      window.removeEventListener('pointercancel', handleWindowPointerDone)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [
    clearBoxSelectionInteraction,
    dimensions,
    finishBoxSelection,
    finishMultiSelectionDrag,
    updateBoxSelectionDrag
  ])

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
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
})

function groupItemsByLayer<TItem extends { layerId: string }>(items: TItem[]): Map<string, TItem[]> {
  const groupedItems = new Map<string, TItem[]>()

  for (const item of items) {
    const layerItems = groupedItems.get(item.layerId)
    if (layerItems) {
      layerItems.push(item)
    } else {
      groupedItems.set(item.layerId, [item])
    }
  }

  return groupedItems
}

function fitLeaferCanvasToHost(app: LeaferApp): void {
  const canvasView = app.canvas?.view as HTMLElement | undefined
  if (!canvasView) {
    return
  }

  canvasView.style.width = '100%'
  canvasView.style.height = '100%'
  canvasView.style.maxWidth = '100%'
  canvasView.style.maxHeight = '100%'
}

function createViewportScreenshotFilename(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

  return `nomi-whiteboard-${timestamp}.png`
}

async function exportViewportWithoutEditorOverlays(app: LeaferApp, filename: string) {
  const editor = app.editor as LeaferEditorOverlay | undefined
  const overlayState = hideEditorOverlays(editor)

  try {
    return await app.export(filename, {
      screenshot: true,
      pixelRatio: getViewportScreenshotPixelRatio()
    })
  } finally {
    restoreEditorOverlays(editor, overlayState)
  }
}

async function exportViewportFileWithoutEditorOverlays(app: LeaferApp, filename: string): Promise<File> {
  const editor = app.editor as LeaferEditorOverlay | undefined
  const overlayState = hideEditorOverlays(editor)

  try {
    const result = await app.export('png', {
      blob: true,
      screenshot: true,
      pixelRatio: getViewportScreenshotPixelRatio()
    })

    if (result.error) {
      throw result.error instanceof Error ? result.error : new Error('截图失败')
    }

    if (!(result.data instanceof Blob)) {
      throw new Error('截图失败')
    }

    return new File([result.data], ensurePngFilename(filename), {
      type: result.data.type || 'image/png'
    })
  } finally {
    restoreEditorOverlays(editor, overlayState)
  }
}

function hideEditorOverlays(editor: LeaferEditorOverlay | undefined): LeaferEditorOverlayState {
  if (!editor) {
    return {}
  }

  const state = {
    visible: editor.visible
  }

  editor.visible = false

  return state
}

function restoreEditorOverlays(editor: LeaferEditorOverlay | undefined, state: LeaferEditorOverlayState): void {
  if (!editor) {
    return
  }

  editor.visible = state.visible
}

function getViewportScreenshotPixelRatio(): number {
  return Math.max(1, Math.min(2, window.devicePixelRatio || 1))
}

function ensurePngFilename(filename: string): string {
  return /\.png$/i.test(filename) ? filename : `${filename}.png`
}

function getObjectKey(kind: CanvasObjectKind, id: string): string {
  return `${kind}:${id}`
}

function getObjectFlipState(
  flips: Map<string, CanvasObjectFlipState>,
  target: CanvasObjectTarget
): CanvasObjectFlipState {
  return flips.get(getObjectKey(target.kind, target.id)) ?? { x: false, y: false }
}

function getFlippedContentGroupProps(
  bounds: CanvasObjectBounds,
  flipState: CanvasObjectFlipState
): Record<string, unknown> {
  return {
    x: flipState.x ? bounds.width : 0,
    y: flipState.y ? bounds.height : 0,
    scaleX: flipState.x ? -1 : 1,
    scaleY: flipState.y ? -1 : 1,
    editable: false,
    draggable: false,
    hittable: false
  }
}

function getKeyboardMoveDelta(key: string, step: number): CanvasPoint | null {
  switch (key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 }
    case 'ArrowRight':
      return { x: step, y: 0 }
    case 'ArrowUp':
      return { x: 0, y: -step }
    case 'ArrowDown':
      return { x: 0, y: step }
    default:
      return null
  }
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName.toLowerCase()
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

function isCanvasContextMenuEvent(event?: PointerEvent): boolean {
  if (!event) {
    return false
  }

  for (const target of event.composedPath()) {
    if (target instanceof HTMLElement && target.dataset.canvasContextMenu === 'true') {
      return true
    }
  }

  return false
}

function getObjectOffset(
  offsets: Map<string, CanvasObjectOffset>,
  kind: CanvasObjectKind,
  id: string
): CanvasObjectOffset {
  return offsets.get(getObjectKey(kind, id)) ?? { x: 0, y: 0 }
}

function getLayerIdForCanvasObject(
  target: CanvasObjectTarget,
  assets: CanvasAsset[],
  strokes: CanvasStroke[]
): string | null {
  if (target.kind === 'asset') {
    return assets.find((asset) => asset.id === target.id)?.layerId ?? null
  }

  if (target.kind === 'group') {
    return target.id
  }

  return strokes.find((stroke) => stroke.id === target.id)?.layerId ?? null
}

function getAssetRenderBounds(
  asset: CanvasAsset,
  offsets: Map<string, CanvasObjectOffset>,
  transforms: Map<string, CanvasAssetTransform>
): CanvasObjectBounds {
  const transformedBounds = transforms.get(asset.id)

  if (transformedBounds) {
    return normalizeAssetBounds(transformedBounds)
  }

  const offset = getObjectOffset(offsets, 'asset', asset.id)

  return normalizeAssetBounds({
    x: asset.x + offset.x,
    y: asset.y + offset.y,
    width: asset.width,
    height: asset.height
  })
}

function normalizeAssetBounds(bounds: CanvasObjectBounds): CanvasObjectBounds {
  return {
    x: getFiniteNumber(bounds.x, 0),
    y: getFiniteNumber(bounds.y, 0),
    width: Math.max(MIN_ASSET_SIZE, getFiniteNumber(bounds.width, MIN_ASSET_SIZE)),
    height: Math.max(MIN_ASSET_SIZE, getFiniteNumber(bounds.height, MIN_ASSET_SIZE))
  }
}

function getSnappedCanvasMove({
  target,
  x,
  y,
  dimensions,
  layers,
  assets,
  strokes,
  offsets,
  assetTransforms,
  onSnapGuides
}: {
  target?: unknown
  x: number
  y: number
  dimensions: CanvasDimensions
  layers: LayerItem[]
  assets: CanvasAsset[]
  strokes: CanvasStroke[]
  offsets: Map<string, CanvasObjectOffset>
  assetTransforms: Map<string, CanvasAssetTransform>
  onSnapGuides?: (guides: SnapGuide[]) => void
}): CanvasPoint | true {
  const objectTarget = getCanvasObjectTarget(target)

  if (!objectTarget || (objectTarget.kind !== 'asset' && objectTarget.kind !== 'group') || !Number.isFinite(x) || !Number.isFinite(y)) {
    onSnapGuides?.([])
    return true
  }

  const bounds = getCanvasObjectRenderBounds(objectTarget, layers, assets, strokes, offsets, assetTransforms)
  if (!bounds) {
    onSnapGuides?.([])
    return true
  }

  const guides = getSnapGuides(objectTarget, dimensions, layers, assets, strokes, offsets, assetTransforms)
  const snapX = getNearestSnapDelta(getBoundsVerticalLines({ ...bounds, x: bounds.x + x }), guides.vertical)
  const snapY = getNearestSnapDelta(getBoundsHorizontalLines({ ...bounds, y: bounds.y + y }), guides.horizontal)
  const activeGuides: SnapGuide[] = []

  if (snapX.matched) {
    activeGuides.push({ axis: 'x', position: snapX.guide })
  }

  if (snapY.matched) {
    activeGuides.push({ axis: 'y', position: snapY.guide })
  }

  onSnapGuides?.(activeGuides)

  return {
    x: x + snapX.delta,
    y: y + snapY.delta
  }
}

function getMinimumAssetScale(
  target: unknown,
  scaleX = 1,
  scaleY = scaleX,
  transforms: Map<string, CanvasAssetTransform>,
  assets: CanvasAsset[]
): { scaleX: number; scaleY: number } | true {
  const objectTarget = getCanvasObjectTarget(target)

  if (objectTarget?.kind !== 'asset') {
    return true
  }

  const asset = assets.find((item) => item.id === objectTarget.id)
  if (!asset) {
    return true
  }

  const bounds = transforms.get(asset.id) ?? { x: asset.x, y: asset.y, width: asset.width, height: asset.height }
  const nextWidth = bounds.width * Math.abs(scaleX)
  const nextHeight = bounds.height * Math.abs(scaleY)

  if (nextWidth >= MIN_ASSET_SIZE && nextHeight >= MIN_ASSET_SIZE) {
    return true
  }

  const scale = Math.max(MIN_ASSET_SIZE / bounds.width, MIN_ASSET_SIZE / bounds.height)

  return {
    scaleX: scaleX < 0 ? -scale : scale,
    scaleY: scaleY < 0 ? -scale : scale
  }
}

function getCanvasObjectRenderBounds(
  target: CanvasObjectTarget,
  layers: LayerItem[],
  assets: CanvasAsset[],
  strokes: CanvasStroke[],
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>
): CanvasObjectBounds | null {
  if (target.kind === 'asset') {
    const asset = assets.find((item) => item.id === target.id)
    return asset ? getAssetRenderBounds(asset, offsets, assetTransforms) : null
  }

  if (target.kind === 'stroke') {
    const stroke = strokes.find((item) => item.id === target.id && item.tool !== 'eraser')
    const bounds = stroke ? getSvgPathBounds(stroke.path) : null
    if (!stroke || !bounds) {
      return null
    }

    const offset = getObjectOffset(offsets, 'stroke', stroke.id)
    return {
      ...bounds,
      x: bounds.x + offset.x,
      y: bounds.y + offset.y
    }
  }

  const layer = layers.find((item) => item.id === target.id)
  if (!layer) {
    return null
  }

  const assetsByLayer = groupItemsByLayer(assets)
  const strokesByLayer = groupItemsByLayer(strokes)
  const baseBounds = getLayerBaseBounds(target.id, assetsByLayer, strokesByLayer, offsets, assetTransforms)
  if (!baseBounds) {
    return null
  }

  const groupOffset = getObjectOffset(offsets, 'group', target.id)
  return {
    ...baseBounds,
    x: baseBounds.x + groupOffset.x,
    y: baseBounds.y + groupOffset.y
  }
}

function getLayerBaseBounds(
  layerId: string,
  assetsByLayer: Map<string, CanvasAsset[]>,
  strokesByLayer: Map<string, CanvasStroke[]>,
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>
): CanvasObjectBounds | null {
  const childBounds: CanvasObjectBounds[] = []

  for (const asset of assetsByLayer.get(layerId) ?? []) {
    childBounds.push(getAssetRenderBounds(asset, offsets, assetTransforms))
  }

  for (const stroke of strokesByLayer.get(layerId) ?? []) {
    if (stroke.tool === 'eraser') {
      continue
    }

    const bounds = getSvgPathBounds(stroke.path)
    if (!bounds) {
      continue
    }

    const offset = getObjectOffset(offsets, 'stroke', stroke.id)
    childBounds.push({
      ...bounds,
      x: bounds.x + offset.x,
      y: bounds.y + offset.y
    })
  }

  return getUnionBounds(childBounds)
}

function getCanvasTargetsUnionBounds(
  targets: CanvasObjectTarget[],
  layers: LayerItem[],
  assets: CanvasAsset[],
  strokes: CanvasStroke[],
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>
): CanvasObjectBounds | null {
  return getUnionBounds(
    targets
      .map((target) => getCanvasObjectRenderBounds(target, layers, assets, strokes, offsets, assetTransforms))
      .filter((bounds): bounds is CanvasObjectBounds => Boolean(bounds))
  )
}

function getCanvasHitRadiusFromStageBounds(dimensions: CanvasDimensions, stageBounds: DOMRect): number {
  const scaleX = stageBounds.width > 0 ? stageBounds.width / dimensions.width : 1
  const scaleY = stageBounds.height > 0 ? stageBounds.height / dimensions.height : 1
  const canvasScale = Math.min(scaleX || 1, scaleY || 1)

  return EDITOR_RESIZE_HANDLE_HIT_RADIUS_PX / canvasScale
}

function isPointNearSingleAssetResizeHandle(
  point: CanvasPoint,
  selectedTargets: CanvasObjectTarget[],
  layers: LayerItem[],
  assets: CanvasAsset[],
  strokes: CanvasStroke[],
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>,
  hitRadius: number
): boolean {
  const selectedTarget = selectedTargets[0]
  if (selectedTargets.length !== 1 || selectedTarget?.kind !== 'asset') {
    return false
  }

  const bounds = getCanvasTargetsUnionBounds([selectedTarget], layers, assets, strokes, offsets, assetTransforms)
  if (!bounds) {
    return false
  }

  const handlePoints = getResizeHandlePoints(bounds)
  const hitRadiusSquared = hitRadius * hitRadius

  return handlePoints.some((handlePoint) => getCanvasPointDistanceSquared(point, handlePoint) <= hitRadiusSquared)
}

function getResizeHandlePoints(bounds: CanvasObjectBounds): CanvasPoint[] {
  const left = bounds.x
  const centerX = bounds.x + bounds.width / 2
  const right = bounds.x + bounds.width
  const top = bounds.y
  const centerY = bounds.y + bounds.height / 2
  const bottom = bounds.y + bounds.height

  return [
    { x: left, y: top },
    { x: centerX, y: top },
    { x: right, y: top },
    { x: right, y: centerY },
    { x: right, y: bottom },
    { x: centerX, y: bottom },
    { x: left, y: bottom },
    { x: left, y: centerY }
  ]
}

function getCanvasPointDistanceSquared(first: CanvasPoint, second: CanvasPoint): number {
  const deltaX = first.x - second.x
  const deltaY = first.y - second.y

  return deltaX * deltaX + deltaY * deltaY
}

function getSelectableCanvasObjectsInBounds(
  bounds: CanvasObjectBounds,
  layers: LayerItem[],
  assets: CanvasAsset[],
  strokes: CanvasStroke[],
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>
): CanvasObjectTarget[] {
  const assetsByLayer = groupItemsByLayer(assets)
  const strokesByLayer = groupItemsByLayer(strokes)
  const selectedTargets: CanvasObjectTarget[] = []

  for (const layer of layers) {
    if (layer.kind === 'background' || !layer.visible || layer.locked) {
      continue
    }

    const layerAssets = assetsByLayer.get(layer.id) ?? []
    const layerStrokes = strokesByLayer.get(layer.id) ?? []

    if (isCanvasGroupLayer(layer)) {
      const target = { kind: 'group', id: layer.id } as CanvasObjectTarget
      const groupBounds = getCanvasObjectRenderBounds(target, layers, assets, strokes, offsets, assetTransforms)
      if (groupBounds && doBoundsIntersect(bounds, groupBounds)) {
        selectedTargets.push(target)
      }
      continue
    }

    for (const asset of layerAssets) {
      const target = { kind: 'asset', id: asset.id } as CanvasObjectTarget
      const targetBounds = getCanvasObjectRenderBounds(target, layers, assets, strokes, offsets, assetTransforms)
      if (targetBounds && doBoundsIntersect(bounds, targetBounds)) {
        selectedTargets.push(target)
      }
    }

    for (const stroke of layerStrokes) {
      if (stroke.tool === 'eraser') {
        continue
      }

      const target = { kind: 'stroke', id: stroke.id } as CanvasObjectTarget
      const targetBounds = getCanvasObjectRenderBounds(target, layers, assets, strokes, offsets, assetTransforms)
      if (targetBounds && doBoundsIntersect(bounds, targetBounds)) {
        selectedTargets.push(target)
      }
    }
  }

  return selectedTargets
}

function getSnapGuides(
  target: CanvasObjectTarget,
  dimensions: CanvasDimensions,
  layers: LayerItem[],
  assets: CanvasAsset[],
  strokes: CanvasStroke[],
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>
): { vertical: number[]; horizontal: number[] } {
  const vertical = [0, dimensions.width / 2, dimensions.width]
  const horizontal = [0, dimensions.height / 2, dimensions.height]
  const visibleLayerIds = new Set(layers.filter((layer) => layer.visible).map((layer) => layer.id))

  for (const asset of assets) {
    if (target.kind === 'asset' && target.id === asset.id) {
      continue
    }

    if (target.kind === 'group' && asset.layerId === target.id) {
      continue
    }

    if (!visibleLayerIds.has(asset.layerId)) {
      continue
    }

    const bounds = getAssetRenderBounds(asset, offsets, assetTransforms)
    vertical.push(...getBoundsVerticalLines(bounds))
    horizontal.push(...getBoundsHorizontalLines(bounds))
  }

  for (const stroke of strokes) {
    if (stroke.tool === 'eraser' || !visibleLayerIds.has(stroke.layerId)) {
      continue
    }

    if (target.kind === 'group' && stroke.layerId === target.id) {
      continue
    }

    const bounds = getSvgPathBounds(stroke.path)
    if (!bounds) {
      continue
    }

    const offset = getObjectOffset(offsets, 'stroke', stroke.id)
    const transformedBounds = {
      ...bounds,
      x: bounds.x + offset.x,
      y: bounds.y + offset.y
    }

    vertical.push(...getBoundsVerticalLines(transformedBounds))
    horizontal.push(...getBoundsHorizontalLines(transformedBounds))
  }

  return { vertical, horizontal }
}

function getTopmostEditableCanvasObjectAtPoint(
  point: CanvasPoint,
  layers: LayerItem[],
  assets: CanvasAsset[],
  strokes: CanvasStroke[],
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>
): { target: CanvasObjectTarget; layerId: string } | null {
  const assetsByLayer = groupItemsByLayer(assets)
  const strokesByLayer = groupItemsByLayer(strokes)

  for (const layer of [...layers].reverse()) {
    if (layer.kind === 'background' || !layer.visible || layer.locked) {
      continue
    }

    const layerStrokes = strokesByLayer.get(layer.id) ?? []
    const layerAssets = assetsByLayer.get(layer.id) ?? []

    if (isCanvasGroupLayer(layer)) {
      const target: CanvasObjectTarget = { kind: 'group', id: layer.id }
      const bounds = getCanvasObjectRenderBounds(target, layers, assets, strokes, offsets, assetTransforms)

      if (bounds && isPointInsideBounds(point, bounds)) {
        return { target, layerId: layer.id }
      }

      continue
    }

    for (const stroke of [...layerStrokes].reverse()) {
      if (stroke.tool === 'eraser') {
        continue
      }

      const bounds = getSvgPathBounds(stroke.path)
      if (!bounds) {
        continue
      }

      const offset = getObjectOffset(offsets, 'stroke', stroke.id)
      const target: CanvasObjectTarget = { kind: 'stroke', id: stroke.id }
      const transformedBounds = {
        ...bounds,
        x: bounds.x + offset.x,
        y: bounds.y + offset.y
      }
      const isErasedAtPoint = shouldBlockErasedSelection(
        { canvasObjectKind: 'stroke', canvasObjectId: stroke.id },
        point,
        strokes,
        assets,
        offsets
      )

      if (isPointInsideBounds(point, transformedBounds) && !isErasedAtPoint) {
        return { target, layerId: layer.id }
      }
    }

    for (const asset of [...layerAssets].reverse()) {
      const bounds = getAssetRenderBounds(asset, offsets, assetTransforms)
      const target: CanvasObjectTarget = { kind: 'asset', id: asset.id }
      const isErasedAtPoint = shouldBlockErasedSelection(
        { canvasObjectKind: 'asset', canvasObjectId: asset.id },
        point,
        strokes,
        assets,
        offsets
      )

      if (isPointInsideBounds(point, bounds) && !isErasedAtPoint) {
        return { target, layerId: layer.id }
      }
    }
  }

  return null
}

function getBoundsVerticalLines(bounds: CanvasObjectBounds): number[] {
  return [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width]
}

function getUnionBounds(boundsList: CanvasObjectBounds[]): CanvasObjectBounds | null {
  if (boundsList.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const bounds of boundsList) {
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  }
}

function normalizeCanvasBounds(start: CanvasPoint, current: CanvasPoint): CanvasObjectBounds {
  const x = Math.min(start.x, current.x)
  const y = Math.min(start.y, current.y)

  return {
    x,
    y,
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y)
  }
}

function getSvgRectAttributes(bounds: CanvasObjectBounds): Pick<CanvasObjectBounds, 'x' | 'y' | 'width' | 'height'> {
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height)
  }
}

function isCanvasGroupLayer(layer: LayerItem): boolean {
  return layer.kind === 'group'
}

function doBoundsIntersect(first: CanvasObjectBounds, second: CanvasObjectBounds): boolean {
  return (
    first.x <= second.x + second.width &&
    first.x + first.width >= second.x &&
    first.y <= second.y + second.height &&
    first.y + first.height >= second.y
  )
}

function areCanvasTargetsEqual(first: CanvasObjectTarget, second: CanvasObjectTarget): boolean {
  return first.kind === second.kind && first.id === second.id
}

function areCanvasTargetArraysEqual(first: CanvasObjectTarget[], second: CanvasObjectTarget[]): boolean {
  if (first.length !== second.length) {
    return false
  }

  return first.every((target, index) => areCanvasTargetsEqual(target, second[index]))
}

function getActiveMultiSelectionTargets(
  selectedTargets: CanvasObjectTarget[],
  fallbackTargets: CanvasObjectTarget[]
): CanvasObjectTarget[] {
  return selectedTargets.length > 1 ? selectedTargets : fallbackTargets
}

function shouldBlockEditorTargetInteraction(
  target: unknown,
  selectedTargets: CanvasObjectTarget[],
  isBoxSelecting: boolean,
  isMultiSelectionDragging: boolean,
  shouldBlockSelection: (target: unknown) => boolean
): boolean {
  if (isBoxSelecting || isMultiSelectionDragging) {
    return true
  }

  const objectTarget = getCanvasObjectTarget(target)
  if (
    objectTarget &&
    selectedTargets.length > 1 &&
    selectedTargets.some((selectedTarget) => areCanvasTargetsEqual(selectedTarget, objectTarget))
  ) {
    return true
  }

  return shouldBlockSelection(target)
}

function getBoundsHorizontalLines(bounds: CanvasObjectBounds): number[] {
  return [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height]
}

function getNearestSnapDelta(lines: number[], guides: number[]): { delta: number; guide: number; matched: boolean } {
  let closestDelta = 0
  let closestGuide = 0
  let closestDistance = SNAP_DISTANCE + 1
  let matched = false

  for (const line of lines) {
    for (const guide of guides) {
      const delta = guide - line
      const distance = Math.abs(delta)

      if (distance <= SNAP_DISTANCE && distance < closestDistance) {
        closestDelta = delta
        closestGuide = guide
        closestDistance = distance
        matched = true
      }
    }
  }

  return {
    delta: closestDelta,
    guide: closestGuide,
    matched
  }
}

function getCanvasNodeBounds(target: unknown): Partial<CanvasObjectBounds> {
  return {
    x: getCanvasNodeNumber(target, 'x'),
    y: getCanvasNodeNumber(target, 'y'),
    width: getCanvasNodeNumber(target, 'width'),
    height: getCanvasNodeNumber(target, 'height')
  }
}

function getCanvasNodeInteractionState(target: unknown): CanvasNodeInteractionState {
  return {
    editable: getCanvasNodeProperty(target, 'editable'),
    draggable: getCanvasNodeProperty(target, 'draggable'),
    hittable: getCanvasNodeProperty(target, 'hittable'),
    hitFill: getCanvasNodeProperty(target, 'hitFill')
  }
}

function setCanvasNodeInteractionState(target: unknown, state: CanvasNodeInteractionState): void {
  if (!target || typeof target !== 'object') {
    return
  }

  const targetRecord = target as Record<string, unknown>
  const propsRecord =
    targetRecord.props && typeof targetRecord.props === 'object'
      ? (targetRecord.props as Record<string, unknown>)
      : null

  for (const [key, value] of Object.entries(state)) {
    targetRecord[key] = value
    if (propsRecord) {
      propsRecord[key] = value
    }
  }
}

function getCanvasNodeProperty(target: unknown, key: string): unknown {
  if (!target || typeof target !== 'object') {
    return undefined
  }

  const targetRecord = target as Record<string, unknown>
  const propsRecord =
    targetRecord.props && typeof targetRecord.props === 'object'
      ? (targetRecord.props as Record<string, unknown>)
      : null

  return targetRecord[key] ?? propsRecord?.[key]
}

function getCanvasNodeNumber(target: unknown, key: keyof CanvasObjectBounds): number | undefined {
  if (!target || typeof target !== 'object') {
    return undefined
  }

  const targetRecord = target as Record<string, unknown>
  const propsRecord =
    targetRecord.props && typeof targetRecord.props === 'object'
      ? (targetRecord.props as Record<string, unknown>)
      : null
  const value = targetRecord[key] ?? propsRecord?.[key]

  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getFiniteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function addCanvasObjectGroup(
  layerGroup: LeaferGroup,
  objectGroup: LeaferBox,
  object: {
    kind: CanvasObjectKind
    id: string
    bounds: CanvasObjectBounds
  },
  baseNode: LeaferBoxChild,
  eraserStrokes: CanvasStroke[],
  Group: LeaferUiModule['Group'],
  Path: LeaferUiModule['Path'],
  flipState: CanvasObjectFlipState,
  offsets: Map<string, CanvasObjectOffset>,
  pathTools: LeaferPathTools
): void {
  const contentGroup = new Group(getFlippedContentGroupProps(object.bounds, flipState))

  contentGroup.add(baseNode)

  for (const eraserStroke of eraserStrokes) {
    if (!eraserStroke.path) {
      continue
    }

    const eraserOffset = getObjectOffset(offsets, 'stroke', eraserStroke.id)
    contentGroup.add(
      new Path({
        x: eraserOffset.x,
        y: eraserOffset.y,
        path: translatePathToLocal(eraserStroke.path, object.bounds, pathTools),
        fill: '#000000',
        eraser: 'path',
        editable: false,
        draggable: false,
        hittable: false,
        hitFill: 'none',
        canvasObjectKind: 'stroke',
        canvasObjectId: eraserStroke.id,
        canvasEraserTargetKind: object.kind,
        canvasEraserTargetId: object.id
      })
    )
  }

  objectGroup.add(contentGroup)
  layerGroup.add(objectGroup)
}

function setCircleGeometry(circle: SVGCircleElement | null, point: PointerPoint, radius: number): void {
  if (!circle) {
    return
  }

  circle.setAttribute('cx', String(point[0]))
  circle.setAttribute('cy', String(point[1]))
  circle.setAttribute('r', String(radius))
}

function shouldAppendPoint(points: PointerPoint[], point: PointerPoint, brushSize: number): boolean {
  const previousPoint = points.at(-1)
  if (!previousPoint) {
    return true
  }

  const minimumDistance = Math.max(0.75, brushSize * 0.012)
  const deltaX = point[0] - previousPoint[0]
  const deltaY = point[1] - previousPoint[1]

  return deltaX * deltaX + deltaY * deltaY >= minimumDistance * minimumDistance
}

function shouldBlockErasedSelection(
  target: unknown,
  selectionPoint: CanvasPoint | null,
  strokes: CanvasStroke[],
  assets: CanvasAsset[],
  offsets: Map<string, CanvasObjectOffset>
): boolean {
  if (!selectionPoint) {
    return false
  }

  if (Array.isArray(target)) {
    return target.some((item) => shouldBlockErasedSelection(item, selectionPoint, strokes, assets, offsets))
  }

  const objectTarget = getCanvasObjectTarget(target)
  if (!objectTarget) {
    return false
  }

  if (objectTarget.kind === 'asset') {
    const asset = assets.find((item) => item.id === objectTarget.id)
    if (!asset) {
      return false
    }

    const assetOffset = getObjectOffset(offsets, 'asset', asset.id)
    return strokes.some(
      (stroke) =>
        stroke.layerId === asset.layerId &&
        stroke.tool === 'eraser' &&
        isPointInsideEraserStroke(selectionPoint, stroke, offsets, assetOffset)
    )
  }

  const targetStrokeIndex = strokes.findIndex((stroke) => stroke.id === objectTarget.id)
  const targetStroke = strokes[targetStrokeIndex]
  if (!targetStroke) {
    return false
  }

  if (targetStroke.tool === 'eraser') {
    return true
  }

  const targetOffset = getObjectOffset(offsets, 'stroke', targetStroke.id)
  return strokes
    .slice(targetStrokeIndex + 1)
    .some(
      (stroke) =>
        stroke.layerId === targetStroke.layerId &&
        stroke.tool === 'eraser' &&
        isPointInsideEraserStroke(selectionPoint, stroke, offsets, targetOffset)
    )
}

function getCanvasObjectTarget(target: unknown): CanvasObjectTarget | null {
  if (!target || typeof target !== 'object') {
    return null
  }

  const targetRecord = target as Record<string, unknown>
  const propsRecord =
    targetRecord.props && typeof targetRecord.props === 'object'
      ? (targetRecord.props as Record<string, unknown>)
      : null
  const kind = (targetRecord.canvasObjectKind ?? propsRecord?.canvasObjectKind ?? targetRecord.kind ?? propsRecord?.kind) as
    | CanvasObjectKind
    | undefined
  const id = (targetRecord.canvasObjectId ?? propsRecord?.canvasObjectId ?? targetRecord.id ?? propsRecord?.id) as
    | string
    | undefined

  if ((kind === 'asset' || kind === 'stroke' || kind === 'group') && id) {
    return { kind, id }
  }

  return null
}

function isPointInsideEraserStroke(
  point: CanvasPoint,
  stroke: CanvasStroke,
  offsets: Map<string, CanvasObjectOffset>,
  targetOffset: CanvasObjectOffset
): boolean {
  const eraserOffset = getObjectOffset(offsets, 'stroke', stroke.id)
  const localPoint = {
    x: point.x - targetOffset.x - eraserOffset.x,
    y: point.y - targetOffset.y - eraserOffset.y
  }

  if (stroke.points && stroke.points.length > 0) {
    return isPointNearPointerTrack(localPoint, stroke.points, stroke.size)
  }

  const pathBounds = getSvgPathBounds(stroke.path)
  return pathBounds ? isPointInsideBounds(localPoint, pathBounds) : false
}

function isPointNearPointerTrack(point: CanvasPoint, points: PointerPoint[], size: number): boolean {
  const hitRadius = Math.max(2, size / 2)

  if (points.length === 1) {
    return getDistanceSquared(point, points[0]) <= hitRadius * hitRadius
  }

  for (let index = 1; index < points.length; index += 1) {
    if (getDistanceToSegmentSquared(point, points[index - 1], points[index]) <= hitRadius * hitRadius) {
      return true
    }
  }

  return false
}

function getDistanceSquared(point: CanvasPoint, target: PointerPoint): number {
  const deltaX = point.x - target[0]
  const deltaY = point.y - target[1]

  return deltaX * deltaX + deltaY * deltaY
}

function getDistanceToSegmentSquared(point: CanvasPoint, start: PointerPoint, end: PointerPoint): number {
  const segmentX = end[0] - start[0]
  const segmentY = end[1] - start[1]
  const lengthSquared = segmentX * segmentX + segmentY * segmentY

  if (lengthSquared === 0) {
    return getDistanceSquared(point, start)
  }

  const rawT = ((point.x - start[0]) * segmentX + (point.y - start[1]) * segmentY) / lengthSquared
  const t = Math.min(1, Math.max(0, rawT))
  const projection: PointerPoint = [start[0] + t * segmentX, start[1] + t * segmentY, 0.5]

  return getDistanceSquared(point, projection)
}

function getSvgPathBounds(path: string): { x: number; y: number; width: number; height: number } | null {
  const values = path.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
  if (values.length < 2) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let index = 0; index < values.length - 1; index += 2) {
    const x = values[index]
    const y = values[index + 1]

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue
    }

    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  }
}

function translatePathToLocal(
  path: string,
  origin: Pick<CanvasObjectBounds, 'x' | 'y'>,
  tools: LeaferPathTools
): LeaferPathCommandData {
  const data = [...tools.PathConvert.parse(path)]
  translatePathCommandData(data, -origin.x, -origin.y, tools)

  return data
}

function translatePathCommandData(data: LeaferPathCommandData, deltaX: number, deltaY: number, tools: LeaferPathTools) {
  const { PathCommandMap, PathNumberCommandLengthMap } = tools
  const translatePair = (index: number) => {
    data[index] += deltaX
    data[index + 1] += deltaY
  }

  for (let index = 0; index < data.length; ) {
    const command = data[index]

    switch (command) {
      case PathCommandMap.M:
      case PathCommandMap.L:
        translatePair(index + 1)
        break
      case PathCommandMap.C:
        translatePair(index + 1)
        translatePair(index + 3)
        translatePair(index + 5)
        break
      case PathCommandMap.Q:
        translatePair(index + 1)
        translatePair(index + 3)
        break
      default:
        break
    }

    const commandLength = PathNumberCommandLengthMap[command]
    if (!commandLength) {
      break
    }

    index += commandLength
  }
}

function isPointInsideBounds(
  point: CanvasPoint,
  bounds: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  )
}
