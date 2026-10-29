import React from 'react'
import { useDebouncedCallback } from '@mantine/hooks'
import type { CanvasDimensions } from './lib/canvas'

/** How long the frame has to rest before its size becomes the board size. */
export const FRAME_SIZE_COMMIT_DELAY_MS = 250

type FrameSize = { width: number; height: number }

/** What the frame (CSS px) says about the document (board px × scale). */
export type FrameReading =
  | { kind: 'unmeasurable' }
  | { kind: 'same' }
  | { kind: 'changed'; dimensions: CanvasDimensions }

function usableScale(scale: number | null | undefined): scale is number {
  return typeof scale === 'number' && Number.isFinite(scale) && scale > 0
}

function near(a: FrameSize, b: FrameSize): boolean {
  return Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1
}

/**
 * The one verdict observation and commit share. A frame within one screen pixel of the document is the same frame: stored
 * node sizes are rounded, and reading the rounding back as a resize turned an untouched reopen into a 1280x719 board and a
 * new version (2026-10-22). A size that rounds back to the document is the same size too.
 */
export function readFrameAgainstDocument(frame: FrameSize | null, scale: number | null, document: CanvasDimensions): FrameReading {
  if (!frame || !usableScale(scale) || !(frame.width >= 1) || !(frame.height >= 1)) return { kind: 'unmeasurable' }
  if (near(frame, { width: document.width * scale, height: document.height * scale })) return { kind: 'same' }
  const dimensions = { width: Math.round(frame.width / scale), height: Math.round(frame.height / scale) }
  if (dimensions.width === document.width && dimensions.height === document.height) return { kind: 'same' }
  return { kind: 'changed', dimensions }
}

function measureFrame(frame: HTMLElement | null): FrameSize | null {
  if (!frame) return null
  const style = window.getComputedStyle(frame)
  return { width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) }
}

/**
 * The single owner of "when does the frame's size become the board's size" (user 2026-10-27: replace, not patch).
 *
 * The frame is the node, so its size moves for two reasons: the creator drags it, or the board asked its host to fit it
 * (opening, ratio, size field, undo). React Flow lands a requested node size a render or more later, so a fit passes through
 * stale sizes on its way. Before this hook, the observer wrote the size it saw 250ms later without looking again, two
 * "same size" early returns forgot to cancel that write, and the doors did not know it was queued: the board ended on a size
 * it only passed through (V report sizerace: 2 of 18 runs stopped at 64 or 100).
 *
 * - Every door goes through `settle(dimensions)`: it cancels the queued commit, drops the live size, records the frame sizes
 *   the board is about to pass through, and asks the host to fit the frame. Doors never call the host themselves.
 * - The first frame the board is seen in fixes the scale and is awaited, so the host's open fit never rewrites the board.
 * - A frame landing on an awaited size is the board's own fit, not a drag. Anything else is a drag: same as the board →
 *   cancel; different → show it live and queue the commit.
 * - The commit re-reads the frame and the document when it fires and writes only what is true then.
 */
export function useWhiteboardFrameSize({
  frameRef,
  readDocumentDimensions,
  commitDimensions,
  onFitFrame,
}: {
  frameRef: React.RefObject<HTMLElement | null>
  readDocumentDimensions: () => CanvasDimensions
  commitDimensions: (dimensions: CanvasDimensions) => void
  onFitFrame?: (dimensions: CanvasDimensions) => void
}): { liveDimensions: CanvasDimensions | null; settle: (dimensions: CanvasDimensions) => void } {
  const [liveDimensions, setLiveDimensions] = React.useState<CanvasDimensions | null>(null)
  const scaleRef = React.useRef<number | null>(null)
  // Frame sizes the board itself is landing on; the last one is the latest fit.
  const awaitingRef = React.useRef<FrameSize[]>([])
  const readDocumentRef = React.useRef(readDocumentDimensions)
  readDocumentRef.current = readDocumentDimensions
  const commitRef = React.useRef(commitDimensions)
  commitRef.current = commitDimensions
  const fitRef = React.useRef(onFitFrame)
  fitRef.current = onFitFrame

  const commit = useDebouncedCallback(() => {
    const reading = readFrameAgainstDocument(measureFrame(frameRef.current), scaleRef.current, readDocumentRef.current())
    if (reading.kind === 'changed') commitRef.current(reading.dimensions)
    setLiveDimensions(null)
  }, FRAME_SIZE_COMMIT_DELAY_MS)

  const settle = React.useCallback((dimensions: CanvasDimensions) => {
    commit.cancel()
    setLiveDimensions(null)
    const scale = scaleRef.current
    if (usableScale(scale)) {
      const frame = measureFrame(frameRef.current)
      awaitingRef.current = [
        ...awaitingRef.current,
        ...(frame && frame.width >= 1 && frame.height >= 1 ? [frame] : []),
        { width: dimensions.width * scale, height: dimensions.height * scale },
      ]
    }
    fitRef.current?.(dimensions)
  }, [commit, frameRef])

  React.useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const openedDocument = readDocumentRef.current()
    const observe = () => {
      const size = measureFrame(frame)
      if (!size || !(size.width >= 1) || !(size.height >= 1)) return // nothing to decide; a queued commit re-reads when it fires
      const document = readDocumentRef.current()
      if (!usableScale(scaleRef.current)) {
        const scale = size.width / openedDocument.width
        if (!usableScale(scale)) return
        scaleRef.current = scale
        awaitingRef.current = [size, { width: document.width * scale, height: document.height * scale }]
      }
      const awaiting = awaitingRef.current
      if (awaiting.length > 0 && near(size, awaiting[awaiting.length - 1])) {
        awaitingRef.current = [] // the latest fit landed
        return
      }
      if (awaiting.some((target) => near(size, target))) return // passing through: the frame as it was, or an older fit
      awaitingRef.current = []
      const reading = readFrameAgainstDocument(size, scaleRef.current, document)
      if (reading.kind === 'same') {
        commit.cancel()
        setLiveDimensions(null)
      } else if (reading.kind === 'changed') {
        setLiveDimensions(reading.dimensions)
        commit()
      }
    }
    observe()
    const observer = new ResizeObserver(observe)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [commit, frameRef])

  return { liveDimensions, settle }
}
