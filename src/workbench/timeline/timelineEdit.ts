import type { TimelineClip, TimelineState, TimelineTrack, TimelineTrackType } from './timelineTypes'
import { getTrackTypeForClipType } from './timelineTypes'
import { resolveClipFraming, type ClipFraming } from './clipFraming'
import { nearestLegalStart } from './timelinePlacement'

export const TIMELINE_MIN_SCALE = 0.35
export const TIMELINE_MAX_SCALE = 16

function clampInteger(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next)) return min
  return Math.min(max, Math.max(min, Math.floor(next)))
}

export function clampTimelineScale(value: unknown): number {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next)) return 1
  return Math.min(TIMELINE_MAX_SCALE, Math.max(TIMELINE_MIN_SCALE, next))
}

export function frameToPixel(frame: number, scale: number): number {
  return clampInteger(frame, 0) * clampTimelineScale(scale)
}

export function pixelToFrame(pixel: number, scale: number): number {
  return clampInteger(pixel / clampTimelineScale(scale), 0)
}

/**
 * clip 在时间轴上的可见帧数（渲染宽度/切点范围的唯一依据）。
 * 视频/音频裁剪只改 offset 与 endFrame、frameCount 恒为源总长——
 * 布局读 frameCount 会让裁剪在 UI 上"纹丝不动"、且视觉跨度≠真实跨度（曾致按视觉位置的分割静默 no-op）。
 */
export function clipVisibleFrames(clip: Pick<TimelineClip, 'startFrame' | 'endFrame'>): number {
  return Math.max(0, clampInteger(clip.endFrame, 0) - clampInteger(clip.startFrame, 0))
}

export function clientXToFrame(clientX: number, trackLeft: number, scale: number): number {
  return pixelToFrame(clientX - trackLeft, scale)
}

function getVisibleFrameCount(clip: TimelineClip): number {
  return Math.max(1, clip.endFrame - clip.startFrame)
}

function buildUniqueClipId(track: TimelineTrack, baseId: string): string {
  const normalizedBaseId = String(baseId || 'clip').trim() || 'clip'
  const existingIds = new Set(track.clips.map((clip) => clip.id))
  if (!existingIds.has(normalizedBaseId)) return normalizedBaseId
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${normalizedBaseId}-${index}`
    if (!existingIds.has(candidate)) return candidate
  }
  throw new Error(`Unable to allocate unique timeline clip id for ${normalizedBaseId}`)
}

export function withClipStartFrame(clip: TimelineClip, startFrame: number): TimelineClip {
  const nextStartFrame = clampInteger(startFrame, 0)
  return {
    ...clip,
    startFrame: nextStartFrame,
    endFrame: nextStartFrame + getVisibleFrameCount(clip),
  }
}

export function addClipAtFrame(timeline: TimelineState, clip: TimelineClip, trackType: TimelineTrackType, startFrame: number): TimelineState {
  if (getTrackTypeForClipType(clip.type) !== trackType) return timeline
  let inserted = false
  const tracks = timeline.tracks.map((track) => {
    if (track.type !== trackType) return track
    // 与移动同一碰撞模型：期望位被占则滑入最近合法空位，插入永不静默失败
    const placed = withClipStartFrame(clip, resolveLegalInsertStart(track, clip, startFrame))
    inserted = true
    return {
      ...track,
      clips: [...track.clips, placed].sort((left, right) => left.startFrame - right.startFrame),
    }
  })
  return inserted ? { ...timeline, tracks } : timeline
}

export function resolveLegalStartFrame(track: TimelineTrack, clipId: string, desiredStart: number): number | null {
  const current = track.clips.find((clip) => clip.id === clipId)
  if (!current) return null
  const others = track.clips
    .filter((clip) => clip.id !== clipId)
    .sort((left, right) => left.startFrame - right.startFrame)
  return nearestLegalStart(others, getVisibleFrameCount(current), desiredStart)
}

/** 新 clip（尚不在轨上）的合法落点：与移动同款"撞了滑入最近空位"，拖放不再拒收。 */
export function resolveLegalInsertStart(track: TimelineTrack, clip: TimelineClip, desiredStart: number): number {
  const others = [...track.clips].sort((left, right) => left.startFrame - right.startFrame)
  return nearestLegalStart(others, Math.max(1, getVisibleFrameCount(clip)), desiredStart)
}

/**
 * 把 clip 移到"离期望起点最近的合法位"。与 moveClipToFrame 不同：
 * 重叠时不放弃（不弹回），而是滑入最近空位。用于拖动实时落位。
 */
export function moveClipToLegalFrame(timeline: TimelineState, clipId: string, startFrame: number): TimelineState {
  const id = String(clipId || '').trim()
  if (!id) return timeline
  let moved = false
  const tracks = timeline.tracks.map((track) => {
    if (!track.clips.some((clip) => clip.id === id)) return track
    const legalStart = resolveLegalStartFrame(track, id, startFrame)
    if (legalStart == null) return track
    moved = true
    return {
      ...track,
      clips: track.clips
        .map((clip) => (clip.id === id ? withClipStartFrame(clip, legalStart) : clip))
        .sort((left, right) => left.startFrame - right.startFrame),
    }
  })
  return moved ? { ...timeline, tracks } : timeline
}

export function removeClipById(timeline: TimelineState, clipId: string): TimelineState {
  const id = String(clipId || '').trim()
  if (!id) return timeline
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => clip.id !== id),
    })),
  }
}

export function removeClipsByIds(timeline: TimelineState, clipIds: readonly string[]): TimelineState {
  const idSet = new Set(clipIds.map((id) => String(id || '').trim()).filter(Boolean))
  if (idSet.size === 0) return timeline
  let removed = false
  const tracks = timeline.tracks.map((track) => {
    const nextClips = track.clips.filter((clip) => !idSet.has(clip.id))
    if (nextClips.length === track.clips.length) return track
    removed = true
    return { ...track, clips: nextClips }
  })
  return removed ? { ...timeline, tracks } : timeline
}

/**
 * 删画布节点 → 时间轴对账：移除所有 sourceNodeId 命中的 clip（跨轨、含同节点的多个产物）。
 * 根因（P2，数据一致性）：clip 创建时把节点 result 的 url/thumbnailUrl 快照冻结，无 node→clip 同步；
 * 画布删了节点后时间轴仍引用「已不存在/过期素材」，导出会渲染悬空帧。此处按 sourceNodeId 单向对账，
 * 让「画布删了的节点，时间轴不再放它的旧产物」。无命中返回原引用 → store 据此跳过 persistRevision 自增。
 */
export function removeClipsBySourceNodeIds(timeline: TimelineState, nodeIds: readonly string[]): TimelineState {
  const idSet = new Set(nodeIds.map((id) => String(id || '').trim()).filter(Boolean))
  if (idSet.size === 0) return timeline
  let removed = false
  const tracks = timeline.tracks.map((track) => {
    const nextClips = track.clips.filter((clip) => !idSet.has(clip.sourceNodeId))
    if (nextClips.length === track.clips.length) return track
    removed = true
    return { ...track, clips: nextClips }
  })
  return removed ? { ...timeline, tracks } : timeline
}

/**
 * 把某源节点的所有 clip 过一遍 transform（C0 回填闸的时间轴侧；transform 自身不感知邻居）。
 * 通用、不依赖生成层：transform 由调用方注入（如「应用重生成产物」）。
 * 应用后防与下一片重叠——超出则按 resizeClipEdge 同模型收回可见长度（video/audio 加 offsetEnd，image 缩 frameCount），
 * 保证「位置不变（startFrame 不动）」的同时不踩到邻片。
 */
export function updateClipsBySourceNodeId(
  timeline: TimelineState,
  nodeId: string,
  transform: (clip: TimelineClip) => TimelineClip,
): TimelineState {
  const id = String(nodeId || '').trim()
  if (!id) return timeline
  let changed = false
  const tracks = timeline.tracks.map((track) => {
    let trackChanged = false
    const clips = track.clips.map((clip, index) => {
      if (clip.sourceNodeId !== id) return clip
      let next = transform(clip)
      const after = track.clips[index + 1]
      if (after && next.endFrame > after.startFrame) {
        const maxVisible = Math.max(1, after.startFrame - next.startFrame)
        const curVisible = next.endFrame - next.startFrame
        if (curVisible > maxVisible) {
          const cut = curVisible - maxVisible
          next = {
            ...next,
            endFrame: next.startFrame + maxVisible,
            offsetEndFrame: (next.type === 'video' || next.type === 'audio') ? next.offsetEndFrame + cut : next.offsetEndFrame,
            frameCount: next.type === 'image' ? maxVisible : next.frameCount,
          }
        }
      }
      if (next !== clip) trackChanged = true
      return next
    })
    if (!trackChanged) return track
    changed = true
    return { ...track, clips }
  })
  return changed ? { ...timeline, tracks } : timeline
}

// ── 成组移动（多选拖动）─────────────────────────────────────────
export type ClipOrigin = { id: string; startFrame: number; endFrame: number }

/**
 * 限制成组位移 delta：使任一选中 clip 不与非选中 clip 重叠、且不越过 0。
 * 选中 clip 之间因整体同速平移，相对关系不变、不会互相重叠，故只需对非选中做边界。
 */
export function clampGroupDelta(timeline: TimelineState, origins: readonly ClipOrigin[], deltaFrame: number): number {
  const ids = new Set(origins.map((origin) => origin.id))
  let minDelta = -Number.MAX_SAFE_INTEGER
  let maxDelta = Number.MAX_SAFE_INTEGER
  for (const track of timeline.tracks) {
    const others = track.clips.filter((clip) => !ids.has(clip.id))
    for (const origin of origins) {
      if (!track.clips.some((clip) => clip.id === origin.id)) continue
      let leftBound = 0
      let rightBound = Number.MAX_SAFE_INTEGER
      for (const other of others) {
        if (other.endFrame <= origin.startFrame) leftBound = Math.max(leftBound, other.endFrame)
        else if (other.startFrame >= origin.endFrame) rightBound = Math.min(rightBound, other.startFrame)
      }
      minDelta = Math.max(minDelta, leftBound - origin.startFrame, -origin.startFrame)
      maxDelta = Math.min(maxDelta, rightBound - origin.endFrame)
    }
  }
  if (minDelta > maxDelta) return 0
  return Math.max(minDelta, Math.min(maxDelta, deltaFrame))
}

/** 把一组 clip 设到绝对起点（外部已保证组内同速平移、不重叠）。 */
export function applyClipStartFrames(timeline: TimelineState, positions: Record<string, number>): TimelineState {
  const idSet = new Set(Object.keys(positions))
  if (idSet.size === 0) return timeline
  const tracks = timeline.tracks.map((track) => {
    if (!track.clips.some((clip) => idSet.has(clip.id))) return track
    return {
      ...track,
      clips: track.clips
        .map((clip) => (idSet.has(clip.id) ? withClipStartFrame(clip, positions[clip.id]) : clip))
        .sort((left, right) => left.startFrame - right.startFrame),
    }
  })
  return { ...timeline, tracks }
}

export function splitClipAtFrame(timeline: TimelineState, clipId: string, frame: number): TimelineState {
  const id = String(clipId || '').trim()
  if (!id) return timeline
  const splitFrame = clampInteger(frame, 0)
  let split = false

  const tracks = timeline.tracks.map((track) => {
    const index = track.clips.findIndex((clip) => clip.id === id)
    if (index < 0) return track
    const current = track.clips[index]
    if (splitFrame <= current.startFrame || splitFrame >= current.endFrame) return track

    const leftVisibleFrames = splitFrame - current.startFrame
    const rightVisibleFrames = current.endFrame - splitFrame
    const rightId = buildUniqueClipId(track, `${current.id}-split`)

    const leftClip: TimelineClip = (current.type === 'video' || current.type === 'audio')
      ? {
          ...current,
          endFrame: splitFrame,
          offsetEndFrame: current.offsetEndFrame + rightVisibleFrames,
        }
      : {
          ...current,
          endFrame: splitFrame,
          frameCount: leftVisibleFrames,
        }

    const rightClip: TimelineClip = (current.type === 'video' || current.type === 'audio')
      ? {
          ...current,
          id: rightId,
          startFrame: splitFrame,
          offsetStartFrame: current.offsetStartFrame + leftVisibleFrames,
        }
      : {
          ...current,
          id: rightId,
          startFrame: splitFrame,
          frameCount: rightVisibleFrames,
        }

    split = true
    return {
      ...track,
      clips: [
        ...track.clips.slice(0, index),
        leftClip,
        rightClip,
        ...track.clips.slice(index + 1),
      ].sort((left, right) => left.startFrame - right.startFrame),
    }
  })

  return split ? { ...timeline, tracks } : timeline
}

export function duplicateClipById(timeline: TimelineState, clipId: string): TimelineState {
  const id = String(clipId || '').trim()
  if (!id) return timeline
  let duplicated = false

  const tracks = timeline.tracks.map((track) => {
    const current = track.clips.find((clip) => clip.id === id)
    if (!current) return track

    const baseCopy = {
      ...current,
      id: buildUniqueClipId(track, `${current.id}-copy`),
    }
    const placed = withClipStartFrame(baseCopy, resolveLegalInsertStart(track, baseCopy, current.endFrame))

    duplicated = true
    return {
      ...track,
      clips: [...track.clips, placed].sort((left, right) => left.startFrame - right.startFrame),
    }
  })

  return duplicated ? { ...timeline, tracks } : timeline
}

export function nudgeClipById(timeline: TimelineState, clipId: string, deltaFrame: number): TimelineState {
  const id = String(clipId || '').trim()
  if (!id) return timeline
  const delta = clampInteger(deltaFrame, Number.MIN_SAFE_INTEGER)
  if (delta === 0) return timeline

  const track = timeline.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === id))
  const current = track?.clips.find((clip) => clip.id === id)
  if (!track || !current) return timeline
  return moveClipToLegalFrame(timeline, id, current.startFrame + delta)
}

/** The actual landing point used by nudge buttons, for disabled-state explanations. */
export function resolveNudgeStartFrame(timeline: TimelineState, clipId: string, deltaFrame: number): number | null {
  const id = String(clipId || '').trim()
  const delta = clampInteger(deltaFrame, Number.MIN_SAFE_INTEGER)
  if (!id || delta === 0) return null
  const track = timeline.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === id))
  const current = track?.clips.find((clip) => clip.id === id)
  if (!track || !current) return null
  return resolveLegalStartFrame(track, id, current.startFrame + delta)
}

export function resizeClipEdge(timeline: TimelineState, clipId: string, edge: 'left' | 'right', deltaFrame: number): TimelineState {
  const id = String(clipId || '').trim()
  if (!id) return timeline
  const delta = clampInteger(deltaFrame, Number.MIN_SAFE_INTEGER)
  let resized = false
  const tracks = timeline.tracks.map((track) => {
    const index = track.clips.findIndex((clip) => clip.id === id)
    if (index < 0) return track
    const current = track.clips[index]
    const before = index > 0 ? track.clips[index - 1] : null
    const after = index < track.clips.length - 1 ? track.clips[index + 1] : null
    const minStart = before ? before.endFrame : 0
    const maxEnd = after ? after.startFrame : Number.MAX_SAFE_INTEGER
    const minFrameCount = 1

    let next = current
    if (edge === 'left') {
      const rawStart = current.startFrame + delta
      const maxStart = current.endFrame - minFrameCount
      const nextStart = Math.min(maxStart, Math.max(minStart, rawStart))
      const diff = nextStart - current.startFrame
      next = {
        ...current,
        startFrame: nextStart,
        frameCount: (current.type === 'video' || current.type === 'audio') ? current.frameCount : current.endFrame - nextStart,
        offsetStartFrame: (current.type === 'video' || current.type === 'audio') ? Math.max(0, current.offsetStartFrame + diff) : current.offsetStartFrame,
      }
    } else {
      const rawEnd = current.endFrame + delta
      const minEnd = current.startFrame + minFrameCount
      const naturalMaxEnd = (current.type === 'video' || current.type === 'audio')
        ? current.startFrame + current.frameCount - current.offsetStartFrame
        : maxEnd
      const nextEnd = Math.max(minEnd, Math.min(maxEnd, naturalMaxEnd, rawEnd))
      const diff = nextEnd - current.endFrame
      next = {
        ...current,
        endFrame: nextEnd,
        frameCount: (current.type === 'video' || current.type === 'audio') ? current.frameCount : nextEnd - current.startFrame,
        offsetEndFrame: (current.type === 'video' || current.type === 'audio') ? Math.max(0, current.offsetEndFrame - diff) : current.offsetEndFrame,
      }
    }

    resized = true
    return {
      ...track,
      clips: track.clips.map((clip) => (clip.id === id ? next : clip)),
    }
  })
  return resized ? { ...timeline, tracks } : timeline
}

/**
 * 设置某个媒体 clip 的取景（patch 合并到现有 framing，缺省补默认、清洗、缩放 clamp）。
 * 找不到 clip 或结果无变化 → 返回原 timeline（引用不变，供 store 跳过 persistRevision 自增）。
 */
export function setClipFraming(timeline: TimelineState, clipId: string, patch: Partial<ClipFraming>): TimelineState {
  const id = String(clipId || '').trim()
  if (!id) return timeline
  let changed = false
  const tracks = timeline.tracks.map((track) => {
    const index = track.clips.findIndex((clip) => clip.id === id)
    if (index < 0) return track
    const current = track.clips[index]
    const nextFraming = resolveClipFraming({ framing: { ...current.framing, ...patch } })
    const prevFraming = resolveClipFraming(current)
    if (
      nextFraming.fit === prevFraming.fit &&
      nextFraming.scale === prevFraming.scale &&
      nextFraming.offsetX === prevFraming.offsetX &&
      nextFraming.offsetY === prevFraming.offsetY &&
      current.framing !== undefined
    ) {
      return track
    }
    changed = true
    return {
      ...track,
      clips: track.clips.map((clip) => (clip.id === id ? { ...clip, framing: nextFraming } : clip)),
    }
  })
  return changed ? { ...timeline, tracks } : timeline
}

export function setTimelinePlayheadFrame(timeline: TimelineState, frame: number): TimelineState {
  return {
    ...timeline,
    playheadFrame: clampInteger(frame, 0),
  }
}

export function setTimelineScale(timeline: TimelineState, scale: number): TimelineState {
  return {
    ...timeline,
    scale: clampTimelineScale(scale),
  }
}
