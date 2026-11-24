import { rememberGenerationChoice } from '../model/generationModelDefaults'
import { deriveGenerationDefaultTaskKind, nodeHasImageReference } from './defaultNodeModelSelection'
import type { NodeWriteAccess } from './nodeWriteAccess'
import { resolveModelParams } from '../../../../electron/shared/videoCapabilities/resolveModelParams'
import type { ModelOption } from '../../../config/models'
import { findModelOptionByIdentifier } from '../adapters/modelOptionsAdapter'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { isImageLikeGenerationNodeKind, isVideoLikeGenerationNodeKind } from '../model/generationNodeKinds'
import { archetypeForNode } from '../agent/referenceEdgeCapability'
import { normalizeReferenceListMeta } from './controls/referenceList'
import { replaceCustomCapabilityContractMeta, type ModelArchetype } from '../../../../electron/shared/modelArchetypes'
import {
  buildModelControls,
  isAspectRatioControl,
  modelParamControls,
  nodeSelectedModelAddress,
  controlStoredKeys,
} from './controls/parameterControlModel'
import { applyHumanModeChoice, carryHumanModePreference, effectiveArchetypeMode } from './controls/archetypeMeta'
import { resolveArchetypeForOption, resolveRenderedControls, resolveRenderedMode } from './nodeModelArchetype'
import { applyVideoAspectSeed, seedVideoAspectForModeSwitch, videoAspectSeedPatch } from './videoAspectSeed'
import { projectParameterReferenceSlots } from '../model/parameterReferenceSlots'

export type BuildNodeModelChangePatchInput = {
  node: GenerationCanvasNode
  nodes: readonly GenerationCanvasNode[]
  edges: readonly GenerationCanvasEdge[]
  modelOptions: readonly ModelOption[]
  value: string
  vendor?: string
}

/** A manual picker choice also becomes the next node's last-used default. */
export function applyPickedNodeModel(input: BuildNodeModelChangePatchInput, updateNode: NodeWriteAccess['updateNode']): void {
  const { node } = input
  const patch = buildNodeModelChangePatch(input)
  const task = deriveGenerationDefaultTaskKind({
    isImageLike: isImageLikeGenerationNodeKind(node.kind),
    isVideoLike: isVideoLikeGenerationNodeKind(node.kind),
    hasImageReference: nodeHasImageReference(node.meta),
  })
  rememberGenerationChoice(task, patch.meta.modelVendor, patch.meta.modelKey)
  updateNode(node.id, patch)
}

/** Single source of truth for both the per-node picker and bulk model changes. */
export function buildNodeModelChangePatch({
  node,
  nodes,
  edges,
  modelOptions,
  value,
  vendor,
}: BuildNodeModelChangePatchInput): { meta: Record<string, unknown> } {
  // 旧数据（按槽存的首 / 尾帧键）先按**换模型前**看得见的顺序落成规范的一份参考列表：之后列表就不再动了。
  const previousArchetype = archetypeForNode(node)
  const currentMeta = (previousArchetype
    ? normalizeReferenceListMeta(node.meta || {}, effectiveArchetypeMode(previousArchetype, node, { nodes, edges }).mode)
    : null) ?? node.meta ?? {}
  const currentAddress = nodeSelectedModelAddress(currentMeta)
  const currentOption = findModelOptionByIdentifier(
    modelOptions,
    currentAddress.modelKey,
    currentAddress.vendorKey,
  )
  const nextOption = findModelOptionByIdentifier(modelOptions, value, vendor)
  const isImageLike = isImageLikeGenerationNodeKind(node.kind)
  const isVideoLike = isVideoLikeGenerationNodeKind(node.kind)
  const previousControls = resolveRenderedControls(currentOption, currentMeta, isImageLike, isVideoLike, { node: { ...node, meta: currentMeta }, graph: { nodes, edges } })
  const controls = buildModelControls(nextOption?.meta, isImageLike, isVideoLike)
  const resolved = resolveModelParams({
    controls: modelParamControls(controls), intent: {}, previousParams: currentMeta,
    policy: { author: '人手', invalid: '全重置默认', removeKeys: previousControls.flatMap(controlStoredKeys) },
  })
  const nextArchetype = resolveArchetypeForOption(nextOption, { variantId: undefined, modelId: nextOption?.modelKey })

  const baseMeta = replaceCustomCapabilityContractMeta(
    resolved.params,
    nextOption?.meta,
  )
  let nextMeta: Record<string, unknown> = {
    ...baseMeta,
    modelKey: nextOption?.modelKey || nextOption?.value || value || null,
    modelAlias: nextOption?.modelAlias || nextOption?.value || value || null,
    modelVendor: nextOption?.vendor || null,
    vendor: nextOption?.vendor || null,
    modelLabel: nextOption?.label || value || null,
    ...(isVideoLike
      ? { videoModel: nextOption?.value || value || null, videoModelVendor: nextOption?.vendor || null }
      : { imageModel: nextOption?.value || value || null, imageModelVendor: nextOption?.vendor || null }),
  }

  nextMeta = projectParameterReferenceSlots(nextMeta, nextOption?.meta)
  if (!nextArchetype) {
    delete nextMeta.archetype
  } else {
    nextMeta = carryHumanModePreference(nextMeta, previousArchetype, nextArchetype)
  }

  // 换模型 = 重铺全部默认值（比例也在内，不让「明确选过」），默认值只问唯一出处（带入沿用后的方式，让编辑方式保留 auto）。
  if (isVideoLike) {
    const nextNode = { ...node, meta: nextMeta }
    const nextGraph = { nodes: nodes.map((item) => (item.id === node.id ? nextNode : item)), edges }
    const nextMode = nextArchetype ? resolveRenderedMode(nextOption ?? null, nextMeta, true, { node: nextNode, graph: nextGraph }) : null
    const modeControls = nextArchetype
      ? resolveRenderedControls(nextOption ?? null, nextMeta, isImageLike, true, { node: nextNode, graph: nextGraph })
      : []
    const aspectControls = modeControls.some(isAspectRatioControl) ? modeControls : controls
    const aspectPatch = videoAspectSeedPatch({
      nodeId: node.id,
      nodes: nextGraph.nodes,
      edges,
      controls: aspectControls,
      meta: currentMeta,
      mode: nextMode,
      respectExplicit: false,
    })
    nextMeta = applyVideoAspectSeed(nextMeta, aspectPatch)
  }

  return { meta: nextMeta }
}

/** 人手切方式（视频底栏方式菜单 / 声音方式栏）：写偏好，并让视频未手选比例问唯一出处 videoAspectSeed。 */
export function buildModeSwitchMeta(
  node: GenerationCanvasNode,
  archetype: ModelArchetype,
  modeId: string,
  graph: { nodes: readonly GenerationCanvasNode[]; edges: readonly GenerationCanvasEdge[] },
  option: ModelOption | null,
): Record<string, unknown> {
  const nextMeta = applyHumanModeChoice(node.meta || {}, archetype, modeId)
  if (!isVideoLikeGenerationNodeKind(node.kind)) return nextMeta
  return seedVideoAspectForModeSwitch({
    node,
    nextMeta,
    nodes: graph.nodes,
    edges: graph.edges,
    option,
    isImageLike: isImageLikeGenerationNodeKind(node.kind),
  })
}
