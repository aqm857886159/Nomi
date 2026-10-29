import React from 'react'
import { CANVAS_PREVIEW_LONG_EDGE_PX } from '../../../../../electron/shared/canvas/canvasMediaPreview'
import { logRendererWarn } from '../../../../desktop/rendererLog'
import { canvasImageSourceOf, type CanvasImageSource } from '../canvasImageSource'
import type { CanvasDimensions } from './lib/canvas'
import { restoreSceneTransforms } from './whiteboardCanvasTypes'
import { whiteboardCanvasDimensions, whiteboardRasterStateKey } from './whiteboardRasterState'
import { renderWhiteboardScene } from './whiteboardSceneRender'
import type { WhiteboardState } from './whiteboardTypes'

/**
 * A board's picture drawn from its state, for boards that only have a state (saved by 0.23.0, or before Done made a
 * result on 2026-10-22). Derived and kept in memory only: nothing here writes the store or the disk (2026-10-27).
 */

/** Device pixels per board pixel so the preview's long edge stays within the canvas preview bound. */
export function whiteboardStatePreviewPixelRatio({ width, height }: CanvasDimensions): number {
  const longEdge = Math.max(width, height)
  if (!Number.isFinite(longEdge) || longEdge <= CANVAS_PREVIEW_LONG_EDGE_PX) return 1
  const ratio = CANVAS_PREVIEW_LONG_EDGE_PX / longEdge
  // Leafer sizes canvases with ceil(size * ratio); a ratio that rounds up past the bound is nudged back under it.
  return Math.ceil(longEdge * ratio) > CANVAS_PREVIEW_LONG_EDGE_PX ? (CANVAS_PREVIEW_LONG_EDGE_PX - 0.5) / longEdge : ratio
}

/**
 * Draw the board once off screen and return the PNG. A one-off Leafer (no view, no editor) is filled by the same
 * renderWhiteboardScene the editor uses and destroyed as soon as the export is back. No fill: where the background
 * layer is hidden, the card's paper shows through, as it does behind the editor.
 */
export async function renderWhiteboardStatePreview(state: WhiteboardState): Promise<Blob> {
  const [leafer] = await Promise.all([import('leafer-ui'), import('@leafer-in/export')])
  const dimensions = whiteboardCanvasDimensions(state)
  const pixelRatio = whiteboardStatePreviewPixelRatio(dimensions)
  const board = new leafer.Leafer({ width: dimensions.width, height: dimensions.height, pixelRatio, type: 'draw' })
  try {
    const rootGroup = new leafer.Group()
    board.add(rootGroup)
    const transforms = restoreSceneTransforms(state.sceneTransforms)
    renderWhiteboardScene({
      context: {
        Box: leafer.Box,
        Group: leafer.Group,
        Image: leafer.Image,
        Path: leafer.Path,
        PathCommandMap: leafer.PathCommandMap,
        PathConvert: leafer.PathConvert,
        PathNumberCommandLengthMap: leafer.PathNumberCommandLengthMap,
        Rect: leafer.Rect,
        Text: leafer.Text,
        rootGroup,
      },
      assets: state.canvasAssets,
      texts: state.texts ?? [],
      strokes: state.strokes,
      layers: state.layers,
      dimensions,
      objectOffsets: transforms.offsets,
      assetTransforms: transforms.assetTransforms,
      objectFlipStates: transforms.flips,
      layerGroupsRef: { current: new Map() },
      canvasObjectNodesRef: { current: new Map() },
      layerObjectTargetsRef: { current: new Map() },
      draftEraserPathRef: { current: null },
    })
    const result = await board.export('png', { blob: true, screenshot: true, pixelRatio })
    if (result.error) throw result.error instanceof Error ? result.error : new Error(String(result.error))
    if (!(result.data instanceof Blob)) throw new Error('The board preview export returned no image.')
    return result.data
  } finally {
    board.destroy()
  }
}

export type WhiteboardStatePreview =
  | { status: 'none' }
  | { status: 'pending' }
  | { status: 'ready'; src: CanvasImageSource }
  | { status: 'failed' }

type PreviewRecord = {
  state: WhiteboardState
  preview: WhiteboardStatePreview
  objectUrl: string | null
  /** Mounted cards showing this preview; a held record is never evicted. */
  holders: number
  /** Held cards that are in the viewport; only wanted records are drawn. */
  wanted: number
  releasedAt: number
}

const NONE: WhiteboardStatePreview = { status: 'none' }
const PENDING: WhiteboardStatePreview = { status: 'pending' }
/** Previews nobody shows that stay cached for a card coming back; older ones give their blob back. */
export const WHITEBOARD_STATE_PREVIEW_SPARE_LIMIT = 8

const records = new Map<string, PreviewRecord>()
const listeners = new Set<() => void>()
let drawingKey: string | null = null
let releaseClock = 0
/** Bumped by the test reset so a render that finishes afterwards cannot touch the fresh cache. */
let generation = 0

function notify(): void {
  for (const listener of listeners) listener()
}

function evictSpares(): void {
  const spares = [...records].filter(([key, record]) => record.holders === 0 && key !== drawingKey)
  if (spares.length <= WHITEBOARD_STATE_PREVIEW_SPARE_LIMIT) return
  spares.sort((a, b) => a[1].releasedAt - b[1].releasedAt)
  for (const [key, record] of spares.slice(0, spares.length - WHITEBOARD_STATE_PREVIEW_SPARE_LIMIT)) {
    if (record.objectUrl) URL.revokeObjectURL(record.objectUrl)
    records.delete(key)
  }
}

/**
 * One preview at a time, in the order cards asked. Leafer's export runs on one global queue, so drawing previews one
 * by one also keeps a creator's Done from waiting behind a batch of them.
 */
function drawNext(): void {
  if (drawingKey !== null) return
  const next = [...records].find(([, record]) => record.preview === PENDING && record.wanted > 0)
  if (!next) return
  const [key, record] = next
  const drawnIn = generation
  drawingKey = key
  void renderWhiteboardStatePreview(record.state)
    .then((blob) => {
      if (drawnIn !== generation) return
      const objectUrl = URL.createObjectURL(blob)
      // A blob address of a bounded picture: the source is the preview (bounded-source), never a counted original.
      const src = canvasImageSourceOf({ type: 'image', url: objectUrl, previewState: 'source' })
      if (!src) {
        URL.revokeObjectURL(objectUrl)
        throw new Error('The board preview has no address.')
      }
      record.objectUrl = objectUrl
      record.preview = { status: 'ready', src }
    })
    .catch((error: unknown) => {
      if (drawnIn !== generation) return
      record.preview = { status: 'failed' }
      logRendererWarn('whiteboard-state-preview-failed', undefined, error)
    })
    .finally(() => {
      if (drawnIn !== generation) return
      drawingKey = null
      evictSpares()
      notify()
      drawNext()
    })
}

function holdPreview(key: string, state: WhiteboardState): () => void {
  const record = records.get(key) ?? { state, preview: PENDING, objectUrl: null, holders: 0, wanted: 0, releasedAt: 0 }
  records.set(key, record)
  record.holders += 1
  return () => {
    record.holders -= 1
    if (record.holders > 0) return
    releaseClock += 1
    record.releasedAt = releaseClock
    evictSpares()
  }
}

function wantPreview(key: string): () => void {
  const record = records.get(key)
  if (!record) return () => {}
  record.wanted += 1
  drawNext()
  return () => {
    record.wanted -= 1
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The derived picture of a board that has content but no result. `state` null means the card does not need one. The
 * card asks for drawing only while it is in the viewport (`start`); the cache is keyed by the same raster key Done
 * uses, so labels and selection never redraw and two cards with the same drawing share one render.
 */
export function useWhiteboardStatePreview(state: WhiteboardState | null, start: boolean): WhiteboardStatePreview {
  const key = React.useMemo(() => (state ? whiteboardRasterStateKey(state) : ''), [state])
  React.useEffect(() => (state && key ? holdPreview(key, state) : undefined), [key, state])
  React.useEffect(() => (key && start ? wantPreview(key) : undefined), [key, start])
  const read = React.useCallback(() => (key ? (records.get(key)?.preview ?? PENDING) : NONE), [key])
  return React.useSyncExternalStore(subscribe, read, read)
}

/** Tests only: forget every preview and give their blobs back. */
export function resetWhiteboardStatePreviewsForTests(): void {
  for (const record of records.values()) if (record.objectUrl) URL.revokeObjectURL(record.objectUrl)
  records.clear()
  drawingKey = null
  releaseClock = 0
  generation += 1
}
