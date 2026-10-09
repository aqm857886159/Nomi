// MCP 协议边界的特征测试（设计卡 docs/plan/2026-10-05-mcp-official-sdk.md 第 0 段）。
//
// 只从**线上**看 Nomi：客户端发 JSON-RPC 帧进来，看服务端吐出什么帧、领域那一侧被调了什么。
// 用例部分不碰协议层的实现细节，只有文件末尾的连接器表认识它——同一组用例换协议实现（第 1 段换官方 SDK）、
// 换传输（第 2 段加本机 HTTP）都照跑，加的只是一行连接器。领域那一侧用假宿主（不起 Nomi、不碰 ~/.nomi、不花钱）。
//
// 有意改变的行为不在这里钉旧值，而是钉**两边都必须成立的不变量**（例如「不支持的协议版本绝不被原样协商成功」），
// 改了什么写在设计卡「行为差异」一节。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MCP_APP_MIME_TYPE, NOMI_LIVE_DRAFT_UI_URI } from './mcpAppWidget'
import { bridgeStdioToHttp } from './mcpHttpBridge'
import { mcpHttpIdentityHeaders } from './mcpHttpEndpoint'
import { startMcpHttpServer, type McpHttpServerHandle } from './mcpHttpServer'
import { createMcpProtocol, createNomiMcpServer, MCP_REQUEST_SIGNAL, type McpHost } from './mcpProtocol'
import { ensureToken, signMcpClient } from './security'
import { MCP_TOOL_RESOLVER } from './mcpToolCatalog'
import { registerProductionPlaybook } from '../productionRun/productionPlaybooks'
import { measureMcpToolsListPayloadByLocale } from '../../scripts/mcp-payload.mjs'

type WireFrame = Record<string, unknown> & { id?: unknown; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string; data?: unknown } }
type WireInvoke = (method: string, params: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>

/** 领域那一侧（Nomi 自己）。结构上与协议层的宿主口一致，但不 import 它——换实现时这里不动。 */
type McpWireHost = {
  invoke: WireInvoke
  invokeIfOpen?: WireInvoke
  isAppOpen(): boolean
  getAuthenticatedClient?(): string | null
  verifyClientGenerationConfirmation?(challenge: unknown, attestation: unknown): Promise<unknown>
  confirmGenerationInNomi?(challenge: unknown): Promise<unknown>
  getLocale?(): 'zh-CN' | 'en'
}

type McpWireConnection = {
  /** 客户端 → 服务端的一帧。 */
  deliver(frame: WireFrame): void
  /** 断开连接（stdio 关 stdin / HTTP 关会话）。 */
  close(): Promise<void>
  /** 握手完成后传输自己还要准备的事（HTTP：宿主那条接收服务端通知的独立流要先建起来）。 */
  afterInitialized?(): Promise<void>
}

/** 传输自带、规范规定的差异（不是实现差异）。 */
type McpWireTraits = Readonly<{
  /** Streamable HTTP 有会话：规范要求先 initialize 拿会话号，未握手的请求一律 400。 */
  sessionRequiresInitialize?: boolean
}>

/** 一种「协议实现 × 传输」。emit 收服务端发出的每一帧。 */
type McpWireConnector = (host: McpWireHost, emit: (frame: WireFrame) => void) => McpWireConnection

/** 领域那一侧拿到的取消信号：协议层把它挂在 params 上递下去（见 MCP_REQUEST_SIGNAL）。 */
type McpWireSignalOf = (params: Record<string, unknown>) => AbortSignal | undefined

const RUN_ARGS = { projectId: 'project-1', playbook: 'brand.promo', brief: { goal: '一只猫的短片' } }
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const

async function until<T>(read: () => T | undefined, label: string): Promise<T> {
  return vi.waitFor(() => {
    const value = read()
    if (value === undefined) throw new Error(`还没等到：${label}`)
    return value
  }, { timeout: 3000, interval: 2 })
}

/** 让在途的微任务、setImmediate 都跑完——用来断言「什么都没发生」。 */
async function settle(rounds = 20): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await new Promise<void>((resolve) => setImmediate(resolve))
}

type ServerRequestAnswer = (frame: WireFrame) => Record<string, unknown> | undefined

/** 假 MCP 客户端：记下服务端每一帧；服务端向客户端发请求（elicitation/create）时按 answer 回。 */
class WireClient {
  readonly frames: WireFrame[] = []
  answer: ServerRequestAnswer = () => undefined
  readonly connection: McpWireConnection
  private nextId = 1000

  constructor(connector: McpWireConnector, host: McpWireHost) {
    this.connection = connector(host, (frame) => {
      this.frames.push(frame)
      if (typeof frame.method === 'string' && frame.id !== undefined && frame.id !== null) {
        const result = this.answer(frame)
        if (result) this.connection.deliver({ jsonrpc: '2.0', id: frame.id, result })
      }
    })
  }

  responseTo(id: unknown): WireFrame | undefined {
    return this.frames.find((frame) => frame.method === undefined && frame.id === id)
  }

  send(frame: WireFrame): void {
    this.connection.deliver({ jsonrpc: '2.0', ...frame })
  }

  async request(method: string, params: Record<string, unknown> = {}, id: number = this.nextId += 1): Promise<WireFrame> {
    this.send({ id, method, params })
    return until(() => this.responseTo(id), `${method}#${id} 的响应`)
  }

  async initialize(capabilities: Record<string, unknown> = {}, protocolVersion = '2025-11-25'): Promise<WireFrame> {
    const response = await this.request('initialize', { protocolVersion, capabilities, clientInfo: { name: 'wire-contract-client', version: '1.0.0' } })
    this.send({ method: 'notifications/initialized' })
    await this.connection.afterInitialized?.()
    return response
  }

  async call(name: string, args: Record<string, unknown>, meta?: Record<string, unknown>): Promise<WireFrame> {
    return this.request('tools/call', { name, arguments: args, ...(meta ? { _meta: meta } : {}) })
  }

  notifications(method: string): WireFrame[] {
    return this.frames.filter((frame) => frame.method === method && (frame.id === undefined || frame.id === null))
  }

  serverRequests(method: string): WireFrame[] {
    return this.frames.filter((frame) => frame.method === method && frame.id !== undefined && frame.id !== null)
  }
}

type HostCall = { method: string; params: Record<string, unknown>; options?: Record<string, unknown> }

function fakeHost(handlers: Record<string, (params: Record<string, unknown>) => unknown> = {}, overrides: Partial<McpWireHost> = {}) {
  const calls: HostCall[] = []
  const invoke = vi.fn(async (method: string, params: Record<string, unknown>, options?: Record<string, unknown>) => {
    calls.push({ method, params, ...(options ? { options } : {}) })
    const handler = handlers[method]
    if (!handler) throw new Error(`假宿主没准备 ${method}`)
    return handler(params)
  })
  const host: McpWireHost = { invoke, isAppOpen: () => false, getLocale: () => 'zh-CN', ...overrides }
  return { host, calls, invoke }
}

function resultOf(frame: WireFrame): Record<string, unknown> {
  expect(frame.error, JSON.stringify(frame.error)).toBeUndefined()
  return frame.result as Record<string, unknown>
}

function outcomeOf(frame: WireFrame): Record<string, unknown> {
  return ((resultOf(frame).structuredContent as Record<string, unknown> | undefined)?.nomiOutcome ?? {}) as Record<string, unknown>
}

/** tools/list 的线上形状（规范 + Nomi 的约定），由目录独立推出：一字节都不许因换协议层而变。 */
function expectedToolsList(locale: 'zh-CN' | 'en'): unknown {
  return {
    tools: (MCP_TOOL_RESOLVER.list() as unknown as Array<Record<string, unknown>>).map((tool) => {
      const titles = tool.titleByLocale as Record<string, string> | undefined
      const selected = titles?.[locale] ?? (tool.title as string | undefined)
      const base = {
        name: tool.name,
        ...(typeof selected === 'string' && selected.length > 0 ? { title: selected } : {}),
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      }
      if (tool.name !== 'nomi_run_start' && tool.name !== 'nomi_read') return base
      return {
        ...base,
        _meta: {
          ui: { resourceUri: NOMI_LIVE_DRAFT_UI_URI },
          'openai/outputTemplate': NOMI_LIVE_DRAFT_UI_URI,
          'openai/toolInvocation/invoking': 'Nomi 生成中…',
          'openai/toolInvocation/invoked': '已出图',
        },
      }
    }),
  }
}

const challenge = {
  challengeId: 'challenge-1',
  model: 'fixture-model',
  costScope: 'single-shot',
  maximumCost: 1,
  currency: 'CNY',
  expiresAt: '2099-01-01T00:00:00.000Z',
  handoff: { challengeToken: 'challenge-token', contractHash: 'contract-hash' },
}

function defineMcpWireContract(label: string, connector: McpWireConnector, signalOf: McpWireSignalOf, traits: McpWireTraits = {}): void {
  describe(`MCP 协议边界特征（${label}）`, () => {
    const clients: WireClient[] = []
    const connect = (host: McpWireHost) => {
      const client = new WireClient(connector, host)
      clients.push(client)
      return client
    }
    afterEach(async () => {
      while (clients.length) await clients.pop()!.connection.close()
    })

    describe('initialize 握手与版本协商', () => {
      it.each(LEGACY_VERSIONS)('原样协商受支持的 %s，并广告工具 / 资源 / 提示三种能力', async (version) => {
        const client = connect(fakeHost().host)
        const result = resultOf(await client.initialize({}, version))
        expect(result.protocolVersion).toBe(version)
        expect(result.capabilities).toEqual({ tools: { listChanged: true }, resources: {}, prompts: {} })
        expect(result.serverInfo).toEqual({ name: 'nomi-capability-core', version: '0.1.0' })
        expect(String(result.instructions)).toContain('nomi_*')
      })

      it.each(['2099-01-01', '2026-07-28'])('不支持（或尚未放开）的 %s 绝不被原样协商成功', async (version) => {
        const client = connect(fakeHost().host)
        const response = await client.initialize({}, version)
        if (response.error) {
          expect(response.error.code).toBe(-32602)
        } else {
          expect(LEGACY_VERSIONS).toContain(resultOf(response).protocolVersion)
        }
      })

      it('ping 回空对象，探测类请求不触达领域', async () => {
        const { host, invoke } = fakeHost()
        const client = connect(host)
        await client.initialize()
        expect(resultOf(await client.request('ping'))).toEqual({})
        expect(invoke).not.toHaveBeenCalled()
      })
    })

    describe('tools/list', () => {
      it.each(['zh-CN', 'en'] as const)('线上字节与目录推出的形状逐字节一致（%s）', async (locale) => {
        const { host, invoke } = fakeHost({}, { getLocale: () => locale })
        const client = connect(host)
        await client.initialize()
        const listed = resultOf(await client.request('tools/list'))
        expect(JSON.stringify(listed)).toBe(JSON.stringify(expectedToolsList(locale)))
        // 与 check:mcp-payload 的量法同源：四个字段的投影字节 = 门岗量到的字节。
        const projected = { tools: (listed.tools as Array<Record<string, unknown>>).map(({ name, title, description, inputSchema }) => ({ name, ...(title ? { title } : {}), description, inputSchema })) }
        expect(Buffer.byteLength(JSON.stringify(projected))).toBe(measureMcpToolsListPayloadByLocale(MCP_TOOL_RESOLVER.list())[locale])
        expect(invoke).not.toHaveBeenCalled()
      })

      // Streamable HTTP 按规范必须先握手拿会话号，这一条只对无会话的传输（stdio / 进程内）成立。
      it.skipIf(traits.sessionRequiresInitialize)('未握手也能列（宿主刷新工具列表不必先 initialize），且不触达领域', async () => {
        const { host, invoke } = fakeHost()
        const client = connect(host)
        const listed = resultOf(await client.request('tools/list'))
        expect((listed.tools as unknown[]).length).toBe(MCP_TOOL_RESOLVER.list().length)
        expect(invoke).not.toHaveBeenCalled()
      })
    })

    describe('tools/call', () => {
      it('正常调用：按工具的内部方法派发，结果带文本兜底与 nomiOutcome', async () => {
        const { host, calls } = fakeHost({ 'project.create': () => ({ projectId: 'project-1', name: 'demo' }) })
        const client = connect(host)
        await client.initialize()
        const result = resultOf(await client.call('nomi_project_create', { name: 'demo' }))
        expect(calls.map((call) => call.method)).toEqual(['project.create'])
        expect(calls[0].params).toMatchObject({ name: 'demo' })
        expect(result.isError).toBeFalsy()
        expect(Array.isArray(result.content) && (result.content as Array<{ type?: string }>)[0]?.type).toBe('text')
      })

      it('参数不合契约：工具级错误（isError + nomiOutcome），领域不被调用', async () => {
        const { host, invoke } = fakeHost()
        const client = connect(host)
        await client.initialize()
        const frame = await client.call('nomi_project_create', { name: 3 })
        const result = resultOf(frame)
        expect(result.isError).toBe(true)
        expect(outcomeOf(frame)).toMatchObject({ kind: 'error', tool: 'nomi_project_create', errorCode: 'capability_input_invalid' })
        expect(invoke).not.toHaveBeenCalled()
      })

      it('多余参数同样被拒在领域之外', async () => {
        const { host, invoke } = fakeHost()
        const client = connect(host)
        await client.initialize()
        const result = resultOf(await client.call('nomi_project_create', { name: 'x', surprise: true }))
        expect(result.isError).toBe(true)
        expect(invoke).not.toHaveBeenCalled()
      })

      it('整包参数被序列化成一段 JSON 文本（#547 真实模型的写法）：容忍钩子在校验前还原，照常派发', async () => {
        const { host, calls } = fakeHost({ 'document.read': () => { throw new Error('fixture stops after dispatch') } })
        const client = connect(host)
        await client.initialize()
        client.send({ id: 91, method: 'tools/call', params: { name: 'nomi_document_read', arguments: JSON.stringify({ leaseHandle: 'lease-1', scope: 'full' }) } })
        const frame = await until(() => client.responseTo(91), 'document_read 的响应')
        expect(frame.error).toBeUndefined()
        expect(calls.map((call) => call.method)).toEqual(['document.read'])
        expect(calls[0].params).toMatchObject({ leaseHandle: 'lease-1' })
      })

      it('未知工具：协议级 -32602，领域不被调用', async () => {
        const { host, invoke } = fakeHost()
        const client = connect(host)
        await client.initialize()
        const frame = await client.call('nomi_does_not_exist', {})
        expect(frame.error?.code).toBe(-32602)
        expect(frame.error?.message).toContain('nomi_does_not_exist')
        expect(invoke).not.toHaveBeenCalled()
      })

      it('领域抛错：工具级错误，不是协议级错误', async () => {
        const { host } = fakeHost({ 'project.create': () => { throw Object.assign(new Error('disk full'), { code: 'project_write_failed' }) } })
        const client = connect(host)
        await client.initialize()
        const result = resultOf(await client.call('nomi_project_create', { name: 'demo' }))
        expect(result.isError).toBe(true)
        expect(result.structuredContent).toBeDefined()
      })
    })

    describe('进度与取消', () => {
      it('长任务带 progressToken：先发真实阶段帧（同一 token、序号递增、不造总量），再回结果', async () => {
        let release: (value: unknown) => void = () => {}
        const { host } = fakeHost({ 'production.start': () => new Promise((resolve) => { release = resolve }) })
        const client = connect(host)
        await client.initialize()
        const pending = client.call('nomi_run_start', RUN_ARGS, { progressToken: 'tok-1' })
        const first = await until(() => client.notifications('notifications/progress')[0], '第一帧进度')
        expect(first.params).toMatchObject({ progressToken: 'tok-1', progress: 1 })
        expect(typeof first.params?.message).toBe('string')
        expect(first.params).not.toHaveProperty('total')
        release({ runId: 'run-1', status: 'running' })
        resultOf(await pending)
        const progress = client.notifications('notifications/progress').map((frame) => frame.params?.progress as number)
        expect(progress).toEqual([...progress].sort((a, b) => a - b))
      })

      it('非长任务、或客户端没要进度：不发进度帧', async () => {
        const { host } = fakeHost({ 'project.create': () => ({ projectId: 'p' }), 'production.start': () => ({ runId: 'r' }) })
        const client = connect(host)
        await client.initialize()
        await client.call('nomi_project_create', { name: 'x' }, { progressToken: 'tok-2' })
        await client.call('nomi_run_start', RUN_ARGS)
        expect(client.notifications('notifications/progress')).toEqual([])
      })

      it('notifications/cancelled：领域侧的信号被中止，且这条请求不再回任何响应', async () => {
        let seen: AbortSignal | undefined
        const { host } = fakeHost({ 'production.start': (params) => new Promise((_resolve, reject) => {
          seen = signalOf(params)
          seen?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }) })
        const client = connect(host)
        await client.initialize()
        client.send({ id: 77, method: 'tools/call', params: { name: 'nomi_run_start', arguments: RUN_ARGS } })
        await until(() => seen, '领域收到信号')
        client.send({ method: 'notifications/cancelled', params: { requestId: 77, reason: 'user stopped' } })
        await until(() => (seen?.aborted ? true : undefined), '信号被中止')
        await settle()
        expect(client.responseTo(77)).toBeUndefined()
      })

      it('断开连接：在途工作全部中止（别把付费生成留在后台跑）', async () => {
        let seen: AbortSignal | undefined
        const { host } = fakeHost({ 'production.start': (params) => new Promise(() => { seen = signalOf(params) }) })
        const client = connect(host)
        await client.initialize()
        client.send({ id: 78, method: 'tools/call', params: { name: 'nomi_run_start', arguments: RUN_ARGS } })
        await until(() => seen, '领域收到信号')
        await client.connection.close()
        expect(seen?.aborted).toBe(true)
      })
    })

    describe('elicitation', () => {
      const deleteArgs = { leaseHandle: 'lease-1', operation: 'delete_canvas_nodes', nodeIds: ['a', 'b'], reason: 'tidy' }

      it('确认（form）：先问人，accept 才派发且带确认标记', async () => {
        const { host, calls } = fakeHost({ 'canvas.delete': () => ({ operation: 'delete_canvas_nodes', applied: true, proposalId: 'proposal-1', deletedNodeIds: ['a', 'b'], reconciliation: { ok: true, deviationCount: 0 } }) })
        const client = connect(host)
        await client.initialize({ elicitation: {} })
        client.answer = (frame) => {
          expect(calls).toEqual([])
          const schema = frame.params?.requestedSchema as { properties?: Record<string, { type?: string }>; required?: string[] }
          expect(schema.properties?.confirm?.type).toBe('boolean')
          expect(schema.required).toEqual(['confirm'])
          return { action: 'accept', content: { confirm: true } }
        }
        const result = resultOf(await client.call('nomi_canvas_maintenance', deleteArgs))
        expect(result.isError).toBeFalsy()
        expect(client.serverRequests('elicitation/create')).toHaveLength(1)
        expect(calls.map((call) => call.method)).toEqual(['canvas.delete'])
        expect(calls[0].params).toMatchObject({ confirmation: true, nodeIds: ['a', 'b'] })
      })

      it('确认（form）：decline 不派发', async () => {
        const { host, invoke } = fakeHost()
        const client = connect(host)
        await client.initialize({ elicitation: {} })
        client.answer = () => ({ action: 'decline' })
        const result = resultOf(await client.call('nomi_canvas_maintenance', deleteArgs))
        expect(result.isError).toBe(true)
        expect(invoke).not.toHaveBeenCalled()
      })

      it('客户端没声明 elicitation：不发 elicitation/create，也不派发', async () => {
        const { host, invoke } = fakeHost()
        const client = connect(host)
        await client.initialize({})
        const result = resultOf(await client.call('nomi_canvas_maintenance', deleteArgs))
        expect(result.isError).toBe(true)
        expect(client.serverRequests('elicitation/create')).toEqual([])
        expect(invoke).not.toHaveBeenCalled()
      })

      it('凭据（url 模式）：只给链接不经客户端传密钥，保存后发 elicitation/complete', async () => {
        const credentialEntry = { url: 'http://127.0.0.1:43210/credential/abc', elicitationId: 'elicit-1', sessionId: 'session-1', display: { name: 'Relay' } }
        const { host } = fakeHost({
          'model.onboarding.setup': () => ({ ok: true, setupId: 'setup-1', state: { credentialEntry, config: { name: 'Relay' } } }),
          'integration.get': () => ({ credentialStatus: 'ready', config: { name: 'Relay' } }),
        })
        const client = connect(host)
        await client.initialize({ elicitation: { form: {}, url: {} } })
        client.answer = (frame) => {
          expect(frame.params).toMatchObject({ mode: 'url', url: credentialEntry.url, elicitationId: 'elicit-1' })
          expect(frame.params).not.toHaveProperty('requestedSchema')
          return { action: 'accept' }
        }
        const result = resultOf(await client.call('nomi_model_setup', { action: 'connect_provider', vendorKey: 'relay' }))
        expect(result.isError).toBeFalsy()
        expect(client.notifications('notifications/elicitation/complete').map((frame) => frame.params)).toEqual([{ elicitationId: 'elicit-1' }])
        expect(JSON.stringify(result)).not.toContain(credentialEntry.url)
      })

      it('凭据：只支持 form 的客户端绝不收到 url 模式请求', async () => {
        const credentialEntry = { url: 'http://127.0.0.1:43210/credential/abc', elicitationId: 'elicit-2', sessionId: 'session-2', display: { name: 'Relay' } }
        const { host } = fakeHost({ 'model.onboarding.setup': () => ({ ok: true, setupId: 'setup-2', state: { credentialEntry } }) })
        const client = connect(host)
        await client.initialize({ elicitation: {} })
        resultOf(await client.call('nomi_model_setup', { action: 'connect_provider', vendorKey: 'relay' }))
        expect(client.serverRequests('elicitation/create')).toEqual([])
      })
    })

    describe('付费审批在 tools/call 内的拦截时机', () => {
      const gateArgs = { leaseHandle: 'lease-1', operationId: 'operation-1', phase: 'request' }
      const gateHandlers = {
        nomi_request_generation_gate: () => challenge,
        nomi_decide_generation_gate: () => ({ approved: true, leaseHandle: 'lease-2' }),
        nomi_start_generation: () => ({ started: true }),
      }

      it('问人时还没有任何付费派发；accept + 主进程收据后才 decide → start', async () => {
        const verify = vi.fn(async () => ({ confirmed: true, receiptId: 'receipt-1', receiptToken: 'receipt-token' }))
        const { host, calls } = fakeHost(gateHandlers, { getAuthenticatedClient: () => 'codex', verifyClientGenerationConfirmation: verify })
        const client = connect(host)
        await client.initialize({ elicitation: {} })
        let callsWhenAsked: string[] = []
        client.answer = () => {
          callsWhenAsked = calls.map((call) => call.method)
          return { action: 'accept', content: { confirm: true } }
        }
        const result = resultOf(await client.call('nomi_operation_gate', gateArgs))
        expect(result.isError).toBeFalsy()
        expect(callsWhenAsked).toEqual(['nomi_request_generation_gate'])
        expect(calls.map((call) => call.method)).toEqual(['nomi_request_generation_gate', 'nomi_decide_generation_gate', 'nomi_start_generation'])
        expect(calls[2].params).toMatchObject({ receiptId: 'receipt-1', receiptToken: 'receipt-token', leaseHandle: 'lease-2' })
        expect(verify).toHaveBeenCalledTimes(1)
      })

      it('decline：只发了挑战，决不 decide / start', async () => {
        const { host, calls } = fakeHost(gateHandlers, { getAuthenticatedClient: () => 'codex', verifyClientGenerationConfirmation: async () => ({ confirmed: true, receiptId: 'r' }) })
        const client = connect(host)
        await client.initialize({ elicitation: {} })
        client.answer = () => ({ action: 'decline' })
        const frame = await client.call('nomi_operation_gate', gateArgs)
        expect(resultOf(frame).isError).toBe(true)
        expect(outcomeOf(frame)).toMatchObject({ errorCode: 'human_approval_required' })
        expect(calls.map((call) => call.method)).toEqual(['nomi_request_generation_gate'])
      })

      it('客户端问不了、Nomi 也没开：不花钱，如实回「去 Nomi 确认」', async () => {
        const { host, calls } = fakeHost(gateHandlers, { getAuthenticatedClient: () => 'codex' })
        const client = connect(host)
        await client.initialize({})
        const frame = await client.call('nomi_operation_gate', gateArgs)
        expect(resultOf(frame).isError).toBe(true)
        expect(calls.map((call) => call.method)).toEqual(['nomi_request_generation_gate'])
        expect(client.serverRequests('elicitation/create')).toEqual([])
      })
    })

    describe('未验证客户端在共享协议边界被拒', () => {
      it.each(['initialize', 'tools/list', 'tools/call', 'resources/list', 'prompts/list', 'ping'])('%s → -32001，领域一次都不被触达', async (method) => {
        const { host, invoke } = fakeHost({}, { getAuthenticatedClient: () => null })
        const probe = vi.fn(async () => ({ skills: [] }))
        const client = connect({ ...host, invokeIfOpen: probe })
        const params = method === 'initialize'
          ? { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } }
          : method === 'tools/call' ? { name: 'nomi_project_create', arguments: { name: 'x' } } : {}
        const frame = await client.request(method, params)
        expect(frame.error?.code).toBe(-32001)
        expect(frame.error?.data).toMatchObject({ code: expect.any(String) })
        expect(invoke).not.toHaveBeenCalled()
        expect(probe).not.toHaveBeenCalled()
      })
    })

    describe('MCP Apps 内嵌 widget', () => {
      it('tools/call nomi_run_start 的结果带 _meta.ui 与 nomiRun；资源可读', async () => {
        const { host } = fakeHost({ 'production.start': () => ({ runId: 'run-1', status: 'running' }) })
        const client = connect(host)
        await client.initialize()
        const result = resultOf(await client.call('nomi_run_start', RUN_ARGS))
        expect(result._meta).toEqual({ ui: { resourceUri: NOMI_LIVE_DRAFT_UI_URI }, 'openai/outputTemplate': NOMI_LIVE_DRAFT_UI_URI })
        expect((result.structuredContent as Record<string, unknown>).nomiRun).toBeDefined()

        const listed = resultOf(await client.request('resources/list'))
        expect(listed.resources).toEqual(expect.arrayContaining([expect.objectContaining({ uri: NOMI_LIVE_DRAFT_UI_URI, mimeType: MCP_APP_MIME_TYPE })]))
        const read = resultOf(await client.request('resources/read', { uri: NOMI_LIVE_DRAFT_UI_URI }))
        const [content] = read.contents as Array<{ uri: string; mimeType: string; text: string }>
        expect(content).toMatchObject({ uri: NOMI_LIVE_DRAFT_UI_URI, mimeType: MCP_APP_MIME_TYPE })
        expect(crypto.createHash('sha256').update(content.text).digest('hex')).toHaveLength(64)
        expect(content.text).toContain('<')
      })

      it('非 run 数据的工具结果不挂 widget', async () => {
        const { host } = fakeHost({ 'project.create': () => ({ projectId: 'p' }) })
        const client = connect(host)
        await client.initialize()
        expect(resultOf(await client.call('nomi_project_create', { name: 'x' }))._meta).toBeUndefined()
      })

      it('未知资源：协议级 -32602', async () => {
        const client = connect(fakeHost().host)
        await client.initialize()
        const frame = await client.request('resources/read', { uri: 'nomi://nowhere/x' })
        expect(frame.error?.code).toBe(-32602)
      })
    })

    describe('notifications/tools/list_changed', () => {
      it('已握手的会话在目录变化时收到通知；未握手的不收', async () => {
        const quiet = connect(fakeHost().host)
        const active = connect(fakeHost().host)
        await active.initialize()
        const before = active.notifications('notifications/tools/list_changed').length
        registerProductionPlaybook({
          name: `mcp.wire-contract-${label}`,
          stages: [{ stageId: 'brief', title: 'Brief' }, { stageId: 'direction', title: 'Direction' }],
          briefStageId: 'brief',
          directionStageId: 'direction',
        })
        await until(() => (active.notifications('notifications/tools/list_changed').length > before ? true : undefined), 'list_changed 通知')
        await settle()
        expect(quiet.notifications('notifications/tools/list_changed')).toEqual([])
      })
    })
  })
}

// ── 连接器：同一组用例跑在每一种「协议实现 × 传输」上。第 2 段把本机 HTTP 加进这张表。 ──────────

const signalOf: McpWireSignalOf = (params) => (params as Record<PropertyKey, unknown>)[MCP_REQUEST_SIGNAL] as AbortSignal | undefined

/** 进程内：SDK Server 经 SDK 的内存传输帧进帧出（单测与门岗脚本用的那条）。 */
const inProcess: McpWireConnector = (host, emit) => {
  const protocol = createMcpProtocol({ ...(host as unknown as McpHost), send: (frame) => emit(frame as WireFrame) })
  return {
    deliver: (frame) => protocol.handleIncoming(frame),
    close: async () => { await protocol.cancelAllInFlight('wire contract disconnect') },
  }
}

/** 真 stdio 管道：两个生产入口用的同一个 StdioServerTransport，接在一对内存流上（换行分帧、stdin 结束即断连）。 */
const stdioPipe: McpWireConnector = (host, emit) => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let buffered = ''
  stdout.setEncoding('utf8')
  stdout.on('data', (chunk: string) => {
    buffered += chunk
    for (let newline = buffered.indexOf('\n'); newline >= 0; newline = buffered.indexOf('\n')) {
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      if (line.trim()) emit(JSON.parse(line) as WireFrame)
    }
  })
  const mcp = createNomiMcpServer(host as unknown as McpHost)
  const closed = new Promise<void>((resolve) => mcp.onClose(() => resolve()))
  const connected = mcp.connect(new StdioServerTransport(stdin, stdout))
  return {
    deliver: (frame) => { void connected.then(() => stdin.write(`${JSON.stringify(frame)}\n`)) },
    close: async () => {
      await connected
      stdin.end()
      await closed
    },
  }
}

// ── 本机 HTTP（第 2 段）：真的 Streamable HTTP 服务端（只听 127.0.0.1）+ SDK 的 HTTP 客户端传输；身份走真签名。 ──
// capability 目录指到临时目录：签名用的 token 是这一次新铸的，不碰 ~/.nomi。
const capabilityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-wire-'))
beforeEach(() => {
  vi.stubEnv("NOMI_CAPABILITY_DIR", capabilityRoot)
  ensureToken()
})
const HTTP_CLIENT = 'codex'

/** 起一个只服务这次连接的 HTTP 端点；宿主口照用这组用例的假宿主，认人结果换成真签名认出来的那个人。 */
function startWireHttpServer(host: McpWireHost): Promise<McpHttpServerHandle> {
  return startMcpHttpServer({
    port: 0,
    sessionFor: (identity) => createNomiMcpServer({ ...(host as unknown as McpHost), getAuthenticatedClient: () => identity.connection.authenticatedClient }),
  })
}

/**
 * 宿主侧的 HTTP 客户端传输。未验证用例（假宿主报 getAuthenticatedClient → null）就不带身份头。
 * 包一层 fetch 只为知道「接收服务端通知的独立 GET 流」什么时候建好——SDK 在发出 initialized 之后自己去建，
 * 建好之前服务端发的 list_changed 没有地方投递（规范行为，不是 Nomi 的）。
 */
function wireHttpClient(host: McpWireHost, url: string) {
  const authenticated = host.getAuthenticatedClient?.() !== null
  let streamOpened!: () => void
  const listening = new Promise<void>((resolve) => { streamOpened = resolve })
  const observedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init)
    if ((init?.method ?? 'GET') === 'GET' && response.ok) streamOpened()
    return response
  }
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: authenticated ? mcpHttpIdentityHeaders(HTTP_CLIENT, signMcpClient(HTTP_CLIENT) ?? '') : {} },
    fetch: observedFetch,
  })
  return { transport, listening: () => vi.waitFor(() => listening, { timeout: 3000 }) }
}

const httpDirect: McpWireConnector = (host, emit) => {
  const ready = startWireHttpServer(host).then(async (server) => {
    const client = wireHttpClient(host, server.url)
    const initializeIds = new Set<unknown>()
    client.transport.onmessage = (message) => {
      const frame = message as WireFrame
      if (initializeIds.delete(frame.id) && frame.result) client.transport.setProtocolVersion(String((frame.result as { protocolVersion?: unknown }).protocolVersion))
      emit(frame)
    }
    await client.transport.start()
    return { server, client, initializeIds }
  })
  return {
    deliver: (frame) => {
      void ready.then(({ client, initializeIds }) => {
        if (frame.method === 'initialize') initializeIds.add(frame.id)
        return client.transport.send(frame as never)
      }).catch(() => {})
    },
    afterInitialized: async () => { await (await ready).client.listening() },
    close: async () => {
      const { server, client } = await ready
      await client.transport.terminateSession().catch(() => {})
      await client.transport.close()
      await server.close()
    },
  }
}

/** Desktop 转发口：宿主（stdio）→ 转发桥 → 本机 HTTP。用例经 stdio 管道说话，桥里不认任何领域。 */
const desktopForwarder: McpWireConnector = (host, emit) => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let buffered = ''
  stdout.setEncoding('utf8')
  stdout.on('data', (chunk: string) => {
    buffered += chunk
    for (let newline = buffered.indexOf('\n'); newline >= 0; newline = buffered.indexOf('\n')) {
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      if (line.trim()) emit(JSON.parse(line) as WireFrame)
    }
  })
  const ready = startWireHttpServer(host).then((server) => {
    const client = wireHttpClient(host, server.url)
    const bridged = bridgeStdioToHttp(new StdioServerTransport(stdin, stdout), client.transport)
    return { server, client, bridged }
  })
  return {
    deliver: (frame) => { void ready.then(() => stdin.write(`${JSON.stringify(frame)}\n`)) },
    afterInitialized: async () => { await (await ready).client.listening() },
    close: async () => {
      const { server, bridged } = await ready
      stdin.end()
      await bridged
      await server.close()
    },
  }
}

defineMcpWireContract('进程内', inProcess, signalOf)
defineMcpWireContract('stdio 管道', stdioPipe, signalOf)
defineMcpWireContract('本机 HTTP', httpDirect, signalOf, { sessionRequiresInitialize: true })
defineMcpWireContract('Desktop 转发口（stdio→HTTP）', desktopForwarder, signalOf, { sessionRequiresInitialize: true })
