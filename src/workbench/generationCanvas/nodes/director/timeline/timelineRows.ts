/**
 * [INPUT]: 依赖 ../model/timelineTracks 的 TimelineTrack / TimelineSubTrack
 * [OUTPUT]: 对外提供 ROW_HEIGHT、TimelineRow、buildTimelineRows、rowTop、subTrackHasContent
 * [POS]: director/timeline 的行模型：主行泳道放路径片段 + 机位的特写片段；副行只在有内容时长出，
 *        顺序 动作 → 骨骼帧 → 视线 → 空间轨迹（路标菱形住这一行，不画在片段上）；折叠的轨道只出主行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TimelineSubTrack, TimelineTrack } from '../model/timelineTracks'

// 每行 28px（h-7）
export const ROW_HEIGHT = 28

export type TimelineRow =
  | { key: string; kind: 'main'; track: TimelineTrack; index: number }
  | { key: string; kind: 'sub'; track: TimelineTrack; sub: TimelineSubTrack }

export function subTrackHasContent(sub: TimelineSubTrack): boolean {
  return sub.clips.length > 0 || sub.markers.length > 0
}

// 副轨顺序：动作 → 骨骼帧 → 视线 → 空间轨迹；特写片段不是副轨（画在机位主行）
const SUB_ROW_ORDER: TimelineSubTrack['family'][] = ['action', 'bone', 'lookat', 'trajectory']

export function buildTimelineRows(tracks: TimelineTrack[]): TimelineRow[] {
  const rows: TimelineRow[] = []
  tracks.forEach((track, index) => {
    rows.push({ key: `main:${track.entityId}`, kind: 'main', track, index })
    if (track.folded) return
    for (const family of SUB_ROW_ORDER) {
      const sub = track.subTracks.find((item) => item.family === family)
      if (!sub) continue
      // 空间轨迹副行只看路标（片段在主行）；其余家族片段 / 标记有一个就长出来
      const hasContent = family === 'trajectory' ? sub.markers.length > 0 : subTrackHasContent(sub)
      if (!hasContent) continue
      rows.push({ key: `sub:${track.entityId}:${sub.family}`, kind: 'sub', track, sub })
    }
  })
  return rows
}

export function rowTop(index: number): number {
  return index * ROW_HEIGHT
}
