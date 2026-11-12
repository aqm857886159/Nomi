import { resolveModelParams } from '../../../../electron/shared/videoCapabilities/resolveModelParams'
import type { ModelOption } from '../../../config/models'
import { findModelOptionByIdentifier } from '../adapters/modelOptionsAdapter'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { isImageLikeGenerationNodeKind, isVideoLikeGenerationNodeKind } from '../model/generationNodeKinds'
import { archetypeForNode } from '../agent/referenceEdgeCapability'
import { normalizeReferenceListMeta } from './controls/referenceList'
import { replaceCustomCapabilityContractMeta } from '../../../../electron/shared/modelArchetypes'
import {
  buildModelControls,
  modelParamControls,
  nodeSelectedModelAddress,
  controlStoredKeys,
} from './controls/parameterControlModel'
import { carryHumanModePreference, effectiveArchetypeMode } from './controls/archetypeMeta'
import { resolveArchetypeForOption, resolveRenderedControls } from './nodeModelArchetype'
import { videoAspectSeedPatch } from './videoAspectSeed'
import { projectParameterReferenceSlots } from '../model/parameterReferenceSlots'

export type BuildNodeModelChangePatchInput = {
  node: GenerationCanvasNode
  nodes: readonly GenerationCanvasNode[]
  edges: readonly GenerationCanvasEdge[]
  modelOptions: readonly ModelOption[]
  value: string
  vendor?: string
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
    ? normalizeReferenceListMeta(node.meta || {}, effectiveArchetypeMode(previousArchetype, node, { nodes, edges }).layout)
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
  const nextArchetype = resolveArchetypeForOption(nextOption)
  // 换模型 = 重铺全部默认值（比例也在内，不让「明确选过」），默认值只问唯一出处。
  const aspectPatch = isVideoLike
    ? videoAspectSeedPatch({ nodeId: node.id, nodes, edges, controls, meta: currentMeta, respectExplicit: false })
    : {}

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
    ...aspectPatch,
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

  return { meta: nextMeta }
}
