import type { TimelineState } from '../../timeline/timelineTypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

/** 面板里时间轴用的帧率：只是「帧」这个刻度的单位（0.1 秒精度读数 / 手势吸附），不是视频真实帧率。 */
export const TRIM_FPS = 30
export const TRIM_CLIP_ID = 'video-trim-clip'
export const CLIP_PANEL_WIDTH = 480

/** 节点上记着的时长（没有 / 不准时以播放器读到的为准）。 */
export function knownTrimDuration(node: GenerationCanvasNode): number {
  const candidates = [node.result?.durationSeconds, node.meta?.videoDuration, node.meta?.durationSeconds]
  return candidates.find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0) ?? 0
}

/** 一条视频放成一个片段：片段的左右边就是入点 / 出点，交给剪辑节点那条时间轴去画、去拖。 */
export function makeTrimTimeline(node: GenerationCanvasNode, durationSeconds: number, inFrame: number, outFrame: number, playheadFrame: number): TimelineState {
  const total = Math.max(1, Math.round(durationSeconds * TRIM_FPS))
  return {
    version: 1,
    fps: TRIM_FPS,
    scale: 1,
    playheadFrame,
    textClips: [],
    tracks: [{
      id: 'video-trim-track',
      type: 'video',
      label: '',
      clips: [{
        id: TRIM_CLIP_ID,
        type: 'video',
        sourceNodeId: node.id,
        label: node.title || '',
        startFrame: inFrame,
        endFrame: outFrame,
        frameCount: total,
        offsetStartFrame: inFrame,
        offsetEndFrame: Math.max(0, total - outFrame),
        url: node.result?.url ?? '',
        ...(node.result?.thumbnailUrl ? { thumbnailUrl: node.result.thumbnailUrl } : {}),
      }],
    }],
  }
}
