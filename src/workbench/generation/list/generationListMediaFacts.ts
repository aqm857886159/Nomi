// 列表卡 / 大详情从节点读的几件小事实（画幅、时长）。纯函数，只读节点。
import { readAudioMeta } from '../../generationCanvas/model/nodeMetaFields'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'

export function readAspect(node: GenerationCanvasNode | undefined): string | null {
  const value = node?.meta?.aspect_ratio
  return typeof value === 'string' && /^\d+:\d+$/.test(value) ? value : null
}

export function readDurationSeconds(node: GenerationCanvasNode): number | null {
  const meta = node.meta ?? {}
  const audio = readAudioMeta(node).durationSec
  const value = node.kind === 'audio' ? audio : meta.duration
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export function formatSeconds(seconds: number): string {
  const whole = Math.round(seconds)
  return whole >= 60 ? `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}` : `${whole}s`
}
