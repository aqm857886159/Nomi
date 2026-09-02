import type { ResultLocale } from './mcpToolResults'

type Ctx = { locale: ResultLocale }
const L = (ctx: Ctx, zh: string, en: string): string => (ctx.locale === 'en' ? en : zh)

/** A6 已知错误码 → 人话原因 + 恢复动作（只登记确证的码，不编造；未知码原样透传）。 */
const ERROR_HINT: Record<string, { zh: string; en: string; recover: Array<{ zh: string; en: string }> }> = {
  node_not_found: {
    zh: '目标画布节点已不存在或不在当前项目',
    en: 'The target canvas node is missing from the current project',
    recover: [{ zh: '先调用 canvas_read 刷新节点 id，再重试', en: 'Call canvas_read to refresh node ids, then retry' }],
  },
  unknown_node_kind: {
    zh: '画布快照含有 Nomi 当前不认识的节点类型，未写入',
    en: 'The canvas snapshot contains an unsupported node kind and was not written',
    recover: [{ zh: '修复或删除该节点后再保存', en: 'Repair or remove the node, then save again' }],
  },
  invalid_edge_mode: {
    zh: '连线模式无效，Nomi 没有静默改成普通引用',
    en: 'The edge mode is invalid; Nomi did not silently downgrade it',
    recover: [{ zh: '改用当前支持的 reference 模式重试', en: 'Retry with a supported reference mode' }],
  },
  document_not_found: {
    zh: '找不到目标剧本文档',
    en: 'The target creation document was not found',
    recover: [{ zh: '先重新读取项目文档列表后重试', en: 'Refresh the project documents, then retry' }],
  },
  asset_not_localized: {
    zh: '参考素材还没落到本地，生成端拿不到它',
    en: 'A referenced asset is not localized yet, so the generator cannot read it',
    recover: [
      { zh: '在 Nomi 里打开该节点让素材完成本地化后重试', en: 'Open the node in Nomi to finish localizing the asset, then retry' },
    ],
  },
  renderer_or_provider_unknown: {
    zh: '找不到能执行这次生成的渲染器或供应商配置',
    en: 'No renderer or provider configuration can execute this generation',
    recover: [
      { zh: '用 nomi_read（target=models）核对可用模型后换一个', en: 'Check available models with nomi_read (target=models) and switch' },
      { zh: '在 Nomi 设置里补齐该供应商的接入', en: 'Complete the provider setup in Nomi settings' },
    ],
  },
}

/** User projection deliberately has only four actions; protocol codes stay in structuredContent for machines. */
const USER_ACTION_HINT: Record<string, { action: string; zh: string; en: string }> = {
  human_approval_required: { action: 'in_nomi', zh: '请在 Nomi 确认这次生成。', en: 'Confirm this generation in Nomi.' },
  receipt_invalid: { action: 'in_nomi', zh: '这次确认已失效，请在 Nomi 重新确认。', en: 'This confirmation is no longer valid; confirm again in Nomi.' },
  receipt_expired: { action: 'in_nomi', zh: '确认已过期，请在 Nomi 重新确认。', en: 'The confirmation expired; confirm again in Nomi.' },
  lease_required: { action: 'reselect_project', zh: '请重新选择当前项目。', en: 'Select the current project again.' },
  lease_invalid: { action: 'reselect_project', zh: '项目连接已失效，请重新选择当前项目。', en: 'The project connection expired; select the current project again.' },
  project_scope_changed: { action: 'reselect_project', zh: '项目范围已变化，请重新选择项目。', en: 'The project scope changed; select the project again.' },
  project_binding_stale: { action: 'reselect_project', zh: '项目身份已变化，请重新选择当前项目。', en: 'The project identity changed; select the current project again.' },
  lease_expired: { action: 'reselect_project', zh: '项目连接已过期，请重新选择当前项目。', en: 'The project connection expired; select the current project again.' },
  lease_revoked: { action: 'reselect_project', zh: '项目连接已撤销，请重新选择当前项目。', en: 'The project connection was revoked; select the current project again.' },
}

const OPEN_NEW_PROJECT_SESSION = 'Open a new project session and retry'

const POLICY_CODES = new Set([
  'legacy_path_forbidden', 'feature_disabled', 'phase_not_ready', 'not_ready',
  'capability_invocation_unverified', 'capability_authority_invalid', 'capability_input_invalid',
  'capability_policy_stale', 'capability_output_invalid', 'capability_timeout',
  'capability_cancelled', 'capability_execution_failed',
  'project_session_unavailable', 'project_selection_denied', 'project_identity_unavailable',
  'human_approval_required', 'receipt_invalid', 'receipt_expired',
  'lease_required', 'lease_invalid', 'project_scope_changed', 'project_binding_stale', 'lease_expired', 'lease_revoked',
  'surface_port_suspended', 'surface_port_unavailable', 'surface_port_stale', 'surface_owner_mismatch',
  'node_not_found', 'unknown_node_kind', 'invalid_edge_mode', 'document_not_found', 'project_not_found',
])

/** These typed failures may wrap private disk/provider causes; the code is their whole public message. */
const SAFE_CANVAS_READ_CODES = new Set([
  'capability_invocation_unverified', 'capability_authority_invalid', 'capability_input_invalid',
  'capability_policy_stale', 'capability_output_invalid', 'capability_timeout',
  'capability_cancelled', 'capability_execution_failed',
  'project_identity_unavailable', 'project_binding_stale',
  'surface_port_suspended', 'surface_port_unavailable', 'surface_port_stale', 'surface_owner_mismatch',
  'node_not_found', 'unknown_node_kind', 'invalid_edge_mode', 'document_not_found', 'project_not_found',
])

/** A6 · 错误 → 人话原因 + 恢复动作 + 诊断信息（未知错误不编内容，原样透传 message）。 */
export function buildToolErrorOutcome(
  toolName: string,
  error: unknown,
  locale: ResultLocale = 'zh-CN',
): { text: string; outcome: Record<string, unknown> } {
  const ctx: Ctx = { locale }
  const rawMessage = error instanceof Error ? error.message : String(error)
  const errorRecord = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const structuredCode = typeof errorRecord.code === 'string'
    ? errorRecord.code
    : typeof errorRecord.errorCode === 'string' ? errorRecord.errorCode : null
  const code = structuredCode && POLICY_CODES.has(structuredCode)
    ? structuredCode
    : Object.keys(ERROR_HINT).find((key) => rawMessage.includes(key)) || null
  const message = structuredCode && SAFE_CANVAS_READ_CODES.has(structuredCode)
    ? structuredCode
    : rawMessage
  const nextAction = typeof errorRecord.nextAction === 'string'
    ? errorRecord.nextAction
    : structuredCode && USER_ACTION_HINT[structuredCode]?.action === 'reselect_project'
      ? OPEN_NEW_PROJECT_SESSION
      : undefined
  const policyDetails = structuredCode && POLICY_CODES.has(structuredCode)
    ? {
        ...(nextAction ? { nextAction } : {}),
        ...(typeof errorRecord.phase === 'string' ? { phase: errorRecord.phase } : {}),
        ...(typeof errorRecord.capability === 'string' ? { capability: errorRecord.capability } : {}),
      }
    : {}
  const hint = code ? ERROR_HINT[code] : null
  const userAction = code ? USER_ACTION_HINT[code] : null
  const recover = hint ? hint.recover.map((r) => L(ctx, r.zh, r.en)) : []
  const text = [
    `✗ ${userAction ? L(ctx, userAction.zh, userAction.en) : hint ? L(ctx, hint.zh, hint.en) : message}`,
    userAction ? null : code ? `${L(ctx, '诊断', 'diagnostic')} ${code}` : null,
    ...(!userAction ? recover.map((line, index) => `${index + 1}. ${line}`) : []),
  ].filter(Boolean).join('\n')
  return {
    text,
    outcome: {
      kind: 'error', tool: toolName, errorCode: code, message,
      recoveryActions: userAction ? [L(ctx, userAction.zh, userAction.en)] : recover,
      ...(userAction ? { nextActions: [userAction.action] } : {}),
      ...policyDetails,
    },
  }
}
