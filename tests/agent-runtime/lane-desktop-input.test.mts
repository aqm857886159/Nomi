import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import type { LaneComposerContext } from '../../electron/shared/agentLane/laneDesktopContracts.js';
import { createLaneFixture, FIXTURE_DESCRIBE } from './laneFixture.mjs';

// User changes the selection twice while one tool is running. Each queued instruction
// must retain the selection it named; no sleep or second transcript is involved.
test('desktop input follows consumed messages, including after a queued selection change', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'first', name: 'read_document', arguments: {} }] },
    { type: 'tool', calls: [{ id: 'second', name: 'read_document', arguments: {} }] },
    { type: 'text', text: 'Done.' },
  ]);
  let draft: LaneComposerContext = { documentId: 'first-document', approvalPolicy: { mode: 'safe-auto', spend: 'confirm' } };
  let active: LaneComposerContext | undefined;
  const visited: string[] = [];
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const lane = await openLane({
    ...fixture.options,
    input: {
      capture: () => draft,
      activate: (context) => { active = context; },
      rewritePayload: (payload) => payload,
      providerContent: async (message) => `${message.content}\nDocument: ${message.context.documentId}`,
    },
    tools: [{ name: 'read_document', contractId: 'document.read',
      description: 'Read the selected document.', promptSnippet: 'read the selected document.', nextAction: 'none', describe: FIXTURE_DESCRIBE,
      effect: 'read',
      execution: { timeoutMs: 30_000 }, schema: z.object({}), examples: [],
      execute: async () => {
        visited.push(active?.documentId ?? 'missing');
        if (visited.length === 1) { entered(); await held; }
        return { ok: true, text: 'The selected document.' };
      },
    }],
  });
  t.after(() => lane.close());
  const run = lane.execute({ kind: 'prompt', text: 'Read this.' });
  await started;
  draft = { ...draft, documentId: 'second-document' };
  await lane.execute({ kind: 'steer', text: 'Now read this other one.' });
  draft.documentId = 'third-document';
  assert.deepEqual(lane.projection().queues.map((message) => message.text), ['Now read this other one.']);
  const activeBeforeRelease = active?.documentId;
  release();
  await run;
  assert.equal(activeBeforeRelease, 'first-document');
  assert.deepEqual(visited, ['first-document', 'second-document']);
  assert.deepEqual(lane.projection().parts.filter((part) => part.kind === 'user').map((part) => part.text),
    ['Read this.', 'Now read this other one.']);
});

test('saved lane history remains readable without a model and resumes after model configuration', async (t) => {
  const fixture = await createLaneFixture(t, [{ type: 'text', text: 'A saved reply.' }]);
  const original = await openLane(fixture.options);
  await original.execute({ kind: 'prompt', text: 'Keep this conversation.' });
  await original.close();
  const { openLaneWorkspace } = await import('../../electron/agentLane/laneWorkspace.mjs');
  const workspace = await openLaneWorkspace({ ...fixture.options, model: undefined });
  t.after(() => workspace.close());
  const before = workspace.projection().active.parts;
  assert.ok(before.some((part) => part.kind === 'assistant-text' && part.text === 'A saved reply.'));
  await assert.rejects(workspace.execute({ kind: 'prompt', text: 'No model should be called.' }), /not configured/);
  assert.equal(fixture.http.requests.length, 1);
  await workspace.configureModel(fixture.options.model);
  assert.deepEqual(workspace.projection().active.parts, before);
  assert.equal(fixture.http.requests.length, 1, 'Configuring a model must not start a completed conversation.');
});
