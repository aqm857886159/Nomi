import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { runAgentProbe } from './_agentProbe.mjs'

const request = {
  prompt: 'capture, never execute', capability: 'storyboard', history: { kind: 'ephemeral' },
  featureKey: 'probe-unit', agentModelKey: 'fixture-model', agentVendorKey: 'fixture-vendor',
}
const usage = { promptTokens: 23, completionTokens: 8, cachedPromptTokens: 4, totalTokens: 31 }
const response = {
  id: 'result-1', text: 'stable final text', status: 'finished', toolCalls: [], artifacts: [],
  usage, finishReason: 'stop',
}
const pending = { type: 'tool-call-pending', toolCallId: 'call-1', toolName: 'propose_storyboard_plan', args: { title: 'captured' } }

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function publicBridge({ start, confirm, cancel, subscribe } = {}) {
  const listeners = new Map()
  const order = []
  const calls = { starts: [], confirmations: [], cancellations: [], offs: [] }
  const emit = (requestId, event) => listeners.get(requestId)?.(event)
  const bridge = {
    onChatV2Event(requestId, listener) {
      order.push('subscribe')
      if (subscribe) subscribe()
      listeners.set(requestId, listener)
      return () => { calls.offs.push(requestId); listeners.delete(requestId) }
    },
    chatV2Start(payload) {
      order.push('start')
      calls.starts.push(payload)
      return start ? start(payload, emit) : Promise.resolve({ sessionId: payload.requestId })
    },
    confirmTool(...args) {
      calls.confirmations.push(args)
      return confirm ? confirm(...args) : Promise.resolve({ ok: true })
    },
    cancelChatV2(requestId) {
      calls.cancellations.push(requestId)
      return cancel ? cancel(requestId) : Promise.resolve({ ok: true })
    },
  }
  return { bridge, calls, order, listeners, emit }
}

function finish(fake, result = response) {
  const id = fake.calls.starts[0].requestId
  fake.emit(id, { type: 'result', result })
  fake.emit(id, { type: 'done', reason: result.status })
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('public Agent probe lifecycle', () => {
  test('generates an id and subscribes before start so synchronous early events are retained', async () => {
    const fake = publicBridge({ start: (payload, emit) => {
      emit(payload.requestId, { type: 'content-delta', delta: 'early text' })
      emit(payload.requestId, { type: 'result', result: response })
      emit(payload.requestId, { type: 'done', reason: 'finished' })
      return Promise.resolve({ sessionId: payload.requestId })
    } })
    const outcome = await runAgentProbe({ request, timeoutMs: 1000 }, fake.bridge)
    expect(fake.order).toEqual(['subscribe', 'start'])
    expect(fake.calls.starts).toEqual([{ requestId: expect.stringMatching(/^[A-Za-z0-9._:-]{1,160}$/), request }])
    expect(outcome).toMatchObject({ ok: true, done: true, result: response, text: response.text, error: '', timedOut: false })
    expect(outcome.requestId).toBe(fake.calls.starts[0].requestId)
    expect(fake.calls.offs).toEqual([outcome.requestId])
    expect(fake.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('real done completes before a late start ACK and cannot be reopened by that ACK', async () => {
    const ack = deferred()
    const fake = publicBridge({ start: () => ack.promise })
    const running = runAgentProbe({ request, timeoutMs: 1000 }, fake.bridge)
    finish(fake)
    await expect(running).resolves.toMatchObject({ ok: true, done: true, result: response })
    ack.resolve({ sessionId: fake.calls.starts[0].requestId })
    await ack.promise
    expect(fake.order).toEqual(['subscribe', 'start'])
    expect(fake.calls.cancellations).toEqual([])
    expect(fake.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('error does not unsubscribe or resolve before the real result usage and done arrive', async () => {
    const fake = publicBridge()
    const running = runAgentProbe({ request, timeoutMs: 1000 }, fake.bridge)
    const id = fake.calls.starts[0].requestId
    let settled = false
    void running.then(() => { settled = true })
    fake.emit(id, { type: 'content-delta', delta: 'partial text' })
    fake.emit(id, { type: 'error', message: 'persistence failed' })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(fake.listeners.size).toBe(1)
    const failed = { ...response, status: 'error', finishReason: 'error' }
    fake.emit(id, { type: 'result', result: failed })
    await Promise.resolve()
    expect(settled).toBe(false)
    fake.emit(id, { type: 'done', reason: 'error' })
    expect(await running).toMatchObject({ ok: false, done: true, result: failed, text: failed.text, error: 'persistence failed' })
    expect((await running).result.usage).toEqual(usage)
    expect(fake.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('denies every complete pending tool once by id, not activity events or partial duplicates', async () => {
    const fake = publicBridge()
    const running = runAgentProbe({ request, timeoutMs: 1000 }, fake.bridge)
    const id = fake.calls.starts[0].requestId
    fake.emit(id, { ...pending, type: 'tool-call' })
    fake.emit(id, { type: 'tool-call-pending', toolCallId: 'call-1', toolName: pending.toolName })
    expect(fake.calls.confirmations).toEqual([])
    fake.emit(id, pending)
    fake.emit(id, pending)
    fake.emit(id, { ...pending, toolCallId: 'call-2', toolName: 'create_staging_reference', args: { characters: [] } })
    finish(fake)
    const outcome = await running
    expect(fake.calls.confirmations).toEqual([
      [id, 'call-1', { ok: false, denied: true, message: expect.any(String) }],
      [id, 'call-2', { ok: false, denied: true, message: expect.any(String) }],
    ])
    expect(outcome.calls).toEqual([
      { toolCallId: 'call-1', toolName: pending.toolName, args: pending.args },
      { toolCallId: 'call-2', toolName: 'create_staging_reference', args: { characters: [] } },
    ])
    expect(outcome.ok).toBe(true)
    expect(fake.calls.cancellations).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  test('waits for denial ACKs before success and makes failed denial explicit without losing usage', async () => {
    const denial = deferred()
    const fake = publicBridge({ confirm: () => denial.promise })
    const running = runAgentProbe({ request, timeoutMs: 1000 }, fake.bridge)
    const id = fake.calls.starts[0].requestId
    let settled = false
    void running.then(() => { settled = true })
    fake.emit(id, pending)
    finish(fake)
    await Promise.resolve()
    expect(settled).toBe(false)
    denial.resolve({ ok: false, error: 'owner mismatch' })
    const outcome = await running
    expect(outcome).toMatchObject({ ok: false, done: true, result: response })
    expect(outcome.error).toContain('owner mismatch')
    expect(fake.calls.cancellations).toEqual([id])
    expect(fake.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('captures rejected tool-denial IPC, cancels, and continues until result plus done', async () => {
    const denied = deferred()
    const fake = publicBridge({ confirm: () => denied.promise })
    const running = runAgentProbe({ request, timeoutMs: 1000 }, fake.bridge)
    fake.emit(fake.calls.starts[0].requestId, pending)
    denied.reject(new Error('denial IPC unavailable'))
    await denied.promise.catch(() => undefined)
    await Promise.resolve()
    finish(fake, { ...response, status: 'cancelled', finishReason: 'aborted' })
    const outcome = await running
    expect(outcome.ok).toBe(false)
    expect(outcome.done).toBe(true)
    expect(outcome.result.usage).toEqual(usage)
    expect(outcome.error).toContain('denial IPC unavailable')
    expect(fake.calls.cancellations).toEqual([outcome.requestId])
    expect(vi.getTimerCount()).toBe(0)
  })

  test('timeout is failure even after partial/result events and cancels without waiting on cancel IPC', async () => {
    const cancel = deferred()
    const fake = publicBridge({ cancel: () => cancel.promise })
    const running = runAgentProbe({ request, timeoutMs: 1000 }, fake.bridge)
    const id = fake.calls.starts[0].requestId
    fake.emit(id, pending)
    fake.emit(id, { type: 'result', result: response })
    await vi.advanceTimersByTimeAsync(1000)
    const outcome = await running
    expect(outcome).toMatchObject({ ok: false, done: false, timedOut: true, result: response })
    expect(outcome.error).toMatch(/timeout/i)
    expect(fake.calls.cancellations).toEqual([id])
    expect(fake.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    cancel.reject(new Error('cancel IPC unavailable'))
    await cancel.promise.catch(() => undefined)
  })

  test('timeout before ACK cancels the known id and a late ACK triggers a final cancellation attempt', async () => {
    const ack = deferred()
    const fake = publicBridge({ start: () => ack.promise })
    const running = runAgentProbe({ request, timeoutMs: 1000 }, fake.bridge)
    const id = fake.calls.starts[0].requestId
    await vi.advanceTimersByTimeAsync(1000)
    await expect(running).resolves.toMatchObject({ ok: false, timedOut: true, done: false })
    expect(fake.calls.cancellations).toEqual([id])
    ack.resolve({ sessionId: id })
    await ack.promise
    expect(fake.calls.cancellations).toEqual([id, id])
    expect(fake.calls.offs).toEqual([id])
    expect(vi.getTimerCount()).toBe(0)
  })

  test.each(['throw', 'reject'])('captures %s from start and releases its listener/timer', async (kind) => {
    const fake = publicBridge({ start: () => {
      if (kind === 'throw') throw new Error('start unavailable')
      return Promise.reject(new Error('start unavailable'))
    } })
    const outcome = await runAgentProbe({ request, timeoutMs: 1000 }, fake.bridge)
    expect(outcome).toMatchObject({ ok: false, done: false, result: null, timedOut: false })
    expect(outcome.error).toContain('start unavailable')
    expect(fake.listeners.size).toBe(0)
    expect(fake.calls.offs).toEqual([outcome.requestId])
    expect(vi.getTimerCount()).toBe(0)
  })

  test('captures subscription failure before invoking start', async () => {
    const fake = publicBridge({ subscribe: () => { throw new Error('subscribe unavailable') } })
    const outcome = await runAgentProbe({ request, timeoutMs: 1000 }, fake.bridge)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('subscribe unavailable')
    expect(fake.calls.starts).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  test.each([
    { name: 'missing result', result: null, reason: 'finished' },
    { name: 'cancelled', result: { ...response, status: 'cancelled', finishReason: 'aborted' }, reason: 'cancelled' },
    { name: 'error status without error event', result: { ...response, status: 'error', finishReason: 'error' }, reason: 'error' },
  ])('$name cannot become success based on observed tool or text', async ({ result, reason }) => {
    const fake = publicBridge()
    const running = runAgentProbe({ request, timeoutMs: 1000 }, fake.bridge)
    const id = fake.calls.starts[0].requestId
    fake.emit(id, { type: 'content-delta', delta: 'partial' })
    fake.emit(id, { ...pending, type: 'tool-call' })
    if (result) fake.emit(id, { type: 'result', result })
    fake.emit(id, { type: 'done', reason })
    const outcome = await running
    expect(outcome.ok).toBe(false)
    expect(outcome.done).toBe(true)
    expect(outcome.error).not.toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })

  test('is self-contained when serialized into the page and allocates a fresh id for each run', async () => {
    const fake = publicBridge({ start: (payload, emit) => {
      emit(payload.requestId, { type: 'result', result: response })
      emit(payload.requestId, { type: 'done', reason: 'finished' })
      return Promise.resolve({ sessionId: payload.requestId })
    } })
    const inPage = vm.runInNewContext(`(${runAgentProbe.toString()})`, {
      window: { nomiDesktop: { agents: fake.bridge } }, crypto: globalThis.crypto, setTimeout, clearTimeout,
    })
    expect((await inPage({ request, timeoutMs: 1000 })).ok).toBe(true)
    expect((await inPage({ request, timeoutMs: 1000 })).ok).toBe(true)
    expect(new Set(fake.calls.starts.map((item) => item.requestId)).size).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})

function nodes(root, predicate) {
  const found = []
  const visit = (node) => {
    if (predicate(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

function property(object, name) {
  return object?.properties?.find((node) => ts.isPropertyAssignment(node) && node.name.getText() === name)?.initializer
}

describe('five real-vendor probes use the public D2 observer', () => {
  test.each([
    ['apimart-text-brain.e2e.mjs', 'storyboard', 'probe-text-brain'],
    ['modelscope-expand.e2e.mjs', 'storyboard', 'ms-probe'],
    ['staging-reference.e2e.mjs', 'canvas-agent', 'probe-staging'],
    ['staging-agent-eval.e2e.mjs', 'canvas-agent', 'probe-agent-eval'],
    ['storyboard-methodology.walk.mjs', 'storyboard', 'r16-storyboard-methodology'],
  ])('%s has explicit ephemeral attribution and gates success on actual completion', (name, capability, featureKey) => {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8')
    const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    expect(nodes(ast, (node) => ts.isImportDeclaration(node) && node.moduleSpecifier.text === './_agentProbe.mjs')).toHaveLength(1)
    const calls = nodes(ast, (node) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'evaluate' && node.arguments[0]?.getText() === 'runAgentProbe')
    expect(calls).toHaveLength(1)
    const probeRequest = property(calls[0].arguments[1], 'request')
    expect(property(probeRequest, 'capability')?.text).toBe(capability)
    expect(property(property(probeRequest, 'history'), 'kind')?.text).toBe('ephemeral')
    expect(property(probeRequest, 'featureKey')?.text).toBe(featureKey)
    expect(nodes(ast, (node) => ts.isPropertyAssignment(node) && node.name.getText() === 'sessionKey')).toHaveLength(0)
    expect(nodes(ast, (node) => ts.isPropertyAccessExpression(node) && ['chatV2Start', 'onChatV2Event', 'confirmTool'].includes(node.name.text))).toHaveLength(0)
    expect(nodes(ast, (node) => ts.isPropertyAccessExpression(node) && node.expression.getText() === 'outcome' && node.name.text === 'ok').length).toBeGreaterThan(0)
    expect(nodes(ast, (node) => ts.isPropertyAccessExpression(node) && node.name.text === 'usage').length).toBeGreaterThan(0)
  })
})
