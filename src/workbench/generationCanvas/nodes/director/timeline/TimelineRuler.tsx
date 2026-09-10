/**
 * [INPUT]: 依赖 react、./useTimelineViewport 的 TimelineViewport、../model/timeGrid（DIRECTOR_FPS / DIRECTOR_MAX_DURATION_SECONDS）
 * [OUTPUT]: 对外提供 TimelineRuler（刻度标尺 + 拖拽刷帧）、RULER_HEIGHT
 * [POS]: director/timeline 的标尺：刻度永远铺满 60s；主刻度 = 步长表里首个 ≥72px 的档、次刻度首个 ≥10px 的档
 *        （默认 36px/s → 2s 一格、0.5s 一小格；≥72px/s 才 1s 一格）；标签 10px 等宽贴主刻度线右侧、顶部对齐，线贴底（主 10px / 次 6px）；
 *        按下即 seek、拖动连续刷帧（播放中拖 = 暂停）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { DIRECTOR_FPS, DIRECTOR_MAX_DURATION_SECONDS } from '../model/timeGrid'
import type { TimelineViewport } from './useTimelineViewport'

export const RULER_HEIGHT = 28
const FRAME = 1 / DIRECTOR_FPS
// 步长表
const TICK_STEPS = [FRAME / 4, FRAME / 2, FRAME, 2 * FRAME, 3 * FRAME, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60]
const MIN_MAJOR_PX = 72
const MIN_MINOR_PX = 10

function pickTickStep(pxPerSecond: number): { major: number; minor: number } {
  const major = TICK_STEPS.find((step) => step * pxPerSecond >= MIN_MAJOR_PX) ?? TICK_STEPS[TICK_STEPS.length - 1]
  let minor = TICK_STEPS.find((step) => step * pxPerSecond >= MIN_MINOR_PX) ?? major
  if (minor >= major) {
    minor = major
    for (const divisor of [10, 5, 2]) {
      const candidate = major / divisor
      if (candidate >= FRAME - 1e-9 && candidate * pxPerSecond >= MIN_MINOR_PX) {
        minor = candidate
        break
      }
    }
  }
  return { major, minor }
}

// 主步长 < 1 帧 → F 帧号；< 1s → 小数秒；否则整秒
function formatTick(seconds: number, major: number): string {
  if (major < FRAME - 1e-9) return `F${Math.round(seconds * DIRECTOR_FPS)}`
  if (major < 1) return `${seconds.toFixed(major >= 0.1 ? 1 : 2)}s`
  return `${Math.round(seconds)}s`
}

export function TimelineRuler({ viewport, onScrub }: { viewport: TimelineViewport; onScrub: (seconds: number) => void }): JSX.Element {
  const { pxPerSecond, laneWidth, timeToPx, pxToTime } = viewport
  const { major, minor } = React.useMemo(() => pickTickStep(pxPerSecond), [pxPerSecond])

  const ticks = React.useMemo(() => {
    const items: Array<{ time: number; major: boolean }> = []
    const count = Math.floor(DIRECTOR_MAX_DURATION_SECONDS / minor + 1e-6)
    for (let index = 0; index <= count; index += 1) {
      const time = index * minor
      const isMajor = Math.abs(time / major - Math.round(time / major)) < 1e-6
      items.push({ time, major: isMajor })
    }
    return items
  }, [major, minor])

  const scrubFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    onScrub(Math.max(0, Math.min(DIRECTOR_MAX_DURATION_SECONDS, pxToTime(event.clientX - rect.left))))
  }

  return (
    <div
      className="relative shrink-0 cursor-pointer select-none overflow-hidden border-b border-nomi-line-soft bg-nomi-bg"
      style={{ width: laneWidth, height: RULER_HEIGHT }}
      data-testid="director-timeline-ruler"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        scrubFromEvent(event)
      }}
      onPointerMove={(event) => {
        if (event.buttons & 1 && event.currentTarget.hasPointerCapture(event.pointerId)) scrubFromEvent(event)
      }}
    >
      {ticks.map((tick) => (
        <div key={tick.time} className="pointer-events-none absolute inset-y-0 flex flex-col justify-between" style={{ left: timeToPx(tick.time) }}>
          {tick.major ? (
            <span className="-translate-y-0.5 whitespace-nowrap pl-0.5 font-nomi-mono text-micro text-nomi-ink-40">{formatTick(tick.time, major)}</span>
          ) : (
            <span className="block h-2.5" />
          )}
          <span className={tick.major ? 'h-2.5 w-px shrink-0 bg-nomi-ink-40' : 'h-1.5 w-px shrink-0 bg-nomi-ink-20'} />
        </div>
      ))}
    </div>
  )
}
