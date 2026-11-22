// 穿 IPC 的结构化载荷、异步任务失败格式、外部助手的公开码确证：判定家族里「从原文里读事实」的那几处。
// 判定入口在 generationFailure.ts 的 decideGenerationFailure；这里只做解析与确证，不判类别。
import { VENDOR_ERROR_IPC_MARKER } from './vendorFailure'
import { CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES } from './surfacePortBinding'
import { INTEGRATION_ERROR_CODES } from './integrationContract'
import { GENERATION_INPUT_INVALID_CODE } from './agentCapabilities/admissionRejectionHints'
import { TASK_FAILED_FALLBACK, TOOL_ERROR_CODES, toolErrorHint, type FailureLocale } from './generationFailureCopy'

// ---------------------------------------------------------------------------
// 穿 IPC 的结构化载荷 / 异步任务失败格式：唯一的产出、唯一的解析（原 vendorErrorIpc / taskFailureMessage）。
// ---------------------------------------------------------------------------

export type VendorErrorStructuredLite = {
  code?: string
  reason?: string
  vendorKey?: string
  httpStatus?: number
  logicalCode?: number | string
  upstreamMsg?: string
  /** 上游自己给的错误码（`model_not_found` 这一类）；只有响应体里真有才会带。 */
  upstreamCode?: string
  category?: string
  retryable?: boolean
}

/** 从错误 message 中解出 structured;没有标记/解析失败 → null(走 legacy 正则兜底)。 */
export function parseVendorErrorFromMessage(message: string): VendorErrorStructuredLite | null {
  const text = String(message || '')
  const start = text.indexOf(VENDOR_ERROR_IPC_MARKER)
  if (start < 0) return null
  const rest = text.slice(start + VENDOR_ERROR_IPC_MARKER.length)
  const end = rest.indexOf('::')
  if (end < 0) return null
  try {
    // base64 → UTF-8(upstreamMsg 可能是中文,atob 直接产 Latin-1 二进制串,需 TextDecoder)
    const binary = atob(rest.slice(0, end))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as VendorErrorStructuredLite
  } catch {
    return null
  }
}

/** 展示用:把 message 里的标记段剥掉,只留人读得懂的部分。 */
export function stripVendorErrorMarker(message: string): string {
  const text = String(message || '')
  const start = text.indexOf(VENDOR_ERROR_IPC_MARKER)
  if (start < 0) return text
  const rest = text.slice(start + VENDOR_ERROR_IPC_MARKER.length)
  const end = rest.indexOf(':: ')
  if (end < 0) return text.slice(0, start).trim() || text
  return (text.slice(0, start) + rest.slice(end + 3)).trim()
}

export type TaskFailureIds = { taskId?: string; kind?: string }

/** 产出：`<原话或我们的兜底句> (taskId=…, kind=…)`；没有任何 id 就不带后缀。 */
export function formatTaskFailureMessage(upstream: string, ids: TaskFailureIds, locale: FailureLocale): string {
  const prefix = upstream.trim() || TASK_FAILED_FALLBACK[locale]
  const suffix = [ids.taskId ? `taskId=${ids.taskId}` : '', ids.kind ? `kind=${ids.kind}` : ''].filter(Boolean).join(', ')
  return suffix ? `${prefix} (${suffix})` : prefix
}

const TASK_FAILURE_SUFFIX = /^([\s\S]+?) \(((?:taskId=[^,()]*)?(?:, )?(?:kind=[^,()]*)?)\)$/

/**
 * 解析：是这个形状 → 返回**供应商说的那句话**（没说就是 ''，兜底句不算它说的）；不是 → null。
 * 后缀里必须真有 `taskId=` 或 `kind=`，一句碰巧以括号收尾的人话不会被误认。
 */
export function parseTaskFailureMessage(message: string): { upstream: string } | null {
  const match = TASK_FAILURE_SUFFIX.exec(String(message || '').trim())
  if (!match || !/^(?:taskId=|kind=)/.test(match[2])) return null
  const prefix = match[1].trim()
  // 兜底句是我们自己的话（两种语言都认），不算供应商说的。
  return { upstream: Object.values(TASK_FAILED_FALLBACK).includes(prefix) ? '' : prefix }
}

// ---------------------------------------------------------------------------
// 公开错误码（外部助手 MCP 的 errorCode）：只认**确证**的码。
// ---------------------------------------------------------------------------

/** 资源找不到那一档：码本身就是全部公开信息，不带任何私有路径/供应商原文。 */
const NOT_FOUND_CODES = [
  'node_not_found', 'unknown_node_kind', 'invalid_edge_mode', 'document_not_found', 'project_not_found',
] as const

/** 项目会话那一档：得重选项目 / 重开会话。 */
const PROJECT_SESSION_CODES = [
  'project_session_unavailable', 'project_selection_denied',
  'lease_required', 'lease_invalid', 'lease_expired', 'lease_revoked', 'project_scope_changed',
] as const

/**
 * 这些带类型的失败可能包着私有的磁盘 / 供应商原因；码本身就是它们全部的公开信息。
 * 传输层码表只从 owner spread，本文件只列自己这一层独有的分档。
 */
const SAFE_CANVAS_READ_CODES: ReadonlySet<string> = new Set<string>([
  ...CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES,
  ...NOT_FOUND_CODES,
])

/** 准入层拒绝码（`ParameterRejectionCode` + 画布模型身份）。 */
const ADMISSION_CODES = [
  'unknown_parameter', 'parameter_type_mismatch', 'parameter_not_in_enum',
  'parameter_out_of_range', 'missing_required_parameter', 'unknown_variant', 'mode_input_missing',
  'contract_invalid', 'unknown_model_identity', 'ambiguous_model_vendor', GENERATION_INPUT_INVALID_CODE,
] as const

const POLICY_CODES: ReadonlySet<string> = new Set<string>([
  ...ADMISSION_CODES,
  ...SAFE_CANVAS_READ_CODES,
  ...PROJECT_SESSION_CODES,
  ...INTEGRATION_ERROR_CODES,
  'mcp_connection_unauthenticated',
  // `feature_disabled` / `phase_not_ready` 随 env flag 与三段式 rollout 删除，不再是策略码。
  'legacy_path_forbidden', 'not_ready',
  'human_approval_required', 'receipt_invalid', 'receipt_expired',
])

const CODE_IN_TEXT = /(?<![A-Za-z0-9_])[A-Za-z0-9_]+(?![A-Za-z0-9_])/g

export type PublicError = {
  /** 确证过的码；没有 = null。 */
  code: string | null
  /** 码来自失败对象自带的 code 字段，且是登记过的策略码（带 nextAction / capability 透传）。 */
  policy: boolean
  /** 这个码本身就是全部公开信息（message 只留码）。 */
  codeOnly: boolean
}

/** 外部助手认得的全部公开码（字段里能被确证的码 ∪ 有词条的码）。快照测试钉住：增删公开码是显式决定，不是搬家的副产品。 */
export const PUBLIC_ERROR_CODES: readonly string[] = [...new Set<string>([...POLICY_CODES, ...TOOL_ERROR_CODES])].sort()

const isHintedCode = (code: string): boolean => Boolean(toolErrorHint(code))

/**
 * 确证码：① 失败对象自带的 code 字段，在登记表（策略码 ∪ 有词条的码）里；② 否则原文里的**整词**码，取**最先出现**的那一个
 * （包装错误外层通常在前，最先出现的就是最贴近调用方能做的那一步；不按表序，也不当子串）。
 * `not_node_not_found_extra` 不是 `node_not_found`；`unknown_model_identity node_not_found` 认 `unknown_model_identity`。
 */
export function confirmPublicError(code: string | undefined, message: string): PublicError {
  const field = typeof code === 'string' && (POLICY_CODES.has(code) || isHintedCode(code)) ? code : null
  const inText = field ? null : (String(message).match(CODE_IN_TEXT) ?? []).find(isHintedCode) ?? null
  const confirmed = field ?? inText
  return {
    code: confirmed,
    policy: Boolean(field && POLICY_CODES.has(field)),
    codeOnly: Boolean(field && SAFE_CANVAS_READ_CODES.has(field)),
  }
}
