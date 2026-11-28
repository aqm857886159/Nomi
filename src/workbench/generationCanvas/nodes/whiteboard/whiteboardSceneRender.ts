/* eslint-disable react-hooks/exhaustive-deps -- Imperative Leafer scene refs stay stable across pointer updates. */
import { useLayoutEffect, useState } from 'react'
import type { CanvasAsset, CanvasText, CanvasDimensions, LayerItem } from './lib/canvas'
import type {
  CanvasAssetTransform,
  CanvasObjectFlipState,
  CanvasObjectOffset,
  CanvasObjectTarget,
  CanvasStroke,
  LeaferBox,
  LeaferGroup,
  LeaferRenderContext,
  LeaferSceneContext,
  MutableDraftEraserPath,
  SceneTransforms,
} from './whiteboardCanvasTypes'
import { MIN_ASSET_SIZE } from './whiteboardCanvasTypes'
import {
  getAssetRenderBounds,
  getLayerBaseBounds,
  groupItemsByLayer,
  isCanvasGroupLayer,
} from './whiteboardCanvasGeometry'
import {
  addCanvasObjectGroup,
  getFlippedContentGroupProps,
  getObjectFlipState,
  getObjectKey,
  getObjectOffset,
  getSvgPathBounds,
  translatePathToLocal,
} from './whiteboardCanvasNodeOps'

type RefLike<T> = { current: T }

export type RenderWhiteboardSceneParams = {
  /** The editor's App context, or the one-off preview Leafer's (whiteboardStatePreview); the renderer only fills rootGroup. */
  context: LeaferSceneContext
  assets: CanvasAsset[]
  texts?: CanvasText[]
  strokes: CanvasStroke[]
  layers: LayerItem[]
  dimensions: CanvasDimensions
  objectOffsets: Map<string, CanvasObjectOffset>
  assetTransforms: Map<string, CanvasAssetTransform>
  objectFlipStates: Map<string, CanvasObjectFlipState>
  layerGroupsRef: RefLike<Map<string, LeaferGroup>>
  canvasObjectNodesRef: RefLike<Map<string, LeaferBox>>
  layerObjectTargetsRef: RefLike<Map<string, CanvasObjectTarget>>
  draftEraserPathRef: RefLike<MutableDraftEraserPath | null>
}

export type LeaferSceneImage = InstanceType<LeaferSceneContext['Image']>

export function renderWhiteboardScene(params: RenderWhiteboardSceneParams): { visibleImages: LeaferSceneImage[] } {
  const {
    context,
    assets,
    strokes,
    texts = [],
    layers,
    dimensions,
    objectOffsets,
    assetTransforms,
    objectFlipStates,
    layerGroupsRef,
    canvasObjectNodesRef,
    layerObjectTargetsRef,
    draftEraserPathRef,
  } = params
    const { Box, Group, Image, Path, PathCommandMap, PathConvert, PathNumberCommandLengthMap, Rect, Text, rootGroup } =
      context
    const pathTools = { PathCommandMap, PathConvert, PathNumberCommandLengthMap }
    rootGroup.clear()
    layerGroupsRef.current = new Map()
    canvasObjectNodesRef.current = new Map()
    layerObjectTargetsRef.current = new Map()
    draftEraserPathRef.current = null
    const visibleImages: LeaferSceneImage[] = []

    const assetsByLayer = groupItemsByLayer(assets)
    const strokesByLayer = groupItemsByLayer(strokes)
    const layerGroups = new Map<string, LeaferGroup>()
    const addText = (text: CanvasText, parent: LeaferGroup, editable: boolean, origin = { x: 0, y: 0 }) => {
      const offset = getObjectOffset(objectOffsets, 'text', text.id)
      const bounds = { x: text.x + offset.x, y: text.y + offset.y, width: text.width, height: text.height }
      const box = new Box({ x: bounds.x - origin.x, y: bounds.y - origin.y, width: bounds.width, height: bounds.height,
        fill: 'rgba(0,0,0,0)', editable, draggable: editable, hittable: editable, hitFill: editable ? 'all' : 'none',
        hitChildren: false, editConfig: { resizeable: false, flipable: false, rotateable: false, skewable: false },
        canvasObjectKind: 'text', canvasObjectId: text.id })
      const content = new Group(getFlippedContentGroupProps(bounds, getObjectFlipState(objectFlipStates, { kind: 'text', id: text.id })))
      content.add(new Text({ text: text.text, fontSize: text.fontSize, fill: text.color, hittable: false }))
      box.add(content)
      parent.add(box)
      if (editable) {
        canvasObjectNodesRef.current.set(getObjectKey('text', text.id), box)
        layerObjectTargetsRef.current.set(text.layerId, { kind: 'text', id: text.id })
      }
    }


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
        const groupBaseBounds = getLayerBaseBounds(layer.id, assetsByLayer, strokesByLayer, objectOffsets, assetTransforms, texts)

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
            getObjectFlipState(objectFlipStates, groupTarget)
          ))

          for (const asset of layerAssets) {
            const assetBounds = getAssetRenderBounds(asset, objectOffsets, assetTransforms)
            const assetFlipState = getObjectFlipState(objectFlipStates, { kind: 'asset', id: asset.id })
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

            const groupedImage = new Image({
              x: 0,
              y: 0,
              width: assetBounds.width,
              height: assetBounds.height,
              url: asset.url,
              cornerRadius: 8,
              hittable: false
            })
            if (layer.visible) visibleImages.push(groupedImage)

            addCanvasObjectGroup(
              groupContent,
              assetGroup,
              {
                kind: 'asset',
                id: asset.id,
                bounds: assetBounds
              },
              groupedImage,
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

            const strokeFlipState = getObjectFlipState(objectFlipStates, { kind: 'stroke', id: stroke.id })
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

          for (const text of texts.filter((item) => item.layerId === layer.id)) addText(text, groupContent, false, groupBaseBounds)

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
        const flipState = getObjectFlipState(objectFlipStates, { kind: 'asset', id: asset.id })
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

        const assetImage = new Image({
          x: 0,
          y: 0,
          width: assetBounds.width,
          height: assetBounds.height,
          url: asset.url,
          cornerRadius: 8,
          hittable: false
        })
        if (layer.visible) visibleImages.push(assetImage)

        addCanvasObjectGroup(
          layerGroup,
          assetGroup,
          {
            kind: 'asset',
            id: asset.id,
            bounds: assetBounds
          },
          assetImage,
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
        const flipState = getObjectFlipState(objectFlipStates, { kind: 'stroke', id: stroke.id })
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

      for (const text of texts.filter((item) => item.layerId === layer.id)) addText(text, layerGroup, layerCanEdit)

      rootGroup.add(layerGroup)
      layerGroups.set(layer.id, layerGroup)
    }

    layerGroupsRef.current = layerGroups
    return { visibleImages }
}

type SettlingImage = {
  ready?: boolean
  error?: unknown
  on?: (type: string, listener: () => void) => void
  off?: (type: string, listener: () => void) => void
}

export type WhiteboardSceneReadyState = {
  ready: boolean
  decodedImages: number
  editableCount: number
}

export function useWhiteboardSceneReady(params: {
  renderContextRef: RefLike<LeaferRenderContext | null>
  assets: CanvasAsset[]
  texts: CanvasText[]
  strokes: CanvasStroke[]
  layers: LayerItem[]
  dimensions: CanvasDimensions
  sceneTransforms?: SceneTransforms
  renderReadyVersion: number
  objectOffsetsRef: RefLike<Map<string, CanvasObjectOffset>>
  assetTransformsRef: RefLike<Map<string, CanvasAssetTransform>>
  objectFlipStatesRef: RefLike<Map<string, CanvasObjectFlipState>>
  layerGroupsRef: RefLike<Map<string, LeaferGroup>>
  canvasObjectNodesRef: RefLike<Map<string, LeaferBox>>
  layerObjectTargetsRef: RefLike<Map<string, CanvasObjectTarget>>
  draftEraserPathRef: RefLike<MutableDraftEraserPath | null>
}): WhiteboardSceneReadyState {
  const {
    renderContextRef,
    assets,
    texts,
    strokes,
    layers,
    dimensions,
    sceneTransforms,
    renderReadyVersion,
    objectOffsetsRef,
    assetTransformsRef,
    objectFlipStatesRef,
    layerGroupsRef,
    canvasObjectNodesRef,
    layerObjectTargetsRef,
    draftEraserPathRef,
  } = params

  const [sceneReadyState, setSceneReadyState] = useState<WhiteboardSceneReadyState>({
    ready: false,
    decodedImages: 0,
    editableCount: 0,
  })

  useLayoutEffect(() => {
    const context = renderContextRef.current
    if (!context) {
      setSceneReadyState({ ready: false, decodedImages: 0, editableCount: 0 })
      return
    }

    const { visibleImages } = renderWhiteboardScene({
      context,
      assets,
      texts,
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

    const editableCount = canvasObjectNodesRef.current.size
    const imageList = visibleImages as unknown as SettlingImage[]
    const isSettled = (img: SettlingImage) => Boolean(img.ready || img.error)
    let cancelled = false
    let raf1: number | null = null
    let raf2: number | null = null
    const listeners: Array<{ img: SettlingImage; fn: () => void }> = []

    const detachAll = () => {
      for (const entry of listeners.splice(0)) {
        entry.img.off?.('image.loaded', entry.fn)
        entry.img.off?.('image.error', entry.fn)
      }
    }

    const markReadyAfterPaint = () => {
      if (cancelled) return
      const decodedImages = imageList.filter((img) => Boolean(img.ready)).length
      raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(() => {
          if (!cancelled) {
            setSceneReadyState({
              ready: true,
              decodedImages,
              editableCount: canvasObjectNodesRef.current.size,
            })
          }
        })
      })
    }

    setSceneReadyState({ ready: false, decodedImages: 0, editableCount })
    if (imageList.every(isSettled)) {
      markReadyAfterPaint()
    } else {
      const checkSettled = () => {
        if (cancelled || !imageList.every(isSettled)) return
        detachAll()
        markReadyAfterPaint()
      }
      for (const img of imageList) {
        if (isSettled(img)) continue
        img.on?.('image.loaded', checkSettled)
        img.on?.('image.error', checkSettled)
        listeners.push({ img, fn: checkSettled })
      }
    }

    return () => {
      cancelled = true
      if (raf1 !== null) window.cancelAnimationFrame(raf1)
      if (raf2 !== null) window.cancelAnimationFrame(raf2)
      detachAll()
    }
  }, [assets, layers, renderReadyVersion, strokes, texts, sceneTransforms])

  return sceneReadyState
}
