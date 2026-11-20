// 付费批准只在一个家判（概念 spend.approval-decision，设计卡 docs/plan/2026-11-20-approval-one-home.md ★9）。
//
// 这份测试只走主分支和改后都存在的入口（rpcServer 的两个回环方法、createDefaultAuthorities、
// 客户端确认工厂、回环这一跳、降档挑战、Run 边界的降档核对），所以改前红必须是断言失败、不是缺符号。
// 每条目标行都有正反两半：「什么都不做」按真实差异红（到时替答否也让正半边红），
// 「全部拦下」让正半边红（人答了是，照样签不出）。不变行钉的是同一输入同一结论、同一句话。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const capabilityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-approval-one-home-cap-'))
const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-approval-one-home-user-'))

vi.mock('electron', () => ({
  app: { getPath: () => userDataRoot, getAppPath: () => process.cwd() },
}))

type RendererAsk = { channel: string; payload: Record<string, unknown>; answer: (value: unknown) => void }
const renderer = vi.hoisted(() => ({ asks: [] as RendererAsk[] }))
vi.mock('./rendererBridge', () => ({
  requestRendererDecision: (channel: string, payload: Record<string, unknown>) =>
    new Promise((resolve) => { renderer.asks.push({ channel, payload, answer: resolve }) }),
  rendererTargetIdentity: () => ({ webContentsId: 7, frameId: 1, origin: 'app://nomi' }),
  isRendererAvailable: () => true,
  requestRenderer: async (op: string) => { throw new Error(`本测试不走带超时的桥: ${op}`) },
}))

const receiptsHolder = vi.hoisted(() => ({ authority: null as unknown }))
vi.mock('./approvalReceiptRuntime', () => ({
  currentProjectRevision: () => 2,
  getApprovalReceiptAuthority: () => receiptsHolder.authority,
  resetApprovalReceiptAuthorityForTests: () => {},
}))
vi.mock('./projectSessionRuntime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createProductionProjectSessionRuntime: () => ({ authority: undefined }),
}))
vi.mock('./canvasReadSurfaceRuntime', () => ({
  canvasReadSurfaceRuntime: { getCommittedProjectSelection: () => null },
}))

import { createApprovalReceiptAuthority, type ApprovalReceiptAuthority, type HumanApprovalChallengeInput } from './approvalReceipt'
import { spendDecisionByPolicy } from '../shared/agentCapabilities/directGenerationBrakes'
import { handleSemanticGenerationGate } from './mcpSemanticGenerationFlow'
import { handleTrustDowngrade } from './mcpTrustDowngrade'
import { assembleToolResultContent } from './mcpResultPayload'
import { buildToolErrorOutcome } from './mcpToolErrorResults'
import { createDefaultAuthorities } from './appIntegrationAuthorities'
import { createElicitationClient } from './mcpElicitation'
import { createGenerationGateConfirmation, type GenerationGateChallengeProjection } from './mcpGateConfirmation'
import { callMcpLoopbackRpc, createLoopbackGenerationConfirmation } from './mcpLoopbackRpcCall'
import { createMcpConnectionContext } from './mcpConnectionContext'
import { signMcpClient, ensureToken } from './security'
import { issueTrustGrantChallenge } from './productionTrustGrantChallenge'
import { decideRunOwnedGenerationGate, mainProcessGateApproval } from './runOwnedGenerationGateAuthority'
import { startRpcServer } from './rpcServer'
import { createGateApprovalOwner } from '../productionRun/productionRunApprovalReceipt'
import type { ProductionRun, RunCommand } from '../productionRun/productionRunTypes'

const roots: string[] = []
let authority: ApprovalReceiptAuthority

beforeEach(() => {
  vi.stubEnv('NOMI_CAPABILITY_DIR', capabilityRoot)
  ensureToken() // 客户端签名要本机令牌；单独跑某一行时也要有，不靠前面的行先建
  renderer.asks.length = 0
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-approval-one-home-'))
  roots.push(root)
  authority = createApprovalReceiptAuthority({ filePath: path.join(root, 'approval-receipts.json'), macKey: 'one-home-key' })
  receiptsHolder.authority = authority
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

afterAll(() => {
  for (const root of [...roots, capabilityRoot, userDataRoot]) fs.rmSync(root, { recursive: true, force: true })
})

/** 外部生成门那条路的挑战：有效期按信封剩余时间（信封默认 10 分钟，prepareProductionGenerationAuthorization）。 */
const GATE_CHALLENGE_TTL_MS = 10 * 60_000

function gateChallenge(key = 'generation_submit:op-1:digest-1', overrides: Partial<HumanApprovalChallengeInput> = {}) {
  return authority.requestChallenge({
    challengeKey: key,
    immutableProjectUuid: 'uuid-1',
    projectGeneration: 1,
    projectId: 'project-1',
    runId: 'op-1',
    gateId: 'gate-1',
    contractHash: 'digest-1',
    targetHash: 'digest-1',
    projectRevision: 2,
    costScope: 'generation_submit',
    pricingSnapshotHash: 'digest-1',
    reservationPreview: { currency: 'CNY', maximum: 3 },
    display: { projectName: '短片', shotSummary: '3 镜', model: 'm-x', referenceCount: 0 },
    ttlMs: GATE_CHALLENGE_TTL_MS,
    ...overrides,
  })
}

function projectionOf(challenge: ReturnType<typeof gateChallenge>): GenerationGateChallengeProjection {
  return {
    challengeId: challenge.challenge.challengeId,
    model: 'm-x',
    costScope: challenge.challenge.costScope,
    maximumCost: 3,
    currency: 'CNY',
    expiresAt: challenge.challenge.expiresAt,
    handoff: { challengeToken: challenge.token, clientAttestation: true },
  }
}

function receiptCount(): number {
  if (!fs.existsSync(authority.filePath)) return 0
  const state = JSON.parse(fs.readFileSync(authority.filePath, 'utf8')) as { receipts?: Record<string, unknown> }
  return Object.keys(state.receipts ?? {}).length
}

async function until(condition: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`等不到：${label}`)
}

/** 真实的 elicitation 客户端，假的是线另一头：它照 SDK 那样按 timeoutMs 自己计时。 */
function elicitationHarness() {
  const asks: Array<{ params: unknown; timeoutMs?: number; answer: (response: unknown) => void; fail: (error: unknown) => void }> = []
  const client = createElicitationClient({
    sendServerRequest: (_method, _params, timeoutMs, signal) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Request timed out')), timeoutMs ?? 60_000)
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new Error('aborted')) }, { once: true })
      asks.push({
        params: _params, timeoutMs,
        answer: (response) => { clearTimeout(timer); resolve(response) },
        fail: (error) => { clearTimeout(timer); reject(error) },
      })
    }),
    notify: () => {},
    supportsElicitation: () => true,
    supportsUrlElicitation: () => false,
  })
  return { client, asks }
}

type Authorities = ReturnType<typeof createDefaultAuthorities>
type AnyFn = (...args: unknown[]) => Promise<unknown>

/**
 * 回环那一跳的主进程一侧（rpcServer 的两个方法），进程内版：身份取「请求头」里验过的那个（这里固定 codex），
 * 原始答复与取消信号照 rpcServer 的样子交过去。真 HTTP 版见下面「真回环」各行。
 */
function fakeRpcFetch(authorities: Authorities, headerClient = 'codex'): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> }
    const requestController = new AbortController()
    return await new Promise<Response>((resolve, reject) => {
      const onAbort = () => {
        requestController.abort()
        reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))
      }
      if (init?.signal?.aborted) return onAbort()
      init?.signal?.addEventListener('abort', onAbort, { once: true })
      const { params } = body
      const run = body.method === 'nomi_confirm_generation_gate'
        ? (authorities.confirmGenerationInNomi as unknown as AnyFn)({ challengeToken: params.challengeToken }, { signal: requestController.signal })
        : (authorities.verifyClientGenerationGateInMain as unknown as AnyFn)({
            challengeToken: params.challengeToken,
            authenticatedClient: headerClient,
            ...(params.answer ? { answer: params.answer } : {}),
          })
      Promise.resolve(run).then(
        (result) => resolve({ status: 200, json: async () => ({ ok: true, result }) } as Response),
        (error: unknown) => resolve({ status: 500, json: async () => ({ ok: false, error: { message: String((error as Error)?.message) } }) } as Response),
      )
    })
  }) as typeof fetch
}

function connection() {
  return createMcpConnectionContext({ client: 'codex', proof: signMcpClient('codex')! })
}

/** 启动器那一跳：和裸 Node 启动器一样，rpcIfOpen 只转 method + params，不另带选项。 */
function launcherLoopback(fetchImpl: typeof fetch, instance = { port: 1, token: 't' }) {
  const conn = connection()
  return createLoopbackGenerationConfirmation({
    rpcIfOpen: (method, params) => callMcpLoopbackRpc({
      instance,
      fetchImpl,
      clientProof: signMcpClient('codex')!,
      connection: conn,
      method,
      params,
    }),
    authenticatedClient: () => 'codex',
  })
}

function clientGate(loopback: ReturnType<typeof launcherLoopback>, elicit: ReturnType<typeof elicitationHarness>['client'], appOpen = false) {
  return createGenerationGateConfirmation({
    transport: {
      isAppOpen: () => appOpen,
      getAuthenticatedClient: () => 'codex',
      verifyClientGenerationConfirmation: loopback.verifyClientGenerationConfirmation as never,
      confirmGenerationInNomi: loopback.confirmGenerationInNomi as never,
    },
    clientSupportsElicitation: () => true,
    elicitBooleanConfirm: elicit.booleanConfirm as never,
  })
}

function nomiOnlyGate(loopback: ReturnType<typeof launcherLoopback>) {
  return createGenerationGateConfirmation({
    transport: {
      isAppOpen: () => true,
      getAuthenticatedClient: () => null,
      confirmGenerationInNomi: loopback.confirmGenerationInNomi as never,
    },
    clientSupportsElicitation: () => false,
    elicitBooleanConfirm: async () => ({ supported: false }),
  })
}

const ACCEPT = { action: 'accept', content: { confirm: true } }

/** 走真正的工具结果投影；只归一化随机凭据，保留全部外部原句（中英）。 */
async function externalReceipt(result: unknown, trust = false): Promise<string[]> {
  const texts: string[] = []
  const challenge = { challengeId: 'wire-challenge', model: 'm-x', costScope: 'generation_submit', maximumCost: 3, currency: 'CNY', expiresAt: '2099-01-01T00:00:00.000Z' }
  for (const locale of ['zh-CN', 'en'] as const) {
    let reply: unknown
    const build = (name: string, args: Record<string, unknown>, value: unknown) => assembleToolResultContent(name, args, value, locale)
    const value = result as Record<string, unknown>
    const confirmation = { challengeId: 'wire-challenge', surface: 'client', nextAction: 'in_client', ...value } as never
    try {
      if (trust) {
        await handleTrustDowngrade({ id: 1, toolName: 'nomi_run_control', args: { action: 'set_trust', trustLevel: 'budget_only' }, built: { projectId: 'project-1', runId: 'run-1' }, routedMethod: 'production.control' }, {
          invokeForRequest: async (method) => method === 'production.trust-challenge' ? challenge : { runId: 'run-1' },
          requestGenerationConfirmation: async () => confirmation, reply: (_id, sent) => { reply = sent },
          buildToolResultPayload: build, locale: () => locale,
        })
      } else {
        await handleSemanticGenerationGate(1, 'nomi_operation_gate', { phase: 'request' }, { operationId: 'op-1' }, {
          invoke: async (method) => method === 'nomi_request_generation_gate' ? challenge : { operationId: 'op-1', state: method === 'nomi_start_generation' ? 'running' : 'authorized' },
          requestConfirmation: async () => confirmation, buildResult: build, reply: (_id, sent) => { reply = sent }, locale: () => locale,
        })
      }
    } catch (error) { reply = { content: [{ text: buildToolErrorOutcome('nomi_operation_gate', error, locale).text }] } }
    let text = String((reply as { content: Array<{ text: string }> }).content[0]!.text)
    for (const key of ['challengeId', 'receiptId', 'receiptToken'] as const) {
      if (typeof value[key] === 'string' && value[key]) text = text.split(value[key] as string).join(`<${key}>`)
    }
    texts.push(text)
  }
  return texts
}

function externalError(error: unknown): string[] {
  return (['zh-CN', 'en'] as const).map((locale) => buildToolErrorOutcome('nomi_operation_gate', error, locale).text)
}

// ───────────────────────────── 目标行 ─────────────────────────────

describe('D3 客户端来要收据：要有人的答复，身份取请求头', () => {
  it('反半边：只带挑战和客户端名字、没有答复 → 不签', async () => {
    const authorities = createDefaultAuthorities()
    const challenge = gateChallenge()
    const result = await (authorities.verifyClientGenerationGateInMain as unknown as AnyFn)({ challengeToken: challenge.token, authenticatedClient: 'codex' }) as Record<string, unknown>
    expect(result.confirmed).not.toBe(true)
    expect(await externalReceipt(result)).toMatchInlineSnapshot(`
      [
        "未开始：请在当前客户端确认这次生成，或在唯一的 Nomi 兜底卡中确认。",
        "Not started: confirm this generation in the current client or in the single Nomi fallback card.",
      ]
    `)
    expect(result.receiptToken).toBeUndefined()
    expect(receiptCount()).toBe(0)
  })

  it('正半边：同一挑战带上 accept + confirm=true → 签', async () => {
    const authorities = createDefaultAuthorities()
    const challenge = gateChallenge()
    const result = await (authorities.verifyClientGenerationGateInMain as unknown as AnyFn)({
      challengeToken: challenge.token, authenticatedClient: 'codex', answer: { action: 'accept', confirm: true },
    }) as Record<string, unknown>
    expect(result.confirmed).toBe(true)
    expect(await externalReceipt(result)).toMatchInlineSnapshot(`
      [
        "{
        "challenge": {
          "challengeId": "wire-challenge",
          "model": "m-x",
          "costScope": "generation_submit",
          "maximumCost": 3,
          "currency": "CNY",
          "expiresAt": "2099-01-01T00:00:00.000Z"
        },
        "confirmation": {
          "challengeId": "wire-challenge",
          "surface": "client",
          "nextAction": "in_client",
          "confirmed": true,
          "receiptId": "<receiptId>",
          "receiptToken": "<receiptToken>"
        },
        "approved": {
          "operationId": "op-1",
          "state": "authorized"
        },
        "started": {
          "operationId": "op-1",
          "state": "running"
        }
      }",
        "{
        "challenge": {
          "challengeId": "wire-challenge",
          "model": "m-x",
          "costScope": "generation_submit",
          "maximumCost": 3,
          "currency": "CNY",
          "expiresAt": "2099-01-01T00:00:00.000Z"
        },
        "confirmation": {
          "challengeId": "wire-challenge",
          "surface": "client",
          "nextAction": "in_client",
          "confirmed": true,
          "receiptId": "<receiptId>",
          "receiptToken": "<receiptToken>"
        },
        "approved": {
          "operationId": "op-1",
          "state": "authorized"
        },
        "started": {
          "operationId": "op-1",
          "state": "running"
        }
      }",
      ]
    `)
    expect(authority.verifyReceipt(String(result.receiptToken)).decidedBy).toBe('human:elicitation')
  })

  it('真回环：参数里自报的身份不作数，收据记的是请求头里验过的那个客户端', async () => {
    const authorities = createDefaultAuthorities()
    const server = await startRpcServer({
      runTask: async () => ({ id: 't', status: 'succeeded', assets: [] }),
      confirmGenerationInNomi: authorities.confirmGenerationInNomi,
      verifyClientGenerationGateInMain: authorities.verifyClientGenerationGateInMain,
    } as never)
    try {
      const challenge = gateChallenge()
      const result = await callMcpLoopbackRpc({
        instance: { port: server.port, token: ensureToken() },
        fetchImpl: fetch,
        clientProof: signMcpClient('codex')!,
        connection: connection(),
        method: 'nomi_verify_client_generation_gate',
        params: { challengeToken: challenge.token, authenticatedClient: 'claude', answer: { action: 'accept', confirm: true } },
      }) as Record<string, unknown>
      expect(result.confirmed).toBe(true)
    expect(await externalReceipt(result)).toMatchInlineSnapshot(`
      [
        "{
        "challenge": {
          "challengeId": "wire-challenge",
          "model": "m-x",
          "costScope": "generation_submit",
          "maximumCost": 3,
          "currency": "CNY",
          "expiresAt": "2099-01-01T00:00:00.000Z"
        },
        "confirmation": {
          "challengeId": "wire-challenge",
          "surface": "client",
          "nextAction": "in_client",
          "confirmed": true,
          "receiptId": "<receiptId>",
          "receiptToken": "<receiptToken>"
        },
        "approved": {
          "operationId": "op-1",
          "state": "authorized"
        },
        "started": {
          "operationId": "op-1",
          "state": "running"
        }
      }",
        "{
        "challenge": {
          "challengeId": "wire-challenge",
          "model": "m-x",
          "costScope": "generation_submit",
          "maximumCost": 3,
          "currency": "CNY",
          "expiresAt": "2099-01-01T00:00:00.000Z"
        },
        "confirmation": {
          "challengeId": "wire-challenge",
          "surface": "client",
          "nextAction": "in_client",
          "confirmed": true,
          "receiptId": "<receiptId>",
          "receiptToken": "<receiptToken>"
        },
        "approved": {
          "operationId": "op-1",
          "state": "authorized"
        },
        "started": {
          "operationId": "op-1",
          "state": "running"
        }
      }",
      ]
    `)
      expect(authority.verifyReceipt(String(result.receiptToken)).humanActor).toBe('mcp_client:codex')
      const bare = await callMcpLoopbackRpc({
        instance: { port: server.port, token: ensureToken() },
        fetchImpl: fetch,
        clientProof: signMcpClient('codex')!,
        connection: connection(),
        method: 'nomi_verify_client_generation_gate',
        params: { challengeToken: gateChallenge('generation_submit:op-2:digest-1', { runId: 'op-2' }).token, authenticatedClient: 'codex' },
      }) as Record<string, unknown>
      expect(bare.confirmed).not.toBe(true)
    } finally {
      await server.close()
    }
  })
})

describe('U1-1 客户端在问，人隔了 301 秒才答', () => {
  it('正半边：第 301 秒点「是」→ 签出收据', async () => {
    vi.useFakeTimers()
    const authorities = createDefaultAuthorities()
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(authorities)), elicit.client)
    const challenge = gateChallenge()
    const pending = gate.requestGenerationConfirmation(projectionOf(challenge))
    await vi.advanceTimersByTimeAsync(301_000)
    elicit.asks[0]?.answer(ACCEPT)
    await vi.advanceTimersByTimeAsync(0)
    const result = await pending
    expect(result).toMatchObject({ confirmed: true, surface: 'client' })
    expect(await externalReceipt(result, false)).toMatchInlineSnapshot(`
      [
        "{
        "challenge": {
          "challengeId": "wire-challenge",
          "model": "m-x",
          "costScope": "generation_submit",
          "maximumCost": 3,
          "currency": "CNY",
          "expiresAt": "2099-01-01T00:00:00.000Z"
        },
        "confirmation": {
          "challengeId": "<challengeId>",
          "surface": "client",
          "nextAction": "in_client",
          "confirmed": true,
          "receiptId": "<receiptId>",
          "receiptToken": "<receiptToken>"
        },
        "approved": {
          "operationId": "op-1",
          "state": "authorized"
        },
        "started": {
          "operationId": "op-1",
          "state": "running"
        }
      }",
        "{
        "challenge": {
          "challengeId": "wire-challenge",
          "model": "m-x",
          "costScope": "generation_submit",
          "maximumCost": 3,
          "currency": "CNY",
          "expiresAt": "2099-01-01T00:00:00.000Z"
        },
        "confirmation": {
          "challengeId": "<challengeId>",
          "surface": "client",
          "nextAction": "in_client",
          "confirmed": true,
          "receiptId": "<receiptId>",
          "receiptToken": "<receiptToken>"
        },
        "approved": {
          "operationId": "op-1",
          "state": "authorized"
        },
        "started": {
          "operationId": "op-1",
          "state": "running"
        }
      }",
      ]
    `)
    expect(authority.verifyReceipt(String(result.receiptToken)).decidedBy).toBe('human:elicitation')
  })

  it('反半边：第 301 秒点「否」→ 不签，回拒绝', async () => {
    vi.useFakeTimers()
    const authorities = createDefaultAuthorities()
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(authorities)), elicit.client)
    const pending = gate.requestGenerationConfirmation(projectionOf(gateChallenge()))
    await vi.advanceTimersByTimeAsync(301_000)
    elicit.asks[0]?.answer({ action: 'decline' })
    await vi.advanceTimersByTimeAsync(0)
    const result = await pending
    expect(result).toMatchObject({ confirmed: false, denial: 'declined' })
    expect(await externalReceipt(result)).toMatchInlineSnapshot(`
      [
        "未开始：用户拒绝了这次请求，没有花费。请结束这次生成，等用户的新指令；不要再次发起确认。",
        "Not started: the user declined this request. Nothing was spent. Stop this generation and wait for new instructions from the user; do not ask for confirmation again.",
      ]
    `)
    expect(receiptCount()).toBe(0)
  })
})

describe('U1-2 落 Nomi 兜底卡，人隔了 361 秒（越过回环 360 秒）才点', () => {
  async function fallbackAfter361(answer: unknown) {
    vi.useFakeTimers()
    const authorities = createDefaultAuthorities()
    const gate = nomiOnlyGate(launcherLoopback(fakeRpcFetch(authorities)))
    const pending = gate.requestGenerationConfirmation(projectionOf(gateChallenge()))
    const settled = pending.then((value) => ({ value }), (error: unknown) => ({ error }))
    await vi.advanceTimersByTimeAsync(361_000)
    renderer.asks[0]?.answer(answer)
    await vi.advanceTimersByTimeAsync(0)
    return settled
  }

  it('正半边：第 361 秒点「生成」→ 签出收据', async () => {
    const settled = await fallbackAfter361({ confirmed: true })
    expect('value' in settled ? settled.value : settled.error).toMatchObject({ confirmed: true, surface: 'nomi' })
    expect(await externalReceipt('value' in settled ? settled.value : {})).toMatchInlineSnapshot(`
      [
        "{
        "challenge": {
          "challengeId": "wire-challenge",
          "model": "m-x",
          "costScope": "generation_submit",
          "maximumCost": 3,
          "currency": "CNY",
          "expiresAt": "2099-01-01T00:00:00.000Z"
        },
        "confirmation": {
          "challengeId": "<challengeId>",
          "surface": "nomi",
          "nextAction": "in_nomi",
          "confirmed": true,
          "receiptId": "<receiptId>",
          "receiptToken": "<receiptToken>"
        },
        "approved": {
          "operationId": "op-1",
          "state": "authorized"
        },
        "started": {
          "operationId": "op-1",
          "state": "running"
        }
      }",
        "{
        "challenge": {
          "challengeId": "wire-challenge",
          "model": "m-x",
          "costScope": "generation_submit",
          "maximumCost": 3,
          "currency": "CNY",
          "expiresAt": "2099-01-01T00:00:00.000Z"
        },
        "confirmation": {
          "challengeId": "<challengeId>",
          "surface": "nomi",
          "nextAction": "in_nomi",
          "confirmed": true,
          "receiptId": "<receiptId>",
          "receiptToken": "<receiptToken>"
        },
        "approved": {
          "operationId": "op-1",
          "state": "authorized"
        },
        "started": {
          "operationId": "op-1",
          "state": "running"
        }
      }",
      ]
    `)
    expect(receiptCount()).toBe(1)
  })

  it('反半边：第 361 秒点「忽略」→ 不签', async () => {
    const settled = await fallbackAfter361({ confirmed: false })
    expect('value' in settled ? settled.value : settled.error).toMatchObject({ confirmed: false, surface: 'nomi' })
    expect(await externalReceipt('value' in settled ? settled.value : {})).toMatchInlineSnapshot(`
      [
        "未开始：请在当前客户端确认这次生成，或在唯一的 Nomi 兜底卡中确认。",
        "Not started: confirm this generation in the current client or in the single Nomi fallback card.",
      ]
    `)
    expect(receiptCount()).toBe(0)
  })
})

describe('U1-3 等待中客户端取消了这次调用（真回环）', () => {
  async function withServer(run: (instance: { port: number; token: string }) => Promise<void>) {
    const authorities = createDefaultAuthorities()
    const server = await startRpcServer({
      runTask: async () => ({ id: 't', status: 'succeeded', assets: [] }),
      confirmGenerationInNomi: authorities.confirmGenerationInNomi,
      verifyClientGenerationGateInMain: authorities.verifyClientGenerationGateInMain,
    } as never)
    try {
      await run({ port: server.port, token: ensureToken() })
    } finally {
      await server.close()
    }
  }

  it('反半边：取消之后再点 Nomi 卡 → 不签', async () => {
    await withServer(async (instance) => {
      const gate = nomiOnlyGate(launcherLoopback(fetch, instance))
      const controller = new AbortController()
      const settled = gate.requestGenerationConfirmation(projectionOf(gateChallenge()), controller.signal)
        .then((value) => ({ value }), (error: unknown) => ({ error }))
      await until(() => renderer.asks.length === 1, 'Nomi 兜底卡弹出')
      controller.abort(new Error('client cancelled the tool call'))
      const ended = await Promise.race([settled, new Promise((resolve) => setTimeout(() => resolve('still-waiting'), 1_000))])
      // 让主进程那边先看到连接断开，再模拟人回来点「生成」。
      await new Promise((resolve) => setTimeout(resolve, 100))
      renderer.asks[0]!.answer({ confirmed: true })
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(receiptCount()).toBe(0)
      expect(ended).not.toBe('still-waiting')
      const outcome = await settled
      expect('value' in outcome ? outcome.value.confirmed : false).toBe(false)
      expect('error' in outcome ? externalError(outcome.error) : await externalReceipt(outcome.value)).toMatchInlineSnapshot(`
        [
          "✗ client cancelled the tool call",
          "✗ client cancelled the tool call",
        ]
      `)
    })
  })

  it('正半边：不取消、点「生成」→ 签', async () => {
    await withServer(async (instance) => {
      const gate = nomiOnlyGate(launcherLoopback(fetch, instance))
      const pending = gate.requestGenerationConfirmation(projectionOf(gateChallenge()))
      await until(() => renderer.asks.length === 1, 'Nomi 兜底卡弹出')
      renderer.asks[0]!.answer({ confirmed: true })
      const result = await pending
      expect(result).toMatchObject({ confirmed: true, surface: 'nomi' })
      expect(await externalReceipt(result)).toMatchInlineSnapshot(`
        [
          "{
          "challenge": {
            "challengeId": "wire-challenge",
            "model": "m-x",
            "costScope": "generation_submit",
            "maximumCost": 3,
            "currency": "CNY",
            "expiresAt": "2099-01-01T00:00:00.000Z"
          },
          "confirmation": {
            "challengeId": "<challengeId>",
            "surface": "nomi",
            "nextAction": "in_nomi",
            "confirmed": true,
            "receiptId": "<receiptId>",
            "receiptToken": "<receiptToken>"
          },
          "approved": {
            "operationId": "op-1",
            "state": "authorized"
          },
          "started": {
            "operationId": "op-1",
            "state": "running"
          }
        }",
          "{
          "challenge": {
            "challengeId": "wire-challenge",
            "model": "m-x",
            "costScope": "generation_submit",
            "maximumCost": 3,
            "currency": "CNY",
            "expiresAt": "2099-01-01T00:00:00.000Z"
          },
          "confirmation": {
            "challengeId": "<challengeId>",
            "surface": "nomi",
            "nextAction": "in_nomi",
            "confirmed": true,
            "receiptId": "<receiptId>",
            "receiptToken": "<receiptToken>"
          },
          "approved": {
            "operationId": "op-1",
            "state": "authorized"
          },
          "started": {
            "operationId": "op-1",
            "state": "running"
          }
        }",
        ]
      `)
      expect(receiptCount()).toBe(1)
    })
  })
})

describe('U2-1 批准已被用掉，再拿同一张挑战来确认', () => {
  it('反半边（Nomi 卡）：不问人、不签', async () => {
    const authorities = createDefaultAuthorities()
    const challenge = gateChallenge()
    const first = authorities.confirmGenerationInNomi!({ challengeToken: challenge.token })
    await until(() => renderer.asks.length === 1, '第一次卡')
    renderer.asks[0]!.answer({ confirmed: true })
    const approved = await first as Record<string, unknown>
    authority.consumeReceipt(String(approved.receiptToken))
    const again = authorities.confirmGenerationInNomi!({ challengeToken: challenge.token }).then((value) => value as Record<string, unknown>)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(renderer.asks.length).toBe(1)
    renderer.asks[1]?.answer({ confirmed: true })
    const result = await again
    expect(result.confirmed).not.toBe(true)
    expect(await externalReceipt(result)).toMatchInlineSnapshot(`
      [
        "未开始：请在当前客户端确认这次生成，或在唯一的 Nomi 兜底卡中确认。",
        "Not started: confirm this generation in the current client or in the single Nomi fallback card.",
      ]
    `)
    expect(result.receiptToken).toBeUndefined()
  })

  it('反半边（客户端）：主进程不签；同一条连接上也不再拿缓存放行', async () => {
    const authorities = createDefaultAuthorities()
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(authorities)), elicit.client)
    const challenge = gateChallenge()
    const first = gate.requestGenerationConfirmation(projectionOf(challenge))
    await until(() => elicit.asks.length === 1, '第一次客户端确认')
    elicit.asks[0]!.answer(ACCEPT)
    const approved = await first
    authority.consumeReceipt(String(approved.receiptToken))
    const again = gate.requestGenerationConfirmation(projectionOf(challenge))
    await new Promise((resolve) => setTimeout(resolve, 20))
    elicit.asks[1]?.answer(ACCEPT)
    const result = await again
    expect(result.confirmed).toBe(false)
    expect(await externalReceipt(result)).toMatchInlineSnapshot(`
      [
        "未开始：请在当前客户端确认这次生成，或在唯一的 Nomi 兜底卡中确认。",
        "Not started: confirm this generation in the current client or in the single Nomi fallback card.",
      ]
    `)
    expect(result.receiptToken).toBeUndefined()
  })

  it('正半边：同一个 Run 下一次的新挑战照常问、答是就签', async () => {
    const authorities = createDefaultAuthorities()
    const gate = nomiOnlyGate(launcherLoopback(fakeRpcFetch(authorities)))
    const used = gateChallenge()
    const first = gate.requestGenerationConfirmation(projectionOf(used))
    await until(() => renderer.asks.length === 1, '第一次卡')
    renderer.asks[0]!.answer({ confirmed: true })
    authority.consumeReceipt(String((await first).receiptToken))
    const next = gateChallenge('generation_submit:op-1:digest-2', { contractHash: 'digest-2', targetHash: 'digest-2', pricingSnapshotHash: 'digest-2', gateId: 'gate-2' })
    const second = gate.requestGenerationConfirmation(projectionOf(next))
    await until(() => renderer.asks.length === 2, '新挑战的卡')
    renderer.asks[1]!.answer({ confirmed: true })
    const result = await second
    expect(result.confirmed).toBe(true)
    expect(await externalReceipt(result)).toMatchInlineSnapshot(`
      [
        "{
        "challenge": {
          "challengeId": "wire-challenge",
          "model": "m-x",
          "costScope": "generation_submit",
          "maximumCost": 3,
          "currency": "CNY",
          "expiresAt": "2099-01-01T00:00:00.000Z"
        },
        "confirmation": {
          "challengeId": "<challengeId>",
          "surface": "nomi",
          "nextAction": "in_nomi",
          "confirmed": true,
          "receiptId": "<receiptId>",
          "receiptToken": "<receiptToken>"
        },
        "approved": {
          "operationId": "op-1",
          "state": "authorized"
        },
        "started": {
          "operationId": "op-1",
          "state": "running"
        }
      }",
        "{
        "challenge": {
          "challengeId": "wire-challenge",
          "model": "m-x",
          "costScope": "generation_submit",
          "maximumCost": 3,
          "currency": "CNY",
          "expiresAt": "2099-01-01T00:00:00.000Z"
        },
        "confirmation": {
          "challengeId": "<challengeId>",
          "surface": "nomi",
          "nextAction": "in_nomi",
          "confirmed": true,
          "receiptId": "<receiptId>",
          "receiptToken": "<receiptToken>"
        },
        "approved": {
          "operationId": "op-1",
          "state": "authorized"
        },
        "started": {
          "operationId": "op-1",
          "state": "running"
        }
      }",
      ]
    `)
    expect(authority.verifyReceipt(String(result.receiptToken)).challengeId).toBe(next.challenge.challengeId)
  })
})

// ───────── 降档（以后 ¥X 内不再逐镜问）：挑战来源、确认、Run 边界 ─────────

function trustRun(revision: number, trustLevel = 'confirm_all'): ProductionRun {
  return {
    runId: 'run-1',
    revision,
    policy: { trustLevel },
    generationPlan: { costCertainty: 'known' },
    gates: [{
      gateId: 'gate-trust', scope: 'budget_envelope', status: 'approved', planHash: 'digest-trust', authorizationDigest: 'digest-trust',
      authorizationEnvelope: {
        immutableProjectUuid: 'uuid-1', projectGeneration: 1, projectRevision: 2, runId: 'run-1', planVersion: 1,
        budget: { currency: 'CNY', maximum: 9, ledgerCeiling: 20 },
        jobs: [{ shotId: 'shot-1', providerId: 'apimart', modelId: 'kling-v2', price: { currency: 'CNY', maximum: 9 } }],
      },
    }],
  } as unknown as ProductionRun
}

function trustCtx(run: () => ProductionRun) {
  return { productionRuns: { readFull: () => run() }, approvalReceiptAuthority: authority, projectRevisionResolver: () => 2 }
}

function setTrust(receiptToken: string): RunCommand {
  return {
    commandId: `set-trust-${receiptToken.slice(-6)}`,
    expectedRevision: 1,
    type: 'run.control',
    payload: { action: 'set_trust', trustLevel: 'budget_only', receiptToken },
    issuedAt: new Date().toISOString(),
  } as RunCommand
}

describe('U2-2 降档 → 调回 → 几分钟内再降档', () => {
  async function lowerTwice(secondAnswer: unknown) {
    const authorities = createDefaultAuthorities()
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(authorities)), elicit.client)
    let current = trustRun(5)
    const firstChallenge = issueTrustGrantChallenge(trustCtx(() => current), { projectId: 'project-1', runId: 'run-1' }) as GenerationGateChallengeProjection
    const first = gate.requestGenerationConfirmation(firstChallenge)
    await until(() => elicit.asks.length === 1, '第一次降档确认')
    elicit.asks[0]!.answer(ACCEPT)
    const approved = await first
    // Run 边界收下这张降档收据（set_trust 生效即用掉），之后用户调回逐镜确认：每个 Run 事件都让版本前进。
    authority.consumeReceipt(String(approved.receiptToken))
    current = trustRun(8)
    const secondChallenge = issueTrustGrantChallenge(trustCtx(() => current), { projectId: 'project-1', runId: 'run-1' }) as GenerationGateChallengeProjection
    const second = gate.requestGenerationConfirmation(secondChallenge)
    await new Promise((resolve) => setTimeout(resolve, 20))
    elicit.asks[1]?.answer(secondAnswer)
    return { asks: elicit.asks.length, first: approved, second: await second }
  }

  it('反半边：第二次要问人一次，答否不生效', async () => {
    const { asks, second } = await lowerTwice({ action: 'decline' })
    expect(asks).toBe(2)
    expect(second.confirmed).toBe(false)
    expect(await externalReceipt(second, true)).toMatchInlineSnapshot(`
      [
        "未开始：用户拒绝了这次请求，没有花费。请结束这次生成，等用户的新指令；不要再次发起确认。",
        "Not started: the user declined this request. Nothing was spent. Stop this generation and wait for new instructions from the user; do not ask for confirmation again.",
      ]
    `)
  })

  it('正半边：第二次答是 → 一张新的收据', async () => {
    const { asks, first, second } = await lowerTwice(ACCEPT)
    expect(asks).toBe(2)
    expect(second.confirmed).toBe(true)
    expect(await externalReceipt(second, true)).toMatchInlineSnapshot(`
      [
        "✓ 信任档位已改为：只管钱（跳过创意与样片门） · run-1
      接下来的创意方向门与样片门会自动通过；预算门仍会请示，不会偷偷花钱。",
        "✓ Trust level set to：budget only (skips creative + sample gates) · run-1
      Creative direction and sample gates will auto-approve from here; the budget gate still asks — nothing is spent silently.",
      ]
    `)
    expect(second.receiptId).not.toBe(first.receiptId)
  })
})

describe('降档晚到（预期变化第 9 行）：人第 301 秒才在客户端点「是」', () => {
  // 降档挑战按收据权威默认 5 分钟过期（本卡不改）。去掉 300 秒传输期限以后，晚到的「是」由主进程按「挑战已过期」拒签；
  // 今天是第 300 秒先回「确认超时」。两种结局都不生效、不签收据、不花钱。
  it('正半边：5 分钟内（第 200 秒）点「是」→ 签出降档收据', async () => {
    vi.useFakeTimers()
    const authorities = createDefaultAuthorities()
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(authorities)), elicit.client)
    const challenge = issueTrustGrantChallenge(trustCtx(() => trustRun(5)), { projectId: 'project-1', runId: 'run-1' }) as GenerationGateChallengeProjection
    const pending = gate.requestGenerationConfirmation(challenge)
    await vi.advanceTimersByTimeAsync(200_000)
    elicit.asks[0]!.answer(ACCEPT)
    await vi.advanceTimersByTimeAsync(0)
    const result = await pending
    expect(result).toMatchObject({ confirmed: true, surface: 'client' })
    expect(await externalReceipt(result, true)).toMatchInlineSnapshot(`
      [
        "✓ 信任档位已改为：只管钱（跳过创意与样片门） · run-1
      接下来的创意方向门与样片门会自动通过；预算门仍会请示，不会偷偷花钱。",
        "✓ Trust level set to：budget only (skips creative + sample gates) · run-1
      Creative direction and sample gates will auto-approve from here; the budget gate still asks — nothing is spent silently.",
      ]
    `)
    expect(authority.verifyReceipt(String(result.receiptToken)).decidedBy).toBe('human:elicitation')
  })

  it('反半边：主进程报挑战已过期：不签、降档不生效', async () => {
    vi.useFakeTimers()
    const authorities = createDefaultAuthorities()
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(authorities)), elicit.client)
    const challenge = issueTrustGrantChallenge(trustCtx(() => trustRun(5)), { projectId: 'project-1', runId: 'run-1' }) as GenerationGateChallengeProjection
    const pending = gate.requestGenerationConfirmation(challenge).then((value) => ({ value }), (error: unknown) => ({ error }))
    await vi.advanceTimersByTimeAsync(301_000)
    expect(elicit.asks).toHaveLength(1)
    elicit.asks[0]!.answer(ACCEPT)
    await vi.advanceTimersByTimeAsync(0)
    const settled = await pending
    // 和今天 Nomi 兜底卡晚点时同一句报错（收据权威的过期错误），不是「批准了」。
    expect(settled).toEqual({ error: expect.objectContaining({ message: 'Human approval challenge or receipt has expired' }) })
    expect(externalError('error' in settled ? settled.error : undefined)).toMatchInlineSnapshot(`
      [
        "✗ Human approval challenge or receipt has expired",
        "✗ Human approval challenge or receipt has expired",
      ]
    `)
    expect(receiptCount()).toBe(0)
  })
})

describe('U2-4 Run 边界：用掉的降档收据不能再让降档生效', () => {
  async function mintTrustReceipt(revision: number): Promise<string> {
    const authorities = createDefaultAuthorities()
    const challenge = issueTrustGrantChallenge(trustCtx(() => trustRun(revision)), { projectId: 'project-1', runId: 'run-1' }) as GenerationGateChallengeProjection
    const result = await (authorities.verifyClientGenerationGateInMain as unknown as AnyFn)({
      challengeToken: String(challenge.handoff!.challengeToken), authenticatedClient: 'codex', answer: { action: 'accept', confirm: true },
    }) as Record<string, unknown>
    return String(result.receiptToken)
  }

  it('反半边：调回之后拿已用掉的那张再降 → 拒', async () => {
    const owner = createGateApprovalOwner(authority, () => 2)
    const token = await mintTrustReceipt(5)
    const accepted = owner.verifyTrustGrant('project-1', 'run-1', trustRun(5), setTrust(token))
    owner.consume(accepted)
    let rejected: unknown
    try { owner.verifyTrustGrant('project-1', 'run-1', trustRun(9), setTrust(token)) } catch (error) { rejected = error }
    expect(rejected).toMatchObject({ code: 'human_approval_required' })
    expect(externalError(rejected)).toMatchInlineSnapshot(`
      [
        "✗ 这一步要你本人在 Nomi 里确认一次。",
        "✗ This step needs you to confirm it once in Nomi.",
      ]
    `)
  })

  it('正半边：新签的降档收据 → 生效', async () => {
    const owner = createGateApprovalOwner(authority, () => 2)
    const token = await mintTrustReceipt(5)
    expect(owner.verifyTrustGrant('project-1', 'run-1', trustRun(5), setTrust(token))?.receipt.decidedBy).toBe('human:elicitation')
    expect(await externalReceipt({ confirmed: true, receiptToken: token }, true)).toMatchInlineSnapshot(`
      [
        "✓ 信任档位已改为：只管钱（跳过创意与样片门） · run-1
      接下来的创意方向门与样片门会自动通过；预算门仍会请示，不会偷偷花钱。",
        "✓ Trust level set to：budget only (skips creative + sample gates) · run-1
      Creative direction and sample gates will auto-approve from here; the budget gate still asks — nothing is spent silently.",
      ]
    `)
  })
})

describe('D11 裸同意：没有主进程收据的「是」不算批准', () => {
  const bareChallenge = (): GenerationGateChallengeProjection => ({
    challengeId: 'c-bare', model: 'm-x', costScope: 'generation_submit', maximumCost: 3, currency: 'CNY', expiresAt: '2099-01-01T00:00:00.000Z',
  })

  it('反半边：没有客户端验证器、挑战不要求客户端证明 → 不算批准', async () => {
    const gate = createGenerationGateConfirmation({
      transport: { isAppOpen: () => false, getAuthenticatedClient: () => 'codex' },
      clientSupportsElicitation: () => true,
      elicitBooleanConfirm: async () => ({ supported: true, confirmed: true, action: 'accept' }),
    })
    expect((await gate.requestGenerationConfirmation(bareChallenge())).confirmed).toBe(false)
  })

  it('反半边：验证器只回一个 true（没有收据）→ 不算批准', async () => {
    const gate = createGenerationGateConfirmation({
      transport: { isAppOpen: () => false, getAuthenticatedClient: () => 'codex', verifyClientGenerationConfirmation: async () => true },
      clientSupportsElicitation: () => true,
      elicitBooleanConfirm: async () => ({ supported: true, confirmed: true, action: 'accept' }),
    })
    expect((await gate.requestGenerationConfirmation(bareChallenge())).confirmed).toBe(false)
  })

  it('正半边：有验证器、人答是 → 主进程签出收据，算批准', async () => {
    const authorities = createDefaultAuthorities()
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(authorities)), elicit.client)
    const pending = gate.requestGenerationConfirmation(projectionOf(gateChallenge()))
    await until(() => elicit.asks.length === 1, '客户端确认')
    elicit.asks[0]!.answer(ACCEPT)
    const result = await pending
    expect(result.confirmed).toBe(true)
    expect(await externalReceipt(result)).toMatchInlineSnapshot(`
      [
        "{
        "challenge": {
          "challengeId": "wire-challenge",
          "model": "m-x",
          "costScope": "generation_submit",
          "maximumCost": 3,
          "currency": "CNY",
          "expiresAt": "2099-01-01T00:00:00.000Z"
        },
        "confirmation": {
          "challengeId": "<challengeId>",
          "surface": "client",
          "nextAction": "in_client",
          "confirmed": true,
          "receiptId": "<receiptId>",
          "receiptToken": "<receiptToken>"
        },
        "approved": {
          "operationId": "op-1",
          "state": "authorized"
        },
        "started": {
          "operationId": "op-1",
          "state": "running"
        }
      }",
        "{
        "challenge": {
          "challengeId": "wire-challenge",
          "model": "m-x",
          "costScope": "generation_submit",
          "maximumCost": 3,
          "currency": "CNY",
          "expiresAt": "2099-01-01T00:00:00.000Z"
        },
        "confirmation": {
          "challengeId": "<challengeId>",
          "surface": "client",
          "nextAction": "in_client",
          "confirmed": true,
          "receiptId": "<receiptId>",
          "receiptToken": "<receiptToken>"
        },
        "approved": {
          "operationId": "op-1",
          "state": "authorized"
        },
        "started": {
          "operationId": "op-1",
          "state": "running"
        }
      }",
      ]
    `)
    expect(authority.verifyReceipt(String(result.receiptToken)).decidedBy).toBe('human:elicitation')
  })
})

describe('U2-3 客户端路（预期变化）：已批未用再确认，再问一次人，交回同一张', () => {
  it('同一条连接上第二次确认会再问人，主进程交回同一张未用的收据', async () => {
    const authorities = createDefaultAuthorities()
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(authorities)), elicit.client)
    const challenge = gateChallenge()
    const first = gate.requestGenerationConfirmation(projectionOf(challenge))
    await until(() => elicit.asks.length === 1, '第一次')
    elicit.asks[0]!.answer(ACCEPT)
    const approved = await first
    const again = gate.requestGenerationConfirmation(projectionOf(challenge))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(elicit.asks).toHaveLength(2)
    elicit.asks[1]!.answer(ACCEPT)
    const result = await again
    expect(result.receiptId).toBe(approved.receiptId)
    expect(await externalReceipt(result)).toMatchInlineSnapshot(`
      [
        "{
        "challenge": {
          "challengeId": "wire-challenge",
          "model": "m-x",
          "costScope": "generation_submit",
          "maximumCost": 3,
          "currency": "CNY",
          "expiresAt": "2099-01-01T00:00:00.000Z"
        },
        "confirmation": {
          "challengeId": "<challengeId>",
          "surface": "client",
          "nextAction": "in_client",
          "confirmed": true,
          "receiptId": "<receiptId>",
          "receiptToken": "<receiptToken>"
        },
        "approved": {
          "operationId": "op-1",
          "state": "authorized"
        },
        "started": {
          "operationId": "op-1",
          "state": "running"
        }
      }",
        "{
        "challenge": {
          "challengeId": "wire-challenge",
          "model": "m-x",
          "costScope": "generation_submit",
          "maximumCost": 3,
          "currency": "CNY",
          "expiresAt": "2099-01-01T00:00:00.000Z"
        },
        "confirmation": {
          "challengeId": "<challengeId>",
          "surface": "client",
          "nextAction": "in_client",
          "confirmed": true,
          "receiptId": "<receiptId>",
          "receiptToken": "<receiptToken>"
        },
        "approved": {
          "operationId": "op-1",
          "state": "authorized"
        },
        "started": {
          "operationId": "op-1",
          "state": "running"
        }
      }",
      ]
    `)
    expect(receiptCount()).toBe(1)
  })
})

it('U2-3 客户端反半边：已批未用，再问时答否就不放行', async () => {
  const authorities = createDefaultAuthorities()
  const elicit = elicitationHarness()
  const gate = clientGate(launcherLoopback(fakeRpcFetch(authorities)), elicit.client)
  const challenge = projectionOf(gateChallenge())
  const first = gate.requestGenerationConfirmation(challenge)
  await until(() => elicit.asks.length === 1, '第一次')
  elicit.asks[0]!.answer(ACCEPT)
  await first
  const second = gate.requestGenerationConfirmation(challenge)
  await new Promise((resolve) => setTimeout(resolve, 20))
  elicit.asks[1]?.answer({ action: 'decline' })
  const answer = await second
  expect(answer.confirmed).toBe(false)
  expect(await externalReceipt(answer)).toMatchInlineSnapshot(`
    [
      "未开始：用户拒绝了这次请求，没有花费。请结束这次生成，等用户的新指令；不要再次发起确认。",
      "Not started: the user declined this request. Nothing was spent. Stop this generation and wait for new instructions from the user; do not ask for confirmation again.",
    ]
  `)
})

// ───────────────────────────── 不变行（对拍） ─────────────────────────────

describe('不变行：界面出口同一输入同一说法、同一动作', () => {
  it('Nomi 兜底卡收到的内容逐字不变', async () => {
    const authorities = createDefaultAuthorities()
    const challenge = gateChallenge()
    const pending = authorities.confirmGenerationInNomi!({ challengeToken: challenge.token })
    await until(() => renderer.asks.length === 1, '卡')
    expect(renderer.asks[0]!.channel).toBe('generation.gate.confirm')
    expect(renderer.asks[0]!.payload).toEqual({
      challengeId: challenge.challenge.challengeId,
      projectName: '短片',
      shotSummary: '3 镜',
      model: 'm-x',
      referenceCount: 0,
      maximumCost: 3,
      currency: 'CNY',
      expiresAt: challenge.challenge.expiresAt,
    })
    renderer.asks[0]!.answer(null)
    await pending
  })

  it('D5 应用内卡点「忽略」→ 拒绝；渲染端没应答 → 不是拒绝', async () => {
    const authorities = createDefaultAuthorities()
    const challenge = gateChallenge()
    const ignored = authorities.confirmGenerationInNomi!({ challengeToken: challenge.token })
    await until(() => renderer.asks.length === 1, '卡')
    renderer.asks[0]!.answer({ confirmed: false })
    expect(await ignored).toEqual({ confirmed: false, challengeId: challenge.challenge.challengeId, declined: true })
    const silent = authorities.confirmGenerationInNomi!({ challengeToken: challenge.token })
    await until(() => renderer.asks.length === 2, '卡 2')
    renderer.asks[1]!.answer(null)
    expect(await silent).toEqual({ confirmed: false, challengeId: challenge.challenge.challengeId })
    expect(receiptCount()).toBe(0)
  })

  it('试拍首镜：卡上点「先试拍第 1 镜」→ 交给收窄，不算批准', async () => {
    const onTrialFirst = vi.fn()
    const authorities = createDefaultAuthorities({ onTrialFirst })
    const challenge = gateChallenge()
    const pending = authorities.confirmGenerationInNomi!({ challengeToken: challenge.token })
    await until(() => renderer.asks.length === 1, '卡')
    renderer.asks[0]!.answer({ confirmed: false, trialFirst: true })
    expect(await pending).toEqual({ confirmed: false, challengeId: challenge.challenge.challengeId, trialFirst: true })
    expect(onTrialFirst).toHaveBeenCalledWith({ projectId: 'project-1', operationId: 'op-1' })
  })

  it('D5 外部走 Nomi 兜底卡点「忽略」→ 回执仍是「还没确认」（回环把「忽略」丢了，现状）', async () => {
    const authorities = createDefaultAuthorities()
    const gate = nomiOnlyGate(launcherLoopback(fakeRpcFetch(authorities)))
    const challenge = gateChallenge()
    const pending = gate.requestGenerationConfirmation(projectionOf(challenge))
    await until(() => renderer.asks.length === 1, '卡')
    renderer.asks[0]!.answer({ confirmed: false })
    expect(await pending).toEqual({ challengeId: challenge.challenge.challengeId, confirmed: false, surface: 'nomi', nextAction: 'wait_for_reconciliation' })
  })

  it('D5 客户端 cancel 与 decline → 拒绝；D6 accept 但 confirm=false → 拒绝且不落 Nomi', async () => {
    for (const answer of [{ action: 'cancel' }, { action: 'decline' }, { action: 'accept', content: { confirm: false } }]) {
      const authorities = createDefaultAuthorities()
      const elicit = elicitationHarness()
      const gate = clientGate(launcherLoopback(fakeRpcFetch(authorities)), elicit.client, true)
      const pending = gate.requestGenerationConfirmation(projectionOf(gateChallenge(`k-${answer.action}-${JSON.stringify(answer)}`)))
      await until(() => elicit.asks.length === 1, '客户端确认')
      elicit.asks[0]!.answer(answer)
      expect(await pending).toMatchObject({ confirmed: false, surface: 'client', denial: 'declined' })
    }
    expect(renderer.asks.length).toBe(0)
    expect(receiptCount()).toBe(0)
  })

  it('D8 停止信号在等答时到 → 客户端路抛取消，不产批准', async () => {
    const authorities = createDefaultAuthorities()
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(authorities)), elicit.client)
    const controller = new AbortController()
    const pending = gate.requestGenerationConfirmation(projectionOf(gateChallenge()), controller.signal)
    await until(() => elicit.asks.length === 1, '客户端确认')
    controller.abort(new Error('stopped'))
    await expect(pending).rejects.toThrow('stopped')
    expect(receiptCount()).toBe(0)
  })

  it('D12 elicitation 遇到对端内部错误 → 归「没人及时答复」', async () => {
    const authorities = createDefaultAuthorities()
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(authorities)), elicit.client)
    const pending = gate.requestGenerationConfirmation(projectionOf(gateChallenge()))
    await until(() => elicit.asks.length === 1, '客户端确认')
    elicit.asks[0]!.fail(new Error('Internal error'))
    expect(await pending).toMatchObject({ confirmed: false, denial: 'timeout' })
  })

  it('U2-3 应用内：已批未用再确认 → 照旧再弹卡，交回同一张', async () => {
    const authorities = createDefaultAuthorities()
    const challenge = gateChallenge()
    const first = authorities.confirmGenerationInNomi!({ challengeToken: challenge.token })
    await until(() => renderer.asks.length === 1, '卡')
    renderer.asks[0]!.answer({ confirmed: true })
    const approved = await first as Record<string, unknown>
    const second = authorities.confirmGenerationInNomi!({ challengeToken: challenge.token })
    await until(() => renderer.asks.length === 2, '再弹')
    renderer.asks[1]!.answer({ confirmed: true })
    expect((await second as Record<string, unknown>).receiptId).toBe(approved.receiptId)
    expect(receiptCount()).toBe(1)
  })

  it('文稿 / 时间线 / 方案确认仍是 300 秒', async () => {
    const elicit = elicitationHarness()
    const pending = elicit.client.booleanConfirm({ message: 'm', title: 't', description: 'd' })
    await until(() => elicit.asks.length === 1, '确认')
    expect(elicit.asks[0]!.timeoutMs).toBe(300_000)
    elicit.asks[0]!.answer({ action: 'accept', content: { confirm: true } })
    expect(await pending).toMatchObject({ supported: true, confirmed: true, action: 'accept' })
  })

  it('第一次降档：答是 → 收据在 Run 边界生效', async () => {
    const authorities = createDefaultAuthorities()
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(authorities)), elicit.client)
    const challenge = issueTrustGrantChallenge(trustCtx(() => trustRun(3)), { projectId: 'project-1', runId: 'run-1' }) as GenerationGateChallengeProjection
    const pending = gate.requestGenerationConfirmation(challenge)
    await until(() => elicit.asks.length === 1, '降档确认')
    elicit.asks[0]!.answer(ACCEPT)
    const result = await pending
    const owner = createGateApprovalOwner(authority, () => 2)
    expect(owner.verifyTrustGrant('project-1', 'run-1', trustRun(3), setTrust(String(result.receiptToken)))?.receipt.receiptId).toBe(result.receiptId)
  })
})

// 返工确认与面板卡 / 画布：都已经走主进程生成门。钉住「每次是新挑战」与「同一份信封一次写完」。
function reworkAuthorization(gateId: string, digest: string) {
  return {
    authorizationDigest: digest,
    envelope: {
      immutableProjectUuid: 'uuid-1', projectGeneration: 1, projectId: 'project-1', runId: 'op-r', gateId,
      projectRevision: 2, costScope: 'generation_submit', budget: { currency: 'CNY', maximum: 2 },
    },
  } as never
}

function fakeRunOwner() {
  let revision = 1
  const commands: RunCommand[] = []
  return {
    commands,
    readFull: () => ({ revision }) as unknown as ProductionRun,
    command: async (_projectId: string, _runId: string, command: RunCommand) => {
      commands.push(command)
      revision += 1
      return { run: { revision } as unknown as ProductionRun }
    },
  }
}

describe('不变行：返工确认、面板卡、画布', () => {
  it('两次返工各是一张新挑战，各问一次人，答是就批', async () => {
    const authorities = createDefaultAuthorities()
    const owner = fakeRunOwner()
    const lease = { immutableProjectUuid: 'uuid-1', projectGeneration: 1, projectId: 'project-1', revocationEpoch: 0 } as never
    for (const [index, gateId] of ['gate-r1', 'gate-r2'].entries()) {
      const decided = decideRunOwnedGenerationGate({
        owner: owner as never,
        receipts: authority,
        confirm: authorities.confirmGenerationInNomi!,
        lease,
        operationId: 'op-r',
        authorization: reworkAuthorization(gateId, `digest-${gateId}`),
        display: { model: 'm-x' },
        commandPrefix: 'rework',
      })
      await until(() => renderer.asks.length === index + 1, `第 ${index + 1} 次返工卡`)
      renderer.asks[index]!.answer({ confirmed: true })
      expect((await decided).approved).toBe(true)
    }
    expect(new Set(renderer.asks.map((ask) => ask.payload.challengeId)).size).toBe(2)
    expect(owner.commands.map((command) => command.payload.status)).toEqual(['approved', 'approved'])
  })

  it('返工卡点「忽略」→ 门被否决', async () => {
    const authorities = createDefaultAuthorities()
    const owner = fakeRunOwner()
    const decided = decideRunOwnedGenerationGate({
      owner: owner as never,
      receipts: authority,
      confirm: authorities.confirmGenerationInNomi!,
      lease: { immutableProjectUuid: 'uuid-1', projectGeneration: 1, projectId: 'project-1', revocationEpoch: 0 } as never,
      operationId: 'op-r',
      authorization: reworkAuthorization('gate-r3', 'digest-r3'),
      display: { model: 'm-x' },
      commandPrefix: 'rework',
    })
    await until(() => renderer.asks.length === 1, '返工卡')
    renderer.asks[0]!.answer({ confirmed: false })
    expect((await decided).approved).toBe(false)
    expect(owner.commands[0]!.payload.status).toBe('rejected')
  })

  it('面板卡 / 画布 ↑ / 「直接生成」档：主进程一次写完，重试拿回同一张', () => {
    const base = {
      receipts: authority,
      lease: { immutableProjectUuid: 'uuid-1', projectGeneration: 1, projectId: 'project-1', revocationEpoch: 0 } as never,
      operationId: 'op-r',
      authorization: reworkAuthorization('gate-p1', 'digest-p1'),
      display: { model: 'm-x' },
      commandPrefix: 'panel',
      issuedAt: new Date().toISOString(),
    }
    const gesture = mainProcessGateApproval({ ...base, decision: { kind: 'gesture', webContentsId: 7, frameId: 1, origin: 'app://nomi' } })
    const retry = mainProcessGateApproval({ ...base, decision: { kind: 'gesture', webContentsId: 7, frameId: 1, origin: 'app://nomi' } })
    expect(gesture.payload.status).toBe('approved')
    expect(retry.commandId).toBe(gesture.commandId)
    const policy = mainProcessGateApproval({ ...base, authorization: reworkAuthorization('gate-p2', 'digest-p2'), decision: { kind: 'policy', policyMode: 'project', policySurface: 'canvas' } })
    expect(policy.payload.status).toBe('approved')
  })
})


describe('对拍 D1/D2/D4/D9：基线与本提交逐字同回执', () => {
  it('对拍 D1：直接生成策略签发；外部照样问真人，答否原句不变', async () => {
    const run = {
      status: 'running', gates: [],
      generationPlan: { shots: [{ shotId: 'shot-1', included: true }] },
      jobs: [{ jobId: 'job-1', stageId: 'generate', status: 'failed', attempt: 1, createdAt: '2026-11-21T00:00:00.000Z', metadata: { shotId: 'shot-1' } }],
    } as unknown as ProductionRun
    expect(spendDecisionByPolicy({ mode: 'direct' }, run).decided).toBe(true)
    const policy = mainProcessGateApproval({
      receipts: authority, lease: { immutableProjectUuid: 'uuid-1', projectGeneration: 1, revocationEpoch: 0 } as never,
      operationId: 'op-r', authorization: reworkAuthorization('d1-gate', 'd1-digest'), display: { model: 'm-x' },
      commandPrefix: 'd1', issuedAt: new Date().toISOString(), decision: { kind: 'policy', policyMode: 'project', policySurface: 'canvas' },
    })
    expect(policy.payload.status).toBe('approved')
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(createDefaultAuthorities())), elicit.client)
    const pending = gate.requestGenerationConfirmation(projectionOf(gateChallenge('d1-external')))
    await until(() => elicit.asks.length === 1, '外部仍问人')
    elicit.asks[0]!.answer({ action: 'decline' })
    expect(await externalReceipt(await pending)).toMatchInlineSnapshot(`
      [
        "未开始：用户拒绝了这次请求，没有花费。请结束这次生成，等用户的新指令；不要再次发起确认。",
        "Not started: the user declined this request. Nothing was spent. Stop this generation and wait for new instructions from the user; do not ask for confirmation again.",
      ]
    `)
  })

  it('对拍 D2：Nomi 未开、客户端能问，拒绝回执不说已开始', async () => {
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(createDefaultAuthorities())), elicit.client, false)
    const pending = gate.requestGenerationConfirmation(projectionOf(gateChallenge('d2')))
    await until(() => elicit.asks.length === 1, '客户端确认')
    elicit.asks[0]!.answer({ action: 'decline' })
    expect(renderer.asks).toHaveLength(0)
    expect(await externalReceipt(await pending)).toMatchInlineSnapshot(`
      [
        "未开始：用户拒绝了这次请求，没有花费。请结束这次生成，等用户的新指令；不要再次发起确认。",
        "Not started: the user declined this request. Nothing was spent. Stop this generation and wait for new instructions from the user; do not ask for confirmation again.",
      ]
    `)
  })

  it('对拍 D4：普通生成只有当次确认；非正数降档不弹、回执逐字不变', async () => {
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(createDefaultAuthorities())), elicit.client)
    const challenge = { ...projectionOf(gateChallenge('d4')), expiresAt: '2099-01-01T00:00:00.000Z' }
    const pending = gate.requestGenerationConfirmation(challenge)
    await until(() => elicit.asks.length === 1, '只有当次确认')
    expect(elicit.asks[0]!.params).toMatchInlineSnapshot(`
      {
        "message": "允许 Nomi 在当前项目使用模型 m-x，生成这一镜：
      · m-x
      合计最多 CNY3。",
        "requestedSchema": {
          "properties": {
            "confirm": {
              "description": "有效期至 2099-01-01T00:00:00.000Z",
              "title": "确认这次生成",
              "type": "boolean",
            },
          },
          "required": [
            "confirm",
          ],
          "type": "object",
        },
      }
    `)
    elicit.asks[0]!.answer({ action: 'decline' })
    expect(await externalReceipt(await pending)).toMatchInlineSnapshot(`
      [
        "未开始：用户拒绝了这次请求，没有花费。请结束这次生成，等用户的新指令；不要再次发起确认。",
        "Not started: the user declined this request. Nothing was spent. Stop this generation and wait for new instructions from the user; do not ask for confirmation again.",
      ]
    `)
    for (const maximum of [0, -1]) {
      const result = await gate.requestGenerationConfirmation({ ...challenge, challengeId: `d4-${maximum}`, trustGrant: { currency: 'CNY', maximum } })
      expect(result.confirmed).toBe(false)
      expect(await externalReceipt(result, true)).toMatchInlineSnapshot(`
        [
          "未生效：你的 AI 客户端和 Nomi 窗口都没能向你征求这次花费授权的确认。",
          "Not applied: neither your AI client nor an open Nomi window could ask you to confirm this spending change.",
        ]
      `)
    }
    expect(elicit.asks).toHaveLength(1)
  })

  it('对拍 D9：全部未知价仍问、原句说事后才知道，拒绝回执不变', async () => {
    const elicit = elicitationHarness()
    const gate = clientGate(launcherLoopback(fakeRpcFetch(createDefaultAuthorities())), elicit.client)
    const pending = gate.requestGenerationConfirmation({ ...projectionOf(gateChallenge('d9')), maximumCost: null, unknownShotCount: 1, expiresAt: '2099-01-01T00:00:00.000Z' })
    await until(() => elicit.asks.length === 1, '未知价确认')
    expect(elicit.asks[0]!.params).toMatchInlineSnapshot(`
      {
        "message": "允许 Nomi 在当前项目使用模型 m-x，生成这一镜：
      · m-x
      这批镜头目录里都没有标价，花多少事后才知道。要继续就得接受「花多少事后才知道」。",
        "requestedSchema": {
          "properties": {
            "confirm": {
              "description": "有效期至 2099-01-01T00:00:00.000Z",
              "title": "确认这次生成",
              "type": "boolean",
            },
          },
          "required": [
            "confirm",
          ],
          "type": "object",
        },
      }
    `)
    elicit.asks[0]!.answer({ action: 'decline' })
    expect(await externalReceipt(await pending)).toMatchInlineSnapshot(`
      [
        "未开始：用户拒绝了这次请求，没有花费。请结束这次生成，等用户的新指令；不要再次发起确认。",
        "Not started: the user declined this request. Nothing was spent. Stop this generation and wait for new instructions from the user; do not ask for confirmation again.",
      ]
    `)
  })
})
