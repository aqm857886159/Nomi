import { insertAutoMentions } from '../assets/promptMentions'
import { resultUrl } from './runner/referenceUrl'
import { referenceAssetKindForNode, validateReferenceEdge, archetypeForNode } from './agent/referenceEdgeCapability'
import { resolveMentionReference } from './model/canvasReferenceConnection'
import { applyArchetypeModeSwitch } from './nodes/controls/archetypeMeta'
import { currentReferenceMedia } from './nodes/mentionCandidates'
import { useGenerationCanvasStore } from './store/generationCanvasStore'
import { isProjectExecutionContextCurrent, subscribeProjectOpened } from '../project/projectCanvasReadSurface'
import i18n from '../../i18n'
import type { GenerationCanvasEdge, GenerationCanvasEdgeMode, GenerationCanvasNode } from './model/generationCanvasTypes'

/**
 * 画布这一侧的**自动引用调用方**（owner 是 `insertAutoMentions`，分镜那一侧调同一个函数）。
 *
 * 一个图片节点出图了 → 同一张画布上、提示词里写了这个节点**标题**的那些节点：在标题第一次出现的地方后面
 * 补一枚 @，并且像用户手动 @ 一样建一条真参考边（同一把能力校验闸 `validateReferenceEdge`、同一个落槽判据
 * `resolveMentionReference`——当前模式收不了参考图就切到能收的模式，与手动 @ 完全一致）。
 *
 * 范围（设计卡 §B 第 7 条）：
 *   · 目标只取**还没出图、也不在跑**的图片 / 视频节点——已经出过图的节点改提示词会让「图」和「词」对不上；
 *   · 分镜方案落出来的节点不碰（它们的提示词由方案投影写，分镜那一侧自己补）；
 *   · 标题至少两个字，且不是系统给的默认标题（「参考图片」「提示词」这类会在提示词里自然出现）；
 *   · 账本记在目标节点 `meta.autoReferenced`（来源节点 id）：用户删掉那枚 @，同一个节点不再补回来。
 */

export const CANVAS_AUTO_REFERENCED_META_KEY = 'autoReferenced'

export type CanvasAutoReferencePlan = {
  targetId: string
  prompt: string
  autoReferenced: string[]
  switchToModeId: string | null
  edgeMode: GenerationCanvasEdgeMode
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 纯函数：source 出图后，哪些节点要补、补成什么样。 */
export function planCanvasAutoReference(
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
  sourceId: string,
  ignoredTitles: ReadonlySet<string>,
): CanvasAutoReferencePlan[] {
  const source = nodes.find((node) => node.id === sourceId)
  if (!source || referenceAssetKindForNode(source) !== 'image') return []
  const url = resultUrl(source.result)
  const title = (source.title || '').trim()
  if (!url || title.length < 2 || ignoredTitles.has(title)) return []
  const plans: CanvasAutoReferencePlan[] = []
  for (const target of nodes) {
    if (target.id === source.id) continue
    if (target.kind !== 'image' && target.kind !== 'video') continue
    if (target.result || target.status === 'running' || target.status === 'queued' || target.status === 'recoverable') continue
    const meta = (target.meta || {}) as Record<string, unknown>
    if (meta.storyboardDesignId) continue
    if (target.categoryId !== source.categoryId) continue
    const applied = stringList(meta[CANVAS_AUTO_REFERENCED_META_KEY])
    const result = insertAutoMentions(target.prompt || '', [{ key: source.id, name: title, url }], applied)
    if (result.inserted.length === 0) continue
    const route = resolveMentionReference(target, nodes, edges, 'image')
    if (!route.ok) continue
    if (!validateReferenceEdge(source, target, route.edgeMode).ok) continue
    plans.push({ targetId: target.id, prompt: result.prompt, autoReferenced: result.applied, switchToModeId: route.switchToModeId, edgeMode: route.edgeMode })
  }
  return plans
}

/** 把计划写进画布 store：切模式 → 建边 → 写提示词与账本；引用没真落进槽就整条撤回（与手动 @ 同一条兜底）。 */
export function applyCanvasAutoReference(sourceId: string, ignoredTitles: ReadonlySet<string>): void {
  const store = useGenerationCanvasStore.getState()
  const source = store.nodes.find((node) => node.id === sourceId)
  const url = resultUrl(source?.result)
  for (const plan of planCanvasAutoReference(store.nodes, store.edges, sourceId, ignoredTitles)) {
    const state = useGenerationCanvasStore.getState()
    const target = state.nodes.find((node) => node.id === plan.targetId)
    if (!target || !url) continue
    const metaBefore = (target.meta || {}) as Record<string, unknown>
    const edgeIdsBefore = new Set(state.edges.map((edge) => edge.id))
    const archetype = plan.switchToModeId ? archetypeForNode(target) : null
    const meta = archetype && plan.switchToModeId ? applyArchetypeModeSwitch(metaBefore, archetype, plan.switchToModeId) : metaBefore
    if (meta !== metaBefore) state.updateNode(target.id, { meta })
    state.connectNodes(sourceId, target.id, plan.edgeMode)
    const after = useGenerationCanvasStore.getState()
    const afterTarget = after.nodes.find((node) => node.id === target.id)
    const landed = afterTarget ? currentReferenceMedia(afterTarget, after.nodes, after.edges).some((reference) => reference.url === url) : false
    if (!landed) {
      for (const edge of after.edges) if (!edgeIdsBefore.has(edge.id) && edge.target === target.id) after.disconnectEdge(edge.id)
      after.updateNode(target.id, { meta: metaBefore })
      continue
    }
    after.updateNode(target.id, {
      prompt: plan.prompt,
      meta: { ...((afterTarget?.meta || {}) as Record<string, unknown>), [CANVAS_AUTO_REFERENCED_META_KEY]: plan.autoReferenced },
    })
  }
}

/** 系统给的默认标题（中英两份）：它们会在提示词里自然出现，不能当「名字」。 */
function defaultTitles(): Set<string> {
  const keys = ['referenceImage', 'referenceVideo', 'prompt', 'webMedia'] as const
  return new Set(['zh-CN', 'en'].flatMap((lng) => keys.map((key) => i18n.t(`generationCommon.defaultTitles.${key}`, { lng }))))
}

/**
 * 每打开一个项目签发一次：盯着画布节点，**新出**的图片结果触发一次自动引用。
 * 打开项目时已经在的结果只记下、不触发——打开一个旧项目不该改动任何节点。返回解除函数。
 */
export function initCanvasAutoReferenceBridge(): () => void {
  let unsubscribeStore: () => void = () => undefined
  const unsubscribeOpened = subscribeProjectOpened((project) => {
    unsubscribeStore()
    const ignored = defaultTitles()
    const seen = new Map<string, string>()
    for (const node of useGenerationCanvasStore.getState().nodes) seen.set(node.id, resultUrl(node.result))
    unsubscribeStore = useGenerationCanvasStore.subscribe((state, previous) => {
      if (state.nodes === previous.nodes || !isProjectExecutionContextCurrent(project)) return
      const fresh: string[] = []
      for (const node of state.nodes) {
        const url = resultUrl(node.result)
        if (seen.get(node.id) === url) continue
        seen.set(node.id, url)
        if (url && referenceAssetKindForNode(node) === 'image') fresh.push(node.id)
      }
      for (const id of fresh) applyCanvasAutoReference(id, ignored)
    })
  })
  return () => {
    unsubscribeOpened()
    unsubscribeStore()
  }
}
