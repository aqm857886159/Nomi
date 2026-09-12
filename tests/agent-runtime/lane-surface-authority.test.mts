import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import type { LaneComposerContext } from '../../electron/shared/agentLane/laneDesktopContracts.js';
import { LANE_MODEL_TOOL_CATALOG, LANE_DEFERRED_TOOL_CATALOG } from '../../electron/agentLane/laneToolCatalog.js';
import { bindLaneTool } from '../../electron/agentLane/laneRuntimePort.js';
import { createLaneFixture, FIXTURE_DESCRIBE } from './laneFixture.mjs';

for (const contractId of ['canvas.delete', 'canvas.write', 'timeline.write', 'document.write']) {
  for (const target of [undefined, { kind: 'document' as const, documentId: 'doc', anchor: { kind: 'whole-document' as const } }, { kind: 'canvas' as const, nodeIds: [] }]) {
    test(`${contractId} checks consumed target ${target?.kind ?? 'missing'} before preparation`, async t => {
      const fixture = await createLaneFixture(t, [
        { type: 'tool', calls: [{ id: 'surface-call', name: 'mutate_surface', arguments: {} }] },
        { type: 'text', text: 'Done.' },
      ]);
      const context: LaneComposerContext = { approvalPolicy: { mode: 'safe-auto', spend: 'confirm' }, ...(target ? { target } : {}) };
      let preparations = 0;
      let executions = 0;
      const expectedAllowed = contractId !== 'canvas.delete' || target?.kind === 'canvas';
      const lane = await fixture.openLane({ ...fixture.options,
        input: { capture: () => context, activate: () => {}, rewritePayload: payload => payload,
          providerContent: async message => message.content },
        tools: [{ name: 'mutate_surface', contractId, description: 'Mutate a surface.', promptSnippet: 'Mutate a surface.', nextAction: 'none', describe: FIXTURE_DESCRIBE,
          schema: z.object({}), examples: [], effect: 'irreversible',
          execution: { timeoutMs: 30_000 }, execute: async () => { executions++; return { ok: true, text: "applied" }; } }],
        toolLifecycle: { prepare: async () => { preparations++; }, approved: async () => {}, settled: () => {} },
      });
      await lane.execute({ kind: 'prompt', text: 'Mutate the selected surface.' });
      assert.equal(executions, expectedAllowed ? 1 : 0);
      assert.equal(preparations, expectedAllowed ? 1 : 0);
      const result = (fixture.http.requests[1]?.body as { messages: Array<{ role: string; tool_call_id?: string }> }).messages.find((m: { role: string; tool_call_id?: string }) => m.role === 'tool' && m.tool_call_id === 'surface-call');
      assert.ok(result, 'The model receives an actual tool result');
      assert.match(JSON.stringify(result), expectedAllowed ? /applied/ : /surface_authority_denied/);
    });
  }
}

for (const mode of ['safe-auto', 'step'] as const) {
  for (const probe of [
    { name: 'bash', args: { command: 'printf executed > sentinel.txt' } },
    { name: 'write', args: { path: 'sentinel.txt', content: 'executed' } },
  ]) {
    test(`locked ${probe.name} returns denial before ${mode} approval without a sandbox`, async t => {
      const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime');
      const { writeFile, readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      t.mock.method(SandboxManager, 'isSupportedPlatform', () => false);
      const fixture = await createLaneFixture(t, [
        { type: 'tool', calls: [{ id: 'locked-call', name: probe.name, arguments: probe.args }] },
        { type: 'text', text: 'Denied.' },
      ]);
      const sentinel = join(fixture.projectDir, 'sentinel.txt');
      await writeFile(sentinel, 'not executed');
      const lane = await fixture.openLane({ ...fixture.options,
        tools: [...LANE_MODEL_TOOL_CATALOG, ...LANE_DEFERRED_TOOL_CATALOG].map(spec => bindLaneTool(spec, async () => ({ ok: true, text: 'fixture' }))),
        native: { settingsRoot: join(fixture.projectDir, 'settings'), skills: [] },
        approval: { hasUserInterface: true, policy: () => ({ mode, spend: 'confirm' }) },
      });
      let pendingSeen = false;
      const unsubscribe = lane.subscribe(projection => {
        if (projection.pending) {
          pendingSeen = true;
          void lane.execute({ kind: 'approval', toolCallId: projection.pending.toolCallId, action: 'deny' });
        }
      });
      fixture.after(unsubscribe);
      await lane.execute({ kind: 'prompt', text: 'Try the locked project operation.' });
      assert.equal(pendingSeen, false, 'Missing coding authority must not ask for approval');
      assert.match(JSON.stringify(fixture.http.requests[1]?.body), /Request coding before accessing project files/);
      assert.ok(lane.projection().parts.some(part => part.kind === 'tool-result' && part.isError));
      assert.equal(await readFile(sentinel, 'utf8'), 'not executed');
    });
  }
}
