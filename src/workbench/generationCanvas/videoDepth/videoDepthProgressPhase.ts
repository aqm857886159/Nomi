/**
 * 深度处理写进 `node.progress.phase` 时的那个词表 —— **唯一 owner**。
 *
 * 为什么单独成一个只有三行的模块，而不是塞进 videoDepthNodeModel：读它的一方里有
 * `model/taskCancellation`（判「这一次能不能中断」），而 videoDepthNodeModel 反过来要
 * `model/generationCanvasTypes` 的类型——两边互引就是一个静态环（check:boundaries 会红）。
 * 这个文件只依赖跨进程契约里的阶段词表，谁都能引，环不成立。
 *
 * 为什么不让读写两方各拼一次 `'video-depth-' + phase`：那是同一个词表两份定义。
 * 改前缀时必然漏改一处，而漏改的表现是「遮罩不显示进度也不给取消」——看起来像样式问题。
 */
import type { VideoDepthPhase } from '../../../../electron/shared/canvas/videoDepthRun'

export const VIDEO_DEPTH_PROGRESS_PREFIX = 'video-depth-'

/** 运行阶段 → 节点进度 phase。 */
export function videoDepthProgressPhase(phase: VideoDepthPhase): string {
  return `${VIDEO_DEPTH_PROGRESS_PREFIX}${phase}`
}

/** 这个节点进度是不是深度处理产生的（遮罩据此走「活进度 + 活预览 + 可取消」那一档）。 */
export function isVideoDepthProgressPhase(phase: string | undefined): boolean {
  return typeof phase === 'string' && phase.startsWith(VIDEO_DEPTH_PROGRESS_PREFIX)
}
