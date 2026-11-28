import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { openLaneSession } from '../../electron/agentLane/laneSession.mjs';
import type { LaneComposerContext } from '../../electron/shared/agentLane/laneDesktopContracts.js';
import { createLaneFixture, FIXTURE_DESCRIBE } from './laneFixture.mjs';

test('admitted canvas input survives two compactions and an unrelated unsent draft', async t => {
  const f = await createLaneFixture(t, [
    { type: 'message', parts: [{ type: 'text', text: 'material '.repeat(18000) }, { type: 'toolCall', id: 'read-one', name: 'read_script', arguments: { scope: 'full' } }], usage: { input: 81000, output: 100 } },
    { type: 'text', text: 'summary deliberately omits task' },
    { type: 'message', parts: [{ type: 'text', text: 'material '.repeat(18000) }, { type: 'toolCall', id: 'read-two', name: 'read_script', arguments: { scope: 'full' } }], usage: { input: 81000, output: 100 } },
    { type: 'text', text: 'summary deliberately omits task' },
    { type: 'tool', calls: [{ id: 'after-compaction-delete', name: 'mutate_surface', arguments: {} }] },
    { type: 'text', text: 'finished' },
    { type: 'text', text: 'new turn' },
  ]);
  let captured: LaneComposerContext = { approvalPolicy: { mode: 'request' },
    target: { kind: 'canvas', nodeIds: [] }, systemPrompt: 'ADMITTED_TEMPLATE', skillPrompt: 'ADMITTED_SKILL' };
  const activations: LaneComposerContext[] = [];
  let executions = 0;
  const host = await f.openLane({ ...f.options,
    input: { capture: () => captured, activate: context => { activations.push(context); },
      providerContent: async message => message.content, rewritePayload: payload => payload },
    tools: [...f.options.tools, { name: 'mutate_surface', contractId: 'canvas.delete',
      description: 'Counter-only authority probe', promptSnippet: 'Counter-only probe', nextAction: 'none',
      describe: FIXTURE_DESCRIBE, schema: z.object({}), examples: [], effect: 'irreversible',
      execution: { timeoutMs: 30000 }, execute: async () => { executions++; return { ok: true, text: 'applied' }; } }],
    model: { ...f.options.model, contextWindow: 1000000 },
  });
  await host.execute({ kind: 'prompt', text: 'ORIGINAL_CANVAS_TASK' }, { onAccepted: () => {
    captured = { approvalPolicy: { mode: 'request' },
      target: { kind: 'document', documentId: 'other', anchor: { kind: 'whole-document' } },
      systemPrompt: 'UNSENT_DRAFT_TEMPLATE', skillPrompt: 'UNSENT_DRAFT_SKILL' };
  } });
  const requests = f.http.requests.filter(r => Array.isArray(r.body.tools) && r.body.tools.length);
  const body = JSON.stringify(requests.at(-1)!.body);
  assert.equal(executions, 1, 'counter represents the original admitted surface, with no real project mutation');
  assert.doesNotMatch(body, /surface_authority_denied|UNSENT_DRAFT/);
  assert.match(body, /ADMITTED_TEMPLATE/);
  assert.match(body, /ADMITTED_SKILL/);
  assert.equal(activations.at(-1)?.admissionSurface, 'canvas');

  await host.execute({ kind: 'prompt', text: 'NEW_DOCUMENT_TASK' });
  assert.equal(activations.at(-1)?.admissionSurface, 'document', 'new operation captures its own admission');
  const newBody = JSON.stringify(f.http.requests.at(-1)!.body);
  assert.match(newBody, /UNSENT_DRAFT_TEMPLATE/);
  assert.doesNotMatch(newBody, /ADMITTED_TEMPLATE|ADMITTED_SKILL/);
  await host.close();
  const opened = await openLaneSession({ projectDir: f.projectDir });
  f.after(async () => { await opened.release(); });
  const entries = opened.session.findBranchEntries({ order: 'oldestFirst' });
  assert.ok(entries.filter(entry => entry.type === 'compaction').length >= 2, 'two actual SDK compactions persisted');
});
