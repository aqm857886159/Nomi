import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentHarness, type AgentHarnessOptions, type Session } from '@earendil-works/pi-agent-core'
import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/pi-agent-core/harness/context'
import { openLane } from '../../electron/agentLane/laneHost.mjs'
import type { LaneComposerContext } from '../../electron/shared/agentLane/laneDesktopContracts.js'
import { createLaneFixture } from './laneFixture.mjs'

for (const kind of ['openai-compatible', 'openai-responses', 'anthropic'] as const) {
  test(`${kind}: explicit Continue resolves native stopped prose after cold reopen without rewriting history`, async t => {
    let session!: Session
    const create = AgentHarness.create
    t.mock.method(AgentHarness, 'create', async <T extends object | undefined>(options: AgentHarnessOptions<T>, context: Context) => {
      assert.ok(options.session)
      session = options.session
      return create(options, context)
    })
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    t.after(() => release())
    const fixture = await createLaneFixture(t, [
      { type: 'message', parts: [
        ...(kind === 'openai-compatible' ? [{ type: 'thinking' as const, text: 'PRIVATE_THINKING' }] : []),
        { type: 'text', text: 'NATIVE_STOPPED_PROSE' },
        { type: 'toolCall', id: 'unexecuted-write', name: 'write_script', arguments: { where: 'end', content: 'NEVER_WRITE' } },
      ], beforeFinish: () => held },
      { type: 'text', text: 'An unrelated answer.' },
      { type: 'text', text: 'Continued from the actual prose.' },
    ])
    let draft: LaneComposerContext = { approvalPolicy: { mode: 'safe-auto', spend: 'confirm' } }
    const options = { ...fixture.options, model: { ...fixture.options.model, kind }, input: {
      capture: () => draft, activate: () => undefined, rewritePayload: (payload: unknown) => payload,
      providerContent: async (message: { content: string }) => message.content,
    } }
    const first = await openLane(options)
    t.after(() => first.close())
    const visible = new Promise<void>(resolve => {
      const stop = first.subscribe(projection => {
        if (projection.parts.some(part => part.kind === 'tool-call')) {
          stop(); resolve()
        }
      })
    })
    const running = first.execute({ kind: 'prompt', text: 'Start the fixture.' })
    await visible
    await first.execute({ kind: 'abort' })
    await running
    release()
    const original = structuredClone(await session.findEntries({ type: 'message', order: 'asc' }, BACKGROUND_CONTEXT))
    const stopped = original.find(entry => entry.type === 'message' && entry.message.role === 'assistant')
    assert.ok(stopped?.type === 'message' && stopped.message.role === 'assistant')
    assert.equal(stopped.message.stopReason, 'aborted')
    const partial = first.projection().parts.find(part => part.kind === 'assistant-text')
    assert.ok(partial?.kind === 'assistant-text' && partial.interrupted)
    assert.equal(partial.continuationEntryId, stopped.id)
    await first.close()
    const lane = await openLane(options)
    t.after(() => lane.close())
    assert.deepEqual(await session.getEntry(stopped.id, BACKGROUND_CONTEXT), stopped)
    await lane.execute({ kind: 'prompt', text: 'An ordinary new instruction.' })
    assert.ok(!JSON.stringify(fixture.http.requests[1]!.body).includes('NATIVE_STOPPED_PROSE'),
      'Ordinary input does not implicitly replay interrupted prose.')
    draft = Object.assign({}, draft, { continueFromEntryId: stopped.id })
    await lane.execute({ kind: 'prompt', text: '继续' })
    const wire = JSON.stringify(fixture.http.requests[2]!.body)
    assert.ok(wire.includes('NATIVE_STOPPED_PROSE'), 'Continue must carry its actual referenced partial to the provider.')
    assert.ok(!wire.includes('NEVER_WRITE'))
    assert.ok(!wire.includes('PRIVATE_THINKING'))
    const messages = await session.findEntries({ type: 'message', order: 'asc' }, BACKGROUND_CONTEXT)
    assert.deepEqual(messages.slice(0, original.length), original)
    const continued = messages.at(-2)
    assert.ok(continued?.type === 'message' && continued.message.role === 'nomi.input')
    assert.equal(continued.message.content, '继续')
    assert.deepEqual(Object.keys(continued.message).sort(), ['content', 'context', 'role', 'timestamp'])
    assert.equal(JSON.stringify(continued.message).includes('NATIVE_STOPPED_PROSE'), false, 'Only the reference is persisted.')
    assert.equal(messages.filter(entry => entry.type === 'message' && entry.message.role === 'assistant').length, 3)
    assert.equal(fixture.document.text(), 'The opening scene.')
    assert.equal(fixture.http.requests.length, 3)
    const foreign = await session.createBranch('other-branch', null, BACKGROUND_CONTEXT)
    const foreignId = await foreign.appendMessage(stopped.message, BACKGROUND_CONTEXT)
    assert.ok(await session.getEntry(foreignId, BACKGROUND_CONTEXT), 'A real aborted entry exists outside the active branch.')
    const beforeInvalid = structuredClone(await session.findEntries({ type: 'message', order: 'asc' }, BACKGROUND_CONTEXT))
    for (const invalidId of ['missing-entry', foreignId, original[0]!.id, messages.at(-1)!.id]) {
      draft = Object.assign({}, draft, { continueFromEntryId: invalidId })
      await assert.rejects(lane.execute({ kind: 'prompt', text: 'Must not be admitted.' }), /continuation/i)
    }
    assert.deepEqual(await session.findEntries({ type: 'message', order: 'asc' }, BACKGROUND_CONTEXT), beforeInvalid)
    assert.equal(fixture.http.requests.length, 3, 'Invalid references fail before input persistence or provider requests.')
  })
}
