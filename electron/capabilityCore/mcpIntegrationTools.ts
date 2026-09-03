import type { IntegrationKind } from '../integrationCertification/integrationSession'

// T14 · 确定性接入缝：Nomi 只持有凭据、提案落库、付费确认/启动和取消。
// 发现候选、翻页、适配杂牌 API、构造 workflow、补未决字段属于情境活，由驱动 Agent 完成后一次 propose。
// confirm → start 保持两相，expectedRevision 是会话状态指纹；key 和 receipt 永远不在 MCP 参数中。

const istr = (value: unknown): string => (typeof value === 'string' ? value : '')

/** action → 内部路由键（integration.* dispatch case）。get 进 nomi_read。 */
export const INTEGRATION_METHOD_BY_ACTION: Record<string, string> = {
  begin: 'integration.begin',
  open_credentials: 'integration.open_credentials',
  propose: 'integration.propose',
  confirm: 'integration.request_confirmation',
  start: 'integration.start',
  cancel: 'integration.cancel',
}

const sessionFields = {
  sessionId: { type: 'string', minLength: 1 },
  expectedRevision: { type: 'integer', minimum: 1 },
}

const candidateSchema = {
  type: 'object',
  properties: {
    modelKey: { type: 'string', minLength: 1, maxLength: 160 },
    kind: { type: 'string', enum: ['text', 'image', 'video', 'audio', 'model3d'] },
  },
  required: ['modelKey', 'kind'],
  additionalProperties: false,
} as const

const proposalSchema = {
  type: 'object',
  properties: {
    candidates: { type: 'array', minItems: 1, maxItems: 100, items: candidateSchema },
    selections: {
      type: 'array', minItems: 1, maxItems: 100,
      items: { type: 'object', properties: { modelKey: { type: 'string', minLength: 1, maxLength: 160 } }, required: ['modelKey'], additionalProperties: false },
    },
    workflow: { type: 'string', minLength: 1, maxLength: 2097152 },
    modelKey: { type: 'string', minLength: 1, maxLength: 160 },
  },
  additionalProperties: false,
} as const

export const MCP_INTEGRATION_TOOL = {
  name: 'nomi_integration',
  title: '模型 / ComfyUI 接入：公开配置、凭据页、提案、确认、启动、取消。',
  description: 'Agent 发现/适配；Nomi 隔离密钥、落库、认证并执行付费两相；不得传 key。',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['begin', 'open_credentials', 'propose', 'confirm', 'start', 'cancel'] },
      ...sessionFields,
      kind: { type: 'string', enum: ['http-api-provider', 'comfyui-workflow'] },
      name: { type: 'string', minLength: 1, maxLength: 240 },
      baseUrl: { type: 'string', maxLength: 2000 },
      docs: { type: 'string', maxLength: 65536 },
      providerKind: { type: 'string', maxLength: 80 },
      authType: { type: 'string', enum: ['none', 'bearer', 'x-api-key', 'query'] },
      authHeader: { type: 'string', maxLength: 200, description: 'header 名（非值）。' },
      authQueryParam: { type: 'string', maxLength: 200, description: 'query 名（非值）。' },
      clientRequestId: { type: 'string', maxLength: 200 },
      proposal: proposalSchema,
      idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 },
      receipt: { type: 'string', minLength: 1, maxLength: 8192 },
    },
    required: ['action'],
    additionalProperties: false,
  },
  method: 'integration.begin',
  resolveMethod: (a: Record<string, unknown>): string => INTEGRATION_METHOD_BY_ACTION[istr(a.action)] ?? 'integration.begin',
  build: (a: Record<string, unknown>): Record<string, unknown> => {
    switch (istr(a.action)) {
      case 'begin':
        return {
          kind: a.kind,
          name: a.name,
          ...(a.baseUrl ? { baseUrl: a.baseUrl } : {}),
          ...(a.docs ? { docs: a.docs } : {}),
          ...(a.providerKind ? { providerKind: a.providerKind } : {}),
          ...(a.authType ? { authType: a.authType } : {}),
          ...(a.authHeader ? { authHeader: a.authHeader } : {}),
          ...(a.authQueryParam ? { authQueryParam: a.authQueryParam } : {}),
          ...(a.clientRequestId ? { clientRequestId: a.clientRequestId } : {}),
        }
      case 'open_credentials':
      case 'cancel':
        return { sessionId: a.sessionId, expectedRevision: a.expectedRevision }
      case 'propose':
        return { sessionId: a.sessionId, expectedRevision: a.expectedRevision, proposal: a.proposal }
      case 'confirm':
        return { sessionId: a.sessionId, expectedRevision: a.expectedRevision, idempotencyKey: a.idempotencyKey }
      case 'start':
        return { sessionId: a.sessionId, expectedRevision: a.expectedRevision, idempotencyKey: a.idempotencyKey, receipt: a.receipt }
      default:
        return {}
    }
  },
} as const

export type IntegrationToolKind = IntegrationKind
