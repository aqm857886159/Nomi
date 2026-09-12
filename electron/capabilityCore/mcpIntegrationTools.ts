import type { IntegrationKind } from '../integrationCertification/integrationSession'
import { IntegrationRequestError } from '../shared/integrationContract'

// T14 · 确定性接入缝：Nomi 只持有凭据、提案落库、启动自检和取消。
// 发现候选、翻页、适配杂牌 API、构造 workflow、补未决字段属于情境活，由驱动 Agent 完成后一次 propose。
// propose 通过即可直接 start：接模型**没有付费验证**（2026-09-12 用户拍板），所以没有 confirm 这一跳、
// 没有挑战也没有收据。expectedRevision 是会话状态指纹；key 永远不在 MCP 参数中。

const istr = (value: unknown): string => (typeof value === 'string' ? value : '')

/** action → 内部路由键（integration.* dispatch case）。get 进 nomi_read。 */
export const INTEGRATION_METHOD_BY_ACTION: Record<string, string> = {
  begin: 'integration.begin',
  open_credentials: 'integration.open_credentials',
  propose: 'integration.propose',
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
 * （begin 要 kind/name/baseUrl，open_credentials 要 expectedRevision，start 要 idempotencyKey）。
 * 模型严格照 schema 调，于是每个缺的字段烧掉一次完整往返——22 次失败调用里 9 次是这一类。
 * 模型没做错任何事，是我们广告了假的契约。
 *
 * 这张表同时派生两样东西，所以不可能再漂移：
 *   ① 对外广播的 `action` 字段描述（每个 action 的必填清单，逐字从本表生成）；
 *   ② `build()` 里的一次性缺字段聚合校验（一次列全，不逐个抛）。
 *
 * 为什么**不**用 JSON Schema 的 `allOf` + `if/then`（条件必填的标准写法）：模型看到的 schema
 * 要先过各家适配器。Anthropic 适配器会静默丢掉根上的 allOf——模型会看到一个**没有 schema**
 * 的工具；Google 的 OpenAPI 3.0.3 路径不认 const。仓库的 check:model-schema 门岗守的就是这条，
 * 而它守的正是本次修复要根除的那一族：广播出去的东西模型没真收到。所以这里选扁平 schema +
 * 描述里说真话 + 运行时一次说全，而不是一份漂亮但会被丢掉的条件 schema。
 *
 * `begin` 永远要 kind + name（HTTP 供应商还要 baseUrl）；带上 `sessionId` 表示「接着这一个做」，
 * 不带则同一个 kind+baseUrl 会复用已有的未完成会话，而不是再建一个。
 */
export const INTEGRATION_REQUIRED_BY_ACTION: Record<string, readonly string[]> = {
  begin: ['kind', 'name'],
  open_credentials: ['sessionId', 'expectedRevision'],
  propose: ['sessionId', 'expectedRevision', 'proposal'],
  start: ['sessionId', 'expectedRevision', 'idempotencyKey'],
  cancel: ['sessionId', 'expectedRevision'],
}

/** `begin` 只在建 HTTP 供应商时才要 baseUrl（ComfyUI 不要）。 */
export const INTEGRATION_BEGIN_HTTP_REQUIRED = ['baseUrl'] as const

// `action` 已经是顶层 required，所以每条 if 里不必再写一遍（写了只是把同一句话广播 6 遍，
// 而 tools/list 的字节是棘轮管着的预算）。
/** 广播给模型的必填清单，逐字从上表生成——描述里写的和运行时校验的是同一份。 */
const INTEGRATION_ACTION_DESCRIPTION = `按 action 分派。必填随 action 变：${
  Object.entries(INTEGRATION_REQUIRED_BY_ACTION)
    .map(([action, fields]) => `${action}=${fields.join('+')}${action === 'begin' ? `（kind=http-api-provider 时还要 ${INTEGRATION_BEGIN_HTTP_REQUIRED.join('+')}）` : ''}`)
    .join('；')
}。`

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
      action: { type: 'string', enum: ['begin', 'open_credentials', 'propose', 'start', 'cancel'], description: INTEGRATION_ACTION_DESCRIPTION },
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
    },
    required: ['action'],
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
      case 'start':
        return { sessionId: a.sessionId, expectedRevision: a.expectedRevision, idempotencyKey: a.idempotencyKey }
      default:
        return {}
    }
  },
} as const

export type IntegrationToolKind = IntegrationKind
