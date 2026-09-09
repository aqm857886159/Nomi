// Collapse repeated work; uncertain assistant text remains visible (B2a).
import type { ToolReceipt, V4FlowItem, V4ToolStatus } from './agentPanelV4Types'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** 一段「工作」的边界：用户气泡、任务卡、介入相关的任何东西都会把它截断。 */
function isWorkItem(item: V4FlowItem): boolean {
  return item.kind === 'tool' || item.kind === 'assistant' || item.kind === 'thinking'
}

function groupKey(receipt: ToolReceipt): string {
  // 分隔符用转义的 U+0000：标签是人话，任何可见字符都可能出现在里面，撞了就会把两个不同的工具
  // 当成同一组折起来。裸 NUL 会让整个文件对 grep/git 变成二进制（`check:nul-bytes`），所以写转义。
  return `${receipt.action}\u0000${receipt.label}`
}

/**
 * 一组同名收据 → 一行。
 *
 * `status` 取「这一组最后落在哪个态」，但**全失败**是一个独立的说法：
 * 六条里五条失败一条成功，和六条全失败，对用户是两件事。
 */
function toolGroupFor(receipts: readonly ToolReceipt[], t: Translate): V4FlowItem {
  const failures = receipts.filter((receipt) => receipt.status === 'output-error')
  const allFailed = failures.length === receipts.length
  const status: V4ToolStatus = allFailed ? 'output-error' : receipts[receipts.length - 1]!.status
  // 原因取**第一条**失败的摘要：后面几次是同一个错的复读，第一条才是模型撞上的那堵墙。
  const reason = failures[0]?.summary
  return {
    kind: 'tool-group',
    label: receipts[0]!.label,
    action: receipts[0]!.action,
    status,
    count: receipts.length,
    trailing: allFailed
      ? t('agentPanelV4.toolGroupAllFailed')
      : failures.length
        ? t('agentPanelV4.toolGroupSomeFailed', { count: failures.length })
        : t('agentPanelV4.toolGroupAllDone'),
    ...(reason ? { reason } : {}),
    receipts,
  }
}

/** 相邻同名的收据切成若干段；只有 ≥2 的那段才折。 */
function emitTools(receipts: readonly ToolReceipt[], t: Translate, out: V4FlowItem[]): void {
  let run: ToolReceipt[] = []
  const flush = (): void => {
    if (!run.length) return
    if (run.length === 1) out.push({ kind: 'tool', receipt: run[0]! })
    else out.push(toolGroupFor(run, t))
    run = []
  }
  for (const receipt of receipts) {
    if (run.length && groupKey(run[0]!) !== groupKey(receipt)) flush()
    run.push(receipt)
  }
  flush()
}

/** One process per work stretch. Assistant text remains visible even before a call. */
export function collapseV4Flow(
  flow: readonly V4FlowItem[],
  t: Translate,
  timing?: { turns: readonly { turnId: string; createdAt: string; updatedAt: string }[]; liveTurnId?: string; elapsedSeconds: number },
): readonly V4FlowItem[] {
  const out: V4FlowItem[] = []
  let index = 0
  while (index < flow.length) {
    if (!isWorkItem(flow[index]!)) { out.push(flow[index]!); index += 1; continue }
    let end = index
    while (end < flow.length && isWorkItem(flow[end]!)) end += 1
    const stretch = flow.slice(index, end)
    const receipts = stretch.flatMap(item => item.kind === 'tool' ? [item.receipt] : [])
    if (!receipts.length) { out.push(...stretch); index = end; continue }
    const last = receipts[receipts.length - 1]!
    const turn = timing?.turns.find(entry => entry.turnId === last.turnId)
    const running = turn
      ? timing?.liveTurnId === turn.turnId
      : receipts.some(receipt => receipt.status === 'input-streaming' || receipt.status === 'input-available')
        || stretch.some(item => item.kind === 'thinking' ? item.streaming === true
          : item.kind === 'assistant' && item.status === 'streaming')
    const work = stretch.filter(item => item.kind !== 'assistant')
    // Thinking is one process-level disclosure, never a receipt between tools.
    // Keep original receipt indices for actions; merging thoughts must not reindex tools.
    const grouped: V4FlowItem[] = []
    emitTools(receipts, t, grouped)
    const details = grouped.map(item => ({ item, index: index + stretch.findIndex(entry =>
      item.kind === 'tool-group' ? entry.kind === 'tool' && entry.receipt === item.receipts[0]
        : item.kind === 'tool' && entry.kind === 'tool' && entry.receipt === item.receipt) }))
    const thoughts = stretch.filter(item => item.kind === 'thinking')
    const text = thoughts.map(item => item.text).filter(Boolean).join('\n\n')
    if (!running && text) details.unshift({
      item: { kind: 'thinking', label: t('agentPanelV4.thinkingDone'), meta: '', text, streaming: false },
      index: index + stretch.findIndex(item => item.kind === 'thinking'),
    })
    // An unsuccessful attempt counts as a retry only if the same operation was attempted again.
    const retried = receipts.filter((receipt, at) => receipt.status === 'output-error'
      && receipts.slice(at + 1).some(next => groupKey(next) === groupKey(receipt)))
    const unresolved = receipts.filter((receipt, at) => receipt.status === 'output-error'
      && !receipts.slice(at + 1).some(next => groupKey(next) === groupKey(receipt)))
    const duration = turn ? (running ? timing!.elapsedSeconds : (Date.parse(turn.updatedAt) - Date.parse(turn.createdAt)) / 1000) : undefined
    const elapsed = duration !== undefined && Number.isFinite(duration) ? `${Math.max(0, Math.round(duration))}s` : undefined
    out.push({
      kind: 'process', running, toolCount: receipts.length, retries: retried.length,
      label: running ? last.label : t(retried.length ? 'agentPanelV4.processSummaryWithRetries' : 'agentPanelV4.processSummary', { count: receipts.length, retries: retried.length }),
      ...(elapsed ? { elapsed } : {}), details,
      segments: work.flatMap(item => item.kind === 'thinking' ? [item.meta || item.label] : []),
    })
    for (const receipt of unresolved) out.push({ kind: 'error', reason: receipt.summary || receipt.label })
    out.push(...stretch.filter(item => item.kind === 'assistant'))
    index = end
  }
  return Object.freeze(out)
}
