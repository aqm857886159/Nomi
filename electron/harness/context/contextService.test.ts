import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { RunAgentTurn, RuntimeSnapshotCodec, RuntimeTurnHooks, RuntimeTurnRequest, RuntimeTurnResult } from '../runtime/runtimePort';
import type { AgentContextScope } from './contextBinding';
import { contextBindingKey } from './contextBinding';
import { createAgentContextService } from './contextService';
import { createAgentContextStore } from './contextStore';
import { createProjectAgentContextBinding } from '../../shared/contracts/projectAgentContextBinding';

const PROJECT = Object.freeze({
  projectId: 'project-1',
  immutableProjectUuid: '4d80f2e0-4a45-4a8f-8fe1-78ac659177c8',
  projectGeneration: 3,
});
const scope: AgentContextScope = { kind: 'persistent', binding: createProjectAgentContextBinding(PROJECT, 'thread-1') };
const second: AgentContextScope = { kind: 'persistent', binding: createProjectAgentContextBinding(PROJECT, 'thread-2') };
const bubbles = [{ role: 'user', content: 'Original brief' }, { role: 'assistant', content: 'Original answer' }];
const hooks: RuntimeTurnHooks = { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }) };
const result = (snapshot = 'native-completed', status: RuntimeTurnResult['status'] = 'finished'): RuntimeTurnResult => ({
  status, finishReason: status === 'cancelled' ? 'aborted' : 'stop', text: 'Actually completed text',
  usage: { promptTokens: 17, completionTokens: 4, cachedPromptTokens: 2, totalTokens: 21 },
  toolCalls: [{ toolCallId: 'read-1', toolName: 'read_shot', args: {}, status: 'ok', result: 'READ_ONCE' }],
  snapshot,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('bound Agent context service', () => {
  let root: string;
  let file: string;
  let request: Omit<RuntimeTurnRequest, 'snapshot'>;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-context-service-'));
    file = path.join(root, '.nomi', 'agent-thread-context-v1.json');
    request = { cwd: root, agentDir: root, tempRoot: root, systemPrompt: 'system',
      model: { kind: 'openai-compatible', providerId: 'fixture', modelId: 'chosen', baseURL: 'http://unused.invalid', authType: 'none' },
      user: { durableText: 'Continue.' }, tools: [], capability: { maxSteps: 8 }, compaction: { enabled: false } };
  });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

  function fixture(overrides: { codec?: Partial<RuntimeSnapshotCodec>; run?: RunAgentTurn } = {}) {
    const resolveFile = vi.fn(() => file);
    const store = createAgentContextStore({ resolveFile });
    // Fake only scheduling/opaque inspection here. Real SDK codec and replay tests
    // live in tests/agent-runtime; the on-disk container/atomic writes here are real.
    const codec: RuntimeSnapshotCodec = {
      importLegacy: vi.fn(async (turns) => `legacy:${JSON.stringify(turns)}`),
      inspect: vi.fn(async (snapshot) => {
        if (snapshot === 'broken') throw new Error('Damaged snapshot');
        return { retainedMessages: 2 };
      }),
      ...overrides.codec,
    };
    const run = vi.fn(overrides.run ?? (async () => result()));
    const service = createAgentContextService({ store, codec, runAgentTurn: run });
    return { service, store, codec, run, resolveFile };
  }
  const binding = () => scope.binding;
  const options = () => ({ cwd: root, tempRoot: root });

  it('imports only explicitly supplied thread bubbles once and reports plain limited-context metadata', async () => {
    const { service, store, codec } = fixture();
    expect(await service.ensure(scope, { ...options(), legacyBubbles: bubbles }))
      .toEqual({ source: 'legacy-limited', state: 'ready', retainedMessages: 2 });
    const first = store.read(binding())?.snapshot;
    await service.ensure(scope, { ...options(), legacyBubbles: [{ role: 'user', content: 'Different' }, { role: 'assistant', content: 'Overwrite?' }] });
    await service.ensure(scope, { ...options(), legacyBubbles: [] });
    expect(store.read(binding())?.snapshot).toBe(first);
    expect(codec.importLegacy).toHaveBeenCalledTimes(1);
    expect(await service.inspect(scope, options())).not.toHaveProperty('snapshot');
  });

  it('empty ensure reserves a native empty binding and never clears another archived thread', async () => {
    const { service, store, codec } = fixture();
    store.save(second.binding, 'archived-full-history');
    expect(await service.ensure(scope, { ...options(), legacyBubbles: [] }))
      .toEqual({ source: 'native', state: 'ready', retainedMessages: 0 });
    await service.ensure(scope, { ...options(), legacyBubbles: bubbles });
    expect(store.read(binding())).toEqual({ ...binding(), source: 'native', state: 'ready' });
    expect(store.read(second.binding)?.snapshot).toBe('archived-full-history');
    expect(codec.importLegacy).not.toHaveBeenCalled();
  });

  it('inspect/alive distinguish ready empty, real retained context and cleared without rewriting the file', async () => {
    const { service, store } = fixture();
    expect(await service.alive(scope, options())).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
    store.save(binding(), 'native-full');
    const raw = fs.readFileSync(file);
    expect(await service.alive(scope, options())).toBe(true);
    expect(fs.readFileSync(file)).toEqual(raw);
    await service.clear(scope);
    expect(await service.inspect(scope, options())).toEqual({ source: 'native', state: 'cleared', retainedMessages: 0 });
    await service.ensure(scope, { ...options(), legacyBubbles: bubbles });
    expect(await service.alive(scope, options())).toBe(false);
  });

  it('restores the stored opaque snapshot and persists the completed result without erasing legacy provenance', async () => {
    const { service, store, run } = fixture();
    await service.ensure(scope, { ...options(), legacyBubbles: bubbles });
    const snapshot = store.read(binding())?.snapshot;
    const actual = await service.run(scope, async () => request, hooks);
    expect(run.mock.calls[0][0].snapshot).toBe(snapshot);
    expect(actual).toEqual(result());
    expect(store.read(binding())).toEqual({ ...binding(), source: 'legacy-limited', state: 'ready', snapshot: result().snapshot });
  });

  it('a damaged target snapshot errors explicitly while peer bindings still work and preserve the damaged bytes', async () => {
    const { service, store, run } = fixture();
    store.save(binding(), 'broken');
    const original = fs.readFileSync(file);
    await expect(service.ensure(scope, { ...options(), legacyBubbles: bubbles })).rejects.toThrow(/snapshot/i);
    await expect(service.inspect(scope, options())).rejects.toThrow(/snapshot/i);
    await expect(service.run(scope, async () => request, hooks)).rejects.toThrow(/snapshot/i);
    expect(fs.readFileSync(file)).toEqual(original);
    expect(run).not.toHaveBeenCalled();
    await service.run(second, async () => request, hooks);
    expect(store.read(binding())?.snapshot).toBe('broken');
    expect(store.read(second.binding)?.snapshot).toBe('native-completed');
  });

  it('ephemeral ensure/inspect/alive/clear/run do zero persistent or codec work while retaining planner tools', async () => {
    const { service, resolveFile, codec, run } = fixture();
    const ephemeral = { kind: 'ephemeral' } as const;
    await service.ensure(ephemeral, { ...options(), legacyBubbles: bubbles });
    expect(await service.inspect(ephemeral, options())).toEqual({ source: 'native', state: 'ready', retainedMessages: 0 });
    expect(await service.alive(ephemeral, options())).toBe(false);
    await service.clear(ephemeral);
    const tools = [{ name: 'plan_shots', description: 'Return a plan only.', schema: z.object({}) }];
    await service.run(ephemeral, async () => ({ ...request, tools, snapshot: 'MUST_NOT_REUSE' }), hooks);
    await service.run(ephemeral, async () => ({ ...request, tools }), hooks);
    expect(run.mock.calls.map(([turn]) => turn.snapshot)).toEqual([undefined, undefined]);
    expect(run.mock.calls[0][0].tools).toEqual(tools);
    expect(run.mock.calls[0][0].capability).toEqual({ maxSteps: 8 });
    expect(resolveFile).not.toHaveBeenCalled();
    expect(codec.importLegacy).not.toHaveBeenCalled();
    expect(codec.inspect).not.toHaveBeenCalled();
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('retains actual text, usage and tool results when final atomic publication fails', async () => {
    const { service, store } = fixture({ run: async () => {
      vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); });
      return result();
    } });
    const actual = await service.run(scope, async () => request, hooks);
    expect(actual.status).toBe('error');
    expect(actual.finishReason).toBe('error');
    expect(actual.error).toMatchObject({ kind: 'runtime', message: expect.stringMatching(/persist.*disk full/i) });
    expect(actual.usage).toEqual(result().usage);
    expect(actual.text).toBe(result().text);
    expect(actual.toolCalls).toEqual(result().toolCalls);
    expect(actual.snapshot).toBe(result().snapshot);
    expect(store.read(binding())?.snapshot).toBeUndefined();
    expect(fs.readdirSync(path.dirname(file))).toEqual(['agent-thread-context-v1.json']);
  });

  it('unresolved persistent bindings fail before request preparation or model execution', async () => {
    const { codec, run } = fixture();
    const service = createAgentContextService({ store: createAgentContextStore({ resolveFile: () => null }), codec, runAgentTurn: run });
    const prepare = vi.fn(async () => request);
    await expect(service.run(scope, prepare, hooks)).rejects.toThrow(/resolv/i);
    expect(prepare).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('serializes seed preparation before a competing start on the same binding', async () => {
    const importing = deferred<void>();
    const imported = deferred<string>();
    const { service, store, run } = fixture({ codec: { importLegacy: async () => {
      importing.resolve(); return imported.promise;
    } } });
    const ensure = service.ensure(scope, { ...options(), legacyBubbles: bubbles });
    await importing.promise;
    const running = service.run(scope, async () => request, hooks);
    imported.resolve('explicit-legacy-context');
    await Promise.all([ensure, running]);
    expect(run.mock.calls[0][0].snapshot).toBe('explicit-legacy-context');
    expect(store.read(binding())?.source).toBe('legacy-limited');
  });

  it('a queued seed and inspect wait for a started turn, then observe its native snapshot', async () => {
    const started = deferred<void>();
    const finished = deferred<RuntimeTurnResult>();
    const { service, codec, store } = fixture({ run: async () => { started.resolve(); return finished.promise; } });
    const running = service.run(scope, async () => request, hooks);
    await started.promise;
    const ensuring = service.ensure(scope, { ...options(), legacyBubbles: bubbles });
    const inspecting = service.inspect(scope, options());
    finished.resolve(result());
    const [, ensured, inspected] = await Promise.all([running, ensuring, inspecting]);
    expect(ensured).toEqual({ source: 'native', state: 'ready', retainedMessages: 2 });
    expect(inspected).toEqual(ensured);
    expect(codec.importLegacy).not.toHaveBeenCalled();
    expect(store.read(binding())?.snapshot).toBe('native-completed');
  });

  it('different bindings can finish out of order without serializing together or losing either record', async () => {
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const firstResult = deferred<RuntimeTurnResult>();
    const secondResult = deferred<RuntimeTurnResult>();
    const { service, store } = fixture({ run: async (turn) => {
      if (turn.user.durableText === 'first') { firstStarted.resolve(); return firstResult.promise; }
      secondStarted.resolve(); return secondResult.promise;
    } });
    const firstRun = service.run(scope, async () => ({ ...request, user: { durableText: 'first' } }), hooks);
    await firstStarted.promise;
    const secondRun = service.run(second, async () => ({ ...request, user: { durableText: 'second' } }), hooks);
    await secondStarted.promise;
    secondResult.resolve(result('second-completed-first'));
    await secondRun;
    firstResult.resolve(result('first-completed-last'));
    await firstRun;
    expect(store.read(binding())?.snapshot).toBe('first-completed-last');
    expect(store.read(second.binding)?.snapshot).toBe('second-completed-first');
  });

  it('clear invalidates async legacy import and queued work before it writes a tombstone', async () => {
    const importing = deferred<void>();
    const imported = deferred<string>();
    const { service, store, run } = fixture({ codec: { importLegacy: async () => {
      importing.resolve(); return imported.promise;
    } } });
    const seeded = service.ensure(scope, { ...options(), legacyBubbles: bubbles }).then(
      (value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
    await importing.promise;
    const queued = service.run(scope, async () => request, hooks);
    const cleared = service.clear(scope);
    const closedAdmission = service.run(scope, async () => request, hooks);
    imported.resolve('LATE_LEGACY_IMPORT');
    const [seed, queuedResult, rejectedAdmission] = await Promise.all([seeded, queued, closedAdmission, cleared]);
    expect(seed.error).toMatchObject({ name: 'AbortError' });
    expect(queuedResult.status).toBe('cancelled');
    expect(rejectedAdmission.status).toBe('cancelled');
    expect(run).not.toHaveBeenCalled();
    expect(store.read(binding())).toMatchObject({ state: 'cleared' });
    expect(store.read(binding())?.snapshot).toBeUndefined();
    await service.ensure(scope, { ...options(), legacyBubbles: bubbles });
    expect(store.read(binding())?.state).toBe('cleared');
  });

  it('clear rechecks the epoch after async request preparation and uses the same cancellation signal', async () => {
    const preparing = deferred<AbortSignal>();
    const prepared = deferred<Omit<RuntimeTurnRequest, 'snapshot'>>();
    const { service, store, run } = fixture();
    const running = service.run(scope, (signal) => { preparing.resolve(signal); return prepared.promise; }, hooks);
    const signal = await preparing.promise;
    const clearing = service.clear(scope);
    prepared.resolve(request);
    const actual = await running;
    await clearing;
    expect(signal.aborted).toBe(true);
    expect(actual.status).toBe('cancelled');
    expect(run).not.toHaveBeenCalled();
    expect(store.read(binding())?.state).toBe('cleared');
  });

  it.each(['ensure', 'inspect', 'run'] as const)('clear invalidates a late async snapshot restore in %s', async (method) => {
    const restoring = deferred<void>();
    const restored = deferred<{ retainedMessages: number }>();
    const { service, store, run } = fixture({ codec: { inspect: async () => {
      restoring.resolve(); return restored.promise;
    } } });
    store.save(binding(), 'old-native-full');
    const work = (method === 'run' ? service.run(scope, async () => request, hooks)
      : service[method](scope, options())).then(
      (value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
    await restoring.promise;
    const clearing = service.clear(scope);
    restored.resolve({ retainedMessages: 12 });
    const actual = await work;
    await clearing;
    if (method === 'run') expect(actual.value).toMatchObject({ status: 'cancelled' });
    else expect(actual.error).toMatchObject({ name: 'AbortError' });
    expect(run).not.toHaveBeenCalled();
    expect(store.read(binding())?.state).toBe('cleared');
  });

  it('clear aborts active work, drains its late success, cancels the queue and then permits a fresh turn', async () => {
    const started = deferred<AbortSignal | undefined>();
    const finished = deferred<RuntimeTurnResult>();
    let calls = 0;
    const { service, store } = fixture({ run: async (_turn, callbacks) => {
      if (++calls === 1) { started.resolve(callbacks.signal); return finished.promise; }
      return result('fresh-native');
    } });
    store.save(second.binding, 'ARCHIVED_OTHER_THREAD');
    const active = service.run(scope, async () => request, hooks);
    const signal = await started.promise;
    const queued = service.run(scope, async () => request, hooks);
    const clearing = service.clear(scope);
    const duringClear = service.run(scope, async () => request, hooks);
    finished.resolve(result('LATE_SUCCESS_MUST_NOT_REVIVE'));
    const [actual, queuedResult, rejected] = await Promise.all([active, queued, duringClear, clearing]);
    expect(signal?.aborted).toBe(true);
    expect(actual.status).toBe('cancelled');
    expect(actual.usage).toEqual(result().usage);
    expect(queuedResult.status).toBe('cancelled');
    expect(rejected.status).toBe('cancelled');
    expect(calls).toBe(1);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).records[contextBindingKey(binding())]).toMatchObject({ state: 'cleared' });
    expect(store.read(binding())?.snapshot).toBeUndefined();
    const fresh = await service.run(scope, async () => request, hooks);
    expect(fresh.status).toBe('finished');
    expect(store.read(binding())?.snapshot).toBe('fresh-native');
    expect(store.read(second.binding)?.snapshot).toBe('ARCHIVED_OTHER_THREAD');
  });

  it('ordinary Stop uses one composed signal and persists the actual stable cancelled tool context', async () => {
    const started = deferred<AbortSignal | undefined>();
    const finished = deferred<RuntimeTurnResult>();
    const controller = new AbortController();
    let prepareSignal: AbortSignal | undefined;
    const { service, store } = fixture({ run: async (_turn, callbacks) => {
      started.resolve(callbacks.signal); return finished.promise;
    } });
    const running = service.run(scope, async (signal) => { prepareSignal = signal; return request; }, { ...hooks, signal: controller.signal });
    const runtimeSignal = await started.promise;
    controller.abort();
    finished.resolve(result('COMPLETED_TOOL_PAIR_THEN_STOP', 'cancelled'));
    const actual = await running;
    expect(runtimeSignal).toBe(prepareSignal);
    expect(runtimeSignal?.aborted).toBe(true);
    expect(actual.status).toBe('cancelled');
    expect(actual.usage).toEqual(result().usage);
    expect(store.read(binding())?.snapshot).toBe('COMPLETED_TOOL_PAIR_THEN_STOP');
    expect(store.read(binding())?.state).toBe('ready');
  });

  it('queued cancellation never prepares or invokes a model and removes its external abort listener', async () => {
    const started = deferred<void>();
    const finished = deferred<RuntimeTurnResult>();
    let calls = 0;
    const { service } = fixture({ run: async () => {
      if (++calls === 1) { started.resolve(); return finished.promise; }
      return result();
    } });
    const running = service.run(scope, async () => request, hooks);
    await started.promise;
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const prepare = vi.fn(async () => request);
    const queued = service.run(scope, prepare, { ...hooks, signal: controller.signal });
    controller.abort();
    finished.resolve(result());
    await running;
    expect((await queued).status).toBe('cancelled');
    expect(prepare).not.toHaveBeenCalled();
    expect(calls).toBe(1);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    await service.run(scope, async () => request, hooks);
    expect(calls, 'settled/cancelled queue work cannot poison a fresh turn').toBe(2);
  });

  it.each(['persistent', 'ephemeral'] as const)('pre-cancelled %s work never prepares or invokes a model', async (kind) => {
    const { service, run, resolveFile } = fixture();
    const controller = new AbortController();
    controller.abort();
    const prepare = vi.fn(async () => request);
    const actual = await service.run(kind === 'persistent' ? scope : { kind }, prepare, { ...hooks, signal: controller.signal });
    expect(actual.status).toBe('cancelled');
    expect(actual.usage.totalTokens).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(resolveFile).not.toHaveBeenCalled();
  });

  it('a rejected preparation releases the queue for the next operation', async () => {
    const { service, store } = fixture();
    const failure = service.run(scope, async () => { throw new Error('prepare failed'); }, hooks);
    const success = service.run(scope, async () => request, hooks);
    await expect(failure).rejects.toThrow('prepare failed');
    expect((await success).status).toBe('finished');
    expect(store.read(binding())?.snapshot).toBe('native-completed');
  });

  it('captures the binding before asynchronous preparation instead of rereading a mutated caller object', async () => {
    const preparing = deferred<void>();
    const prepared = deferred<Omit<RuntimeTurnRequest, 'snapshot'>>();
    const { service, store } = fixture();
    const mutable = { ...binding() };
    const active = service.run({ kind: 'persistent', binding: mutable }, () => {
      preparing.resolve(); return prepared.promise;
    }, hooks);
    await preparing.promise;
    mutable.threadId = 'thread-switched-after-await';
    prepared.resolve(request);
    await active;
    expect(store.read(binding())?.snapshot).toBe('native-completed');
    expect(store.read(mutable)).toBeUndefined();
  });

  it('a failed clear keeps admission closed until its tombstone is durably published on retry', async () => {
    const { service, store, run } = fixture();
    store.save(binding(), 'old-history');
    const original = fs.readFileSync(file);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); });
    await expect(service.clear(scope)).rejects.toThrow('disk full');
    const blocked = await service.run(scope, async () => request, hooks);
    expect(blocked.status).toBe('cancelled');
    expect(run).not.toHaveBeenCalled();
    expect(fs.readFileSync(file)).toEqual(original);
    await service.clear(scope);
    expect(store.read(binding())?.state).toBe('cleared');
    expect((await service.run(scope, async () => request, hooks)).status).toBe('finished');
  });
});
