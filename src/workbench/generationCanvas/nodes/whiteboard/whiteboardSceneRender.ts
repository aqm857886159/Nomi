import type { CanvasAsset, CanvasDimensions, LayerItem } from './lib/canvas'
import type {
  CanvasAssetTransform,
  CanvasObjectFlipState,
  CanvasObjectOffset,
  CanvasObjectTarget,
  CanvasStroke,
  LeaferBox,
  LeaferGroup,
  LeaferRenderContext,
  MutableDraftEraserPath,
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
  context: LeaferRenderContext
  assets: CanvasAsset[]
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

export function renderWhiteboardScene(params: RenderWhiteboardSceneParams): void {
  const {
    context,
    assets,
    strokes,
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

      rootGroup.add(layerGroup)
      layerGroups.set(layer.id, layerGroup)
    }

    layerGroupsRef.current = layerGroups
}
