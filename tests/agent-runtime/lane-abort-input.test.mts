import assert from 'node:assert/strict';
import test from 'node:test';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import type { LaneComposerContext } from '../../electron/shared/agentLane/laneDesktopContracts.js';
import type { LaneHandle } from '../../electron/shared/agentLane/laneContracts.js';
import { createLaneFixture } from './laneFixture.mjs';

function pendingApproval(lane: LaneHandle): Promise<void> {
  if (lane.projection().pending) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = lane.subscribe((projection) => { if (projection.pending) { stop(); resolve(); } });
  });
}

const replies = [
  { type: 'tool' as const, calls: [{ id: 'append-fixture', name: 'write_script', arguments: { where: 'end', content: ' fixture ending.' } }] },
  { type: 'text' as const, text: 'Fixture complete.' },
];
const policy = { mode: 'step' as const, spend: 'confirm' as const };

test('stop restores real pi steer and followUp messages with their captured attachment claims', async (t) => {
  const fixture = await createLaneFixture(t, replies, { hasUserInterface: true, policy: () => policy });
  let draft: LaneComposerContext = { approvalPolicy: policy };
  const lane = await openLane({ ...fixture.options, input: {
    capture: () => draft, activate: () => undefined, rewritePayload: (payload) => payload,
    providerContent: async (message) => message.content,
  } });
  t.after(() => lane.close());
  const running = lane.execute({ kind: 'prompt', text: 'Append the fixture ending.' });
  await pendingApproval(lane);
  const first = [{ assetId: 'fixture-image', version: 2 }];
  const second = [{ assetId: 'fixture-document', version: 4 }];
  draft = { approvalPolicy: policy, attachments: first };
  await lane.execute({ kind: 'steer', text: 'Use this image next.' });
  draft = { approvalPolicy: policy, attachments: second };
  await lane.execute({ kind: 'follow-up', text: 'Read this after finishing.' });
  second[0]!.version = 9;
  draft = { approvalPolicy: policy };
  const queued = lane.projection().queues.map(({ entryId: _id, kind, ...input }) => ({ kind, ...input }));
  const outcome = await lane.execute({ kind: 'abort' });
  await running.catch(() => undefined);
  assert.deepEqual(outcome.restoredInput, [
    { text: 'Use this image next.', attachments: first },
    { text: 'Read this after finishing.', attachments: [{ assetId: 'fixture-document', version: 4 }] },
  ]);
  assert.deepEqual(queued, [
    { kind: 'steer', text: 'Use this image next.', attachments: first },
    { kind: 'follow-up', text: 'Read this after finishing.', attachments: [{ assetId: 'fixture-document', version: 4 }] },
  ], 'Queue cancellation can restore the same captured attachments as stop.');
  assert.deepEqual(lane.projection().queues, []);
  assert.equal(fixture.document.text(), 'The opening scene.', 'Abort never approves the pending tool.');
});

test('plain user messages in both pi abort queues return draft text without fabricated attachments', async (t) => {
  const fixture = await createLaneFixture(t, replies, { hasUserInterface: true, policy: () => policy });
  const lane = await openLane(fixture.options);
  t.after(() => lane.close());
  const running = lane.execute({ kind: 'prompt', text: 'Append the fixture ending.' });
  await pendingApproval(lane);
  await lane.execute({ kind: 'steer', text: 'Next step.' });
  await lane.execute({ kind: 'follow-up', text: 'Next turn.' });
  const outcome = await lane.execute({ kind: 'abort' });
  await running.catch(() => undefined);
  assert.deepEqual(outcome.restoredInput, [{ text: 'Next step.' }, { text: 'Next turn.' }]);
  assert.deepEqual(await lane.execute({ kind: 'abort' }), {}, 'An idle stop cannot return the same draft twice.');
});

test('successful cancellation restores exactly that captured queued draft and missing entries restore nothing', async (t) => {
  const fixture = await createLaneFixture(t, replies, { hasUserInterface: true, policy: () => policy });
  let draft: LaneComposerContext = { approvalPolicy: policy };
  const lane = await openLane({ ...fixture.options, input: {
    capture: () => draft, activate: () => undefined, rewritePayload: (payload) => payload,
    providerContent: async (message) => message.content,
  } });
  t.after(() => lane.close());
  const running = lane.execute({ kind: 'prompt', text: 'Append the fixture ending.' });
  await pendingApproval(lane);
  draft = { approvalPolicy: policy, attachments: [{ assetId: 'cancelled-fixture', version: 7 }] };
  const queued = await lane.execute({ kind: 'follow-up', text: 'Return this draft.' });
  draft = { approvalPolicy: policy };
  const cancelled = await lane.execute({ kind: 'cancel-queued', entryId: queued.queuedEntryId! });
  const missing = await lane.execute({ kind: 'cancel-queued', entryId: 'missing-fixture-entry' });
  await lane.execute({ kind: 'abort' });
  await running.catch(() => undefined);
  assert.deepEqual(cancelled, { cancelQueued: 'cancelled', restoredInput: [
    { text: 'Return this draft.', attachments: [{ assetId: 'cancelled-fixture', version: 7 }] },
  ] });
  assert.deepEqual(missing, { cancelQueued: 'not_found' });
});
