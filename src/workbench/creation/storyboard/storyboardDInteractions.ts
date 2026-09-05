import { DEFAULT_IMAGE_SECONDS } from '../../generationCanvas/model/buildClipFromGenerationNode'
import { effectiveShotDurationSec, type PlanShot, type StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import type { StoryboardRowRuntime } from './exec/storyboardRowStatus'
import { canvasNodeToAssetRefs } from '../../assets/assetTypes'

/** D 段周边交互的纯函数 owner：视图只投影这些结果，不另存一份状态快照。 */

export type StoryboardPlaybackItem = {
  shot: PlanShot
  runtime: StoryboardRowRuntime
  mediaUrl: string | null
  mediaKind: 'image' | 'video' | null
  audioUrl: string | null
  /** Empty rows stay in the list so the player can show a gray progress segment. */
  playable: boolean
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

export function resolveResultTargetShotIndex(
  shots: readonly PlanShot[],
  sourceIndex: number,
  requestedIndex?: number | null,
): number | null {
  if (requestedIndex !== undefined && requestedIndex !== null && requestedIndex >= 0 && requestedIndex < shots.length && requestedIndex !== sourceIndex) {
    return requestedIndex
  }
  const next = shots.findIndex((shot, index) => index > sourceIndex && Boolean(shot.shotId || shot.index))
  return next >= 0 ? next : null
}

/**
 * 播放清单的唯一 owner：每一行都保留顺序，未生成行以 playable=false 占位。
 * 场播放和整片播放都走这里，避免一条入口把缺失镜头静默删掉而另一条入口计数不一致。
 */
export function buildStoryboardPlaybackQueue(
  rows: readonly StoryboardRowRuntime[],
): StoryboardPlaybackItem[] {
  return rows.map((runtime) => {
    const assets = runtime.exec.node ? canvasNodeToAssetRefs(runtime.exec.node) : []
    const visual = assets.find((asset) => asset.kind === 'image' || asset.kind === 'video')
    const audio = assets.find((asset) => asset.kind === 'audio')
    const mediaUrl = visual?.renderUrl || null
    const mediaKind = visual?.kind === 'video' ? 'video' : visual?.kind === 'image' ? 'image' : null
    const playable = Boolean(mediaUrl) && (runtime.exec.status === 'done' || runtime.exec.status === 'locked')
    return {
      shot: runtime.shot,
      runtime,
      mediaUrl,
      mediaKind,
      audioUrl: audio?.renderUrl || null,
      playable,
      durationSec: effectiveShotDurationSec(runtime.shot) || DEFAULT_IMAGE_SECONDS,
    }
  })
}
