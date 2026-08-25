import type { TimelineState, TimelineTextClip, TimelineTransition } from '../timeline/timelineTypes'
import { normalizeTimeline } from '../timeline/timelineMath'
import type { AdoptionApplyPorts, AdoptionPlacement } from './adoptionTypes'

/**
 * 原子 apply + 全量 compensation（合同 §5）。
 *
 * **为什么必须先全算完再一次写**：旧路径是「算一个写一个」——第 7 个算失败时，
 * 前 6 个已经在轴上了。用户看到的是一条**半落的时间轴**：既不是采纳前的样子，
 * 也不是他要的样子，而且没有任何东西告诉他这是残缺的。
 * 这里把它拆成两段：`buildAdoptedTimeline` 纯计算（不碰 store，失败不留痕），
 * `applyAdoption` 只在**全部算成**之后写一次。
 */

export type AdoptionApplyResult =
  | { ok: true; timeline: TimelineState; clipIds: string[] }
  | { ok: false; recovered: true; error: string }
  | { ok: false; recovered: false; error: string }

/** 一条轨在 base 上叠加新 clip 后的样子。不改 base（纯函数）。 */
function insertClips(timeline: TimelineState, placements: ReadonlyArray<AdoptionPlacement>): TimelineState {
  const byTrack = new Map<string, AdoptionPlacement[]>()
  for (const placement of placements) {
    const bucket = byTrack.get(placement.trackType)
    if (bucket) bucket.push(placement)
    else byTrack.set(placement.trackType, [placement])
  }
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      const additions = byTrack.get(track.type)
      if (!additions || additions.length === 0) return track
      return {
        ...track,
        clips: [...track.clips, ...additions.map((placement) => placement.clip)]
          .slice()
          .sort((left, right) => left.startFrame - right.startFrame),
      }
    }),
  }
}

export type AdoptionExtras = {
  textClips?: readonly TimelineTextClip[]
  transitions?: readonly TimelineTransition[]
}

/**
 * 把整批落点算成**一个**新的 TimelineState。任何一处不合法（重叠 / 轨不存在 / clip id 撞车）
 * 就整体 throw —— 调用方据此走 compensation，绝不部分落地。
 */
export function buildAdoptedTimeline(
  base: TimelineState,
  placements: ReadonlyArray<AdoptionPlacement>,
  extras: AdoptionExtras = {},
): TimelineState {
  const existingIds = new Set(base.tracks.flatMap((track) => track.clips.map((clip) => clip.id)))
  const seen = new Set<string>()
  for (const placement of placements) {
    const { clip, trackType } = placement
    if (!base.tracks.some((track) => track.type === trackType)) {
      throw new Error(`采纳落点指向不存在的轨道：${trackType}`)
    }
    if (existingIds.has(clip.id) || seen.has(clip.id)) {
      throw new Error(`采纳会产生重复 clip id：${clip.id}`)
    }
    if (clip.endFrame <= clip.startFrame) {
      throw new Error(`采纳落点时长非法：${clip.id}（${clip.startFrame}→${clip.endFrame}）`)
    }
    seen.add(clip.id)
  }
  // 同轨内部不许重叠（跨轨允许——图片轨/视频轨本就并行）。
  const perTrack = new Map<string, Array<{ start: number; end: number }>>()
  for (const placement of placements) {
    const spans = perTrack.get(placement.trackType) || []
    spans.push({ start: placement.clip.startFrame, end: placement.clip.endFrame })
    perTrack.set(placement.trackType, spans)
  }
  for (const [trackType, spans] of perTrack) {
    const existing = base.tracks.find((track) => track.type === trackType)?.clips || []
    const all = [...existing.map((clip) => ({ start: clip.startFrame, end: clip.endFrame })), ...spans]
    all.sort((left, right) => left.start - right.start)
    for (let index = 1; index < all.length; index += 1) {
      if (all[index].start < all[index - 1].end) {
        throw new Error(`采纳落点在「${trackType}」轨上与既有片段重叠`)
      }
    }
  }

  let next = insertClips(base, placements)
  if (extras.textClips && extras.textClips.length > 0) {
    // 字幕按来源节点去重：同一个镜头只留一条故事板字幕（沿用既有 sourceNodeId 语义）。
    const present = new Set(next.textClips.map((clip) => clip.sourceNodeId).filter(Boolean))
    const additions = extras.textClips.filter((clip) => !clip.sourceNodeId || !present.has(clip.sourceNodeId))
    if (additions.length > 0) next = { ...next, textClips: [...next.textClips, ...additions] }
  }
  if (extras.transitions && extras.transitions.length > 0) {
    const existing = next.transitions || []
    const additions = extras.transitions.filter(
      (candidate) => !existing.some(
        (current) => current.fromClipId === candidate.fromClipId && current.toClipId === candidate.toClipId,
      ),
    )
    if (additions.length > 0) next = { ...next, transitions: [...existing, ...additions] }
  }
  return next
}

/**
 * 原子 apply。三种结局：
 *  · ok           —— 整批落定，撤销栈**只压一层**（一步 Undo 的依据）。
 *  · recovered    —— 落定失败，但补偿把轴放回了 base：用户看到的还是采纳前的样子。
 *  · !recovered   —— 补也补不回去（needs_recovery）：**保留旧态**，不装作成功。
 */
export function applyAdoption(
  ports: AdoptionApplyPorts,
  placements: ReadonlyArray<AdoptionPlacement>,
  extras: AdoptionExtras = {},
): AdoptionApplyResult {
  const base = ports.readTimeline()
  let next: TimelineState
  try {
    next = buildAdoptedTimeline(base, placements, extras)
  } catch (error) {
    // 构建期失败最干净：一个字节都没写过，轴天然还是 base，无需补偿。
    return { ok: false, recovered: true, error: error instanceof Error ? error.message : String(error) }
  }

  try {
    ports.commitTimeline(next, base)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const restored = (() => {
      try { return ports.restoreTimeline(base) } catch { return false }
    })()
    return restored
      ? { ok: false, recovered: true, error: message }
      : { ok: false, recovered: false, error: message }
  }

  // 写完必须**验证**真的写进去了。commitTimeline 不抛不等于生效（store 的 reducer
  // 可能因为归一化把 clip 丢了）——不验证就报成功，就是把「静默丢片」当成功交付。
  const after = ports.readTimeline()
  const expected = normalizeTimeline(next)
  const landed = new Set(after.tracks.flatMap((track) => track.clips.map((clip) => clip.id)))
  const missing = placements.filter((placement) => !landed.has(placement.clip.id))
  // 验证整棵时间轴，不只验证 clip id：字幕、转场、URL、裁剪参数任何一个被
  // reducer/归一化吞掉，都属于 apply 不完整，必须走同一条 compensation。
  if (missing.length > 0 || JSON.stringify(after) !== JSON.stringify(expected)) {
    const restored = (() => {
      try { return ports.restoreTimeline(base) } catch { return false }
    })()
    const message = missing.length > 0
      ? `采纳写入后校验失败：${missing.length} 个片段没落到轴上`
      : '采纳写入后校验失败：时间轴内容未完整落定'
    return restored
      ? { ok: false, recovered: true, error: message }
      : { ok: false, recovered: false, error: message }
  }

  return { ok: true, timeline: after, clipIds: placements.map((placement) => placement.clip.id) }
}
