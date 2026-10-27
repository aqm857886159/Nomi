import { useCallback, useImperativeHandle, useLayoutEffect, useState, useRef, type ForwardedRef, type MutableRefObject } from 'react'
import type { CanvasDimensions } from './lib/canvas'
import { getCanvasPointFromClient } from './lib/pointer'
import { captureSceneTransforms, restoreSceneTransforms, type LeaferApp, type LeaferGroup, type SceneTransforms } from './whiteboardCanvasTypes'
import { createViewportScreenshotFilename, exportViewportFileWithoutEditorOverlays, exportViewportWithoutEditorOverlays, getWhiteboardPreviewPixelRatio } from './whiteboardCanvasExport'
import type { LeaferCanvasHandle } from './WhiteboardLeaferCanvas'
import type { TextMeasure } from './whiteboardTextMetrics'

export type CanvasActionHandles = Pick<LeaferCanvasHandle, 'handleKeyDown' | 'flipSelection' | 'groupSelection' | 'deleteSelection'>

/** Single document boundary shared by inline editing, history restoration and raster capture. */
export function useWhiteboardCanvasDocument(
  ref: ForwardedRef<LeaferCanvasHandle>,
  appRef: MutableRefObject<LeaferApp | null>,
  stageRef: MutableRefObject<HTMLDivElement | null>,
  dimensionsRef: MutableRefObject<CanvasDimensions>,
  sceneTransforms: SceneTransforms | undefined,
  onSceneTransformsChange: ((value: SceneTransforms) => void) | undefined,
  t: (key: string) => string,
  measureText: TextMeasure,
) {
  const initial = useRef(restoreSceneTransforms(sceneTransforms))
  const objectOffsetsRef = useRef(initial.current.offsets)
  const assetTransformsRef = useRef(initial.current.assetTransforms)
  const objectFlipStatesRef = useRef(initial.current.flips)
  const actionHandlesRef = useRef<CanvasActionHandles | null>(null)
  const getSceneTransforms = useCallback(() => captureSceneTransforms(objectOffsetsRef.current, assetTransformsRef.current, objectFlipStatesRef.current), [])
  const committedTransformsRef = useRef(JSON.stringify(sceneTransforms ?? { offsets: {}, assetTransforms: {}, flips: {} }))
  const commitSceneTransforms = useCallback(() => {
    const value = getSceneTransforms()
    const key = JSON.stringify(value)
    if (key === committedTransformsRef.current) return
    committedTransformsRef.current = key
    onSceneTransformsChange?.(value)
  }, [getSceneTransforms, onSceneTransformsChange])
  const restoredTransformsRef = useRef(sceneTransforms)
  if (sceneTransforms !== restoredTransformsRef.current) {
    const restored = restoreSceneTransforms(sceneTransforms)
    objectOffsetsRef.current = restored.offsets
    assetTransformsRef.current = restored.assetTransforms
    objectFlipStatesRef.current = restored.flips
    committedTransformsRef.current = JSON.stringify(sceneTransforms ?? { offsets: {}, assetTransforms: {}, flips: {} })
    restoredTransformsRef.current = sceneTransforms
  }

  useImperativeHandle(
    ref,
    () => ({
      getSceneTransforms,
      handleKeyDown: (event) => actionHandlesRef.current?.handleKeyDown(event) ?? false,
      flipSelection: (axis) => actionHandlesRef.current?.flipSelection(axis),
      groupSelection: () => actionHandlesRef.current?.groupSelection(),
      deleteSelection: () => actionHandlesRef.current?.deleteSelection() ?? false,
      async captureViewport(filename = createViewportScreenshotFilename()) {
        const app = appRef.current
        if (!app) {
          throw new Error(t('generationCommon.whiteboard.canvasNotReady'))
        }

        const result = await exportViewportWithoutEditorOverlays(app, filename)

        if (result.error) {
          throw result.error instanceof Error ? result.error : new Error(t('generationCommon.whiteboard.screenshotSaveFailed'))
        }
      },
      async captureViewportFile(filename = createViewportScreenshotFilename()) {
        const app = appRef.current
        if (!app) {
          throw new Error(t('generationCommon.whiteboard.canvasNotReady'))
        }

        return exportViewportFileWithoutEditorOverlays(app, filename)
      },
      measureText,
      clientPointToCanvasPoint(clientX: number, clientY: number) {
        const stage = stageRef.current
        if (!stage) return null
        const point = getCanvasPointFromClient(clientX, clientY, stage.getBoundingClientRect(), dimensionsRef.current)
        return { x: point[0], y: point[1] }
      }
    }),
    [t, appRef, stageRef, dimensionsRef, getSceneTransforms, measureText]
  )

  return { objectOffsetsRef, assetTransformsRef, objectFlipStatesRef, actionHandlesRef, commitSceneTransforms }
}

/** CSS-pixel viewport; React Flow zoom never changes document bounds or scene scale. */
export function useWhiteboardCanvasViewport(
  appRef: MutableRefObject<LeaferApp | null>,
  hostRef: MutableRefObject<HTMLDivElement | null>,
  layerGroupsRef: MutableRefObject<Map<string, LeaferGroup>>,
  dimensions: CanvasDimensions,
  fitMode: 'inline' | 'bounded' | 'natural',
  renderReadyVersion: number,
) {
  const [inlineScale, setInlineScale] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (fitMode !== 'inline' || inlineScale !== null) return
    const container = hostRef.current?.parentElement?.parentElement
    const width = container ? Number.parseFloat(window.getComputedStyle(container).width) : 0
    if (width && width > 0) setInlineScale(width / dimensions.width)
  }, [fitMode, inlineScale, dimensions.width, hostRef])

  useLayoutEffect(() => {
    const app = appRef.current
    if (!app) return
    app.resize({ width: dimensions.width, height: dimensions.height, pixelRatio: getWhiteboardPreviewPixelRatio(dimensions.width, dimensions.height) })
    const background = layerGroupsRef.current.get('background')?.children[0]
    if (background) { background.width = dimensions.width; background.height = dimensions.height }
  }, [dimensions.width, dimensions.height, renderReadyVersion, appRef, layerGroupsRef])

  return inlineScale
}
