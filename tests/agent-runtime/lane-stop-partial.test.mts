import assert from 'node:assert/strict'
import test from 'node:test'
import { createModels, createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai'
import { createNomiProvider } from '../../electron/agentLane/laneModelProvider.mjs'
import { guardProviderStreams } from '../../electron/agentLane/laneProviderGuard.mjs'
import { openLane } from '../../electron/agentLane/laneHost.mjs'
import { openLaneHistory } from '../../electron/agentLane/laneHistory.mjs'
import { createLaneFixture } from './laneFixture.mjs'

function heldReply() {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  return { release, beforeFinish: () => pending }
}

for (const kind of ['openai-compatible', 'openai-responses', 'anthropic'] as const) {
  for (const guarded of [false, true]) {
    test(`${kind}: ${guarded ? 'guarded' : 'native'} cancellation keeps the actual streamed partial`, async t => {
      const held = heldReply()
      t.after(held.release)
      const fixture = await createLaneFixture(t, [{ type: 'text', text: 'ACTUAL_PARTIAL', beforeFinish: held.beforeFinish }])
      const { provider, model, credentials } = await createNomiProvider({ ...fixture.options.model, kind }, globalThis.fetch,
        guarded ? { firstResponseMs: 30_000, idleMs: 30_000 } : undefined)
      const models = createModels({ credentials })
      models.setProvider(provider)
      const controller = new AbortController()
      const stream = models.streamSimple(model, { messages: [{ role: 'user', content: 'Pause before finishing', timestamp: 1 }] },
        { signal: controller.signal })
      let observed = false
      for await (const event of stream) {
        if (event.type === 'text_delta' && event.partial.content.some(part => part.type === 'text' && part.text.includes('ACTUAL_PARTIAL'))) {
          observed = true
          controller.abort()
        }
      }
      assert.equal(observed, true)
      const result = await stream.result()
      assert.equal(result.stopReason, 'aborted')
      assert.equal(result.content.filter(part => part.type === 'text').map(part => part.text).join(''), 'ACTUAL_PARTIAL')
      assert.equal(fixture.http.requests.length, 1)
    })
  }
}

test('Stop commits the actual partial once, never runs pending tools, and cold history retains interrupted status', async t => {
  const held = heldReply()
  t.after(held.release)
  const fixture = await createLaneFixture(t, [{ type: 'message', parts: [
    { type: 'text', text: 'ACTUAL_PARTIAL' },
    { type: 'toolCall', id: 'unsettled-write', name: 'write_script', arguments: { where: 'end', content: 'NEVER_WRITE' } },
  ], beforeFinish: held.beforeFinish }])
  const before = fixture.document.text()
  const lane = await openLane(fixture.options)
  t.after(() => lane.close())
  let observed!: () => void
  const visible = new Promise<void>(resolve => { observed = resolve })
  lane.subscribe(projection => {
    if (projection.parts.some(part => part.kind === 'assistant-text' && part.text === 'ACTUAL_PARTIAL' && part.streaming)) observed()
  })
  const running = lane.execute({ kind: 'prompt', text: 'Show the partial then wait.' })
  await visible
  await lane.execute({ kind: 'abort' })
  await running
  const after = lane.projection()
  const partial = after.parts.filter(part => part.kind === 'assistant-text')
  assert.equal(partial.length, 1)
  assert.deepEqual(partial[0], { ...partial[0], text: 'ACTUAL_PARTIAL', streaming: false, interrupted: true })
  assert.equal(fixture.document.text(), before)
  assert.equal(after.parts.filter(part => part.kind === 'tool-result').length, 0)
  held.release()
  await lane.close()
  const cold = await openLaneHistory({ projectDir: fixture.projectDir })
  t.after(() => cold.close())
  assert.deepEqual(cold.projection().parts, after.parts)
  assert.equal(fixture.http.requests.length, 1)
})

for (const cause of ['abort', 'timeout'] as const) {
  test(`${cause}: current official content is snapshotted before uncooperative cleanup and excludes parser scratch`, async t => {
    const fixture = await createLaneFixture(t, [])
    const { model } = await createNomiProvider(fixture.options.model, globalThis.fetch)
    const message: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      timestamp: 1, stopReason: 'pending', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      content: [Object.assign({ type: 'text' as const, text: 'OBSERVED', textSignature: 'real-signature' }, { index: 0 }),
        Object.assign({ type: 'toolCall' as const, id: 'call', name: 'write', arguments: { where: 'end', content: 'not executed' } },
          { index: 1, partialArgs: 'parser scratch', streamIndex: 1 })],
    }
    const upstream = createAssistantMessageEventStream()
    const nativeIterator = upstream[Symbol.asyncIterator]()
    upstream[Symbol.asyncIterator] = () => ({ ...nativeIterator,
      next: () => nativeIterator.next(),
      return: () => {
        message.content = [{ type: 'text', text: 'LATE_UNOBSERVED' }]
        return new Promise(() => {})
      },
    })
    let timeout!: () => void
    const controller = new AbortController()
    const guarded = guardProviderStreams({ stream: () => upstream, streamSimple: () => upstream }, {
      firstResponseMs: 30_000, idleMs: 30_000,
      clock: { set: (callback) => { timeout = callback; return callback }, clear: () => undefined },
    })
    const stream = guarded.stream(model, { messages: [] }, { signal: controller.signal })
    upstream.push({ type: 'start', partial: message })
    await stream[Symbol.asyncIterator]().next()
    if (cause === 'abort') controller.abort()
    else timeout()
    const result = await stream.result()
    assert.equal(result.stopReason, cause === 'abort' ? 'aborted' : 'error')
    assert.deepEqual(result.content, [{ type: 'text', text: 'OBSERVED', textSignature: 'real-signature' },
      { type: 'toolCall', id: 'call', name: 'write', arguments: { where: 'end', content: 'not executed' } }])
    assert.equal(fixture.http.requests.length, 0)
  })
}
