import type { IntegrationKind } from '../integrationCertification/integrationSession'
import { IntegrationRequestError } from '../shared/integrationContract'

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

/**
 * 每个 action 的**真实**必填集（单一真相源）。
 *
 * 2026-09-10 真实宿主实测：schema 广告 `required: ['action']`，而实现逐字段顺序抛错
 * （begin 要 kind/name/baseUrl，open_credentials 要 expectedRevision，confirm 要 idempotencyKey）。
 * 模型严格照 schema 调，于是每个缺的字段烧掉一次完整往返——22 次失败调用里 9 次是这一类。
 * 模型没做错任何事，是我们广告了假的契约。
 *
 * 这张表同时派生两样东西，所以不可能再漂移：
 *   ① 对外 JSON Schema 的 `allOf` + `if/then`（条件必填的标准写法，见
 *      https://json-schema.org/draft/2020-12/json-schema-core#name-if）；
 *   ② `build()` 里的一次性缺字段聚合校验（一次列全，不逐个抛）。
 *
 * `begin` 永远要 kind + name（HTTP 供应商还要 baseUrl）；带上 `sessionId` 表示「接着这一个做」，
 * 不带则同一个 kind+baseUrl 会复用已有的未完成会话，而不是再建一个。
 * `start` 的 `receipt` 不在必填里——不传时服务端用会话上那枚人已确认过的待消费收据。
 */
export const INTEGRATION_REQUIRED_BY_ACTION: Record<string, readonly string[]> = {
  begin: ['kind', 'name'],
  open_credentials: ['sessionId', 'expectedRevision'],
  propose: ['sessionId', 'expectedRevision', 'proposal'],
  confirm: ['sessionId', 'expectedRevision', 'idempotencyKey'],
  start: ['sessionId', 'expectedRevision', 'idempotencyKey'],
  cancel: ['sessionId', 'expectedRevision'],
}

/** `begin` 只在建 HTTP 供应商时才要 baseUrl（ComfyUI 不要）。 */
export const INTEGRATION_BEGIN_HTTP_REQUIRED = ['baseUrl'] as const

// `action` 已经是顶层 required，所以每条 if 里不必再写一遍（写了只是把同一句话广播 6 遍，
// 而 tools/list 的字节是棘轮管着的预算）。
const requiredRule = (action: string, required: readonly string[]) => ({
  if: { properties: { action: { const: action } } },
  then: { required: [...required] },
})

/** 条件必填的标准 JSON Schema 表达。形状与上表逐字派生，没有第二处手写。 */
const INTEGRATION_CONDITIONAL_REQUIRED = [
  {
    // `kind` 在 if 里保留：它不是顶层必填，缺席时 const 会空过。
    if: { properties: { action: { const: 'begin' }, kind: { const: 'http-api-provider' } }, required: ['kind'] },
    then: { required: [...INTEGRATION_BEGIN_HTTP_REQUIRED] },
  },
  ...(['begin', 'open_credentials', 'propose', 'confirm', 'start', 'cancel'] as const).map((action) =>
    requiredRule(action, INTEGRATION_REQUIRED_BY_ACTION[action]),
  ),
] as const

/** 缺什么一次说全，并带上该 action 的完整必填清单。 */
function assertIntegrationRequired(a: Record<string, unknown>): void {
  const action = istr(a.action)
  const required = INTEGRATION_REQUIRED_BY_ACTION[action]
  if (!required) return
  const expected = action === 'begin' && a.kind === 'http-api-provider'
    ? [...required, ...INTEGRATION_BEGIN_HTTP_REQUIRED]
    : required
  const missing = expected.filter((field) => a[field] === undefined || a[field] === null || a[field] === '')
  if (!missing.length) return
  throw new IntegrationRequestError(
    'integration_required_fields_missing',
    `nomi_integration action="${action}" is missing ${missing.join(', ')}. This action requires: ${expected.join(', ')}`,
    { action, missing: missing.join(','), required: expected.join(',') },
  )
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
    // 由驱动 Agent 自己按接口文档编出来的说明卡（JSON 文本，形状见上一次 propose 返回的
    // compileRequest.contractSchema）。传输层用字符串承载，与同一工具里的 workflow 一致；
    // 权威校验在主进程的 validateProviderAdapterDraft，宿主端不做二次形状约束。
    adapterDraft: {
      type: 'string', minLength: 2, maxLength: 524288,
      description: 'JSON text of {"sources":[...],"models":[...]} compiled from the provider API docs. Only send it when a prior propose returned compileRequest; provider identity, model ids, labels and billing kinds are locked by Nomi and must not be repeated here.',
    },
  },
  additionalProperties: false,
} as const

export const MCP_INTEGRATION_TOOL = {
  name: 'nomi_integration',
  title: '接入模型或 ComfyUI',
  description: '空 proposal 探测 /models；candidates 可手填兜底；不得传 key。本机没有可读文档的文本模型时，propose 会返回 compileRequest（目标 schema + 撰写规则），照它回填 proposal.adapterDraft 再次 propose。',
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
    allOf: INTEGRATION_CONDITIONAL_REQUIRED,
    additionalProperties: false,
  },
  method: 'integration.begin',
  resolveMethod: (a: Record<string, unknown>): string => INTEGRATION_METHOD_BY_ACTION[istr(a.action)] ?? 'integration.begin',
  build: (a: Record<string, unknown>): Record<string, unknown> => {
    assertIntegrationRequired(a)
    switch (istr(a.action)) {
      case 'begin':
        return {
          kind: a.kind,
          name: a.name,
          ...(a.sessionId ? { sessionId: a.sessionId } : {}),
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
