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
import type { LaneToolPublicFailure } from '../../../../electron/shared/agentLane/laneToolFailureEnvelope'
import { LANE_TOOL_OWN_FAILURE_CODE_LIST } from '../../../../electron/shared/agentLane/laneToolFailureEnvelope'
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
} as const

/** 行尾摘要：一句话，不带结构化细节（展开体才摆细节）。 */
export function laneToolFailureSummary(t: Translate, failure: LaneToolPublicFailure): string {
  const key = AGENT_TOOL_FAILURE_TEXT_KEY[failure.code as keyof typeof AGENT_TOOL_FAILURE_TEXT_KEY]
  // 码不在闭合集合里（域里还有大量更专门的码）时**仍然说本地话**，只是把码带出来给排查用。
  // 绝不退回模型正文——那正是这条门要堵的东西。
  return key ? t(key) : t('agentToolFailure.unknown', { code: failure.code })
}

/**
 * 展开体：摘要 + 信封里的结构化字段。
 *
 * 细节按**字段**摆，不拼散文：`issues` 只有字段名与类型名（信封刻意不带收到的值——
 * 用户文稿正文、素材路径都可能在参数里）。
 */
export function laneToolFailureDetail(t: Translate, failure: LaneToolPublicFailure): string {
  const lines = [laneToolFailureSummary(t, failure)]
  for (const issue of failure.issues ?? []) {
    lines.push(t('agentToolFailure.fieldExpected', {
      field: issue.path, expected: issue.expected, received: issue.receivedType,
    }))
    if (lines.length > 7) break
  }
  if (failure.allowed && failure.allowed.length > 0) {
    lines.push(t('agentToolFailure.allowedValues', { values: failure.allowed.join('、') }))
  }
  if (failure.useInstead) lines.push(t('agentToolFailure.useInstead', { verb: failure.useInstead }))
  return lines.join('\n')
}
