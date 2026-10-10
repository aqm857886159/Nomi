/**
 * 「本机处理」写进 `node.progress.phase` 的词表入口 —— **唯一 owner**。
 *
 * 本机处理 = 全在这台电脑上做、没有任何模型 / 服务商参与的耗时步骤（提取深度、直接剪辑……）。它们共享同一套外观与语义：
 * 卡顶一条「阶段 · 百分比 [取消]」的进度条（不套生成等待层）、能取消（取消 = 当没发生过）、失败走 `local-processing` 失败类。
 * 各自的阶段前缀留在各自的模块里（深度：`video-depth-`；剪辑：`video-trim-`），读的人只问这一个函数，
 * 不要在遮罩 / 状态条 / 取消入口各写一遍「是不是深度」。
 */
import { isVideoDepthProgressPhase } from '../videoDepth/videoDepthProgressPhase'

export const VIDEO_TRIM_PROGRESS_PREFIX = 'video-trim-'

export function videoTrimProgressPhase(phase: 'running'): string {
  return `${VIDEO_TRIM_PROGRESS_PREFIX}${phase}`
}

export function isLocalProcessingProgressPhase(phase: string | undefined): boolean {
  return isVideoDepthProgressPhase(phase) || (typeof phase === 'string' && phase.startsWith(VIDEO_TRIM_PROGRESS_PREFIX))
}
