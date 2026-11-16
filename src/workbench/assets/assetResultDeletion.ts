import { parseNomiLocalAssetUrl } from '../../media/nomiLocalAssetUrl'
import {
  listNodeMediaResults,
  removeNodeResult,
  resultIdentity,
  type NodeResultLifecyclePatch,
} from '../generationCanvas/model/nodeResultLifecycle'
import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'
import type { AssetOrigin, AssetRef } from './assetTypes'

export type AssetDeletionRequest = AssetRef | { origin: Extract<AssetOrigin, { source: 'project' }> }

export type ProjectFileTarget = { projectId: string; relativePath: string }

/**
 * 删除判定读的是哪个项目、它的全部内容。`nodes` 单列（删除计划要先在上面摘结果），`rest` 是项目里除画布节点以外的
 * 一切（写盘那份内容 + 还没发出去的输入 + 会话撤销材料，见 `projectLivenessContent.ts`），任意形状、整份扫描。
 * `rest === null` = 这一刻拿不到完整内容 → 一律当「有人用」。落盘文件只认本项目自己的（别的项目的文件这里绝不动）。
 */
export type AssetDeletionScope = {
  projectId: string
  nodes: readonly GenerationCanvasNode[]
  rest: unknown
}

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
 *   `keep` = 项目里还有别的内容提到它（分镜参考、节点参考、助手输入、时间轴、白板、别的结果……），留着，并且要告诉用户为什么没删。
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

// ── 「这份落盘文件还有没有人用」：整份内容扫描 ─────────────────────────────────────────
//
// 2026-11-17 之前这里逐项列举位置（节点白板、当前 / 历史结果、时间轴），分镜参考绑定、普通节点参考、助手输入框都不在名单里，
// 被它们用着的文件在删掉原结果后进了回收站。现在不列位置：项目内容里任何一个字符串（含对象的键）只要指向这份文件，
// 就算有人用。宁可多留，不可误删；新加的引用位置不用回这里登记。

/** 项目内容里提到过的文件，两种粒度：带项目 id 的本地地址（精确），和没有项目 id 可核的路径（按路径段后缀，宁可多留）。 */
export type ProjectFileReferences = {
  readonly exact: ReadonlySet<string>
  readonly suffixes: ReadonlySet<string>
}

const LOCAL_URL_IN_TEXT = /nomi-local:\/\/[^\s"'<>()[\]{}`]+/gi
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
/** 比较前统一：分隔符、Unicode 组合形式、大小写（macOS / Windows 文件系统默认不区分大小写）。 */
function normalizeRelativePath(value: string): string {
  // 快路径（扫描里绝大多数地址）：纯 ASCII、没有反斜杠 / 重复斜杠 / 开头的 ./ —— 只需小写。
  const plain = !/[^\x20-\x7e]|\\|\/\/|^\.\//.test(value)
  if (plain) return value.toLowerCase()
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/').normalize('NFC').toLowerCase()
}

function exactKey(projectId: string, relativePath: string): string {
  return `${projectId.trim()}\u0000${normalizeRelativePath(relativePath)}`
}

function decodeSegment(segment: string): string {
  if (!segment.includes('%')) return segment
  try { return decodeURIComponent(segment) } catch { return segment }
}

/** nomi-local://asset/<项目>/<路径> 与 nomi-local://production-preview/<项目>/<run>/<artifact>/<路径>?preview=…。 */
function localUrlTarget(url: string): ProjectFileTarget | null {
  const match = /^nomi-local:\/\/(asset|production-preview)\/([^?#]*)/i.exec(url)
  if (!match) return null
  const segments = match[2].split('/').filter(Boolean).map(decodeSegment)
  const preview = match[1].toLowerCase() === 'production-preview'
  const projectId = segments[0]?.trim()
  const pathSegments = preview ? segments.slice(3) : segments.slice(1)
  return projectId && pathSegments.length > 0 ? { projectId, relativePath: pathSegments.join('/') } : null
}

const MAX_BARE_PATH_LENGTH = 2048

function collectString(value: string, exact: Set<string>, suffixes: Set<string>): void {
  // 指向文件的写法一定带路径分隔符：键名、短词、普通文案在这里就过去了。
  if (value.length < 3 || (value.indexOf('/') < 0 && value.indexOf('\\') < 0) || value.startsWith('data:')) return
  // 快路径：整串就是一个地址（最常见），不必在串里再找。
  if (value.startsWith('nomi-local://') && value.indexOf('nomi-local:', 1) < 0 && !/[\s"'<>()[\]{}`]/.test(value)) {
    const target = localUrlTarget(value)
    if (target) exact.add(exactKey(target.projectId, target.relativePath))
    return
  }
  if (/nomi-local:/i.test(value)) {
    // 整串是地址，或长文本（原稿、提示词、富文本 JSON）里夹着地址：逐个解析。
    for (const found of value.matchAll(LOCAL_URL_IN_TEXT)) {
      const target = localUrlTarget(found[0])
      if (target) exact.add(exactKey(target.projectId, target.relativePath))
    }
    return
  }
  if (value.length > MAX_BARE_PATH_LENGTH || /\s/.test(value)) return
  if (OTHER_SCHEME.test(value) && !/^file:\/\//i.test(value)) return
  // 裸相对路径、时间轴片段来源 `asset:<素材 id>`（项目素材的 id 是 `<项目>:<路径>`）、file:// 或绝对路径指到项目目录里：
  // 没有项目 id 可核，按路径段后缀记；段里带冒号的（`<项目>:<路径>`、`C:`）冒号前后两种切法都记。
  const bare = value.split(/[?#]/, 1)[0].replace(/^file:\/\//i, '').replace(/^asset:/i, '')
  if (!bare.includes('/') && !bare.includes('\\')) return
  const segments = normalizeRelativePath(decodeSegment(bare)).split('/').filter(Boolean)
  for (let index = 0; index < segments.length; index += 1) {
    suffixes.add(segments.slice(index).join('/'))
    const colon = segments[index].lastIndexOf(':')
    if (colon >= 0 && colon < segments[index].length - 1) suffixes.add([segments[index].slice(colon + 1), ...segments.slice(index + 1)].join('/'))
  }
}

/**
 * 节点上不算「在用」的那一栏：运行记录 `runs` 是过去发生过什么（它的 raw 会回显那次落盘的文件），不是引用。
 * 运行记录要是以后装上「活」的引用，`projectLivenessContent.census.test.ts` 的归类表要先改。
 */
function nodeLivenessView(node: GenerationCanvasNode): unknown {
  if (!node || typeof node !== 'object' || !('runs' in node)) return node
  const { runs: _history, ...live } = node
  return live
}

/** 把项目内容整份走一遍，收出它提到的全部文件。`nodes` 是摘完结果之后的画布节点，`rest` 是其余内容（任意形状）。 */
export function collectProjectFileReferences(nodes: readonly GenerationCanvasNode[], rest: unknown): ProjectFileReferences {
  const exact = new Set<string>()
  const suffixes = new Set<string>()
  const seen = new WeakSet<object>()
  const stack: unknown[] = [rest, ...nodes.map(nodeLivenessView)]
  while (stack.length > 0) {
    const value = stack.pop()
    if (typeof value === 'string') { collectString(value, exact, suffixes); continue }
    if (!value || typeof value !== 'object') continue
    if (seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) { for (const item of value) stack.push(item); continue }
    if (value instanceof Map) { for (const [key, item] of value) stack.push(key, item); continue }
    if (value instanceof Set) { for (const item of value) stack.push(item); continue }
    for (const key of Object.keys(value)) {
      collectString(key, exact, suffixes)
      stack.push((value as Record<string, unknown>)[key])
    }
  }
  return { exact, suffixes }
}

/**
 * 「这份落盘文件还有没有人用」的唯一判定：删一版当场判、延后真删到点再判、打开项目清扫遗留时再判、素材库列表藏「已删待回收」，
 * 都只问它。`references === null` = 这一刻拿不到完整的项目内容 → 一律当「有人用」（读不到绝不等于没人用）。
 */
export function isProjectFileReferenced(target: ProjectFileTarget, references: ProjectFileReferences | null): boolean {
  if (!references) return true
  return references.exact.has(exactKey(target.projectId, target.relativePath))
    || references.suffixes.has(normalizeRelativePath(target.relativePath))
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

/** 这个地址「就是」这份文件（不是「用着」它）：删一份落盘文件时，地址是它的结果一起摘。 */
function urlIsFile(url: unknown, target: ProjectFileTarget): boolean {
  const parsed = parseNomiLocalAssetUrl(url)
  return parsed?.projectId === target.projectId && parsed.relativePath === target.relativePath
}

/** 素材自己那份文件：只认本项目的地址（指向别的项目的旧数据 = 没有本项目的文件可删）。 */
function ownProjectFile(renderUrl: string, projectId: string): ProjectFileTarget | null {
  const parsed = parseNomiLocalAssetUrl(renderUrl)
  return parsed && parsed.projectId === projectId ? parsed : null
}

function fileFate(target: ProjectFileTarget, matches: readonly AssetResultDeletionMatch[], scope: AssetDeletionScope): NonNullable<AssetDeletionPlan['file']> {
  // 一份文件可能同时挂在好几处（别的卡的结果、封面、白板图层、时间轴、分镜参考、节点参考、助手输入）：先在画布上摘掉，
  // 再用唯一的引用判定把摘完以后的整份项目内容扫一遍。
  const remaining = applyAssetResultDeletion(scope.nodes, matches)
  const references = scope.rest === null ? null : collectProjectFileReferences(remaining, scope.rest)
  return { target, fate: isProjectFileReferenced(target, references) ? 'keep' : 'trash' }
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
    const resultIds = listNodeMediaResults(node).filter((result) => urlIsFile(result.url, target)).map(resultIdentity)
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
