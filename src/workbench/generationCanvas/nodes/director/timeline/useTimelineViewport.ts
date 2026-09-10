/**
 * [INPUT]: 依赖 react、../model/timeGrid 的 DIRECTOR_MAX_DURATION_SECONDS
 * [OUTPUT]: 对外提供 TimelineViewport 类型、useTimelineViewport、TIMELINE_LEFT_PAD：像素 ↔ 秒换算、缩放（按钮 ×1.2 / Ctrl+滚轮 ×1.12 围绕光标）、适应视口、泳道总宽
 * [POS]: director/timeline 的视口几何：默认 36 px/s，时间 0 在 12px 处，泳道总宽恒 = 12 + 60s × scale（内容不满也铺满 60s），
 *        最小 scale = 60s 恰好铺满视口（≥6），最大 600；视口变宽时 scale 不低于最小值；「适应」= 回到最小 scale 并滚到 0。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { DIRECTOR_MAX_DURATION_SECONDS } from '../model/timeGrid'

export type TimelineViewport = {
  containerRef: React.RefObject<HTMLDivElement>
  pxPerSecond: number
  visibleWidth: number
  laneWidth: number
  leftPad: number
  timeToPx: (seconds: number) => number
  pxToTime: (px: number) => number
  zoomIn: () => void
  zoomOut: () => void
  fit: () => void
}

export const TIMELINE_LEFT_PAD = 12
const DEFAULT_PX_PER_SECOND = 36
const MIN_PX_PER_SECOND = 6
const MAX_PX_PER_SECOND = 600
const ZOOM_STEP = 1.2
const WHEEL_STEP = 1.12
const RULER_SECONDS = DIRECTOR_MAX_DURATION_SECONDS

/** 60s 恰好铺满视口的 scale（视口至少按 120px 算） */
function minScaleFor(width: number): number {
  return Math.max(MIN_PX_PER_SECOND, (Math.max(120, width) - TIMELINE_LEFT_PAD) / RULER_SECONDS)
}

export function useTimelineViewport(): TimelineViewport {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [visibleWidth, setVisibleWidth] = React.useState(0)
  const [pxPerSecond, setPxPerSecond] = React.useState(DEFAULT_PX_PER_SECOND)

  React.useEffect(() => {
    const element = containerRef.current
    if (!element) return undefined
    const update = () => setVisibleWidth(element.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const clampZoom = React.useCallback(
    (value: number) => Math.min(MAX_PX_PER_SECOND, Math.max(minScaleFor(containerRef.current?.clientWidth ?? visibleWidth), value)),
    [visibleWidth],
  )

  // 视口变宽时 scale 不能低于「60s 铺满」
  React.useEffect(() => {
    if (visibleWidth <= 0) return
    setPxPerSecond((current) => Math.max(current, minScaleFor(visibleWidth)))
  }, [visibleWidth])

  const fit = React.useCallback(() => {
    setPxPerSecond(minScaleFor(containerRef.current?.clientWidth ?? visibleWidth))
    if (containerRef.current) containerRef.current.scrollLeft = 0
  }, [visibleWidth])

  // 围绕某个像素位置缩放：该位置对应的时间在缩放后仍停在同一屏幕位置
  const zoomAround = React.useCallback(
    (factor: number, anchorClientX?: number) => {
      const element = containerRef.current
      setPxPerSecond((current) => {
        const next = clampZoom(current * factor)
        if (element) {
          const rect = element.getBoundingClientRect()
          const localX = anchorClientX === undefined ? rect.width / 2 : anchorClientX - rect.left
          const anchorTime = (element.scrollLeft + localX - TIMELINE_LEFT_PAD) / current
          requestAnimationFrame(() => {
            element.scrollLeft = Math.max(0, anchorTime * next + TIMELINE_LEFT_PAD - localX)
          })
        }
        return next
      })
    },
    [clampZoom],
  )

  React.useEffect(() => {
    const element = containerRef.current
    if (!element) return undefined
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      zoomAround(event.deltaY > 0 ? 1 / WHEEL_STEP : WHEEL_STEP, event.clientX)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [zoomAround])

  const laneWidth = Math.max(visibleWidth, TIMELINE_LEFT_PAD + RULER_SECONDS * pxPerSecond)
  return {
    containerRef,
    pxPerSecond,
    visibleWidth,
    laneWidth,
    leftPad: TIMELINE_LEFT_PAD,
    timeToPx: (seconds) => TIMELINE_LEFT_PAD + seconds * pxPerSecond,
    pxToTime: (px) => (px - TIMELINE_LEFT_PAD) / pxPerSecond,
    zoomIn: () => zoomAround(ZOOM_STEP),
    zoomOut: () => zoomAround(1 / ZOOM_STEP),
    fit,
  }
}
