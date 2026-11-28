import assert from 'node:assert/strict';
import test from 'node:test';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { readLaneTraceTurns } from '../../electron/agentLane/laneSession.mjs';
import { createLaneFixture, mustConfirm } from './laneFixture.mjs';

test('onAccepted acknowledges durable input before approval while execute settles the same real operation', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'admitted-write', name: 'write_script', arguments: { where: 'end', content: ' Approved fixture.' } }] },
    { type: 'text', text: 'Fixture complete.' },
  ], mustConfirm());
  const lane = await openLane(fixture.options);
  let accepted = 0, settled = false;
  let projectionAtAcceptance: ReturnType<typeof lane.projection> | undefined;
  const pending = new Promise<void>((resolve) => {
    const unsubscribe = lane.subscribe((projection) => { if (projection.pending) { unsubscribe(); resolve(); } });
  });
  const execution = lane.execute({ kind: 'prompt', text: 'Append the fixture.' }, { onAccepted: () => {
    accepted += 1;
    projectionAtAcceptance = lane.projection();
  } }).finally(() => { settled = true; });
  try {
    await pending;
    assert.equal(accepted, 1, 'Input admission must acknowledge before the tool needs the user.');
    assert.equal(settled, false, 'The execute promise still owns the running operation.');
    assert.ok(projectionAtAcceptance?.parts.some((part) => part.kind === 'user' && part.text === 'Append the fixture.'));
    assert.equal(lane.projection().running, true);
    assert.equal(fixture.document.text(), 'The opening scene.');
    await lane.execute({ kind: 'approval', toolCallId: 'admitted-write', action: 'allow-once' });
    await execution;
    assert.equal(settled, true);
    assert.equal(accepted, 1);
    assert.equal(lane.projection().running, false);
    const traceRows = await readLaneTraceTurns(fixture.projectDir, 'main');
    assert.equal(traceRows.length, 1, 'Admission and settlement belong to one completed run.');
    assert.equal(traceRows[0]!.status, 'completed');
    assert.equal(fixture.document.text(), 'The opening scene. Approved fixture.');
    assert.equal(fixture.http.requests.length, 2);
  } finally {
    await lane.execute({ kind: 'abort' });
    await execution.catch(() => undefined);
    await lane.close();
  }
});
