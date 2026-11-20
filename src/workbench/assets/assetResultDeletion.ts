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
  undo?: Iterable<{ position: number; nodes: readonly GenerationCanvasNode[] }>
}

export type AssetResultDeletionMatch = {
  nodeId: string
  /** 这张卡上要摘掉的结果（一张卡上可能有几版就是同一份文件）。 */
  resultIds: string[]
  patch: NodeResultLifecyclePatch
}

/**
 * 素材库里一张素材「删了会怎样」——唯一判定。项目素材、全部素材、外部删文件命令都只经它。
 *
 * - `matches`：要从画布卡上摘掉的结果（卡本身保留）。
 * - `file`：这张素材自己那份落盘文件（只认本项目的）和它的去向：`trash` = 摘完以后没人用了，进回收站；
 *   `keep` = 项目里还有别的内容提到它（分镜参考、节点参考、助手输入、时间轴、白板、别的结果……），留着，并且要告诉用户为什么没删。
 *
 * - `defer`：此刻只有可达撤销/重做材料引用文件，沿用该步期限延后回收，不增加在用阻挡。
 *
 * 列表里出现的每一种素材都落在 matches × file 的某个组合上，执行口对每个组合都有确定的结果。
 * 2026-10-24 之前判定是隐式的 `{ matches, fileTarget }`，已加载 / 关闭两条执行路径各自解读：
 * 已加载项目里「画布上没有结果、只有文件」的素材被直接放过（夜跑 asset-library-interactions ⑤，一张都删不掉）。
 */
export type AssetDeletionPlan = {
  matches: AssetResultDeletionMatch[]
  file: ({ target: ProjectFileTarget } & ({ fate: 'trash' | 'keep' } | { fate: 'defer'; journalPosition: number })) | null
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

/**
 * 项目内容里提到过的文件，两种粒度：
 * - `exact`：本地地址（nomi-local）解出的「项目 + 相对路径」，精确比（别的项目的同名文件不算）；
 * - `text`：其余提到路径的文字（裸相对 / 绝对路径、file://、Windows 路径、夹在文字里的），规范化后拼成一段，
 *   查询时找「整段相对路径出现在路径边界上」——没有项目 id 可核，宁可多留。
 *
 * 规范化对「地址写法 × 路径里的字符」整类成立，不按字符打补丁：写法（编码 / 二次编码 / 未编码、查询串和锚点、
 * 反斜杠、盘符大小写）都在建索引时摊平成同一种样子；路径里的字符（空格、中文、组合字符、# % + & 括号）
 * 不再被当作分隔符或截断点——串里有空白也照样扫。
 */
export type ProjectFileReferences = {
  readonly exact: ReadonlySet<string>
  readonly text: string
}

/** 文字里夹着的本地地址：到空白、引号、尖括号为止（括号、方括号是合法的地址字符，结尾多吃的标点下面逐个削掉试）。 */
const LOCAL_URL_IN_TEXT = /nomi-local:\/\/[^\s"'<>`]+/gi
const LOCAL_URL_PREFIX = /^nomi-local:\/\/(asset|production-preview)\//i
/** 别的协议的地址（https、blob……）不是项目文件，先从文字里抠掉；file:// 留着。 */
const OTHER_URL_IN_TEXT = /(?<![a-z0-9+.-])(?!file:)[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`]*/gi
const DATA_URI_IN_TEXT = /data:[a-z]+\/[^\s"'<>`]*/gi
/** 夹在文字 / Markdown 里时地址尾巴可能带上的标点。 */
const TRAILING_PUNCTUATION = /[)\]}([{.,;:!?，。、；：！？」』）】]$/
const MAX_DECODE_ROUNDS = 3

/** 宽松百分号解码一轮：整段能按 UTF-8 解的解掉；解不了的（文件名里本来就有的 %、半个多字节字符）只解 ASCII 那几个，其余原样留。 */
function decodeOnce(value: string): string {
  return value.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try { return decodeURIComponent(run) } catch {
      return run.replace(/%([0-7][0-9a-f])/gi, (_escape, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    }
  })
}

/** 原样 + 每一轮解码的结果（二次编码解两轮），直到不再变化，最多三轮。每一种都算这份地址的一个写法。 */
function decodeRounds(value: string): string[] {
  const rounds = [value]
  let current = value
  for (let round = 0; round < MAX_DECODE_ROUNDS && current.includes('%'); round += 1) {
    const next = decodeOnce(current)
    if (next === current) break
    rounds.push(next)
    current = next
  }
  return rounds
}

/** 比较前统一：分隔符（反斜杠、重复斜杠）、Unicode 组合形式、大小写（macOS / Windows 文件系统默认不区分大小写，盘符也是）。 */
function normalizePathText(value: string): string {
  // 快路径（扫描里绝大多数地址）：纯 ASCII、没有反斜杠 / 重复斜杠 —— 只需小写。
  if (!/[^\x20-\x7e]|\\|\/\//.test(value)) return value.toLowerCase()
  return value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').normalize('NFC').toLowerCase()
}

function normalizeRelativePath(value: string): string {
  return normalizePathText(value.trim()).replace(/^(?:\.\/|\/)+/, '')
}

function exactKey(projectId: string, relativePath: string): string {
  return `${projectId.trim()}\u0000${normalizeRelativePath(relativePath)}`
}

/**
 * 本地地址 nomi-local://asset/<项目>/<路径> 与 nomi-local://production-preview/<项目>/<run>/<artifact>/<路径>?preview=…：
 * 带不带查询串 / 锚点（未编码的 # 也可能是文件名的一部分）× 每一轮解码，全部记成精确键。
 */
function addLocalUrl(url: string, exact: Set<string>): void {
  const prefix = LOCAL_URL_PREFIX.exec(url)
  if (!prefix) return
  const preview = prefix[1].toLowerCase() === 'production-preview'
  const remainder = url.slice(prefix[0].length)
  const withoutQuery = remainder.split(/[?#]/, 1)[0]
  for (const raw of withoutQuery === remainder ? [remainder] : [withoutQuery, remainder]) {
    for (const decoded of decodeRounds(raw)) {
      const segments = decoded.split('/').filter(Boolean)
      const projectId = segments[0]?.trim()
      const pathSegments = preview ? segments.slice(3) : segments.slice(1)
      if (projectId && pathSegments.length > 0) exact.add(exactKey(projectId, pathSegments.join('/')))
    }
  }
}

/** 文字里抠出来的本地地址：尾巴上的标点逐个削掉，每一种长度都试（文件名本身也可能以括号结尾）。 */
function addLocalUrlFromText(found: string, exact: Set<string>): void {
  // 两个地址首尾相接（中间没有空白）：按下一个地址的开头切开。
  for (const piece of found.split(/(?=nomi-local:)/i)) {
    let candidate = piece
    addLocalUrl(candidate, exact)
    while (TRAILING_PUNCTUATION.test(candidate)) {
      candidate = candidate.slice(0, -1)
      addLocalUrl(candidate, exact)
    }
  }
}

const ADDRESS_STOP = /[\s"'<>`]/

function collectString(value: string, exact: Set<string>, texts: string[]): void {
  // 指向文件的写法一定带路径分隔符：键名、短词、普通文案在这里就过去了。
  if (value.length < 3 || (value.indexOf('/') < 0 && value.indexOf('\\') < 0) || value.startsWith('data:')) return
  let rest = value
  if (value.indexOf('nomi-local:') >= 0 || /nomi-local:/i.test(value)) {
    const whole = value.trim()
    const single = whole.startsWith('nomi-local://')
      ? whole.indexOf('nomi-local:', 1) < 0
      : LOCAL_URL_PREFIX.test(whole) && whole.toLowerCase().indexOf('nomi-local:', 1) < 0
    if (single) {
      // 整串当一个地址（最常见；未编码的空格、括号也算在地址里）。中间没有空白引号的，就只是一个地址。
      addLocalUrl(whole, exact)
      if (!ADDRESS_STOP.test(whole)) return
    }
    // 长文本（原稿、提示词、富文本 JSON）里夹着地址：逐个解析，同时从文字里抠掉——本地地址只按项目精确比。
    rest = value.replace(LOCAL_URL_IN_TEXT, (found) => { addLocalUrlFromText(found, exact); return ' ' })
  }
  if (rest.indexOf('://') >= 0) rest = rest.replace(OTHER_URL_IN_TEXT, ' ')
  if (rest.indexOf('data:') >= 0) rest = rest.replace(DATA_URI_IN_TEXT, ' ')
  if (rest.indexOf('/') < 0 && rest.indexOf('\\') < 0) return
  for (const decoded of decodeRounds(rest)) texts.push(normalizePathText(decoded))
}

/** 相对路径前后必须是路径边界：前面是开头 / 分隔符 / 冒号（盘符、asset: 前缀）/ 空白 / 引号括号；后面不能接着同一个文件名。 */
const ENTRY_SEPARATOR = '\u0000'
const PATH_START_BOUNDARY = /[\s/:"'`([{<>=,;|]/
function endsAtBoundary(text: string, end: number): boolean {
  const next = text[end]
  if (next === undefined || !/[a-z0-9_.-]/.test(next)) return true
  // 「…a.png。」「…a.png.」是句末标点；「a.png.bak」「a.png2」是别的文件。
  return next === '.' && !/[a-z0-9_-]/.test(text[end + 1] ?? '')
}

function textMentionsPath(text: string, path: string): boolean {
  if (!path) return false
  for (let at = text.indexOf(path); at >= 0; at = text.indexOf(path, at + 1)) {
    const before = text[at - 1]
    if ((at === 0 || before === ENTRY_SEPARATOR || PATH_START_BOUNDARY.test(before)) && endsAtBoundary(text, at + path.length)) return true
  }
  return false
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
  const texts: string[] = []
  const seen = new WeakSet<object>()
  const stack: unknown[] = [rest, ...nodes.map(nodeLivenessView)]
  while (stack.length > 0) {
    const value = stack.pop()
    if (typeof value === 'string') { collectString(value, exact, texts); continue }
    if (!value || typeof value !== 'object') continue
    if (seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) { for (const item of value) stack.push(item); continue }
    if (value instanceof Map) { for (const [key, item] of value) stack.push(key, item); continue }
    if (value instanceof Set) { for (const item of value) stack.push(item); continue }
    for (const key of Object.keys(value)) {
      collectString(key, exact, texts)
      stack.push((value as Record<string, unknown>)[key])
    }
  }
  return { exact, text: texts.join(ENTRY_SEPARATOR) }
}

/**
 * 「这份落盘文件还有没有人用」的唯一判定：删一版当场判、延后真删到点再判、打开项目清扫遗留时再判、素材库列表藏「已删待回收」，
 * 都只问它。`references === null` = 这一刻拿不到完整的项目内容 → 一律当「有人用」（读不到绝不等于没人用）。
 */
export function isProjectFileReferenced(target: ProjectFileTarget, references: ProjectFileReferences | null): boolean {
  if (!references) return true
  return references.exact.has(exactKey(target.projectId, target.relativePath))
    || textMentionsPath(references.text, normalizeRelativePath(target.relativePath))
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
  if (isProjectFileReferenced(target, references)) return { target, fate: 'keep' }
  // 摘结果会新建自己的撤销步；只有纯文件删除才需要找此前仍能恢复它的那一步。
  if (matches.length === 0) for (const snapshot of scope.undo ?? []) {
    if (isProjectFileReferenced(target, collectProjectFileReferences(snapshot.nodes, {}))) {
      return { target, fate: 'defer', journalPosition: snapshot.position }
    }
  }
  return { target, fate: 'trash' }
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
