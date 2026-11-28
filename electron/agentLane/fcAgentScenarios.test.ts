// 0.25 切版 3.3b（F-C）：Agent 对话 8 类真实反馈场景端到端回归与单点收口矩阵。
// 覆盖：
//   · 场景 1 & 2：导演 stage_shot 入参 edits.0.value.{kind,window} 与 /shots/<id>/window schema
//   · 场景 3：wan-… 家族同义词与档案 variants 模型解析
//   · 场景 4：工具单步超时竞态（子阶段超时先于 laneTools 死锁护栏落定）
//   · 场景 5：单次输出长度上限截断（stopReason === 'length' / max_tokens / max_output_tokens）双轨提示与上下文保留
//   · 场景 6：HTTP 200 SSE 流内报错（OpenAI Chat / OpenAI Responses / Anthropic Messages）结构化载荷与抹密
//   · 场景 7：通用协议 invalid_request_error 对话侧与生成侧同源归类（含 401 invalid_api_key 反例）
//   · 场景 8：通用协议 context_length_exceeded / request_too_large 对话侧与生成侧同源归类（含 413 素材超限与 fail-closed 反例）
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import i18n from '../../src/i18n'
import { enAgentResident, zhAgentResident } from '../../src/i18n/locales/agentResident'
import { enGenerationCommon, zhGenerationCommon } from '../../src/i18n/locales/generationCommon'
import { classifyGenerationError } from '../../src/workbench/observability/classifyError'
import { providerFailureIsUnclassified, providerFailureText } from '../../src/workbench/ai/lane/laneCommandFailure'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { nomiModelConfigFor } from '../ai/vendorModelConnection'
import type { Model, Vendor } from '../catalog/types'
import { createMainCapabilityExecutorRegistry } from '../capabilityCore/capabilityExecutorRegistry'
import { createInternalDocumentReadVerifiedInvocationFactory } from '../capabilityCore/verifiedCapabilityInvocation'
import { resolveModelHandle, resolvedModelNameOf } from '../shared/agentCapabilities/modelHandle'
import { MODEL_TOOL_READ_TIMEOUT_MS_VALUE } from '../shared/agentCapabilities/verbDeclaration'
import { LANE_VENDOR_FAILURE_DIAGNOSTIC, laneVendorFailureText } from '../shared/agentLane/laneAssistantFault'
import { parseDirectorPlan } from '../shared/director/directorPlanSchema'
import { applyDirectorPlanEdits, directorPlanRevision } from '../shared/director/planPatch'
import { decideGenerationFailure, parseVendorErrorFromMessage } from '../shared/generationFailure'
import { tagNomiError } from '../shared/nomiErrorCodes'
import { categorizeVendorFailure } from '../shared/vendorFailure'
import { createCanvasLaneTools } from './laneCanvasTools'
import { openLane } from './laneHost.mjs'
import { callModelOnce } from './laneModelCall.mjs'
import type { LaneToolDescriptor } from './laneRuntimePort'
import { createLaneTools, takeLaneToolFailure } from './laneTools.mts'
import { createDocumentLaneTools } from './laneDocumentTools'

const tempDirs: string[] = []
const servers = new Set<http.Server>()

afterEach(async () => {
  takeLaneToolFailure('fc-timeout-call')
  vi.restoreAllMocks()
  vi.useRealTimers()
  await i18n.changeLanguage('zh-CN')
  await Promise.all([...servers].map((srv) => new Promise<void>((resolve) => srv.close(() => resolve()))))
  servers.clear()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const tCurrent = (key: string, options?: Record<string, unknown>) => String(i18n.t(key as never, options as never))

async function renderBothLocales(raw: string, facts?: Parameters<typeof providerFailureText>[2]) {
  await i18n.changeLanguage('zh-CN')
  const zh = providerFailureText(raw, tCurrent, facts)
  await i18n.changeLanguage('en')
  const en = providerFailureText(raw, tCurrent, facts)
  await i18n.changeLanguage('zh-CN')
  return { zh, en }
}

type RawSseHandler = (req: http.IncomingMessage, body: Record<string, unknown>, res: http.ServerResponse, index: number) => void

async function startRawServer(handler: RawSseHandler) {
  const requests: Array<{ path: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }> = []
  const sockets = new Set<import('node:net').Socket>()
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      requests.push({ path: req.url || '', headers: req.headers, body })
      handler(req, body, res, requests.length - 1)
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  servers.add(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { origin, baseURL: `${origin}/v1`, requests }
}

function modelConfigForProtocol(
  origin: string,
  protocol: 'openai-compatible' | 'openai-responses' | 'anthropic',
  apiKey = 'sk-fc-secret-token',
  meta?: Record<string, unknown>,
) {
  const vendor = {
    key: 'fixture-vendor',
    baseUrlHint: protocol === 'anthropic' ? `${origin}/v1` : `${origin}/v1`,
    providerKind: protocol,
    authType: 'bearer',
  } as unknown as Vendor
  const model = {
    modelKey: 'fixture-model',
    kind: 'text',
    ...(meta ? { meta } : {}),
  } as unknown as Model
  return nomiModelConfigFor(vendor, model, apiKey)
}

describe('F-C · 场景 1–4 前序闭合防线对账', () => {
  const DIRECTOR_BASE = {
    scene: { environment: 'day', template: 'room', tags: ['室内'] },
    actors: [{ id: 'lead', kind: 'person', desc: '主角', placement: { relation: 'at', ref: 's1-room-floor' } }],
    shots: [{ id: 's1', window: [0, 3], transitionIn: 'cut', subject: 'lead', size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } }],
  }

  it('场景 1：stage_shot 入参 edits.0.value.kind（运镜对象）与新增镜头的 value.window 完整通过 schema 与补丁应用', () => {
    const parsedPlan = parseDirectorPlan(DIRECTOR_BASE)
    expect(parsedPlan.success).toBe(true)
    if (!parsedPlan.success) return
    const tools = createCanvasLaneTools({
      read: async () => ({ nodes: [], edges: [], groups: [], selectedNodeIds: [] }),
      write: async () => { throw new Error('unused') },
      writeDirector: async () => { throw new Error('unused') },
    })
    const stageShot = tools.find((candidate) => candidate.name === 'stage_shot')!
    const baseRevision = directorPlanRevision(parsedPlan.data)

    const moveEdit = { op: 'replace' as const, path: '/shots/s1/move', value: { kind: 'pan', direction: 'left' } }
    const addShotEdit = {
      op: 'add' as const,
      path: '/shots/s2',
      value: { window: [3, 6], transitionIn: 'cut', subject: 'lead', size: '近景', angle: 'front', height: 'eye', move: { kind: 'static' } },
    }
    const parsedArgs = stageShot.schema.safeParse({
      target: { directorNodeId: 'node-director' },
      baseRevision,
      edits: [moveEdit, addShotEdit],
    })
    expect(parsedArgs.success).toBe(true)
    if (!parsedArgs.success) return
    const patched = applyDirectorPlanEdits(parsedPlan.data, parsedArgs.data.edits!)
    expect(patched.ok).toBe(true)
    if (patched.ok) {
      expect(patched.plan.shots[0]?.move).toMatchObject({ kind: 'pan', direction: 'left' })
      expect(patched.plan.shots[1]?.window).toEqual([3, 6])
    }
  })

  it('场景 2：stage_shot 入参 /shots/<id>/window 元组 [start, end] 在 schema 与 applyDirectorPlanEdits 中闭合', () => {
    const parsedPlan = parseDirectorPlan(DIRECTOR_BASE)
    expect(parsedPlan.success).toBe(true)
    if (!parsedPlan.success) return
    const tools = createCanvasLaneTools({
      read: async () => ({ nodes: [], edges: [], groups: [], selectedNodeIds: [] }),
      write: async () => { throw new Error('unused') },
      writeDirector: async () => { throw new Error('unused') },
    })
    const stageShot = tools.find((candidate) => candidate.name === 'stage_shot')!
    const baseRevision = directorPlanRevision(parsedPlan.data)
    const windowEdit = { op: 'replace' as const, path: '/shots/s1/window', value: [0.5, 4.5] }
    const parsedArgs = stageShot.schema.safeParse({
      target: { directorNodeId: 'node-director' },
      baseRevision,
      edits: [windowEdit],
    })
    expect(parsedArgs.success).toBe(true)
    const patched = applyDirectorPlanEdits(parsedPlan.data, [windowEdit])
    expect(patched.ok).toBe(true)
    if (patched.ok) expect(patched.plan.shots[0]?.window).toEqual([0.5, 4.5])
  })

  it('场景 3：wan-… 模型家族同义词与 variants 在单一模型解析入口闭合', () => {
    const catalog = [
      { vendor: 'apimart', modelId: 'wan2.7', archetypeId: 'wan-2.7' },
      { vendor: 'apimart', modelId: 'wan2.7-image-pro', archetypeId: 'wan2.7-image-pro' },
      { vendor: 'kie', modelId: 'wan/3-0-video', archetypeId: 'wan-3.0' },
    ]
    const r2v = resolveModelHandle(catalog, 'wan-2.7-r2v')
    expect(r2v).toMatchObject({ ok: true, handle: 'wan2.7@apimart', modeId: 'ref' })
    if (r2v.ok) expect(resolvedModelNameOf('wan-2.7-r2v', r2v)).toMatchObject({ model: 'wan2.7@apimart', modeId: 'ref' })

    expect(resolveModelHandle(catalog, 'wan-2.7-image-pro')).toMatchObject({ ok: true, handle: 'wan2.7-image-pro@apimart' })
    expect(resolveModelHandle(catalog, 'wan/3-0-video-prime@kie')).toMatchObject({ ok: true, handle: 'wan/3-0-video@kie', variantId: 'prime' })
  })

  it('场景 4：工具单步超时竞态 —— 能力执行器子阶段超时先于 laneTools 死锁护栏落定，不吞子阶段原因', async () => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('Deadline expired', 'TimeoutError')), ms)
      return controller.signal
    })
    const never = () => new Promise<never>(() => undefined)
    const invocation = await createInternalDocumentReadVerifiedInvocationFactory({
      verifyBearer: async () => true,
      resolveProjectIdentity: async () => ({
        projectId: 'project-fc',
        immutableProjectUuid: '00000000-0000-4000-8000-000000000099',
        projectGeneration: 1,
        canonicalRootPath: 'fixture-root',
        canonicalRootDigest: 'fixture-digest',
      }),
      randomId: () => 'op-fc-timeout',
    }).mint({ bearer: 'fixture', requestBody: { projectId: 'project-fc', documentId: 'doc-1', scope: 'selection' } })
    const registry = createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort: () => ({ read: never }),
      resolveDocumentReadPort: () => ({ read: never }),
    })
    const descriptor: LaneToolDescriptor = {
      contractId: 'document.read',
      name: 'read_script',
      description: 'Read script',
      promptSnippet: 'Read script',
      describe: { does: '', useWhen: '', notWhen: '', params: '' },
      examples: [],
      nextAction: 'none',
      effect: 'read',
      schema: z.object({}),
      execution: { timeoutMs: MODEL_TOOL_READ_TIMEOUT_MS_VALUE },
      execute: (_params, { signal }) => registry.execute(invocation, { signal }).then(() => ({ ok: true as const, text: 'ok' })),
    }
    const [tool] = createLaneTools([descriptor])
    const pending = tool.execute('fc-timeout-call', {}, undefined, () => undefined).catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(MODEL_TOOL_READ_TIMEOUT_MS_VALUE)
    const settled = await pending
    expect(settled).toBeInstanceOf(Error)
    expect((settled as Error).message).not.toContain('did not finish within')
    expect(takeLaneToolFailure('fc-timeout-call')?.code).not.toBe('tool_timeout')
  })
})

describe('F-C · 场景 5 单次输出长度上限截断（stopReason === length）收口', () => {
  it('场景 5a：未声明 maxOutputTokens 的模型在服务端 4096 上限截断纯文本回答 → 不误判上下文太长、保留已写正文、给出可操作继续/分段提示，且跟发「继续」可续写', async () => {
    const server = await startRawServer((_req, body, res, index) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const model = String(body.model || 'fixture-model')
      if (index === 0) {
        res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: { role: 'assistant', content: '第一部分分镜草稿' }, finish_reason: null }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 120, completion_tokens: 4096, total_tokens: 4216 } })}\n\n`)
        res.end('data: [DONE]\n\n')
        return
      }
      res.write(`data: ${JSON.stringify({ id: 'c2', object: 'chat.completion.chunk', created: 2, model, choices: [{ index: 0, delta: { role: 'assistant', content: '第二部分收尾完成。' }, finish_reason: null }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ id: 'c2', object: 'chat.completion.chunk', created: 2, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 20, total_tokens: 220 } })}\n\n`)
      res.end('data: [DONE]\n\n')
    })

    const projectDir = makeTempDir('nomi-fc-len-text-')
    tempDirs.push(projectDir)
    const lane = await openLane({
      fetch: globalThis.fetch,
      projectDir,
      systemPrompt: 'You are helpful.',
      model: modelConfigForProtocol(server.origin, 'openai-compatible'),
      tools: [],
    })
    try {
      await lane.execute({ kind: 'prompt', text: '请写完整长分镜' })
      expect(server.requests).toHaveLength(1)
      const firstProjection = lane.projection()
      const texts = firstProjection.parts.filter((part) => part.kind === 'assistant-text').map((part) => part.text)
      expect(texts).toEqual(['第一部分分镜草稿'])

      const errors = firstProjection.parts.filter((part) => part.kind === 'error')
      expect(errors).toHaveLength(1)
      const notice = errors[0]!
      expect(providerFailureIsUnclassified(notice.text, { transient: notice.transient, fault: notice.fault })).toBe(false)
      const expectedZh = zhAgentResident.faultOutputTruncated
      const expectedEn = enAgentResident.faultOutputTruncated
      expect(expectedZh).toBeTruthy()
      expect(expectedEn).toBeTruthy()
      const rendered = await renderBothLocales(notice.text, { transient: notice.transient, fault: notice.fault })
      expect(rendered.zh).toBe(expectedZh)
      expect(rendered.en).toBe(expectedEn)
      expect(rendered.zh).not.toBe(zhAgentResident.faultContextOverflow)
      expect(rendered.zh).not.toBe(zhAgentResident.providerUnknownError)

      await lane.execute({ kind: 'prompt', text: '继续' })
      expect(server.requests).toHaveLength(2)
      expect(JSON.stringify(server.requests[1]!.body)).toContain('第一部分分镜草稿')
    } finally {
      await lane.close()
    }
  })

  it.each(['anthropic', 'openai-compatible', 'openai-responses'] as const)(
    '场景 5b (%s)：未声明上限但在 4096 处截断带工具调用的回复 → 第 1 次即拦下半截工具调用、不误走上下文压缩、渲染工具截断人话且 unknown=0',
    async (protocol) => {
      let toolExecuted = false
      const server = await startRawServer((_req, body, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        const model = String(body.model || 'fixture-model')
        if (protocol === 'anthropic') {
          const sendEvent = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
          sendEvent('message_start', { message: { id: 'm1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 40, output_tokens: 0 } } })
          sendEvent('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'tc1', name: 'read_script', input: {} } })
          sendEvent('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } })
          sendEvent('content_block_stop', { index: 0 })
          sendEvent('message_delta', { delta: { stop_reason: 'max_tokens', stop_sequence: null }, usage: { output_tokens: 4096 } })
          sendEvent('message_stop', {})
          res.end()
          return
        }
        if (protocol === 'openai-responses') {
          const sendData = (data: Record<string, unknown>) => res.write(`data: ${JSON.stringify(data)}\n\n`)
          const item = { id: 'fc_tc1', type: 'function_call', status: 'completed', call_id: 'tc1', name: 'read_script', arguments: '{}' }
          sendData({ type: 'response.created', sequence_number: 0, response: { id: 'r1', status: 'in_progress', output: [] } })
          sendData({ type: 'response.output_item.added', sequence_number: 1, output_index: 0, item: { ...item, status: 'in_progress', arguments: '' } })
          sendData({ type: 'response.function_call_arguments.delta', sequence_number: 2, output_index: 0, item_id: 'fc_tc1', delta: '{}' })
          sendData({ type: 'response.output_item.done', sequence_number: 3, output_index: 0, item })
          sendData({
            type: 'response.incomplete',
            sequence_number: 4,
            response: { id: 'r1', status: 'incomplete', output: [item], incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 40, output_tokens: 4096, total_tokens: 4136 } },
          })
          res.end()
          return
        }
        res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'tc1', type: 'function', function: { name: 'read_script', arguments: '{}' } }] }, finish_reason: null }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 40, completion_tokens: 4096, total_tokens: 4136 } })}\n\n`)
        res.end('data: [DONE]\n\n')
      })

      const projectDir = makeTempDir(`nomi-fc-len-tool-${protocol}-`)
      tempDirs.push(projectDir)
      const docTools = createDocumentLaneTools({
        read: async () => {
          toolExecuted = true
          return { documentId: 'd1', title: 'T', content: 'body', revision: 1, contentHash: 'h', selection: null }
        },
        write: async () => { throw new Error('unused') },
      })
      const lane = await openLane({
        fetch: globalThis.fetch,
        projectDir,
        systemPrompt: 'Use tools.',
        model: modelConfigForProtocol(server.origin, protocol),
        tools: docTools,
      })
      try {
        await lane.execute({ kind: 'prompt', text: '读取剧本' })
        expect(toolExecuted).toBe(false)
        expect(server.requests).toHaveLength(1)
        const projection = lane.projection()
        expect(projection.parts.filter((part) => part.kind === 'tool-call')).toHaveLength(0)
        const errors = projection.parts.filter((part) => part.kind === 'error')
        expect(errors).toHaveLength(1)
        const errPart = errors[0]!
        expect(providerFailureIsUnclassified(errPart.text, { transient: errPart.transient, fault: errPart.fault })).toBe(false)
        const expectedZh = zhAgentResident.faultOutputTruncatedToolCall
        const expectedEn = enAgentResident.faultOutputTruncatedToolCall
        expect(expectedZh).toBeTruthy()
        expect(expectedEn).toBeTruthy()
        const rendered = await renderBothLocales(errPart.text, { transient: errPart.transient, fault: errPart.fault })
        expect(rendered.zh).toBe(expectedZh)
        expect(rendered.en).toBe(expectedEn)
      } finally {
        await lane.close()
      }
    },
  )
})

describe('F-C · 场景 6、7、8 流内报错与通用协议级错误码收口（unknown = 0）', () => {
  it('场景 6：HTTP 200 SSE 流内报错（Chat data.error / Responses response.failed & error & content_filter / Anthropic event: error）统一铸造脱敏结构化载荷且 unknown=0', async () => {
    const secretKey = 'sk-fc-live-secret-9988'
    const cases: ReadonlyArray<{
      label: string
      protocol: 'openai-compatible' | 'openai-responses' | 'anthropic'
      writeSse: (res: http.ServerResponse) => void
      expectedKind: string
      expectedReasonZh: string
      expectedReasonEn: string
    }> = [
      {
        label: 'OpenAI Chat SSE 200 server_error（含密钥回显）',
        protocol: 'openai-compatible',
        writeSse: (res) => {
          res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`)
          res.write(`data: ${JSON.stringify({ error: { message: `Upstream backend overloaded for ${secretKey}`, type: 'server_error', code: 'server_error' } })}\n\n`)
          res.end()
        },
        expectedKind: 'server',
        expectedReasonZh: zhGenerationCommon.observability.error.server.reason,
        expectedReasonEn: enGenerationCommon.observability.error.server.reason,
      },
      {
        label: 'OpenAI Responses SSE 200 response.failed',
        protocol: 'openai-responses',
        writeSse: (res) => {
          res.write(`data: ${JSON.stringify({ type: 'response.created', sequence_number: 0, response: { id: 'r1', status: 'in_progress', output: [] } })}\n\n`)
          res.write(`data: ${JSON.stringify({ type: 'response.failed', sequence_number: 1, response: { id: 'r1', status: 'failed', error: { code: 'server_error', message: 'The server had an error processing your request.' } } })}\n\n`)
          res.end()
        },
        expectedKind: 'server',
        expectedReasonZh: zhGenerationCommon.observability.error.server.reason,
        expectedReasonEn: enGenerationCommon.observability.error.server.reason,
      },
      {
        label: 'OpenAI Responses SSE 200 event error insufficient_quota',
        protocol: 'openai-responses',
        writeSse: (res) => {
          res.write(`data: ${JSON.stringify({ type: 'response.created', sequence_number: 0, response: { id: 'r1', status: 'in_progress', output: [] } })}\n\n`)
          res.write(`data: ${JSON.stringify({ type: 'error', sequence_number: 1, code: 'insufficient_quota', message: 'You exceeded your current quota.' })}\n\n`)
          res.end()
        },
        expectedKind: 'balance',
        expectedReasonZh: zhGenerationCommon.observability.error.balance.reason,
        expectedReasonEn: enGenerationCommon.observability.error.balance.reason,
      },
      {
        label: 'OpenAI Responses SSE 200 response.incomplete content_filter',
        protocol: 'openai-responses',
        writeSse: (res) => {
          res.write(`data: ${JSON.stringify({ type: 'response.created', sequence_number: 0, response: { id: 'r1', status: 'in_progress', output: [] } })}\n\n`)
          res.write(`data: ${JSON.stringify({ type: 'response.incomplete', sequence_number: 1, response: { id: 'r1', status: 'incomplete', output: [], incomplete_details: { reason: 'content_filter' } } })}\n\n`)
          res.end()
        },
        expectedKind: 'content-policy',
        expectedReasonZh: zhGenerationCommon.observability.error.contentPolicy.reason,
        expectedReasonEn: enGenerationCommon.observability.error.contentPolicy.reason,
      },
      {
        label: 'Anthropic Messages SSE 200 overloaded_error',
        protocol: 'anthropic',
        writeSse: (res) => {
          res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: 'fixture-model', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })}\n\n`)
          res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })}\n\n`)
          res.end()
        },
        expectedKind: 'server',
        expectedReasonZh: zhGenerationCommon.observability.error.server.reason,
        expectedReasonEn: enGenerationCommon.observability.error.server.reason,
      },
    ]

    for (const item of cases) {
      const server = await startRawServer((_req, _body, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        item.writeSse(res)
      })
      const { message } = await callModelOnce({
        model: modelConfigForProtocol(server.origin, item.protocol, secretKey),
        fetch: globalThis.fetch,
        content: '你好',
        signal: new AbortController().signal,
      })
      expect(message.stopReason, item.label).toBe('error')
      const diagnostics = (message.diagnostics ?? []).filter((d) => d.type === LANE_VENDOR_FAILURE_DIAGNOSTIC)
      expect(diagnostics, item.label).toHaveLength(1)
      const payload = laneVendorFailureText(message)!
      expect(payload, item.label).toBeTruthy()
      expect(payload, item.label).not.toContain(secretKey)
      expect(JSON.stringify(parseVendorErrorFromMessage(payload)), item.label).not.toContain(secretKey)

      const genDecision = classifyGenerationError(payload)
      expect(genDecision.kind, item.label).toBe(item.expectedKind)
      expect(providerFailureIsUnclassified(payload), item.label).toBe(false)

      const rendered = await renderBothLocales(payload)
      expect(rendered.zh, item.label).toContain(item.expectedReasonZh)
      expect(rendered.en, item.label).toContain(item.expectedReasonEn)
      expect(rendered.zh, item.label).not.toBe(zhAgentResident.providerUnknownError)
      expect(rendered.en, item.label).not.toBe(enAgentResident.providerUnknownError)
    }
  })

  it('场景 7：通用协议 invalid_request_error 在 HTTP 400 与 HTTP 200 SSE 下统一归入 input（对话侧与生成侧同源，401 invalid_api_key 反例不误伤）', async () => {
    const protocols: Array<{
      protocol: 'openai-compatible' | 'openai-responses' | 'anthropic'
      sseFrame: string
    }> = [
      {
        protocol: 'openai-compatible',
        sseFrame: `data: ${JSON.stringify({ error: { message: 'Unsupported parameter: top_k', type: 'invalid_request_error', param: 'top_k', code: null } })}\n\n`,
      },
      {
        protocol: 'openai-responses',
        sseFrame: `data: ${JSON.stringify({ type: 'error', sequence_number: 1, error: { type: 'invalid_request_error', message: 'Invalid tool schema definition' } })}\n\n`,
      },
      {
        protocol: 'anthropic',
        sseFrame: `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'messages.0.content: Field required' } })}\n\n`,
      },
    ]

    for (const entry of protocols) {
      const server = await startRawServer((_req, _body, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(entry.sseFrame)
        res.end()
      })
      const { message } = await callModelOnce({
        model: modelConfigForProtocol(server.origin, entry.protocol),
        fetch: globalThis.fetch,
        content: '测试参数错误',
        signal: new AbortController().signal,
      })
      const payload = laneVendorFailureText(message)!
      expect(payload, entry.protocol).toBeTruthy()
      expect(decideGenerationFailure({ message: payload, locale: 'zh-CN' }).kind, entry.protocol).toBe('input')
      expect(providerFailureIsUnclassified(payload), entry.protocol).toBe(false)
      const rendered = await renderBothLocales(payload)
      expect(rendered.zh, entry.protocol).toContain(zhGenerationCommon.observability.error.input.reason)
      expect(rendered.en, entry.protocol).toContain(enGenerationCommon.observability.error.input.reason)
    }

    // 反例防误伤：HTTP 401 虽然 type 也是 invalid_request_error，但必须保留为 auth
    expect(categorizeVendorFailure(401, undefined, { type: 'invalid_request_error', code: 'invalid_api_key' })).toEqual({
      category: 'auth',
      retryable: false,
    })
  })

  it('场景 8：通用协议 context_length_exceeded / request_too_large 在 HTTP 400、HTTP 413 与 HTTP 200 SSE 下统一给出上下文超长人话（不误报素材太大，无来源裸串继续 fail-closed）', async () => {
    // 8a: HTTP 200 SSE context_length_exceeded（消息体故意不用 pi 正则里的英文句式，验证只靠协议码也能命中）
    const sseServer = await startRawServer((_req, _body, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ error: { message: 'Conversation payload rejected by token window.', type: 'invalid_request_error', code: 'context_length_exceeded' } })}\n\n`)
      res.end()
    })
    const sseCall = await callModelOnce({
      model: modelConfigForProtocol(sseServer.origin, 'openai-compatible'),
      fetch: globalThis.fetch,
      content: '超长上下文',
      signal: new AbortController().signal,
    })
    const ssePayload = laneVendorFailureText(sseCall.message)!
    expect(ssePayload).toBeTruthy()
    expect(providerFailureIsUnclassified(ssePayload)).toBe(false)

    const expectedCtxZh = zhGenerationCommon.observability.error.contextLengthExceeded.reason
    const expectedCtxEn = enGenerationCommon.observability.error.contextLengthExceeded.reason
    expect(expectedCtxZh).toBeTruthy()
    expect(expectedCtxEn).toBeTruthy()

    const sseRendered = await renderBothLocales(ssePayload)
    expect(sseRendered.zh).toContain(expectedCtxZh)
    expect(sseRendered.en).toContain(expectedCtxEn)

    // 8b: Anthropic HTTP 413 request_too_large（验证对话侧与生成侧均报上下文超长，绝不误报「参考素材太大」）
    const http413Server = await startRawServer((_req, _body, res) => {
      res.writeHead(413, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'request_too_large', message: 'Request exceeds the maximum size' } }))
    })
    const http413Call = await callModelOnce({
      model: modelConfigForProtocol(http413Server.origin, 'anthropic'),
      fetch: globalThis.fetch,
      content: '超长请求体',
      signal: new AbortController().signal,
    })
    const payload413 = laneVendorFailureText(http413Call.message)!
    expect(payload413).toBeTruthy()
    const gen413 = classifyGenerationError(payload413)
    expect(gen413.kind).toBe('input')
    expect(gen413.reason).toBe(expectedCtxZh)
    expect(gen413.reason).not.toBe(zhGenerationCommon.observability.error.assetTooLarge.reason)
    const rendered413 = await renderBothLocales(payload413)
    expect(rendered413.zh).toContain(expectedCtxZh)
    expect(rendered413.en).toContain(expectedCtxEn)

    // 反例 1：真素材上传超限（带本机机器码 asset-too-large）仍归 asset-too-large
    expect(classifyGenerationError(tagNomiError('asset-too-large', 'HTTP 413')).kind).toBe('asset-too-large')

    // 反例 2：无 NOMI_VENDOR_ERR_B64 来源凭据的裸英文内部异常或原始 JSON 继续 fail-closed，绝不外露原文
    const rawUnprovenanced = '{"error":{"type":"invalid_request_error","message":"internal raw leak"}}'
    expect(providerFailureIsUnclassified(rawUnprovenanced)).toBe(true)
    const rawRendered = await renderBothLocales(rawUnprovenanced)
    expect(rawRendered.zh).toBe(zhAgentResident.providerUnknownError)
    expect(rawRendered.en).toBe(enAgentResident.providerUnknownError)
  })
})
