/**
 * 执行计划的**显示边界**：把引擎产的 `code + 数值参数` 渲染成用户读得懂的一句话。
 *
 * 为什么分成两层（R15，返工 5）：`planResolver` 是纯引擎，也被 agent/MCP 面消费，它产中文散文
 * 就等于把 UI 文案硬编码进主进程——上一版靠给 `check:check-i18n-visible-text` 加豁免绕过门岗，
 * 而豁免的理由自己写的就是「这是 UI 文案」。现在引擎只交代判据与真实数值，句子在这里按
 * `zh-CN` / `en` 模板成形，两种语言逐条对齐。
 *
 * 面板、行内警示、闸 toast 三处共用本文件 —— 同一条判据在三个地方必须是同一句话。
 */
import type {
  MergeProposal,
  PlanIssue,
  SplitProposal,
} from '../../../../electron/shared/videoCapabilities/planResolver'
import type { ResolveBlocker } from '../../generationCanvas/agent/storyboardStrategy'

type StrategyTranslate = (key: string, options?: Record<string, unknown>) => string

type AggregatedIssue = {
  issue: PlanIssue
  shotIds: string[]
}

/** Collapse identical issue/model corrections while preserving shot targeting. */
export function aggregateIssues(issues: readonly PlanIssue[]): AggregatedIssue[] {
  const groups = new Map<string, AggregatedIssue>()
  for (const issue of issues) {
    const requested = issue.params.requested ?? ''
    const modelLabel = issue.params.modelLabel ?? ''
    const key = `${issue.code}\u0000${requested}\u0000${modelLabel}`
    const current = groups.get(key)
    if (current) {
      if (issue.shotId) current.shotIds.push(issue.shotId)
      continue
    }
    groups.set(key, { issue: { ...issue }, shotIds: issue.shotId ? [issue.shotId] : [] })
  }
  return [...groups.values()]
}

/**
 * 引擎 code → i18n 键。写成显式字面量表而不是 `code.replace('.', '')`：
 * `check:i18n-key-refs` / `check:i18n-dead-keys` 只认得出字面量键，拼出来的键在门岗眼里是死词条。
 */
const ISSUE_KEYS: Record<PlanIssue['code'], string> = {
  'no.candidates': 'storyboardEditor.strategy.issue.noCandidates',
  'model.missing': 'storyboardEditor.strategy.issue.modelMissing',
  'mode.fallback': 'storyboardEditor.strategy.issue.modeFallback',
  'mode.missing': 'storyboardEditor.strategy.issue.modeMissing',
  'param.unknown': 'storyboardEditor.strategy.issue.paramUnknown',
  'param.clamped': 'storyboardEditor.strategy.issue.paramClamped',
  'param.value': 'storyboardEditor.strategy.issue.paramValue',
  'duration.unsupported': 'storyboardEditor.strategy.issue.durationUnsupported',
  'duration.clamped': 'storyboardEditor.strategy.issue.durationClamped',
  'duration.underflow': 'storyboardEditor.strategy.issue.durationUnderflow',
  'duration.overflow': 'storyboardEditor.strategy.issue.durationOverflow',
}

export function describeIssue(t: StrategyTranslate, issue: PlanIssue): string {
  return t(ISSUE_KEYS[issue.code], issue.params)
}

/** 「a(3s) + b(4s)」这种镜头清单：id 与秒数都是数据，与语言无关。 */
function shotList(proposal: MergeProposal): string {
  return proposal.shotIds.map((id, index) => `${id}(${proposal.shotDurations[index] ?? 0}s)`).join(' + ')
}

export function describeMerge(t: StrategyTranslate, proposal: MergeProposal): string {
  const params = {
    shots: shotList(proposal),
    total: proposal.totalSec,
    duration: proposal.durationSec,
    modelLabel: proposal.modelLabel,
    modeLabel: proposal.modeLabel,
    min: proposal.durationMin,
    max: proposal.durationMax,
  }
  return proposal.advisory
    ? t('storyboardEditor.strategy.reason.mergeAdvisory', params)
    : t('storyboardEditor.strategy.reason.mergeRequired', params)
}

export function describeSplit(t: StrategyTranslate, proposal: SplitProposal): string {
  return t('storyboardEditor.strategy.reason.split', {
    duration: proposal.durationSec,
    modelLabel: proposal.modelLabel,
    modeLabel: proposal.modeLabel,
    max: proposal.durationMax,
    count: proposal.pieces.length,
    pieces: proposal.pieces.map((piece) => piece.durationSec).join('+'),
  })
}

/** 闸 toast 的一句话（第一条阻断）。 */
export function describeBlocker(t: StrategyTranslate, blocker: ResolveBlocker): string {
  if (blocker.kind === 'split') return describeSplit(t, blocker.proposal)
  if (blocker.kind === 'merge') return describeMerge(t, blocker.proposal)
  return describeIssue(t, blocker.issue)
}
