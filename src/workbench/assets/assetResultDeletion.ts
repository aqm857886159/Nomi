import { parseNomiLocalAssetUrl } from '../../media/nomiLocalAssetUrl'
import {
  listNodeMediaResults,
  removeNodeResult,
  resultIdentity,
  type NodeResultLifecyclePatch,
} from '../generationCanvas/model/nodeResultLifecycle'
import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'
import type { AssetRef } from './assetTypes'
import type { TimelineState } from '../timeline/timelineTypes'

export type ProjectFileTarget = { projectId: string; relativePath: string }

/** 项目里还有谁在用这份文件。画布是正本；时间轴上的片段也直接拿着结果的地址（删了它片段就黑了）。 */
export type ProjectFileReferenceScope = {
  nodes: readonly GenerationCanvasNode[]
  timeline?: Pick<TimelineState, 'tracks'> | null
}

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

function urlReferencesFile(url: unknown, target: ProjectFileTarget): boolean {
  const parsed = parseNomiLocalAssetUrl(url)
  return parsed?.projectId === target.projectId && parsed.relativePath === target.relativePath
}

function resultReferencesFile(result: GenerationNodeResult, target: ProjectFileTarget): boolean {
  return [result.url, result.thumbnailUrl].some((url) => urlReferencesFile(url, target))
}

/**
 * 「这份落盘文件还有没有人用」的唯一判定：删一版当场判、延后真删到点再判、打开项目清扫遗留时再判，
 * 都走这一个函数（2026-10-06 之前延后删那条路自己拿子串包含判，和这里是两套）。
 */
export function isProjectFileReferenced(target: ProjectFileTarget, scope: ProjectFileReferenceScope): boolean {
  if (scope.nodes.some((node) => listNodeMediaResults(node).some((result) => resultReferencesFile(result, target)))) return true
  return (scope.timeline?.tracks ?? []).some((track) => track.clips.some((clip) => (
    urlReferencesFile(clip.url, target) || urlReferencesFile(clip.thumbnailUrl, target)
  )))
}

export function buildAssetResultDeletionPlan(
  asset: AssetRef,
  nodes: readonly GenerationCanvasNode[],
  timeline?: ProjectFileReferenceScope['timeline'],
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
  const afterDeletion = applyAssetResultDeletion(nodes, { matches, fileTarget: null })
  const stillReferenced = isProjectFileReferenced(candidateFileTarget, { nodes: afterDeletion, timeline })
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
