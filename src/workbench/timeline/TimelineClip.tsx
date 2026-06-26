import React from 'react'
import { cn } from '../../utils/cn'
import { NomiImage } from '../../design/media'
import { useWorkbenchStore } from '../workbenchStore'
import { frameToPixel, pixelToFrame, clampGroupDelta, type ClipOrigin } from './timelineEdit'
import { buildSnapPoints, resolveSnap, pixelThresholdToFrames, type SnapResult } from './snapping'
import type { TimelineClip as TimelineClipData } from './timelineTypes'
import { buildVideoPlaybackUrl } from '../../media/videoPlaybackUrl'
import { diagnoseVideoPlaybackFailure, logVideoPlaybackFailure } from '../../media/videoPlaybackDiagnostics'

type TimelineClipProps = {
  clip: TimelineClipData
}

function TimelineClip({ clip }: TimelineClipProps): JSX.Element {
  const scale = useWorkbenchStore((state) => state.timeline.scale)
  // 仅订阅"本 clip 是否选中"（布尔），避免选区变化时所有 clip 重渲染
  const isSelected = useWorkbenchStore((state) => state.selectedTimelineClipIds.includes(clip.id))
  const splitMode = useWorkbenchStore((state) => state.timelineSplitMode)

  const [isDragging, setIsDragging] = React.useState(false)
  // 剪刀模式：悬停时切点线相对本 clip 左缘的像素位置（null = 不在切点范围/未悬停）
  const [cutPx, setCutPx] = React.useState<number | null>(null)
  // P1 trim 气泡：拖边裁剪中浮「Δ帧 · 时长」（仅拖动瞬时显示，用 snap-tag 暖橙——与吸附同语义层）
  const [resizeTag, setResizeTag] = React.useState<{ edge: 'left' | 'right'; text: string } | null>(null)
  const clipRef = React.useRef<HTMLDivElement | null>(null)
  const lastSnapLabelRef = React.useRef<string | null>(null)
  const didDragRef = React.useRef(false)

  const title = clip.label || clip.text || clip.sourceNodeId
  const clipVideoUrl = typeof clip.url === 'string' ? clip.url : ''
  // C3 真实帧：video clip 优先用真实视频帧（<video> 首帧）而非存的 thumbnailUrl——
  // 后者可能是节点预览的「黑底合成标题卡」（审计 D3「假数据感」）。image clip 的 thumbnail=真图，照旧。
  const showVideoThumb = clip.type === 'video' && Boolean(clipVideoUrl)

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
    let captured = false
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
      // 手势首次真正改动才压撤销栈（避免空点也压）
      if (!captured) { useWorkbenchStore.getState().captureTimelineUndo(); captured = true }
      appliedDelta = deltaFrame
      useWorkbenchStore.getState().resizeTimelineClip(clip.id, edge, incremental)
      // 气泡：读回 live clip 算可见时长 + 累计 Δ帧（裁掉相邻夹紧后的真实增量）
      const liveTimeline = useWorkbenchStore.getState().timeline
      const live = liveTimeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clip.id)
      if (live) {
        const fpsNow = liveTimeline.fps || 30
        const visible = live.endFrame - live.startFrame
        const sign = appliedDelta >= 0 ? '+' : '−'
        setResizeTag({ edge, text: `${sign}${Math.abs(appliedDelta)}f · ${(visible / fpsNow).toFixed(1)}s` })
      }
    }
    const handlePointerUp = () => {
      node.releasePointerCapture(pointerId)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      useWorkbenchStore.getState().setTimelineSnapGuide(null)
      setResizeTag(null)
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [applySnapGuide, clip.endFrame, clip.id, clip.startFrame])

  const beginDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // 剪刀模式下不拖动（点击 = 在光标处分割，由 onClick 处理）
    if (useWorkbenchStore.getState().timelineSplitMode) return
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
      if (Math.abs(moveEvent.clientX - startX) > 3 && !didDragRef.current) {
        didDragRef.current = true
        // 拖拽手势首次真正移动 → 压撤销栈（拖动前的状态）
        useWorkbenchStore.getState().captureTimelineUndo()
      }
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

  const thumbContent = showVideoThumb && clipVideoUrl ? (
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
  ) : (clip.type === 'image' && clipVideoUrl) || clip.thumbnailUrl ? (
    <NomiImage className={cn(
      'workbench-timeline-clip__thumb',
      'block absolute inset-0 w-full h-full object-cover rounded-[inherit] bg-[var(--nomi-ink-10)]',
    )} src={clip.type === 'image' && clipVideoUrl ? clipVideoUrl : clip.thumbnailUrl || ''} alt="" />
  ) : null

  const clipBaseClasses = cn(
    'workbench-timeline-clip',
    'absolute top-[5px] bottom-[5px] flex items-center gap-0 p-0',
    'rounded text-[var(--workbench-ink)] text-micro font-medium',
    'shadow-[inset_0_1px_0_var(--workbench-bevel)] cursor-grab select-none active:cursor-grabbing',
    clip.type === 'image' && 'border border-[color-mix(in_srgb,var(--workbench-accent)_22%,transparent)] bg-[var(--workbench-accent-soft)]',
    clip.type === 'video' && 'border border-[color-mix(in_srgb,var(--workbench-video)_24%,transparent)] bg-[var(--workbench-video-soft)]',
    // audio clip 视觉（紫色调 --workbench-audio，与图=蓝/视频=青区分）
    clip.type === 'audio' && 'border border-[color-mix(in_srgb,var(--workbench-audio)_24%,transparent)] bg-[var(--workbench-audio-soft)]',
  )

  const selectedClasses = isSelected ? cn(
    clip.type === 'video' && 'border-[color-mix(in_srgb,var(--workbench-video)_56%,transparent)] bg-[color-mix(in_srgb,var(--workbench-video)_16%,var(--workbench-surface))] shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--workbench-video)_13%,transparent),0_8px_18px_var(--workbench-video-soft)]',
    clip.type === 'audio' && 'border-[color-mix(in_srgb,var(--workbench-audio)_56%,transparent)] bg-[color-mix(in_srgb,var(--workbench-audio)_16%,var(--workbench-surface))] shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--workbench-audio)_13%,transparent),0_8px_18px_var(--workbench-audio-soft)]',
    clip.type === 'image' && 'border-[color-mix(in_srgb,var(--workbench-accent)_62%,transparent)] bg-[color-mix(in_srgb,var(--workbench-accent)_16%,var(--workbench-surface))] shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--workbench-accent)_13%,transparent),0_8px_18px_var(--workbench-accent-soft)]',
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
    clip.type === 'video' && 'bg-[var(--workbench-video)]',
    clip.type === 'audio' && 'bg-[var(--workbench-audio)]',
    clip.type === 'image' && 'bg-[var(--workbench-accent)]',
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
        cursor: splitMode ? 'col-resize' : isDragging ? 'grabbing' : undefined,
      }}
      onClick={(event) => {
        // 剪刀模式：点击 = 在光标帧处分割（不选中、不移 playhead）
        if (splitMode) {
          event.stopPropagation()
          const rect = clipRef.current?.getBoundingClientRect()
          if (!rect) return
          const splitFrame = clip.startFrame + pixelToFrame(event.clientX - rect.left, scale)
          useWorkbenchStore.getState().splitTimelineClip(clip.id, splitFrame)
          setCutPx(null)
          return
        }
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
      onPointerMove={splitMode ? (event) => {
        const rect = clipRef.current?.getBoundingClientRect()
        if (!rect) return
        const px = event.clientX - rect.left
        // 只在可切范围（离两端 >3 帧）才显切点线
        const frameInto = pixelToFrame(px, scale)
        setCutPx(frameInto > 3 && frameInto < clip.frameCount - 3 ? px : null)
      } : undefined}
      onPointerLeave={splitMode ? () => setCutPx(null) : undefined}
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
      {/* 标签始终显示（含有缩略图时也压在其上）：宽参考图 object-cover 只见局部，光看图认不出哪一镜 */}
      <span className={cn(
        'workbench-timeline-clip__label',
        'relative z-[1] min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap',
        'rounded-nomi-sm text-[var(--nomi-ink)] backdrop-blur-[8px]',
        'self-end mt-auto mx-1 mb-1 px-[5px] py-0.5 bg-[color-mix(in_oklch,var(--nomi-paper)_72%,transparent)]',
      )}>{title}</span>
      {/* 剪刀模式切点线：橙色虚线 + 剪刀图标，跟随光标 */}
      {splitMode && cutPx !== null ? (
        <span
          className={cn(
            'workbench-timeline-clip__cut-line',
            'absolute top-0 bottom-0 z-[3] w-0 pointer-events-none',
            'border-l border-dashed border-[var(--workbench-danger)]',
          )}
          style={{ left: `${cutPx}px` }}
          aria-hidden="true"
        />
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
      {resizeTag ? (
        <span
          className={cn(
            'workbench-timeline-clip__trim-tag',
            'absolute -top-[19px] z-[4] pointer-events-none whitespace-nowrap',
            'px-[5px] py-px rounded-nomi-sm text-micro tabular-nums',
            'bg-[var(--nomi-snap-tag)] text-[var(--nomi-paper)]',
            resizeTag.edge === 'left' ? 'left-0' : 'right-0',
          )}
          aria-hidden="true"
        >{resizeTag.text}</span>
      ) : null}
    </div>
  )
}

// 播放推进每帧换 timeline 引用 → 父轨道每帧重渲；但 immer 下未变的 clip 引用稳定，
// memo 后未变 clip 跳过重渲（选中/scale/splitMode 仍由组件内细粒度订阅各自触发）。
export default React.memo(TimelineClip)
