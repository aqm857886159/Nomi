// 能力核 · MCP 协议层（传输注入，纯逻辑，可裸 node 单测）。
//
// MCP Apps（GUI 宿主内嵌 widget）；ProductionRun 结果保留文本兜底。
import {
  NOMI_LIVE_DRAFT_UI_URI,
  MCP_APP_MIME_TYPE,
  NOMI_LIVE_DRAFT_WIDGET_HTML,
  buildNomiRunFromProjection,
} from './mcpAppWidget'
import { buildToolErrorOutcome, buildProgressStartMessage, sanitizeArtifactResource, type ResultLocale } from './mcpToolResults'
import { buildCanonicalMcpToolResult } from './mcpCanonicalToolResult'
import { canvasReadResultSchema } from '../shared/agentCapabilities/canvasRead'
import { assembleToolResultContent } from './mcpResultPayload'
import { stripInternalEnrichFields } from './mcpResultEnrich'
import { createProgressReporter } from './mcpProgress'
import { createMcpRequestRegistry } from './mcpRequestRegistry'
import { validateToolArguments } from './mcpArgValidation'
import { handleSemanticGenerationGate } from './mcpSemanticGenerationFlow'
import { createPlanTrustStore, planConfirmElicit } from './mcpPlanTrust'
import { isAnchorCheckpointGate } from '../productionRun/anchorCheckpoint'
import type { AuthenticatedMcpClient } from './security'
import { subscribeMcpToolCatalogChanges } from './mcpToolCatalogChanges'
import { handleDocumentEditConfirmation } from './mcpDocumentConfirmation'

export type McpInvokeOptions = {
  spendConfirmed?: boolean
  planConfirmed?: boolean
  documentConfirmed?: boolean
  signal?: AbortSignal
}
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

import { createGenerationGateConfirmation } from './mcpGateConfirmation'
import type { GenerationGateChallengeProjection, GenerationGateVerificationResult } from './mcpGateConfirmation'
export type { GenerationGateChallengeProjection, GenerationGateConfirmation, GenerationGateVerificationResult } from './mcpGateConfirmation'

// 挂活 widget（MCP Apps）的工具：面收敛后 = nomi_run_start（建 Run）+ nomi_read 且 target∈{run,run_events,artifact}。
// nomi_read 的 canvas/projects/models 等 target 不挂 widget，故不能只按 name 判——见 widgetUriFor（按 name + target）。
// 判据用 mcpToolCatalog 导出的 READ_RUN_DATA_TARGETS（真相单一）；懒读避免 catalog↔protocol 循环 import 的 TDZ。
function widgetUriFor(toolName: string, args: Record<string, unknown>): string | undefined {
  if (toolName === 'nomi_run_start') return NOMI_LIVE_DRAFT_UI_URI
  if (toolName === 'nomi_read' && typeof args.target === 'string' && READ_RUN_DATA_TARGETS.includes(args.target)) return NOMI_LIVE_DRAFT_UI_URI
  return undefined
}
/** tools/list 预声明 _meta.ui 的工具（name 级；nomi_read 整体广告，运行时按 target 决定是否真挂 widget frame）。 */
const WIDGET_TOOL_NAMES = new Set(['nomi_run_start', 'nomi_read'])

export interface McpTransport {
  send(message: unknown): void
  invoke(method: string, params: Record<string, unknown>, options?: McpInvokeOptions): Promise<unknown>
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

const PROTOCOL_VERSION = '2025-11-25'

/** 服务端支持的协议版本，降序排列。 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const

// tools/list 与 tools/call 共用同一份过滤后目录 resolver，避免“看不见但能调”。
import { MCP_TOOL_RESOLVER, READ_RUN_DATA_TARGETS } from './mcpToolCatalog'

export const MCP_TOOL_NAMES = MCP_TOOL_RESOLVER.list().map((tool) => tool.name)
// 只读标注（annotations.readOnlyHint）真相已收进 catalog（面收敛：nomi_read / nomi_operation_preview 整体只读，
// 各自在目录带 annotations.readOnlyHint）——宿主据此决定读工具免确认（Codex `default_tools_approval_mode="writes"`）。
// 旧的按 name 旁挂集合（READ_ONLY_TOOLS）已退役；tools/list 直接读 tool.annotations（见 method:'tools/list'）。

type RpcMessage = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } }

// 能力核 skills.list / skills.read 返回的形状（协议层据此把技能映射成 MCP resources/prompts）。
type SkillSummaryFrame = {
  name: string
  directoryName: string
  description: string
  packageVersion: string
  contentHash: string
}
type SkillContentFrame = SkillSummaryFrame & { body: string }

/**
 * 建一个 MCP 协议处理器。喂入客户端发来的每一帧（handleIncoming），它经 transport.send 回响应；
 * 服务端→客户端请求（elicitation/create）的响应由 handleIncoming 按 id 路由回 pending。
 */
export function createMcpProtocol(transport: McpTransport) {
  // 客户端能力（initialize 时捕获）。elicitation = 客户端能代我们向真人弹确认对话框（MCP 规范 2025-06-18）。
  let clientSupportsElicitation = false
  let clientHost = 'external'
  let initialized = false
  const unsubscribeCatalogChanges = subscribeMcpToolCatalogChanges(() => {
    if (initialized) send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
  })
  // 画布方案确认的会话级信任：某项目首次批量方案在聊天里批准过 → 本会话该项目后续批量直接放行。
  // 挂闭包 = 随这条 MCP 连接/会话存活，连接断即亡，不持久化（见 mcpPlanTrust.ts）。
  const planTrust = createPlanTrustStore()
  // 在飞请求账本：取消（notifications/cancelled）与 stdio 断连都挂在它上面（见 mcpRequestRegistry.ts）。
  const requests = createMcpRequestRegistry()
  let serverReqSeq = 0
  const pendingServerReqs = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; cleanup?: () => void }>()

  function send(message: unknown): void {
    transport.send(message)
  }
  // 取消后的请求不回响应。
  function reply(id: unknown, result: unknown): void {
    if (!requests.shouldReply(id)) return
    send({ jsonrpc: '2.0', id, result })
  }
  function replyError(id: unknown, code: number, message: string, data?: unknown): void {
    if (!requests.shouldReply(id)) return
    send({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } })
  }

  // 结果/进度文案语言：跟 transport 给的 App 语言设置，缺省 zh-CN。
  const locale = (): ResultLocale => transport.getLocale?.() ?? 'zh-CN'

  // tool result 载荷：文本兜底（宿主无 UI 时也看得到）+ structuredContent.nomiOutcome（模型稳定字段，
  // A2 收口在 mcpToolResults.ts——文本=转述原材料+参数回显，双语）。挂 widget 的工具额外带
  // nomiRun（宿主注入 iframe/window.openai 渲活面板）+ _meta.ui.resourceUri（标准）与
  // openai/outputTemplate（ChatGPT 别名）。always 附——宿主不支持则忽略这些附加字段（spec 设计），
  // 跨 Claude/ChatGPT/参考宿主通用（P4）；不 gate on 客户端声明，否则 ChatGPT 不声明该扩展就拿不到 widget。
  function buildToolResultPayload(toolName: string, args: Record<string, unknown>, result: unknown): Record<string, unknown> {
    const resolvedTool = MCP_TOOL_RESOLVER.resolve(toolName)
    if (resolvedTool && typeof (resolvedTool as { presentResult?: unknown }).presentResult === 'function') {
      return (resolvedTool as { presentResult: (r: unknown) => Record<string, unknown> }).presentResult(result)
    }
    // 面收敛：nomi_read target=canvas 借画布 capability 的 canonical 投影（validated + 结构化透传），
    // 与旧 nomi_read_canvas 的 presentResult 逐字节等价；其余 target 走下面的 mcpToolResults 转述路。
    if (toolName === 'nomi_read' && args.target === 'canvas') {
      return buildCanonicalMcpToolResult(canvasReadResultSchema, result) as Record<string, unknown>
    }
    // content 块装配（text + 可选缩略图 image）抽到 mcpResultPayload（0c：壳文件不破 800 行）。
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
      // The widget needs a compact presentation frame; the AI client needs the complete safe
      // projection to reason about gates, cursors, jobs and artifact identities. The service
      // owns redaction before this protocol boundary. App 侧富化的内部字段（_nomiThumbnail 缩略图
      // base64 / _nomiPreviewUrl 签名链）各有去处（image block / widget），这里剥掉——否则 base64
      // 会在 nomiRunData 里重复一份大 payload（nomi_get_artifact 补图后尤甚）。
      structured.nomiRunData = stripInternalEnrichFields(result)
      payload._meta = { ui: { resourceUri: uiUri }, 'openai/outputTemplate': uiUri }
    }
    if (Object.keys(structured).length) payload.structuredContent = structured
    return payload
  }

  function sendServerRequest(method: string, params: unknown, timeoutMs = 300000, signal?: AbortSignal): Promise<unknown> {
    const id = `srv-${(serverReqSeq += 1)}`
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => signal?.removeEventListener('abort', onAbort)
      const onAbort = () => {
        if (settled) return
        settled = true
        pendingServerReqs.delete(id)
        cleanup()
        reject(signal?.reason instanceof Error ? signal.reason : new Error('MCP request cancelled'))
      }
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        pendingServerReqs.delete(id)
        cleanup()
        reject(new Error('客户端无响应（确认超时）'))
      }, timeoutMs)
      pendingServerReqs.set(id, { resolve, reject, timer, cleanup })
      if (signal?.aborted) {
        clearTimeout(timer)
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      send({ jsonrpc: '2.0', id, method, params })
    })
  }

  async function elicitBooleanConfirm(input: {
    message: string
    title: string
    description: string
  }, signal?: AbortSignal): Promise<{ supported: boolean; confirmed?: boolean; action?: 'accept' | 'decline' | 'cancel' | 'timeout'; attestation?: unknown }> {
    if (!clientSupportsElicitation) return { supported: false }
    try {
      const res = (await sendServerRequest('elicitation/create', {
        message: input.message,
        requestedSchema: {
          type: 'object',
          properties: {
            confirm: { type: 'boolean', title: input.title, description: input.description },
          },
          required: ['confirm'],
        },
      }, 300000, signal)) as { action?: string; content?: { confirm?: boolean; attestation?: unknown; confirmationAttestation?: unknown } } | null
      // 三态：accept / decline / cancel。只有明确 accept + confirm=true 才能跨过服务端边界。
      const confirmed = res?.action === 'accept' && res?.content?.confirm === true
      return {
        supported: true,
        confirmed,
        action: res?.action === 'accept' || res?.action === 'decline' || res?.action === 'cancel' ? res.action : 'cancel',
        attestation: res?.content?.attestation ?? res?.content?.confirmationAttestation,
      }
    } catch (error) {
      if (signal?.aborted) throw error
      // 超时/异常 → 当作未确认（不死等、不偷偷花钱）。
      return { supported: true, confirmed: false, action: 'timeout' }
    }
  }

  // 生成门确认（challenge → 恰好一个确认面，同 challengeId 并发去重）：逻辑住 mcpGateConfirmation.ts，
  // 这里只喂依赖。elicitation 能力在 initialize 时才定 → 传 getter 不传快照。
  const { requestGenerationConfirmation } = createGenerationGateConfirmation({
    transport,
    clientSupportsElicitation: () => clientSupportsElicitation,
    elicitBooleanConfirm,
  })

  async function elicitPlanConfirm(nodeCount: number, signal?: AbortSignal): Promise<{ supported: boolean; confirmed?: boolean }> {
    return elicitBooleanConfirm(planConfirmElicit(nodeCount), signal)
  }

  async function elicitCreativeGateDecision(
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ supported: boolean; confirmed?: boolean }> {
    if (!clientSupportsElicitation) return { supported: false }
    if (args.decision !== 'approved' && args.decision !== 'rejected') throw new Error('Invalid production gate decision')
    const projectId = typeof args.projectId === 'string' ? args.projectId : ''
    const runId = typeof args.runId === 'string' ? args.runId : ''
    const gateId = typeof args.gateId === 'string' ? args.gateId : ''
    const projection = await transport.invoke('production.get', withRequestSignal({ projectId, runId }, signal)) as Record<string, unknown>
    const gates = Array.isArray(projection.gates) ? projection.gates as Array<Record<string, unknown>> : []
    const gate = gates.find((candidate) => candidate.gateId === gateId && candidate.status === 'waiting')
    if (!gate) throw new Error(`Production gate is not waiting: ${gateId}`)
    const creative = gate.scope === 'stage'
      && (gateId.startsWith('gate-direction-') || gateId.startsWith('gate-sample-') || gateId.startsWith('gate-freeze-'))
    // P4 §3.2：锚定妆照检查点与创意门同权（免费质量门，不授权预算）——判定用共享谓词，不再手抄前缀。
    const isCheckpoint = typeof gate.scope === 'string' && isAnchorCheckpointGate({ gateId, scope: gate.scope })
    if (!creative && !isCheckpoint) throw new Error('This decision must be completed in Nomi')
    // W2 冻结门是「视觉确认」语义（确认这批角色/场景卡定妆了、可锁死当身份基准），走同一条创意门 seam。
    const isFreeze = gateId.startsWith('gate-freeze-')

    const approved = args.decision === 'approved'
    const choiceKey = typeof args.choiceKey === 'string' ? args.choiceKey : ''
    const candidates = Array.isArray(gate.directionCandidates)
      ? gate.directionCandidates as Array<Record<string, unknown>>
      : []
    const choice = candidates.find((candidate) => candidate.key === choiceKey)
    if (approved && gateId.startsWith('gate-direction-') && candidates.length > 0 && !choice) {
      throw new Error('Choose one of the current direction candidates before approval')
    }
    const title = typeof gate.title === 'string' && gate.title.trim() ? gate.title.trim() : gateId
    const summary = typeof gate.summary === 'string' ? gate.summary.trim() : ''
    const choiceText = typeof choice?.title === 'string' ? choice.title.trim() : choiceKey
    const isEnglish = locale() === 'en'
    const decisionText = approved
      ? (isEnglish ? 'Approve and continue' : '批准并继续')
      : (isEnglish ? 'Reject and stop here' : '否决并停在这里')
    const details = [title, choiceText ? `${isEnglish ? 'Choice' : '选择'}: ${choiceText}` : '', summary]
      .filter(Boolean)
      .join('\n')
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

  async function handle(message: RpcMessage, requestSignal?: AbortSignal): Promise<void> {
    const invokeForRequest = (methodName: string, paramsValue: Record<string, unknown>, options?: McpInvokeOptions) => {
      const forwardedParams = withRequestSignal(paramsValue, requestSignal)
      const { signal: _signal, ...forwardedOptions } = options ?? {}
      return Object.keys(forwardedOptions).length
        ? transport.invoke(methodName, forwardedParams, forwardedOptions)
        : transport.invoke(methodName, forwardedParams)
    }
    const { id, method, params } = message
    // 通知不回响应；取消通知仍须交给 registry。
    if (id === undefined || id === null) {
      if (method === 'notifications/cancelled') {
        // 未知、已完成或畸形 requestId 静默忽略。
        const reason = typeof params?.reason === 'string' ? params.reason : undefined
        requests.cancel(params?.requestId, reason)
      }
      return
    }

    if (method === 'initialize') {
      clientSupportsElicitation = Boolean(params?.capabilities && (params.capabilities as Record<string, unknown>).elicitation)
      const rawName = String((params?.clientInfo as Record<string, unknown> | undefined)?.name || '').trim()
      const clientName = rawName.toLowerCase()
      clientHost = ['codex', 'claude', 'cursor'].find((host) => clientName.includes(host)) ?? 'external'
      if (clientHost === 'external' && rawName) transport.onClientDetected?.(rawName)
      // 版本交集协商：不支持的版本回 -32602。
      const requested = params?.protocolVersion
      if (requested !== undefined && requested !== null && typeof requested !== 'string') {
        replyError(id, -32602, 'Unsupported protocol version', {
          supported: [...SUPPORTED_PROTOCOL_VERSIONS],
          requested,
        })
        return
      }
      const negotiatedVersion = typeof requested === 'string' && requested
        ? requested
        : PROTOCOL_VERSION
      if (typeof requested === 'string' && requested && !SUPPORTED_PROTOCOL_VERSIONS.includes(requested as typeof SUPPORTED_PROTOCOL_VERSIONS[number])) {
        replyError(id, -32602, 'Unsupported protocol version', {
          supported: [...SUPPORTED_PROTOCOL_VERSIONS],
          requested,
        })
        return
      }
      reply(id, {
        protocolVersion: negotiatedVersion,
        capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} },
        serverInfo: { name: 'nomi-capability-core', version: '0.1.0' },
        instructions:
          '用 nomi_* 工具在本机驱动 Nomi：可安全发起制作草稿、读取 Run/事件/产物并深链回 Nomi；付费生成只走 Run-owned 生成门。' +
          '另经 resources/prompts 暴露 Nomi 的「导演/编剧技能库」（从阿泽导演台整过来的电影方法论：拆镜头/运镜/一致性/摄影/对白/结构等）——' +
          '做视频/剧本前先 resources/list 看有哪些、resources/read 或 prompts/get 载入相关技能，再据其方法论写提示词、组装画布、驱动生成，产出质量更专业。',
      })
      initialized = true
      return
    }
    if (method === 'tools/list') {
      reply(id, {
        tools: MCP_TOOL_RESOLVER.list().map((tool) => {
          const { name, description, inputSchema } = tool
          // title（MCP tools spec 2025-06-18；宿主 UI 优先显示）——面收敛后每个工具带一句人读 title。
          const title = typeof (tool as { title?: unknown }).title === 'string' ? { title: (tool as { title: string }).title } : {}
          // 挂活 widget 的工具：预声明 _meta.ui.resourceUri（MCP Apps 标准）+ openai/outputTemplate（ChatGPT 别名）
          // + 调用状态文案。always 广告（宿主不支持则忽略 _meta，spec 设计）→ 跨 Claude/ChatGPT 通用（P4）。
          // nomi_read 整体预声明（运行时按 target 决定是否真挂 widget frame，见 widgetUriFor）。
          const uiUri = WIDGET_TOOL_NAMES.has(name) ? NOMI_LIVE_DRAFT_UI_URI : undefined
          // 只读标注真相收进 catalog（annotations.readOnlyHint）——always 广告（不支持的按 spec 忽略）→ Claude/Codex/Cursor 通用（P4）。
          const projectedAnnotations = 'annotations' in tool ? tool.annotations : undefined
          const annotations = projectedAnnotations ? { annotations: projectedAnnotations } : {}
          return uiUri
            ? {
                name, ...title, description, inputSchema, ...annotations,
                _meta: {
                  ui: { resourceUri: uiUri },
                  'openai/outputTemplate': uiUri,
                  'openai/toolInvocation/invoking': 'Nomi 生成中…',
                  'openai/toolInvocation/invoked': '已出图',
                },
              }
            : { name, ...title, description, inputSchema, ...annotations }
        }),
      })
      return
    }
    if (method === 'tools/call') {
      const name = params?.name as string | undefined
      const tool = name ? MCP_TOOL_RESOLVER.resolve(name) : undefined
      if (!tool) {
        replyError(id, -32602, `未知工具: ${name}`)
        return
      }
      const rawArgs = params?.arguments
      // tools/list 广播的 JSON Schema 同时是运行时唯一校验边界；失败回 Tool Execution Error。
      const invalid = validateToolArguments(tool.name, tool.inputSchema, rawArgs === undefined ? {} : rawArgs)
      if (invalid) {
        const err = buildToolErrorOutcome(tool.name, invalid, locale())
        reply(id, {
          content: [{ type: 'text', text: err.text }],
          isError: true,
          structuredContent: { nomiOutcome: err.outcome },
        })
        return
      }
      const args = (rawArgs as Record<string, unknown>) || {}
      // A1 进度桥：客户端在 _meta.progressToken 要了进度才发（规范）；只挂长任务工具。
      // 心跳报真实已用时长（兼保活，Claude Code stdio 无声 30min 会掐）；真事件经 emit 透出。
      const meta = (params?._meta && typeof params._meta === 'object' && !Array.isArray(params._meta))
        ? params._meta as Record<string, unknown>
        : {}
      const rawToken = meta.progressToken
      // 面收敛：长任务工具 = nomi_run_start（建 Run）+ nomi_operation_execute（提交单次生成）。
      const isLongTool = tool.name === 'nomi_run_start'
        || tool.name === 'nomi_operation_execute'
      const progress = createProgressReporter({
        send,
        progressToken: isLongTool && (typeof rawToken === 'string' || typeof rawToken === 'number') ? rawToken : undefined,
        startMessage: buildProgressStartMessage(tool.name, args, locale()) ?? undefined,
        locale: locale(),
      })
      try {
        const built = tool.build(args) as Record<string, unknown>
        // 面收敛：多态工具按 target/action/phase 选内部路由键（默认回退 tool.method）。派发/内部 invoke 一律用它。
        const routedMethod = typeof (tool as { resolveMethod?: unknown }).resolveMethod === 'function'
          ? (tool as { resolveMethod: (a: Record<string, unknown>) => string }).resolveMethod(args)
          : tool.method
        if (tool.name === 'nomi_run_start') {
          // initialize.clientInfo is self-declared, so it remains an audit label only. The stdio/RPC
          // transport supplies authority from Nomi's signed per-client configuration capability.
          built.actorId = clientHost
        }
        // 面收敛：可逆创意门表态并入 nomi_run_gate（action=decide）——只有 decide 走 elicitation-first 真人确认，
        // materialize（$ 落地）走下面原样 invoke（其付费边界在 handler，不弹创意门确认）。
        if (tool.name === 'nomi_run_gate' && args.action === 'decide') {
          const confirm = await elicitCreativeGateDecision(args, requestSignal)
          if (!confirm.supported) {
            reply(id, {
              content: [{
                type: 'text',
                text: locale() === 'en'
                  ? 'Not applied: this client cannot show Nomi\'s required human confirmation. Decide this gate in Nomi instead.'
                  : '未生效：当前客户端无法显示 Nomi 强制的人为确认，请改在 Nomi 中决定这道门。',
              }],
              isError: true,
            })
            return
          }
          if (!confirm.confirmed) {
            reply(id, {
              content: [{
                type: 'text',
                text: locale() === 'en'
                  ? 'Not applied: you did not confirm this creative decision.'
                  : '未生效：你没有确认这次创意决定。',
              }],
              isError: true,
            })
            return
          }
          const result = await invokeForRequest(routedMethod, built)
          reply(id, buildToolResultPayload(tool.name, args, result))
          return
        }
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
          const result = await invokeForRequest(tool.method, { ...built, confirmation: true })
          reply(id, buildToolResultPayload(tool.name, args, result))
          return
        }
        // A storyboard patch is a reversible write, but it is still a user task:
        // when the MCP client can surface elicitation in an open app, make the
        // approve/deny decision at this protocol boundary before reaching the
        // verified lease/renderer path. The renderer receipt must not be given
        // Host correlation unless a Host turn actually claimed that approval.
        if (
          tool.name === 'nomi_canvas_plan'
          && built.operation === 'patch_shots'
          && clientSupportsElicitation
          && transport.isAppOpen()
        ) {
          const confirm = await elicitBooleanConfirm({
            message: 'Apply the selected storyboard shot patch?\nOnly the named rows and fields will change; the operation is reversible.',
            title: 'Confirm storyboard patch',
            description: 'Approve to apply the canonical patch_shots task. Decline or timeout leaves the project unchanged.',
          }, requestSignal)
          if (!confirm.confirmed) {
            reply(id, {
              content: [{
                type: 'text',
                text: locale() === 'en'
                  ? 'Not applied: the storyboard patch was not approved.'
                  : '未生效：这次分镜修改没有获得批准。',
              }],
              isError: true,
              structuredContent: {
                nomiOutcome: {
                  operation: 'patch_shots',
                  applied: false,
                  denied: true,
                  reason: confirm.action === 'timeout' ? 'timeout' : 'declined',
                },
              },
            })
            return
          }
        }
        if (tool.name === 'nomi_document_edit') {
          await handleDocumentEditConfirmation(
            { id, args, routedMethod, built, requestSignal },
            { elicitBooleanConfirm, invokeForRequest, reply, buildToolResultPayload, locale },
          )
          return
        }
        // 画布方案确认 elicitation-first（免费可撤，见 mcpPlanTrust.ts）：批量加节点（≥2）当声明 elicitation
        // 且 App 开着时，把确认递进聊天问一次而非让人跑去 App 点弹窗；批准记会话级信任、同项目后续不再问。
        // 不满足（单节点 / 不声明 elicitation / headless）→ 落到下面原样 invoke，走既有 gateway.confirmPlan
        //（App 弹窗 / headless 自动放行），逐字节不变。headless 即便声明 elicitation 也不问——它本就是无人值守自动放行。
        //
        // ⚠️ 这里的 isAppOpen() 与付费路那条**不是同一个意思**，别跟着一起删：付费路曾用它猜「用户在不在
        // Nomi 边上」（错的，已改判据）；这里它问的是「不这么做的话，会不会弹出一张应用内方案卡」——
        // 本分支的价值就是把那张卡搬进聊天。App 关着时 confirmPlan 恒 true（免费可撤、无人值守自动放行，
        // 见 createDiskGateway），没有卡可替代，去掉这个条件只会凭空多问一次 → 与「少让用户点」正相反。
        // 面收敛：批量加节点并入 nomi_canvas_edit（operation=create_canvas_nodes，M2 语义面）——只有加节点走
        // elicitation-first 方案确认，其余 operation（set_node_prompt/connect_canvas_edges/tidy_canvas）走下面原样 invoke。
        if (
          tool.name === 'nomi_canvas_edit'
          && clientSupportsElicitation
          && transport.isAppOpen()
          && built.operation === 'create_canvas_nodes'
          && Array.isArray(built.nodes)
          && built.nodes.length >= 2 // 单节点不算「方案」→ 落到下面原样 invoke（与 core.ts 的 ≥2 门对齐）
        ) {
          const projectId = typeof built.projectId === 'string' ? built.projectId : ''
          const nodeCount = built.nodes.length
          if (!planTrust.isTrusted(projectId)) {
            const confirm = await elicitPlanConfirm(nodeCount, requestSignal)
            if (!confirm.confirmed) {
              // decline / 超时 → 不落节点，但把可机读的原因留在结果里；旧形状只有
              // cancelled=true，调用方无法区分用户拒绝与传输/超时取消（J02）。
              reply(id, buildToolResultPayload(tool.name, args, { operation: 'create_canvas_nodes', ids: [], cancelled: true, reason: 'declined' }))
              return
            }
            planTrust.trust(projectId)
          }
          // 已信任或刚批准 → 带 planConfirmed 放行：下游 confirmPlan 预批准、渲染层弹窗不再出现（免双问）。
          const result = await invokeForRequest(routedMethod, built, { planConfirmed: true })
          reply(id, buildToolResultPayload(tool.name, args, result))
          return
        }
        // 面收敛：单次生成付费门并入 nomi_operation_gate。phase=request 走服务端 challenge→客户端确认→decide→start
        // 的编排（handleSemanticGenerationGate 内部仍按原 method 字面量 invoke request/decide/start，付费 seam 不变）；
        // phase=decide 走下面原样 invoke（gate_decide capability 抛错、真正落账经 Run-owned seam）。
        if (tool.name === 'nomi_operation_gate' && args.phase === 'request') {
          await handleSemanticGenerationGate(id, tool.name, args, built, {
            invoke: (method, params, signal) => invokeForRequest(method, params, { signal }),
            requestConfirmation: (challenge, signal) => requestGenerationConfirmation(challenge, signal),
            buildResult: buildToolResultPayload,
            reply,
            locale,
          }, requestSignal)
          return
        }
        const result = await invokeForRequest(routedMethod, built)
        reply(id, buildToolResultPayload(tool.name, args, result))
      } catch (error) {
        // A6 错误契约：isError 返回（模型看到错误而非协议级 error），带人话原因 + 恢复动作 + 诊断码。
        const err = buildToolErrorOutcome(tool.name, error, locale())
        reply(id, {
          content: [{ type: 'text', text: err.text }],
          isError: true,
          structuredContent: { nomiOutcome: err.outcome },
        })
      } finally {
        progress.stop()
      }
      return
    }
    // ── 技能库（导演/编剧方法论）经 resources + prompts 暴露 · 渐进披露 ────────────
    // skills.list 只返元数据（name+描述，不含正文）；skills.read 才载正文——客户端只为用到的技能付上下文。
    const SKILL_URI_PREFIX = 'nomi-skill://'
    const PRODUCTION_ARTIFACT_URI_PREFIX = 'nomi://project/'
    function skillResourceUri(skill: SkillSummaryFrame): string | null {
      if (!/^[A-Za-z0-9._-]{1,160}$/.test(skill.directoryName)) return null
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(skill.packageVersion)) return null
      if (!/^[a-f0-9]{64}$/.test(skill.contentHash)) return null
      return `${SKILL_URI_PREFIX}${encodeURIComponent(skill.directoryName)}/${encodeURIComponent(skill.packageVersion)}/${skill.contentHash}`
    }

    function parseSkillResourceUri(uri: string): {
      directoryName: string
      packageVersion: string
      contentHash: string
    } {
      const match = /^nomi-skill:\/\/([^/]+)\/([^/]+)\/([a-f0-9]{64})$/.exec(uri)
      if (!match) throw new Error(`技能资源 uri 无效: ${uri}`)
      let directoryName: string
      let packageVersion: string
      try {
        directoryName = decodeURIComponent(match[1])
        packageVersion = decodeURIComponent(match[2])
      } catch {
        throw new Error(`技能资源 uri 编码无效: ${uri}`)
      }
      if (!/^[A-Za-z0-9._-]{1,160}$/.test(directoryName) || !/^[A-Za-z0-9._-]{1,80}$/.test(packageVersion)) {
        throw new Error(`技能资源 uri 标识无效: ${uri}`)
      }
      return { directoryName, packageVersion, contentHash: match[3] }
    }

    /** Parse the only production artifact resource shape we expose. IDs are validated again in dispatch/service. */
    function productionArtifactResource(uri: string): Record<string, string> | null {
      if (!uri.startsWith(PRODUCTION_ARTIFACT_URI_PREFIX)) return null
      const match = /^nomi:\/\/project\/([^/]+)\/run\/([^/]+)\/artifact\/([^/]+)$/.exec(uri)
      if (!match) throw new Error(`未知资源 uri: ${uri}`)
      let projectId: string
      let runId: string
      let artifactId: string
      try {
        projectId = decodeURIComponent(match[1])
        runId = decodeURIComponent(match[2])
        artifactId = decodeURIComponent(match[3])
      } catch {
        throw new Error(`资源 uri 编码无效: ${uri}`)
      }
      if (!/^[A-Za-z0-9._-]{1,160}$/.test(projectId) || !/^[A-Za-z0-9._-]{1,160}$/.test(runId) || !/^[A-Za-z0-9._-]{1,160}$/.test(artifactId)) {
        throw new Error(`资源 uri 标识无效: ${uri}`)
      }
      return { projectId, runId, artifactId }
    }

    if (method === 'resources/list') {
      const res = (await invokeForRequest('skills.list', {})) as { skills?: SkillSummaryFrame[] } | null
      const skillResources = (res?.skills || []).flatMap((skill) => {
        const uri = skillResourceUri(skill)
        return uri ? [{ uri, name: skill.name, description: skill.description, mimeType: 'text/markdown' }] : []
      })
      // 活 widget 资源（MCP Apps）：宿主预取渲染生成结果与 production Run 投影的活面板。
      const uiResources = [{
        uri: NOMI_LIVE_DRAFT_UI_URI,
        name: 'Nomi 活生成面板',
        description: '在支持 MCP Apps 的宿主里内嵌显示 Nomi 生成或制作 Run 的状态与安全预览。',
        mimeType: MCP_APP_MIME_TYPE,
      }]
      reply(id, { resources: [...uiResources, ...skillResources] })
      return
    }
    if (method === 'resources/templates/list') {
      reply(id, {
        resourceTemplates: [{
          uriTemplate: 'nomi://project/{projectId}/run/{runId}/artifact/{artifactId}',
          name: 'Nomi production artifact',
          description: 'Versioned script, storyboard, or production artifact content scoped to one local project and run.',
          mimeType: 'application/json',
        }],
      })
      return
    }
    if (method === 'resources/read') {
      const uri = String(params?.uri || '')
      // 活 widget HTML（text/html;profile=mcp-app）——宿主装进沙箱 iframe。
      if (uri === NOMI_LIVE_DRAFT_UI_URI) {
        reply(id, { contents: [{ uri, mimeType: MCP_APP_MIME_TYPE, text: NOMI_LIVE_DRAFT_WIDGET_HTML }] })
        return
      }
      if (uri.startsWith(PRODUCTION_ARTIFACT_URI_PREFIX)) {
        try {
          const artifact = productionArtifactResource(uri)
          if (!artifact) throw new Error(`未知资源 uri: ${uri}`)
          const result = await invokeForRequest('production.artifact.read', artifact)
          reply(id, {
            contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(sanitizeArtifactResource(result), null, 2) }],
          })
        } catch (error) {
          replyError(id, -32602, error instanceof Error ? error.message : String(error))
        }
        return
      }
      if (!uri.startsWith(SKILL_URI_PREFIX)) {
        replyError(id, -32602, `未知资源 uri: ${uri}`)
        return
      }
      try {
        const identity = parseSkillResourceUri(uri)
        const content = (await invokeForRequest('skills.read', identity)) as SkillContentFrame | null
        if (!content?.body) {
          replyError(id, -32602, `未找到技能资源: ${uri}`)
          return
        }
        reply(id, { contents: [{ uri, mimeType: 'text/markdown', text: content.body }] })
      } catch (error) {
        replyError(id, -32602, error instanceof Error ? error.message : String(error))
      }
      return
    }
    if (method === 'prompts/list') {
      const res = (await invokeForRequest('skills.list', {})) as { skills?: SkillSummaryFrame[] } | null
      // name 用 directoryName（斜杠命令友好，如 CodeBuddy 会转成 /director-cinematography）。
      // 版本/hash 一并返回：客户端可以把 prompt 绑定到与 resources 相同的内容快照，避免
      //「列表看到 A、get 却加载了后来写入的 B」的漂移。旧客户端仍可只传 name，get 会在
      // 同一次请求内解析当前元数据；显式传入身份时则严格校验。
      const prompts = (res?.skills || []).map((s) => ({
        name: s.directoryName,
        title: s.name,
        description: s.description,
        packageVersion: s.packageVersion,
        contentHash: s.contentHash,
      }))
      reply(id, { prompts })
      return
    }
    if (method === 'prompts/get') {
      const name = String(params?.name || '')
      const listed = (await invokeForRequest('skills.list', {})) as { skills?: SkillSummaryFrame[] } | null
      const meta = (listed?.skills || []).find((skill) => skill.directoryName === name || skill.name === name)
      if (!meta) {
        replyError(id, -32602, `未找到技能提示词: ${name}`)
        return
      }
      const requestedVersion = typeof params?.packageVersion === 'string' ? params.packageVersion : ''
      const requestedHash = typeof params?.contentHash === 'string' ? params.contentHash : ''
      if ((requestedVersion && requestedVersion !== meta.packageVersion) || (requestedHash && requestedHash !== meta.contentHash)) {
        replyError(id, -32602, `技能提示词已变化，请刷新列表后重试: ${name}`)
        return
      }
      const content = (await invokeForRequest('skills.read', {
        directoryName: meta.directoryName,
        packageVersion: meta.packageVersion,
        contentHash: meta.contentHash,
      })) as SkillContentFrame | null
      if (!content?.body) {
        replyError(id, -32602, `未找到技能提示词: ${name}`)
        return
      }
      reply(id, {
        description: content.description,
        messages: [{ role: 'user', content: { type: 'text', text: content.body } }],
      })
      return
    }
    if (method === 'ping') {
      reply(id, {})
      return
    }
    replyError(id, -32601, `未实现的方法: ${method}`)
  }

  return {
    /** 喂一帧客户端消息：先看是不是对服务端请求的响应（按 id 路由），否则当请求处理。 */
    handleIncoming(message: RpcMessage): void {
      // 客户端对「服务端→客户端请求」（如 elicitation/create）的响应：按 id 路由到 pending。
      if (message && message.method === undefined && message.id != null && pendingServerReqs.has(String(message.id))) {
        const pending = pendingServerReqs.get(String(message.id))!
        pendingServerReqs.delete(String(message.id))
        clearTimeout(pending.timer)
        pending.cleanup?.()
        if (message.error) pending.reject(new Error(message.error.message || '客户端返回错误'))
        else pending.resolve(message.result)
        return
      }
      // 有 id 的请求登记进在飞账本，取消/断连才有东西可中止；无 id 的通知不登记（handle 内部处理）。
      const tracked = message && message.id != null && typeof message.method === 'string'
        ? requests.begin(message.id, message.method)
        : null
      void handle(message, tracked?.signal)
        .catch((error) => {
          if (message && message.id != null) replyError(message.id, -32603, error instanceof Error ? error.message : String(error))
        })
        .finally(() => tracked?.finish())
      },
    requestGenerationConfirmation,
    /** stdio 断连/进程退出：中止全部在飞工作，别把付费生成留在后台跑。 */
    cancelAllInFlight(reason: string): number {
      return requests.cancelAll(reason)
    },
    dispose(): void {
      unsubscribeCatalogChanges()
    },
  }
}
