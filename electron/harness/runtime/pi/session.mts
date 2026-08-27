import { isAbsolute, resolve } from 'node:path';
import { createAgentSession, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createNomiModelRuntime, type NomiModelConfig } from './model.mjs';
import { createNomiResourceLoader } from './resources.mjs';
import { createHostTools, type HostToolDefinition } from './tools.mjs';

export interface ControlledSessionOptions {
  cwd: string;
  agentDir: string;
  systemPrompt: string;
  model: NomiModelConfig;
  tools?: readonly HostToolDefinition[];
  singleShot?: boolean;
  sessionManager?: SessionManager;
}

/** The SDK owns the loop; Nomi owns every input and tool effect. */
export async function createControlledSession(options: ControlledSessionOptions) {
  if (!isAbsolute(options.cwd) || !isAbsolute(options.agentDir) ||
    resolve(options.cwd) === resolve(options.agentDir)) {
    throw new Error('Use distinct absolute cwd and agentDir sandbox directories');
  }
  if (!options.systemPrompt.trim()) throw new Error('An explicit Nomi system prompt is required');
  const { modelRuntime, model } = await createNomiModelRuntime(options.model);
  const toolBridge = createHostTools(options.singleShot ? [] : options.tools ?? []);
  const customTools = toolBridge.definitions;
  const sessionManager = options.sessionManager ?? SessionManager.inMemory(options.cwd);
  const result = await createAgentSession({
    cwd: options.cwd, agentDir: options.agentDir, model, modelRuntime,
    sessionManager,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } },
      enableSkillCommands: false, images: { autoResize: false },
      enableAnalytics: false, enableInstallTelemetry: false,
    }),
    resourceLoader: createNomiResourceLoader(options.systemPrompt),
    thinkingLevel: 'off', noTools: 'all',
    tools: customTools.map((tool) => tool.name), customTools,
  });
  if (result.modelFallbackMessage) {
    result.session.dispose();
    throw new Error(`Model fallback is forbidden: ${result.modelFallbackMessage}`);
  }
  const { session } = result;
  session.agent.toolExecution = 'sequential';
  const sdkBeforeToolCall = session.agent.beforeToolCall;
  session.agent.beforeToolCall = async (context, signal) => {
    const decision = await sdkBeforeToolCall?.(context, signal);
    if (!decision?.block) await toolBridge.beforeToolCall(context, signal);
    return decision;
  };
  const unsubscribeTools = session.agent.subscribe((event) => {
    if (event.type === 'agent_end') toolBridge.clearPending();
  });
  const sdkBasePrompt = session.systemPrompt;
  const sdkStream = session.agent.streamFunction;
  session.agent.streamFunction = (chosen, context, streamOptions) => {
    if (chosen.provider !== model.provider || chosen.id !== model.id || chosen.api !== model.api ||
      chosen.baseUrl !== model.baseUrl) throw new Error('Nomi model identity cannot fall back or change');
    // createAgentSession appends a coding-oriented cwd suffix even to a custom
    // prompt. The public stream seam keeps the actual provider input Nomi-only.
    const generation = launchGeneration.signal;
    if (generation.aborted) cancelAuxiliaryWork();
    return sdkStream(chosen, context.systemPrompt === sdkBasePrompt
      ? { ...context, systemPrompt: options.systemPrompt } : context, {
        ...streamOptions,
        // Also covers summary calls, whose controllers can be created after
        // stop() began waiting for asynchronous prompt/auth preflight.
        signal: streamOptions?.signal ? AbortSignal.any([generation, streamOptions.signal]) : generation,
      });
  };
  // SDK idle covers running turns, not asynchronous prompt preflight or manual
  // summaries. Track the public operations, without replacing the SDK loop.
  const operations = new Set<Promise<unknown>>();
  const trackOperation = <T,>(operation: Promise<T>) => {
    operations.add(operation);
    void operation.then(() => operations.delete(operation), () => operations.delete(operation));
    return operation;
  };
  let stopping: Promise<void> | undefined;
  let disposed = false;
  let launchGeneration = new AbortController();
  const sdkPrompt = session.prompt.bind(session);
  session.prompt = (text, promptOptions) => {
    if (disposed || launchGeneration.signal.aborted) {
      return Promise.reject(new Error('Nomi session is stopping or disposed'));
    }
    const admitted = launchGeneration.signal;
    return trackOperation(sdkPrompt(text, {
      ...promptOptions,
      // This public synchronous callback is immediately before the SDK launches
      // a turn. An aborted generation cannot outlive stop() and start later.
      preflightResult: (ready) => {
        if (ready && admitted.aborted) {
          promptOptions?.preflightResult?.(false);
          admitted.throwIfAborted();
        }
        promptOptions?.preflightResult?.(ready);
        // The caller's callback may itself synchronously stop/dispose.
        if (ready) admitted.throwIfAborted();
      },
    }));
  };
  const sdkCompact = session.compact.bind(session);
  session.compact = (...args) => disposed || launchGeneration.signal.aborted
    ? Promise.reject(new Error('Nomi session is stopping or disposed'))
    : trackOperation(sdkCompact(...args));
  const sdkNavigateTree = session.navigateTree.bind(session);
  session.navigateTree = (...args) => disposed || launchGeneration.signal.aborted
    ? Promise.reject(new Error('Nomi session is stopping or disposed'))
    : trackOperation(sdkNavigateTree(...args));
  const cancelAuxiliaryWork = () => {
    session.clearQueue();
    session.abortCompaction();
    session.abortBranchSummary();
    session.abortBash();
  };
  const stop = () => {
    if (stopping) return stopping;
    // Close admission before abort/queue callbacks can re-enter a public start.
    launchGeneration.abort(new DOMException('Nomi prompt cancelled before launch', 'AbortError'));
    stopping = (async () => {
      cancelAuxiliaryWork();
      await session.abort();
      // compact() begins with await abort(), before creating its controller.
      // A second cancellation closes that start/stop race after turns settle.
      cancelAuxiliaryWork();
      await Promise.allSettled([...operations]);
      // A queued prompt can finish its preflight while stop is draining it.
      session.clearQueue();
    })().finally(() => {
      if (!disposed) launchGeneration = new AbortController();
      stopping = undefined;
    });
    return stopping;
  };
  let disposal: Promise<void> | undefined;
  const dispose = () => disposal ??= (async () => {
    disposed = true;
    try { await stop(); } finally {
      unsubscribeTools();
      toolBridge.clearPending();
      session.dispose();
    }
  })();
  return { session, sessionManager, modelRuntime, stop, dispose,
    get launchSignal() { return launchGeneration.signal; },
  };
}
