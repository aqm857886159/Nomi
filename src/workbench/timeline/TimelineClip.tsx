import React from 'react'
import { cn } from '../../utils/cn'
import { NomiImage } from '../../design/media'
import { useWorkbenchStore } from '../workbenchStore'
import { frameToPixel, clampGroupDelta, type ClipOrigin } from './timelineEdit'
import { buildSnapPoints, resolveSnap, pixelThresholdToFrames, type SnapResult } from './snapping'
import type { TimelineClip as TimelineClipData } from './timelineTypes'
import { buildVideoPlaybackUrl } from '../../media/videoPlaybackUrl'
import { diagnoseVideoPlaybackFailure, logVideoPlaybackFailure } from '../../media/videoPlaybackDiagnostics'

type TimelineClipProps = {
  clip: TimelineClipData
}

export default function TimelineClip({ clip }: TimelineClipProps): JSX.Element {
  const scale = useWorkbenchStore((state) => state.timeline.scale)
  // 仅订阅"本 clip 是否选中"（布尔），避免选区变化时所有 clip 重渲染
  const isSelected = useWorkbenchStore((state) => state.selectedTimelineClipIds.includes(clip.id))

  const [isDragging, setIsDragging] = React.useState(false)
  const clipRef = React.useRef<HTMLDivElement | null>(null)
  const lastSnapLabelRef = React.useRef<string | null>(null)
  const didDragRef = React.useRef(false)

  const title = clip.label || clip.text || clip.sourceNodeId
  const showVideoThumb = clip.type === 'video' && !clip.thumbnailUrl && Boolean(clip.url)
  const hasVisualThumb = Boolean(clip.thumbnailUrl) || showVideoThumb
  const clipVideoUrl = typeof clip.url === 'string' ? clip.url : ''

  // 吸附"咔哒"微反馈：WAAPI 实现，免改全局 CSS（规则 10）；不与 React 的 style.left 冲突。
  const pulseSnap = React.useCallback(() => {
    const node = clipRef.current
    if (!node || typeof node.animate !== 'function') return
    node.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.015)' }, { transform: 'scale(1)' }],
      { duration: 130, easing: 'cubic-bezier(.2,.7,.3,1)' },
    )
  }, [])

  const applySnapGuide = React.useCallback((snap: SnapResult | null) => {
    const store = useWorkbenchStore.getState()
    if (snap) {
      store.setTimelineSnapGuide({ frame: snap.frame, label: snap.point.label })
      if (snap.point.label !== lastSnapLabelRef.current) {
        lastSnapLabelRef.current = snap.point.label
        pulseSnap()
      }
    } else {
      store.setTimelineSnapGuide(null)
      lastSnapLabelRef.current = null
    }
  }, [pulseSnap])

  const beginResize = React.useCallback((event: React.PointerEvent<HTMLButtonElement>, edge: 'left' | 'right') => {
    event.preventDefault()
    event.stopPropagation()
    const pointerId = event.pointerId
    const node = event.currentTarget
    const startX = event.clientX
    const originEdge = edge === 'left' ? clip.startFrame : clip.endFrame
    let appliedDelta = 0
    lastSnapLabelRef.current = null
    node.setPointerCapture(pointerId)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const scaleNow = useWorkbenchStore.getState().timeline.scale
      let deltaFrame = Math.round((moveEvent.clientX - startX) / scaleNow)
      if (!moveEvent.shiftKey) {
        const timeline = useWorkbenchStore.getState().timeline
        const points = buildSnapPoints(timeline, { excludeClipIds: new Set([clip.id]) })
        const snap = resolveSnap(originEdge + deltaFrame, points, pixelThresholdToFrames(scaleNow))
        if (snap) deltaFrame = snap.frame - originEdge
        applySnapGuide(snap)
      } else {
        applySnapGuide(null)
      }
      const incremental = deltaFrame - appliedDelta
      if (incremental === 0) return
      appliedDelta = deltaFrame
      useWorkbenchStore.getState().resizeTimelineClip(clip.id, edge, incremental)
    }
    const handlePointerUp = () => {
      node.releasePointerCapture(pointerId)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      useWorkbenchStore.getState().setTimelineSnapGuide(null)
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [applySnapGuide, clip.endFrame, clip.id, clip.startFrame])

  const beginDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // 点在 resize 手柄上不触发整体拖动
    if ((event.target as HTMLElement).closest('.workbench-timeline-clip__handle')) return
    // Shift 用于多选切换，不启动拖动（交给 onClick 处理）
    if (event.shiftKey) return
    event.preventDefault()
    const pointerId = event.pointerId
    const target = event.currentTarget
    const startX = event.clientX
    didDragRef.current = false
    lastSnapLabelRef.current = null

    // 确保被拖 clip 在选区里：不在则单选它
    const store = useWorkbenchStore.getState()
    let selection = store.selectedTimelineClipIds
    if (!selection.includes(clip.id)) {
      store.selectTimelineClip(clip.id)
      selection = [clip.id]
    }
    const selectionSet = new Set(selection)
    const isGroup = selection.length > 1

    // 捕获选区内各 clip 的 origin（从 store 真实起止读）
    const origins: ClipOrigin[] = []
    for (const track of store.timeline.tracks) {
      for (const candidate of track.clips) {
        if (selectionSet.has(candidate.id)) origins.push({ id: candidate.id, startFrame: candidate.startFrame, endFrame: candidate.endFrame })
      }
    }
    const dragged = origins.find((origin) => origin.id === clip.id)
      ?? { id: clip.id, startFrame: clip.startFrame, endFrame: clip.endFrame }
    const draggedLen = Math.max(1, dragged.endFrame - dragged.startFrame)
    let lastDesired = dragged.startFrame
    let lastPositions: Record<string, number> = {}

    target.setPointerCapture(pointerId)
    setIsDragging(true)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const scaleNow = useWorkbenchStore.getState().timeline.scale
      if (Math.abs(moveEvent.clientX - startX) > 3) didDragRef.current = true
      let desiredStart = Math.max(0, dragged.startFrame + Math.round((moveEvent.clientX - startX) / scaleNow))

      if (!moveEvent.shiftKey) {
        const timeline = useWorkbenchStore.getState().timeline
        // 排除整个选区（成组同速平移，不互相吸附）
        const points = buildSnapPoints(timeline, { excludeClipIds: selectionSet })
        const threshold = pixelThresholdToFrames(scaleNow)
        const snapStart = resolveSnap(desiredStart, points, threshold)
        const snapEnd = resolveSnap(desiredStart + draggedLen, points, threshold)
        let guide: SnapResult | null = null
        if (snapStart && (!snapEnd || Math.abs(snapStart.deltaFrame) <= Math.abs(snapEnd.deltaFrame))) {
          desiredStart = Math.max(0, snapStart.frame)
          guide = snapStart
        } else if (snapEnd) {
          desiredStart = Math.max(0, snapEnd.frame - draggedLen)
          guide = snapEnd
        }
        applySnapGuide(guide)
      } else {
        applySnapGuide(null)
      }

      lastDesired = desiredStart
      if (isGroup) {
        // 以被拖 clip 推出整组 delta，夹紧到合法范围（任一成员不与非选中重叠）
        const delta = clampGroupDelta(useWorkbenchStore.getState().timeline, origins, desiredStart - dragged.startFrame)
        const positions: Record<string, number> = {}
        for (const origin of origins) positions[origin.id] = Math.max(0, origin.startFrame + delta)
        lastPositions = positions
        useWorkbenchStore.getState().moveTimelineClips(positions, { commit: false })
      } else {
        // 单片：合法落位（撞了滑入最近空位，不弹回）
        useWorkbenchStore.getState().moveTimelineClip(clip.id, desiredStart, { commit: false })
      }
    }
    const handlePointerUp = () => {
      target.releasePointerCapture(pointerId)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      setIsDragging(false)
      useWorkbenchStore.getState().setTimelineSnapGuide(null)
      // 松手落盘一次（commit:true）
      if (isGroup && Object.keys(lastPositions).length > 0) {
        useWorkbenchStore.getState().moveTimelineClips(lastPositions, { commit: true })
      } else if (!isGroup) {
        useWorkbenchStore.getState().moveTimelineClip(clip.id, lastDesired, { commit: true })
      }
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [applySnapGuide, clip.endFrame, clip.id, clip.startFrame])

  const clipWidth = Math.max(36, frameToPixel(clip.frameCount, scale))

  const thumbContent = clip.thumbnailUrl ? (
    <NomiImage className={cn(
      'workbench-timeline-clip__thumb',
      'block absolute inset-0 w-full h-full object-cover rounded-[inherit] bg-[var(--nomi-ink-10)]',
    )} src={clip.thumbnailUrl} alt="" />
  ) : showVideoThumb && clipVideoUrl ? (
    <video
      className={cn(
        'workbench-timeline-clip__thumb',
        'block absolute inset-0 w-full h-full object-cover rounded-[inherit] bg-[var(--nomi-ink-10)]',
      )}
      src={buildVideoPlaybackUrl(clipVideoUrl)}
      crossOrigin="use-credentials"
      muted
      playsInline
      preload="metadata"
      draggable={false}
      onError={(event) => {
        void diagnoseVideoPlaybackFailure(clipVideoUrl, event.currentTarget.error).then(logVideoPlaybackFailure)
      }}
    />
  ) : null

  const clipBaseClasses = cn(
    'workbench-timeline-clip',
    'absolute top-[5px] h-9 flex items-center gap-0 p-0',
    'rounded text-[var(--workbench-ink)] text-[11px] font-medium',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.62)] cursor-grab select-none active:cursor-grabbing',
    clip.type === 'image' && 'border border-[color-mix(in_srgb,var(--workbench-accent)_22%,transparent)] bg-[var(--workbench-accent-soft)]',
    clip.type === 'video' && 'border border-[color-mix(in_srgb,var(--workbench-video)_24%,transparent)] bg-[var(--workbench-video-soft)]',
    // v0.7.1: audio clip 视觉（紫色调，与 video 区分）
    clip.type === 'audio' && 'border border-[color-mix(in_srgb,var(--nomi-accent)_24%,transparent)] bg-[var(--nomi-accent-soft)]',
  )

  const selectedClasses = isSelected ? cn(
    clip.type === 'video'
      ? 'border-[color-mix(in_srgb,var(--workbench-video)_56%,transparent)] bg-[color-mix(in_srgb,var(--workbench-video)_16%,var(--workbench-surface))] shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--workbench-video)_13%,transparent),0_8px_18px_var(--workbench-video-soft)]'
      : 'border-[color-mix(in_srgb,var(--workbench-accent)_62%,transparent)] bg-[color-mix(in_srgb,var(--workbench-accent)_16%,var(--workbench-surface))] shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--workbench-accent)_13%,transparent),0_8px_18px_var(--workbench-accent-soft)]',
  ) : ''

  // trim 手柄：专门的等宽对称握把（非按钮原语，避免 px/min-width 撑开导致左右不一致）
  const handleClasses = cn(
    'workbench-timeline-clip__handle',
    'absolute top-0 bottom-0 z-[2] w-3 p-0 m-0 border-0 bg-transparent appearance-none',
    'inline-flex items-center justify-center cursor-ew-resize',
  )
  const gripClasses = cn(
    'block w-[3px] h-3.5 rounded-full pointer-events-none',
    'shadow-[0_0_0_1px_oklch(1_0_0/0.72)]',
    clip.type === 'video' ? 'bg-[var(--workbench-video)]' : 'bg-[var(--workbench-accent)]',
  )

  return (
    <div
      ref={clipRef}
      className={cn(clipBaseClasses, selectedClasses)}
      data-testid="timeline-clip"
      data-clip-type={clip.type}
      title={title}
      data-selected={isSelected ? 'true' : 'false'}
      data-dragging={isDragging ? 'true' : 'false'}
      style={{
        left: frameToPixel(clip.startFrame, scale),
        width: clipWidth,
        zIndex: isDragging ? 5 : undefined,
        cursor: isDragging ? 'grabbing' : undefined,
      }}
      onClick={(event) => {
        // 刚拖动过则不把这次 pointerup 当作点击（避免拖完误跳 playhead）
        if (didDragRef.current) {
          didDragRef.current = false
          return
        }
        event.stopPropagation()
        const store = useWorkbenchStore.getState()
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
          // 多选：切换本 clip 的选中，不移动 playhead
          store.selectTimelineClip(clip.id, { additive: true })
          return
        }
        store.selectTimelineClip(clip.id)
        store.setTimelinePlayhead(clip.startFrame)
      }}
      onPointerDown={beginDrag}
    >
      {isSelected ? (
        <button
          type="button"
          className={cn(handleClasses, 'workbench-timeline-clip__handle--left', 'left-0 rounded-l-[5px]')}
          aria-label="调整片段起点"
          title="调整片段起点"
          onPointerDown={(event) => beginResize(event, 'left')}
        >
          <span className={gripClasses} aria-hidden="true" />
        </button>
      ) : null}
      {thumbContent}
      {!hasVisualThumb ? (
        <span className={cn(
          'workbench-timeline-clip__label',
          'relative z-[1] min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap',
          'rounded-[3px] text-[var(--nomi-ink)] backdrop-blur-[8px]',
          'self-end mt-auto mx-1 mb-1 px-[5px] py-0.5 bg-[color-mix(in_oklch,var(--nomi-paper)_72%,transparent)]',
        )}>{title}</span>
      ) : null}
      {isSelected ? (
        <button
          type="button"
          className={cn(handleClasses, 'workbench-timeline-clip__handle--right', 'right-0 rounded-r-[5px]')}
          aria-label="调整片段终点"
          title="调整片段终点"
          onPointerDown={(event) => beginResize(event, 'right')}
        >
          <span className={gripClasses} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
