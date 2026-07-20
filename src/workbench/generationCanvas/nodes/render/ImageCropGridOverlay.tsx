import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconX } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'

export type CropRect = { x: number; y: number; w: number; h: number }
export type CropGridResult = { rect: CropRect; cols: number[]; rows: number[] }
export type CropGridSize = 1 | 2 | 3

type CornerMode = 'nw' | 'ne' | 'sw' | 'se'
type DragTarget =
  | { kind: 'move' }
  | { kind: 'corner'; corner: CornerMode }
  | { kind: 'col'; index: number }
  | { kind: 'row'; index: number }

type ActiveDrag = {
  target: DragTarget
  pointerId: number
  startX: number
  startY: number
  boxWidth: number
  boxHeight: number
  startRect: CropRect
  startCols: number[]
  startRows: number[]
}

const MIN_CROP = 0.06
// 框内相邻分割线（或线与边）最小间距，防止线叠在一起切出 0 宽 cell。
const MIN_GAP = 0.06

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// 默认等分线：gridSize n → [1/n, 2/n, …, (n-1)/n]（裁剪 gridSize 1 → 空）。
function equalCuts(gridSize: CropGridSize): number[] {
  const cuts: number[] = []
  for (let i = 1; i < gridSize; i += 1) cuts.push(i / gridSize)
  return cuts
}

/**
 * 非破坏式可调取景框：裁剪与切图共用一个组件（P1，不留两套）。
 * gridSize 1 = 纯裁剪（无内线）；2/3 = 多 gridSize-1 条可拖横/竖分割线，默认等分。
 * 内线坐标 = 框内归一化分数（随外框缩放自动跟随）。确认时把 { rect, cols, rows } 交回父级，
 * 由父级按 cell 裁出新节点（原图零改动）。坐标约定：overlay 盒子 == 图片显示区（无 letterbox）。
 */
export default function ImageCropGridOverlay({
  imageUrl,
  gridSize,
  onConfirm,
  onCancel,
}: {
  imageUrl: string
  gridSize: CropGridSize
  onConfirm: (result: CropGridResult) => void
  onCancel: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const boxRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<ActiveDrag | null>(null)
  // 切图默认框接近整图（通常要切整张）；纯裁剪沿用原来的居中八分。
  const [rect, setRect] = React.useState<CropRect>(
    gridSize === 1 ? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } : { x: 0.04, y: 0.04, w: 0.92, h: 0.92 },
  )
  const [cols, setCols] = React.useState<number[]>(() => equalCuts(gridSize))
  const [rows, setRows] = React.useState<number[]>(() => equalCuts(gridSize))

  const beginDrag = (target: DragTarget) => (event: React.PointerEvent) => {
    event.stopPropagation()
    event.preventDefault()
    const box = boxRef.current?.getBoundingClientRect()
    if (!box) return
    dragRef.current = {
      target,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      boxWidth: box.width,
      boxHeight: box.height,
      startRect: rect,
      startCols: cols,
      startRows: rows,
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    event.stopPropagation()
    const dx = (event.clientX - drag.startX) / Math.max(1, drag.boxWidth)
    const dy = (event.clientY - drag.startY) / Math.max(1, drag.boxHeight)
    const s = drag.startRect
    const t = drag.target

    if (t.kind === 'move') {
      const x = clamp01(Math.min(s.x + dx, 1 - s.w))
      const y = clamp01(Math.min(s.y + dy, 1 - s.h))
      setRect({ x: Math.max(0, x), y: Math.max(0, y), w: s.w, h: s.h })
      return
    }

    if (t.kind === 'corner') {
      const right = s.x + s.w
      const bottom = s.y + s.h
      let nx = s.x
      let ny = s.y
      let nr = right
      let nb = bottom
      if (t.corner === 'nw') {
        nx = clamp01(Math.min(s.x + dx, right - MIN_CROP))
        ny = clamp01(Math.min(s.y + dy, bottom - MIN_CROP))
      }
      if (t.corner === 'ne') {
        nr = clamp01(Math.max(right + dx, s.x + MIN_CROP))
        ny = clamp01(Math.min(s.y + dy, bottom - MIN_CROP))
      }
      if (t.corner === 'sw') {
        nx = clamp01(Math.min(s.x + dx, right - MIN_CROP))
        nb = clamp01(Math.max(bottom + dy, s.y + MIN_CROP))
      }
      if (t.corner === 'se') {
        nr = clamp01(Math.max(right + dx, s.x + MIN_CROP))
        nb = clamp01(Math.max(bottom + dy, s.y + MIN_CROP))
      }
      setRect({ x: nx, y: ny, w: Math.max(MIN_CROP, nr - nx), h: Math.max(MIN_CROP, nb - ny) })
      return
    }

    // 内部分割线：在「框内分数」空间拖动，夹在相邻线/边的 MIN_GAP 内。
    if (t.kind === 'col') {
      const base = drag.startCols
      const rel = dx / Math.max(0.0001, s.w)
      const lower = (t.index > 0 ? base[t.index - 1] : 0) + MIN_GAP
      const upper = (t.index < base.length - 1 ? base[t.index + 1] : 1) - MIN_GAP
      const next = [...base]
      next[t.index] = clamp(base[t.index] + rel, lower, upper)
      setCols(next)
      return
    }
    if (t.kind === 'row') {
      const base = drag.startRows
      const rel = dy / Math.max(0.0001, s.h)
      const lower = (t.index > 0 ? base[t.index - 1] : 0) + MIN_GAP
      const upper = (t.index < base.length - 1 ? base[t.index + 1] : 1) - MIN_GAP
      const next = [...base]
      next[t.index] = clamp(base[t.index] + rel, lower, upper)
      setRows(next)
    }
  }

  const endDrag = (event: React.PointerEvent) => {
    if (!dragRef.current) return
    event.stopPropagation()
    dragRef.current = null
  }

  const pct = (v: number) => `${v * 100}%`
  const handleClass = cn(
    'absolute w-3 h-3 -m-1.5 rounded-full bg-nomi-paper border border-nomi-ink-20',
    'shadow-nomi-sm',
  )
  const gripClass = cn(
    'absolute w-3 h-3 rounded-full bg-nomi-paper border border-nomi-ink-20',
    'shadow-nomi-sm -translate-x-1/2 -translate-y-1/2',
  )

  return (
    <div
      ref={boxRef}
      className="absolute inset-0 z-[14] select-none touch-none"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <img src={imageUrl} alt="" className="w-full h-full object-fill pointer-events-none" draggable={false} />
      {/* 框外压暗：上/下/左/右四块 */}
      <div
        className="absolute left-0 right-0 top-0 bg-nomi-ink/[0.55] pointer-events-none"
        style={{ height: pct(rect.y) }}
      />
      <div
        className="absolute left-0 right-0 bottom-0 bg-nomi-ink/[0.55] pointer-events-none"
        style={{ height: pct(1 - rect.y - rect.h) }}
      />
      <div
        className="absolute left-0 bg-nomi-ink/[0.55] pointer-events-none"
        style={{ top: pct(rect.y), height: pct(rect.h), width: pct(rect.x) }}
      />
      <div
        className="absolute right-0 bg-nomi-ink/[0.55] pointer-events-none"
        style={{ top: pct(rect.y), height: pct(rect.h), width: pct(1 - rect.x - rect.w) }}
      />
      {/* 选区框 */}
      <div
        className="absolute border border-nomi-paper/90 cursor-move"
        style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
        onPointerDown={beginDrag({ kind: 'move' })}
      >
        {/* 框内可拖分割线（竖） */}
        {cols.map((c, index) => (
          <div
            key={`col-${index}`}
            className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize"
            style={{ left: pct(c) }}
            onPointerDown={beginDrag({ kind: 'col', index })}
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-nomi-paper/90 pointer-events-none" />
            <span className={cn(gripClass, 'left-1/2 top-1/2 pointer-events-none')} />
          </div>
        ))}
        {/* 框内可拖分割线（横） */}
        {rows.map((r, index) => (
          <div
            key={`row-${index}`}
            className="absolute left-0 right-0 h-4 -mt-2 cursor-ns-resize"
            style={{ top: pct(r) }}
            onPointerDown={beginDrag({ kind: 'row', index })}
          >
            <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-nomi-paper/90 pointer-events-none" />
            <span className={cn(gripClass, 'left-1/2 top-1/2 pointer-events-none')} />
          </div>
        ))}
        {/* 外框四角 */}
        <span
          className={cn(handleClass, 'left-0 top-0 cursor-nwse-resize')}
          onPointerDown={beginDrag({ kind: 'corner', corner: 'nw' })}
        />
        <span
          className={cn(handleClass, 'right-0 top-0 cursor-nesw-resize')}
          onPointerDown={beginDrag({ kind: 'corner', corner: 'ne' })}
        />
        <span
          className={cn(handleClass, 'left-0 bottom-0 cursor-nesw-resize')}
          onPointerDown={beginDrag({ kind: 'corner', corner: 'sw' })}
        />
        <span
          className={cn(handleClass, 'right-0 bottom-0 cursor-nwse-resize')}
          onPointerDown={beginDrag({ kind: 'corner', corner: 'se' })}
        />
      </div>
      {/* 确认 / 取消 */}
      <div className="absolute right-2 top-2 flex items-center gap-1.5">
        <button
          type="button"
          aria-label={t('generationCommon.cropGrid.cancel')}
          title={t('generationCommon.cropGrid.cancel')}
          className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-nomi-paper text-nomi-ink-80 shadow-nomi-md"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onCancel()
          }}
        >
          <IconX size={16} stroke={1.8} />
        </button>
        <button
          type="button"
          aria-label={
            gridSize === 1 ? t('generationCommon.cropGrid.confirmCrop') : t('generationCommon.cropGrid.confirmSplit')
          }
          title={
            gridSize === 1 ? t('generationCommon.cropGrid.confirmCrop') : t('generationCommon.cropGrid.confirmSplit')
          }
          className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-nomi-ink text-nomi-paper shadow-nomi-md hover:bg-nomi-accent"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onConfirm({ rect, cols, rows })
          }}
        >
          <IconCheck size={16} stroke={1.8} />
        </button>
      </div>
    </div>
  )
}
