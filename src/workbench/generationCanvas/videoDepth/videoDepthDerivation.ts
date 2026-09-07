/**
 * 「提取深度」——「从画布上一段视频派生出一段深度视频」的**纯模型层**（无 React、无 store、无 IPC）。
 *
 * 2026-09-07 用户看过独立节点的界面后拍板改形态：深度视频**不是一种节点**，而是视频节点上的
 * 一个动作。所以这一层要回答的三个问题也跟着换了——不再是「画布上有哪些视频能当源」
 * （那是独立节点才需要问的，因为它自己不知道自己在给谁干活），而是：
 *   ① 这个被选中的节点能不能提取深度；
 *   ② 产物落在哪；
 *   ③ 产物叫什么（出身要写在名字里）。
 * 三个都是纯函数能答的，所以它们住这里、被单测钉住；界面只负责把答案画出来。
 */
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { VideoDepthSourceReference } from '../../../../electron/shared/canvas/videoDepth'

/**
 * 派生产物与源节点之间的横向缝隙。与「抽首/尾帧」落位用同一个数
 * （见 extractVideoFrameToNode）——同一条「选中 → 动作 → 旁边长出产物」的动线上，
 * 两个动作把产物放在不同距离，用户看到的是「随机」，不是「规则」。
 */
export const VIDEO_DEPTH_DERIVED_GAP = 64

/**
 * 这个节点能不能当深度源。
 *
 * 判据是 `result.type === 'video'` 而不是 `kind`：生成出来的视频、导入的素材、
 * 甚至上一次深度处理的产物，对这条管线来说是同一件东西（一段本地可读的视频）。
 * 按 kind 过滤会漏掉将来任何新的产视频节点——而那正是「加了新节点却用不了这个动作」的来源。
 */
export function videoDepthSourceFromNode(node: GenerationCanvasNode): VideoDepthSourceReference | null {
  const result = node.result
  if (!result || result.type !== 'video' || !result.url) return null
  return {
    sourceNodeId: node.id,
    sourceUrl: result.url,
    title: node.title?.trim() || node.prompt?.trim().slice(0, 40) || result.id,
    ...(typeof result.durationSeconds === 'number' ? { durationSeconds: result.durationSeconds } : {}),
  }
}

/**
 * 产物落在源节点**右边一个身位**——与抽帧同一条规则。
 * 不加 y 偏移：深度产物是这段视频的一个平行版本，摆在同一水平线上读起来就是「同一件事的另一面」。
 */
export function videoDepthDerivedPosition(
  sourcePosition: { x: number; y: number },
  sourceSize: { width: number; height: number },
): { x: number; y: number } {
  return { x: sourcePosition.x + sourceSize.width + VIDEO_DEPTH_DERIVED_GAP, y: sourcePosition.y }
}

/**
 * 出身写进标题：`镜头 1 · 深度`。
 *
 * 为什么不叫「深度-镜头 1」（能力名在前）：画布上一列节点标题是竖着读的，前缀相同的一批标题
 * 前几个字全一样，得读到后半截才分得出是哪一段。源名在前 = 一眼知道它是从谁来的，
 * 后缀说明它是什么。`suffix` 由调用方给（i18n 在界面层，这里保持纯）。
 */
export function videoDepthDerivedTitle(sourceTitle: string, suffix: string): string {
  const source = sourceTitle.trim()
  return source ? `${source} · ${suffix}` : suffix
}
