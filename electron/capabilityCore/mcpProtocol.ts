// 能力核 · MCP 协议层（纯逻辑，传输注入 → 可裸 node 单测；见 docs/plan/2026-06-24-packaged-mcp-stdio-server.md）。
//
// 手搓 stdio JSON-RPC 2.0（newline-delimited，MCP stdio transport 规范；协议形状经 Context7 核对 R5），
// 不引 @modelcontextprotocol/sdk 依赖（P1 极简）。把能力核暴露成 MCP 工具，供 Claude Code / Codex / Cursor
// 配置后实时驱动 Nomi。**这是唯一的 MCP server 实现**——打包/dev 都由 app 自身二进制以 NOMI_MCP_STDIO
// 模式拉起 mcpStdioServer.ts，后者把本模块接到 stdin/stdout + 进程内 invoke（取代旧 scripts/nomi-mcp.mjs，P1）。
//
// 传输经 McpTransport 注入：send（服务端→客户端帧）/ invoke（调能力核）/ isAppOpen（Nomi 开着没，决定
// 付费确认走应用内卡片还是 Claude 侧 elicitation）。本模块不 import electron → 协议握手可纯逻辑单测。
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

export type McpInvokeOptions = { spendConfirmed?: boolean }

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
  /** Nomi 是否开着（有活实例）。开着→付费确认走应用内卡，关着→走 elicitation。 */
  isAppOpen(): boolean
}

const PROTOCOL_VERSION = '2025-11-25'

// 工具定义：name → { description, inputSchema(JSON Schema), method(能力核方法), build(args→params) }。
const TOOLS = [
  {
    name: 'nomi_list_projects',
    description: '列出本机 Nomi 的所有项目（id / 名称 / 更新时间）。',
    inputSchema: { type: 'object', properties: {} },
    method: 'project.list',
    build: () => ({}),
  },
  {
    name: 'nomi_create_project',
    description: '新建一个空白 Nomi 项目，返回项目 id。',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: '项目名（可选）' } } },
    method: 'project.create',
    build: (a: Record<string, unknown>) => (a.name ? { name: a.name } : {}),
  },
  {
    name: 'nomi_list_models',
    description: '列出 Nomi 已接入且可用的生成模型（vendor / modelKey / 能力 kind / 名称），用于选型。',
    inputSchema: { type: 'object', properties: {} },
    method: 'models.list',
    build: () => ({}),
  },
  {
    name: 'nomi_read_canvas',
    description: '读取某项目画布的节点与连线（精简视图，用于据此决策）。',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
    method: 'canvas.read',
    build: (a: Record<string, unknown>) => ({ projectId: a.projectId }),
  },
  {
    name: 'nomi_add_nodes',
    description: '往项目画布批量加节点（镜头/文本/图片/视频等）。返回新建节点 id。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', description: 'text / image / video / shot / character / scene / audio 等' },
              title: { type: 'string' },
              prompt: { type: 'string' },
            },
          },
        },
      },
      required: ['projectId', 'nodes'],
    },
    method: 'canvas.addNodes',
    build: (a: Record<string, unknown>) => ({ projectId: a.projectId, nodes: a.nodes || [] }),
  },
  {
    name: 'nomi_connect_nodes',
    description: '连线（参考关系）。connections=[{source,target,mode?}]，mode 缺省 reference。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        connections: {
          type: 'array',
          items: { type: 'object', properties: { source: { type: 'string' }, target: { type: 'string' }, mode: { type: 'string' } }, required: ['source', 'target'] },
        },
      },
      required: ['projectId', 'connections'],
    },
    method: 'canvas.connect',
    build: (a: Record<string, unknown>) => ({ projectId: a.projectId, connections: a.connections || [] }),
  },
  {
    name: 'nomi_set_node_prompt',
    description: '改某节点的提示词（可选改标题）。',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, nodeId: { type: 'string' }, prompt: { type: 'string' }, title: { type: 'string' } },
      required: ['projectId', 'nodeId', 'prompt'],
    },
    method: 'canvas.setPrompt',
    build: (a: Record<string, unknown>) => ({ projectId: a.projectId, nodeId: a.nodeId, prompt: a.prompt, title: a.title }),
  },
  {
    name: 'nomi_delete_nodes',
    description: '删除节点及其关联连线。',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, nodeIds: { type: 'array', items: { type: 'string' } } }, required: ['projectId', 'nodeIds'] },
    method: 'canvas.deleteNodes',
    build: (a: Record<string, unknown>) => ({ projectId: a.projectId, nodeIds: a.nodeIds || [] }),
  },
  {
    name: 'nomi_start_playbook',
    description: '在本地 Nomi 项目中创建一个可审阅的制作草稿。只记录 brief 与 playbook，不批准预算、不调用付费模型。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '目标 Nomi 项目 id' },
        playbook: { type: 'string', description: '制作 playbook，例如 brand.promo' },
        playbookVersion: { type: 'string', description: '可选版本；默认 1.0.0' },
        brief: {
          type: 'object',
          properties: {
            goal: { type: 'string', description: '要完成什么' },
            audience: { type: 'string' },
            channel: { type: 'string' },
            tone: { type: 'string' },
            durationSeconds: { type: 'number', minimum: 1, maximum: 3600 },
            sellingPoints: { type: 'array', maxItems: 20, items: { type: 'string' } },
            referenceArtifactIds: { type: 'array', maxItems: 20, items: { type: 'string' } },
          },
          required: ['goal'],
          additionalProperties: false,
        },
      },
      required: ['projectId', 'playbook', 'brief'],
      additionalProperties: false,
    },
    method: 'production.start',
    build: (a: Record<string, unknown>) => ({
      projectId: a.projectId,
      playbook: a.playbook,
      playbookVersion: a.playbookVersion,
      brief: a.brief,
    }),
  },
  {
    name: 'nomi_get_run',
    description: '读取一个持久化制作 Run 的安全状态投影：阶段、任务、待确认项、预算与最新产物。',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, runId: { type: 'string' } },
      required: ['projectId', 'runId'],
      additionalProperties: false,
    },
    method: 'production.get',
    build: (a: Record<string, unknown>) => ({ projectId: a.projectId, runId: a.runId }),
  },
  {
    name: 'nomi_subscribe_run',
    description: '从 durable cursor 开始长轮询制作 Run 的重要事件；最多等待 25 秒，不返回轮询噪声。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        runId: { type: 'string' },
        afterCursor: { type: 'integer', minimum: 0, default: 0 },
        waitMs: { type: 'integer', minimum: 0, maximum: 25_000, default: 0 },
      },
      required: ['projectId', 'runId'],
      additionalProperties: false,
    },
    method: 'production.events',
    build: (a: Record<string, unknown>) => ({
      projectId: a.projectId,
      runId: a.runId,
      afterCursor: a.afterCursor ?? 0,
      waitMs: a.waitMs ?? 0,
    }),
  },
  {
    name: 'nomi_get_artifact',
    description: '读取 Run 内一个产物的安全元数据、受控预览能力与 Nomi 深链；不返回绝对路径或供应商地址。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        runId: { type: 'string' },
        artifactId: { type: 'string' },
      },
      required: ['projectId', 'runId', 'artifactId'],
      additionalProperties: false,
    },
    method: 'production.artifact',
    build: (a: Record<string, unknown>) => ({
      projectId: a.projectId,
      runId: a.runId,
      artifactId: a.artifactId,
    }),
  },
  {
    name: 'nomi_generate',
    description: '触发一次生成（用 Nomi 的 archetype 正确组装参数 + 落资产回节点）。会花用户额度。intent=image/video/text/audio。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        vendor: { type: 'string' },
        modelKey: { type: 'string' },
        intent: { type: 'string', enum: ['image', 'video', 'text', 'audio'] },
        prompt: { type: 'string' },
        nodeId: { type: 'string', description: '在既有节点上生成（可选）' },
        references: { type: 'array', items: { type: 'string' }, description: '参考图 URL（可选）' },
      },
      required: ['projectId', 'vendor', 'modelKey', 'intent', 'prompt'],
    },
    method: 'generate',
    build: (a: Record<string, unknown>) => ({ projectId: a.projectId, vendor: a.vendor, modelKey: a.modelKey, intent: a.intent, prompt: a.prompt, nodeId: a.nodeId, references: a.references }),
  },
] as const

type ToolDef = (typeof TOOLS)[number]
const TOOL_BY_NAME = new Map<string, ToolDef>(TOOLS.map((tool) => [tool.name, tool]))

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
  // 服务端→客户端请求自管 id 与 pending，等客户端回响应。
  let serverReqSeq = 0
  const pendingServerReqs = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()

  function send(message: unknown): void {
    transport.send(message)
  }
  function reply(id: unknown, result: unknown): void {
    send({ jsonrpc: '2.0', id, result })
  }
  function replyError(id: unknown, code: number, message: string): void {
    send({ jsonrpc: '2.0', id, error: { code, message } })
  }

  // tool result 载荷：文本兜底（宿主无 UI 时也看得到，且 content[].text 不变=终端体验零回归）+ 挂 widget 的
  // 工具额外带 structuredContent.nomiDraft / nomiRun（宿主注入 iframe/window.openai 渲活面板）+ _meta.ui.resourceUri
  // （标准）与 openai/outputTemplate（ChatGPT 别名）。always 附——宿主不支持则忽略这些附加字段（spec 设计），
  // 跨 Claude/ChatGPT/参考宿主通用（P4）；不 gate on 客户端声明，否则 ChatGPT 不声明该扩展就拿不到 widget。
  function productionResultText(toolName: string, result: unknown): string | null {
    const value = result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : {}
    const openInNomi = typeof value.openInNomi === 'string' ? value.openInNomi : ''
    if (toolName === 'nomi_start_playbook') {
      return `Nomi 已创建制作草稿 ${String(value.runId || '')}；尚未批准预算，也没有调用付费生成。${openInNomi ? `\n在 Nomi 打开 ${openInNomi}` : ''}`
    }
    if (toolName === 'nomi_get_run') {
      const artifacts = Array.isArray(value.artifacts) ? value.artifacts as Array<Record<string, unknown>> : []
      const latest = artifacts.at(-1)
      const preview = latest?.preview && typeof latest.preview === 'object' ? latest.preview as Record<string, unknown> : undefined
      return `[Nomi] ${String(value.runId || '')} · ${String(value.status || 'unknown')} · ${String(value.stageId || 'unknown')}${preview?.url ? `\n最新预览 ${String(preview.url)}（${String(preview.expiresAt || '限时')}）` : ''}${openInNomi ? `\n在 Nomi 打开 ${openInNomi}` : ''}`
    }
    if (toolName === 'nomi_subscribe_run') {
      const events = Array.isArray(value.events) ? value.events as Array<Record<string, unknown>> : []
      const lines = events.map((event) => `[Nomi] ${String(event.type || 'event')} · ${String(event.message || '')}`)
      return `${lines.length ? lines.join('\n') : '[Nomi] 暂无新的重要事件'}\nnext cursor ${String(value.nextCursor ?? 0)}`
    }
    if (toolName === 'nomi_get_artifact') {
      const preview = value.preview && typeof value.preview === 'object' ? value.preview as Record<string, unknown> : undefined
      const nomiUri = typeof value.nomiUri === 'string' ? value.nomiUri : ''
      return `[Nomi] ${String(value.kind || 'artifact')} · ${String(value.status || 'unknown')} · ${String(value.artifactId || '')}${nomiUri ? `\n产物 ${nomiUri}` : ''}${preview?.url ? `\n预览 ${String(preview.url)}（${String(preview.expiresAt || '限时')}）` : ''}${openInNomi ? `\n在 Nomi 打开 ${openInNomi}` : ''}`
    }
    return null
  }

  function buildToolResultPayload(toolName: string, args: Record<string, unknown>, result: unknown): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      content: [{ type: 'text', text: productionResultText(toolName, result) ?? JSON.stringify(result, null, 2) }],
    }
    const uiUri = TOOL_UI_RESOURCE[toolName]
    if (uiUri && ['nomi_start_playbook', 'nomi_get_run', 'nomi_subscribe_run', 'nomi_get_artifact'].includes(toolName)) {
      payload.structuredContent = {
        nomiRun: buildNomiRunFromProjection({
          projectId: typeof args.projectId === 'string' ? args.projectId : undefined,
          runId: typeof args.runId === 'string' ? args.runId : undefined,
          result,
        }),
        // The widget needs a compact presentation frame; the AI client needs the complete safe
        // projection to reason about gates, cursors, jobs and artifact identities. The service
        // owns redaction before this protocol boundary.
        nomiRunData: result,
      }
      payload._meta = { ui: { resourceUri: uiUri }, 'openai/outputTemplate': uiUri }
    } else if (toolName === 'nomi_generate' && uiUri) {
      payload.structuredContent = {
        nomiDraft: buildNomiDraftFromGenerate({
          intent: typeof args.intent === 'string' ? args.intent : undefined,
          prompt: typeof args.prompt === 'string' ? args.prompt : undefined,
          projectId: typeof args.projectId === 'string' ? args.projectId : undefined,
          vendor: typeof args.vendor === 'string' ? args.vendor : undefined,
          modelKey: typeof args.modelKey === 'string' ? args.modelKey : undefined,
          result,
        }),
      }
      payload._meta = { ui: { resourceUri: uiUri }, 'openai/outputTemplate': uiUri }
    }
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
  async function elicitSpendConfirm(text: string): Promise<{ supported: boolean; confirmed?: boolean }> {
    if (!clientSupportsElicitation) return { supported: false }
    try {
      const res = (await sendServerRequest('elicitation/create', {
        message: text,
        requestedSchema: {
          type: 'object',
          properties: {
            confirm: { type: 'boolean', title: '确认生成', description: '确认后将消耗模型额度生成；取消则不生成、不花费。' },
          },
          required: ['confirm'],
        },
      })) as { action?: string; content?: { confirm?: boolean } } | null
      // 三态：accept(带 content) / decline / cancel。只在明确 accept 且未显式 confirm=false 时放行。
      const confirmed = res?.action === 'accept' && res?.content?.confirm !== false
      return { supported: true, confirmed }
    } catch {
      // 超时/异常 → 当作未确认（不死等、不偷偷花钱）。
      return { supported: true, confirmed: false }
    }
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
        tools: TOOLS.map(({ name, description, inputSchema }) => {
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
      try {
        const built = tool.build(args) as Record<string, unknown>
        if (tool.name === 'nomi_start_playbook') {
          // initialize.clientInfo is self-declared, so it remains an audit label only. The stdio/RPC
          // transport supplies authority from Nomi's signed per-client configuration capability.
          built.actorId = clientHost
        }
        // 付费生成 + Nomi 没开（无应用内确认卡可弹）→ 在 Claude 这一侧弹 elicitation 让真人确认。
        // 真人确认才以 spendConfirmed 授权本次生成；enforcement 仍在主进程硬闸。
        // app 开着则照常走——由应用内确认卡处理（用户人在 Nomi 边上）。
        if (tool.name === 'nomi_generate' && !transport.isAppOpen()) {
          const costHint = describeSpend(args)
          const confirm = await elicitSpendConfirm(`Nomi 未打开。${costHint}\n确认现在生成吗？`)
          if (!confirm.supported) {
            reply(id, {
              content: [{ type: 'text', text: '已暂停：Nomi 未打开，且当前客户端不支持弹确认。请打开 Nomi 后再触发生成（或在 Nomi 里确认）。节点/提示词若已通过其它工具写入则已保存。' }],
              isError: true,
            })
            return
          }
          if (!confirm.confirmed) {
            reply(id, { content: [{ type: 'text', text: '已取消：你未确认这次付费生成，未生成、未消耗额度。' }], isError: true })
            return
          }
          const result = await transport.invoke(tool.method, built, { spendConfirmed: true })
          reply(id, buildToolResultPayload(tool.name, args, result))
          return
        }
        const result = await transport.invoke(tool.method, built)
        reply(id, buildToolResultPayload(tool.name, args, result))
      } catch (error) {
        // 工具执行失败用 isError 返回（让模型看到错误而非协议级 error）。
        reply(id, { content: [{ type: 'text', text: `错误：${error instanceof Error ? error.message : String(error)}` }], isError: true })
      }
      return
    }
    // ── 技能库（导演/编剧方法论）经 resources + prompts 暴露 · 渐进披露 ────────────
    // skills.list 只返元数据（name+描述，不含正文）；skills.read 才载正文——客户端只为用到的技能付上下文。
    const SKILL_URI_PREFIX = 'nomi-skill://'
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
    if (method === 'resources/read') {
      const uri = String(params?.uri || '')
      // 活 widget HTML（text/html;profile=mcp-app）——宿主装进沙箱 iframe。
      if (uri === NOMI_LIVE_DRAFT_UI_URI) {
        reply(id, { contents: [{ uri, mimeType: MCP_APP_MIME_TYPE, text: NOMI_LIVE_DRAFT_WIDGET_HTML }] })
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
  }
}
