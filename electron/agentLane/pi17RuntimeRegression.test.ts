// pi 1.7.0 核心引擎端到端确定性回归套件：
//   1. `fauxProvider` + `Agent` + `SessionManager` v3 多轮流式推理、工具调用、`appendContextEdit` 旧读折叠、原生 `compact` 与中途 `abort`；
//   2. `@google/genai@3.6.1` 原生自定义 `fetch` 透传 + `googleGenerativeBaseUrl` `/v1beta` 归一 + 原生 PDF `inlineData` 注入；
//   3. Windows `powershell` 工具装配、毫秒超时换算与 `pi-schema@1.7.0` 严格入参边界拦截。
import fs from 'node:fs'
import { describe, expect, it, afterEach } from 'vitest'
import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core'
import {
  createInitialSystemMessage,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  toToolDeclaration,
} from '@earendil-works/pi-ai'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { injectPdfPayload } from '../ai/nativePdfPayload'
import { googleGenerativeBaseUrl, nomiModelConfigFor } from '../ai/vendorModelConnection'
import type { Model as CatalogModel, Vendor } from '../catalog/types'
import { createDocumentLaneTools } from './laneDocumentTools'
import {
  laneCompactionSettings,
  maybeCompactLaneSession,
  recordSupersededReadEdits,
  supersededReadNote,
} from './laneContextBudget.mts'
import { createLaneRepeatedFailureTracker } from './laneRepeatedFailure.mjs'
import { createLaneTurnBudget } from './laneTurnBudget.mjs'
import { createLaneToolInputBoundary } from './laneToolInputBoundary.mjs'
import { createLaneNativeAssembly } from './laneNativeAssembly.mts'
import { createNomiProvider } from './laneModelProvider.mjs'
import { openLaneSession } from './laneSession.mjs'
import { createLaneTools } from './laneTools.mts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('pi 1.7.0 runtime regression (fauxProvider + SessionManager v3 + Google fetch/PDF + Windows PowerShell)', () => {
  it('runs multi-turn streaming, tool calls, SessionManager.appendContextEdit, native compaction, and mid-tool abort via fauxProvider', async () => {
    const projectDir = makeTempDir('nomi-pi17-faux-')
    tempDirs.push(projectDir)

    let scriptVersion = 0
    const docSpecs = createDocumentLaneTools({
      read: async () => {
        scriptVersion += 1
        return { text: `SCENE_SNAPSHOT_V${scriptVersion}_` + '镜头细节。'.repeat(120) }
      },
      write: async () => ({ applied: true, revision: 2, contentHash: 'h2' }),
    })

    const faux = fauxProvider({
      provider: 'faux-test',
      models: [{ id: 'faux-1-7', reasoning: true, contextWindow: 128_000, maxTokens: 4_096 }],
    })
    const model = faux.getModel('faux-1-7')!
    const models = createModels()
    models.setProvider(faux.provider)

    const opened = await openLaneSession({ projectDir, laneName: 'main' })
    try {
      const { session } = opened
      const tools = createLaneTools(docSpecs)
      const streamFn: ConstructorParameters<typeof Agent>[0]['streamFn'] = (chosenModel, ctx, opts) =>
        models.streamSimple(chosenModel, ctx, opts)

      const buildAgentContext = () => {
        const nonSystem = session.buildSessionContext().messages.filter((m) => m.role !== 'system')
        const sys = createInitialSystemMessage('You are Nomi.', tools.map(toToolDeclaration))
        return {
          messages: sys ? [sys, ...nonSystem] : nonSystem,
          tools: [...tools],
        }
      }

      const agent = new Agent({
        initialState: {
          systemPrompt: 'You are Nomi.',
          model,
          thinkingLevel: 'low',
          tools: [...tools],
          messages: [],
        },
        streamFn,
        toolExecution: 'sequential',
        identity: { attribution: null },
        prepareRequest: async () => ({
          context: buildAgentContext(),
          model,
          thinkingLevel: 'low',
        }),
        prepareNextTurnWithContext: async (turnCtx) => ({
          ...turnCtx,
          context: buildAgentContext(),
          model,
          thinkingLevel: 'low',
        }),
        finishTurn: async (_turn, signal) => (signal?.aborted ? { action: 'end' as const } : undefined),
      })

      agent.subscribe(async (event) => {
        if (event.type === 'message_end' && event.message.role !== 'system') {
          const id = await session.appendMessage(event.message)
          if (event.message.role === 'toolResult') {
            await recordSupersededReadEdits(session, docSpecs, id)
          }
        }
      })

      // 1) Multi-turn tool calls + superseded read folding via native appendContextEdit
      let secondRequestContextText = ''
      let thirdRequestContextText = ''
      faux.setResponses([
        fauxAssistantMessage([
          fauxThinking('First read the script.'),
          fauxToolCall('read_script', {}, { id: 'call-read-1' }),
        ], { stopReason: 'toolUse' }),
        (ctx) => {
          secondRequestContextText = JSON.stringify(ctx.messages)
          return fauxAssistantMessage([
            fauxToolCall('read_script', { scope: 'full' }, { id: 'call-read-2' }),
          ], { stopReason: 'toolUse' })
        },
        (ctx) => {
          thirdRequestContextText = JSON.stringify(ctx.messages)
          return fauxAssistantMessage([fauxText('Both reads reconciled.')], { stopReason: 'stop' })
        },
      ])

      await session.appendMessage({ role: 'user', content: '核对剧本最新版本', timestamp: Date.now() })
      const initial = buildAgentContext()
      agent.state.tools = initial.tools
      agent.state.messages = initial.messages
      await agent.continue()
      await agent.waitForIdle()

      expect(faux.state.callCount).toBe(3)
      expect(secondRequestContextText).toContain('SCENE_SNAPSHOT_V1_')
      expect(thirdRequestContextText).not.toContain('SCENE_SNAPSHOT_V1_')
      expect(thirdRequestContextText).toContain('SCENE_SNAPSHOT_V2_')
      expect(thirdRequestContextText).toContain(supersededReadNote('read_script', 'call-read-2'))

      // Raw branch entries remain untouched while SessionManager projection carries the context_edit replacement.
      const rawTexts = session.branchEntries().flatMap((entry) =>
        entry.type === 'message' && entry.message.role === 'toolResult'
          ? [(entry.message.content[0] as { text: string }).text]
          : [])
      expect(rawTexts[0]).toContain('SCENE_SNAPSHOT_V1_')
      expect(rawTexts[1]).toContain('SCENE_SNAPSHOT_V2_')

      // 2) Native pi-coding-agent compaction (`force: true`)
      faux.setResponses([
        fauxAssistantMessage('Compacted summary: SCENE_SNAPSHOT_V2 verified, ready for next scene.'),
      ])
      const compacted = await maybeCompactLaneSession({
        session,
        model,
        streamFn,
        settings: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 20 },
        options: {
          fetch: globalThis.fetch,
          projectDir,
          systemPrompt: 'You are Nomi.',
          model: {
            kind: 'openai-compatible',
            providerId: 'faux-test',
            modelId: 'faux-1-7',
            baseURL: 'http://127.0.0.1:1/v1',
            authType: 'api-key',
            apiKey: 'k',
          },
          tools: docSpecs,
        },
        retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
        force: true,
      })
      expect(compacted).toBe(true)
      expect(session.branchEntries().some((entry) => entry.type === 'compaction')).toBe(true)
      expect(JSON.stringify(session.buildSessionContext().messages)).toContain('Compacted summary: SCENE_SNAPSHOT_V2 verified')

      // 3) Mid-tool abort settles as `Operation aborted` without spending an extra fauxProvider call
      let abortableEntered!: () => void
      const enteredPromise = new Promise<void>((resolve) => { abortableEntered = resolve })
      const slowSpecs = createDocumentLaneTools({
        read: (_scope, ctx) => new Promise((_resolve, reject) => {
          abortableEntered()
          ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason ?? new Error('aborted')), { once: true })
        }),
        write: async () => ({ applied: true, revision: 3, contentHash: 'h3' }),
      })
      const slowTools = createLaneTools(slowSpecs)
      const abortAgent = new Agent({
        initialState: {
          systemPrompt: 'You are Nomi.',
          model,
          thinkingLevel: 'off',
          tools: [...slowTools],
          messages: session.buildSessionContext().messages,
        },
        streamFn,
        toolExecution: 'sequential',
        identity: { attribution: null },
        finishTurn: async (_turn, signal) => (signal?.aborted ? { action: 'end' as const } : undefined),
      })
      const recordedAbortMessages: AgentMessage[] = []
      abortAgent.subscribe((event) => {
        if (event.type === 'message_end') recordedAbortMessages.push(event.message)
      })
      const callsBeforeAbortRun = faux.state.callCount
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('read_script', {}, { id: 'call-abort-1' })], { stopReason: 'toolUse' }),
        fauxAssistantMessage('Should never be called after abort'),
      ])
      const promptRun = abortAgent.prompt('再次读取但中途按停')
      await enteredPromise
      abortAgent.abort()
      await promptRun
      expect(faux.state.callCount).toBe(callsBeforeAbortRun + 1)
      const abortedToolResult = recordedAbortMessages.find((m) => m.role === 'toolResult')
      expect(abortedToolResult?.role === 'toolResult' && abortedToolResult.isError).toBe(true)
    } finally {
      await opened.release()
    }
  })

  it('routes google-generative-ai through @google/genai@3.6.1 custom fetch with /v1beta normalization and native PDF inlineData', async () => {
    expect(googleGenerativeBaseUrl('https://gemini-proxy.example.com')).toBe('https://gemini-proxy.example.com/v1beta')
    expect(googleGenerativeBaseUrl('https://generativelanguage.googleapis.com/v1beta/')).toBe('https://generativelanguage.googleapis.com/v1beta')

    const vendor = {
      key: 'gemini-vendor',
      baseUrlHint: 'https://gemini-proxy.example.com',
      providerKind: 'openai-compatible',
      authType: 'api-key',
    } as unknown as Vendor
    const catalogModel = {
      modelKey: 'gemini-2.5-pro',
      kind: 'text',
      meta: { textProtocol: 'google-generative-ai', maxOutputTokens: 2048 },
    } as unknown as CatalogModel
    const config = nomiModelConfigFor(vendor, catalogModel, 'AIza-fixture-key')
    expect(config.kind).toBe('google-generative-ai')
    expect(config.baseURL).toBe('https://gemini-proxy.example.com/v1beta')

    const capturedRequests: Array<{ url: string; body: Record<string, unknown> }> = []
    const customFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const rawBody = typeof init?.body === 'string'
        ? init.body
        : init?.body
          ? Buffer.from(init.body as ArrayBuffer).toString('utf8')
          : '{}'
      capturedRequests.push({ url, body: JSON.parse(rawBody) as Record<string, unknown> })
      const sseChunk = JSON.stringify({
        candidates: [{
          content: { role: 'model', parts: [{ text: 'PDF analyzed via custom fetch.' }] },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 7, totalTokenCount: 49 },
      })
      return new Response(`data: ${sseChunk}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }

    const { provider, model, credentials } = await createNomiProvider(config, customFetch)
    const models = createModels({ credentials })
    models.setProvider(provider)

    const pdfBase64 = Buffer.from('%PDF-1.4 fixture').toString('base64')
    const stream = models.streamSimple(
      model,
      {
        systemPrompt: 'Read attached PDF.',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '[PDF:treatment]' },
            { type: 'text', text: 'Summarize treatment.pdf' },
          ],
          timestamp: Date.now(),
        }],
      },
      {
        onPayload: (payload) => injectPdfPayload(payload, 'google-generative-ai', [
          { marker: '[PDF:treatment]', fileName: 'treatment.pdf', data: pdfBase64 },
        ]),
      },
    )
    const finalMessage = await stream.result()
    expect(finalMessage.stopReason).toBe('stop')
    expect(finalMessage.content).toEqual([{ type: 'text', text: 'PDF analyzed via custom fetch.' }])
    expect(capturedRequests).toHaveLength(1)
    expect(capturedRequests[0]!.url).toContain('https://gemini-proxy.example.com/v1beta/models/gemini-2.5-pro:streamGenerateContent')
    expect(JSON.stringify(capturedRequests[0]!.body)).toContain(pdfBase64)
    expect(JSON.stringify(capturedRequests[0]!.body)).toContain('application/pdf')
  })

  it('wires Windows PowerShell tool alongside bash, converts timeout to milliseconds, and enforces pi-schema input boundary', async () => {
    const projectDir = makeTempDir('nomi-pi17-win32-')
    tempDirs.push(projectDir)

    const psCalls: Array<{ command: string; cwd: string; timeout?: number }> = []
    const opened = await openLaneSession({ projectDir, laneName: 'main' })
    try {
      const assembly = await createLaneNativeAssembly({
        projectDir,
        platform: 'win32',
        bashTimeoutMs: 15_000,
        sandbox: {
          active: false,
          close: async () => undefined,
          operations: { exec: async () => ({ exitCode: 0 }) },
        },
        powerShellOperations: {
          exec: async (command, cwd, options) => {
            psCalls.push({ command, cwd, timeout: options.timeout })
            options.onData(Buffer.from('PS_OUTPUT_OK\n'))
            return { exitCode: 0 }
          },
        },
      })
      assembly.bindActiveTools(opened.session)
      await assembly.unlockCoding()

      const boundary = createLaneToolInputBoundary({
        failures: createLaneRepeatedFailureTracker(),
        specs: [],
        turn: createLaneTurnBudget(createLaneRepeatedFailureTracker(), undefined),
      })
      const wrapped = boundary.wrap(assembly.tools)
      const psTool = wrapped.find((tool) => tool.name === 'powershell')
      expect(psTool).toBeDefined()

      // Valid PowerShell call converts 4s -> 4000ms
      const okResult = await psTool!.execute('ps-ok', { command: 'Get-Location', timeout: 4 } as never)
      expect(psCalls).toEqual([{ command: 'Get-Location', cwd: projectDir, timeout: 4_000 }])
      expect(JSON.stringify(okResult.content)).toContain('PS_OUTPUT_OK')

      // Invalid PowerShell arguments rejected by pi-schema@1.7.0 validator before reaching exec
      expect(laneCompactionSettings(128_000, 40_000).enabled).toBe(true)
      expect(() => psTool!.prepareArguments!({ command: { bad: true } })).toThrow(/Validation failed for tool "powershell"/)
      expect(psCalls).toHaveLength(1)
    } finally {
      await opened.release()
    }
  })
})
