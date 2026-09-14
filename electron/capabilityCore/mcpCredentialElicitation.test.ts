import { describe, expect, it, vi } from 'vitest'
import { runIntegrationCredentialElicitation } from './mcpCredentialElicitation'
import { createElicitationClient, readElicitationCapability } from './mcpElicitation'

const TICKET = {
  elicitationId: '550e8400-e29b-41d4-a716-446655440000',
  sessionId: 'integration-9',
  expiresAt: '2026-09-05T00:10:00.000Z',
  url: 'http://127.0.0.1:41234/integration-credential?t=' + 'a'.repeat(64),
  display: { name: 'APIMart', baseUrl: 'https://api.example.com', authType: 'bearer' },
}

function makeInvoke(states: string[]) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  let index = 0
  const invoke = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params })
    if (method === 'modelSetup.connect_provider') {
      return {
        ok: true, setupId: TICKET.sessionId,
        state: { connections: [], setups: [{ id: TICKET.sessionId, revision: 2, stage: 'needs_credential', credentialStatus: 'missing' }], fingerprint: 'fp_x' },
        nextAction: { kind: 'user_sees_key_page', userSees: '', url: TICKET.url },
        credentialEntry: TICKET, credentialUiOpened: false, config: TICKET.display,
      }
    }
    const status = states[Math.min(index++, states.length - 1)]
    return {
      ok: true, setupId: TICKET.sessionId,
      state: { connections: [], setups: [{ id: TICKET.sessionId, revision: 3, stage: status === 'ready' ? 'draft' : 'needs_credential', credentialStatus: status }], fingerprint: 'fp_y' },
      nextAction: { kind: 'none', userSees: '' },
    }
  }
  return { invoke, calls }
}

const noWait = async () => {}

describe('nomi_model_setup connect_provider credential elicitation (MCP url mode)', () => {
  it('asks in url mode, waits for the real save, then notifies completion', async () => {
    const { invoke, calls } = makeInvoke(['missing', 'missing', 'ready'])
    const requestUrl = vi.fn(async () => ({ supported: true, action: 'accept' as const }))
    const notifyComplete = vi.fn()
    const outcome = await runIntegrationCredentialElicitation({
      built: { action: 'connect_provider', kind: 'http-api-provider', name: 'APIMart', baseUrl: 'https://api.example.com' },
      invoke,
      elicitation: { requestUrl, notifyComplete },
      wait: noWait,
    })
    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({ elicitationId: TICKET.elicitationId, url: TICKET.url }),
      undefined,
    )
    // Consent is not completion: the session had to actually report a ready credential.
    expect(calls.filter((call) => call.method === 'modelSetup.list')).toHaveLength(3)
    expect(notifyComplete).toHaveBeenCalledWith(TICKET.elicitationId)
    expect(outcome.kind).toBe('result')
    if (outcome.kind !== 'result') throw new Error('unreachable')
    expect((outcome.result.state as { setups: Array<{ credentialStatus: string }> }).setups[0].credentialStatus).toBe('ready')
    // The spent single-use URL never rides back out to the model.
    expect(outcome.result.credentialEntry).toBeUndefined()
    expect(JSON.stringify(outcome.result)).not.toContain('integration-credential')
  })

  it('keeps the flow alive with the manual route when the page never opened', async () => {
    // Codex CLI 0.153.4 declares url-mode and then declines every url elicitation without showing it
    // (measured 2026-09-06). Calling that "you cancelled it" and returning a tool error left the user
    // blamed for something they never saw, with no next step.
    const { invoke } = makeInvoke(['missing'])
    const outcome = await runIntegrationCredentialElicitation({
      built: { action: 'connect_provider', kind: 'http-api-provider', name: 'APIMart', baseUrl: 'https://api.example.com' },
      invoke,
      elicitation: { requestUrl: async () => ({ supported: true, action: 'decline' as const }), notifyComplete: vi.fn() },
      wait: noWait,
    })
    expect(outcome.kind).toBe('result')
    if (outcome.kind !== 'result') throw new Error('unreachable')
    const entry = outcome.result.credentialEntry as { mode: string; reason: string; instructions: string }
    expect(entry).toMatchObject({ mode: 'manual', reason: 'not_opened' })
    expect(entry.instructions).toMatch(/设置|Settings/)
    expect(entry.instructions).not.toMatch(/超时|timed out/)
    // The one-time ticket is never handed back out, decline or not.
    expect(JSON.stringify(outcome.result)).not.toContain('integration-credential')
  })

  it('gives up with the manual path when the page is never completed', async () => {
    const { invoke } = makeInvoke(['missing'])
    const outcome = await runIntegrationCredentialElicitation({
      built: { action: 'connect_provider', kind: 'http-api-provider', name: 'APIMart', baseUrl: 'https://api.example.com' },
      invoke,
      elicitation: { requestUrl: async () => ({ supported: true, action: 'accept' as const }), notifyComplete: vi.fn() },
      wait: noWait,
      waitMs: 0,
    })
    expect(outcome.kind).toBe('error')
  })

  it('withholds the URL from a client that cannot present it, and points at Nomi instead', async () => {
    const { invoke } = makeInvoke(['missing'])
    const outcome = await runIntegrationCredentialElicitation({
      built: { action: 'connect_provider', kind: 'http-api-provider', name: 'APIMart', baseUrl: 'https://api.example.com' },
      invoke,
      elicitation: { requestUrl: async () => ({ supported: false }), notifyComplete: vi.fn() },
      wait: noWait,
    })
    expect(outcome.kind).toBe('result')
    if (outcome.kind !== 'result') throw new Error('unreachable')
    expect((outcome.result.state as { setups: Array<{ stage: string }> }).setups[0].stage).toBe('needs_credential')
    expect(outcome.result.credentialEntry).toEqual({ mode: 'manual', instructions: expect.stringMatching(/设置|Settings/) })
    expect(JSON.stringify(outcome.result)).not.toContain('127.0.0.1')
  })

  it('说填写页没打开、指去 Nomi 里的那条路，但不断言「Nomi 没在运行」——那件事它不知道', async () => {
    const { invoke } = makeInvoke(['missing'])
    const outcome = await runIntegrationCredentialElicitation({
      built: { action: 'connect_provider', kind: 'http-api-provider', name: 'APIMart', baseUrl: 'https://api.example.com' },
      invoke,
      elicitation: { requestUrl: async () => ({ supported: false }), notifyComplete: vi.fn() },
      locale: 'en',
      wait: noWait,
    })
    expect(outcome.kind).toBe('result')
    if (outcome.kind !== 'result') throw new Error('unreachable')
    const instructions = (outcome.result.credentialEntry as { instructions: string }).instructions
    // 能说的：页面没打开、去 Nomi 里那条路怎么走、这是哪个连接。
    expect(instructions).toMatch(/could not be opened/)
    expect(instructions).toMatch(/Settings → Models/)
    expect(instructions).toContain('"APIMart"')
    // 不能说的：「Nomi 没在运行」——这个进程只知道自己铸不出页面，不知道 GUI 在不在
    //（2026-09-15 真实闭环：Nomi 明明在跑，外部 Agent 照这句话劝用户三次去开 Nomi）。
    expect(instructions).not.toMatch(/not running|没在运行/)
    // 也不能出现空引号：名字拿不到时说「这个连接」。
    expect(instructions).not.toMatch(/""|「」/)
  })

  it('这一步根本不需要 key 时，结果里一条人工指引都不该有', async () => {
    // key 已经存着 → connect_provider 回 nextAction.kind="working"、没有票据。
    // 此前「没有票据」被当成「铸不出填写页」，于是照样挂一条「Nomi 没在运行，请保存「」的 key」。
    const invoke = async (method: string) => (method === 'modelSetup.connect_provider'
      ? {
          ok: true, setupId: TICKET.sessionId,
          state: { connections: [{ vendorKey: 'apimart', keyStatus: 'ready' }], setups: [], fingerprint: 'fp_z' },
          nextAction: { kind: 'working', userSees: 'Nomi already has a key for APIMart and is reading its list of models.' },
        }
      : { ok: true, setupId: TICKET.sessionId, state: { connections: [], setups: [], fingerprint: 'fp_z' }, nextAction: { kind: 'none', userSees: '' } })
    const outcome = await runIntegrationCredentialElicitation({
      built: { action: 'connect_provider', kind: 'http-api-provider', name: 'APIMart', baseUrl: 'https://api.example.com' },
      invoke,
      elicitation: { requestUrl: async () => ({ supported: false }), notifyComplete: vi.fn() },
      wait: noWait,
    })
    expect(outcome.kind).toBe('result')
    if (outcome.kind !== 'result') throw new Error('unreachable')
    expect(outcome.result.credentialEntry).toBeUndefined()
    expect(JSON.stringify(outcome.result)).not.toMatch(/没在运行|not running|「」/)
  })

  it('tells form-only clients that the Nomi window is already on the provider page', async () => {
    const { invoke } = makeInvoke(['missing'])
    const wrappedInvoke = async (method: string, params: Record<string, unknown>) => {
      const value = await invoke(method, params) as Record<string, unknown>
      return method === 'modelSetup.connect_provider' ? { ...value, credentialUiOpened: true } : value
    }
    const outcome = await runIntegrationCredentialElicitation({
      built: { action: 'connect_provider', kind: 'http-api-provider', name: 'APIMart', baseUrl: 'https://api.example.com' },
      invoke: wrappedInvoke,
      elicitation: { requestUrl: async () => ({ supported: false }), notifyComplete: vi.fn() },
      wait: noWait,
    })
    expect(outcome.kind).toBe('result')
    if (outcome.kind !== 'result') throw new Error('unreachable')
    expect((outcome.result.credentialEntry as { instructions: string }).instructions).toMatch(/窗口已经打开|window is open/)
  })
})

describe('elicitation capability negotiation', () => {
  it('treats an empty object as form-only and requires an explicit url member', () => {
    expect(readElicitationCapability(undefined)).toEqual({ form: false, url: false })
    expect(readElicitationCapability({})).toEqual({ form: false, url: false })
    expect(readElicitationCapability({ elicitation: {} })).toEqual({ form: true, url: false })
    expect(readElicitationCapability({ elicitation: { form: {} } })).toEqual({ form: true, url: false })
    expect(readElicitationCapability({ elicitation: { form: {}, url: {} } })).toEqual({ form: true, url: true })
    expect(readElicitationCapability({ elicitation: { url: {} } })).toEqual({ form: false, url: true })
  })

  it('never sends mode:"url" to a client that did not declare it', async () => {
    const sendServerRequest = vi.fn(async () => ({ action: 'accept' }))
    const client = createElicitationClient({
      sendServerRequest,
      send: vi.fn(),
      supportsElicitation: () => true,
      supportsUrlElicitation: () => false,
    })
    expect(await client.requestUrl({ elicitationId: 'e1', url: 'http://127.0.0.1:1/x', message: 'm' }))
      .toEqual({ supported: false })
    expect(sendServerRequest).not.toHaveBeenCalled()
  })

  it('emits the 2025-11-25 url-mode frame and the completion notification', async () => {
    const sendServerRequest = vi.fn(async () => ({ action: 'accept' }))
    const send = vi.fn()
    const client = createElicitationClient({
      sendServerRequest,
      send,
      supportsElicitation: () => true,
      supportsUrlElicitation: () => true,
    })
    await client.requestUrl({ elicitationId: 'e1', url: 'http://127.0.0.1:1/x', message: 'need a key' })
    expect(sendServerRequest).toHaveBeenCalledWith(
      'elicitation/create',
      { mode: 'url', elicitationId: 'e1', url: 'http://127.0.0.1:1/x', message: 'need a key' },
      300000,
      undefined,
    )
    client.notifyComplete('e1')
    expect(send).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'notifications/elicitation/complete',
      params: { elicitationId: 'e1' },
    })
  })
})
