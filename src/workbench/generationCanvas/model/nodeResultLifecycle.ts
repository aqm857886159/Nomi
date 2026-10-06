import type { GenerationCanvasNode, GenerationNodeResult } from './generationCanvasTypes'

// 节点的「几版」（主图 `result` + 版本列表 `history`）——唯一 owner。
//
// 谁往一个节点上加一版、删一版、换主图、给版本编号，都走这里；调用方不许自己拼 history。
// 2026-10-06 之前同一件事有三份手抄（生成落地 nodeRunOutcome、图片本地编辑 useNodeImageEditing、
// 白板快照 WhiteboardModal），三份都自己拼「同一版怎么认」，而且把当前主图挪到最前，
// 于是用户把旧版设成主图后再出一版，列表顺序就乱了——「第 N 版」只能拿下标凑，一增一删就漂。
//
// 两条不变量：
// 1. history 是持久的「新 → 旧」顺序：加一版只往最前插，删一版只把它拿掉，换主图只改 `result` 指针。
// 2. 每一版有自己的 `versionNo`（1 = 最早），号跟着版本走：删了留空号，新的一版 = 当前最大号 + 1。

export type NodeResultLifecyclePatch = Pick<GenerationCanvasNode, 'result' | 'history' | 'status' | 'error'>
type NodeResults = Pick<GenerationCanvasNode, 'result' | 'history'>

export function resultIdentity(result: GenerationNodeResult): string {
  return String(
    result.id ||
      result.url ||
      result.thumbnailUrl ||
      result.assetRefId ||
      result.assetId ||
      result.text ||
      '',
  )
}

function isVisualMediaResult(result: GenerationNodeResult | undefined): result is GenerationNodeResult {
  if (!result || (result.type !== 'image' && result.type !== 'video')) return false
  return Boolean(String(result.url || result.thumbnailUrl || '').trim())
}

function isAssetResult(result: GenerationNodeResult | undefined): result is GenerationNodeResult {
  if (!result || !['image', 'video', 'audio', 'model3d'].includes(result.type)) return false
  return Boolean(String(result.url || result.thumbnailUrl || '').trim())
}

function hasVersionNo(result: GenerationNodeResult): boolean {
  return Number.isInteger(result.versionNo) && (result.versionNo as number) > 0
}

/**
 * 持久顺序（新 → 旧）去重后的全部结果。history 是正本；极旧快照里当前主图没进 history 的，
 * 当作最新的一版补在最前（它当年就是这么被生成出来的：新结果直接顶成主图）。
 */
function listDurableResults(node: NodeResults): GenerationNodeResult[] {
  const history = (node.history ?? []).filter((entry): entry is GenerationNodeResult => Boolean(entry))
  const current = node.result
  const ordered = current && !history.some((entry) => resultIdentity(entry) === resultIdentity(current))
    ? [current, ...history]
    : history
  const seen = new Set<string>()
  return ordered.filter((entry) => {
    const identity = resultIdentity(entry)
    if (!identity || seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

/** 当前主图在 history 里那一份才是正本（带编号）；指针本身可能是旧引用。 */
function canonicalResult(node: NodeResults, entries: readonly GenerationNodeResult[]): GenerationNodeResult | undefined {
  if (!node.result) return undefined
  const identity = resultIdentity(node.result)
  return entries.find((entry) => resultIdentity(entry) === identity) ?? node.result
}

/**
 * 给缺号 / 撞号的版本补号，**已有的合法号一个都不动**（号一旦给出去就跟着那一版走）。
 * - 全都没号（旧项目）：按持久顺序编，最早 = 1、最新 = N。
 * - 部分有号：没号的按「旧 → 新」接在当前最大号后面——只会在旧数据被直接追加过时出现，宁可号偏大也不改别人的号。
 * 已经全部合法时原样返回同一个对象（打开项目时据此判断要不要写盘）。
 */
export function normalizeNodeResultVersionNumbers<T extends NodeResults>(node: T): T {
  const entries = listDurableResults(node)
  if (entries.length === 0) return node
  const used = new Set<number>()
  const missing: GenerationNodeResult[] = []
  for (const entry of entries) {
    if (hasVersionNo(entry) && !used.has(entry.versionNo as number)) used.add(entry.versionNo as number)
    else missing.push(entry)
  }
  const historyMatchesEntries = (node.history ?? []).length === entries.length
    && (node.history ?? []).every((entry, index) => entry === entries[index])
  if (missing.length === 0 && historyMatchesEntries) return node
  const assigned = new Map<GenerationNodeResult, number>()
  if (used.size === 0) {
    entries.forEach((entry, index) => assigned.set(entry, entries.length - index))
  } else {
    let next = Math.max(...used)
    for (const entry of [...missing].reverse()) assigned.set(entry, (next += 1))
  }
  const numbered = entries.map((entry) => assigned.has(entry) ? { ...entry, versionNo: assigned.get(entry) } : entry)
  return { ...node, result: canonicalResult(node, numbered), history: numbered }
}

/**
 * 节点多了一版（生成落地 / 本地编辑产物 / 白板快照）：编号 = 当前最大号 + 1，插在最前，并顶成主图
 * （「新生成的版本自动变主图」是现行行为，见 docs/plan/2026-09-28-version-cards.md §5）。
 * 同一版再落一次（身份相同）不新增、不换号，只更新内容并顶成主图。
 */
export function appendNodeResultVersion(node: NodeResults, incoming: GenerationNodeResult): Required<Pick<GenerationCanvasNode, 'history'>> & { result: GenerationNodeResult } {
  const base = normalizeNodeResultVersionNumbers(node)
  const entries = base.history ?? []
  const identity = resultIdentity(incoming)
  const existing = identity ? entries.find((entry) => resultIdentity(entry) === identity) : undefined
  const maxVersion = entries.reduce((max, entry) => Math.max(max, entry.versionNo ?? 0), 0)
  const landed: GenerationNodeResult = { ...incoming, versionNo: existing?.versionNo ?? maxVersion + 1 }
  const rest = identity ? entries.filter((entry) => resultIdentity(entry) !== identity) : entries
  return { result: landed, history: [landed, ...rest] }
}

/** 换主图：只改指针，版本顺序和编号不动。找不到这一版 = null（调用方什么也不做）。 */
export function setNodeMainResultPatch(node: NodeResults, identity: string): Pick<GenerationCanvasNode, 'result' | 'status' | 'error'> | null {
  const target = listDurableResults(node).find((entry) => resultIdentity(entry) === identity)
  if (!target) return null
  return { result: target, status: 'success', error: undefined }
}

/** 素材库要的列表：当前主图在最前，其余按持久顺序（素材库按「这个节点现在是什么」排，不按版本号）。 */
export function listNodeMediaResults(node: NodeResults): GenerationNodeResult[] {
  const durable = listDurableResults(node)
  const main = canonicalResult(node, durable)
  const ordered = main ? [main, ...durable.filter((entry) => resultIdentity(entry) !== resultIdentity(main))] : durable
  return ordered.filter(isAssetResult)
}

/** 可视的版本（图 / 视频），持久顺序：新 → 旧。 */
export function listStableNodeMediaResults(node: NodeResults): GenerationNodeResult[] {
  return listDurableResults(node).filter(isVisualMediaResult)
}

/**
 * 版本卡要的列表：可视的版本按「第 N 版」从大到小（最新紧挨节点）。没号的旧数据退回持久顺序——
 * 打开项目时已经补过号，这条退路只给还没经过打开流程的副本用，不会产生第二套编号。
 */
export function listNodeResultVersions(node: NodeResults): Array<GenerationNodeResult & { versionNo: number }> {
  const numbered = normalizeNodeResultVersionNumbers(node)
  return listStableNodeMediaResults(numbered)
    .map((entry) => entry as GenerationNodeResult & { versionNo: number })
    .sort((a, b) => b.versionNo - a.versionNo)
}

/**
 * 删一版：只把它从持久顺序里拿掉，别的版本顺序和编号都不动。删的是主图时，剩下号最大的那一版顶上
 * （= 最新的一版，下游跟着换——提示里要写明，见方案 §1）。
 */
export function removeNodeResult(node: NodeResults, identity: string): NodeResultLifecyclePatch | null {
  const entries = listDurableResults(node)
  const target = entries.find((result) => resultIdentity(result) === identity)
  if (!target || !isAssetResult(target)) return null
  const remaining = entries.filter((result) => resultIdentity(result) !== identity)
  if (remaining.length === 0) {
    return { result: undefined, history: [], status: 'idle', error: undefined }
  }
  const currentIdentity = node.result ? resultIdentity(node.result) : ''
  const keptCurrent = currentIdentity && currentIdentity !== identity
    ? remaining.find((result) => resultIdentity(result) === currentIdentity)
    : undefined
  const newest = remaining
    .filter(isAssetResult)
    .reduce<GenerationNodeResult | undefined>((best, entry) => (!best || (entry.versionNo ?? 0) > (best.versionNo ?? 0) ? entry : best), undefined)
  const nextResult = keptCurrent ?? newest
  if (!nextResult) {
    return { result: undefined, history: remaining, status: 'idle', error: undefined }
  }
  return { result: nextResult, history: remaining, status: 'success', error: undefined }
}

/**
 * 打开项目时的一次性补号（同镜头编号的 backfillShotIndexes：存量缺号按确定性规则补一次、立刻写盘，
 * 之后号就是存储身份）。没变的节点保留原引用，`changed` 决定要不要写盘。
 */
export function backfillNodeResultVersionNumbers<T extends NodeResults>(nodes: readonly T[]): { nodes: T[]; changed: boolean } {
  let changed = false
  const next = nodes.map((node) => {
    const normalized = normalizeNodeResultVersionNumbers(node)
    if (normalized !== node) changed = true
    return normalized
  })
  return { nodes: next, changed }
}
