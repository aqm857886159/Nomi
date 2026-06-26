// 能力核 · MCP 协议层（纯逻辑，传输注入 → 可裸 node 单测；见 docs/plan/2026-06-24-packaged-mcp-stdio-server.md）。
//
// 手搓 stdio JSON-RPC 2.0（newline-delimited，MCP stdio transport 规范；协议形状经 Context7 核对 R5），
// 不引 @modelcontextprotocol/sdk 依赖（P1 极简）。把能力核暴露成 MCP 工具，供 Claude Code / Codex / Cursor
// 配置后实时驱动 Nomi。**这是唯一的 MCP server 实现**——打包/dev 都由 app 自身二进制以 NOMI_MCP_STDIO
// 模式拉起 mcpStdioServer.ts，后者把本模块接到 stdin/stdout + 进程内 invoke（取代旧 scripts/nomi-mcp.mjs，P1）。
//
// 传输经 McpTransport 注入：send（服务端→客户端帧）/ invoke（调能力核）/ isAppOpen（Nomi 开着没，决定
// 付费确认走应用内卡片还是 Claude 侧 elicitation）。本模块不 import electron → 协议握手可纯逻辑单测。

export type McpInvokeOptions = { spendConfirmed?: boolean }

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

/**
 * 建一个 MCP 协议处理器。喂入客户端发来的每一帧（handleIncoming），它经 transport.send 回响应；
 * 服务端→客户端请求（elicitation/create）的响应由 handleIncoming 按 id 路由回 pending。
 */
export function createMcpProtocol(transport: McpTransport) {
  // 客户端能力（initialize 时捕获）。elicitation = 客户端能代我们向真人弹确认对话框（MCP 规范 2025-06-18）。
  let clientSupportsElicitation = false
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
      // 协议版本回显客户端请求的版本（兼容性根因 R5 实证）：硬回我们偏好版本会让只讲老协议的客户端按规范断开。
      const requested = params?.protocolVersion
      const negotiatedVersion = typeof requested === 'string' && requested ? requested : PROTOCOL_VERSION
      reply(id, {
        protocolVersion: negotiatedVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'nomi-capability-core', version: '0.1.0' },
        instructions: '用 nomi_* 工具在本机驱动 Nomi：列项目/模型、建项目、读画布、加节点/连线/改提示词、触发生成。生成会花用户额度。',
      })
      return
    }
    if (method === 'tools/list') {
      reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
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
          const result = await transport.invoke(tool.method, tool.build(args), { spendConfirmed: true })
          reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
          return
        }
        const result = await transport.invoke(tool.method, tool.build(args))
        reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
      } catch (error) {
        // 工具执行失败用 isError 返回（让模型看到错误而非协议级 error）。
        reply(id, { content: [{ type: 'text', text: `错误：${error instanceof Error ? error.message : String(error)}` }], isError: true })
      }
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
