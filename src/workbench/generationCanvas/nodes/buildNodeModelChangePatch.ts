import type { ModelOption } from '../../../config/models'
import { findModelOptionByIdentifier } from '../adapters/modelOptionsAdapter'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { isImageLikeGenerationNodeKind, isVideoLikeGenerationNodeKind } from '../model/generationNodeKinds'
import { resolveModeForConnectedReferences } from '../agent/referenceEdgeCapability'
import { replaceCustomCapabilityContractMeta } from '../../../config/modelArchetypes'
import {
  buildModelControls,
  defaultPatchForControls,
  nodeSelectedModelAddress,
  removePreviousControlParams,
  videoAspectDefaultPatch,
} from './controls/parameterControlModel'
import { applyArchetypeModeSwitch } from './controls/archetypeMeta'
import { resolveArchetypeForOption, resolveRenderedControls } from './nodeModelArchetype'
import { collectInputAspectRatios, preferredVideoAspect } from './aspectRatio'

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
  const currentMeta = node.meta || {}
  const currentAddress = nodeSelectedModelAddress(currentMeta)
  const currentOption = findModelOptionByIdentifier(
    modelOptions,
    currentAddress.modelKey,
    currentAddress.vendorKey,
  )
  const nextOption = findModelOptionByIdentifier(modelOptions, value, vendor)
  const isImageLike = isImageLikeGenerationNodeKind(node.kind)
  const isVideoLike = isVideoLikeGenerationNodeKind(node.kind)
  const previousControls = resolveRenderedControls(currentOption, currentMeta, isImageLike, isVideoLike)
  const controls = buildModelControls(nextOption?.meta, isImageLike, isVideoLike)
  const defaultPatch = defaultPatchForControls(controls)
  const nextArchetype = resolveArchetypeForOption(nextOption)
  const aspectPatch = isVideoLike
    ? videoAspectDefaultPatch(controls, preferredVideoAspect(collectInputAspectRatios(node.id, edges, nodes)))
    : {}

  const baseMeta = replaceCustomCapabilityContractMeta(
    removePreviousControlParams(currentMeta, previousControls),
    nextOption?.meta,
  )
  let nextMeta: Record<string, unknown> = {
    ...baseMeta,
    modelKey: nextOption?.modelKey || nextOption?.value || value || null,
    modelAlias: nextOption?.modelAlias || nextOption?.value || value || null,
    modelVendor: nextOption?.vendor || null,
    vendor: nextOption?.vendor || null,
    modelLabel: nextOption?.label || value || null,
    ...defaultPatch,
    ...aspectPatch,
    ...(isVideoLike
      ? { videoModel: nextOption?.value || value || null, videoModelVendor: nextOption?.vendor || null }
      : { imageModel: nextOption?.value || value || null, imageModelVendor: nextOption?.vendor || null }),
  }

  if (!nextArchetype) {
    delete nextMeta.archetype
  } else {
    const promotedModeId = resolveModeForConnectedReferences(
      { ...node, meta: nextMeta },
      nodes as GenerationCanvasNode[],
      edges as GenerationCanvasEdge[],
    )
    if (promotedModeId) nextMeta = applyArchetypeModeSwitch(nextMeta, nextArchetype, promotedModeId)
  }

  return { meta: nextMeta }
}
