// Collapse repeated work; uncertain assistant text remains visible (B2a).
import type { ToolReceipt, V4FlowItem, V4ToolStatus } from './agentPanelV4Types'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** 一段「工作」的边界：用户气泡、任务卡、介入相关的任何东西都会把它截断。 */
function isWorkItem(item: V4FlowItem): boolean {
  // A waiting tool stays visible beside its decision, outside the folded work history.
  return (item.kind === 'tool' && item.receipt.status !== 'approval-requested') || item.kind === 'assistant' || item.kind === 'thinking'
}

/**
 * 相邻收据折成**一行**时的分组键：同一个动作 + 同一句人话标签才算同一行。
 * 分隔符用转义的 U+0000：标签是人话，任何可见字符都可能出现在里面，撞了就会把两个不同的工具
 * 当成同一组折起来。裸 NUL 会让整个文件对 grep/git 变成二进制（`check:nul-bytes`），所以写转义。
 */
function groupKey(receipt: ToolReceipt): string {
  return `${receipt.action}\u0000${receipt.label}`
}

/**
 * 「这是**同一次自纠**吗」——和「是不是同一行」是两个问题，判据也不同（2026-09-21）。
 *
 * 此前两个问题共用 `action + label` 一把尺子，而 `label` 是跟着参数走的人话摘要：
 * 模型换了参数重发，label 就变了，于是同一次自纠永远被认成两件不同的事——
 * 重试数恒为 0，被退回的那一次永远等不到它的后继，回合结束还挂着一条红条
 * （实测：**成功**的回合里也挂着）。自纠的身份是「它又去做同一类事了」，不是那一次的措辞。
 */
function retryKey(receipt: ToolReceipt): string {
  return receipt.action
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
      && receipts.slice(at + 1).some(next => retryKey(next) === retryKey(receipt)))
    // 「还没解决」只有**回合落定之后**才算得准（2026-09-21）。
    //
    // 回合还在跑的时候，刚被退回、模型正准备重发的那一次后面**当然**还没有后继——
    // 按这个判据它就是「未解决」，于是当场弹一条红条：停止钮还亮着，上面已经排了三条红
    // （真截图 v4-reconcile/now-A1-panel.png）。判据没错，只是算早了一拍。
    // 定稿的规则是「每个时刻只有一个东西在动」＋「失败跟着它那一行走」——跑着的时候
    // 那个「在动的东西」就是过程行自己，它会在摘要里说「第 N 次尝试」。
    const unresolved = running ? [] : receipts.filter((receipt, at) => receipt.status === 'output-error'
      && !receipts.slice(at + 1).some(next => retryKey(next) === retryKey(receipt)))
    const duration = turn ? (running ? timing!.elapsedSeconds : (Date.parse(turn.updatedAt) - Date.parse(turn.createdAt)) / 1000) : undefined
    const elapsed = duration !== undefined && Number.isFinite(duration) ? `${Math.max(0, Math.round(duration))}s` : undefined
    // 终态失败的红条**挂在出错那一行下面**，不在对话流里另起一块
    // （定稿 #4「失败留原行不弹窗」；组件自己的契约注释也写着「它跟着收据或任务卡走，不是独立积木」）。
    // 过程行默认是收起的，所以带着未解决失败的那一段**自己展开**（AI Elements 的 Tool 件同解剖：
    // 错误态默认展开）——否则「留在原行」就等于「藏起来」。
    const unresolvedSet = new Set(unresolved)
    const withErrors: { item: V4FlowItem; index: number }[] = []
    for (const detail of details) {
      withErrors.push(detail)
      const owned = detail.item.kind === 'tool' ? (unresolvedSet.has(detail.item.receipt) ? [detail.item.receipt] : [])
        : detail.item.kind === 'tool-group' ? detail.item.receipts.filter(receipt => unresolvedSet.has(receipt))
          : []
      // 一组里只挂**第一条**没解决的：后面几次是同一堵墙的复读，把同一句话抄 N 遍不是信息。
      // 一行只说**一句**：折成一组的那几次里，说的是这一行自己印着的那个原因（第一条失败——
      // 后面几次是同一堵墙的复读）。行上印一句、行下再印另一句，会让人以为是两件事。
      const spoken = detail.item.kind === 'tool-group' ? detail.item.reason : undefined
      // 先问「这一行有没有**没解决**的失败」，再问「说得出原因吗」。反过来会让一组里
      // 那条已经被后继解决掉的失败原因（行上印着的那句）在回合中途又变出一条红条。
      const reason = owned.length > 0 ? (spoken || owned[0]!.summary) : undefined
      // **没有原因就不挂这一条**：行尾已经写着「失败」，再挂一条只复述行标签的红条
      // （「停止任务」）等于把一个动作名说成一个原因——一句没有行动价值的话（R2）。
      if (reason) withErrors.push({ item: { kind: 'error', reason }, index: detail.index })
    }
    // 回合中说重试（2026-09-21 用户拍板②）：摘要一句「第 N 次尝试」，展开才见那句灰字。
    const attempt = running && retried.length > 0 ? retried.length + 1 : 0
    out.push({
      identity: stretch[0]?.identity ? `${stretch[0].identity}:process` : undefined, kind: 'process', running, toolCount: receipts.length, retries: retried.length,
      ...(unresolved.length > 0 ? { failed: true as const } : {}),
      // 展开才见的那句灰字。**不做成一条 thinking 明细**：明细里的 kind 有各自的契约
      // （C77：跑着的过程行不摆思考明细），借它的壳说别的话迟早撞车。
      ...(attempt > 0 ? { retryNote: t('agentPanelV4.processRetryingDetail') } : {}),
      label: running
        ? (attempt > 0 ? t('agentPanelV4.processAttempt', { count: attempt }) : last.label)
        : retried.length
          ? t('agentPanelV4.processSummaryWithRetries', { count: retried.length, tools: receipts.length })
          : t('agentPanelV4.processSummary', { count: receipts.length }),
      ...(elapsed ? { elapsed } : {}), details: withErrors,
      segments: work.flatMap(item => item.kind === 'thinking' ? [item.meta || item.label] : []),
    })
    out.push(...stretch.filter(item => item.kind === 'assistant'))
    index = end
  }
  return Object.freeze(out)
}
