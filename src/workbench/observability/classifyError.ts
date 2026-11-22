// 错误 message → 界面人话 reason+hint+raw 的投影（harness S4-2）。
// 「这次失败算哪一类、给什么公开码、说什么、能做什么」只在 electron/shared/generationFailure 判一次；
// 这里只做一件事：把那份决定里的词条键翻成界面当前语言。生成域（节点/批跑）与对话域（两个 agent）都从这里取，
// 出口不得在这之外读 message 再自己匹配类别 / 覆盖动作（concept-owners：diagnostics.generation-failure-decision）。
import { narrateFailureText, type GenerationErrorAction, type GenerationErrorKind } from './narrate'
import { decideGenerationFailure, isOpenGenerationRefusal, type FailureLocale, type GenerationFailureDecision } from '../../../electron/shared/generationFailure'
import i18n from '../../i18n'

export { isOpenGenerationRefusal }

export type GenerationErrorReport = {
  /** 分类结果本身（错误卡按它取动作/埋点，别再从 reason 文案反猜）。 */
  kind: GenerationErrorKind
  /**
   * 这一类错误的**下一步动作**（2026-07-30）：确定性失败给「换个模型 / 去模型接入」，
   * 偶发失败才给「重试」——以前一律「重试」，等于让用户对着确定失败的模型死磕。
   */
  primary: GenerationErrorAction
  /** `null` = 这一类没有第二个有用的动作（如已下线：重试必然再撞同一张卡），错误卡不摆次按钮。 */
  secondary: GenerationErrorAction | null
  /** Short human reason, e.g. 配额或限流. */
  reason: string
  /** Actionable suggestion sentence (empty for unknown errors). */
  hint: string
  /**
   * 服务商的**真实原话**（如「官方算力限制，请等待一段时间后再进行使用」）。分类标题
   * 只说"哪一类"，这条说"服务商到底咋讲的"——以前它被埋进折叠的「技术详情」，用户一脸懵逼。
   * 只在它与 reason 不同、且有信息量时给（unknown 类的 reason 本身就是原话，不重复）。
   */
  providerMessage?: string
  /**
   * 仅 model-kind-mismatch：一键改对所需的三个事实。让 UI **直接读**，不从文案里反解——
   * 文案是给人看的、还要翻译，用正则从它里面抠 modelKey 是必然会烂的耦合。
   */
  modelKindFix?: { modelKey: string; registered: string; requested: string }
  /**
   * 这次失败是不是**服务商那一侧**的事（分类的类别本身说了算，`unknown` 看有没有供应商说的话）。
   * 任何点名供应商说「它失败了」的界面（切家提示）只在它为 true 时才有资格：我们自己这一侧的失败
   * （读不出产物、本地校验、出站策略……）点名供应商就是栽赃，劝换一家也不是解法。
   */
  vendorSide: boolean
  /** Original raw error message (any "→ hint" tail from older builds stripped). */
  raw: string
}

/** 界面当前语言（决定「供应商原话够不够格当标题」的语言规矩）。 */
export function uiFailureLocale(): FailureLocale {
  return String(i18n.language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

/** 决定 → 界面语言的报告。词条键在这里翻译；与翻译后标题相同的上游原话不重复给。 */
export function projectGenerationFailure(decision: GenerationFailureDecision): GenerationErrorReport {
  const reason = narrateFailureText(decision.reason)
  const hint = narrateFailureText(decision.hint)
  return {
    kind: decision.kind,
    primary: decision.primary,
    secondary: decision.secondary,
    reason,
    hint,
    ...(decision.providerMessage && decision.providerMessage !== reason ? { providerMessage: decision.providerMessage } : {}),
    ...(decision.modelKindFix ? { modelKindFix: decision.modelKindFix } : {}),
    vendorSide: decision.vendorSide,
    raw: decision.raw || i18n.t('generationCommon.observability.error.unknown.reason'),
  }
}

/** 画布 / 分镜 / 任务中心 / 内置助手共用的入口：原文 → 界面语言的报告。`transient` 是 pi 判过的瞬时事实（只有内置助手有）。 */
export function classifyGenerationError(message: string, facts: { transient?: boolean } = {}): GenerationErrorReport {
  return projectGenerationFailure(decideGenerationFailure({ message, locale: uiFailureLocale(), ...(facts.transient ? { transient: true } : {}) }))
}
