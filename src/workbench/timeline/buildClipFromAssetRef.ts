import type { AssetRef } from '../assets/assetTypes'
import type { TimelineClip } from './timelineTypes'

const DEFAULT_AUDIO_SECONDS = 10

/**
 * 素材库 AssetRef（音频）→ 时间轴 audio clip。
 *
 * 与 buildClipFromGenerationNode 是姊妹：那条从画布生成节点建 clip，这条从「池里已有的素材」建。
 * 音频没有源节点 → 合成稳定 sourceNodeId（'asset:' + assetRef.id；项目文件的 id = relativePath，稳定可读）。
 * 导出/混音读 clip.url（nomi-local://），exportJobs 会 ffprobe 它拿真实时长 + 混音（见
 * docs/plan/2026-06-25-audio-first-class-timeline.md「导出侧已通」）。
 *
 * durationSeconds 由调用方离屏探测（readAudioDurationSeconds）后传入；缺省回落默认，用户可拖 trim。
 */
export function buildAudioClipFromAssetRef(
  asset: AssetRef,
  options: { fps: number; startFrame: number; durationSeconds?: number | null },
): TimelineClip | null {
  if (asset.kind !== 'audio') return null
  const url = String(asset.renderUrl || '').trim()
  if (!url) return null

  const fps = options.fps > 0 ? options.fps : 30
  const startFrame = Math.max(0, Math.floor(options.startFrame))
  const seconds = options.durationSeconds && options.durationSeconds > 0 ? options.durationSeconds : DEFAULT_AUDIO_SECONDS
  const frameCount = Math.max(1, Math.round(seconds * fps))
  const sourceNodeId = `asset:${asset.id}`

  return {
    id: `clip-${sourceNodeId}-audio-${startFrame}`,
    type: 'audio',
    sourceNodeId,
    label: asset.name || '音频',
    startFrame,
    endFrame: startFrame + frameCount,
    frameCount,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
    url,
  }
}
