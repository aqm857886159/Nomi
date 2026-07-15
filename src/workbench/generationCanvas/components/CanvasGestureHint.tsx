// 画布手势提示卡（④可发现性）。首次进画布显示、可一键关、已读不再弹（per-device 持久化）。
// 克制（R2）：横向 pill 浮在顶部居中，不常驻占角；A′ 已让边标签自解释，故不再需要边图例。
import React from 'react'
import { IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { hasSeenCanvasGestureHint, markCanvasGestureHintSeen } from '../../onboarding/onboardingState'

type GestureItem = { keys: string; label: string }

// 平移放首位、且同时列出鼠标(滚轮/空格拖)与触控板(双指)两套——用户群反复反馈「画布只能缩放不能移动」，
// 根因是旧图例只写「双指滑」，纯鼠标用户看不到任何平移手势(滚轮/空格拖其实都实现了，只是没告诉他)。
const GESTURES: GestureItem[] = [
  { keys: '滚轮 / 空格拖', label: '平移' },
  { keys: '双指滑', label: '平移' },
  { keys: '⌘ + 滚轮', label: '缩放' },
  { keys: '空白拖', label: '框选' },
]

export function CanvasGestureHint(): JSX.Element | null {
  const [visible, setVisible] = React.useState(() => !hasSeenCanvasGestureHint())

  const dismiss = React.useCallback(() => {
    markCanvasGestureHintSeen()
    setVisible(false)
  }, [])

  if (!visible) return null

  return (
    <aside
      className={cn(
        'generation-canvas-v2__gesture-hint',
        'absolute left-1/2 top-4 z-[9] -translate-x-1/2',
        'flex items-center gap-3 pl-3.5 pr-2 py-1.5',
        'rounded-full border border-nomi-line bg-nomi-paper/95 shadow-nomi-md',
        'backdrop-blur-[8px] pointer-events-auto',
      )}
      aria-label="画布手势提示"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {GESTURES.map((gesture, index) => (
        <React.Fragment key={gesture.keys}>
          {index > 0 ? <span className="text-nomi-ink-20" aria-hidden="true">·</span> : null}
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-caption font-medium text-nomi-ink">{gesture.keys}</span>
            <span className="text-caption text-nomi-ink-60">{gesture.label}</span>
          </span>
        </React.Fragment>
      ))}
      <button
        type="button"
        className={cn(
          'inline-grid place-items-center w-6 h-6 rounded-full',
          'text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-ink-05',
          'cursor-pointer',
        )}
        aria-label="知道了，关闭手势提示"
        onClick={dismiss}
      >
        <IconX size={14} stroke={1.8} aria-hidden="true" />
      </button>
    </aside>
  )
}
