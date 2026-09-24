import { modelToolShowsReviewCard } from '../../../../electron/shared/agentCapabilities/modelFacingToolRegistry'
import { capabilitySupportsUndo } from '../../../../electron/shared/agentCapabilities/registry'
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
// ④ `missing_param` 进这个槽，渲成**反问卡**（2026-09-12 改）。原来写的是「它不进这个槽，
//    走 `missingParamSuggestion()` 变成对话流里的一条提问」——但那条对话流分支从来没有接过线
//    （`missingParamSuggestion` 全仓零调用方）。真实后果是宿主 announce 了「有一条在等你」、
//    槽里却什么都没有。缺参数本来就是一句问题 + 几个现成答案，那正是反问格的形状；
//    它没有「不要」这个出口也成立——反问格本来就只有选项 chip，没有确认/不要（见下 `hasActions`）。
import type { CapabilityEffectClass } from '../../../../electron/shared/agentCapabilities/capabilityContract'
import { residentPlanShots, residentProposalParameters } from '../resident/residentExceptionProjections'
import { readableToolName, readableToolPreview } from '../resident/residentToolDisplay'
import { parseQuestionSheet, type V4QuestionAsk, type V4QuestionOption, type V4QuestionSheet } from './agentPanelV4Question'
import type { InterventionData, PlanRow, V4InterventionKind } from './agentPanelV4Types'

type Translate = (key: string, options?: Record<string, unknown>) => string

export type V4InterventionLabels = Readonly<{
  irreversible: string
  reversible: string
  spendBadge: string
  credentialTitle: string
  credentialConfirm: string
  credentialAlternate: string
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
  /**
   * 计划槽里被**取消勾选**的行（按 label）。默认（空集）= 全勾。
   *
   * 记「取消的」而不是「勾上的」，是因为清单的行在同一次待决里可能还没投影出来
   * （`planLines` 是异步查时间轴得到的）：记勾上的那一份要先有全表才填得满，
   * 空集在那一瞬会被读成「一条都没勾」。取消集没有这个先后问题。
   */
  uncheckedPlanRows?: ReadonlySet<string>
}>

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringField(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

/**
 * 这次提问在卡上印的那句问题。
 *
 * 模型写了 `question` 就用它的原话；只说了「缺 duration」时把参数名包进一句人话里
 * ——但**不编具体建议值**，那得工具自己给。两条路都不在这里造第二份问句。
 */
export function questionText(ask: V4QuestionAsk & { missingParamName?: string }, t: Translate): string {
  if (ask.question) return ask.question
  return ask.missingParamName ? t('agentPanelV4.missingParamAsk', { name: ask.missingParamName }) : ''
}

/**
 * 卡上问句下面那一行**我们自己**要说的话（熔断）。
 *
 * 文案按码出，不接受生产者传成句的字符串——那样它就绕过了 i18n，英文用户会看到中文
 * （或者反过来）。生产者只说「这是第几次没过」，怎么讲是渲染层的事。
 */
export function askReasonText(sheet: V4QuestionSheet, t: Translate): string | undefined {
  // 熔断那一句挂在**整张卡**上，不是某一题上：它解释的是「为什么这一刻在问」。
  if (!sheet.reason) return undefined
  return t('agentPanelV4.questionRetryExhausted', { count: sheet.reason.attempts })
}

/**
 * 这次操作**要写进去的那段话**，保留 Markdown 源码。
 * 字段名按常见顺序找：文稿写 `content`、时间轴/画布的提案写 `text` 或 `prompt`。
 * 一个都没有就返回 `undefined`——不编，也不用「（无内容）」占位。
 */
const EXCERPT_FIELDS = ['content', 'text', 'prompt'] as const

function proposalContent(record: Readonly<Record<string, unknown>>): string | undefined {
  for (const field of EXCERPT_FIELDS) {
    const value = record[field]
    if (typeof value !== 'string') continue
    if (value.trim()) return value
  }
  return undefined
}

/**
 * 这次待决属于哪一个 kind。**返回值不可空**（2026-09-12）。
 *
 * 它以前对「缺参数」回 `undefined`，注释说那一族「走 `missingParamSuggestion()` 变成对话流里
 * 的一条提问」——可 `missingParamSuggestion` 从来没有被任何组件调用过（全仓 grep 只命中它自己）。
 * 于是真实后果是：宿主明明在 announce「有一条在等你」（dock 上就写着「等你确认 1 条」），
 * 而槽里画的是 `undefined`——**一片空白**。用户那头就是「模型说要我确认，我却找不到在哪确认」。
 *
 * 现在缺参数就是一张**反问卡**（它本来就是一句问题 + 几个现成答案），那条死掉的分支连同
 * 它的空返回一起删掉。签名改成不可空之后，「announce 了却什么都没画」在这条链上
 * **编译期就不可能**（R28：能让编译器拦的别留给门岗）。
 */
export function interventionKindOf(args: unknown, effectClass: CapabilityEffectClass | undefined, isPlan: boolean): V4InterventionKind {
  const record = asRecord(args)
  if (stringField(record, 'missingCredential')) return 'credential'
  // 缺参数与提问是同一张卡的两个生产者（2026-09-12 并档），判据也只有一条：
  // `parseQuestionAsk` 认得出就是提问。这里不再各嗅一次 key。
  if (parseQuestionSheet(args)) return 'question'
  if (isPlan) return 'plan'
  if (effectClass === 'spend') return 'spend'
  // 认不出的能力 fail-closed 到**不可逆**：把一个未知操作当成可撤销的，等于替用户
  // 赌「反正能撤回来」。`capabilityEffectClassOf` 对未登记的契约返回 undefined，
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
): InterventionData {
  const record = asRecord(source.args)
  // 是不是计划卡由**这次调用的动词**决定：它的声明写着「用户先看审阅卡」。以前判据是
  // `planLines.length > 0`——清单行投影不出来（动词名一漂、或 operations 一时认不出）时，
  // 同一份计划就退回成通用「可撤销」卡，多出一颗「不再问 →」（2026-09-24 走查）。
  // 行投影不出来是**行**的事，卡的授权面不跟着它变。
  const isPlan = modelToolShowsReviewCard(source.toolName) || residentPlanShots(source.args).length > 0
  const kind = interventionKindOf(source.args, source.effectClass, isPlan)
  const more = source.pendingCount > 1 ? t('agentPanelV4.interventionMore', { count: source.pendingCount - 1 }) : ''
  // 一张卡 1–3 题、一次显示一题（2026-09-21 版式拍板）。卡体（Approval Card）自己翻页：
  // 多题时整张 `sheet` 摊进 `questions`；一题时 `askCardQuestions()` 从 title / options / summary
  // 摊成长度 1——两条路吃的是同一份解析，不各嗅一次 args。
  const sheet = kind === 'question' ? parseQuestionSheet(source.args) : undefined
  const ask = sheet?.questions[0]
  const reasonLine = sheet ? askReasonText(sheet, t) : undefined
  const questions = sheet && sheet.questions.length > 1
    ? Object.freeze(sheet.questions.map((question, index) => {
      // 熔断那一句解释的是「为什么这一刻在问」，属于整张卡——只在用户最先看到的那一题下面说一遍。
      const note = [index === 0 ? reasonLine : undefined, question.note].filter((part): part is string => Boolean(part)).join('\n\n')
      return Object.freeze({
        question: questionText(question, t),
        options: question.options,
        ...(question.multiSelect ? { multiSelect: true } : {}),
        ...(note ? { note } : {}),
      })
    }))
    : undefined
  const summaryParts = [
    // 反问那一档的问句已经是标题了（`titleOf`），这里不再印第二遍。
    ask ? undefined : readableToolPreview(t, source.toolName, source.args),
    // 熔断那一句（「试了 3 次都没通过，交给你定。」）紧跟问句：它解释的是**为什么这一刻在问**，
    // 离问句远一格就读成了一条无主的旁白。
    reasonLine,
    ask?.note,
    // 「1 条内容」不足以让人决定要不要——用户在这一刻要判断的是**那句话该不该进文稿**。
    // B2e：完整保留列表、表格和换行；滚动由现有槽外壳管理。
    proposalContent(record),
    kind === 'credential' ? t('agentPanelV4.credentialSummary') : '',
    stringField(record, 'reason'),
    more,
  ].filter((part): part is string => Boolean(part))
  const params = residentProposalParameters(source.args)
  const plan: readonly PlanRow[] = planRowsOf(source)
  // 选项**只属于反问**。别的档（审批 / 付费 / 计划）碰巧带了一个 `options` 字段也不渲染成
  // 可点的 chip——那个槽的出口是确认 / 不要，多一排能点的东西等于多一个说不清的答案。
  const options: readonly V4QuestionOption[] = ask?.options ?? []
  const badge = capabilitySupportsUndo(source.toolName, source.args) && (kind === 'approval-irreversible' || kind === 'approval-reversible') ? labels.reversible : badgeOf(kind, labels)
  const base = {
    kind,
    title: titleOf(kind, source, labels, t),
    ...(badge ? { badge } : {}),
    ...(summaryParts.length ? { summary: summaryParts.join('\n\n') } : {}),
    ...(params.length ? { params } : {}),
    ...(options.length ? { options } : {}),
    ...(questions ? { questions } : {}),
    ...(plan.length ? { plan } : {}),
    // 拒绝原因的占位一直给：`V4Intervention` 只在用户按下「不要」之后才把它摊开。
    reasonPlaceholder: t('agentPanelV4.rejectReasonPlaceholder'),
    // 范围那一行是**诚实交代**，不是装饰：它解释的是「不再问 →」那颗钮到底覆盖什么。
    //
    // 原来写的是「除了计划卡都发」，于是**反问卡**也拿到了一句「『不再问』只对这一个操作
    // 生效」——而反问卡根本没有那颗钮（`hasActions` 对 question 恒 false，闸那边
    // `alwaysAsksUser` 也保证它永远不可能被放行）。用户第一次看到真卡时读到的就是它。
    //
    // 这里**只多排除 `question` 一档**，不顺手把 spend / irreversible 也排掉：
    // 那两档上这行印的是「范围：仅这一次」，说的是这次批准的范围，本身没说错，
    // 而且主进程 lane 的同一处裁决（report-C-ask-tool §10.2）也只排除了 question。
    // 两边动同一行，口径必须一样，否则合并时会变成一次谁都没打算做的行为改动。
    ...(kind === 'plan' || kind === 'question'
      ? {}
      : { scope: canStopAskingFor(source.effectClass) ? labels.scopeCapability : labels.scopeOnce }),
  }
  if (kind === 'credential') {
    return Object.freeze({ ...base, confirmLabel: labels.credentialConfirm, alternateLabel: labels.credentialAlternate })
  }
  return Object.freeze(base)
}

/**
 * 计划卡按下「确认」时到底发什么。
 *
 * lane 的审批协议只有准 / 不准（`laneClient.approve` / `deny`），没有「照这份清单改了再准」。
 * 但计划卡标题印着的承诺是「不勾就是不做」，所以：
 *   · 一条都没取消 → 就是批准；
 *   · 取消了几条、还留着几条 → 带话的 deny，那句话一字不改成为模型看到的 tool result，
 *     模型据此重开一张只含留下那几条的计划；
 *   · 一条都不留 → 不带话的 deny（整张不要）。
 * 纯函数是因为这条判断值得被断言：把它写在 onClick 里，只有真人点过才知道它对不对。
 */
export function planConfirmDecision(
  unchecked: ReadonlySet<string>,
  keptRows: readonly string[],
): Readonly<{ action: 'approve' } | { action: 'deny'; keptRows: readonly string[] }> {
  if (unchecked.size === 0) return Object.freeze({ action: 'approve' as const })
  return Object.freeze({ action: 'deny' as const, keptRows })
}

function planRowsOf(source: V4InterventionSource): readonly PlanRow[] {
  const unchecked = source.uncheckedPlanRows
  if (source.planLines?.length) {
    return source.planLines.map((line) => ({
      label: line.text,
      ...(line.technical ? { technical: line.technical } : {}),
      checked: !unchecked?.has(line.text),
    }))
  }
  return residentPlanShots(source.args).map((shot) => ({
    label: shot.title,
    ...(shot.description ? { detail: shot.description } : {}),
    checked: !unchecked?.has(shot.title),
  }))
}

function titleOf(kind: V4InterventionKind, source: V4InterventionSource, labels: V4InterventionLabels, translate: Translate): string {
  if (kind === 'credential') return labels.credentialTitle
  // 反问卡**没有卡头**（2026-09-21 用户退回自拼版）：问题本身就是标题，这是 Approval Card
  // 的形状，也是唯一诚实的形状——「需要你定一下」那句套话不含一丝信息，却把模型真正问的
  // 那句话挤进了正文，于是用户先读一句废话、再去别处找问题。那句词条已随本次改动删除。
  if (kind === 'question') {
    const ask = parseQuestionSheet(source.args)?.questions[0]
    return ask ? questionText(ask, translate) : ''
  }
  if (kind === 'plan') return labels.planTitle
  return readableToolName(translate, source.toolName, source.args)
}

function badgeOf(kind: V4InterventionKind, labels: V4InterventionLabels): string | undefined {
  if (kind === 'approval-irreversible') return labels.irreversible
  if (kind === 'approval-reversible') return labels.reversible
  if (kind === 'spend') return labels.spendBadge
  return undefined
}
