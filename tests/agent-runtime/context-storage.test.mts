import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import type { AgentContextBinding, AgentContextScope } from '../../electron/harness/context/contextBinding.js';
import { createAgentContextService } from '../../electron/harness/context/contextService.js';
import { createAgentContextStore } from '../../electron/harness/context/contextStore.js';
import type { RuntimeSnapshotCodec, RuntimeTurnRequest } from '../../electron/harness/runtime/runtimePort.js';
import { runAgentTurn, snapshotCodec } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import { exportSnapshot, importSnapshot } from '../../electron/harness/runtime/pi/snapshot.mjs';
import { createProjectAgentContextBinding } from '../../electron/shared/contracts/projectAgentContextBinding.js';
import { createRuntimeFixture, type FixtureReply } from './httpFixture.mjs';

// Two different threads of the same project. Their durable contexts must stay
// separate even though they share a project and (historically) a thread id.
const PROJECT = Object.freeze({
  projectId: 'project-1',
  immutableProjectUuid: '4d80f2e0-4a45-4a8f-8fe1-78ac659177c8',
  projectGeneration: 3,
});
const creation: AgentContextBinding = createProjectAgentContextBinding(PROJECT, 'thread-creation');
const generation: AgentContextBinding = createProjectAgentContextBinding(PROJECT, 'thread-generation');
const persistent = (binding: AgentContextBinding): AgentContextScope => ({ kind: 'persistent', binding });
const bubbles = [{ role: 'user', content: 'OLD_EXPLICIT_UI_BRIEF' }, { role: 'assistant', content: 'OLD_EXPLICIT_UI_ANSWER' },
  { role: 'tool', content: 'Old UI operation text, not permission to replay' }];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDYQAAAAASUVORK5CYII=', 'base64');
const pdf = Buffer.from('%PDF-1.7\nNomi durable reference document.\n%%EOF');

function serviceAt(request: RuntimeTurnRequest) {
  const file = join(request.cwd, '.nomi', 'agent-thread-context-v1.json');
  const store = createAgentContextStore({ resolveFile: () => file });
  return { file, store, service: createAgentContextService({ store, codec: snapshotCodec, runAgentTurn }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

test('fresh disk service restores actual SDK tools, images, PDF and compaction without executing old actions', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'tool', calls: [{ id: 'read-1', name: 'read_shot', arguments: {} }] },
    { type: 'text', text: 'The reference is recorded.' },
    { type: 'text', text: 'Continuing the preserved context.' },
  ]);
  request.model = { ...request.model, kind: 'anthropic' };
  request.user = { durableText: 'Use this durable reference.', images: [{ mimeType: 'image/png', data: png }],
    pdfs: [{ fileName: 'reference.pdf', data: pdf }] };
  request.tools = [{ name: 'read_shot', description: 'Read the current shot once.', schema: z.object({}) }];
  let executions = 0;
  const hooks = { emit: () => {}, awaitToolConfirmation: async () => {
    executions += 1; return { ok: true as const, result: 'ACTUAL_PRESERVED_READ_RESULT' };
  } };
  const first = serviceAt(request);
  const completed = await first.service.run(persistent(creation), () => request, hooks);
  assert.equal(completed.status, 'finished');
  assert.equal(executions, 1);
  assert.equal(first.store.read(creation)?.snapshot, completed.snapshot);
  assert.ok(completed.snapshot);

  const manager = await importSnapshot(completed.snapshot, request);
  // PDF custom content precedes the prompt's user entry. Keep that boundary;
  // choosing the later user entry would intentionally summarize away the PDF.
  const firstKept = manager.getEntries().find((entry) => entry.type === 'custom_message' && entry.customType === 'nomi.native-pdf.v1');
  assert.ok(firstKept);
  manager.appendCompaction('NATIVE_DURABLE_REFERENCE_SUMMARY', firstKept.id, 1200, { retainedReference: true }, false,
    { input: 50, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 60,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  const fullSnapshot = exportSnapshot({ sessionManager: manager, isIdle: true, isCompacting: false });
  first.store.save(creation, fullSnapshot);
  const beforeReopen = await readFile(first.file);
  const reopened = serviceAt(request);
  const info = await reopened.service.ensure(persistent(creation), { ...request, legacyBubbles: bubbles });
  assert.deepEqual(info, { source: 'native', state: 'ready', retainedMessages: manager.buildSessionContext().messages.length });
  assert.equal(await reopened.service.alive(persistent(creation), request), true);
  assert.deepEqual(await readFile(first.file), beforeReopen, 'cold inspect/seed must not rewrite a native record');
  assert.equal(executions, 1, 'restore never calls an action executor');
  assert.equal(http.requests.length, 2, 'inspect/seed never asks a model');
  const restored = await importSnapshot(reopened.store.read(creation)!.snapshot!, request);
  assert.deepEqual(restored.getEntries(), JSON.parse(JSON.stringify(manager.getEntries())));

  const continued = await reopened.service.run(persistent(creation), () => ({ ...request, user: { durableText: 'Continue.' } }), hooks);
  assert.equal(continued.status, 'finished');
  assert.equal(executions, 1, 'the retained tool pair must not run again during continuation');
  const wire = JSON.stringify(http.requests[2].body);
  assert.match(wire, /ACTUAL_PRESERVED_READ_RESULT|NATIVE_DURABLE_REFERENCE_SUMMARY/);
  assert.ok(wire.includes(png.toString('base64')));
  assert.ok(wire.includes(pdf.toString('base64')));
  assert.doesNotMatch(wire, /OLD_EXPLICIT_UI_BRIEF/);
  assert.deepEqual(await readdir(request.tempRoot), []);
});

test('two threads of one project send separate real model contexts after reopening', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'text', text: 'Creation answer.' }, { type: 'text', text: 'Generation answer.' },
    { type: 'text', text: 'Creation continuation.' },
  ]);
  const hooks = { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true as const }) };
  await serviceAt(request).service.run(persistent(creation), () => ({ ...request, user: { durableText: 'CREATION_ONLY_BRIEF' } }), hooks);
  await serviceAt(request).service.run(persistent(generation), () => ({ ...request, user: { durableText: 'GENERATION_ONLY_BRIEF' } }), hooks);
  await serviceAt(request).service.run(persistent(creation), () => ({ ...request, user: { durableText: 'Continue creation.' } }), hooks);
  assert.doesNotMatch(JSON.stringify(http.requests[1].body), /CREATION_ONLY_BRIEF|Creation answer/);
  assert.match(JSON.stringify(http.requests[2].body), /CREATION_ONLY_BRIEF/);
  assert.doesNotMatch(JSON.stringify(http.requests[2].body), /GENERATION_ONLY_BRIEF|Generation answer/);
  const storage = serviceAt(request).store;
  assert.match(storage.read(generation)!.snapshot!, /GENERATION_ONLY_BRIEF/);
  assert.match(storage.read(creation)!.snapshot!, /Continue creation/);
});

test('real legacy migration backs up unbound v2 bytes and only imports the explicitly bound bubbles once', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [{ type: 'text', text: 'The limited old context continued.' }]);
  const { file, service, store } = serviceAt(request);
  const original = Buffer.from(' {"version":2,"sessions":{"nomi:workbench:project-1:creation":[{"role":"user","content":"UNBOUND_CORE_NOT_OWNED_BY_THIS_THREAD"}]}}\r\n');
  await mkdir(join(request.cwd, '.nomi'));
  await writeFile(file, original);
  const imported = await service.ensure(persistent(creation), { ...request, legacyBubbles: bubbles });
  assert.deepEqual(imported, { source: 'legacy-limited', state: 'ready', retainedMessages: 2 });
  const backup = `${file}.legacy-${createHash('sha256').update(original).digest('hex')}.bak`;
  assert.deepEqual(await readFile(backup), original);
  const oldSnapshot = store.read(creation)!.snapshot!;
  assert.doesNotMatch(oldSnapshot, /UNBOUND_CORE_NOT_OWNED/);
  const native = await importSnapshot(oldSnapshot, request);
  assert.deepEqual(native.buildSessionContext().messages.map((message) => message.role), ['user', 'assistant']);
  let executions = 0;
  const actual = await serviceAt(request).service.run(persistent(creation), () => request, { emit: () => {},
    awaitToolConfirmation: async () => { executions += 1; return { ok: true }; } });
  assert.equal(actual.status, 'finished');
  assert.equal(executions, 0);
  assert.match(JSON.stringify(http.requests[0].body), /OLD_EXPLICIT_UI_BRIEF/);
  assert.doesNotMatch(JSON.stringify(http.requests[0].body), /UNBOUND_CORE_NOT_OWNED/);
  const continuedSnapshot = serviceAt(request).store.read(creation)!.snapshot!;
  const cold = serviceAt(request);
  await cold.service.ensure(persistent(creation), { ...request, legacyBubbles: [] });
  await cold.service.ensure(persistent(creation), { ...request, legacyBubbles: bubbles });
  assert.equal(cold.store.read(creation)?.source, 'legacy-limited');
  assert.equal(cold.store.read(creation)?.snapshot, continuedSnapshot);
  assert.deepEqual(await readFile(backup), original);
  assert.equal((await readdir(join(request.cwd, '.nomi'))).filter((name) => name.endsWith('.bak')).length, 1);
  await cold.service.clear(persistent(creation));
  const cleared = await serviceAt(request).service.ensure(persistent(creation), { ...request, legacyBubbles: bubbles });
  assert.deepEqual(cleared, { source: 'legacy-limited', state: 'cleared', retainedMessages: 0 });
  assert.deepEqual(await readdir(request.tempRoot), []);
});

test('ordinary Stop persists an actually completed tool pair before a cancelled next HTTP request', async (t) => {
  const waiting = deferred<void>();
  const late = deferred<FixtureReply>();
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'tool', calls: [{ id: 'finished-read', name: 'read_shot', arguments: {} }] },
    { type: 'deferred', beforeReply: () => { waiting.resolve(); return late.promise; } },
    { type: 'text', text: 'Resumed without replaying.' },
  ]);
  t.after(() => late.resolve({ type: 'text', text: 'LATE_IGNORED_RESPONSE' }));
  request.tools = [{ name: 'read_shot', description: 'Read once.', schema: z.object({}) }];
  const controller = new AbortController();
  let executions = 0;
  const hooks = { emit: () => {}, awaitToolConfirmation: async () => {
    executions += 1; return { ok: true as const, result: 'TOOL_COMPLETED_BEFORE_STOP' };
  } };
  const { service, store } = serviceAt(request);
  const running = service.run(persistent(creation), () => request, { ...hooks, signal: controller.signal });
  await waiting.promise;
  controller.abort();
  const stopped = await running;
  assert.equal(stopped.status, 'cancelled');
  assert.equal(stopped.toolCalls[0].status, 'ok');
  assert.equal(stopped.toolCalls[0].result, 'TOOL_COMPLETED_BEFORE_STOP');
  assert.ok(stopped.usage.totalTokens > 0);
  assert.equal(store.read(creation)?.snapshot, stopped.snapshot);
  assert.match(stopped.snapshot ?? '', /TOOL_COMPLETED_BEFORE_STOP/);
  const reopened = serviceAt(request);
  assert.ok((await reopened.service.inspect(persistent(creation), request)).retainedMessages >= 3);
  const resumed = await reopened.service.run(persistent(creation), () => ({ ...request, user: { durableText: 'Continue after Stop.' } }), hooks);
  late.resolve({ type: 'text', text: 'LATE_IGNORED_RESPONSE' });
  assert.equal(resumed.status, 'finished');
  assert.equal(executions, 1);
  assert.match(JSON.stringify(http.requests[2].body), /TOOL_COMPLETED_BEFORE_STOP/);
  assert.doesNotMatch(store.read(creation)?.snapshot ?? '', /LATE_IGNORED_RESPONSE/);
  assert.deepEqual(await readdir(request.tempRoot), []);
});

test('real SDK corruption blocks only its bound record while another record can continue without altering bad bytes', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [{ type: 'text', text: 'The intact thread continued.' }]);
  const { service, store, file } = serviceAt(request);
  const good = await snapshotCodec.importLegacy([{ role: 'user', content: 'GOOD_THREAD' }, { role: 'assistant', content: 'Good answer.' }], request);
  const damaged = good.slice(0, -10);
  store.save(creation, damaged);
  store.save(generation, good);
  const before = await readFile(file);
  await assert.rejects(() => service.inspect(persistent(creation), request));
  await assert.rejects(() => service.ensure(persistent(creation), { ...request, legacyBubbles: bubbles }));
  await assert.rejects(() => service.run(persistent(creation), () => request, { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }) }));
  assert.deepEqual(await readFile(file), before);
  assert.equal(http.requests.length, 0);
  const actual = await service.run(persistent(generation), () => request, { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }) });
  assert.equal(actual.status, 'finished');
  assert.equal(serviceAt(request).store.read(creation)?.snapshot, damaged);
  assert.match(serviceAt(request).store.read(generation)!.snapshot!, /intact thread continued/);
  assert.deepEqual(await readdir(request.tempRoot), []);
});

test('a real ephemeral multi-step planner never resolves, migrates, inspects, writes or clears persistent context', async (t) => {
  const { request } = await createRuntimeFixture(t, [
    { type: 'tool', calls: [{ id: 'plan-1', name: 'propose_shots', arguments: {} }] },
    { type: 'text', text: 'The ephemeral plan is ready.' },
  ]);
  const file = join(request.cwd, '.nomi', 'agent-thread-context-v1.json');
  await mkdir(join(request.cwd, '.nomi'));
  const original = Buffer.from('{"version":2,"sessions":{"unbound":[{"role":"user","content":"KEEP_V2_EXACT"}]}}\n');
  await writeFile(file, original);
  let paths = 0;
  let codecs = 0;
  const codec: RuntimeSnapshotCodec = {
    importLegacy: (...args) => { codecs += 1; return snapshotCodec.importLegacy(...args); },
    inspect: (...args) => { codecs += 1; return snapshotCodec.inspect(...args); },
  };
  const store = createAgentContextStore({ resolveFile: () => { paths += 1; return file; } });
  const service = createAgentContextService({ store, codec, runAgentTurn });
  const scope = { kind: 'ephemeral' } as const;
  await service.ensure(scope, { ...request, legacyBubbles: bubbles });
  await service.inspect(scope, request);
  assert.equal(await service.alive(scope, request), false);
  await service.clear(scope);
  request.tools = [{ name: 'propose_shots', description: 'Return only a proposed shot plan.', schema: z.object({}) }];
  let plans = 0;
  const actual = await service.run(scope, () => request, { emit: () => {}, awaitToolConfirmation: async () => {
    plans += 1; return { ok: true, result: { shots: 3 } };
  } });
  assert.equal(actual.status, 'finished');
  assert.equal(plans, 1);
  assert.equal(paths, 0);
  assert.equal(codecs, 0);
  assert.deepEqual(await readFile(file), original);
  assert.deepEqual(await readdir(join(request.cwd, '.nomi')), ['agent-thread-context-v1.json']);
  assert.deepEqual(await readdir(request.tempRoot), []);
});
