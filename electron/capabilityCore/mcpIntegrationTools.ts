import type { IntegrationKind } from '../integrationCertification/integrationSession'

// T14 · nomi_integration：模型/ComfyUI 接入会话状态机收进一个 action 枚举 + expectedRevision 单锁。
// 面收敛（surface-16-collapse）：原 10 个 integration_* 工具（同一会话 FSM 的 10 个 transition）塌成 1 个
// nomi_integration（9 写 transition，get 收进 nomi_read target=integration）。收敛只在 catalog 层：build 按 action
// 分派到**原 integration.* method 字面量**，dispatcher 的 case 逐字不动。付费两相（request_confirmation→confirm、
// start）保留为两个 action 值、不合成一步（形状约束2/3：付费两相不可原子化）。乐观锁 expectedRevision 是状态机指纹。
//
// authHeader/authQueryParam 描述保留安全语义：「是名不是值，绝不接收 API key」。

const istr = (value: unknown): string => (typeof value === 'string' ? value : '')

/** action → 内部路由键（integration.* dispatch case）。get 不在此（进 nomi_read）。 */
export const INTEGRATION_METHOD_BY_ACTION: Record<string, string> = {
  begin: 'integration.begin',
  open_credentials: 'integration.open_credentials',
  discover: 'integration.discover',
  select: 'integration.select',
  confirm: 'integration.request_confirmation',
  submit_workflow: 'integration.submit_workflow',
  resolve_input: 'integration.resolve_input',
  start: 'integration.start',
  cancel: 'integration.cancel',
}

const sessionFields = {
  sessionId: { type: 'string', description: 'begin 外全部必填。' },
  expectedRevision: { type: 'integer', minimum: 1, description: 'begin 外全部必填（乐观锁 = 状态机指纹）。' },
}

export const MCP_INTEGRATION_TOOL = {
  name: 'nomi_integration',
  title: '模型 / ComfyUI 接入会话状态机：begin 建会话 / open_credentials 存密钥（只进 Nomi 安全页）/ discover·select·submit_workflow·resolve_input 推进 / confirm·start 付费两相 / cancel 取消。',
  description: '按 action 推进接入会话（同一会话对象 + 同一把 expectedRevision 乐观锁）。只接受公开连接资料，绝不接收 API key 或 Authorization 值；confirm/start 是付费两相，不可合成一步。',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['begin', 'open_credentials', 'discover', 'select', 'confirm', 'submit_workflow', 'resolve_input', 'start', 'cancel'] },
      ...sessionFields,
      // action=begin（不需 sessionId）
      kind: { type: 'string', enum: ['http-api-provider', 'comfyui-workflow'], description: 'action=begin：接入类型。' },
      name: { type: 'string', minLength: 1, maxLength: 240, description: 'action=begin：接入名。' },
      baseUrl: { type: 'string', maxLength: 2000, description: 'action=begin：公开 base URL。' },
      docs: { type: 'string', maxLength: 65536, description: 'action=begin：公开文档 URL 或公开契约文本。' },
      providerKind: { type: 'string', maxLength: 80, description: 'action=begin：公开协议提示，例如 openai。' },
      authType: { type: 'string', enum: ['none', 'bearer', 'x-api-key', 'query'], description: 'action=begin：认证类型。' },
      authHeader: { type: 'string', maxLength: 200, description: 'action=begin：认证 header 名，不是值（绝不接收 API key）。' },
      authQueryParam: { type: 'string', maxLength: 200, description: 'action=begin：认证 query 参数名，不是值（绝不接收 API key）。' },
      clientRequestId: { type: 'string', maxLength: 200, description: 'action=begin：可选幂等键。' },
      // action=discover
      page: { type: 'integer', minimum: 0, description: 'action=discover：候选分页页码。' },
      search: { type: 'string', maxLength: 200, description: 'action=discover：候选检索词。' },
      // action=select
      selections: { type: 'array', maxItems: 100, items: { type: 'object', properties: { modelKey: { type: 'string', minLength: 1 } }, required: ['modelKey'], additionalProperties: false }, description: 'action=select：选中的模型候选。' },
      // action=submit_workflow
      workflow: { type: 'string', minLength: 1, maxLength: 2097152, description: 'action=submit_workflow：ComfyUI workflow JSON 文本。' },
      // action=resolve_input
      answers: { type: 'object', additionalProperties: true, description: 'action=resolve_input：一次提交全部未决字段答案。' },
      // action=confirm / start（付费）
      idempotencyKey: { type: 'string', minLength: 1, maxLength: 200, description: 'action∈{confirm,start}：付费幂等键。' },
      receipt: { type: 'string', minLength: 1, maxLength: 8192, description: 'action=start 必填：花费确认收据。' },
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
        return { sessionId: a.sessionId, expectedRevision: a.expectedRevision }
      case 'discover':
        return { sessionId: a.sessionId, expectedRevision: a.expectedRevision, ...(a.page !== undefined ? { page: a.page } : {}), ...(a.search ? { search: a.search } : {}) }
      case 'select':
        return { sessionId: a.sessionId, expectedRevision: a.expectedRevision, selections: a.selections }
      case 'confirm':
        return { sessionId: a.sessionId, expectedRevision: a.expectedRevision, idempotencyKey: a.idempotencyKey }
      case 'submit_workflow':
        return { sessionId: a.sessionId, expectedRevision: a.expectedRevision, workflow: a.workflow }
      case 'resolve_input':
        return { sessionId: a.sessionId, expectedRevision: a.expectedRevision, answers: a.answers }
      case 'start':
        return { sessionId: a.sessionId, expectedRevision: a.expectedRevision, idempotencyKey: a.idempotencyKey, receipt: a.receipt }
      case 'cancel':
        return { sessionId: a.sessionId, expectedRevision: a.expectedRevision }
      default:
        return {}
    }
  },
} as const

export type IntegrationToolKind = IntegrationKind
