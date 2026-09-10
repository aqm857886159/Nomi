/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../utils/cn
 * [OUTPUT]: 对外提供 EditorSplit（两栏可拖分栏，横/纵向，比例持久到 localStorage，键盘可调）
 * [POS]: director/panels 的布局原语：全屏壳的五区域全部由它嵌套而成（主区|右栏、视口/时间轴、场景对象/属性）；
 *        对齐 Nomi TimelineResizeHandle 的手感（指针捕获、方向键微调、Home/End 极值），不引第三方分栏库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../../../utils/cn'

export type EditorSplitProps = {
  direction: 'horizontal' | 'vertical'
  storageKey: string
  defaultRatio: number
  minRatio: number
  maxRatio: number
  children: [React.ReactNode, React.ReactNode]
  className?: string
  /** 设了就把第二栏钉成固定像素（时间轴折叠只留头部），第一栏吃满剩余、把手隐藏；比例记忆不丢。 */
  collapsedSecondPx?: number
}

const STORAGE_PREFIX = 'nomi:director:split:'
const KEY_STEP = 0.02

function readRatio(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    const value = raw === null ? Number.NaN : Number(raw)
    if (!Number.isFinite(value)) return fallback
    return Math.min(max, Math.max(min, value))
  } catch {
    return fallback
  }
}

function writeRatio(key: string, ratio: number): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, ratio.toFixed(4))
  } catch {
    // 无本地存储（隐私模式等）时静默：分栏只是每台机器的便利偏好
  }
}

export function EditorSplit({ direction, storageKey, defaultRatio, minRatio, maxRatio, children, className, collapsedSecondPx }: EditorSplitProps): JSX.Element {
  const { t } = useTranslation()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [ratio, setRatio] = React.useState(() => readRatio(storageKey, defaultRatio, minRatio, maxRatio))
  const [dragging, setDragging] = React.useState(false)
  const horizontal = direction === 'horizontal'

  const commit = React.useCallback(
    (next: number) => {
      const clamped = Math.min(maxRatio, Math.max(minRatio, next))
      setRatio(clamped)
      writeRatio(storageKey, clamped)
    },
    [maxRatio, minRatio, storageKey],
  )

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    setDragging(true)
    const onMove = (move: PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const next = horizontal ? (move.clientX - rect.left) / rect.width : (move.clientY - rect.top) / rect.height
      commit(next)
    }
    const onUp = () => {
      setDragging(false)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const decrease = horizontal ? 'ArrowLeft' : 'ArrowUp'
    const increase = horizontal ? 'ArrowRight' : 'ArrowDown'
    if (event.key === decrease) commit(ratio - KEY_STEP)
    else if (event.key === increase) commit(ratio + KEY_STEP)
    else if (event.key === 'Home') commit(minRatio)
    else if (event.key === 'End') commit(maxRatio)
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  const first = `${(ratio * 100).toFixed(2)}%`
  if (collapsedSecondPx !== undefined) {
    return (
      <div ref={containerRef} className={cn('flex h-full w-full min-h-0 min-w-0', horizontal ? 'flex-row' : 'flex-col', className)} data-director-split={storageKey}>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children[0]}</div>
        <div className="min-h-0 min-w-0 shrink-0 overflow-hidden" style={horizontal ? { width: collapsedSecondPx } : { height: collapsedSecondPx }}>
          {children[1]}
        </div>
      </div>
    )
  }
  return (
    <div
      ref={containerRef}
      className={cn('flex h-full w-full min-h-0 min-w-0', horizontal ? 'flex-row' : 'flex-col', className)}
      data-director-split={storageKey}
    >
      <div className="min-h-0 min-w-0 overflow-hidden" style={horizontal ? { width: first } : { height: first }}>
        {children[0]}
      </div>
      <div
        role="separator"
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(minRatio * 100)}
        aria-valuemax={Math.round(maxRatio * 100)}
        aria-label={t('director.regions.resizeHandle')}
        tabIndex={0}
        className={cn(
          'shrink-0 bg-nomi-line-soft transition-colors hover:bg-nomi-accent focus-visible:bg-nomi-accent',
          horizontal ? 'w-[6px] cursor-col-resize' : 'h-[6px] cursor-row-resize',
          dragging ? 'bg-nomi-accent' : '',
        )}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children[1]}</div>
    </div>
  )
}
