// 能力核 · MCP 协议层：官方 SDK v2 之上的 Nomi 装配（设计卡 docs/plan/2026-10-05-mcp-official-sdk.md）。
//
// 协议本身——握手与版本协商、JSON-RPC 路由、请求 id 关联、取消与断连中止、stdio 分帧、参数校验引擎——
// 全归 SDK 的 `Server`。这里只写 Nomi 独有的三件事：
//   ① 各方法的处理器：目录投影（tools/list）、技能与 widget 资源、提示；tools/call 里接审批与领域投影；
//   ② `guardMcpTransport`：任何传输的入口先拒未验证客户端（在发现、校验、确认、冷启动之前）；
//   ③ 进程内连接 `createMcpProtocol`：帧进帧出，给单测与门岗脚本用（同一个 SDK Server，经 SDK 的内存传输）。
//
// 工具走 SDK 的低层处理器而不是 `registerTool`：目录是活的（playbook / 适配器注册会改描述与枚举）、
// 标题按 App 语言每次现算、参数容忍钩子必须在校验前跑、付费审批只许有 tools/call 这一个入口。理由见设计卡。
import {
  InMemoryTransport, ProtocolError, ProtocolErrorCode, Server, fromJsonSchema,
  type CallToolResult, type ElicitRequestParams, type ElicitationCompleteNotificationParams, type JSONRPCMessage,
  type ListToolsResult, type Prompt, type Resource, type ServerContext, type Transport,
} from '@modelcontextprotocol/server'

import { SKILL_URI_PREFIX, skillResourceUri, parseSkillResourceUri, skillFileMimeType, type SkillSummaryFrame, type SkillContentFrame } from './mcpSkillResources'
import { buildSkillPrompts, buildSkillResources } from './mcpPassiveDiscovery'
import { McpConnectionAuthenticationError } from './mcpConnectionContext'
import { NOMI_LIVE_DRAFT_UI_URI, MCP_APP_MIME_TYPE, NOMI_LIVE_DRAFT_WIDGET_HTML, buildNomiRunFromProjection } from './mcpAppWidget'
import { buildToolErrorOutcome, buildProgressStartMessage, sanitizeArtifactResource, type ResultLocale } from './mcpToolResults'
import { buildCanonicalMcpToolResult } from './mcpCanonicalToolResult'
import { canvasReadResultSchema } from '../shared/agentCapabilities/canvasRead'
import { CANVAS_WRITE_CAPABILITY } from '../shared/agentCapabilities/canvasWrite' // 画布写只此一个 method
import { assembleToolResultContent } from './mcpResultPayload'
import { stripInternalEnrichFields } from './mcpResultEnrich'
import { createProgressReporter } from './mcpProgress'
import { handleSemanticGenerationGate } from './mcpSemanticGenerationFlow'
import { createPlanTrustStore, planConfirmElicit } from './mcpPlanTrust'
import { isAnchorCheckpointGate } from '../productionRun/anchorCheckpoint'
import type { AuthenticatedMcpClient } from './security'
import { subscribeMcpToolCatalogChanges } from './mcpToolCatalogChanges'
import { handleDocumentEditConfirmation } from './mcpDocumentConfirmation'
import { handleTimelineEditConfirmation } from './mcpTimelineConfirmation'
import { createGenerationGateConfirmation } from './mcpGateConfirmation'
import { handleTrustDowngrade } from './mcpTrustDowngrade'
import { createElicitationClient, readElicitationCapability } from './mcpElicitation'
import { runIntegrationCredentialElicitation } from './mcpCredentialElicitation'
import type { GenerationGateChallengeProjection, GenerationGateVerificationResult } from './mcpGateConfirmation'
// tools/list 与 tools/call 共用同一份过滤后目录 resolver，避免“看不见但能调”。
import { MCP_TOOL_RESOLVER, READ_RUN_DATA_TARGETS } from './mcpToolCatalog'
import { BUILTIN_MCP_CLIENTS } from '../shared/mcpClientRegistry'
export type { GenerationGateChallengeProjection, GenerationGateConfirmation, GenerationGateVerificationResult } from './mcpGateConfirmation'

export type McpInvokeOptions = {
  planConfirmed?: boolean
  documentConfirmed?: boolean
  signal?: AbortSignal
}
/** 请求的取消信号挂在 params 上递给领域（不进 JSON：不可枚举的 symbol 键）。 */
export const MCP_REQUEST_SIGNAL = Symbol('nomi.mcp.request-signal')

function withRequestSignal(params: Record<string, unknown>, signal?: AbortSignal): Record<string, unknown> {
  if (!signal) return params
  try {
    Object.defineProperty(params, MCP_REQUEST_SIGNAL, { value: signal, configurable: true })
    return params
  } catch {
    const copy = { ...params }
    Object.defineProperty(copy, MCP_REQUEST_SIGNAL, { value: signal, configurable: true })
    return copy
  }
}

/** Nomi 那一侧（领域）。两个生产装配点（Electron stdio / 裸 Node 启动器）各填一份，check:transport-assembly 比对两边。 */
export interface McpHost {
  invoke(method: string, params: Record<string, unknown>, options?: McpInvokeOptions): Promise<unknown>
  /** Probe an already-live instance without allowing the transport to cold-start Nomi. */
  invokeIfOpen?(method: string, params: Record<string, unknown>, options?: McpInvokeOptions): Promise<unknown | undefined>
  /**
   * Nomi 是否开着（有活实例）= **「应用内确认卡这条问法还在不在」**，不是「用户注意力在不在 Nomi」。
   * 确认优先弹在调用方（客户端声明 elicitation 即可）；本标志只用于回答「客户端问不了时，还有谁能问」。
   */
  isAppOpen(): boolean
  getAuthenticatedClient?(): AuthenticatedMcpClient | null
  verifyClientGenerationConfirmation?(challenge: GenerationGateChallengeProjection, attestation: unknown): Promise<boolean | GenerationGateVerificationResult>
  confirmGenerationInNomi?(challenge: GenerationGateChallengeProjection): Promise<boolean | GenerationGateVerificationResult>
  /** 结果/进度文案语言（可选；缺省 zh-CN，跟 App 语言设置走）。 */
  getLocale?(): ResultLocale
  /**
   * 未签名的外部客户端（clientHost === 'external'）自报了名字时回调——用于自动检测并登记到 profile 列表。
   * 只传自报名字（rawName），登记逻辑在 recordDetectedMcpClient（mcpDetectedClients.ts），HMAC 安全模型不受影响。
   */
  onClientDetected?(name: string): void
}

/** 只协商 2025 家族；2026-07-28 等审批改成 input_required 后再放开（设计卡第 2 段）。 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const
const SERVER_INFO = { name: 'nomi-capability-core', version: '0.1.0' }
const INSTRUCTIONS =
  '用 nomi_* 工具在本机驱动 Nomi：可安全发起制作草稿、读取 Run/事件/产物并深链回 Nomi；付费生成只走 Run-owned 生成门。' +
  '另经 resources/prompts 暴露 Nomi 的「导演/编剧技能库」（从阿泽导演台整过来的电影方法论：拆镜头/运镜/一致性/摄影/对白/结构等）——' +
  '做视频/剧本前先 resources/list 看有哪些、resources/read 或 prompts/get 载入相关技能，再据其方法论写提示词、组装画布、驱动生成，产出质量更专业。'
/** 服务端向客户端发的请求（elicitation/create）等多久：等真人点，给足 5 分钟。 */
const SERVER_REQUEST_TIMEOUT_MS = 300_000

const HOST_NAME_GUESS_ORDER: readonly string[] = [...BUILTIN_MCP_CLIENTS].sort((a, b) => b.length - a.length)
export const MCP_TOOL_NAMES = MCP_TOOL_RESOLVER.list().map((tool) => tool.name)

// 挂活 widget（MCP Apps）的工具：nomi_run_start（建 Run）+ nomi_read 且 target∈{run,run_events,artifact}。
function widgetUriFor(toolName: string, args: Record<string, unknown>): string | undefined {
  if (toolName === 'nomi_run_start') return NOMI_LIVE_DRAFT_UI_URI
  if (toolName === 'nomi_read' && typeof args.target === 'string' && READ_RUN_DATA_TARGETS.includes(args.target)) return NOMI_LIVE_DRAFT_UI_URI
  return undefined
}
/** tools/list 预声明 _meta.ui 的工具（name 级；nomi_read 整体广告，运行时按 target 决定是否真挂 widget frame）。 */
const WIDGET_TOOL_NAMES = new Set(['nomi_run_start', 'nomi_read'])

type CatalogTool = ReturnType<typeof MCP_TOOL_RESOLVER.list>[number]
const argumentSchemas = new WeakMap<object, ReturnType<typeof fromJsonSchema>>()

/**
 * tools/call 的参数校验——运行时唯一的校验边界，引擎是 SDK 的 JSON Schema 校验器（tools/list 广播的就是这份 schema）。
 * 不合契约返回 `capability_input_invalid`，由调用方投成工具级错误。门岗与单测也走这一个函数。
 */
export function validateToolArguments(toolName: string, schema: unknown, args: unknown): Error | null {
  if (!schema || typeof schema !== 'object') return null
  const invalid = (detail: string) => Object.assign(new Error(`参数不符合 ${toolName} 的契约 —— ${detail}`), { code: 'capability_input_invalid' })
  let compiled = argumentSchemas.get(schema)
  if (!compiled) {
    try {
      compiled = fromJsonSchema(schema as Parameters<typeof fromJsonSchema>[0])
      argumentSchemas.set(schema, compiled)
    } catch (error) {
      return invalid(`无效工具 schema：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const verdict = compiled['~standard'].validate(args)
  if (verdict instanceof Promise) return invalid('校验器意外地异步返回')
  return verdict.issues ? invalid(verdict.issues.map((issue) => issue.message).join('；')) : null
}

/** 把 tools/list 投成线上形状（字节由特征测试钉死；check:mcp-payload 量的是其中四个字段）。 */
function projectToolsList(locale: ResultLocale) {
  return MCP_TOOL_RESOLVER.list().map((tool) => {
    const { name, description, inputSchema } = tool
    const localizedTitles = (tool as { titleByLocale?: { 'zh-CN': string; en: string } }).titleByLocale
    const selectedTitle = localizedTitles?.[locale] ?? ((tool as { title?: unknown }).title as string | undefined)
    const title = typeof selectedTitle === 'string' && selectedTitle.length > 0 ? { title: selectedTitle } : {}
    // 只读标注真相收进 catalog（annotations.readOnlyHint）——always 广告（不支持的按 spec 忽略）。
    const projectedAnnotations = 'annotations' in tool ? tool.annotations : undefined
    const annotations = projectedAnnotations ? { annotations: projectedAnnotations } : {}
    // 挂活 widget 的工具：预声明 _meta.ui.resourceUri（MCP Apps 标准）+ openai/outputTemplate（ChatGPT 别名）+ 调用状态文案。
    return WIDGET_TOOL_NAMES.has(name)
      ? {
          name, ...title, description, inputSchema, ...annotations,
          _meta: {
            ui: { resourceUri: NOMI_LIVE_DRAFT_UI_URI },
            'openai/outputTemplate': NOMI_LIVE_DRAFT_UI_URI,
            'openai/toolInvocation/invoking': 'Nomi 生成中…',
            'openai/toolInvocation/invoked': '已出图',
          },
        }
      : { name, ...title, description, inputSchema, ...annotations }
  })
}

const PRODUCTION_ARTIFACT_URI_PREFIX = 'nomi://project/'
/** Parse the only production artifact resource shape we expose. IDs are validated again in dispatch/service. */
function productionArtifactResource(uri: string): Record<string, string> {
  const match = /^nomi:\/\/project\/([^/]+)\/run\/([^/]+)\/artifact\/([^/]+)$/.exec(uri)
  if (!match) throw new Error(`未知资源 uri: ${uri}`)
  let ids: string[]
  try {
    ids = [match[1], match[2], match[3]].map(decodeURIComponent)
  } catch {
    throw new Error(`资源 uri 编码无效: ${uri}`)
  }
  if (!ids.every((id) => /^[A-Za-z0-9._-]{1,160}$/.test(id))) throw new Error(`资源 uri 标识无效: ${uri}`)
  return { projectId: ids[0], runId: ids[1], artifactId: ids[2] }
}

const invalidParams = (error: unknown) => new ProtocolError(ProtocolErrorCode.InvalidParams, error instanceof Error ? error.message : String(error))

/** 未验证客户端的那一个回答（-32001 + 稳定码），每种传输的拒绝都用它，宿主看到的永远是同一帧。 */
export function mcpUnauthenticatedResponse(id: string | number, error = new McpConnectionAuthenticationError()): JSONRPCMessage {
  return { jsonrpc: '2.0', id, error: { code: -32001, message: error.message, data: { code: error.code } } }
}

/**
 * 工具的参数容忍钩子（modelFacingTools.ts 的 prepareMcpArguments）必须在**任何**校验之前跑：SDK 在进
 * tools/call 处理器之前就按规范要求 `arguments` 是对象，而真实模型会把整包参数序列化成一段 JSON 文本再发
 * （#547 实测）。所以钩子挂在入口，帧进 SDK 之前改写 `arguments`；钩子自己抛错就原样放行，交给校验去拒。
 */
function tolerateToolArguments(message: JSONRPCMessage): JSONRPCMessage {
  if (!('method' in message) || message.method !== 'tools/call' || !('id' in message)) return message
  const params = message.params as { name?: unknown; arguments?: unknown } | undefined
  const tool = typeof params?.name === 'string' ? MCP_TOOL_RESOLVER.resolve(params.name) : undefined
  if (!tool?.prepareArguments) return message
  try {
    return { ...message, params: { ...params, arguments: tool.prepareArguments(params?.arguments) } }
  } catch {
    return message
  }
}

/**
 * 每种传输的入口（stdio / 进程内 / 第 2 段的本机 HTTP）都过这一层，帧进 SDK 之前：
 *   ① 拒未验证客户端：有 id 的请求一律先过 `getAuthenticatedClient`，不过就回 -32001，帧不进 SDK——
 *      发现、参数校验、确认、冷启动都不会发生。通知与客户端回给我们的响应照常放行。
 *   ② 跑工具的参数容忍钩子（见 tolerateToolArguments）。
 */
export function guardMcpTransport(inner: Transport, host: Pick<McpHost, 'getAuthenticatedClient'>): Transport {
  const rejection = (message: JSONRPCMessage): JSONRPCMessage | null => {
    if (!host.getAuthenticatedClient || !('method' in message) || !('id' in message) || message.id === undefined || message.id === null) return null
    try {
      if (host.getAuthenticatedClient()) return null
      throw new McpConnectionAuthenticationError()
    } catch (error) {
      if (error instanceof McpConnectionAuthenticationError) return mcpUnauthenticatedResponse(message.id, error)
      return { jsonrpc: '2.0', id: message.id, error: { code: ProtocolErrorCode.InternalError, message: error instanceof Error ? error.message : String(error) } }
    }
  }
  const guarded: Transport = {
    start: async () => {
      inner.onclose = () => guarded.onclose?.()
      inner.onerror = (error) => guarded.onerror?.(error)
      inner.onmessage = (message, extra) => {
        const rejected = rejection(message)
        if (rejected) void inner.send(rejected).catch((error: unknown) => guarded.onerror?.(error instanceof Error ? error : new Error(String(error))))
        else guarded.onmessage?.(tolerateToolArguments(message), extra)
      }
      await inner.start()
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    get sessionId() { return inner.sessionId },
  }
  if (inner.setProtocolVersion) guarded.setProtocolVersion = (version) => inner.setProtocolVersion?.(version)
  if (inner.setSupportedProtocolVersions) guarded.setSupportedProtocolVersions = (versions) => inner.setSupportedProtocolVersions?.(versions)
  return guarded
}

export type NomiMcpServer = ReturnType<typeof createNomiMcpServer>

/** 一条 MCP 连接的 Nomi 服务端（每条连接一个：planTrust / 确认去重 / 在途计数都随连接存亡）。 */
export function createNomiMcpServer(host: McpHost) {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} },
    instructions: INSTRUCTIONS,
    supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
  })
  const locale = (): ResultLocale => host.getLocale?.() ?? 'zh-CN'
  // 客户端能力在 initialize 时由 SDK 记下；elicitation 的两种模式按规范分开判（空对象 = 只支持 form）。
  const elicitationModes = () => readElicitationCapability(server.getClientCapabilities())
  // actorId 的展示级猜测（真身份来自配置里的签名 proof）；最长 key 先匹配，免得 'claude' 抢在 'claude-desktop' 前面。
  const clientHost = () => {
    const name = String(server.getClientVersion()?.name || '').trim().toLowerCase()
    return HOST_NAME_GUESS_ORDER.find((candidate) => name.includes(candidate)) ?? 'external'
  }
  server.oninitialized = () => {
    const rawName = String(server.getClientVersion()?.name || '').trim()
    if (clientHost() === 'external' && rawName) host.onClientDetected?.(rawName)
  }
  const unsubscribeCatalogChanges = subscribeMcpToolCatalogChanges(() => {
    if (server.getClientCapabilities() !== undefined) void server.sendToolListChanged().catch(() => {})
  })
  // 画布方案确认的会话级信任：随这条连接存活，连接断即亡（见 mcpPlanTrust.ts）。
  const planTrust = createPlanTrustStore()
  let inFlightToolCalls = 0
  const closeListeners: Array<(inFlightAtClose: number) => void> = []
  server.onclose = () => {
    const inFlightAtClose = inFlightToolCalls
    unsubscribeCatalogChanges()
    for (const listener of closeListeners) listener(inFlightAtClose)
  }

  // 每次工具调用的取消信号 → 它的 JSON-RPC 请求 id。确认弹框要挂在「所属那次调用」上发出去：
  // 本机 HTTP 下服务端→客户端的请求得走那次 POST 的 SSE 流（没有关联就落到独立 GET 流，宿主可能根本没开）；
  // stdio 下关联与否线上一样。领域确认流本来就把这次调用的信号递下来，所以按信号就能找回请求。
  const requestIdBySignal = new WeakMap<AbortSignal, string | number>()

  // elicitation 线协议（form + url 两模式）的语义住 mcpElicitation.ts；请求关联、超时、取消交给 SDK。
  const elicitation = createElicitationClient({
    // 只有 elicitation/create 一种服务端请求：原样转给客户端（不加 SDK elicitInput 会补的 mode 字段，旧宿主线上不变）。
    sendServerRequest: (method, params, timeoutMs, signal) => {
      if (method !== 'elicitation/create') return Promise.reject(new Error(`未支持的服务端请求: ${method}`))
      const relatedRequestId = signal ? requestIdBySignal.get(signal) : undefined
      return server.request(
        { method, params: params as ElicitRequestParams },
        {
          timeout: timeoutMs ?? SERVER_REQUEST_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
          ...(relatedRequestId !== undefined ? { relatedRequestId } : {}),
        },
      )
    },
    notify: (notification) => {
      if (notification.method !== 'notifications/elicitation/complete') return
      void server.notification({ method: notification.method, params: notification.params as ElicitationCompleteNotificationParams }).catch(() => {})
    },
    supportsElicitation: () => elicitationModes().form,
    supportsUrlElicitation: () => elicitationModes().url,
  })
  const elicitBooleanConfirm = elicitation.booleanConfirm
  // 生成门确认（challenge → 恰好一个确认面，同 challengeId 并发去重）：逻辑住 mcpGateConfirmation.ts。
  const { requestGenerationConfirmation } = createGenerationGateConfirmation({
    transport: host,
    clientSupportsElicitation: () => elicitationModes().form,
    elicitBooleanConfirm,
  })

  // tool result 载荷：文本兜底 + structuredContent.nomiOutcome；挂 widget 的工具额外带 nomiRun 与 _meta.ui。
  function buildToolResultPayload(toolName: string, args: Record<string, unknown>, result: unknown): Record<string, unknown> {
    const resolvedTool = MCP_TOOL_RESOLVER.resolve(toolName)
    if (resolvedTool && typeof (resolvedTool as { presentResult?: unknown }).presentResult === 'function') {
      return (resolvedTool as { presentResult: (r: unknown) => Record<string, unknown> }).presentResult(result)
    }
    // nomi_read target=canvas 借画布 capability 的 canonical 投影（validated + 结构化透传）。
    if (toolName === 'nomi_read' && args.target === 'canvas') {
      return buildCanonicalMcpToolResult(canvasReadResultSchema, result) as Record<string, unknown>
    }
    const { content, outcome } = assembleToolResultContent(toolName, args, result, locale())
    const payload: Record<string, unknown> = { content }
    const structured: Record<string, unknown> = {}
    if (outcome) structured.nomiOutcome = outcome
    const uiUri = widgetUriFor(toolName, args)
    if (uiUri) {
      structured.nomiRun = buildNomiRunFromProjection({
        projectId: typeof args.projectId === 'string' ? args.projectId : undefined,
        runId: typeof args.runId === 'string' ? args.runId : undefined,
        result,
      })
      // widget 要紧凑展示帧；AI 要完整安全投影。App 侧富化的内部字段（缩略图 base64 / 签名链）各有去处，这里剥掉。
      structured.nomiRunData = stripInternalEnrichFields(result)
      payload._meta = { ui: { resourceUri: uiUri }, 'openai/outputTemplate': uiUri }
    }
    if (Object.keys(structured).length) payload.structuredContent = structured
    return payload
  }

  const refusal = (zh: string, en: string, structuredContent?: Record<string, unknown>) => ({
    content: [{ type: 'text', text: locale() === 'en' ? en : zh }],
    isError: true,
    ...(structuredContent ? { structuredContent } : {}),
  })

  async function elicitCreativeGateDecision(
    args: Record<string, unknown>,
    invokeForRequest: (method: string, params: Record<string, unknown>) => Promise<unknown>,
    signal?: AbortSignal,
  ): Promise<{ supported: boolean; confirmed?: boolean }> {
    if (!elicitationModes().form) return { supported: false }
    if (args.decision !== 'approved' && args.decision !== 'rejected') throw new Error('Invalid production gate decision')
    const projectId = typeof args.projectId === 'string' ? args.projectId : ''
    const runId = typeof args.runId === 'string' ? args.runId : ''
    const gateId = typeof args.gateId === 'string' ? args.gateId : ''
    const projection = await invokeForRequest('production.get', { projectId, runId }) as Record<string, unknown>
    const gates = Array.isArray(projection.gates) ? projection.gates as Array<Record<string, unknown>> : []
    const gate = gates.find((candidate) => candidate.gateId === gateId && candidate.status === 'waiting')
    if (!gate) throw new Error(`Production gate is not waiting: ${gateId}`)
    const creative = gate.scope === 'stage'
      && (gateId.startsWith('gate-direction-') || gateId.startsWith('gate-sample-') || gateId.startsWith('gate-freeze-'))
    // 锚定妆照检查点与创意门同权（免费质量门，不授权预算）——判定用共享谓词。
    const isCheckpoint = typeof gate.scope === 'string' && isAnchorCheckpointGate({ gateId, scope: gate.scope })
    if (!creative && !isCheckpoint) throw new Error('This decision must be completed in Nomi')
    const isFreeze = gateId.startsWith('gate-freeze-')
    const approved = args.decision === 'approved'
    const choiceKey = typeof args.choiceKey === 'string' ? args.choiceKey : ''
    const candidates = Array.isArray(gate.directionCandidates) ? gate.directionCandidates as Array<Record<string, unknown>> : []
    const choice = candidates.find((candidate) => candidate.key === choiceKey)
    if (approved && gateId.startsWith('gate-direction-') && candidates.length > 0 && !choice) {
      throw new Error('Choose one of the current direction candidates before approval')
    }
    const title = typeof gate.title === 'string' && gate.title.trim() ? gate.title.trim() : gateId
    const summary = typeof gate.summary === 'string' ? gate.summary.trim() : ''
    const choiceText = typeof choice?.title === 'string' ? choice.title.trim() : choiceKey
    const isEnglish = locale() === 'en'
    const decisionText = approved ? (isEnglish ? 'Approve and continue' : '批准并继续') : (isEnglish ? 'Reject and stop here' : '否决并停在这里')
    const details = [title, choiceText ? `${isEnglish ? 'Choice' : '选择'}: ${choiceText}` : '', summary].filter(Boolean).join('\n')
    return elicitBooleanConfirm({
      message: `${decisionText}?\n${details}`,
      title: isCheckpoint
        ? (isEnglish ? 'Confirm you reviewed the stills — start the shots' : '确认定妆照已过目、可以开拍')
        : isFreeze
          ? (isEnglish ? 'Confirm you have reviewed and frozen these cards' : '确认这些卡已过目并冻结')
          : (isEnglish ? 'Confirm this creative decision' : '确认这次创意决定'),
      description: isCheckpoint
        ? (isEnglish
            ? 'Approve = the look is right; the remaining shots generate within the budget you already confirmed (no new authorization). Reject = stay at the checkpoint; the stills are kept and can be regenerated. Review the stills in Nomi (or have the assistant show them) first.'
            : '批准 = 认可这批定妆照，剩余镜头在你确认卡上已批的预算内继续生成（不新增授权）；否决 = 停在检查点，定妆照保留、可重出形象后再来。请先在 Nomi 画布过目定妆照，或让助手展示给你看。')
        : isFreeze
          ? (isEnglish
              ? 'Freezing locks these character/scene cards as the identity baseline for every shot. Review them in Nomi first. Spending and export approvals still happen in Nomi.'
              : '冻结会把这些角色/场景卡锁成每个镜头的身份基准，请先在 Nomi 里过目。支出与导出仍必须在 Nomi 中确认。')
          : (isEnglish
              ? 'Only this reversible creative gate will be decided. Spending and export approvals remain in Nomi.'
              : '只会决定这道可逆创意门；支出与导出仍必须在 Nomi 中确认。'),
    }, signal)
  }

  /**
   * 审批与派发：付费 / 破坏性 / 方案类工具在这里拦在领域之前；其余原样派发。返回线上的工具结果。
   * 领域确认流（mcp*Confirmation / mcpTrustDowngrade / mcpSemanticGenerationFlow）通过 reply 回话，这里收住它。
   */
  async function dispatchTool(tool: CatalogTool, args: Record<string, unknown>, requestSignal: AbortSignal): Promise<Record<string, unknown>> {
    let replied: Record<string, unknown> | undefined
    const reply = (_id: unknown, result: unknown) => { replied = result as Record<string, unknown> }
    const answered = () => {
      if (!replied) throw new Error('MCP confirmation flow finished without a result')
      return replied
    }
    const invokeForRequest = (methodName: string, paramsValue: Record<string, unknown>, options?: McpInvokeOptions) => {
      const forwardedParams = withRequestSignal(paramsValue, requestSignal)
      const { signal: _signal, ...forwardedOptions } = options ?? {}
      return Object.keys(forwardedOptions).length
        ? host.invoke(methodName, forwardedParams, forwardedOptions)
        : host.invoke(methodName, forwardedParams)
    }
    // 领域确认流的 reply(id, result) 签名沿用旧协议层；请求 id 由 SDK 关联，这里不需要，传空。
    const id = undefined
    const built = tool.build(args) as Record<string, unknown>
    // 多态工具按 target/action/phase 选内部路由键（默认回退 tool.method）。
    const routedMethod = typeof (tool as { resolveMethod?: unknown }).resolveMethod === 'function'
      ? (tool as { resolveMethod: (a: Record<string, unknown>) => string }).resolveMethod(args)
      : tool.method
    // clientInfo 是自报的，只当审计标签；权威来自配置里签名的客户端身份。
    if (tool.name === 'nomi_run_start') built.actorId = clientHost()
    // 可逆创意门表态（nomi_run_gate action=decide）：先在调用方问真人；materialize 走原样派发。
    if (tool.name === 'nomi_run_gate' && args.action === 'decide') {
      const confirm = await elicitCreativeGateDecision(args, (method, params) => invokeForRequest(method, params), requestSignal)
      if (!confirm.supported) return refusal('未生效：当前客户端无法显示 Nomi 强制的人为确认，请改在 Nomi 中决定这道门。', 'Not applied: this client cannot show Nomi\'s required human confirmation. Decide this gate in Nomi instead.')
      if (!confirm.confirmed) return refusal('未生效：你没有确认这次创意决定。', 'Not applied: you did not confirm this creative decision.')
      return buildToolResultPayload(tool.name, args, await invokeForRequest(routedMethod, built))
    }
    // 降到 budget_only（以后 ¥X 内不再逐镜问）= 一次付费放行 → 先在调用方客户端问一次真人（mcpTrustDowngrade.ts）。
    if (tool.name === 'nomi_run_control' && await handleTrustDowngrade({ id, toolName: tool.name, args, built, routedMethod, requestSignal }, { invokeForRequest, requestGenerationConfirmation, reply, buildToolResultPayload, locale })) return answered()
    if (tool.name === 'nomi_canvas_maintenance') {
      const nodeIds = Array.isArray(built.nodeIds) ? built.nodeIds.length : 0
      const confirm = await elicitBooleanConfirm({
        message: `Delete ${nodeIds} Canvas node(s). This is destructive but undoable; confirm the exact maintenance request.`,
        title: 'Confirm Canvas deletion',
        description: 'Nomi will delete only the listed nodes after the verified project lease is checked.',
      }, requestSignal)
      if (!confirm.supported || !confirm.confirmed) {
        throw Object.assign(new Error('Human confirmation is required before deleting Canvas nodes'), { code: 'human_approval_required' })
      }
      return buildToolResultPayload(tool.name, args, await invokeForRequest(tool.method, { ...built, confirmation: true }))
    }
    // 分镜补丁是可逆写，但仍是用户的活：客户端能问且 App 开着时，在协议边界先问一次再进租约 / 渲染层。
    if (tool.method === CANVAS_WRITE_CAPABILITY.id && built.operation === 'patch_shots' && elicitationModes().form && host.isAppOpen()) {
      const confirm = await elicitBooleanConfirm({
        message: 'Apply the selected storyboard shot patch?\nOnly the named rows and fields will change; the operation is reversible.',
        title: 'Confirm storyboard patch',
        description: 'Approve to apply the canonical patch_shots task. Decline or timeout leaves the project unchanged.',
      }, requestSignal)
      if (!confirm.confirmed) {
        return refusal('未生效：这次分镜修改没有获得批准。', 'Not applied: the storyboard patch was not approved.', {
          nomiOutcome: { operation: 'patch_shots', applied: false, denied: true, reason: confirm.action === 'timeout' ? 'timeout' : 'declined' },
        })
      }
    }
    if (tool.name === 'nomi_timeline_edit' && await handleTimelineEditConfirmation({ id, toolName: tool.name, args, routedMethod, built, requestSignal }, { elicitBooleanConfirm, invokeForRequest, reply, buildToolResultPayload, locale })) return answered()
    if (tool.name === 'nomi_document_edit') {
      await handleDocumentEditConfirmation({ id, args, routedMethod, built, requestSignal }, { elicitBooleanConfirm, invokeForRequest, reply, buildToolResultPayload, locale })
      return answered()
    }
    // 画布方案确认 elicitation-first（免费可撤，见 mcpPlanTrust.ts）：批量加节点（≥2）且客户端能问、App 开着时，
    // 把确认递进聊天问一次；批准记会话级信任。这里的 isAppOpen() 问的是「不这么做会不会弹出一张应用内方案卡」，
    // 与付费路无关——App 关着时 confirmPlan 恒 true（无人值守自动放行），去掉这个条件只会凭空多问一次。
    if (
      tool.method === CANVAS_WRITE_CAPABILITY.id && elicitationModes().form && host.isAppOpen()
      && built.operation === 'create_canvas_nodes' && Array.isArray(built.nodes) && built.nodes.length >= 2
    ) {
      const projectId = typeof built.projectId === 'string' ? built.projectId : ''
      if (!planTrust.isTrusted(projectId)) {
        const confirm = await elicitBooleanConfirm(planConfirmElicit(built.nodes.length), requestSignal)
        if (!confirm.confirmed) {
          // decline / 超时 → 不落节点，可机读的原因留在结果里（区分用户拒绝与传输取消，J02）。
          return buildToolResultPayload(tool.name, args, { operation: 'create_canvas_nodes', ids: [], cancelled: true, reason: 'declined' })
        }
        planTrust.trust(projectId)
      }
      // 已信任或刚批准 → 带 planConfirmed 放行：下游 confirmPlan 预批准、渲染层弹窗不再出现（免双问）。
      return buildToolResultPayload(tool.name, args, await invokeForRequest(routedMethod, built, { planConfirmed: true }))
    }
    // 单次生成付费门：phase=request 走服务端 challenge → 客户端确认 → decide → start（付费 seam 在领域里不变）。
    if (tool.name === 'nomi_operation_gate' && args.phase === 'request') {
      await handleSemanticGenerationGate(id, tool.name, args, built, {
        invoke: (method, params, signal) => invokeForRequest(method, params, { signal }),
        requestConfirmation: (challenge, signal) => requestGenerationConfirmation(challenge, signal),
        buildResult: buildToolResultPayload,
        reply,
        locale,
      }, requestSignal)
      return answered()
    }
    // 接模型要 key：规范 2025-11-25 要求走 URL 模式 elicitation（密钥不得经 form / 客户端 / 模型上下文）。
    if (tool.name === 'nomi_model_setup' && args.action === 'connect_provider') {
      const outcome = await runIntegrationCredentialElicitation({
        built, method: routedMethod,
        invoke: (method, params) => invokeForRequest(method, params),
        elicitation,
        locale: locale(),
        signal: requestSignal,
      })
      if (outcome.kind === 'error') throw new Error(outcome.message)
      return buildToolResultPayload(tool.name, args, outcome.result)
    }
    return buildToolResultPayload(tool.name, args, await invokeForRequest(routedMethod, built))
  }

  async function callTool(params: { name: string; arguments?: unknown; _meta?: unknown }, ctx: ServerContext): Promise<CallToolResult> {
    const tool = MCP_TOOL_RESOLVER.resolve(params.name)
    if (!tool) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `未知工具: ${params.name}`)
    const toolError = (error: unknown) => {
      // 错误契约：isError 返回（模型看到错误而非协议级 error），带人话原因 + 恢复动作 + 诊断码。
      const err = buildToolErrorOutcome(tool.name, error, locale())
      return { content: [{ type: 'text', text: err.text }], isError: true, structuredContent: { nomiOutcome: err.outcome } }
    }
    // 参数容忍钩子已在入口跑过（guardMcpTransport → tolerateToolArguments）；这里是唯一的校验边界。
    const rawArgs = params.arguments
    const invalid = validateToolArguments(tool.name, tool.inputSchema, rawArgs === undefined ? {} : rawArgs)
    if (invalid) return toolError(invalid) as CallToolResult
    const args = (rawArgs as Record<string, unknown>) || {}
    // 进度：客户端在 _meta.progressToken 要了才发，只挂长任务（建 Run / 提交单次生成）。心跳报真实已用时长（兼保活）。
    const rawToken = ctx.mcpReq._meta?.progressToken
    const isLongTool = tool.name === 'nomi_run_start' || tool.name === 'nomi_operation_execute'
    const progress = createProgressReporter({
      send: (notification) => { void ctx.mcpReq.notify(notification as Parameters<typeof ctx.mcpReq.notify>[0]).catch(() => {}) },
      progressToken: isLongTool && (typeof rawToken === 'string' || typeof rawToken === 'number') ? rawToken : undefined,
      startMessage: buildProgressStartMessage(tool.name, args, locale()) ?? undefined,
      locale: locale(),
    })
    requestIdBySignal.set(ctx.mcpReq.signal, ctx.mcpReq.id)
    inFlightToolCalls += 1
    try {
      return server.projectCallToolResult(await dispatchTool(tool, args, ctx.mcpReq.signal) as CallToolResult, undefined)
    } catch (error) {
      return toolError(error) as CallToolResult
    } finally {
      inFlightToolCalls -= 1
      progress.stop()
    }
  }

  server.setRequestHandler('tools/list', () => ({ tools: projectToolsList(locale()) as ListToolsResult['tools'] }))
  server.setRequestHandler('tools/call', (request, ctx) => callTool(request.params, ctx))

  // ── 技能库（导演/编剧方法论）经 resources + prompts 暴露 · 渐进披露；发现是被动的：没有活实例也不拉起 Nomi ──
  server.setRequestHandler('resources/list', async () => {
    const res = await host.invokeIfOpen?.('skills.list', {}) as { skills?: SkillSummaryFrame[] } | null | undefined
    const uiResources = [{
      uri: NOMI_LIVE_DRAFT_UI_URI,
      name: 'Nomi 活生成面板',
      description: '在支持 MCP Apps 的宿主里内嵌显示 Nomi 生成或制作 Run 的状态与安全预览。',
      mimeType: MCP_APP_MIME_TYPE,
    }]
    return { resources: [...uiResources, ...buildSkillResources(res?.skills || []) as unknown as Resource[]] }
  })
  server.setRequestHandler('resources/templates/list', () => ({
    resourceTemplates: [{
      uriTemplate: 'nomi://project/{projectId}/run/{runId}/artifact/{artifactId}',
      name: 'Nomi production artifact',
      description: 'Versioned script, storyboard, or production artifact content scoped to one local project and run.',
      mimeType: 'application/json',
    }],
  }))
  server.setRequestHandler('resources/read', async (request, ctx) => {
    const uri = request.params.uri
    const invoke = (method: string, params: Record<string, unknown>) => host.invoke(method, withRequestSignal(params, ctx.mcpReq.signal))
    // 活 widget HTML（text/html;profile=mcp-app）——宿主装进沙箱 iframe。
    if (uri === NOMI_LIVE_DRAFT_UI_URI) return { contents: [{ uri, mimeType: MCP_APP_MIME_TYPE, text: NOMI_LIVE_DRAFT_WIDGET_HTML }] }
    try {
      if (uri.startsWith(PRODUCTION_ARTIFACT_URI_PREFIX)) {
        const result = await invoke('production.artifact.read', productionArtifactResource(uri))
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(sanitizeArtifactResource(result), null, 2) }] }
      }
      if (!uri.startsWith(SKILL_URI_PREFIX)) throw new Error(`未知资源 uri: ${uri}`)
      const identity = parseSkillResourceUri(uri)
      const content = (await invoke('skills.read', identity)) as SkillContentFrame | null
      if (typeof content?.body !== 'string') throw new Error(`未找到技能资源: ${uri}`)
      return { contents: [{ uri, mimeType: skillFileMimeType(identity.filePath ?? 'SKILL.md'), text: content.body }] }
    } catch (error) {
      throw invalidParams(error)
    }
  })
  // name 用 directoryName（斜杠命令友好）；版本 / hash 一并返回，get 时显式传入就严格校验，避免列表与正文漂移。
  server.setRequestHandler('prompts/list', async () => {
    const res = (await host.invokeIfOpen?.('skills.list', {})) as { skills?: SkillSummaryFrame[] } | null | undefined
    return { prompts: buildSkillPrompts(res?.skills || []) as unknown as Prompt[] }
  })
  server.setRequestHandler('prompts/get', async (request, ctx) => {
    const name = request.params.name
    const invoke = (method: string, params: Record<string, unknown>) => host.invoke(method, withRequestSignal(params, ctx.mcpReq.signal))
    const listed = (await invoke('skills.list', {})) as { skills?: SkillSummaryFrame[] } | null
    const meta = (listed?.skills || []).find((skill) => skill.directoryName === name || skill.name === name)
    if (!meta) throw invalidParams(`未找到技能提示词: ${name}`)
    const args = request.params.arguments ?? {}
    if (Object.entries(args).some(([key, value]) => !['packageVersion', 'contentHash'].includes(key) || typeof value !== 'string' || !value)) {
      throw invalidParams('Invalid skill prompt arguments')
    }
    if ((args.packageVersion && args.packageVersion !== meta.packageVersion) || (args.contentHash && args.contentHash !== meta.contentHash)) {
      throw invalidParams(`技能提示词已变化，请刷新列表后重试: ${name}`)
    }
    const content = (await invoke('skills.read', {
      directoryName: meta.directoryName,
      packageVersion: meta.packageVersion,
      contentHash: meta.contentHash,
    })) as SkillContentFrame | null
    if (!content?.body) throw invalidParams(`未找到技能提示词: ${name}`)
    return {
      description: content.description,
      messages: [
        { role: 'user' as const, content: { type: 'text' as const, text: content.body } },
        ...(meta.filePaths ?? []).filter((filePath) => filePath !== 'SKILL.md').map((filePath) => ({
          role: 'user' as const, content: { type: 'text' as const, text: `${filePath}: ${skillResourceUri(meta, filePath)}` },
        })),
      ],
    }
  })

  return {
    server,
    /** 接一条传输（stdio / 进程内 / 第 2 段的本机 HTTP）；入口先过 guardMcpTransport。 */
    connect: (transport: Transport) => server.connect(guardMcpTransport(transport, host)),
    /** 关连接：SDK 中止全部在途请求的信号（别把付费生成留在后台跑）。 */
    close: () => server.close(),
    /** 连接关闭时回调，参数是关闭那一刻还在途的工具调用数（诊断日志用）。 */
    onClose(listener: (inFlightAtClose: number) => void) { closeListeners.push(listener) },
    requestGenerationConfirmation,
  }
}

/** 进程内连接用的宿主：Nomi 那一侧 + 收服务端每一帧的 send。 */
export type McpTransport = McpHost & { send(message: unknown): void }

/**
 * 进程内连接：同一个 SDK Server，经 SDK 的内存传输帧进帧出（给单测与门岗脚本用，不经管道）。
 * handleIncoming 喂一帧客户端消息；服务端发出的每一帧（响应 / 通知 / 向客户端的请求）都经 send 交出。
 */
export function createMcpProtocol(transport: McpTransport) {
  const nomi = createNomiMcpServer(transport)
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  clientSide.onmessage = (message) => transport.send(message)
  void clientSide.start()
  const connected = nomi.connect(serverSide)
  let inFlightAtClose = 0
  nomi.onClose((count) => { inFlightAtClose = count })
  return {
    handleIncoming(message: unknown): void {
      void connected.then(() => clientSide.send(message as JSONRPCMessage))
    },
    requestGenerationConfirmation: nomi.requestGenerationConfirmation,
    /** 断开：中止全部在途工作，返回断开那一刻在途的工具调用数。 */
    async cancelAllInFlight(_reason: string): Promise<number> {
      await connected
      await nomi.close()
      return inFlightAtClose
    },
    dispose(): void {
      void connected.then(() => nomi.close()).catch(() => {})
    },
  }
}
