import assert from 'node:assert/strict';
import test from 'node:test';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { createCanvasLaneTools } from '../../electron/agentLane/laneCanvasTools.js';
import { createExtendedLaneTools } from '../../electron/agentLane/laneExtendedTools.js';
import type { CanvasWriteInput, CanvasWriteResult } from '../../electron/shared/agentCapabilities/canvasWrite.js';
import { createLaneFixture } from './laneFixture.mjs';

// 20 动词（设计正本 §5.2 / 拍板 2026-09-11）：分镜不再是「先审阅方案再落画布」的写——`draft_shots` 建的是
// 草稿（落画布、带单价、不出卡、不花钱），`generate` 才把报价卡摆到用户面前。审阅点从「方案」挪到了「钱」。
const shots = [{ title: 'Fixture sunrise', prompt: 'Fixture sunrise.', taskKind: 'text_to_image' }];

test('safe-auto lands draft_shots directly without a review card, and nothing is spent', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'fixture-draft', name: 'draft_shots', arguments: { shots } }] },
    { type: 'text', text: 'Fixture complete.' },
  ], { hasUserInterface: true, policy: () => ({ mode: 'safe-auto', spend: 'confirm' }) });
  let writes = 0, cards = 0;
  const lane = await openLane({ ...fixture.options, tools: createExtendedLaneTools({
    execute: async (call) => { writes += 1; assert.equal(call.toolName, 'draft_shots');
      return { ok: true, result: { operation: { operationId: 'op-1', state: 'draft', cardHidden: true } } }; },
  }) });
  try {
    lane.subscribe((projection) => { if (projection.pending) cards += 1; });
    await lane.execute({ kind: 'prompt', text: 'Draft the fixture storyboard.' });
    assert.equal(writes, 1);
    assert.equal(cards, 0, 'a draft is a reversible local write: no card');
    const result = lane.projection().parts.find((part) => part.kind === 'tool-result');
    assert.ok(result?.kind === 'tool-result' && !result.isError);
    assert.match(result.text, /Nothing has been generated and nothing has been spent/);
  } finally { await lane.close(); }
});

test('generate returns isError + STOP: the model cannot claim generation started', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'fixture-generate', name: 'generate', arguments: { draftId: 'op-1' } }] },
    { type: 'text', text: 'The card is in front of you.' },
  ], { hasUserInterface: true, policy: () => ({ mode: 'safe-auto', spend: 'confirm' }) });
  const lane = await openLane({ ...fixture.options, tools: createExtendedLaneTools({
    execute: async (call) => { assert.equal(call.toolName, 'generate');
      return { ok: true, result: { operation: { operationId: 'op-1', state: 'draft' }, shots: ['shot-1', 'shot-2'], nextAction: 'await_user' } }; },
  }) });
  try {
    await lane.execute({ kind: 'prompt', text: 'Generate them.' });
    const result = lane.projection().parts.find((part) => part.kind === 'tool-result');
    assert.ok(result?.kind === 'tool-result' && result.isError, `the spend card is delivered as an error result: ${result?.kind === 'tool-result' ? result.text : String(result?.kind)}`);
    assert.match(result.text, /priced confirmation card in Nomi/);
    assert.match(result.text, /for 2 shot\(s\)/);
    assert.match(result.text, /STOP/);
    assert.match(result.text, /Generation has NOT started/);
  } finally { await lane.close(); }
});

function applied(input: CanvasWriteInput): CanvasWriteResult {
  const common = { applied: true as const, proposalId: 'fixture-proposal', reconciliation: { ok: true, deviationCount: 0 } };
  if (input.operation !== 'create_canvas_nodes') throw new Error(`fixture only writes artifacts, got ${input.operation}`);
  return { ...common, operation: input.operation, affectedNodeIds: ['fixture-node'], affectedEdgeIds: [], clientIdToNodeId: { 'artifact-1': 'fixture-node' }, connectedCount: 0, skippedEdges: [] };
}

test('safe-auto still executes an ordinary local canvas write without a review card', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'fixture-local-write', name: 'make_artifact',
      arguments: { fileType: 'text', title: 'Fixture note', content: 'Fixture local edit.' } }] },
    { type: 'text', text: 'Fixture complete.' },
  ], { hasUserInterface: true, policy: () => ({ mode: 'safe-auto', spend: 'confirm' }) });
  let writes = 0, cards = 0;
  const lane = await openLane({ ...fixture.options, tools: createCanvasLaneTools({
    read: async () => { throw new Error('Fixture does not read.'); },
    write: async (input) => { writes += 1; return applied(input); },
  }) });
  try {
    lane.subscribe((projection) => { if (projection.pending) cards += 1; });
    await lane.execute({ kind: 'prompt', text: 'Put a note on the canvas.' });
    assert.equal(writes, 1);
    assert.equal(cards, 0);
  } finally { await lane.close(); }
});
