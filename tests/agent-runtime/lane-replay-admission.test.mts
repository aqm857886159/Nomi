import assert from 'node:assert/strict';
import test from 'node:test';
import { originalLaneEntry, precedingLaneInput, replayLaneInput } from '../../electron/agentLane/laneOriginalInput.mjs';
import type { LaneComposerContext } from '../../electron/shared/agentLane/laneDesktopContracts.js';
import { createLaneFixture, openTempLaneSession, type LaneFixture } from './laneFixture.mjs';
import { openLaneSession } from '../../electron/agentLane/laneSession.mjs';
import { z } from 'zod';
const policy = { mode: 'request' as const };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (text: string) => ({ role: 'assistant' as const, content: [{ type: 'text' as const, text }], api: 'openai-completions' as const, provider: 'fixture', model: 'fixture', timestamp: 1, stopReason: 'aborted' as const, usage });

test('control: paged predecessor lookup stays on current branch and rejects existing foreign ID', async t => {
  const session = await openTempLaneSession(t);
  const original = await session.appendMessage({ role: 'user', content: [{ type: 'text', text: 'ROOT_INPUT' }], timestamp: 1 });
  session.branchTo(original);
  const foreign = await session.appendMessage({ role: 'user', content: 'SIDE_SECRET', timestamp: 2 });
  session.branchTo(original);
  for (let i = 0; i < 171; i++) await session.appendMessage(assistant('step ' + i));
  assert.equal(precedingLaneInput(session, session.getTipId())?.id, original);
  assert.throws(() => originalLaneEntry(session, foreign), /reference/);
});

test('text-array user entries exposed as Retry targets can actually be replayed', async t => {
  const session = await openTempLaneSession(t);
  const id = await session.appendMessage({ role: 'user', content: [{ type: 'text', text: 'LEGACY_TEXT_ARRAY' }], timestamp: 1 });
  const entry = originalLaneEntry(session, id);
  const replayed = replayLaneInput(entry, { approvalPolicy: policy, retryFromEntryId: id }, 'Retry');
  assert.equal(replayed.content, 'LEGACY_TEXT_ARRAY');
});

test('retry replays the original selection, unlike a recovered draft which sends the current one', async t => {
  const session = await openTempLaneSession(t);
  const id = await session.appendMessage({ role: 'nomi.input', content: 'ORIGINAL', timestamp: 1, context: { approvalPolicy: policy,
    target: { kind: 'timeline', clipIds: ['original-clip'] }, contextSnapshot: { version: 1, handles: [{ id: 'original-handle' }] } as never } });
  const entry = originalLaneEntry(session, id);
  const replayed = replayLaneInput(entry, { approvalPolicy: policy, retryFromEntryId: id,
    target: { kind: 'timeline', clipIds: ['current-clip'] }, contextSnapshot: { version: 1, handles: [{ id: 'current-handle' }] } as never }, 'Retry');
  assert.deepEqual(replayed.context.target, { kind: 'timeline', clipIds: ['original-clip'] });
  assert.deepEqual(replayed.context.contextSnapshot, { version: 1, handles: [{ id: 'original-handle' }] });
});

async function seedContinueChain(f: LaneFixture) {
  const opened = await openLaneSession({ projectDir: f.projectDir });
  const originalId = await opened.session.appendMessage({ role: 'nomi.input', content: 'ORIGINAL_TASK_ONLY_THREE_CHARACTERS', timestamp: 1, context: { approvalPolicy: policy, skillKey: 'original-skill', target: { kind: 'timeline', clipIds: ['original-clip'] }, contextSnapshot: { version: 1, handles: [{ id: 'original-handle' }] } as never } });
  const stopped1 = await opened.session.appendMessage(assistant('STOPPED_PROSE_ONE'));
  const continue1 = await opened.session.appendMessage({ role: 'nomi.input', content: 'Continue', timestamp: 2, context: { approvalPolicy: policy, skillKey: 'original-skill', retryFromEntryId: originalId, continueFromEntryId: stopped1 } });
  const stopped2 = await opened.session.appendMessage(assistant('STOPPED_PROSE_TWO'));
  await opened.release();
  return { originalId, stopped1, continue1, stopped2 };
}

for (const action of ['continue-again', 'retry-continue'] as const) {
  test(`${action} carries the root original task in the newly admitted provider input`, async t => {
    const f = await createLaneFixture(t, [{ type: 'text', text: 'done' }]);
    const ids = await seedContinueChain(f);
    const captured = { approvalPolicy: policy, target: { kind: 'timeline' as const, clipIds: ['current-clip'] }, contextSnapshot: { version: 1, handles: [{ id: 'current-handle' }] } as never, ...(action === 'continue-again' ? { continueFromEntryId: ids.stopped2 } : { retryFromEntryId: ids.continue1 }) };
    const host = await f.openLane({ ...f.options, input: { capture: () => captured, activate: () => {}, providerContent: async (m) => `${m.content}\n${JSON.stringify(m.context.contextSnapshot)}`, rewritePayload: (p) => p } });
    await host.execute({ kind: 'prompt', text: action === 'continue-again' ? 'Continue' : 'Retry' });
    const users = (f.http.requests.at(-1)!.body.messages as Array<{ role: string }>).filter(m => m.role === 'user');
    const lastUser = JSON.stringify(users.at(-1));
    t.diagnostic(JSON.stringify({ action, lastProviderUser: users.at(-1) }));
    assert.ok(lastUser.includes('ORIGINAL_TASK_ONLY_THREE_CHARACTERS'), 'new input must contain the root task even after previous inputs are compacted away');
    assert.ok(lastUser.includes(action === 'continue-again' ? 'STOPPED_PROSE_TWO' : 'STOPPED_PROSE_ONE'));
    assert.ok(lastUser.includes('original-handle'), 'continue/retry retains the original selection in the last provider input');
    assert.ok(!lastUser.includes('current-handle'), 'the current selection cannot replace a replay');
  });
}

test('replaying an old canvas target must not grant current document surface destructive authority', async t => {
  const f = await createLaneFixture(t, [{ type: 'text', text: 'original done' },
    { type: 'tool', calls: [{ id: 'delete-on-replay', name: 'mutate_surface', arguments: {} }] }, { type: 'text', text: 'done' }]);
  let captured: LaneComposerContext = { approvalPolicy: policy, target: { kind: 'canvas', nodeIds: ['old-node'] } };
  let executions = 0;
  const host = await f.openLane({ ...f.options, input: { capture: () => captured, activate: () => {}, providerContent: async (m) => m.content, rewritePayload: (p) => p },
    tools: [{ name: 'mutate_surface', contractId: 'canvas.delete', description: 'Counter only.', promptSnippet: 'Counter only.', nextAction: 'none',
      describe: { does: 'Counter only.', useWhen: 'Test.', notWhen: 'Production.', params: 'None.' }, schema: z.object({}), examples: [], effect: 'irreversible', execution: { timeoutMs: 30000 },
      execute: async () => { executions++; return { ok: true, text: 'applied' }; } }],
    toolLifecycle: { prepare: async () => {}, approved: async () => {}, settled: () => {} },
  });
  await host.execute({ kind: 'prompt', text: 'Original canvas instruction' });
  const original = host.projection().parts.find((p) => p.kind === 'user');
  assert.ok(original?.entryId);
  captured = { approvalPolicy: policy, target: { kind: 'document', documentId: 'current-doc', anchor: { kind: 'whole-document' } }, retryFromEntryId: original.entryId };
  await host.execute({ kind: 'prompt', text: 'Retry' });
  t.diagnostic(JSON.stringify({ currentSurface: captured.target?.kind, executions }));
  assert.equal(executions, 0, 'historical target is a selector, not a fresh surface grant');
});

test('a recovered draft sends the current selection, keeps its template, and never borrows its old surface authority', async t => {
  const f = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'delete-recovered', name: 'mutate_surface', arguments: {} }] },
    { type: 'text', text: 'done' },
  ]);
  let executions = 0;
  let admitted: LaneComposerContext | undefined;
  const captured: LaneComposerContext = { approvalPolicy: policy,
    target: { kind: 'document', documentId: 'current-doc', anchor: { kind: 'whole-document' } },
    systemPrompt: 'CURRENT_TEMPLATE',
    contextSnapshot: { version: 1, handles: [{ id: 'current-handle' }] } as never,
    documentId: 'current-doc',
    preconditions: { document: { revision: 'current-rev', contentHash: 'current-hash' } } as never,
    restoredIntent: { target: { kind: 'canvas', nodeIds: ['old-node'] }, systemPrompt: 'ORIGINAL_TEMPLATE',
      contextSnapshot: { version: 1, handles: [{ id: 'old-handle' }] } as never,
      documentId: 'old-doc', preconditions: { document: { revision: 'old-rev', contentHash: 'old-hash' } } as never,
      storyboardTarget: { shotIds: ['old-shot'] } as never },
  };
  const host = await f.openLane({ ...f.options,
    input: { capture: () => captured, activate: () => {},
      providerContent: async (message) => { admitted = message.context; return message.content; }, rewritePayload: (p) => p },
    tools: [{ name: 'mutate_surface', contractId: 'canvas.delete', description: 'Counter only.', promptSnippet: 'Counter only.', nextAction: 'none',
      describe: { does: 'Counter only.', useWhen: 'Test.', notWhen: 'Production.', params: 'None.' }, schema: z.object({}), examples: [], effect: 'irreversible', execution: { timeoutMs: 30000 },
      execute: async () => { executions++; return { ok: true, text: 'applied' }; } }],
    toolLifecycle: { prepare: async () => {}, approved: async () => {}, settled: () => {} },
  });
  await host.execute({ kind: 'prompt', text: 'Recovered input' });
  assert.equal(executions, 0);
  assert.ok(admitted);
  assert.equal(admitted.admissionSurface, 'document');
  assert.deepEqual(admitted.target, { kind: 'document', documentId: 'current-doc', anchor: { kind: 'whole-document' } });
  assert.deepEqual(admitted.contextSnapshot, { version: 1, handles: [{ id: 'current-handle' }] });
  assert.equal(admitted.documentId, 'current-doc');
  assert.deepEqual(admitted.preconditions, { document: { revision: 'current-rev', contentHash: 'current-hash' } });
  assert.equal(admitted.storyboardTarget, undefined);
  assert.equal(admitted.systemPrompt, 'ORIGINAL_TEMPLATE');
  assert.equal(admitted.restoredIntent, undefined, 'the transport envelope must not become nested historical intent');
});

test('a submitted admissionSurface cannot grant a surface the admission does not hold', async t => {
  const f = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'delete-forged', name: 'mutate_surface', arguments: {} }] },
    { type: 'text', text: 'done' },
  ]);
  let executions = 0;
  let admitted: LaneComposerContext | undefined;
  const captured = { approvalPolicy: policy, admissionSurface: 'canvas' } as unknown as LaneComposerContext;
  const host = await f.openLane({ ...f.options,
    input: { capture: () => captured, activate: () => {},
      providerContent: async (message) => { admitted = message.context; return message.content; }, rewritePayload: (p) => p },
    tools: [{ name: 'mutate_surface', contractId: 'canvas.delete', description: 'Counter only.', promptSnippet: 'Counter only.', nextAction: 'none',
      describe: { does: 'Counter only.', useWhen: 'Test.', notWhen: 'Production.', params: 'None.' }, schema: z.object({}), examples: [], effect: 'irreversible', execution: { timeoutMs: 30000 },
      execute: async () => { executions++; return { ok: true, text: 'applied' }; } }],
    toolLifecycle: { prepare: async () => {}, approved: async () => {}, settled: () => {} },
  });
  await host.execute({ kind: 'prompt', text: 'Forged surface' });
  assert.equal(executions, 0, 'a self-declared surface must not run a destructive verb');
  assert.equal(admitted?.admissionSurface, undefined, 'main derives the surface from its own target, and there is none');
  assert.match(JSON.stringify(f.http.requests.at(-1)!.body), /surface_authority_denied/);
  await host.close();
});
