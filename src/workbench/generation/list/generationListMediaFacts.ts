// 列表卡 / 大详情、指向元素与付费卡的摘要从节点读的几件小事实（画幅、时长）。纯函数，只读节点。
import { readAudioMeta } from '../../generationCanvas/model/nodeMetaFields'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { nodeAspectRatioValue } from '../../generationCanvas/nodes/aspectRatio'
import { normalizeAspectRatioToWH } from '../../../../electron/shared/aspectRatioValue'
import { admitNumber, isFiniteNumber } from '../../../../electron/shared/videoCapabilities/paramValue'

/** 节点此刻的比例，印成「W:H」（具名档 `landscape_16_9` 印成 16:9）。读的是画布节点形状同一个值（`nodeAspectRatioValue`）。 */
export function readAspect(node: GenerationCanvasNode | undefined): string | null {
  return normalizeAspectRatioToWH(nodeAspectRatioValue(node))
}

export function readDurationSeconds(node: GenerationCanvasNode): number | null {
  const meta = node.meta ?? {}
  const audio = readAudioMeta(node).durationSec
  // 视频时长经值门读（字符串时长档案存的 "12" 以前在这里读不出来，卡上不显示秒数）。
  const value = node.kind === 'audio' ? audio : admitNumber(meta.duration)
  return isFiniteNumber(value) && value > 0 ? value : null
}

export function formatSeconds(seconds: number): string {
  const whole = Math.round(seconds)
  return whole >= 60 ? `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}` : `${whole}s`
}
