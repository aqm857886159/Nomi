import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { AgentHarness } from '@earendil-works/pi-agent-core';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import { createModels } from '@earendil-works/pi-ai';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { createNomiProvider } from '../../electron/agentLane/laneModelProvider.mjs';
import { laneSessionsRoot, openLaneSession, listLaneSessions } from '../../electron/agentLane/laneSession.mjs';
import { createLaneTools } from '../../electron/agentLane/laneTools.mjs';
import { openLaneWorkspace } from '../../electron/agentLane/laneWorkspace.mjs';
import type { NomiModelConfig } from '../../electron/shared/agentLane/laneModelConfig.js';
import { createHttpFixture } from './httpFixture.mjs';
import { createLaneFixture } from './laneFixture.mjs';

test('reopening the same model preserves saved session bytes and updatedAt', async (t) => {
  const fixture = await createLaneFixture(t, [{ type: 'text', text: 'Saved fixture.' }]);
  const first = await openLane(fixture.options);
  t.after(() => first.close());
  await first.execute({ kind: 'prompt', text: 'Save the fixture.' });
  const beforeProjection = first.projection();
  await first.close();
  const root = laneSessionsRoot(fixture.projectDir);
  const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith('.jsonl'));
  const beforeBytes = await Promise.all(files.map((file) => readFile(join(root, file), 'utf8')));
  const beforeList = await listLaneSessions(fixture.projectDir, BACKGROUND_CONTEXT);
  const reopened = await openLane(fixture.options);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.projection(), beforeProjection);
  await reopened.close();
  assert.deepEqual(await Promise.all(files.map((file) => readFile(join(root, file), 'utf8'))), beforeBytes,
    'opening unchanged history must not append a configuration commit');
  assert.deepEqual(await listLaneSessions(fixture.projectDir, BACKGROUND_CONTEXT), beforeList,
    'updatedAt must stay unchanged, preserving conversation list order');
  assert.equal(fixture.http.requests.length, 1);
});

for (const change of ['same-provider-model', 'different-provider-protocol'] as const) {
  test(`saved workspace uses the selected ${change} on wire, in projection and after cold reopen`, async (t) => {
    const fixture = await createLaneFixture(t, [{ type: 'text', text: 'Original model response.' }]);
    const selectedHttp = await createHttpFixture([
      { type: 'text', text: 'Selected model response.' }, { type: 'text', text: 'Selected model after reopen.' },
    ]);
    t.after(selectedHttp.close);
    const workspace = await openLaneWorkspace(fixture.options);
    t.after(() => workspace.close());
    await workspace.execute({ kind: 'prompt', text: 'First fixture turn.' });
    const originalSession = workspace.projection().lanes[0]!.sessionId;
    assert.equal(fixture.http.requests[0]?.body.model, fixture.options.model.modelId);
    const selected: NomiModelConfig = { ...fixture.options.model,
      kind: change === 'different-provider-protocol' ? 'anthropic' : 'openai-compatible',
      providerId: change === 'different-provider-protocol' ? 'selected-provider' : fixture.options.model.providerId,
      modelId: 'selected-model', baseURL: selectedHttp.baseURL };
    await workspace.configureModel(selected);
    await workspace.execute({ kind: 'prompt', text: 'Use the selected fixture model.' });
    assert.equal(selectedHttp.requests.length, 1, 'the next real request must reach the newly selected provider');
    assert.equal(selectedHttp.requests[0]?.body.model, selected.modelId);
    const pathname = new URL(selectedHttp.requests[0]!.path, selectedHttp.baseURL).pathname;
    assert.match(pathname, change === 'different-provider-protocol' ? /\/messages$/ : /\/chat\/completions$/);
    assert.deepEqual(workspace.projection().active.model, { provider: selected.providerId, modelId: selected.modelId });
    assert.equal(workspace.projection().lanes[0]!.sessionId, originalSession, 'model selection must retain this conversation');
    assert.equal(fixture.http.requests.length, 1, 'the previous endpoint must receive no further request');
    await workspace.close();
    const reopened = await openLaneWorkspace({ ...fixture.options, model: selected });
    t.after(() => reopened.close());
    await reopened.execute({ kind: 'prompt', text: 'Continue after reopening the fixture.' });
    assert.equal(selectedHttp.requests[1]?.body.model, selected.modelId);
    assert.deepEqual(reopened.projection().active.model, { provider: selected.providerId, modelId: selected.modelId });
    assert.equal(reopened.projection().lanes[0]!.sessionId, originalSession);
    const userText = reopened.projection().active.parts.filter((part) => part.kind === 'user').map((part) => part.text);
    assert.deepEqual(userText, ['First fixture turn.', 'Use the selected fixture model.', 'Continue after reopening the fixture.']);
  });
}

test('model rebinding retains the SDK active tools added by a real tool result without activating the rest', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'unlock-selection', name: 'read_script', arguments: {} }] },
    { type: 'text', text: 'Selection read unlocked.' },
    { type: 'tool', calls: [{ id: 'use-selection', name: 'read_selection', arguments: {} }] },
    { type: 'text', text: 'Selection read after model replacement.' },
  ]);
  const context = BACKGROUND_CONTEXT;
  const opened = await openLaneSession({ projectDir: fixture.projectDir, laneName: 'main' }, context);
  const configured = await createNomiProvider(fixture.options.model, globalThis.fetch);
  const models = createModels({ credentials: configured.credentials });
  models.setProvider(configured.provider);
  const tools = createLaneTools(fixture.options.tools).map((tool) => tool.name === 'read_script'
    ? { ...tool, execute: async (...args: Parameters<typeof tool.execute>) => ({
      ...await tool.execute(...args), addedToolNames: ['read_selection'],
    }) } : tool);
  const { harness } = await AgentHarness.create<undefined>({ session: opened.session, models, model: configured.model,
    systemPrompt: fixture.options.systemPrompt, tools, activeToolNames: ['read_script'] }, context);
  let closingSeed: Promise<void> | undefined;
  const closeSeed = () => closingSeed ??= (async () => {
    try { await harness.close(context); } finally { await opened.release(context); }
  })();
  t.after(closeSeed);
  const seeded = await harness.lane('main', context);
  assert.equal((await seeded.prompt('Unlock the fixture selection reader.', undefined, context)).ok, true);
  assert.deepEqual(await seeded.getActiveTools(context), ['read_script', 'read_selection']);
  await closeSeed();
  const host = await openLane({ ...fixture.options, model: { ...fixture.options.model, modelId: 'replacement-model' } });
  t.after(() => host.close());
  await host.execute({ kind: 'prompt', text: 'Read the fixture selection.' });
  assert.equal(fixture.http.requests.length, 4, 'the reopened host completes a real tool turn with the new model');
  const body = fixture.http.requests[2]!.body as { model: string; tools: Array<{ function: { name: string } }> };
  assert.equal(body.model, 'replacement-model');
  assert.deepEqual(body.tools.map((tool) => tool.function.name), ['read_script', 'read_selection']);
  assert.ok(host.projection().parts.some((part) => part.kind === 'tool-result' && part.toolCallId === 'use-selection' && !part.isError));
});
