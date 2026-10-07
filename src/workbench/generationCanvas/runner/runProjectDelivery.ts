import { stableProjectAgentJson } from '../../../../electron/shared/legacyAgentJson'
import { getGenerationNodeCatalogKind } from '../model/generationNodeKinds'
import { selectedVendor, selectedModelKey } from './catalogTaskResolve'
import { resolveRenderedControls } from '../nodes/nodeModelArchetype'
import { archetypeForNode, resolveModeForConnectedReferences } from '../agent/referenceEdgeCapability'
import { applyArchetypeModeSwitch, currentArchetypeMode, currentArchetypeVariant } from '../nodes/controls/archetypeMeta'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { collectConnectedTextPromptParts } from './connectedTextPrompt'
import { getTextGenMode, textDocumentDigest } from './textGenerationDocument'
// 后台运行（已提交的生成 / 找回 / 本地派生）的项目归属与结局投递——唯一实现。
//
// 已批准行为：已提交的后台生成属于**原项目**，用户切页/切项目都不取消它。所以运行的项目身份
// 在提交那一刻固定（RunProjectTarget = 完整 ProjectBinding），之后只读它，绝不重读「当前项目」：
//   · 原项目正打开 → 结局照常写进画布 store（用户立刻看见）；
//   · 原项目不在前台 → 走既有的按项目读写盘路径（localProjectStore，与关闭项目删结果同一个 owner），
//     用户回到原项目时就在节点上看到；新项目零副作用。
import { sameProjectAgentBinding, type ProjectBinding } from '../../../../electron/shared/projectBinding'
import { isProjectBindingOpen } from '../../project/projectCanvasReadSurface'
import { readLocalProjectAsync, saveLocalProject } from '../../library/localProjectStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { nodeRunOutcomePatch, type NodeRunOutcome } from '../store/nodeRunOutcome'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

export type RunProjectTarget = ProjectBinding

/** 运行所属项目此刻是否就是画布里加载着的那个（身份逐字段比，不按 id 猜）。 */
export function isRunTargetLoaded(target: RunProjectTarget): boolean {
  return isProjectBindingOpen(target)
}

/** 仅当原项目正打开时才执行（进度、占位等瞬态只给前台看，不写别的项目）。 */
export function whenRunTargetLoaded(target: RunProjectTarget, apply: () => void): boolean {
  if (!isRunTargetLoaded(target)) return false
  apply()
  return true
}

/** true = 结局写进了正打开的原项目画布（节点已不在则只暂存记账、返回 false）。 */
function applyToStore(nodeId: string, outcome: NodeRunOutcome): boolean {
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find(candidate => candidate.id === nodeId)
  if (!node) {
    // 节点在生成中被删了（删节点不取消上游任务，钱已花）：结局暂存，撤销把节点带回来时落上去。进度是瞬态，不记。
    if (outcome.kind === 'content') store.holdRunOutcome(nodeId, { kind: 'content', contentJson: outcome.contentJson })
    else if (outcome.kind !== 'progress') store.holdRunOutcome(nodeId, outcome)
    return false
  }
  if (outcome.kind === 'result') {
    if (outcome.mediaDimensions) store.addNodeResult(nodeId, outcome.result, outcome.mediaDimensions)
    else store.addNodeResult(nodeId, outcome.result)
  }
  else if (outcome.kind === 'status') store.setNodeStatus(nodeId, outcome.status, outcome.error)
  else if (outcome.kind === 'run-started') store.appendNodeRun(nodeId, outcome.run)
  else if (outcome.kind === 'content') store.landNodeContent(nodeId, outcome.contentJson, outcome.runId)
  else store.setNodeProgress(nodeId, outcome.progress)
  return true
}

export type RunGraph = { nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[] }

/**
 * 运行读它自己项目的画布：原项目正打开读 store（含未落盘编辑），否则读它在盘上的那一份——
 * 批量后续波次在用户切走之后仍按原项目的上游产物解析参考，绝不读到新项目的图。
 */
/** Read the original project and reject a replaced workspace before using its graph or author state. */
export async function readRunProjectRecord(target: RunProjectTarget) {
  const record = await readLocalProjectAsync(target.projectId)
  if (record && !sameProjectAgentBinding(target, { projectId: record.id,
    immutableProjectUuid: record.immutableProjectUuid ?? '', projectGeneration: record.projectGeneration ?? 0 })) {
    throw new Error('project_binding_stale')
  }
  return record
}

export async function readRunGraph(target: RunProjectTarget): Promise<RunGraph | null> {
  if (!isRunTargetLoaded(target)) await (diskDeliveryQueues.get(target.projectId) ?? Promise.resolve()).catch(() => undefined)
  if (isRunTargetLoaded(target)) {
    const state = useGenerationCanvasStore.getState()
    return { nodes: state.nodes, edges: state.edges }
  }
  const canvas = (await readRunProjectRecord(target))?.payload.generationCanvas
  return canvas ? { nodes: canvas.nodes, edges: canvas.edges } : null
}

const diskDeliveryQueues = new Map<string, Promise<unknown>>()

/** 同一项目的盘上投递串行：两个结局各读同一份旧快照再各存一遍会互相覆盖。 */
function serializeDiskDelivery<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const previous = diskDeliveryQueues.get(projectId) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tail = result.then(() => undefined, () => undefined)
  diskDeliveryQueues.set(projectId, tail)
  void tail.finally(() => { if (diskDeliveryQueues.get(projectId) === tail) diskDeliveryQueues.delete(projectId) })
  return result
}

/**
 * 把一次运行的结局投递到它的原项目。返回 true = 落进了正打开的原项目画布（调用方据此做只属于前台的收尾：
 * 模型健康记账、立即保存）；false = 写进了原项目的盘上副本，或节点已不存在。
 */
export async function deliverRunOutcome(target: RunProjectTarget, nodeId: string, outcome: NodeRunOutcome): Promise<boolean> {
  if (isRunTargetLoaded(target)) return applyToStore(nodeId, outcome)
  return serializeDiskDelivery(target.projectId, async () => {
    if (isRunTargetLoaded(target)) return applyToStore(nodeId, outcome)
    const record = await readRunProjectRecord(target)
    // 读盘期间用户恰好打开了原项目：此刻 store 才是真相，写 store，不回头覆盖盘。
    if (isRunTargetLoaded(target)) return applyToStore(nodeId, outcome)
    const canvas = record?.payload.generationCanvas
    const node = canvas?.nodes.find((candidate) => candidate.id === nodeId)
    if (!record || !canvas || !node) return false
    const nodes = canvas.nodes.map((candidate) => candidate.id === nodeId ? { ...candidate, ...nodeRunOutcomePatch(candidate, outcome) } : candidate)
    await saveLocalProject(target.projectId, { ...record.payload, generationCanvas: { ...canvas, nodes } }, record.name, target)
    return false
  })
}


/** Capture the existing editable generation inputs, never status, history or preview layout.
 * Results produced by this approved plan are dependencies, so their changing output is allowed.
 * Parameter keys come from the same model declaration as the original parameter bar/payment card.
 */
export function captureApprovedGenerationInputs(nodeIds: readonly string[]): (graph: RunGraph, executingNodeId: string) => void {
  const ids = new Set(nodeIds)
  const initial = useGenerationCanvasStore.getState()
  const initialOutputs = new Map(initial.nodes.filter(node => ids.has(node.id)).map(node => [node.id, { result: node.result, history: node.history, contentJson: node.contentJson }]))
  const approvedRuns = new Map<string, string>()
  const initialTextNodes = new Map(initial.nodes.filter(node => ids.has(node.id) && node.kind === 'text').map(node => [node.id, node]))
  const token = (graph: RunGraph): string => {
    const nodes = graph.nodes.map(node => ids.has(node.id) ? { ...node, ...initialOutputs.get(node.id) } : node)
    const edges = graph.edges.filter(edge => ids.has(edge.target))
    return stableProjectAgentJson(JSON.parse(JSON.stringify(nodeIds.map(id => {
      const found = nodes.find(node => node.id === id)
      if (!found) throw new Error('node not found')
      const archetype = archetypeForNode(found)
      const nextMode = resolveModeForConnectedReferences(found, nodes, edges)
      const meta = nextMode && archetype ? applyArchetypeModeSwitch(found.meta || {}, archetype, nextMode) : found.meta || {}
      const node = { ...found, meta }
      const modelKey = selectedModelKey(node)
      const vendor = selectedVendor(node)
      const controls = resolveRenderedControls({ modelKey, vendor, value: modelKey, label: modelKey, kind: getGenerationNodeCatalogKind(node.kind), meta }, meta, node.kind === 'image', node.kind === 'video')
      const parameters = Object.fromEntries(controls.map(control => {
        const key = control.binding === 'parameter' ? control.key : control.binding
        return [key, meta[key]]
      }))
      return { id, kind: node.kind, prompt: node.prompt, references: node.references, modelKey, vendor, parameters,
        mode: archetype ? currentArchetypeMode(archetype, meta)?.id : undefined,
        variant: archetype ? currentArchetypeVariant(archetype, meta)?.id : undefined,
        dialogue: meta.dialogue,
        edges: edges.filter(edge => edge.target === id),
        resolved: resolveGenerationReferences(node, { nodes, edges }),
        connectedText: collectConnectedTextPromptParts(node, { nodes, edges }),
      }
    }))))
  }
  const expected = token({ nodes: initial.nodes, edges: initial.edges })
  return (graph, executingNodeId) => {
    if (token(graph) !== expected) throw new Error('generation_input_changed')
    const originalText = initialTextNodes.get(executingNodeId)
    const executing = graph.nodes.find(node => node.id === executingNodeId)!
    const executingRun = executing.runs?.[0]
    const ownStreamingDocument = executingRun && executingRun.id === approvedRuns.get(executingNodeId)
      && executingRun.status !== 'success' && executingRun.textDocumentDigest
      && textDocumentDigest(executing.contentJson) === executingRun.textDocumentDigest
    if (originalText && ((!ownStreamingDocument && textDocumentDigest(executing.contentJson) !== textDocumentDigest(originalText.contentJson))
      || getTextGenMode(executing) !== getTextGenMode(originalText)
      || String(executing.meta?.textGenSelection ?? '').trim() !== String(originalText.meta?.textGenSelection ?? '').trim())) {
      throw new Error('generation_input_changed')
    }
    for (const sourceId of new Set(graph.edges.filter(edge => edge.target === executingNodeId && ids.has(edge.source)).map(edge => edge.source))) {
      const source = graph.nodes.find(node => node.id === sourceId)!
      const approvedRun = approvedRuns.get(sourceId)
      const outputAllowed = approvedRun
        ? source.runs?.[0]?.id === approvedRun && source.runs[0].resultId === source.result?.id
        : stableProjectAgentJson(source.result ?? null) === stableProjectAgentJson(initialOutputs.get(sourceId)?.result ?? null)
      const originalSource = initialTextNodes.get(sourceId)
      if (originalSource) {
        const unchangedDocument = textDocumentDigest(source.contentJson) === textDocumentDigest(originalSource.contentJson)
        const sameInitialResult = source.result?.id === originalSource.result?.id
        // Before a text result is applied, only the approved original body may be consumed.
        // Completed append/replace or editor selection applications seal their actual body digest.
        const initialStillInUse = approvedRun && source.runs?.[0]?.id === approvedRun && source.runs[0].status !== 'success' && sameInitialResult
        const run = source.runs?.[0]
        const sealedByApprovedRun = approvedRun && run?.id === approvedRun && run.textDocumentDigest
          && (run.status !== 'success' || outputAllowed)
        const documentAllowed = sealedByApprovedRun
          ? textDocumentDigest(source.contentJson) === run.textDocumentDigest
          : unchangedDocument && (outputAllowed || initialStillInUse)
        if (!documentAllowed) throw new Error('generation_input_changed')
      } else if (!outputAllowed) throw new Error('generation_input_changed')
    }
    if (executingRun) approvedRuns.set(executingNodeId, executingRun.id)
  }
}
