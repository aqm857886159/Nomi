import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AgentHarness } from '@earendil-works/pi-agent-core';
import { createModels } from '@earendil-works/pi-ai';
import { createNomiProvider } from '../../electron/agentLane/laneModelProvider.mjs';
import { openLaneSession } from '../../electron/agentLane/laneSession.mjs';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import { z } from 'zod';
import { createLaneNativeAssembly } from '../../electron/agentLane/laneNativeAssembly.mjs';
import { createExtendedLaneTools } from '../../electron/agentLane/laneExtendedTools.js';
import { createCanvasLaneTools } from '../../electron/agentLane/laneCanvasTools.js';
import { toModelVisibleSchema } from '../../electron/agentLane/laneToolSchema.mjs';
import { createLaneTools } from '../../electron/agentLane/laneTools.mjs';
import { bindLaneTool } from '../../electron/agentLane/laneRuntimePort.js';
import { LANE_MODEL_TOOL_CATALOG, LANE_DEFERRED_TOOL_CATALOG } from '../../electron/agentLane/laneToolCatalog.js';
import { generationPlanInputSchema } from '../../electron/shared/agentCapabilities/generationPlanSchemas.js';
import { createLaneFixture } from './laneFixture.mjs';

const sandbox = { active: true, operations: { exec: async () => ({ exitCode: 0 }) }, close: async () => undefined };
const closing = { type: 'text' as const, text: '完成。' };
const plan = () => LANE_DEFERRED_TOOL_CATALOG.find(s => s.name === 'draft_shots')!;
const textOf = (result: { content: readonly { type: string; text?: string }[] }) => result.content.map(p => p.text ?? '').join('\n');

test('C19 · switching groups tells the model core tools remain callable', async t => {
  const f = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'switch', name: 'nomi_request_tools', arguments: { group: 'coding' } }] },
    { type: 'tool', calls: [{ id: 'core', name: 'read_script', arguments: {} }] }, closing,
  ]);
  const native = await createLaneNativeAssembly({ projectDir: f.projectDir, sandbox, bashTimeoutMs: 5000 });
  const request = native.tools.find(tool => tool.name === 'nomi_request_tools')!;
  const configured = await createNomiProvider(f.options.model, globalThis.fetch);
  const models = createModels({ credentials: configured.credentials });
  models.setProvider(configured.provider);
  const session = await openLaneSession({ projectDir: f.projectDir, laneName: 'main' }, BACKGROUND_CONTEXT);
  const { harness } = await AgentHarness.create<undefined>({ session: session.session, models,
    model: configured.model, systemPrompt: 'Read the creation document after switching groups.',
    tools: [...createLaneTools(LANE_MODEL_TOOL_CATALOG.map(spec =>
      f.options.tools.find(tool => tool.name === spec.name) ?? bindLaneTool(spec, async () => {
        throw new Error('Unexpected domain call');
      }))), ...native.tools],
    activeToolNames: [...native.activeToolNames()],
  }, BACKGROUND_CONTEXT);
  f.after(async () => { await harness.close(BACKGROUND_CONTEXT); await session.release(BACKGROUND_CONTEXT); });
  const lane = await harness.lane('main', BACKGROUND_CONTEXT);
  native.bindActiveTools(lane);
  const result = await request.execute('switch', { group: 'coding' } as never, (() => undefined) as never, undefined, {} as never, BACKGROUND_CONTEXT);
  assert.match(textOf(result), /All tool groups remain available/);
  assert.equal(result.addedToolNames, undefined);
  assert.match(request.description, /without removing other tools/);
  assert.equal((await lane.prompt('切组后读文稿', undefined, BACKGROUND_CONTEXT)).ok, true);
  assert.match(JSON.stringify(f.http.requests.at(-1)?.body), /The opening scene/);

});

test('C26 · replay the first human failure and show a valid candidate example', async t => {
  const args = JSON.parse(await readFile('docs/plan/agent-lane-b1-evidence/c26-first-call.json', 'utf8'));
  const f = await createLaneFixture(t, [{ type: 'tool', calls: [{ id: 'bad', name: plan().name, arguments: args }] }, closing]);
  const lane = await f.openLane({ ...f.options, tools: createExtendedLaneTools({ execute: async () => { throw new Error('Invalid call must not execute'); } }) });
  await lane.execute({ kind: 'prompt', text: '试拍' });
  const body = JSON.stringify(f.http.requests.at(-1)?.body);
  assert.match(body, /应长这样/);
  assert.ok(plan().examples.some(e => e.arguments.taskKind && e.arguments.candidate));
  for (const e of plan().examples) assert.equal(plan().schema.safeParse(e.arguments).success, true);
});

test('C28 · lane hides preview while the external contract retains it', () => {
  assert.equal(plan().schema.safeParse({ operation: 'preview', operationId: 'op-one' }).success, false);
  const schema = toModelVisibleSchema(plan().schema, { toolName: plan().name });
  assert.doesNotMatch(JSON.stringify(schema), /preview/);
  assert.equal(generationPlanInputSchema.safeParse({ operation: 'preview', operationId: 'op-one' }).success, true);
});

test('C29 · 246KB context defaults to a useful <=4KB summary; full scope is explicit', async () => {
  const huge = { projectId: 'fixture-project', providerProfiles: [{ providerId: 'fixture', modelIds: ['video-one'] }],
    videoModels: [{ providerId: 'fixture', modelId: 'video-one', label: '视频一', variants: [{ modes: [{ id: 't2v', transportTaskKind: 'text_to_video' }] }], description: 'x'.repeat(246 * 1024) }], nextAction: 'create' };
  const desc = createExtendedLaneTools({ execute: async () => ({ ok: true, result: huge }) }).find(s => s.name === plan().name)!;
  const result = await desc.execute({ operation: 'context', taskKind: 'text_to_video' }, { toolCallId: 'ctx', signal: new AbortController().signal });
  assert.ok(result.ok);
  assert.ok(Buffer.byteLength(result.text) <= 4096);
  assert.match(result.text, /video-one/);
  assert.match(result.text, /scope/);
  assert.equal(desc.schema.safeParse({ operation: 'context', scope: 'full', taskKind: 'text_to_video' }).success, true);
  const tool = createLaneTools([{ ...desc, schema: z.object({}), execute: async () => ({ ok: true, text: 'HEAD-' + '文'.repeat(100000) }) }])[0];
  const bounded = await tool.execute('ctx', {}, (() => undefined) as never, undefined, {} as never, BACKGROUND_CONTEXT);
  assert.match(textOf(bounded), /^HEAD-/);
  assert.doesNotMatch(textOf(bounded), /showing the first 0/);
});

const canvasArgs = { operation: 'create_canvas_nodes', summary: '开场', nodes: [{ clientId: 'opening', kind: 'image', title: '开场', prompt: '落日' }] };
const canvasTools = () => createCanvasLaneTools({ read: async () => ({}), write: async () => ({
  applied: true, operation: 'create_canvas_nodes', proposalId: 'op-proposal', clientIdToNodeId: { opening: 'gen-v2-image-opening' },
} as never) });

test('C27/C43 · auto-granted canvas write reports direct undoable application without ids in prose', async t => {
  const f = await createLaneFixture(t, [{ type: 'tool', calls: [{ id: 'write', name: 'nomi_canvas_write', arguments: canvasArgs }] }, closing],
    { hasUserInterface: true, policy: () => ({ mode: 'safe-auto', spend: 'confirm' }) });
  const lane = await f.openLane({ ...f.options, tools: canvasTools() });
  await lane.execute({ kind: 'prompt', text: '创建开场' });
  const messages = f.http.requests.at(-1)!.body.messages as Array<{ role: string; content: unknown }>;
  const result = messages.filter(m => m.role === 'tool').map(m => String(m.content)).join('\n');
  assert.match(result, /Applied directly \(undoable\)/);
  assert.doesNotMatch(result, /gen-v2-|op-/);
  assert.match(JSON.stringify(messages), /不向用户展示内部 id/);
});

test('C27 · prompt approval projection follows current policy changes', async t => {
  let mode: 'safe-auto' | 'step' = 'safe-auto';
  const f = await createLaneFixture(t, [closing, closing], { hasUserInterface: true, policy: () => ({ mode, spend: 'confirm' }) });
  const lane = await f.openLane({ ...f.options, tools: canvasTools() });
  await lane.execute({ kind: 'prompt', text: '看一下' });
  mode = 'step';
  await lane.execute({ kind: 'prompt', text: '再看一下' });
  const system = (i: number) => JSON.stringify((f.http.requests[i].body.messages as Array<{ role: string }>).filter(m => m.role === 'system'));
  assert.match(system(0), /直接生效并可撤销/);
  assert.match(system(1), /会向用户确认/);
  assert.notEqual(system(0), system(1));
});

test('C42 · steer immediately releases approval and precedes the next assistant request', async t => {
  const f = await createLaneFixture(t, [{ type: 'tool', calls: [{ id: 'write', name: 'write_script', arguments: { where: 'end', content: 'BAD' } }] }, closing],
    { hasUserInterface: true, policy: () => ({ mode: 'step', spend: 'confirm' }) });
  const lane = await f.openLane(f.options);
  let ready!: () => void;
  const pending = new Promise<void>(r => { ready = r; });
  const unsub = lane.subscribe(p => { if (p.pending) ready(); });
  const run = lane.execute({ kind: 'prompt', text: '修改' });
  await pending;
  const admission = await lane.execute({ kind: 'prompt', text: '等等别动' }).then(() => true, () => false);
  const stillWaiting = lane.projection().pending;
  if (stillWaiting) await lane.execute({ kind: 'approval', toolCallId: stillWaiting.toolCallId, action: 'deny' });
  await run;
  unsub();
  assert.equal(admission, true, 'Running prompt must be admitted as steer');
  assert.equal(stillWaiting, undefined, 'Steer itself must wake the pending approval');
  assert.doesNotMatch(f.document.text(), /BAD/);
  assert.match(JSON.stringify(f.http.requests[1].body.messages), /等等别动/);
  const parts = lane.projection().parts;
  const userIndex = parts.findIndex(p => p.kind === 'user' && p.text === '等等别动');
  const nextAssistant = parts.findIndex((p, i) => i > userIndex && p.kind === 'assistant-text');
  assert.ok(userIndex >= 0 && nextAssistant > userIndex, 'Persisted steer precedes the next assistant entry');
});

test('C47 · host carries adaptive brevity instructions', async t => {
  const f = await createLaneFixture(t, [closing]);
  const lane = await f.openLane(f.options);
  await lane.execute({ kind: 'prompt', text: '画布上有什么' });
  assert.match(JSON.stringify(f.http.requests[0].body), /只读.*收尾.*≤3.*不复述清单/);
  assert.match(JSON.stringify(f.http.requests[0].body), /费用只引用报价卡.*目录单价/);
  assert.match(JSON.stringify(f.http.requests[0].body), /提交时会显示报价/);
});


test('C29 class · taskKind removes unrelated video modes; full scope retains detail and UTF-8 head is intact', async () => {
  const huge = { videoModels: [
    { modelId: 'text-model', modes: [{ id: 'text', transportTaskKind: 'text_to_video' }] },
    { modelId: 'image-model', modes: [{ id: 'image', transportTaskKind: 'image_to_video', parameters: [{ key: 'duration' }] }] },
  ], providerProfiles: [{ providerId: 'image-provider', modelIds: ['image-generation'] }] };
  const desc = createExtendedLaneTools({ execute: async () => ({ ok: true, result: huge }) }).find(s => s.name === plan().name)!;
  const context = { toolCallId: 'ctx', signal: new AbortController().signal };
  const result = await desc.execute({ operation: 'context', taskKind: 'image_to_video', scope: 'full' }, context);
  assert.ok(result.ok);
  assert.match(result.text, /duration/);
  assert.doesNotMatch(result.text, /text-model|image-provider/);
  const tool = createLaneTools([{ ...desc, schema: z.object({}), execute: async () => ({ ok: true, text: '文'.repeat(100000) }) }])[0];
  const bounded = await tool.execute('ctx', {}, (() => undefined) as never, undefined, {} as never, BACKGROUND_CONTEXT);
  assert.doesNotMatch(textOf(bounded), /�/);
});

test('C43 class · ids remain in structured receipt for host reconciliation', async () => {
  const result = await canvasTools().find(t => t.name === 'nomi_canvas_write')!.execute(canvasArgs,
    { toolCallId: 'write', signal: new AbortController().signal });
  assert.ok(result.ok);
  assert.doesNotMatch(result.text, /gen-v2-|op-/);
  assert.match(JSON.stringify(result.details), /gen-v2-image-opening/);
});

test('C27 class · read confirmation and trusted overrides use the execution decision', async t => {
  const f = await createLaneFixture(t, [closing], { hasUserInterface: true, policy: () => ({ mode: 'step', spend: 'confirm' }) });
  const lane = await f.openLane(f.options);
  await lane.execute({ kind: 'prompt', text: '只看一下' });
  assert.match(JSON.stringify(f.http.requests[0].body.messages), /- read_script: 此动作会向用户确认/);
  const g = await createLaneFixture(t, [closing], {
    hasUserInterface: true, policy: () => ({ mode: 'safe-auto', spend: 'confirm' }),
    resolveSubject: () => ({ forceConfirmation: true, subject: { toolName: 'nomi_canvas_write',
      capabilityId: 'canvas.write', effect: 'reversible_write', effectClass: 'reversible_local',
      requiresPlanReview: false, destructiveHint: false } }),
  });
  const overridden = await g.openLane({ ...g.options, tools: canvasTools() });
  await overridden.execute({ kind: 'prompt', text: '看看权限' });
  assert.match(JSON.stringify(g.http.requests[0].body.messages), /- nomi_canvas_write.create_canvas_nodes: 此动作会向用户确认/);
});
