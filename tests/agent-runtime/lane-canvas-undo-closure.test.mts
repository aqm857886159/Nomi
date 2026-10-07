import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasLaneTools } from '../../electron/agentLane/laneCanvasTools.js';
import { createLaneFixture } from './laneFixture.mjs';

// The HTTP provider is simulated here; the production lane, tool projection and
// SDK loop are real. This guards receipt visibility and empty-response closure,
// not the timing or reasoning of a live provider.
test('applied canvas receipt reaches the provider and an empty assistant response closes the turn', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'artifact-call', name: 'make_artifact',
      arguments: { fileType: 'text', title: 'R13_UNDO_CANVAS', content: 'Canvas undo' } }] },
    { type: 'text', text: '' },
  ], { hasUserInterface: true, policy: () => ({ mode: 'safe-auto', spend: 'confirm' }) });
  const lane = await fixture.openLane({ ...fixture.options, tools: createCanvasLaneTools({
    read: async () => { throw new Error('No read expected'); },
    write: async () => ({ applied: true, proposalId: 'receipt-a', changeId: 'canvas:v1:receipt-a',
      operation: 'create_canvas_nodes', affectedNodeIds: ['node-a'], affectedEdgeIds: [],
      clientIdToNodeId: { artifact: 'node-a' }, connectedCount: 0, skippedEdges: [],
      reconciliation: { ok: true, deviationCount: 0 } }),
  }) });
  await lane.execute({ kind: 'prompt', text: 'Create a text card.' });
  assert.equal(lane.projection().running, false);
  assert.equal(lane.projection().pending, undefined);
  assert.equal(fixture.http.requests.length, 2, 'one tool call and one closing provider response');
  const messages = fixture.http.requests[1]!.body.messages as Array<{ role: string; content: string }>;
  const receipt = messages.find(message => message.role === 'tool');
  assert.ok(receipt);
  assert.match(receipt.content, /changeId=canvas:v1:receipt-a/);
});
