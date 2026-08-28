import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { isShotNumberedNode } from '../model/shotNumbering'
import i18n from '../../../i18n'

/**
 * 把一张「分镜画布」规划成「时间轴排片清单」——给 Agent 的 arrange_storyboard_to_timeline
 * 工具和手动「发送到时间轴」共用的**纯函数**（同输入必同输出，无 store 依赖，易单测）。
 *
 * 排序信号 = `shotIndex` 镜号（拆镜头时按提交顺序写死 = 剧本时序，是存储身份、
 * 拖动不变）。**绝不靠 LLM 读 prompt/标题猜顺序，也不靠坐标/连线**（都不稳）。
 *
 * 排片单位以**视频节点**为镜位：
 * - 视频已生成 → 放视频本身（role: 'video'）
 * - 视频未生成但有关键帧图 → 用关键帧占位（role: 'placeholder'，占该视频的镜位），保成片不断档
 * - 都没有 → 跳过并回报原因
 * - 关键帧被某视频引用的 → 不再独立成片（dedup，由视频镜位代表）
 * - 没有视频节点的纯图镜头（单层模式 / 漫画故事板）→ 按 shotIndex 直接成片（role: 'still'）
 */

export type StoryboardTimelineUnitRole = 'video' | 'placeholder' | 'still'

export type StoryboardTimelineUnit = {
  /** 真正落 clip 的节点 id（视频节点，或被借作占位的关键帧节点）。 */
  nodeId: string
  /** 排序用的镜号（占位单位沿用其视频镜位的 shotIndex）。 */
  shotIndex: number
  role: StoryboardTimelineUnitRole
}

export type StoryboardTimelinePlan = {
  units: StoryboardTimelineUnit[]
  skipped: Array<{ nodeId: string; reason: string }>
  scopeError?: StoryboardTimelineScopeError
}

export type StoryboardTimelineScope = {
  nodeIds?: readonly string[]
  storyboardDesignId?: string
}

export type StoryboardTimelineScopeError = 'ambiguous_storyboard_scope' | 'mixed_storyboard_scope'

const LAST_ORDER = Number.MAX_SAFE_INTEGER

function hasUsableResult(node: GenerationCanvasNode): boolean {
  return Boolean(node.result?.url && String(node.result.url).trim())
}

function hasVideoResult(node: GenerationCanvasNode): boolean {
  return node.result?.type === 'video' && hasUsableResult(node)
}

function isImageNode(node: GenerationCanvasNode): boolean {
  return getGenerationNodeExecutionKind(node.kind) === 'image'
}

function isVideoNode(node: GenerationCanvasNode): boolean {
  return getGenerationNodeExecutionKind(node.kind) === 'video'
}

function shotOrder(node: GenerationCanvasNode | undefined): number {
  return typeof node?.shotIndex === 'number' ? node.shotIndex : LAST_ORDER
}

function storyboardDesignIdOf(node: GenerationCanvasNode): string | undefined {
  const value = node.meta?.storyboardDesignId
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function emptyScopePlan(scopeError: StoryboardTimelineScopeError): StoryboardTimelinePlan {
  return { units: [], skipped: [], scopeError }
}

export function planStoryboardTimeline(
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
  scope: StoryboardTimelineScope = {},
): StoryboardTimelinePlan {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const allShots = nodes.filter(isShotNumberedNode)
  const requestedNodeIds = scope.nodeIds?.length ? new Set(scope.nodeIds) : null
  const requestedDesignId = scope.storyboardDesignId?.trim() || undefined
  const selectedShots = requestedNodeIds ? allShots.filter((node) => requestedNodeIds.has(node.id)) : allShots
  const selectedDesignIds = new Set(selectedShots.map(storyboardDesignIdOf).filter(Boolean))

  if (requestedNodeIds && selectedDesignIds.size > 1) return emptyScopePlan('mixed_storyboard_scope')

  const inferredDesignId = requestedDesignId
    ?? (!requestedNodeIds && selectedDesignIds.size === 1 ? [...selectedDesignIds][0] : undefined)
  if (!requestedNodeIds && !requestedDesignId && selectedDesignIds.size > 1) {
    return emptyScopePlan('ambiguous_storyboard_scope')
  }

  const shots = selectedShots.filter((node) => !inferredDesignId || storyboardDesignIdOf(node) === inferredDesignId)
  const videoNodes = shots.filter(isVideoNode)

  const referenceIsInScope = (node: GenerationCanvasNode): boolean => (
    !inferredDesignId || storyboardDesignIdOf(node) === inferredDesignId
  )

  // 某视频的「关键帧来源」= 入边里 first_frame / 通用引用边的 image 源节点（首个命中）。
  const imageSourcesOf = (video: GenerationCanvasNode): GenerationCanvasNode[] =>
    edges
      .filter((edge) => edge.target === video.id)
      .map((edge) => byId.get(edge.source))
      .filter((node): node is GenerationCanvasNode => (
        Boolean(node) && isImageNode(node!) && referenceIsInScope(node!)
      ))
  const firstFrameOf = (video: GenerationCanvasNode): GenerationCanvasNode | null => {
    const sources = edges
      .filter(
        (edge) =>
          edge.target === video.id &&
          (edge.mode === 'first_frame' || edge.mode === 'reference' || edge.mode == null),
      )
      .map((edge) => byId.get(edge.source))
      .filter((node): node is GenerationCanvasNode => (
        Boolean(node) && isImageNode(node!) && referenceIsInScope(node!)
      ))
    return sources[0] ?? null
  }

  // 被任意视频引用的图片节点 = 该镜的关键帧，不再独立成片（由视频镜位代表）。
  const consumed = new Set<string>()
  for (const video of videoNodes) {
    for (const source of imageSourcesOf(video)) consumed.add(source.id)
  }

  const units: StoryboardTimelineUnit[] = []
  const skipped: StoryboardTimelinePlan['skipped'] = []

  for (const video of videoNodes) {
    if (hasVideoResult(video)) {
      units.push({ nodeId: video.id, shotIndex: shotOrder(video), role: 'video' })
      continue
    }
    const keyframe = firstFrameOf(video)
    if (keyframe && hasUsableResult(keyframe)) {
      // 占位沿用视频的镜位（shotIndex），保证它落在该镜头应在的剧本位置。
      units.push({ nodeId: keyframe.id, shotIndex: shotOrder(video), role: 'placeholder' })
    } else {
      skipped.push({
        nodeId: video.id,
        reason: keyframe
          ? i18n.t('generationCommon.agentRuntime.videoAndKeyframeMissing')
          : i18n.t('generationCommon.agentRuntime.videoAndPlaceholderMissing'),
      })
    }
  }

  // 纯图镜头（未被任何视频消费）：单层拆镜 / 漫画故事板直接成片。
  const placedIds = new Set(units.map((unit) => unit.nodeId))
  for (const node of shots) {
    if (!isImageNode(node)) continue
    if (consumed.has(node.id) || placedIds.has(node.id)) continue
    if (hasUsableResult(node)) {
      units.push({ nodeId: node.id, shotIndex: shotOrder(node), role: 'still' })
    } else {
      skipped.push({ nodeId: node.id, reason: i18n.t('generationCommon.agentRuntime.shotNotGenerated') })
    }
  }

  units.sort((a, b) => {
    if (a.shotIndex !== b.shotIndex) return a.shotIndex - b.shotIndex
    const ay = byId.get(a.nodeId)?.position?.y ?? 0
    const by = byId.get(b.nodeId)?.position?.y ?? 0
    if (ay !== by) return ay - by
    return a.nodeId.localeCompare(b.nodeId)
  })

  return { units, skipped }
}

export function planActiveStoryboardTimeline(
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
  activeStoryboardDesignId: string | null,
): StoryboardTimelinePlan {
  return planStoryboardTimeline(nodes, edges, activeStoryboardDesignId
    ? { storyboardDesignId: activeStoryboardDesignId }
    : {})
}
