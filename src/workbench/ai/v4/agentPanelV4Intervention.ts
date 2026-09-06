// Agent 面板 v4 · 积木 ⑤ 介入槽的投影。
//
// 这个槽今天的数据**不来自宿主状态**：它来自渲染层的待决登记表，而那份记录的 `kind`
// 是靠嗅 `args` 上有没有 `missingCredential` / `missingParam` / `question` 这几个 key 猜出来的
// （现役 `ProjectAgentResidentShell.tsx:620` 一行三元表达式），`costLabel` 还是一个**静态字符串**
// 不是数字。把这套嗅探提到这里，它至少是纯函数、可以逐条单测，猜错了有地方改。
//
// 三条 2026-09-06 的产品裁决落在这个文件里：
//
// ② 「不再问 →」= **这一个能力**以后不再问（= 现役 `approvalScope: 'always'`），
//    **不是**把项目的 approvalPolicy 抬一档。而且它只出现在可撤销的改动上：
//    花钱的和不可逆的永远逐次问，跟现役 `InterventionSlot` 的门槛逐字一致，不加宽。
//
// ③ 提案**内联编辑器删除**。介入槽只有「确认 / 不要 / 不再问 →」。要改内容去那个对象自己的家
//    （分镜行双击进 v6 全页、节点进节点）——§1.5.2 一功能一个家。一个 382 行的编辑器塞在
//    composer 上方那一格里，等于在最窄的地方做最重的事。
//
// ④ `missing_param` **不进这个槽**。缺参数不是审批：它没有「不要」这个出口，用户要做的只是
//    补一句话。它走 `missingParamSuggestion()` 变成对话流里的一条提问 + 建议 chip。
import type { CapabilityEffectClass } from '../../../../electron/shared/agentCapabilities/capabilityContract'
import { residentPlanShots, residentQuestionOptions, residentProposalParameters } from '../resident/residentExceptionProjections'
import { readableToolName, readableToolPreview } from '../resident/residentToolDisplay'
import type { InterventionData, PlanRow, V4InterventionKind } from './agentPanelV4Types'

type Translate = (key: string, options?: Record<string, unknown>) => string

export type V4InterventionLabels = Readonly<{
  irreversible: string
  reversible: string
  spendBadge: string
  credentialTitle: string
  credentialConfirm: string
  credentialAlternate: string
  questionTitle: string
  planTitle: string
  more: string
  scopeOnce: string
  scopeCapability: string
}>

export type V4InterventionSource = Readonly<{
  toolName: string
  args: unknown
  effectClass: CapabilityEffectClass | undefined
  /** 同时待决的总条数。>1 时槽头补一句「还有 N 条」，不静默藏起来。 */
  pendingCount: number
  /** 时间轴计划的行（`useTimelinePlanRows` 的输出）。有就用它当计划清单。 */
  planLines?: readonly Readonly<{ text: string; technical?: string }>[]
  /** 计划槽里当前勾选的行。未提供 = 全勾。 */
  checkedPlanRows?: ReadonlySet<string>
}>

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringField(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

/**
 * ④ 缺参数：返回「问什么 + 有哪些现成答案」，或 `undefined`（这不是缺参数）。
 * 建议 chip 用工具自己给的 `options`；没给就只有问题，用户直接打字答。
 */
export function missingParamSuggestion(args: unknown, t: Translate): Readonly<{ text: string; options: readonly string[] }> | undefined {
  const record = asRecord(args)
  const missing = stringField(record, 'missingParam')
  if (!missing) return undefined
  // 工具通常只说「缺 duration」，那对用户不是一句话。有 `question` 就用它的原话，
  // 没有就把参数名包进一句人话里——但**不编具体建议值**，那得工具自己给。
  const text = stringField(record, 'question') ?? t('agentPanelV4.missingParamAsk', { name: missing })
  return Object.freeze({ text, options: residentQuestionOptions(record).map((option) => option.label) })
}

/**
 * 这次操作**要写进去的那段话**，截断成一行。
 * 字段名按常见顺序找：文稿写 `content`、时间轴/画布的提案写 `text` 或 `prompt`。
 * 一个都没有就返回 `undefined`——不编，也不用「（无内容）」占位。
 */
const EXCERPT_FIELDS = ['content', 'text', 'prompt'] as const
const EXCERPT_MAX = 60

function contentExcerpt(record: Readonly<Record<string, unknown>>): string | undefined {
  for (const field of EXCERPT_FIELDS) {
    const value = record[field]
    if (typeof value !== 'string') continue
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized) continue
    return normalized.length > EXCERPT_MAX ? `${normalized.slice(0, EXCERPT_MAX)}…` : normalized
  }
  return undefined
}

/** 这次待决属于八个 kind 里的哪一个；缺参数在这里返回 `undefined`（它不进槽）。 */
export function interventionKindOf(args: unknown, effectClass: CapabilityEffectClass | undefined, isPlan: boolean): V4InterventionKind | undefined {
  const record = asRecord(args)
  if (stringField(record, 'missingCredential')) return 'credential'
  if (stringField(record, 'missingParam')) return undefined
  if (stringField(record, 'question')) return 'question'
  if (isPlan) return 'plan'
  if (effectClass === 'spend') return 'spend'
  // 认不出的能力 fail-closed 到**不可逆**：把一个未知操作当成可撤销的，等于替用户
  // 赌「反正能撤回来」。`resolveCapabilityEffectClass` 对未登记别名返回 undefined，
  // 现役也是这么兜的（`?? 'irreversible'`）。
  if (effectClass === 'reversible_local') return 'approval-reversible'
  return 'approval-irreversible'
}

/**
 * ② 「不再问 →」的可见条件。和现役 `InterventionSlot` 的 `showAlways` 逐字一致：
 * 只有 `reversible_local` 有它，`spend` / `irreversible` 永远没有。
 * 它落地成 `approvalScope: 'always'`，作用域是**这一个能力**——不动 approvalPolicy。
 */
export function canStopAskingFor(effectClass: CapabilityEffectClass | undefined): boolean {
  return effectClass === 'reversible_local'
}

export function projectV4Intervention(
  source: V4InterventionSource,
  labels: V4InterventionLabels,
  t: Translate,
): InterventionData | undefined {
  const record = asRecord(source.args)
  const isPlan = Boolean(source.planLines?.length) || residentPlanShots(source.args).length > 0
  const kind = interventionKindOf(source.args, source.effectClass, isPlan)
  if (!kind) return undefined
  const more = source.pendingCount > 1 ? t('agentPanelV4.interventionMore', { count: source.pendingCount - 1 }) : ''
  const summaryParts = [
    kind === 'question' ? stringField(record, 'question') : readableToolPreview(t, source.toolName, source.args),
    // 「1 条内容」不足以让人决定要不要——用户在这一刻要判断的是**那句话该不该进文稿**。
    // 摘一段真正要写的内容出来。摘录不是全文：槽在 composer 上方那一格里，
    // 长文会把它撑成一堵墙；要看全文去对象自己的家（§1.5.2 一功能一个家）。
    contentExcerpt(record),
    kind === 'credential' ? t('agentPanelV4.credentialSummary') : '',
    stringField(record, 'reason'),
    more,
  ].filter((part): part is string => Boolean(part))
  const params = residentProposalParameters(source.args)
  const plan: readonly PlanRow[] = planRowsOf(source)
  const options = residentQuestionOptions(source.args).map((option) => option.label)
  const base = {
    kind,
    title: titleOf(kind, source, labels, t),
    ...(badgeOf(kind, labels) ? { badge: badgeOf(kind, labels) } : {}),
    ...(summaryParts.length ? { summary: summaryParts.join(' · ') } : {}),
    ...(params.length ? { params } : {}),
    ...(options.length ? { options } : {}),
    ...(plan.length ? { plan } : {}),
    // 拒绝原因的占位一直给：`V4Intervention` 只在用户按下「不要」之后才把它摊开。
    reasonPlaceholder: t('agentPanelV4.rejectReasonPlaceholder'),
    // 范围那一行是**诚实交代**，不是装饰：可撤销的档才有「不再问」，
    // 所以这里写清楚它到底覆盖什么，别让用户以为按一下就全项目放行。
    scope: canStopAskingFor(source.effectClass) ? labels.scopeCapability : labels.scopeOnce,
  }
  if (kind === 'credential') {
    return Object.freeze({ ...base, confirmLabel: labels.credentialConfirm, alternateLabel: labels.credentialAlternate })
  }
  return Object.freeze(base)
}

function planRowsOf(source: V4InterventionSource): readonly PlanRow[] {
  const checked = source.checkedPlanRows
  if (source.planLines?.length) {
    return source.planLines.map((line) => ({
      label: line.text,
      ...(line.technical ? { detail: line.technical } : {}),
      checked: checked ? checked.has(line.text) : true,
    }))
  }
  return residentPlanShots(source.args).map((shot) => ({
    label: shot.title,
    ...(shot.description ? { detail: shot.description } : {}),
    checked: checked ? checked.has(shot.title) : true,
  }))
}

function titleOf(kind: V4InterventionKind, source: V4InterventionSource, labels: V4InterventionLabels, translate: Translate): string {
  if (kind === 'credential') return labels.credentialTitle
  if (kind === 'question') return labels.questionTitle
  if (kind === 'plan') return labels.planTitle
  return readableToolName(translate, source.toolName, source.args)
}

function badgeOf(kind: V4InterventionKind, labels: V4InterventionLabels): string | undefined {
  if (kind === 'approval-irreversible') return labels.irreversible
  if (kind === 'approval-reversible') return labels.reversible
  if (kind === 'spend') return labels.spendBadge
  return undefined
}
