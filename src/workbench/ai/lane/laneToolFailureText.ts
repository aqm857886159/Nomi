// Agent 工具失败 → 面板上那段字的**唯一**边界（C5，2026-09-18）。
//
// 在这之前，失败正文是 `renderLaneToolFailure` 拼给**模型**读的英文散文，而
// `laneViewModel` 只摘掉成功信封的尾行，剩下的原样进 `.tsx`。中文界面上的结果是
// `The current target could not accept this action (surface_port_stale). Next: …`
// （审计 §5 / B03 截图）。老的翻译门 `humanizeToolFailure` 试图**正则那段英文**把它救回来，
// 但正则只认得出 schema 校验那一种写法，其余一律 `?? text` 落回英文——
// 「按散文猜结构」这条路本来就走不通，猜得再准也只是少错几次。
//
// 现在结构化信封一路带到这里（`details.failure` → 投影 → 视图模型），本文件按 `code` 取词条、
// 按字段摆结构化细节。**它不接受、也不回退到模型正文**：那段字是给模型的，
// 印给用户就是名实不一（英文、第三人称、还带着 `Next:` 这种只对模型成立的指令）。
import type { LaneToolPublicFailure, LaneToolPublicIssue } from '../../../../electron/shared/agentLane/laneToolFailureEnvelope'
import { LANE_TOOL_OWN_FAILURE_CODE_LIST } from '../../../../electron/shared/agentLane/laneToolFailureEnvelope'
import type { GenerationProblem } from '../../../../electron/shared/generationProblem'
import {
  CAPABILITY_TRANSPORT_VERIFICATION_ERROR_CODE_LIST,
  SURFACE_PORT_WIRE_ERROR_CODE_LIST,
} from '../../../../electron/shared/surfacePortBinding'

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * 有本地文案的那些码。两处真相源 spread 进来，**这里不重列**（C4：码集合只有一个值源）。
 * `check:error-surface` 规则④ 逐条比对它与 `agentToolFailure` 词典的两种语言。
 */
export const AGENT_TOOL_FAILURE_CODES: ReadonlySet<string> = new Set<string>([
  ...SURFACE_PORT_WIRE_ERROR_CODE_LIST,
  ...CAPABILITY_TRANSPORT_VERIFICATION_ERROR_CODE_LIST,
  ...LANE_TOOL_OWN_FAILURE_CODE_LIST,
])

/**
 * 码 → 整键。理由与 `LANE_ERROR_TEXT_KEY` 逐字相同：整键字面量才是死键门岗认得的精确引用，
 * 在用处拼 `agentToolFailure.${code}` 会盖掉整个命名空间的死键检测。
 */
export const AGENT_TOOL_FAILURE_TEXT_KEY = {
  surface_port_stale: 'agentToolFailure.surface_port_stale',
  surface_port_suspended: 'agentToolFailure.surface_port_suspended',
  surface_port_unavailable: 'agentToolFailure.surface_port_unavailable',
  surface_owner_mismatch: 'agentToolFailure.surface_owner_mismatch',
  project_binding_stale: 'agentToolFailure.project_binding_stale',
  project_identity_unavailable: 'agentToolFailure.project_identity_unavailable',
  capability_execution_failed: 'agentToolFailure.capability_execution_failed',
  capability_cancelled: 'agentToolFailure.capability_cancelled',
  capability_input_invalid: 'agentToolFailure.capability_input_invalid',
  capability_target_stale: 'agentToolFailure.capability_target_stale',
  capability_unsupported: 'agentToolFailure.capability_unsupported',
  document_position_unavailable: 'agentToolFailure.document_position_unavailable',
  capability_receipt_unresolved: 'agentToolFailure.capability_receipt_unresolved',
  capability_invocation_unverified: 'agentToolFailure.capability_invocation_unverified',
  capability_authority_invalid: 'agentToolFailure.capability_authority_invalid',
  capability_policy_stale: 'agentToolFailure.capability_policy_stale',
  capability_output_invalid: 'agentToolFailure.capability_output_invalid',
  capability_timeout: 'agentToolFailure.capability_timeout',
  undo_conflict: 'agentToolFailure.undo_conflict',
  tool_arguments_invalid: 'agentToolFailure.tool_arguments_invalid',
  tool_execution_failed: 'agentToolFailure.tool_execution_failed',
  tool_timed_out: 'agentToolFailure.tool_timed_out',
  wrong_verb: 'agentToolFailure.wrong_verb',
  generation_surface_unavailable: 'agentToolFailure.generation_surface_unavailable',
  task_reference_required: 'agentToolFailure.task_reference_required',
  generation_operation_not_found: 'agentToolFailure.generation_operation_not_found',
  production_run_not_found: 'agentToolFailure.production_run_not_found',
  generation_execution_failed: 'agentToolFailure.generation_execution_failed',
  generation_not_started: 'agentToolFailure.generation_not_started',
  generation_provider_unavailable: 'agentToolFailure.generation_provider_unavailable',
  generation_input_invalid: 'agentToolFailure.generation_input_invalid',
  tool_retry_stopped: 'agentToolFailure.tool_retry_stopped',
} as const

/** 期望类型名 → 本地话。认不出的类型名原样给（它本来就是个短标识符）。 */
const TYPE_TEXT_KEY: Readonly<Record<string, string>> = {
  object: 'agentToolFailure.typeObject',
  array: 'agentToolFailure.typeArray',
  string: 'agentToolFailure.typeString',
  number: 'agentToolFailure.typeNumber',
  integer: 'agentToolFailure.typeInteger',
  boolean: 'agentToolFailure.typeBoolean',
}

/** 列合法值最多几个：再多就不是「该填什么」，是一份目录。 */
const ALLOWED_SHOWN = 6

function valuesText(t: Translate, values: readonly string[]): string {
  const separator = t('agentToolFailure.listSeparator')
  return values.length > ALLOWED_SHOWN ? `${values.slice(0, ALLOWED_SHOWN).join(separator)}…` : values.join(separator)
}

/**
 * 一条入参问题 → 「哪个字段 · 该填什么」。按 `kind` 出本地话；2026-11-07 之前的信封没有 `kind`，
 * 只有 `expected / receivedType`，按「应是什么类型」那一句说。
 */
export function laneToolIssueText(t: Translate, issue: LaneToolPublicIssue): string {
  const field = issue.path === '(root)' || issue.path === 'root' || !issue.path ? t('agentToolFailure.issueRoot') : issue.path
  const typeText = (name: string): string => {
    const key = TYPE_TEXT_KEY[name]
    return key ? t(key) : name
  }
  switch (issue.kind) {
    case 'unknown_field':
      return issue.nearest
        ? t('agentToolFailure.issueUnknownFieldNearest', { field, nearest: issue.nearest })
        : t('agentToolFailure.issueUnknownField', { field })
    case 'not_allowed':
      return issue.allowed && issue.allowed.length > 0
        ? t('agentToolFailure.issueNotAllowed', { field, values: valuesText(t, issue.allowed) })
        : t('agentToolFailure.issueInvalid', { field })
    case 'missing':
      return t('agentToolFailure.issueMissing', { field })
    case 'out_of_range':
      if (issue.min !== undefined && issue.max !== undefined) return t('agentToolFailure.issueRange', { field, min: issue.min, max: issue.max })
      if (issue.min !== undefined) return t('agentToolFailure.issueAtLeast', { field, min: issue.min })
      if (issue.max !== undefined) return t('agentToolFailure.issueAtMost', { field, max: issue.max })
      return t('agentToolFailure.issueInvalid', { field })
    case 'too_few':
      return issue.min !== undefined ? t('agentToolFailure.issueTooFew', { field, min: issue.min }) : t('agentToolFailure.issueInvalid', { field })
    case 'too_many':
      return issue.max !== undefined ? t('agentToolFailure.issueTooMany', { field, max: issue.max }) : t('agentToolFailure.issueInvalid', { field })
    case 'wrong_type':
    case undefined:
      return issue.expected
        ? t('agentToolFailure.issueWrongType', { field, expected: issue.expected.split(' or ').map(typeText).join(' / ') })
        : t('agentToolFailure.issueInvalid', { field })
    default:
      return t('agentToolFailure.issueInvalid', { field })
  }
}

/** 原因句里列值最多几个，再多就「等」（用户 11-07「字有点多」）。 */
const PROBLEM_VALUES_SHOWN = 4

function shortValuesText(t: Translate, values: readonly string[]): string {
  const shown = values.slice(0, PROBLEM_VALUES_SHOWN).join(t('agentToolFailure.listSeparator'))
  return values.length > PROBLEM_VALUES_SHOWN ? t('agentToolFailure.listMore', { values: shown }) : shown
}

/**
 * 起草被拒的闭合原因（`generationProblem.ts`）→ 一句话。码在抛出那一刻定好，这里只查词条，不猜散文。
 *
 * `parameter_not_allowed` 返回 `undefined`：它没有比「哪个字段 · 该填什么」更准的话，照旧走下面的字段那条。
 * 0.24 及以前的信封没有 `problem`，根本进不来这里——老转录一个字都不变。
 * `switch` 穷尽码表：码表加一个码而这里没有那一句，类型检查就红。
 */
function problemSentence(t: Translate, problem: GenerationProblem): string | undefined {
  switch (problem.code) {
    case 'unknown_model':
      // 这是 Agent 自己点错了名，它会自己换（最接近的那个只写进它读的正文）；用户不需要看一串模型 id。
      return t('agentToolFailure.problemUnknownModel')
    case 'no_default_model':
      return problem.media === 'video' ? t('agentToolFailure.problemNoDefaultVideo') : t('agentToolFailure.problemNoDefaultImage')
    case 'mode_not_in_model':
      return t('agentToolFailure.problemModeNotInModel')
    case 'ratio_not_in_mode':
      return problem.allowed?.length ? t('agentToolFailure.problemRatioNotOffered') : t('agentToolFailure.problemRatioNone')
    case 'duration_not_in_mode':
      if (problem.min !== undefined && problem.max !== undefined) return t('agentToolFailure.problemDurationRange', { min: problem.min, max: problem.max })
      if (problem.allowed?.length) return t('agentToolFailure.problemDurationValues', { values: shortValuesText(t, problem.allowed) })
      if (problem.min !== undefined) return t('agentToolFailure.problemDurationAtLeast', { min: problem.min })
      if (problem.max !== undefined) return t('agentToolFailure.problemDurationAtMost', { max: problem.max })
      return t('agentToolFailure.problemDurationNone')
    case 'reference_over_capacity':
      return problem.max !== undefined ? t('agentToolFailure.problemReferenceOverCapacity', { max: problem.max }) : undefined
    case 'reference_role_not_in_mode':
      return t('agentToolFailure.problemReferenceRole')
    case 'parameter_not_allowed':
      return undefined
  }
}

/** 展开体里原因句下面那一行：可选值，或该去哪儿改（只有用户自己能改的那一种才指路）。 */
function problemDetailLines(t: Translate, problem: GenerationProblem): string[] {
  if (problem.code === 'no_default_model') {
    const slot = problem.media === 'video' ? t('agentPanelV4.videoDefault') : t('agentPanelV4.imageDefault')
    return [t('agentToolFailure.problemPickDefault', { slot })]
  }
  if ((problem.code === 'ratio_not_in_mode' || problem.code === 'reference_role_not_in_mode') && problem.allowed?.length) {
    return [t('agentToolFailure.allowedValues', { values: shortValuesText(t, problem.allowed) })]
  }
  return []
}

/** 行尾摘要：一句话，不带结构化细节（展开体才摆细节）。 */
export function laneToolFailureSummary(t: Translate, failure: LaneToolPublicFailure): string {
  // 起草被拒、且抛出时就定了原因：说原因（「没有这个模型」「时长要在 4–15 秒之间」），不说「不接受这组参数」。
  const reason = failure.problem ? problemSentence(t, failure.problem) : undefined
  if (reason) return reason
  // 入参没填对、且信封里有出错字段：行尾直接说第一处「哪个字段 · 该填什么」，不说「参数不合法」。
  const first = failure.issues?.[0]
  if (first && (failure.code === 'tool_arguments_invalid' || failure.code === 'generation_input_invalid')) {
    return t('agentToolFailure.argumentsWithField', { issue: laneToolIssueText(t, first) })
  }
  const key = AGENT_TOOL_FAILURE_TEXT_KEY[failure.code as keyof typeof AGENT_TOOL_FAILURE_TEXT_KEY]
  // 码不在闭合集合里（域里还有大量更专门的码）时**仍然说本地话**，但**不带码**：码是给排查看的
  // （转录、日志、遥测里都有），创作者读到 `(capability_xxx)` 只会多一个看不懂的词。
  // 绝不退回模型正文——那正是这条门要堵的东西。
  return key ? t(key) : t('agentToolFailure.unknown')
}

/**
 * 展开体：摘要 + 信封里的结构化字段。
 *
 * 细节按**字段**摆，不拼散文：`issues` 只有字段名与类型名（信封刻意不带收到的值——
 * 用户文稿正文、素材路径都可能在参数里）。
 */
export function laneToolFailureDetail(t: Translate, failure: LaneToolPublicFailure): string {
  // 有闭合原因时，原因句 + 它自己的那一行就是全部：字段行说的是同一件事，再印一遍只会更长。
  const reason = failure.problem ? problemSentence(t, failure.problem) : undefined
  if (reason && failure.problem) return [reason, ...problemDetailLines(t, failure.problem)].join('\n')
  const key = AGENT_TOOL_FAILURE_TEXT_KEY[failure.code as keyof typeof AGENT_TOOL_FAILURE_TEXT_KEY]
  const lines = [key ? t(key) : t('agentToolFailure.unknown')]
  for (const issue of (failure.issues ?? []).slice(0, 6)) lines.push(laneToolIssueText(t, issue))
  // 某条字段已经逐个列过同一份合法值，就不再印第二遍。
  const listed = (failure.issues ?? []).some((issue) => issue.allowed && failure.allowed
    && issue.allowed.length === failure.allowed.length && issue.allowed.every((value, index) => value === failure.allowed![index]))
  if (failure.allowed && failure.allowed.length > 0 && !listed) {
    lines.push(t('agentToolFailure.allowedValues', { values: valuesText(t, failure.allowed) }))
  }
  if (failure.useInstead) lines.push(t('agentToolFailure.useInstead', { verb: failure.useInstead }))
  return lines.join('\n')
}
