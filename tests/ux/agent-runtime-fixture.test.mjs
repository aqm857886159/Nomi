import { afterEach, describe, expect, test } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createAgentRuntimeFixture,
  flattenRequestText,
  FIXTURE_API_KEY,
  FIXTURE_IMAGE_MODEL,
  FIXTURE_TEXT_MODEL,
  FIXTURE_USAGE,
  FIXTURE_VENDOR,
} from './agent-runtime-fixture.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cleanups = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function temporarySettings() {
  const settingsDir = await mkdtemp(path.join(os.tmpdir(), 'nomi-runtime-fixture-test-'))
  cleanups.push(() => rm(settingsDir, { recursive: true, force: true }))
  return settingsDir
}

async function startFixture() {
  const settingsDir = await temporarySettings()
  const fixture = await createAgentRuntimeFixture({ rootDir, settingsDir })
  cleanups.push(() => fixture.close())
  return { ...fixture, settingsDir }
}

function chat(fixture, messages, options = {}) {
  return fetch(`${fixture.baseURL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FIXTURE_API_KEY}` },
    body: JSON.stringify({ model: FIXTURE_TEXT_MODEL, stream: true, messages }),
    ...options,
  })
}

async function sse(response) {
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  const frames = (await response.text()).trim().split(/\r?\n\r?\n/)
  expect(frames.pop()).toBe('data: [DONE]')
  return frames.map((frame) => {
    expect(frame.startsWith('data: ')).toBe(true)
    return JSON.parse(frame.slice(6))
  })
}

function replyText(chunks) {
  return chunks.flatMap((chunk) => chunk.choices).map((choice) => choice.delta.content ?? '').join('')
}

function expectUsage(chunks) {
  expect(chunks.filter((chunk) => chunk.usage)).toEqual([
    expect.objectContaining({ choices: [], usage: FIXTURE_USAGE }),
  ])
  expect(FIXTURE_USAGE).toEqual({
    prompt_tokens: 11, completion_tokens: 7, total_tokens: 18,
    prompt_tokens_details: { cached_tokens: 3 },
  })
}

async function readPartialText(reader) {
  const decoder = new TextDecoder()
  let wire = ''
  let chunks = []
  while (!chunks.some((chunk) => chunk.choices.some((choice) => choice.delta.content))) {
    const { value, done } = await reader.read()
    expect(done).toBe(false)
    wire += decoder.decode(value, { stream: true })
    chunks = wire.split('\n\n').slice(0, -1).map((frame) => JSON.parse(frame.slice(6)))
  }
  expect(chunks.some((chunk) => chunk.choices.some((choice) => choice.finish_reason != null))).toBe(false)
  expect(wire).not.toContain('[DONE]')
  return { wire, chunks, decoder }
}

describe('agent runtime loopback fixture', () => {
  test('creates an isolated fixture with a loopback URL and explicit observation API', async () => {
    const settingsDir = await temporarySettings()
    const creating = createAgentRuntimeFixture({ rootDir, settingsDir }).then((fixture) => {
      cleanups.push(() => fixture.close())
      return fixture
    })
    await expect(creating).resolves.toMatchObject({
      baseURL: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
      requests: [], images: [], unexpected: [],
      expectText: expect.any(Function), assertClean: expect.any(Function), close: expect.any(Function),
    })
    const fixture = await creating
    fixture.assertClean()
  })

  test('sends OpenAI text SSE and records the exact request, including cached-token usage', async () => {
    const fixture = await startFixture()
    const pending = fixture.expectText({
      label: 'creation', match: (body, record) => flattenRequestText(body).includes('F_CREATE')
        && record.authorization === `Bearer ${FIXTURE_API_KEY}`,
      reply: { type: 'text', text: 'F_REPLY：真实传输。' },
    })
    const messages = [{ role: 'user', content: 'F_CREATE' }]
    const chunks = await sse(await chat(fixture, messages))
    const record = await pending.received
    expect(record).toMatchObject({
      path: '/v1/chat/completions', authorization: `Bearer ${FIXTURE_API_KEY}`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${FIXTURE_API_KEY}` },
      body: { model: FIXTURE_TEXT_MODEL, stream: true, messages },
    })
    expect(fixture.requests).toEqual([record])
    expect(chunks.every((chunk) => chunk.object === 'chat.completion.chunk'
      && chunk.model === FIXTURE_TEXT_MODEL && typeof chunk.created === 'number')).toBe(true)
    expect(chunks[0].choices[0].delta.role).toBe('assistant')
    expect(replyText(chunks)).toBe('F_REPLY：真实传输。')
    expect(chunks.flatMap((chunk) => chunk.choices).at(-1).finish_reason).toBe('stop')
    expectUsage(chunks)
    fixture.assertClean()
  })

  test('consumes matching expectations once even when requests arrive out of registration order', async () => {
    const fixture = await startFixture()
    const first = fixture.expectText({
      label: 'first', match: (body) => flattenRequestText(body) === 'FIRST',
      reply: { type: 'text', text: 'reply-first' },
    })
    const second = fixture.expectText({
      label: 'second', match: (body) => flattenRequestText(body) === 'SECOND',
      reply: { type: 'text', text: 'reply-second' },
    })
    expect(replyText(await sse(await chat(fixture, [{ role: 'user', content: 'SECOND' }])))).toBe('reply-second')
    expect(replyText(await sse(await chat(fixture, [{ role: 'user', content: 'FIRST' }])))).toBe('reply-first')
    expect((await second.received).body.messages[0].content).toBe('SECOND')
    expect((await first.received).body.messages[0].content).toBe('FIRST')
    fixture.assertClean()
    const duplicate = await chat(fixture, [{ role: 'user', content: 'FIRST' }])
    expect(duplicate.status).toBe(400)
    expect((await duplicate.json()).error.message).toContain('Unexpected text request')
    expect(fixture.requests).toHaveLength(3)
    expect(fixture.unexpected).toEqual([fixture.requests[2]])
    expect(() => fixture.assertClean()).toThrow(/unexpected/i)
  })

  test('streams a real tool-call envelope and accepts a separately expected follow-up request', async () => {
    const fixture = await startFixture()
    const args = {
      title: 'F镜头', anchors: [],
      shots: [{ index: 1, shotKind: 'image', durationSec: 0, anchorIds: [], prompt: '红色杯子放在白桌中央。' }],
    }
    fixture.expectText({
      label: 'planner', match: (body) => body.messages.at(-1)?.role === 'user',
      reply: { type: 'tool', id: 'call-plan-1', name: 'propose_storyboard_plan', args },
    })
    const followUp = fixture.expectText({
      label: 'planner-follow-up', match: (body) => body.messages.at(-1)?.role === 'tool',
      reply: { type: 'text', text: '计划待确认。' },
    })
    const initial = [{ role: 'user', content: 'F_PLAN' }]
    const chunks = await sse(await chat(fixture, initial))
    const calls = chunks.flatMap((chunk) => chunk.choices.flatMap((choice) => choice.delta.tool_calls ?? []))
    expect(calls[0]).toMatchObject({ index: 0, id: 'call-plan-1', type: 'function', function: { name: 'propose_storyboard_plan' } })
    expect(JSON.parse(calls.map((call) => call.function.arguments ?? '').join(''))).toEqual(args)
    expect(chunks.flatMap((chunk) => chunk.choices).at(-1).finish_reason).toBe('tool_calls')
    expectUsage(chunks)
    const messages = [...initial,
      { role: 'assistant', content: null, tool_calls: [{ id: 'call-plan-1', type: 'function', function: { name: 'propose_storyboard_plan', arguments: JSON.stringify(args) } }] },
      { role: 'tool', tool_call_id: 'call-plan-1', content: '{"status":"pending_acceptance"}' },
    ]
    const followUpChunks = await sse(await chat(fixture, messages))
    expect(replyText(followUpChunks)).toBe('计划待确认。')
    expectUsage(followUpChunks)
    expect((await followUp.received).body.messages).toEqual(messages)
    fixture.assertClean()
  })

  test('does not send held response headers before release while other requests finish', async () => {
    const fixture = await startFixture()
    const held = fixture.expectText({
      label: 'held', match: (body) => flattenRequestText(body) === 'HOLD', reply: { type: 'hold' },
    })
    let responseArrived = false
    const waiting = chat(fixture, [{ role: 'user', content: 'HOLD' }]).then((response) => {
      responseArrived = true
      return response
    })
    await held.received
    fixture.expectText({ label: 'transport-barrier', reply: { type: 'text', text: 'BARRIER' } })
    expect(replyText(await sse(await chat(fixture, [{ role: 'user', content: 'BARRIER' }])))).toBe('BARRIER')
    expect(responseArrived).toBe(false)
    held.release({ type: 'text', text: 'RELEASED' })
    expect(replyText(await sse(await waiting))).toBe('RELEASED')
    fixture.assertClean()
  })

  test('allows deterministic Stop before response and safely ignores release after cancellation', async () => {
    const fixture = await startFixture()
    const held = fixture.expectText({ label: 'stop-before-response', reply: { type: 'hold' } })
    const controller = new AbortController()
    const waiting = chat(fixture, [{ role: 'user', content: 'STOP' }], { signal: controller.signal })
      .then(() => { throw new Error('The held request unexpectedly got response headers') }, (error) => error)
    await held.received
    controller.abort()
    expect((await waiting).name).toBe('AbortError')
    expect(() => held.release({ type: 'text', text: 'MUST_NOT_SURFACE' })).not.toThrow()
    expect(() => held.release()).not.toThrow()
    fixture.assertClean()
    await fixture.close()
    await fixture.close()
  })

  test('can release a held expectation before its request arrives', async () => {
    const fixture = await startFixture()
    const held = fixture.expectText({ label: 'early-release', reply: { type: 'hold' } })
    held.release({ type: 'text', text: 'EARLY' })
    expect(replyText(await sse(await chat(fixture, [{ role: 'user', content: 'EARLY' }])))).toBe('EARLY')
    expect(await held.received).toBe(fixture.requests[0])
    fixture.assertClean()
  })

  test('streams optional hold text and appends a real tool response only when released', async () => {
    const fixture = await startFixture()
    const held = fixture.expectText({ label: 'stream-held', reply: { type: 'hold', text: 'F_STOP_PARTIAL：正在检查' } })
    const response = await chat(fixture, [{ role: 'user', content: 'STREAM' }])
    await held.received
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body.getReader()
    const partial = await readPartialText(reader)
    expect(partial.chunks[0].choices[0].delta.role).toBe('assistant')
    expect(replyText(partial.chunks)).toBe('F_STOP_PARTIAL：正在检查')
    held.release({ type: 'tool', id: 'late-tool', name: 'inspect_canvas', args: { scope: 'all' } })
    let wire = partial.wire
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      wire += partial.decoder.decode(value, { stream: true })
    }
    const chunks = await sse(new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } }))
    expect(replyText(chunks)).toBe('F_STOP_PARTIAL：正在检查')
    expect(chunks.flatMap((chunk) => chunk.choices.flatMap((choice) => choice.delta.tool_calls ?? []))).toEqual([
      { index: 0, id: 'late-tool', type: 'function', function: { name: 'inspect_canvas', arguments: '{"scope":"all"}' } },
    ])
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(1)
    expectUsage(chunks)
    fixture.assertClean()
  })

  test('Stop during partial streaming rejects the reader and tolerates a late tool release', async () => {
    const fixture = await startFixture()
    const held = fixture.expectText({ label: 'stop-stream', reply: { type: 'hold', text: 'F_STOP_PARTIAL：正在检查' } })
    const controller = new AbortController()
    const response = await chat(fixture, [{ role: 'user', content: 'STOP_STREAM' }], { signal: controller.signal })
    const reader = response.body.getReader()
    expect(replyText((await readPartialText(reader)).chunks)).toBe('F_STOP_PARTIAL：正在检查')
    const stopped = reader.read().then(() => 'unexpected chunk', (error) => error.name)
    controller.abort()
    expect(await stopped).toBe('AbortError')
    expect(() => held.release({ type: 'tool', id: 'late-tool', name: 'inspect_canvas', args: {} })).not.toThrow()
    expect(() => held.release()).not.toThrow()
    fixture.assertClean()
  })

  test('returns the real local JPEG and seeds only the two loopback models and correct image mappings', async () => {
    const fixture = await startFixture()
    const catalog = JSON.parse(await readFile(path.join(fixture.settingsDir, 'model-catalog.json'), 'utf8'))
    expect(catalog.version).toBe(8)
    expect(catalog.vendors).toEqual([expect.objectContaining({
      key: FIXTURE_VENDOR, name: 'Agent Runtime Loopback', enabled: true, baseUrlHint: fixture.baseURL,
      authType: 'none', authHeader: null, authQueryParam: null, providerKind: 'openai-compatible',
    })])
    expect(catalog.models).toEqual([
      expect.objectContaining({ modelKey: FIXTURE_TEXT_MODEL, kind: 'text', vendorKey: FIXTURE_VENDOR, enabled: true, meta: { supportsImageInput: true } }),
      expect.objectContaining({ modelKey: FIXTURE_IMAGE_MODEL, kind: 'image', vendorKey: FIXTURE_VENDOR, enabled: true, meta: { archetypeId: 'agnes-image' } }),
    ])
    expect(catalog.apiKeysByVendor).toEqual({
      [FIXTURE_VENDOR]: expect.objectContaining({ apiKey: FIXTURE_API_KEY, vendorKey: FIXTURE_VENDOR, enabled: true, enc: 'plain' }),
    })
    expect(FIXTURE_API_KEY).toBe('sk-agent-runtime-fixture')
    expect(catalog.mappings).toHaveLength(2)
    expect(catalog.mappings.map((mapping) => mapping.taskKind)).toEqual(['text_to_image', 'image_edit'])
    for (const mapping of catalog.mappings) {
      expect(mapping).toMatchObject({
        vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_IMAGE_MODEL, enabled: true,
        create: {
          method: 'POST', path: '/v1/images/generations',
          headers: { Authorization: 'Bearer {{user_api_key}}', 'Content-Type': 'application/json' },
          body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', size: '{{request.params.size}}' },
          response_mapping: { image_url: 'data.0.url' }, defaultParams: { size: '1024x1024' },
        },
      })
      expect(mapping.create.body.extra_body).toEqual(mapping.taskKind === 'image_edit'
        ? { response_format: 'url', image: '{{request.params.image}}' } : { response_format: 'url' })
    }
    const body = { model: FIXTURE_IMAGE_MODEL, prompt: '红杯', extra_body: { response_format: 'url' } }
    const response = await fetch(`${fixture.baseURL}/v1/images/generations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FIXTURE_API_KEY}` },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.data[0].url).toBe(`data:image/jpeg;base64,${(await readFile(path.join(rootDir, 'resources/onboarding-demo/shot-4.jpg'))).toString('base64')}`)
    expect(fixture.images).toEqual([expect.objectContaining({ path: '/v1/images/generations', body, authorization: `Bearer ${FIXTURE_API_KEY}` })])
    expect(fixture.requests).toEqual([])
    fixture.assertClean()
  })

  test('reports unused expectations and invalid requests instead of returning a success fallback', async () => {
    const fixture = await startFixture()
    fixture.expectText({ label: 'never-used', match: () => false, reply: { type: 'text', text: 'NO' } })
    expect(() => fixture.assertClean()).toThrow(/never-used/)
    const invalid = await fetch(`${fixture.baseURL}/v1/chat/completions`, { method: 'POST', body: '{invalid' })
    expect(invalid.status).toBe(400)
    expect((await invalid.json()).error.message).toMatch(/JSON/)
    expect(fixture.requests).toHaveLength(1)
    expect(fixture.unexpected).toEqual(fixture.requests)
    const unknownRoute = await fetch(`${fixture.baseURL}/not-a-provider-route`, { method: 'POST', body: '{}' })
    expect(unknownRoute.status).toBe(400)
    expect((await unknownRoute.json()).error.message).toMatch(/route/i)
    expect(fixture.unexpected).toHaveLength(2)
    expect(() => fixture.assertClean()).toThrow(/unexpected/)
  })

  test('rejects a throwing matcher as an observable failure without consuming the expectation', async () => {
    const fixture = await startFixture()
    fixture.expectText({ label: 'broken-matcher', match: () => { throw new Error('matcher broke') }, reply: { type: 'text', text: 'NO' } })
    const response = await chat(fixture, [{ role: 'user', content: 'MATCH' }])
    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('matcher broke')
    expect(fixture.unexpected).toEqual(fixture.requests)
    expect(() => fixture.assertClean()).toThrow(/broken-matcher/)
  })

  test('close terminates held connections, is idempotent, and prevents further expectations', async () => {
    const fixture = await startFixture()
    const held = fixture.expectText({ label: 'close-held', reply: { type: 'hold' } })
    const waiting = chat(fixture, [{ role: 'user', content: 'CLOSE' }]).then(() => 'unexpected response', () => 'closed')
    await held.received
    await Promise.all([fixture.close(), fixture.close()])
    expect(await waiting).toBe('closed')
    expect(() => held.release({ type: 'text', text: 'LATE' })).not.toThrow()
    expect(() => fixture.expectText({ label: 'after-close', reply: { type: 'text', text: 'NO' } })).toThrow(/closed/i)
    await expect(chat(fixture, [{ role: 'user', content: 'AFTER' }])).rejects.toThrow()
  })

  test('never overwrites an existing caller catalog', async () => {
    const settingsDir = await temporarySettings()
    const catalogPath = path.join(settingsDir, 'model-catalog.json')
    const original = '{"existing":"keep literal bytes"}\n'
    await writeFile(catalogPath, original)
    await expect(createAgentRuntimeFixture({ rootDir, settingsDir })).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(catalogPath, 'utf8')).toBe(original)
  })
})

test('flattenRequestText reads message text without copying image payloads or tool metadata', () => {
  expect(flattenRequestText({ messages: [
    { role: 'system', content: 'SYSTEM' },
    { role: 'user', content: [{ type: 'text', text: 'VISION' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,DO_NOT_COPY' } }] },
    { role: 'assistant', content: null, tool_calls: [{ function: { name: 'DO_NOT_COPY' } }] },
    { role: 'tool', content: '{"status":"pending"}' },
  ] })).toBe('SYSTEM\nVISION\n{"status":"pending"}')
  expect(flattenRequestText({})).toBe('')
})
