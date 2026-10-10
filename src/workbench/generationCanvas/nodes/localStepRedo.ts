import { retryLocalAssetImport } from '../adapters/assetImportAdapter'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { retryVideoFrameCapture } from './extractVideoFrameToNode'
import { retryVideoTrim } from './trimVideoToNode'
import { hasLocalRedoFacts } from '../model/localProcessingPhase'

/**
 * 本机处理失败卡的「重试」该做什么——**单一出处**（BaseGenerationNode 的失败卡读它）。
 *
 * 为什么要它：本机处理的失败（本地素材复制、截帧、剪辑……）重试的是「那一步本机处理」，不是「再生成一次」；
 * 把它们各自写成失败卡里的一条 `meta.xxx ? a : b` 分支，每来一个本机入口就多一条特例。
 * 现在：节点上记着 `meta.retryableXxx`（只有失败时才为 true）→ 这里一张表找到对应的重试动作；
 * 没有命中返回 null，调用方再走原来的「重新生成」。
 */
export function localStepRedoOf(node: GenerationCanvasNode, reportFeedback: (message: string) => void): (() => void) | null {
  if (node.meta?.retryableImport === true) return () => { void retryLocalAssetImport(node.id) }
  if (node.meta?.retryableFrame === true) return () => { void retryVideoFrameCapture(node.id, reportFeedback) }
  // 剪辑：卡上记着区间、却没有结果 = 这次剪辑没成，重试 = 同一段再剪一次（不用事后清的旗：见 trimVideoToNode）。
  if (hasLocalRedoFacts(node)) return () => { retryVideoTrim(node.id, reportFeedback) }
  return null
}
