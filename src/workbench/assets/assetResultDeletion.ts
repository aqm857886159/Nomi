import { readWhiteboardAssetUrls } from '../generationCanvas/nodes/whiteboard/whiteboardState'
import { parseNomiLocalAssetUrl } from '../../media/nomiLocalAssetUrl'
import {
  listNodeMediaResults,
  removeNodeResult,
  resultIdentity,
  type NodeResultLifecyclePatch,
} from '../generationCanvas/model/nodeResultLifecycle'
import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'
import type { AssetOrigin, AssetRef } from './assetTypes'
import type { TimelineState } from '../timeline/timelineTypes'

export type AssetDeletionRequest = AssetRef | { origin: Extract<AssetOrigin, { source: 'project' }> }

export type ProjectFileTarget = { projectId: string; relativePath: string }

/** 项目里还有谁在用这份文件。画布是正本；时间轴上的片段也直接拿着结果的地址（删了它片段就黑了）。 */
export type ProjectFileReferenceScope = {
  nodes: readonly GenerationCanvasNode[]
  timeline?: Pick<TimelineState, 'tracks'> | null
}

/** 删除判定读的是哪个项目：画布与时间轴是它的，落盘文件也只认它自己的（别的项目的文件这里绝不动）。 */
export type AssetDeletionScope = ProjectFileReferenceScope & { projectId: string }

export type AssetResultDeletionMatch = {
  nodeId: string
  /** 这张卡上要摘掉的结果（一张卡上可能有几版就是同一份文件）。 */
  resultIds: string[]
  patch: NodeResultLifecyclePatch
}

/**
 * 素材库里一张素材「删了会怎样」——唯一判定。项目素材多选删除、全部素材单张删除、版本卡片删一版，都只经它。
 *
 * - `matches`：要从画布卡上摘掉的结果（卡本身保留）。
 * - `file`：这张素材自己那份落盘文件（只认本项目的）和它的去向：`trash` = 摘完以后没人用了，进回收站；
 *   `keep` = 还被时间轴 / 白板 / 别的结果（含封面）用着，留着，并且要告诉用户为什么没删。
 *
 * 列表里出现的每一种素材都落在 matches × file 的某个组合上，执行口对每个组合都有确定的结果。
 * 2026-10-24 之前判定是隐式的 `{ matches, fileTarget }`，已加载 / 关闭两条执行路径各自解读：
 * 已加载项目里「画布上没有结果、只有文件」的素材被直接放过（夜跑 asset-library-interactions ⑤，一张都删不掉）。
 */
export type AssetDeletionPlan = {
  matches: AssetResultDeletionMatch[]
  file: { target: ProjectFileTarget; fate: 'trash' | 'keep' } | null
}

function comparableUrl(value: string | undefined): string {
  return String(value || '').trim().split(/[?#]/, 1)[0]
}

function resultShowsUrl(result: GenerationNodeResult, renderUrl: string): boolean {
  const targetUrl = comparableUrl(renderUrl)
  if (!targetUrl) return false
  return [result.url, result.thumbnailUrl].some((url) => comparableUrl(url) === targetUrl)
}

function urlReferencesFile(url: unknown, target: ProjectFileTarget): boolean {
  const parsed = parseNomiLocalAssetUrl(url)
  return parsed?.projectId === target.projectId && parsed.relativePath === target.relativePath
}

function resultReferencesFile(result: GenerationNodeResult, target: ProjectFileTarget): boolean {
  const raw = result.raw && typeof result.raw === 'object' ? result.raw as Record<string, unknown> : undefined
  return [result.url, result.thumbnailUrl, ...readWhiteboardAssetUrls(raw?.whiteboardState)].some((url) => urlReferencesFile(url, target))
}

/**
 * 「这份落盘文件还有没有人用」的唯一判定：删一版当场判、延后真删到点再判、打开项目清扫遗留时再判，
 * 都走这一个函数（2026-10-06 之前延后删那条路自己拿子串包含判，和这里是两套）。
 */
export function isProjectFileReferenced(target: ProjectFileTarget, scope: ProjectFileReferenceScope): boolean {
  if (scope.nodes.some((node) => readWhiteboardAssetUrls(node.meta?.whiteboardState).some(url => urlReferencesFile(url, target))
    || listNodeMediaResults(node).some((result) => resultReferencesFile(result, target)))) return true
  return (scope.timeline?.tracks ?? []).some((track) => track.clips.some((clip) => (
    urlReferencesFile(clip.url, target) || urlReferencesFile(clip.thumbnailUrl, target)
  )))
}

/** 从一张卡上依次摘掉几版；摘不掉的（不是媒体结果）跳过。一版都没摘掉 = null。 */
function removeResults(node: GenerationCanvasNode, resultIds: readonly string[]): AssetResultDeletionMatch | null {
  let current = node
  let patch: NodeResultLifecyclePatch | null = null
  const removed: string[] = []
  for (const resultId of resultIds) {
    const next = removeNodeResult(current, resultId)
    if (!next) continue
    patch = next
    current = { ...current, ...next }
    removed.push(resultId)
  }
  return patch ? { nodeId: node.id, resultIds: removed, patch } : null
}

/** 素材自己那份文件：只认本项目的地址（指向别的项目的旧数据 = 没有本项目的文件可删）。 */
function ownProjectFile(renderUrl: string, projectId: string): ProjectFileTarget | null {
  const parsed = parseNomiLocalAssetUrl(renderUrl)
  return parsed && parsed.projectId === projectId ? parsed : null
}

function fileFate(target: ProjectFileTarget, matches: readonly AssetResultDeletionMatch[], scope: AssetDeletionScope): NonNullable<AssetDeletionPlan['file']> {
  // 一份文件可能同时挂在好几处（别的卡的结果、视频的封面、白板图层、时间轴片段）：先在画布上摘掉，
  // 再用唯一的引用判定看还有没有人用。
  const remaining = applyAssetResultDeletion(scope.nodes, matches)
  return { target, fate: isProjectFileReferenced(target, { nodes: remaining, timeline: scope.timeline }) ? 'keep' : 'trash' }
}

/** 画布上的一张结果（版本卡片的一版、项目素材里画布那一格）：只摘这一张，别的结果都保留。 */
function planResultDeletion(asset: AssetRef, origin: Extract<AssetOrigin, { source: 'canvas' }>, scope: AssetDeletionScope): AssetDeletionPlan {
  const node = scope.nodes.find((candidate) => candidate.id === origin.nodeId)
  const results = node ? listNodeMediaResults(node) : []
  const result = (origin.resultId ? results.find((candidate) => resultIdentity(candidate) === origin.resultId) : undefined)
    ?? results.find((candidate) => resultShowsUrl(candidate, asset.renderUrl))
  const match = node && result ? removeResults(node, [resultIdentity(result)]) : null
  const matches = match ? [match] : []
  const own = ownProjectFile(asset.renderUrl, scope.projectId)
  return { matches, file: own ? fileFate(own, matches, scope) : null }
}

/**
 * 一份落盘文件（项目素材 / 全部素材里的文件格子）：凡是「就是这份文件」的结果（地址是它）一起摘；
 * 只是拿它当封面 / 白板图层 / 时间轴片段的不算「就是它」，那是「被用着」——这时一张结果都不摘，原样留着。
 */
function planFileDeletion(origin: Extract<AssetOrigin, { source: 'project' }>, scope: AssetDeletionScope): AssetDeletionPlan {
  if (origin.projectId !== scope.projectId) return { matches: [], file: null }
  const target = { projectId: origin.projectId, relativePath: origin.relativePath }
  const matches = scope.nodes.flatMap((node) => {
    const resultIds = listNodeMediaResults(node).filter((result) => urlReferencesFile(result.url, target)).map(resultIdentity)
    const match = resultIds.length > 0 ? removeResults(node, resultIds) : null
    return match ? [match] : []
  })
  const file = fileFate(target, matches, scope)
  return file.fate === 'keep' ? { matches: [], file } : { matches, file }
}

function unknownOrigin(origin: never): never {
  throw new Error(`Unknown asset origin: ${JSON.stringify(origin)}`)
}

export function planAssetDeletion(asset: AssetDeletionRequest, scope: AssetDeletionScope): AssetDeletionPlan {
  const origin = asset.origin
  switch (origin.source) {
    case 'canvas': {
      if (!('renderUrl' in asset)) throw new Error('Canvas result deletion requires a result asset')
      return planResultDeletion(asset, origin, scope)
    }
    case 'project': return planFileDeletion(origin, scope)
    // 素材来源多一种（AssetOrigin 加成员）而这里没认它：编译不过，不会悄悄落进「什么都不删」。
    default: return unknownOrigin(origin)
  }
}

/** 摘掉的结果数（一张卡上可能摘几版）。 */
export function countRemovedResults(matches: readonly AssetResultDeletionMatch[]): number {
  return matches.reduce((total, match) => total + match.resultIds.length, 0)
}

export function applyAssetResultDeletion(
  nodes: readonly GenerationCanvasNode[],
  matches: readonly AssetResultDeletionMatch[],
): GenerationCanvasNode[] {
  const patchByNodeId = new Map(matches.map((match) => [match.nodeId, match.patch]))
  return nodes.map((node) => {
    const patch = patchByNodeId.get(node.id)
    return patch ? { ...node, ...patch } : node
  })
}
