import { parseNomiLocalAssetUrl } from '../../media/nomiLocalAssetUrl'
import {
  listNodeMediaResults,
  removeNodeResult,
  resultIdentity,
  type NodeResultLifecyclePatch,
} from '../generationCanvas/model/nodeResultLifecycle'
import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'
import type { AssetRef } from './assetTypes'

export type AssetResultDeletionMatch = {
  nodeId: string
  resultId: string
  patch: NodeResultLifecyclePatch
}

export type AssetResultDeletionPlan = {
  matches: AssetResultDeletionMatch[]
  fileTarget: { projectId: string; relativePath: string } | null
}

function comparableUrl(value: string | undefined): string {
  return String(value || '').trim().split(/[?#]/, 1)[0]
}

function resultMatchesAsset(result: GenerationNodeResult, asset: AssetRef): boolean {
  const targetUrl = comparableUrl(asset.renderUrl)
  if (!targetUrl) return false
  return [result.url, result.thumbnailUrl].some((url) => comparableUrl(url) === targetUrl)
}

function resultReferencesFile(result: GenerationNodeResult, target: { projectId: string; relativePath: string }): boolean {
  return [result.url, result.thumbnailUrl].some((url) => {
    const parsed = parseNomiLocalAssetUrl(url)
    return parsed?.projectId === target.projectId && parsed.relativePath === target.relativePath
  })
}

export function buildAssetResultDeletionPlan(
  asset: AssetRef,
  nodes: readonly GenerationCanvasNode[],
): AssetResultDeletionPlan {
  const ownerNodeId = asset.ownerNodeId || (asset.origin.source === 'canvas' ? asset.origin.nodeId : '')
  const hintedResultId = asset.ownerResultId || (asset.origin.source === 'canvas' ? asset.origin.resultId : '')
  const candidateNodes = ownerNodeId ? nodes.filter((node) => node.id === ownerNodeId) : nodes
  const matches: AssetResultDeletionMatch[] = []

  for (const node of candidateNodes) {
    const results = listNodeMediaResults(node)
    const matchedResult =
      (hintedResultId ? results.find((result) => resultIdentity(result) === hintedResultId) : undefined) ??
      results.find((result) => resultMatchesAsset(result, asset))
    if (!matchedResult) continue
    const resultId = resultIdentity(matchedResult)
    const patch = removeNodeResult(node, resultId)
    if (patch) matches.push({ nodeId: node.id, resultId, patch })
  }

  const candidateFileTarget = asset.origin.source === 'project'
    ? { projectId: asset.origin.projectId, relativePath: asset.origin.relativePath }
    : parseNomiLocalAssetUrl(asset.renderUrl)
  if (!candidateFileTarget) return { matches, fileTarget: null }

  // A single physical asset can back more than one result (for example an
  // image result and another node's video thumbnail). Remove the result from
  // metadata first, then only delete the file when no remaining result still
  // points at the same project-relative path.
  const removedByNode = new Map(matches.map((match) => [match.nodeId, match.patch]))
  const stillReferenced = nodes.some((node) => {
    const patch = removedByNode.get(node.id)
    const effective = patch ? { ...node, ...patch } : node
    return listNodeMediaResults(effective).some((result) => resultReferencesFile(result, candidateFileTarget))
  })
  return { matches, fileTarget: stillReferenced ? null : candidateFileTarget }
}

export function applyAssetResultDeletion(
  nodes: readonly GenerationCanvasNode[],
  plan: AssetResultDeletionPlan,
): GenerationCanvasNode[] {
  const patchByNodeId = new Map(plan.matches.map((match) => [match.nodeId, match.patch]))
  return nodes.map((node) => {
    const patch = patchByNodeId.get(node.id)
    return patch ? { ...node, ...patch } : node
  })
}
