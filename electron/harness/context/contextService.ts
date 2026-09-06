import type { RunAgentTurn, RuntimeSnapshotCodec, RuntimeSnapshotOptions, RuntimeTurnHooks, RuntimeTurnRequest, RuntimeTurnResult } from '../runtime/runtimePort';
import { captureAgentContextBinding, contextBindingKey, type AgentContextBinding, type AgentContextScope } from './contextBinding';
import type { AgentContextSeed, AgentContextSource, AgentContextStore, StoredAgentContext } from './contextStore';
import { bubblesToSeedTurns, type LegacyAgentBubble } from './legacyBubbles';

export interface AgentContextInfo {
  source: AgentContextSource;
  state: 'ready' | 'cleared';
  retainedMessages: number;
}
export interface AgentContextInspection extends RuntimeSnapshotOptions {
  signal?: AbortSignal;
}
export interface AgentContextEnsure extends AgentContextInspection {
  legacyBubbles?: readonly LegacyAgentBubble[];
}
export type PrepareAgentContextTurn = (signal: AbortSignal) => Omit<RuntimeTurnRequest, 'snapshot'> | Promise<Omit<RuntimeTurnRequest, 'snapshot'>>;

export interface AgentContextService {
  ensure(scope: AgentContextScope, options: AgentContextEnsure): Promise<AgentContextInfo>;
  inspect(scope: AgentContextScope, options: AgentContextInspection): Promise<AgentContextInfo>;
  alive(scope: AgentContextScope, options: AgentContextInspection): Promise<boolean>;
  clear(scope: AgentContextScope): Promise<void>;
  run(scope: AgentContextScope, prepare: PrepareAgentContextTurn, hooks: RuntimeTurnHooks): Promise<RuntimeTurnResult>;
}

class ContextCancelled extends Error {
  constructor() { super('Agent context operation cancelled'); this.name = 'AbortError'; }
}
interface Operation {
  signal: AbortSignal;
  assertCurrent(): void;
  isCurrentEpoch(): boolean;
}
interface BindingQueue {
  epoch: number;
  closed: boolean;
  tail: Promise<void>;
  active?: AbortController;
  clearing?: Promise<void>;
}

function cancellationController(external?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(external?.reason);
  if (external?.aborted) abort();
  else external?.addEventListener('abort', abort, { once: true });
  return { controller, unlink: () => external?.removeEventListener('abort', abort) };
}

function cancelledResult(actual?: RuntimeTurnResult): RuntimeTurnResult {
  return { text: '', usage: { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, totalTokens: 0 },
    toolCalls: [], ...actual, status: 'cancelled', finishReason: 'aborted',
    error: { kind: 'abort', message: 'Agent context operation cancelled' } };
}

async function checkAfter<T>(promise: Promise<T>, operation: Operation): Promise<T> {
  try {
    const value = await promise;
    operation.assertCurrent();
    return value;
  } catch (error) {
    operation.assertCurrent();
    throw error;
  }
}

/** Keep one service per main-process host so all calls share binding lifecycles. */
export function createAgentContextService(deps: {
  store: AgentContextStore;
  codec: RuntimeSnapshotCodec;
  runAgentTurn: RunAgentTurn;
}): AgentContextService {
  const queues = new Map<string, BindingQueue>();
  const empty = (): AgentContextInfo => ({ source: 'native', state: 'ready', retainedMessages: 0 });

  function capture(binding: AgentContextBinding): AgentContextBinding {
    return captureAgentContextBinding(binding);
  }
  function queueFor(key: string): BindingQueue {
    let queue = queues.get(key);
    if (!queue) {
      queue = { epoch: 0, closed: false, tail: Promise.resolve() };
      queues.set(key, queue);
    }
    return queue;
  }
  function enqueue<T>(input: AgentContextBinding, external: AbortSignal | undefined,
    work: (binding: AgentContextBinding, operation: Operation) => Promise<T>): Promise<T> {
    const binding = capture(input);
    const key = contextBindingKey(binding);
    const queue = queueFor(key);
    if (queue.closed) return Promise.reject(new ContextCancelled());
    const epoch = queue.epoch;
    const { controller, unlink } = cancellationController(external);
    const operation: Operation = { signal: controller.signal,
      isCurrentEpoch: () => queue.epoch === epoch && !queue.closed,
      assertCurrent: () => { if (queue.epoch !== epoch || queue.closed || controller.signal.aborted) throw new ContextCancelled(); },
    };
    const running = queue.tail.then(async () => {
      operation.assertCurrent();
      queue.active = controller;
      try { return await work(binding, operation); }
      finally { queue.active = undefined; }
    });
    const settled = running.finally(() => {
      unlink();
      if (queue.tail === tail && !queue.closed) queues.delete(key);
    });
    const tail = settled.then(() => {}, () => {}); // A rejected operation never poisons its successor.
    queue.tail = tail;
    return settled;
  }

  function clearBinding(input: AgentContextBinding): Promise<void> {
    const binding = capture(input);
    const key = contextBindingKey(binding);
    const queue = queueFor(key);
    if (queue.clearing) return queue.clearing;
    queue.closed = true; // Close admission synchronously, before waiting for old work.
    queue.epoch += 1;
    queue.active?.abort();
    const clearing = queue.tail.then(() => {
      deps.store.clear(binding);
      queue.closed = false; // A failed publication stays closed until an explicit clear retry succeeds.
    });
    const settled = clearing.finally(() => {
      queue.clearing = undefined;
      if (queue.tail === tail && !queue.closed) queues.delete(key);
    });
    const tail = settled.then(() => {}, () => {});
    queue.tail = tail;
    queue.clearing = settled;
    return settled;
  }

  async function describe(record: StoredAgentContext | undefined, options: RuntimeSnapshotOptions): Promise<AgentContextInfo> {
    if (!record) return empty();
    const metadata = record.snapshot ? await deps.codec.inspect(record.snapshot, options) : { retainedMessages: 0 };
    return { source: record.source, state: record.state, retainedMessages: metadata.retainedMessages };
  }

  async function inspect(scope: AgentContextScope, options: AgentContextInspection): Promise<AgentContextInfo> {
    if (scope.kind === 'ephemeral') return empty();
    const paths = { cwd: options.cwd, tempRoot: options.tempRoot };
    return enqueue(scope.binding, options.signal, (binding, operation) =>
      checkAfter(describe(deps.store.read(binding), paths), operation));
  }

  async function runTurn(binding: AgentContextBinding | undefined, operation: Operation,
    prepare: PrepareAgentContextTurn, hooks: RuntimeTurnHooks): Promise<RuntimeTurnResult> {
    operation.assertCurrent();
    const record = binding ? deps.store.read(binding) : undefined;
    const request = await checkAfter(Promise.resolve(prepare(operation.signal)), operation);
    if (record?.snapshot) await checkAfter(deps.codec.inspect(record.snapshot, request), operation);
    if (binding && !record) deps.store.ensure(binding, { source: 'native' });
    const actual = await deps.runAgentTurn({ ...request, snapshot: record?.snapshot }, { ...hooks, signal: operation.signal,
      emit: (event) => { if (operation.isCurrentEpoch() && !operation.signal.aborted) hooks.emit(event); },
    });
    // Clear invalidates publication. Ordinary Stop does not: the runtime has already
    // settled and exported the actual completed tool/message history, even if aborted.
    if (!operation.isCurrentEpoch()) return cancelledResult(actual);
    if (binding && actual.snapshot !== undefined) {
      try {
        deps.store.save(binding, actual.snapshot);
      } catch (error) {
        return { ...actual, status: 'error', finishReason: 'error', error: {
          kind: 'runtime', message: `Agent context persistence failed: ${error instanceof Error ? error.message : String(error)}`,
        } };
      }
    }
    return actual;
  }

  return {
    ensure: async (scope, options) => {
      if (scope.kind === 'ephemeral') return empty();
      const paths = { cwd: options.cwd, tempRoot: options.tempRoot };
      const bubbles = options.legacyBubbles?.map((bubble) => ({ ...bubble })) ?? [];
      return enqueue(scope.binding, options.signal, async (binding, operation) => {
        const current = deps.store.read(binding);
        if (current) return checkAfter(describe(current, paths), operation);
        const turns = bubblesToSeedTurns(bubbles);
        const seed: AgentContextSeed = turns.length ? { source: 'legacy-limited',
          snapshot: await checkAfter(deps.codec.importLegacy(turns, paths), operation) } : { source: 'native' };
        const metadata = seed.snapshot ? await checkAfter(deps.codec.inspect(seed.snapshot, paths), operation) : { retainedMessages: 0 };
        operation.assertCurrent();
        const record = deps.store.ensure(binding, seed);
        return record.state === 'ready' && record.snapshot === seed.snapshot
          ? { source: record.source, state: record.state, retainedMessages: metadata.retainedMessages }
          : checkAfter(describe(record, paths), operation);
      });
    },
    inspect,
    alive: async (scope, options) => (await inspect(scope, options)).retainedMessages > 0,
    clear: async (scope) => { if (scope.kind === 'persistent') await clearBinding(scope.binding); },
    run: async (scope, prepare, hooks) => {
      try {
        if (scope.kind === 'persistent') {
          return await enqueue(scope.binding, hooks.signal, (binding, operation) => runTurn(binding, operation, prepare, hooks));
        }
        const { controller, unlink } = cancellationController(hooks.signal);
        const operation: Operation = { signal: controller.signal, isCurrentEpoch: () => true,
          assertCurrent: () => { if (controller.signal.aborted) throw new ContextCancelled(); } };
        try { return await runTurn(undefined, operation, prepare, hooks); }
        finally { unlink(); }
      } catch (error) {
        if (error instanceof ContextCancelled) return cancelledResult();
        throw error;
      }
    },
  };
}
