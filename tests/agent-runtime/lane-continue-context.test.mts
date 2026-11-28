import assert from 'node:assert/strict'
import test from 'node:test'
import { openLane } from '../../electron/agentLane/laneHost.mjs'
import { openLaneSession } from '../../electron/agentLane/laneSession.mjs'
import type { LaneComposerContext } from '../../electron/shared/agentLane/laneDesktopContracts.js'
import { createLaneFixture } from './laneFixture.mjs'

for (const kind of ['openai-compatible', 'openai-responses', 'anthropic'] as const) {
  test(`${kind}: explicit Continue resolves native stopped prose after cold reopen without rewriting history`, async t => {
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
    let draft: LaneComposerContext = { approvalPolicy: { mode: 'request' } }
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
    const partial = first.projection().parts.find(part => part.kind === 'assistant-text')
    assert.ok(partial?.kind === 'assistant-text' && partial.interrupted)
    await first.close()

    const inspectFirst = await openLaneSession({ projectDir: fixture.projectDir })
    const original = structuredClone(inspectFirst.session.findBranchEntries({ type: 'message', order: 'oldestFirst' }))
    const stopped = original.find(entry => entry.type === 'message' && entry.message.role === 'assistant')
    assert.ok(stopped?.type === 'message' && stopped.message.role === 'assistant')
    assert.equal(stopped.message.stopReason, 'aborted')
    assert.equal(partial.continuationEntryId, stopped.id)
    assert.deepEqual(inspectFirst.session.getEntry(stopped.id), stopped)
    const activeTip = inspectFirst.session.getTipId()
    inspectFirst.session.branchTo(null)
    const foreignId = await inspectFirst.session.appendMessage(stopped.message)
    assert.ok(inspectFirst.session.getEntry(foreignId), 'A real aborted entry exists outside the active branch.')
    inspectFirst.session.branchTo(activeTip)
    await inspectFirst.release()

    const lane = await openLane(options)
    t.after(() => lane.close())
    await lane.execute({ kind: 'prompt', text: 'An ordinary new instruction.' })
    assert.ok(!JSON.stringify(fixture.http.requests[1]!.body).includes('NATIVE_STOPPED_PROSE'),
      'Ordinary input does not implicitly replay interrupted prose.')
    draft = Object.assign({}, draft, { continueFromEntryId: stopped.id })
    await lane.execute({ kind: 'prompt', text: '继续' })
    const wire = JSON.stringify(fixture.http.requests[2]!.body)
    assert.ok(wire.includes('NATIVE_STOPPED_PROSE'), 'Continue must carry its actual referenced partial to the provider.')
    assert.ok(!wire.includes('NEVER_WRITE'))
    assert.ok(!wire.includes('PRIVATE_THINKING'))
    assert.equal(fixture.document.text(), 'The opening scene.')
    assert.equal(fixture.http.requests.length, 3)

    await lane.close()
    const inspectAfter = await openLaneSession({ projectDir: fixture.projectDir })
    const messages = inspectAfter.session.findBranchEntries({ type: 'message', order: 'oldestFirst' })
    assert.deepEqual(messages.slice(0, original.length), original)
    const continued = messages.at(-2)
    assert.ok(continued?.type === 'message' && continued.message.role === 'nomi.input')
    assert.equal(continued.message.content, '继续')
    assert.deepEqual(Object.keys(continued.message).sort(), ['content', 'context', 'role', 'timestamp'])
    assert.equal(JSON.stringify(continued.message).includes('NATIVE_STOPPED_PROSE'), false, 'Only the reference is persisted.')
    assert.equal(messages.filter(entry => entry.type === 'message' && entry.message.role === 'assistant').length, 3)
    const beforeInvalid = structuredClone(messages)
    await inspectAfter.release()

    const invalidCheck = await openLane(options)
    t.after(() => invalidCheck.close())
    for (const invalidId of ['missing-entry', foreignId, original[0]!.id, messages.at(-1)!.id]) {
      draft = Object.assign({}, draft, { continueFromEntryId: invalidId })
      await assert.rejects(invalidCheck.execute({ kind: 'prompt', text: 'Must not be admitted.' }), /continuation|input_reference_invalid/i)
    }
    await invalidCheck.close()
    const inspectFinal = await openLaneSession({ projectDir: fixture.projectDir })
    t.after(() => inspectFinal.release())
    assert.deepEqual(inspectFinal.session.findBranchEntries({ type: 'message', order: 'oldestFirst' }), beforeInvalid)
    assert.equal(fixture.http.requests.length, 3, 'Invalid references fail before input persistence or provider requests.')
  })
}
