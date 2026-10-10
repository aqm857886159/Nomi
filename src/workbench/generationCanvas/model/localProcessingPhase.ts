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

/**
 * 本机处理被打断（关窗 / 切走项目）后，这张卡「重来一次」要用的事实：有就可以重试，没有就只能清掉幽灵转圈。
 * 剪辑卡出生就记着区间（`meta.trimStart` / `trimEnd`）；截帧是抽完才落卡、从不以 running 落盘，深度处理没有「重试」这回事。
 * 唯一出处：载入收口（store/canvasSnapshotNormalizer）与失败卡的重试（nodes/localStepRedo）读同一份判断。
 */
export function hasLocalRedoFacts(node: { meta?: Record<string, unknown> | undefined; result?: unknown }): boolean {
  return typeof node.meta?.trimStart === 'number' && typeof node.meta?.trimEnd === 'number' && !node.result
}
