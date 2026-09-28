import type { GenerationCanvasNode, GenerationNodeResult } from './generationCanvasTypes'

export type NodeResultLifecyclePatch = Pick<GenerationCanvasNode, 'result' | 'history' | 'status' | 'error'>

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

export function normalizeNodeResultVersionNumbers(
  node: Pick<GenerationCanvasNode, 'result' | 'history'>,
): Pick<GenerationCanvasNode, 'result' | 'history'> {
  const entries = [node.result, ...(node.history ?? [])].filter((entry): entry is GenerationNodeResult => Boolean(entry))
  if (entries.length === 0 || entries.every((entry) => Number.isInteger(entry.versionNo) && entry.versionNo! > 0)) return node
  const seen = new Set<string>()
  const unique = entries.filter((entry) => {
    const identity = resultIdentity(entry)
    if (!identity || seen.has(identity)) return false
    seen.add(identity)
    return true
  })
  const nextEntries = unique.map((entry, index) => ({ ...entry, versionNo: unique.length - index }))
  const byIdentity = new Map(nextEntries.map((entry) => [resultIdentity(entry), entry]))
  return {
    result: node.result ? byIdentity.get(resultIdentity(node.result)) : undefined,
    history: (node.history ?? []).map((entry) => byIdentity.get(resultIdentity(entry)) ?? entry),
  }
}

function isVisualMediaResult(result: GenerationNodeResult | undefined): result is GenerationNodeResult {
  if (!result || (result.type !== 'image' && result.type !== 'video')) return false
  return Boolean(String(result.url || result.thumbnailUrl || '').trim())
}

function isAssetResult(result: GenerationNodeResult | undefined): result is GenerationNodeResult {
  if (!result || !['image', 'video', 'audio', 'model3d'].includes(result.type)) return false
  return Boolean(String(result.url || result.thumbnailUrl || '').trim())
}

function listNodeResults(node: Pick<GenerationCanvasNode, 'result' | 'history'>): GenerationNodeResult[] {
  const results: GenerationNodeResult[] = []
  const seen = new Set<string>()
  for (const result of [node.result, ...(node.history ?? [])]) {
    if (!result) continue
    const identity = resultIdentity(result)
    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    results.push(result)
  }
  return results
}

export function listNodeMediaResults(node: Pick<GenerationCanvasNode, 'result' | 'history'>): GenerationNodeResult[] {
  return listNodeResults(node).filter(isAssetResult)
}

/**
 * 版本托盘的稳定顺序：history 是持久化版本序，切换 current 只改 result 指针，不应让卡片跳位。
 * 极旧快照若 current 未进入 history，则把它补到最前；之后仍按 history 原序去重。
 */
export function listStableNodeMediaResults(node: Pick<GenerationCanvasNode, 'result' | 'history'>): GenerationNodeResult[] {
  const history = (node.history ?? []).filter(isVisualMediaResult)
  const seen = new Set<string>()
  const stable: GenerationNodeResult[] = []
  const currentIdentity = node.result ? resultIdentity(node.result) : ''
  if (isVisualMediaResult(node.result) && !history.some((entry) => resultIdentity(entry) === currentIdentity)) {
    stable.push(node.result)
    seen.add(currentIdentity)
  }
  for (const entry of history) {
    const identity = resultIdentity(entry)
    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    stable.push(entry)
  }
  return stable
}

export function removeNodeResult(
  node: Pick<GenerationCanvasNode, 'result' | 'history'>,
  identity: string,
): NodeResultLifecyclePatch | null {
  const results = listNodeResults(node)
  const target = results.find((result) => resultIdentity(result) === identity)
  if (!target || !isAssetResult(target)) return null
  const remaining = results.filter((result) => resultIdentity(result) !== identity)
  if (remaining.length === 0) {
    return { result: undefined, history: [], status: 'idle', error: undefined }
  }
  const currentIdentity = node.result ? resultIdentity(node.result) : ''
  const currentResult = currentIdentity && currentIdentity !== identity
    ? remaining.find((result) => resultIdentity(result) === currentIdentity)
    : undefined
  const nextResult = currentResult ?? remaining.find(isAssetResult)
  if (!nextResult) {
    return { result: undefined, history: remaining, status: 'idle', error: undefined }
  }
  return {
    result: nextResult,
    history: [nextResult, ...remaining.filter((result) => resultIdentity(result) !== resultIdentity(nextResult))],
    status: 'success',
    error: undefined,
  }
}
