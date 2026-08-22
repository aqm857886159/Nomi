// 能力核 · MCP 协议层（纯逻辑，传输注入 → 可裸 node 单测；见 docs/plan/2026-06-24-packaged-mcp-stdio-server.md）。
//
// 手搓 stdio JSON-RPC 2.0（newline-delimited，MCP stdio transport 规范；协议形状经 Context7 核对 R5），
// 不引 @modelcontextprotocol/sdk 依赖（P1 极简）。把能力核暴露成 MCP 工具，供 Claude Code / Codex / Cursor
// 配置后实时驱动 Nomi。**这是唯一的 MCP server 实现**——打包/dev 都由 app 自身二进制以 NOMI_MCP_STDIO
// 模式拉起 mcpStdioServer.ts，后者把本模块接到 stdin/stdout + 进程内 invoke（取代旧 scripts/nomi-mcp.mjs，P1）。
//
// 传输经 McpTransport 注入：send（服务端→客户端帧）/ invoke（调能力核）/ isAppOpen（Nomi 开着没 = 还有没有
// 应用内确认卡这条兜底问法；**不用来猜用户注意力在哪**）。本模块不 import electron → 协议握手可纯逻辑单测。
//
// MCP Apps（GUI 宿主内嵌活 widget，扩展 id io.modelcontextprotocol/ui，Stable 2026-01-26）：
// nomi_generate 挂 _meta.ui.resourceUri → 指向 ui:// 资源（widget HTML，经 resources/read 取）；
// 生成结果回 structuredContent.nomiDraft，宿主注入 iframe 渲染活生成面板。mcpAppWidget.ts 是纯字符串，
// import 它不破「本模块不碰 electron」的纯逻辑单测边界。宿主不支持时 tool 仍回文本兜底（不裸奔）。
import {
  NOMI_LIVE_DRAFT_UI_URI,
  MCP_APP_MIME_TYPE,
  NOMI_LIVE_DRAFT_WIDGET_HTML,
  buildNomiDraftFromGenerate,
  buildNomiRunFromProjection,
} from './mcpAppWidget'
import { buildToolErrorOutcome, buildProgressStartMessage, sanitizeArtifactResource, type ResultLocale } from './mcpToolResults'
import { assembleToolResultContent } from './mcpResultPayload'
import { stripInternalEnrichFields } from './mcpResultEnrich'
import { createProgressReporter } from './mcpProgress'
import { createPlanTrustStore, planConfirmElicit } from './mcpPlanTrust'
import { createSpendTrustStore, spendConfirmElicit } from './mcpSpendTrust'
import { buildIntakeMessage, buildIntakeQuestions, buildIntakeSchema, resolveIntake, summarizeIntake } from './mcpBriefIntake'
import type { AuthenticatedMcpClient } from './security'

// spendConfirmed=真人已在 Claude 侧确认付费；planConfirmed=真人已在聊天里批准这批方案节点
// （elicitation-first 画布确认，见 mcpPlanTrust.ts）——透传给传输层，让最终跑 confirmPlan 的网关预批准、
// 不再弹 App 卡（免双问）。因方案 elicitation 发生在 App 开着时，planConfirmed 需跨 RPC 边界到达渲染层网关。
export type McpInvokeOptions = { spendConfirmed?: boolean; planConfirmed?: boolean }

export type GenerationGateChallengeProjection = {
  challengeId: string
  nonce?: string
  projectName?: string
  shotSummary?: string
  model: string
  referenceCount?: number
  costScope: string
  maximumCost: number
  currency?: string
  expiresAt: string
  confirmationText?: string
  /** Opaque server handoff data. It never belongs in user-facing copy. */
  handoff?: Record<string, unknown>
}

export type GenerationGateConfirmation = {
  challengeId: string
  confirmed: boolean
  surface: 'client' | 'nomi' | 'none'
  nextAction: 'in_client' | 'in_nomi' | 'wait_for_reconciliation'
  receiptId?: string
  receiptToken?: string
}

export type GenerationGateVerificationResult = Pick<GenerationGateConfirmation, 'confirmed' | 'receiptId' | 'receiptToken'>

// 哪些工具挂活 widget（tool.name → ui:// 资源）：单次生成与 production Run 共用一张活面板。
const TOOL_UI_RESOURCE: Record<string, string> = {
  nomi_generate: NOMI_LIVE_DRAFT_UI_URI,
  nomi_start_playbook: NOMI_LIVE_DRAFT_UI_URI,
  nomi_get_run: NOMI_LIVE_DRAFT_UI_URI,
  nomi_subscribe_run: NOMI_LIVE_DRAFT_UI_URI,
  nomi_get_artifact: NOMI_LIVE_DRAFT_UI_URI,
}

export interface McpTransport {
  /** 发一帧给客户端（响应 / 服务端→客户端请求如 elicitation/create）。 */
  send(message: unknown): void
  /** 调一次能力核方法。spendConfirmed=真人已在 Claude 侧确认付费 → 透传给传输层放行本次。 */
  invoke(method: string, params: Record<string, unknown>, options?: McpInvokeOptions): Promise<unknown>
  /**
   * Nomi 是否开着（有活实例）= **「应用内确认卡这条问法还在不在」**，不是「用户注意力在不在 Nomi」。
   * 确认优先弹在调用方（客户端声明 elicitation 即可）；本标志只用于回答「客户端问不了时，还有谁能问」。
   */
  isAppOpen(): boolean
  /** Main-process proof that this connection was installed for a known MCP client. */
  getAuthenticatedClient?(): AuthenticatedMcpClient | null
  /** Optional per-challenge verifier. A static client proof is not enough to mint a receipt. */
  verifyClientGenerationConfirmation?(challenge: GenerationGateChallengeProjection, attestation: unknown): Promise<boolean | GenerationGateVerificationResult>
  /** GUI fallback for the exact server-owned challenge. It must return only the gesture result. */
  confirmGenerationInNomi?(challenge: GenerationGateChallengeProjection): Promise<boolean | GenerationGateVerificationResult>
  /** 结果/进度文案语言（可选；缺省 zh-CN，跟 App 语言设置走）。 */
  getLocale?(): ResultLocale
}

const PROTOCOL_VERSION = '2025-11-25'

// MCP 工具契约目录抽出到 mcpToolCatalog.ts（壳到 800/800 的 headroom 提取）；此处只 import 这份数据契约。
import { MCP_TOOL_CATALOG } from './mcpToolCatalog'

export const MCP_TOOL_NAMES = MCP_TOOL_CATALOG.map((tool) => tool.name)

type ToolDef = (typeof MCP_TOOL_CATALOG)[number]
const TOOL_BY_NAME = new Map<string, ToolDef>(MCP_TOOL_CATALOG.map((tool) => [tool.name, tool]))

/**
 * 只读工具（annotations.readOnlyHint）——**只查不改不花钱**的那几个。
 * 为什么必须标：宿主按它决定要不要每次弹确认（Codex 的 `default_tools_approval_mode = "writes"`
 * 就是「没标 read-only 的才问」）。不标 → 连「列一下项目」都要用户点一次同意，助手基本没法用；
 * 标错（把 nomi_generate 也标上）→ 花钱的生成被静默放行。只列查询类，其余一律按会改/会花钱对待。
 */
const READ_ONLY_TOOLS = new Set([
  'nomi_list_projects',
  'nomi_list_models',
  'nomi_read_canvas',
  'nomi_get_run',
  'nomi_subscribe_run',
  'nomi_get_artifact',
  'nomi_read_artifact',
])

const INTENT_LABEL: Record<string, string> = { image: '一张画面', video: '一段视频', audio: '一段音频', text: '一段文本' }

/** 人话花费提示（给确认对话框看）：产物类型 + 模型 + 提示词截断。不显金额（守卫不依赖金额）。 */
function describeSpend(args: Record<string, unknown>): string {
  const what = INTENT_LABEL[String(args?.intent || '')] || '一个素材'
  const model = [args?.vendor, args?.modelKey].filter(Boolean).join(' · ') || '默认模型'
  const promptStr = typeof args?.prompt === 'string' ? args.prompt : ''
  const prompt = promptStr.trim() ? `「${promptStr.trim().slice(0, 50)}${promptStr.length > 50 ? '…' : ''}」` : ''
  return `即将用 ${model} 生成${what}${prompt ? ' ' + prompt : ''}，将消耗模型额度。`
}

type RpcMessage = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } }

// 能力核 skills.list / skills.read 返回的形状（协议层据此把技能映射成 MCP resources/prompts）。
type SkillSummaryFrame = { name: string; directoryName: string; description: string }
type SkillContentFrame = { name: string; directoryName: string; description: string; body: string }

/**
 * 建一个 MCP 协议处理器。喂入客户端发来的每一帧（handleIncoming），它经 transport.send 回响应；
 * 服务端→客户端请求（elicitation/create）的响应由 handleIncoming 按 id 路由回 pending。
 */
export function createMcpProtocol(transport: McpTransport) {
  // 客户端能力（initialize 时捕获）。elicitation = 客户端能代我们向真人弹确认对话框（MCP 规范 2025-06-18）。
  let clientSupportsElicitation = false
  let clientHost = 'external'
  // 画布方案确认的会话级信任：某项目首次批量方案在聊天里批准过 → 本会话该项目后续批量直接放行。
  // 挂闭包 = 随这条 MCP 连接/会话存活，连接断即亡，不持久化（见 mcpPlanTrust.ts）。
  const planTrust = createPlanTrustStore()
  // 付费的会话级信任（治「反复去软件确认」）：某项目批准一次 → 本会话该项目后续生成免问，
  // 用满 SPEND_TRUST_REASK_AFTER 次再问一次。同样挂闭包 = 随这条连接存活，断即亡（见 mcpSpendTrust.ts）。
  const spendTrust = createSpendTrustStore()
  // 服务端→客户端请求自管 id 与 pending，等客户端回响应。
  let serverReqSeq = 0
  const pendingServerReqs = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const generationConfirmationInFlight = new Map<string, Promise<GenerationGateConfirmation>>()

  function send(message: unknown): void {
    transport.send(message)
  }
  function reply(id: unknown, result: unknown): void {
    send({ jsonrpc: '2.0', id, result })
  }
  function replyError(id: unknown, code: number, message: string): void {
    send({ jsonrpc: '2.0', id, error: { code, message } })
  }

  // 结果/进度文案语言：跟 transport 给的 App 语言设置，缺省 zh-CN。
  const locale = (): ResultLocale => transport.getLocale?.() ?? 'zh-CN'

  // tool result 载荷：文本兜底（宿主无 UI 时也看得到）+ structuredContent.nomiOutcome（模型稳定字段，
  // A2 收口在 mcpToolResults.ts——文本=转述原材料+参数回显，双语）。挂 widget 的工具额外带
  // nomiDraft / nomiRun（宿主注入 iframe/window.openai 渲活面板）+ _meta.ui.resourceUri（标准）与
  // openai/outputTemplate（ChatGPT 别名）。always 附——宿主不支持则忽略这些附加字段（spec 设计），
  // 跨 Claude/ChatGPT/参考宿主通用（P4）；不 gate on 客户端声明，否则 ChatGPT 不声明该扩展就拿不到 widget。
  function buildToolResultPayload(toolName: string, args: Record<string, unknown>, result: unknown): Record<string, unknown> {
    // content 块装配（text + 可选缩略图 image）抽到 mcpResultPayload（0c：壳文件不破 800 行）。
    const { content, outcome } = assembleToolResultContent(toolName, args, result, locale())
    const payload: Record<string, unknown> = { content }
    const structured: Record<string, unknown> = {}
    if (outcome) structured.nomiOutcome = outcome
    const uiUri = TOOL_UI_RESOURCE[toolName]
    if (uiUri && ['nomi_start_playbook', 'nomi_get_run', 'nomi_subscribe_run', 'nomi_get_artifact'].includes(toolName)) {
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
    } else if (toolName === 'nomi_generate' && uiUri) {
      structured.nomiDraft = buildNomiDraftFromGenerate({
        intent: typeof args.intent === 'string' ? args.intent : undefined,
        prompt: typeof args.prompt === 'string' ? args.prompt : undefined,
        projectId: typeof args.projectId === 'string' ? args.projectId : undefined,
        vendor: typeof args.vendor === 'string' ? args.vendor : undefined,
        modelKey: typeof args.modelKey === 'string' ? args.modelKey : undefined,
        result,
      })
      payload._meta = { ui: { resourceUri: uiUri }, 'openai/outputTemplate': uiUri }
    }
    if (Object.keys(structured).length) payload.structuredContent = structured
    return payload
  }

  function sendServerRequest(method: string, params: unknown, timeoutMs = 300000): Promise<unknown> {
    const id = `srv-${(serverReqSeq += 1)}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingServerReqs.delete(id)
        reject(new Error('客户端无响应（确认超时）'))
      }, timeoutMs)
      pendingServerReqs.set(id, { resolve, reject, timer })
      send({ jsonrpc: '2.0', id, method, params })
    })
  }

  /**
   * 让客户端（Claude Code）向真人弹一个「确认花费」对话框（boolean）。
   * 不支持 elicitation 的客户端返回 { supported:false }；支持则返回 { supported:true, confirmed:bool }。
   */
  async function elicitBooleanConfirm(input: {
    message: string
    title: string
    description: string
  }): Promise<{ supported: boolean; confirmed?: boolean; action?: 'accept' | 'decline' | 'cancel' | 'timeout'; attestation?: unknown }> {
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
      })) as { action?: string; content?: { confirm?: boolean; attestation?: unknown; confirmationAttestation?: unknown } } | null
      // 三态：accept / decline / cancel。只有明确 accept + confirm=true 才能跨过服务端边界。
      const confirmed = res?.action === 'accept' && res?.content?.confirm === true
      return {
        supported: true,
        confirmed,
        action: res?.action === 'accept' || res?.action === 'decline' || res?.action === 'cancel' ? res.action : 'cancel',
        attestation: res?.content?.attestation ?? res?.content?.confirmationAttestation,
      }
    } catch {
      // 超时/异常 → 当作未确认（不死等、不偷偷花钱）。
      return { supported: true, confirmed: false, action: 'timeout' }
    }
  }

  /**
   * Answer one server-owned generation challenge on exactly one surface. The
   * challenge is deliberately passed unchanged to the GUI fallback so a
   * client timeout/reconnect cannot mint a second prompt or nonce.
   */
  async function resolveGenerationConfirmation(
    challenge: GenerationGateChallengeProjection,
  ): Promise<GenerationGateConfirmation> {
    if (!challenge.challengeId || !challenge.model || !challenge.costScope || !Number.isFinite(challenge.maximumCost)
      || !challenge.expiresAt) throw new Error('Invalid generation gate challenge')
    const authenticatedClient = transport.getAuthenticatedClient?.() ?? null
    if (clientSupportsElicitation && authenticatedClient) {
      const elicited = await elicitBooleanConfirm({
        message: challenge.confirmationText || [
          `允许 Nomi 在${challenge.projectName ? `项目《${challenge.projectName}》` : '当前项目'}使用模型 ${challenge.model}`,
          `最多花费 ${challenge.currency || ''}${challenge.maximumCost}，${challenge.shotSummary || '生成这一镜'}吗？`,
        ].join('，'),
        title: '确认这次生成',
        description: [
          challenge.referenceCount === undefined ? '' : `参考图 ${challenge.referenceCount} 张`,
          `有效期至 ${challenge.expiresAt}`,
        ].filter(Boolean).join(' · '),
      })
      if (!elicited.confirmed) {
        // A deliberate decline/cancel is a completed human decision; do not ask
        // the same person again on a second surface. A timeout is also kept on
        // the client surface so a reconnect can reuse the unexpired challenge.
        return {
          challengeId: challenge.challengeId,
          confirmed: false,
          surface: 'client',
          nextAction: 'wait_for_reconciliation',
        }
      }
      if (elicited.attestation && typeof transport.verifyClientGenerationConfirmation === 'function') {
        const verified = await transport.verifyClientGenerationConfirmation(challenge, elicited.attestation)
        const result = typeof verified === 'boolean' ? { confirmed: verified } : verified
        if (result.confirmed === true) {
          return {
            challengeId: challenge.challengeId,
            confirmed: true,
            surface: 'client',
            nextAction: 'in_client',
            ...(result.receiptId ? { receiptId: result.receiptId } : {}),
            ...(result.receiptToken ? { receiptToken: result.receiptToken } : {}),
          }
        }
      }
      // Standard MCP elicitation has no portable click attestation. A bare
      // accept therefore falls through to the same GUI challenge, never to a
      // provider or spend path.
    }
    if (typeof transport.confirmGenerationInNomi === 'function' && transport.isAppOpen()) {
      const fallback = await transport.confirmGenerationInNomi(challenge)
      const confirmed = typeof fallback === 'boolean' ? fallback : fallback.confirmed === true
      return {
        challengeId: challenge.challengeId,
        confirmed,
        surface: 'nomi',
        nextAction: confirmed ? 'in_nomi' : 'wait_for_reconciliation',
        ...(typeof fallback === 'object' ? {
          ...(fallback.receiptId ? { receiptId: fallback.receiptId } : {}),
          ...(fallback.receiptToken ? { receiptToken: fallback.receiptToken } : {}),
        } : {}),
      }
    }
    return {
      challengeId: challenge.challengeId,
      confirmed: false,
      surface: 'none',
      nextAction: 'in_nomi',
    }
  }

  async function requestGenerationConfirmation(
    challenge: GenerationGateChallengeProjection,
  ): Promise<GenerationGateConfirmation> {
    const existing = generationConfirmationInFlight.get(challenge.challengeId)
    if (existing) return existing
    const pending = resolveGenerationConfirmation(challenge)
    generationConfirmationInFlight.set(challenge.challengeId, pending)
    try {
      const result = await pending
      if (!result.confirmed) generationConfirmationInFlight.delete(challenge.challengeId)
      return result
    } catch (error) {
      generationConfirmationInFlight.delete(challenge.challengeId)
      throw error
    }
  }

  /**
   * 画布方案确认（免费、可撤）：把「要不要往画布加这 N 个节点」递进聊天问一次。
   * 与 spend/creative-gate 同一条 seam——协议层拦在 transport.invoke 之前，accept 才放行。
   */
  async function elicitPlanConfirm(nodeCount: number): Promise<{ supported: boolean; confirmed?: boolean }> {
    return elicitBooleanConfirm(planConfirmElicit(nodeCount))
  }

  /**
   * 开场收敛表单（W3 幕 0）：一次弹全 ≤3 题的 enum 选择。与 elicitBooleanConfirm 并列——
   * 那个是「是/否」，这个是「选项」，两者都只是 elicitation/create 的不同 requestedSchema，不另造机制。
   */
  async function elicitIntake(questions: ReturnType<typeof buildIntakeQuestions>): Promise<{ supported: boolean; values?: Record<string, unknown> }> {
    if (!clientSupportsElicitation) return { supported: false }
    try {
      const res = (await sendServerRequest('elicitation/create', {
        message: buildIntakeMessage(questions),
        requestedSchema: buildIntakeSchema(questions),
      })) as { action?: string; content?: Record<string, unknown> } | null
      // decline/cancel 不是错误——收敛这步「跳过永远安全」，交给 resolveIntake 全落默认。
      return { supported: true, values: res?.action === 'accept' ? (res.content || {}) : {} }
    } catch {
      return { supported: true, values: {} } // 超时同理：走默认继续，不卡住用户
    }
  }

  async function elicitCreativeGateDecision(
    args: Record<string, unknown>,
  ): Promise<{ supported: boolean; confirmed?: boolean }> {
    if (!clientSupportsElicitation) return { supported: false }
    if (args.decision !== 'approved' && args.decision !== 'rejected') throw new Error('Invalid production gate decision')
    const projectId = typeof args.projectId === 'string' ? args.projectId : ''
    const runId = typeof args.runId === 'string' ? args.runId : ''
    const gateId = typeof args.gateId === 'string' ? args.gateId : ''
    const projection = await transport.invoke('production.get', { projectId, runId }) as Record<string, unknown>
    const gates = Array.isArray(projection.gates) ? projection.gates as Array<Record<string, unknown>> : []
    const gate = gates.find((candidate) => candidate.gateId === gateId && candidate.status === 'waiting')
    if (!gate) throw new Error(`Production gate is not waiting: ${gateId}`)
    const creative = gate.scope === 'stage'
      && (gateId.startsWith('gate-direction-') || gateId.startsWith('gate-sample-') || gateId.startsWith('gate-freeze-'))
    if (!creative) throw new Error('This decision must be completed in Nomi')
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
      title: isFreeze
        ? (isEnglish ? 'Confirm you have reviewed and frozen these cards' : '确认这些卡已过目并冻结')
        : (isEnglish ? 'Confirm this creative decision' : '确认这次创意决定'),
      description: isFreeze
        ? (isEnglish
            ? 'Freezing locks these character/scene cards as the identity baseline for every shot. Review them in Nomi first. Spending and export approvals still happen in Nomi.'
            : '冻结会把这些角色/场景卡锁成每个镜头的身份基准，请先在 Nomi 里过目。支出与导出仍必须在 Nomi 中确认。')
        : (isEnglish
            ? 'Only this reversible creative gate will be decided. Spending and export approvals remain in Nomi.'
            : '只会决定这道可逆创意门；支出与导出仍必须在 Nomi 中确认。'),
    })
  }

  async function handle(message: RpcMessage): Promise<void> {
    const { id, method, params } = message
    // 通知（无 id）不回响应。
    if (id === undefined || id === null) return

    if (method === 'initialize') {
      clientSupportsElicitation = Boolean(params?.capabilities && (params.capabilities as Record<string, unknown>).elicitation)
      const clientName = String((params?.clientInfo as Record<string, unknown> | undefined)?.name || '').toLowerCase()
      clientHost = clientName.includes('codex')
        ? 'codex'
        : clientName.includes('claude')
          ? 'claude'
          : clientName.includes('cursor')
            ? 'cursor'
            : 'external'
      // 协议版本回显客户端请求的版本（兼容性根因 R5 实证）：硬回我们偏好版本会让只讲老协议的客户端按规范断开。
      const requested = params?.protocolVersion
      const negotiatedVersion = typeof requested === 'string' && requested ? requested : PROTOCOL_VERSION
      reply(id, {
        protocolVersion: negotiatedVersion,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'nomi-capability-core', version: '0.1.0' },
        instructions:
          '用 nomi_* 工具在本机驱动 Nomi：可安全发起制作草稿、读取 Run/事件/产物并深链回 Nomi；低层画布与单次生成工具继续兼容。' +
          '另经 resources/prompts 暴露 Nomi 的「导演/编剧技能库」（从阿泽导演台整过来的电影方法论：拆镜头/运镜/一致性/摄影/对白/结构等）——' +
          '做视频/剧本前先 resources/list 看有哪些、resources/read 或 prompts/get 载入相关技能，再据其方法论写提示词、组装画布、驱动生成，产出质量更专业。',
      })
      return
    }
    if (method === 'tools/list') {
      reply(id, {
        tools: MCP_TOOL_CATALOG.map(({ name, description, inputSchema }) => {
          // 挂活 widget 的工具：预声明 _meta.ui.resourceUri（MCP Apps 标准）+ openai/outputTemplate（ChatGPT 别名）
          // + 调用状态文案。always 广告（宿主不支持则忽略 _meta，spec 设计）→ 跨 Claude/ChatGPT 通用（P4）。
          const uiUri = TOOL_UI_RESOURCE[name]
          // 只读标注对所有宿主 always 广告（不支持的按 spec 忽略未知字段）→ Claude/Codex/Cursor 通用（P4）。
          const annotations = READ_ONLY_TOOLS.has(name) ? { annotations: { readOnlyHint: true } } : {}
          return uiUri
            ? {
                name, description, inputSchema, ...annotations,
                _meta: {
                  ui: { resourceUri: uiUri },
                  'openai/outputTemplate': uiUri,
                  'openai/toolInvocation/invoking': 'Nomi 生成中…',
                  'openai/toolInvocation/invoked': '已出图',
                },
              }
            : { name, description, inputSchema, ...annotations }
        }),
      })
      return
    }
    if (method === 'tools/call') {
      const name = params?.name as string | undefined
      const tool = name ? TOOL_BY_NAME.get(name) : undefined
      if (!tool) {
        replyError(id, -32602, `未知工具: ${name}`)
        return
      }
      const args = (params?.arguments as Record<string, unknown>) || {}
      // A1 进度桥：客户端在 _meta.progressToken 要了进度才发（规范）；只挂长任务工具。
      // 心跳报真实已用时长（兼保活，Claude Code stdio 无声 30min 会掐）；真事件经 emit 透出。
      const meta = (params?._meta && typeof params._meta === 'object' && !Array.isArray(params._meta))
        ? params._meta as Record<string, unknown>
        : {}
      const rawToken = meta.progressToken
      const isLongTool = tool.name === 'nomi_generate' || tool.name === 'nomi_start_playbook'
      const progress = createProgressReporter({
        send,
        progressToken: isLongTool && (typeof rawToken === 'string' || typeof rawToken === 'number') ? rawToken : undefined,
        startMessage: buildProgressStartMessage(tool.name, args, locale()) ?? undefined,
        locale: locale(),
      })
      try {
        const built = tool.build(args) as Record<string, unknown>
        if (tool.name === 'nomi_start_playbook') {
          // initialize.clientInfo is self-declared, so it remains an audit label only. The stdio/RPC
          // transport supplies authority from Nomi's signed per-client configuration capability.
          built.actorId = clientHost
        }
        if (tool.name === 'nomi_decide_gate') {
          const confirm = await elicitCreativeGateDecision(args)
          if (!confirm.supported) {
            reply(id, {
              content: [{
                type: 'text',
                text: locale() === 'en'
                  ? 'Not applied: this client cannot show Nomi\'s required human confirmation. Decide the creative gate in Nomi instead.'
                  : '未生效：当前客户端无法显示 Nomi 强制的人为确认，请改在 Nomi 中决定这道创意门。',
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
          const result = await transport.invoke(tool.method, built)
          reply(id, buildToolResultPayload(tool.name, args, result))
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
        if (
          tool.name === 'nomi_add_nodes'
          && clientSupportsElicitation
          && transport.isAppOpen()
          && Array.isArray(built.nodes)
          && built.nodes.length >= 2 // 单节点不算「方案」→ 落到下面原样 invoke（与 core.ts 的 ≥2 门对齐）
        ) {
          const projectId = typeof built.projectId === 'string' ? built.projectId : ''
          const nodeCount = built.nodes.length
          if (!planTrust.isTrusted(projectId)) {
            const confirm = await elicitPlanConfirm(nodeCount)
            if (!confirm.confirmed) {
              // decline / 超时 → 与既有取消同形（{ids:[],cancelled:true}），不落节点；文案走同一 outcome 漏斗。
              reply(id, buildToolResultPayload(tool.name, args, { ids: [], cancelled: true }))
              return
            }
            planTrust.trust(projectId)
          }
          // 已信任或刚批准 → 带 planConfirmed 放行：下游 confirmPlan 预批准、渲染层弹窗不再出现（免双问）。
          const result = await transport.invoke(tool.method, built, { planConfirmed: true })
          reply(id, buildToolResultPayload(tool.name, args, result))
          return
        }
        // W3 幕 0 · 开场收敛：一屏 ≤3 题弹在调用方（enum 候选，客户端渲染成按钮）。
        // 客户端不支持表单 → **不假装问过**：把题面与候选原样交给模型，由它在对话里一次问全（同样只问一次）。
        // 任何一题留空/选「按你判断」/给非法值 → 走系统默认（跳过永远安全，C 路调研铁律）。
        if (tool.name === 'nomi_intake_brief') {
          const questions = buildIntakeQuestions({ kind: typeof built.kind === 'string' ? built.kind : '' })
          const asked = await elicitIntake(questions)
          if (!asked.supported) {
            // 退化路径：如实告诉模型「我没法弹表单，题在这儿，你一次问全」——不静默用默认，也不假装问过。
            reply(id, buildToolResultPayload(tool.name, args, {
              questions, message: buildIntakeMessage(questions), elicited: false,
              note: '当前客户端不支持表单：请把上面三题一次性问全用户（只问这一次），或直接用各题默认继续。',
            }))
            return
          }
          const decision = resolveIntake(questions, asked.values)
          reply(id, buildToolResultPayload(tool.name, args, {
            elicited: true, values: decision.values, answered: decision.answered,
            usedDefaults: decision.usedDefaults, summary: summarizeIntake(questions, decision),
          }))
          return
        }
        // 付费生成必须有真人确认。**判据是「谁能替我们问到真人」，不是「Nomi 窗口开着没」**：
        // 请求经 MCP 进来，本身就证明人正坐在调用方那头（Claude/Codex/Cursor）；窗口开着 ≠ 注意力在 Nomi
        // （用户桌面上常年挂着 Nomi）。按窗口路由 → 只要 Nomi 开着就把人赶去 App 点一下，白跑一趟。
        //  ① 客户端声明 elicitation → 就地弹在调用方（**不管 App 开没开**），真人 accept 才带 spendConfirmed 放行；
        //  ② 客户端问不了、App 开着 → 落到下面原样 invoke，由应用内确认卡兜底（唯一还能问到人的地方）；
        //  ③ 两者都没有 → 无处问真人 → 诚实报错，绝不静默花钱。
        // elicitSpendConfirm 在客户端没声明 elicitation 时返回 supported:false，故它就是①/②的唯一判据
        // （不另读 clientSupportsElicitation，免两处能力判断漂移）。enforcement 仍在主进程硬闸。
        if (tool.name === 'nomi_generate') {
          const spendProjectId = typeof built.projectId === 'string' ? built.projectId : ''
          // 会话级信任命中 → 这次不问（治「反复确认」，见 mcpSpendTrust.ts）。硬闸不受影响：
          // 下游照旧逐次铸 node-bound 令牌、assertAndConsumeSpendGrant 逐次校验。
          if (spendTrust.isTrusted(spendProjectId)) {
            spendTrust.countPass(spendProjectId)
            const result = await transport.invoke(tool.method, built, { spendConfirmed: true })
            reply(id, buildToolResultPayload(tool.name, args, result))
            return
          }
          const reask = spendTrust.hasApprovedBefore(spendProjectId)
          const confirm = await elicitBooleanConfirm(spendConfirmElicit(describeSpend(args), reask))
          if (confirm.supported) {
            if (!confirm.confirmed) {
              reply(id, { content: [{ type: 'text', text: '已取消：你未确认这次付费生成，未生成、未消耗额度。' }], isError: true })
              return
            }
            const result = await transport.invoke(tool.method, built, { spendConfirmed: true })
            // 只在真跑成功后记信任：invoke 抛错（无令牌/供应商失败）不该换来一段免问期。
            spendTrust.trust(spendProjectId)
            reply(id, buildToolResultPayload(tool.name, args, result))
            return
          }
          if (!transport.isAppOpen()) {
            reply(id, {
              content: [{ type: 'text', text: '已暂停：当前客户端不支持弹确认，Nomi 也没打开——没有地方能确认这次付费生成。请打开 Nomi 后再触发生成。节点/提示词若已通过其它工具写入则已保存。' }],
              isError: true,
            })
            return
          }
          // App 开着但客户端问不了 → 走应用内确认卡。**invoke 成功即等于真人点了卡**：没点 → 无令牌 →
          // 主进程 assertAndConsumeSpendGrant 抛错 → invoke 失败。故成功后同样记信任（这条路也要免掉
          // 「反复」，否则 Claude Code 这类不声明 elicitation 的客户端一点好处都拿不到）。
          // grantsSessionTrust 让那张卡把授权范围写在脸上——用户以为批的是「这一张」，别让他不知情地批掉一段。
          built.grantsSessionTrust = true
          const cardResult = await transport.invoke(tool.method, built)
          spendTrust.trust(spendProjectId)
          reply(id, buildToolResultPayload(tool.name, args, cardResult))
          return
        }
        const result = await transport.invoke(tool.method, built)
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
      const res = (await transport.invoke('skills.list', {})) as { skills?: SkillSummaryFrame[] } | null
      const skillResources = (res?.skills || []).map((s) => ({
        uri: `${SKILL_URI_PREFIX}${s.directoryName}`,
        name: s.name,
        description: s.description,
        mimeType: 'text/markdown',
      }))
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
          const result = await transport.invoke('production.artifact.read', artifact)
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
      const key = uri.slice(SKILL_URI_PREFIX.length)
      const content = (await transport.invoke('skills.read', { name: key })) as SkillContentFrame | null
      if (!content?.body) {
        replyError(id, -32602, `未找到技能资源: ${uri}`)
        return
      }
      reply(id, { contents: [{ uri, mimeType: 'text/markdown', text: content.body }] })
      return
    }
    if (method === 'prompts/list') {
      const res = (await transport.invoke('skills.list', {})) as { skills?: SkillSummaryFrame[] } | null
      // name 用 directoryName（斜杠命令友好，如 CodeBuddy 会转成 /director-cinematography）；无参数。
      const prompts = (res?.skills || []).map((s) => ({ name: s.directoryName, title: s.name, description: s.description }))
      reply(id, { prompts })
      return
    }
    if (method === 'prompts/get') {
      const name = String(params?.name || '')
      const content = (await transport.invoke('skills.read', { name })) as SkillContentFrame | null
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
        if (message.error) pending.reject(new Error(message.error.message || '客户端返回错误'))
        else pending.resolve(message.result)
        return
      }
      void handle(message).catch((error) => {
        if (message && message.id != null) replyError(message.id, -32603, error instanceof Error ? error.message : String(error))
      })
      },
    requestGenerationConfirmation,
  }
}
