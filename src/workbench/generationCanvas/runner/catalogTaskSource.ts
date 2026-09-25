import i18n from '../../../i18n'
import { tagNomiError } from '../../../../electron/shared/nomiErrorCodes'
import { resolveSourceTaskInput, type SourceTaskResult } from '../../../../electron/shared/videoCapabilities/sourceTaskInput'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { currentArchetypeMode } from '../nodes/controls/archetypeMeta'
import { resolveTaskArchetype, selectedVendor, type CatalogTaskActionOptions } from './catalogTaskResolve'

const sourceErrorKeys = {
  missing: 'generationCommon.sourceTask.missing',
  multiple: 'generationCommon.sourceTask.multiple',
  unknown: 'generationCommon.sourceTask.unknown',
  provider: 'generationCommon.sourceTask.provider',
  model: 'generationCommon.sourceTask.model',
  parameter: 'generationCommon.sourceTask.parameter',
  conflict: 'generationCommon.sourceTask.conflict',
} as const

function sourceOf(result?: GenerationNodeResult): SourceTaskResult {
  const provenance = result?.provenance
  const params = provenance?.params?.extras ?? provenance?.params
  return {
    taskId: provenance?.vendorRequestId || result?.taskId,
    provider: provenance?.provider,
    modelKey: provenance?.modelKey,
    params: params && typeof params === 'object' && !Array.isArray(params) ? params as Record<string, unknown> : undefined,
  }
}

/** Read selected result provenance, never the source node's mutable model/resolution settings. */
export function resolveCatalogSourceTask(node: GenerationCanvasNode, options: CatalogTaskActionOptions): Record<string, string> {
  const archetype = resolveTaskArchetype(node.meta || {})
  const requirement = archetype && currentArchetypeMode(archetype, node.meta || {}).sourceTask
  if (!requirement) return {}
  const explicitId = node.meta?.[requirement.inputKey]
  const nodes = options.referenceContext?.nodes || [node]
  const videos = [...new Set(options.references?.referenceVideos || [])]
  const incoming = (options.referenceContext?.edges || []).filter(edge => edge.target === node.id
    && nodes.some(source => source.id === edge.source && source.kind === 'video'))
  const sources = videos.length ? videos.map(url => {
    const result = nodes.flatMap(source => [source.result, ...(source.history || [])])
      .find(candidate => candidate?.type === 'video' && (candidate.url === url || candidate.providerUrl === url))
    return sourceOf(result)
  }) : incoming.length ? incoming.map(edge => sourceOf(nodes.find(source => source.id === edge.source)?.result))
    : node.result && !explicitId ? [sourceOf(node.result)] : []
  const resolved = resolveSourceTaskInput(requirement, { explicitId, provider: selectedVendor(node), sources })
  if ('error' in resolved) throw new Error(tagNomiError('input-validation', i18n.t(sourceErrorKeys[resolved.error], resolved.values)))
  return { [requirement.inputKey]: resolved.taskId }
}
