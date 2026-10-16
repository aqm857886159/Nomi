import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { createLaneFixture } from './laneFixture.mjs';
import { openLaneWorkspace } from '../../electron/agentLane/laneWorkspace.mjs';
import { runLaneSingleShot } from '../../electron/agentLane/laneSingleShot.mjs';
import { createNomiModelDescriptor } from '../../electron/agentLane/laneModelProvider.mjs';
import { modelReasoning } from '../../electron/shared/agentLane/modelReasoning.js';

const declared = modelReasoning({ reasoning: true, reasoningEffort: 'high', thinkingLevelMap: {
  low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
} })!;
const config = { reasoning: declared.reasoning, thinkingLevelMap: declared.thinkingLevelMap, contextWindow: 1_000_000, maxOutputTokens: 128_000 };

test('declared selector choices exactly match SDK-supported reasoning levels', async (t) => {
  const fixture = await createLaneFixture(t, []);
  assert.deepEqual(getSupportedThinkingLevels(createNomiModelDescriptor({ ...fixture.options.model, ...config })), declared.levels);
});

test('high to low selection changes the real wire and persists across a cold reopen', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'text', text: 'High.' }, { type: 'text', text: 'Low.' }, { type: 'text', text: 'Low after reopen.' },
  ]);
  const model = { ...fixture.options.model, ...config, thinkingLevel: 'high' as const };
  const workspace = await openLaneWorkspace({ ...fixture.options, model });
  t.after(() => workspace.close());
  await workspace.execute({ kind: 'prompt', text: 'First turn.' });
  const sessionId = workspace.projection().lanes[0]!.sessionId;
  assert.equal(fixture.http.requests[0]?.body.reasoning_effort, 'high');
  assert.equal(workspace.projection().active.thinking.level, 'high');
  const low = { ...model, thinkingLevel: 'low' as const };
  await workspace.configureModel(low);
  await workspace.execute({ kind: 'prompt', text: 'Next turn.' });
  assert.equal(fixture.http.requests[1]?.body.reasoning_effort, 'low');
  assert.equal(fixture.http.requests[1]?.body.max_tokens, 128_000);
  assert.equal(workspace.projection().active.usage.contextWindow, 1_000_000);
  assert.equal(workspace.projection().lanes[0]!.sessionId, sessionId);
  await workspace.close();
  const reopened = await openLaneWorkspace({ ...fixture.options, model: low });
  t.after(() => reopened.close());
  assert.equal(reopened.projection().active.thinking.level, 'low');
  await reopened.execute({ kind: 'prompt', text: 'Cold reopen.' });
  assert.equal(fixture.http.requests[2]?.body.reasoning_effort, 'low');
});

test('single-shot requests use the chosen reasoning level and report that level', async (t) => {
  const fixture = await createLaneFixture(t, [{ type: 'text', text: 'Single-shot low.' }]);
  const result = await runLaneSingleShot({ model: { ...fixture.options.model, ...config, thinkingLevel: 'low' }, fetch: globalThis.fetch, prompt: 'One reply.' });
  assert.equal(fixture.http.requests[0]?.body.reasoning_effort, 'low');
  assert.equal(result.thinking.level, 'low');
});

test('switching from reasoning to an ordinary model normalizes persisted thinking to off', async (t) => {
  const fixture = await createLaneFixture(t, [{ type: 'text', text: 'High.' }, { type: 'text', text: 'Ordinary.' }]);
  const model = { ...fixture.options.model, ...config, thinkingLevel: 'high' as const };
  const workspace = await openLaneWorkspace({ ...fixture.options, model });
  t.after(() => workspace.close());
  await workspace.execute({ kind: 'prompt', text: 'Reason first.' });
  await workspace.configureModel({ ...fixture.options.model, contextWindow: 1_000_000, maxOutputTokens: 128_000 });
  {
    const thinking = workspace.projection().active.thinking;
    assert.deepEqual(thinking.supportedLevels, ['off']);
    assert.equal(thinking.level, 'off');
  }
  await workspace.execute({ kind: 'prompt', text: 'Ordinary model next.' });
  assert.equal(fixture.http.requests[1]?.body.reasoning_effort, undefined);
});
