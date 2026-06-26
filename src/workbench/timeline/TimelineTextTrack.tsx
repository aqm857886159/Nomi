import React from 'react'
import { IconLetterCase } from '@tabler/icons-react'
import { useWorkbenchStore } from '../workbenchStore'
import { cn } from '../../utils/cn'
import { clientXToFrame, frameToPixel, pixelToFrame } from './timelineEdit'

/**
 * 文字轨：字幕/标题卡的时间轴行。只在预览标签出现（生成画布底部那条不传 showTextTrack）。
 * clip 显示文本内容；点选→选中并把 playhead 移到其起点（让预览叠加层显出来供编辑）；拖动改时间。
 */
export default function TimelineTextTrack(): JSX.Element {
  const textClips = useWorkbenchStore((state) => state.timeline.textClips)
  const scale = useWorkbenchStore((state) => state.timeline.scale)
  const selectedTextClipId = useWorkbenchStore((state) => state.selectedTextClipId)
  const selectTimelineTextClip = useWorkbenchStore((state) => state.selectTimelineTextClip)
  const moveTimelineTextClip = useWorkbenchStore((state) => state.moveTimelineTextClip)
  const resizeTimelineTextClip = useWorkbenchStore((state) => state.resizeTimelineTextClip)
  const setTimelinePlayhead = useWorkbenchStore((state) => state.setTimelinePlayhead)
  const clipsRef = React.useRef<HTMLDivElement | null>(null)

  const beginDrag = React.useCallback((event: React.PointerEvent<HTMLElement>, clipId: string, startFrame: number) => {
    event.preventDefault()
    event.stopPropagation()
    const pointerId = event.pointerId
    const target = event.currentTarget
    target.setPointerCapture?.(pointerId)
    selectTimelineTextClip(clipId)
    const rect = clipsRef.current?.getBoundingClientRect()
    const grabFrame = rect ? pixelToFrame(event.clientX - rect.left, scale) : startFrame
    const grabOffset = grabFrame - startFrame
    let captured = false

    const apply = (clientX: number, commit: boolean) => {
      const bounds = clipsRef.current?.getBoundingClientRect()
      if (!bounds) return
      const frame = Math.max(0, pixelToFrame(clientX - bounds.left, scale) - grabOffset)
      moveTimelineTextClip(clipId, frame, { commit })
    }

    const handleMove = (move: PointerEvent) => {
      // 真正拖动才压撤销栈（纯点击 select 不污染栈）
      if (!captured) { useWorkbenchStore.getState().captureTimelineUndo(); captured = true }
      apply(move.clientX, false)
    }
    const handleUp = (up: PointerEvent) => {
      apply(up.clientX, true)
      target.releasePointerCapture?.(pointerId)
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }, [moveTimelineTextClip, scale, selectTimelineTextClip])

  // 拖左/右边缘改时长：钉住对侧、移动本侧（resizeTextClip 已保证 ≥1 帧）。拖动 commit:false，松手 commit:true。
  const beginResize = React.useCallback((event: React.PointerEvent<HTMLElement>, clipId: string, edge: 'left' | 'right') => {
    event.preventDefault()
    event.stopPropagation()
    const pointerId = event.pointerId
    const target = event.currentTarget
    target.setPointerCapture?.(pointerId)
    selectTimelineTextClip(clipId)
    let captured = false

    const apply = (clientX: number, commit: boolean) => {
      const bounds = clipsRef.current?.getBoundingClientRect()
      if (!bounds) return
      const frame = Math.max(0, pixelToFrame(clientX - bounds.left, scale))
      resizeTimelineTextClip(clipId, edge, frame, { commit })
    }

    const handleMove = (move: PointerEvent) => {
      if (!captured) { useWorkbenchStore.getState().captureTimelineUndo(); captured = true }
      apply(move.clientX, false)
    }
    const handleUp = (up: PointerEvent) => {
      apply(up.clientX, true)
      target.releasePointerCapture?.(pointerId)
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }, [resizeTimelineTextClip, scale, selectTimelineTextClip])

  return (
    <div className={cn(
      'workbench-timeline-track',
      'w-full min-h-[40px] grid grid-cols-[var(--workbench-timeline-label-width)_minmax(0,1fr)]',
      'items-center mb-1 border-b-0',
    )} data-testid="timeline-text-track" data-track-type="text">
      <div className={cn(
        'workbench-timeline-track__label',
        'sticky left-0 z-[3] flex items-center gap-[7px]',
        'min-w-0 min-h-[40px] pr-3 border-r-0 bg-transparent',
        'text-[var(--workbench-muted)] text-micro font-medium',
      )}>
        <span className="flex-none w-2 h-2 rounded-full shadow-none bg-[var(--workbench-text)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">文字轨</span>
        <span className={cn(
          'flex-none min-w-0 h-auto ml-auto px-1.5 py-px inline-grid place-items-center border-0 rounded-full',
          'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-40)] text-micro font-bold tabular-nums',
        )}>{textClips.length}</span>
      </div>
      <div
        ref={clipsRef}
        className={cn(
          'workbench-timeline-track__clips',
          'relative min-h-[30px] overflow-hidden cursor-crosshair',
          'border border-[var(--nomi-line-soft)] rounded-[var(--nomi-radius-sm)]',
          'bg-[var(--nomi-ink-05)]',
        )}
        style={{
          width: 'var(--workbench-timeline-content-width, 100%)',
          minWidth: 'var(--workbench-timeline-content-width, 100%)',
        }}
        onPointerDown={(event) => {
          const rect = clipsRef.current?.getBoundingClientRect()
          if (rect) setTimelinePlayhead(clientXToFrame(event.clientX, rect.left, scale))
        }}
      >
        {textClips.length === 0 ? (
          <div className={cn(
            'workbench-timeline-track__empty',
            'absolute inset-0 flex items-center justify-center',
            'border border-dashed border-[var(--nomi-line)] rounded-[var(--nomi-radius-sm)]',
            'text-[var(--nomi-ink-40)] leading-none text-micro font-medium pointer-events-none',
          )}>用上方「字幕 / 标题卡」添加</div>
        ) : null}
        {textClips.map((clip) => {
          const left = frameToPixel(clip.startFrame, scale)
          const width = Math.max(24, frameToPixel(clip.endFrame - clip.startFrame, scale))
          const selected = selectedTextClipId === clip.id
          return (
            <button
              key={clip.id}
              type="button"
              className={cn(
                'workbench-timeline-text-clip',
                'absolute top-[5px] bottom-[5px] z-[1] flex items-center gap-1 px-2 overflow-hidden',
                'rounded-[var(--nomi-radius-sm)] cursor-grab active:cursor-grabbing touch-none text-left',
                'border bg-[var(--workbench-text-soft)] text-[var(--nomi-ink)] text-micro font-semibold',
                selected
                  ? 'border-[var(--workbench-text)] shadow-[0_0_0_1px_var(--workbench-text)]'
                  : 'border-[color-mix(in_oklch,var(--workbench-text)_36%,transparent)]',
              )}
              style={{ left: `${left}px`, width: `${width}px` }}
              title={clip.style === 'title' ? '标题卡' : '字幕'}
              onPointerDown={(event) => beginDrag(event, clip.id, clip.startFrame)}
              onClick={() => setTimelinePlayhead(clip.startFrame)}
            >
              <IconLetterCase size={12} className="flex-none opacity-70" />
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{clip.text || '（空）'}</span>
              <span
                role="separator"
                aria-label="向左调整时长"
                className="absolute inset-y-0 left-0 w-1.5 z-[2] cursor-ew-resize hover:bg-[var(--workbench-text)]"
                onPointerDown={(event) => beginResize(event, clip.id, 'left')}
                onClick={(event) => event.stopPropagation()}
              />
              <span
                role="separator"
                aria-label="向右调整时长"
                className="absolute inset-y-0 right-0 w-1.5 z-[2] cursor-ew-resize hover:bg-[var(--workbench-text)]"
                onPointerDown={(event) => beginResize(event, clip.id, 'right')}
                onClick={(event) => event.stopPropagation()}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
