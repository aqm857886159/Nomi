import { DEFAULT_IMAGE_SECONDS } from '../../generationCanvas/model/buildClipFromGenerationNode'
import { effectiveShotDurationSec, type PlanShot, type StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import type { StoryboardRowRuntime } from './exec/storyboardRowStatus'

/** D 段周边交互的纯函数 owner：视图只投影这些结果，不另存一份状态快照。 */

export type StoryboardPlaybackItem = {
  shot: PlanShot
  runtime: StoryboardRowRuntime
  mediaUrl: string
  mediaKind: 'image' | 'video'
  /** 只用于图片；视频由真实媒体的 ended 事件推进。 */
  durationSec: number
}

export function shotsReferencingAnchor(plan: StoryboardPlan, anchorId: string): PlanShot[] {
  return plan.shots.filter((shot) => shot.anchorIds.includes(anchorId))
}

export function positionsForAnchorFilter(plan: StoryboardPlan, anchorId: string | null): number[] {
  if (!anchorId) return plan.shots.map((_shot, position) => position)
  return plan.shots.reduce<number[]>((positions, shot, position) => {
    if (shot.anchorIds.includes(anchorId)) positions.push(position)
    return positions
  }, [])
}

export function filterPlanByAnchor(plan: StoryboardPlan, anchorId: string | null): StoryboardPlan {
  if (!anchorId) return plan
  return { ...plan, shots: shotsReferencingAnchor(plan, anchorId) }
}

export function hiddenGeneratingCount(
  rows: readonly StoryboardRowRuntime[],
  visiblePositions: readonly number[],
): number {
  const visible = new Set(visiblePositions)
  return rows.reduce((count, row, position) => count + (!visible.has(position) && row.exec.status === 'generating' ? 1 : 0), 0)
}

/** 顺播只把已生成结果排进队列；被跳过的镜数由调用方提示用户。 */
export function buildStoryboardPlaybackQueue(
  rows: readonly StoryboardRowRuntime[],
): StoryboardPlaybackItem[] {
  return rows.flatMap((runtime) => {
    const mediaUrl = runtime.exec.node?.result?.url || runtime.exec.node?.result?.thumbnailUrl || ''
    if (!mediaUrl || (runtime.exec.status !== 'done' && runtime.exec.status !== 'locked')) return []
    const mediaKind = runtime.shot.shotKind === 'image' ? 'image' : 'video'
    return [{
      shot: runtime.shot,
      runtime,
      mediaUrl,
      mediaKind,
      durationSec: effectiveShotDurationSec(runtime.shot) || DEFAULT_IMAGE_SECONDS,
    }]
  })
}
