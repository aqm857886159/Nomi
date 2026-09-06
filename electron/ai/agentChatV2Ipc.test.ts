import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { AgentChatV2Hooks } from './agentChatV2';
import type { AgentChatResponse } from '../harness/agentChatContracts';
import type { SurfacePortBindingWire } from '../shared/surfacePortBinding';

const state = vi.hoisted(() => ({ handlers: new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => unknown>(),
  run: vi.fn(), seed: vi.fn(), alive: vi.fn(), clear: vi.fn(), trace: vi.fn(), decision: vi.fn(),
  oldSend: vi.fn(), translate: vi.fn(() => 'confirmation expired'), trust: vi.fn(),
  canvasCapture: vi.fn(), canvasTryExecute: vi.fn(), canvasDispose: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (event: IpcMainInvokeEvent, payload: unknown) => unknown) => state.handlers.set(name, fn) },
  webContents: { fromId: () => ({ send: state.oldSend, isDestroyed: () => false }) } }));
vi.mock('../ipcSenderGuard', () => ({ assertTrustedSender: state.trust }));
vi.mock('../events/agentChatTrace', () => ({ beginTurnTrace: () => {}, traceChatEvent: state.trace, traceToolDecision: state.decision, traceGateDenied: () => {} }));
vi.mock('../i18n', () => ({ desktopT: state.translate }));
vi.mock('./agentChatV2', () => ({ runAgentChatV2: state.run, seedAgentChatV2History: state.seed,
  agentChatV2HasHistory: state.alive, clearAgentChatV2History: state.clear }));
import { registerAgentChatV2Ipc } from './agentChatV2Ipc';
import { createProjectAgentContextBinding } from '../shared/contracts/projectAgentContextBinding';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function owner(id = 1, processId = 10) {
  const frame = { routingId: 2, processId, url: 'file:///nomi/index.html', detached: false, isDestroyed: () => false, send: vi.fn() };
  const sender = Object.assign(new EventEmitter(), { id, mainFrame: frame, isDestroyed: () => false });
  const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  return { event, sender, frame };
}
const SURFACE_BINDING: SurfacePortBindingWire = Object.freeze({
  version: 1,
  bindingId: 'binding-a',
  binding: Object.freeze({ projectId: 'p', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 3 }),
  webContentsId: 1,
  processId: 10,
  frameRoutingId: 2,
  origin: 'file://',
  surfaceInstanceId: 'surface-a',
  portRevision: 4,
  nonce: 'nonce-a',
});
const THREAD_BINDING = createProjectAgentContextBinding(
  { projectId: 'p', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 3 }, 't');
const payload = (withSurface = true) => ({ requestId: `test-${crypto.randomUUID()}`, request: { prompt: 'hello', capability: 'canvas-agent',
  projectId: 'p', history: { kind: 'persistent', binding: THREAD_BINDING } },
  ...(withSurface ? { surfaceBinding: SURFACE_BINDING } : {}),
});
const response = (status: AgentChatResponse['status'] = 'finished'): AgentChatResponse => ({ id: 'result', text: 'actual', status,
  finishReason: status === 'cancelled' ? 'aborted' : 'stop', toolCalls: [], artifacts: [],
  usage: { promptTokens: 8, completionTokens: 2, cachedPromptTokens: 3, totalTokens: 10 } });
function invoke(channel: string, event: IpcMainInvokeEvent, input: unknown) {
  return Promise.resolve().then(() => state.handlers.get(`nomi:agents:chatV2:${channel}`)!(event, input));
}
async function startForTest(event: IpcMainInvokeEvent, input: ReturnType<typeof payload>) {
  const ack = await invoke('start', event, input) as { sessionId: string };
  input.requestId = ack.sessionId;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.trust.mockReset();
  state.handlers.clear();
  state.canvasTryExecute.mockResolvedValue(null);
  state.canvasCapture.mockReturnValue({ tryExecute: state.canvasTryExecute, dispose: state.canvasDispose });
  registerAgentChatV2Ipc({ canvasRead: { capture: state.canvasCapture } });
});
afterEach(() => { vi.useRealTimers(); });

describe('Agent IPC owns the captured document and settles the real turn', () => {
  it.each(['confirmTool', 'cancel'])('%s rejects an untrusted sender even when its request id does not exist', async (channel) => {
    state.trust.mockImplementationOnce(() => { throw new Error('Untrusted IPC sender'); });
    await expect(invoke(channel, owner().event, { sessionId: 'missing-request', toolCallId: 'call', decision: { ok: true } })).rejects.toThrow('Untrusted IPC sender');
  });

  it('expires an unanswered confirmation after ten minutes and removes timer, pending and document listeners', async () => {
    vi.useFakeTimers();
    const source = owner(); const input = payload(); const received: unknown[] = [];
    state.run.mockImplementation(async (_input, hooks: AgentChatV2Hooks) => {
      received.push(await hooks.awaitToolConfirmation({ toolCallId: 'timeout', toolName: 'set_node_prompt', args: {} }, hooks.abortSignal!));
      return response();
    });
    await startForTest(source.event, input);
    await vi.waitFor(() => expect(state.run).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(received).toEqual([{ ok: false, message: 'confirmation expired' }]);
    expect(state.translate).toHaveBeenCalledWith('agent.confirmTimeout');
    expect(vi.getTimerCount()).toBe(0);
    expect(source.sender.eventNames()).toEqual([]);
    expect(await invoke('confirmTool', source.event, { sessionId: input.requestId, toolCallId: 'timeout', decision: { ok: true } })).toMatchObject({ ok: false });
  });

  it('uses the client id and captures the exact frame before any await', async () => {
    const source = owner(); const input = payload(); const finish = deferred<AgentChatResponse>();
    state.run.mockReturnValue(finish.promise);
    const ack = state.handlers.get('nomi:agents:chatV2:start')!(source.event, input);
    Object.defineProperty(source.event, 'senderFrame', { value: null });
    expect(await ack).toEqual({ sessionId: input.requestId });
    expect(state.canvasCapture).toHaveBeenCalledWith(source.event, {
      surfaceBinding: SURFACE_BINDING,
      projectId: 'p',
    }, input.requestId);
    expect(state.canvasCapture.mock.invocationCallOrder[0]).toBeLessThan(state.run.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
    await vi.waitFor(() => expect(state.run).toHaveBeenCalledOnce());
    finish.resolve(response());
    await vi.waitFor(() => expect(state.trace).toHaveBeenCalledWith(input.requestId, { type: 'done', reason: 'finished' }));
    expect(source.frame.send).toHaveBeenCalled();
    expect(state.oldSend).not.toHaveBeenCalled();
    expect(source.sender.eventNames()).toEqual([]);
  });

  it('consumes a production snapshot admission before model work and disposes it exactly once', async () => {
    const source = owner()
    const base = {
      ...payload(false),
      request: {
        prompt: 'production storyboard',
        capability: 'storyboard' as const,
        projectId: 'p',
        history: { kind: 'ephemeral' as const },
      },
    }
    const capturedCanvasReadSnapshot = {
      version: 1 as const,
      handleId: 'captured-a',
      nonce: 'captured-nonce-a',
    }
    const input = { ...base, capturedCanvasReadSnapshot }
    state.run.mockResolvedValue(response())

    await invoke('start', source.event, input)
    expect(state.canvasCapture).toHaveBeenCalledWith(source.event, {
      capturedCanvasReadSnapshot,
      projectId: 'p',
    }, input.requestId)
    expect(state.canvasCapture.mock.invocationCallOrder[0]).toBeLessThan(
      state.run.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    )
    await vi.waitFor(() => expect(state.trace).toHaveBeenCalledWith(input.requestId, {
      type: 'done',
      reason: 'finished',
    }))
    expect(state.canvasDispose).toHaveBeenCalledOnce()
  })

  it('rejects a captured handle on the creation persistent route before port or Session creation', async () => {
    const source = owner()
    const input = {
      ...payload(false),
      capturedCanvasReadSnapshot: {
        version: 1 as const,
        handleId: 'captured-a',
        nonce: 'captured-nonce-a',
      },
    }
    state.run.mockResolvedValue(response())

    await expect(invoke('start', source.event, input)).rejects.toMatchObject({ code: 'surface_port_stale' })
    expect(state.canvasCapture).not.toHaveBeenCalled()
    expect(state.run).not.toHaveBeenCalled()
    expect(state.canvasDispose).not.toHaveBeenCalled()
  })

  it('rejects live and captured admissions together before port or Session creation', async () => {
    const source = owner()
    const input = {
      ...payload(),
      capturedCanvasReadSnapshot: { version: 1 as const, handleId: 'captured-a', nonce: 'captured-nonce-a' },
    }

    await expect(invoke('start', source.event, input)).rejects.toMatchObject({ code: 'surface_port_stale' })
    expect(state.canvasCapture).not.toHaveBeenCalled()
    expect(state.run).not.toHaveBeenCalled()
  })

  it('rejects a Surface bound to another project before creating a port or Session', async () => {
    const source = owner();
    const input = payload();
    const mismatched = {
      ...input,
      surfaceBinding: {
        ...SURFACE_BINDING,
        binding: { ...SURFACE_BINDING.binding, projectId: 'project-b' },
      },
    };
    state.run.mockResolvedValue(response());

    await expect(invoke('start', source.event, mismatched)).rejects.toMatchObject({ code: 'surface_port_stale' });
    expect(state.canvasCapture).not.toHaveBeenCalled();
    expect(state.run).not.toHaveBeenCalled();

    await expect(invoke('start', source.event, input)).resolves.toEqual({ sessionId: input.requestId });
    expect(state.canvasCapture).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(state.run).toHaveBeenCalledOnce());
  });

  it('executes canvas reads in main without asking the renderer approval path', async () => {
    const source = owner(); const input = payload(); let received: unknown;
    const mainDecision = { ok: true as const, result: 'compact canvas', silent: true as const };
    state.canvasTryExecute.mockResolvedValue(mainDecision);
    state.run.mockImplementation(async (_input, hooks: AgentChatV2Hooks) => {
      received = await hooks.awaitToolConfirmation({ toolCallId: 'read-a', toolName: 'read_canvas_state', args: {} }, hooks.abortSignal!);
      return response();
    });
    await startForTest(source.event, input);
    await vi.waitFor(() => expect(received).toEqual(mainDecision));
    expect(state.canvasTryExecute).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'read-a', toolName: 'read_canvas_state',
    }), expect.any(AbortSignal));
    expect(source.frame.send.mock.calls.some(([, packet]) => packet.event.type === 'tool-call-pending')).toBe(false);
  });

  it('denies a canvas read when submission had no committed Surface authority', async () => {
    const source = owner(); const input = payload(false); let received: unknown;
    state.canvasTryExecute.mockResolvedValue({
      ok: false, code: 'surface_port_unavailable', message: 'surface_port_unavailable',
    });
    state.run.mockImplementation(async (_input, hooks: AgentChatV2Hooks) => {
      received = await hooks.awaitToolConfirmation({ toolCallId: 'read-missing', toolName: 'read_canvas_state', args: {} }, hooks.abortSignal!);
      return response();
    });
    await startForTest(source.event, input);
    await vi.waitFor(() => expect(received).toEqual({
      ok: false, code: 'surface_port_unavailable', message: 'surface_port_unavailable',
    }));
    expect(state.canvasCapture).toHaveBeenCalledWith(source.event, { projectId: 'p' }, input.requestId);
    expect(source.frame.send.mock.calls.some(([, packet]) => packet.event.type === 'tool-call-pending')).toBe(false);
  });

  it('keeps an unrelated ephemeral no-project Agent available with a fail-closed canvas adapter', async () => {
    const source = owner()
    const input = {
      requestId: `single-shot-${crypto.randomUUID()}`,
      request: { prompt: 'hello', capability: 'single-shot', history: { kind: 'ephemeral' } },
    }
    state.run.mockResolvedValue(response())

    await expect(invoke('start', source.event, input)).resolves.toEqual({ sessionId: input.requestId })
    expect(state.canvasCapture).toHaveBeenCalledWith(source.event, { projectId: '' }, input.requestId)
    await vi.waitFor(() => expect(state.run).toHaveBeenCalledOnce())
  })

  it('preserves a structured credential failure from the first real Agent request', async () => {
    const source = owner(); const input = payload();
    state.run.mockRejectedValue(Object.assign(new Error('Text model credential is locked'), {
      code: 'text_model_credential_locked',
    }));
    await startForTest(source.event, input);
    await vi.waitFor(() => expect(source.frame.send).toHaveBeenCalledWith('nomi:agents:chatV2:event', {
      sessionId: input.requestId,
      event: {
        type: 'error',
        message: 'Text model credential is locked',
        code: 'text_model_credential_locked',
      },
    }));
  });

  it('rejects duplicate ids synchronously and cancels before the lazy run can start', async () => {
    const source = owner(); const input = payload();
    state.run.mockImplementation(async (_input, hooks: AgentChatV2Hooks) => response(hooks.abortSignal?.aborted ? 'cancelled' : 'finished'));
    const start = state.handlers.get('nomi:agents:chatV2:start')!;
    const ack = start(source.event, input);
    await expect(Promise.resolve().then(() => start(source.event, input))).rejects.toThrow(/duplicate/i);
    await invoke('cancel', source.event, { sessionId: input.requestId });
    await ack;
    await vi.waitFor(() => expect(state.trace).toHaveBeenCalledWith(input.requestId, expect.objectContaining({ type: 'done' })));
  });

  it('requires webContents, process, routing and origin ownership for confirm and cancel', async () => {
    const source = owner(); const input = payload(); const finish = deferred<AgentChatResponse>();
    let seenHooks: AgentChatV2Hooks | undefined;
    state.run.mockImplementation(async (_input, hooks: AgentChatV2Hooks) => { seenHooks = hooks; return finish.promise; });
    await startForTest(source.event, input);
    await vi.waitFor(() => expect(seenHooks).toBeDefined());
    const decision = seenHooks!.awaitToolConfirmation({ toolCallId: 'c', toolName: 'set_node_prompt', args: {} }, seenHooks!.abortSignal!);
    const forged = [owner(99).event, owner(1, 99).event,
      { ...source.event, senderFrame: { ...source.frame, routingId: 99 } },
      { ...source.event, senderFrame: { ...source.frame, url: 'https://evil.test' } }];
    for (const event of forged) {
      const cancel = await invoke('cancel', event as IpcMainInvokeEvent, { sessionId: input.requestId });
      const confirm = await invoke('confirmTool', event as IpcMainInvokeEvent, { sessionId: input.requestId, toolCallId: 'c', decision: { ok: true } });
      expect(cancel).toMatchObject({ ok: false });
      expect(confirm).toMatchObject({ ok: false });
    }
    expect(seenHooks!.abortSignal!.aborted).toBe(false);
    await invoke('cancel', source.event, { sessionId: input.requestId });
    expect(await decision).toMatchObject({ ok: false });
    finish.resolve(response('cancelled'));
  });

  it('registers pending before emit, preserves full decisions, and rejects duplicate confirmation', async () => {
    const source = owner(); const input = payload(); const decision = { ok: true, result: { saved: 1 }, silent: true,
      effectiveArgs: { prompt: 'edited' }, overridesDelta: { prompt: 'edited' }, proposalId: 'proposal-a' };
    const received: unknown[] = [];
    source.frame.send.mockImplementation((_channel, packet) => {
      if (packet.event.type === 'tool-call-pending') void invoke('confirmTool', source.event, { sessionId: input.requestId, toolCallId: 'c', decision });
    });
    state.run.mockImplementation(async (_input, hooks: AgentChatV2Hooks) => {
      received.push(await hooks.awaitToolConfirmation({ toolCallId: 'c', toolName: 'set_node_prompt', args: {} }, hooks.abortSignal!));
      return response();
    });
    await startForTest(source.event, input);
    await vi.waitFor(() => expect(received).toEqual([decision]));
    expect(await invoke('confirmTool', source.event, { sessionId: input.requestId, toolCallId: 'c', decision })).toMatchObject({ ok: false });
    expect(state.decision).not.toHaveBeenCalled(); // silent read/automatic effects never become user approvals
  });

  it('accepts a string failure code and rejects a non-string code without settling the pending call', async () => {
    const source = owner(); const input = payload(); let received: unknown;
    state.run.mockImplementation(async (_input, hooks: AgentChatV2Hooks) => {
      received = await hooks.awaitToolConfirmation({ toolCallId: 'coded-failure', toolName: 'set_node_prompt', args: {} }, hooks.abortSignal!);
      return response();
    });
    await startForTest(source.event, input);
    await vi.waitFor(() => expect(source.frame.send).toHaveBeenCalledWith('nomi:agents:chatV2:event', expect.objectContaining({
      event: expect.objectContaining({ type: 'tool-call-pending', toolCallId: 'coded-failure' }),
    })));

    await expect(invoke('confirmTool', source.event, {
      sessionId: input.requestId,
      toolCallId: 'coded-failure',
      decision: { ok: false, message: 'stale', code: 42 },
    })).resolves.toEqual({ ok: false, error: 'Invalid Agent tool decision' });
    expect(received).toBeUndefined();

    const decision = { ok: false as const, message: 'canvas_target_stale', code: 'canvas_target_stale' };
    await expect(invoke('confirmTool', source.event, {
      sessionId: input.requestId,
      toolCallId: 'coded-failure',
      decision,
    })).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(received).toEqual(decision));
  });

  it('cancel wins over a late approval and emits the real cancelled result once', async () => {
    const source = owner(); const input = payload(); let pending!: Promise<unknown>;
    const finish = deferred<AgentChatResponse>();
    state.run.mockImplementation(async (_input, hooks: AgentChatV2Hooks) => {
      pending = hooks.awaitToolConfirmation({ toolCallId: 'c', toolName: 'set_node_prompt', args: {} }, hooks.abortSignal!);
      await pending; return finish.promise;
    });
    await startForTest(source.event, input);
    await vi.waitFor(() => expect(pending).toBeDefined());
    await invoke('cancel', source.event, { sessionId: input.requestId });
    expect(await invoke('confirmTool', source.event, { sessionId: input.requestId, toolCallId: 'c', decision: { ok: true, result: 'too late' } })).toMatchObject({ ok: false });
    expect(await pending).toMatchObject({ ok: false });
    finish.resolve(response('cancelled'));
    await vi.waitFor(() => expect(state.trace).toHaveBeenCalledWith(input.requestId, { type: 'done', reason: 'cancelled' }));
    expect(state.trace.mock.calls.filter(([id, event]) => id === input.requestId && event.type === 'done')).toHaveLength(1);
    expect(source.sender.eventNames()).toEqual([]);
  });

  it.each(['reload', 'render-process-gone', 'destroyed'])('%s cancels the old document; in-page navigation does not', async (cause) => {
    const source = owner(); const input = payload(); let seenHooks: AgentChatV2Hooks | undefined;
    const finish = deferred<AgentChatResponse>();
    state.run.mockImplementation(async (_input, hooks: AgentChatV2Hooks) => { seenHooks = hooks; return finish.promise; });
    await startForTest(source.event, input);
    await vi.waitFor(() => expect(seenHooks).toBeDefined());
    source.sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
    expect(seenHooks!.abortSignal!.aborted).toBe(false);
    if (cause === 'reload') source.sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    else source.sender.emit(cause);
    expect(seenHooks!.abortSignal!.aborted).toBe(true);
    source.frame.send.mockClear();
    finish.resolve(response('cancelled'));
    await vi.waitFor(() => expect(state.trace).toHaveBeenCalledWith(input.requestId, { type: 'done', reason: 'cancelled' }));
    expect(source.frame.send).not.toHaveBeenCalled();
    expect(source.sender.eventNames()).toEqual([]);
  });

  it('empty seeds preserve the explicit binding and clear awaits actual draining', async () => {
    const source = owner(); const history = payload().request.history;
    state.seed.mockResolvedValue(undefined); state.alive.mockResolvedValue(false);
    expect(await invoke('seedSession', source.event, { history, messages: [] })).toEqual({ ok: true });
    expect(state.seed).toHaveBeenCalledWith({ history, messages: [] });
    const drain = deferred<void>(); state.clear.mockReturnValue(drain.promise);
    let cleared = false;
    const clearing = invoke('clearSession', source.event, { history }).then(() => { cleared = true; });
    await vi.waitFor(() => expect(state.clear).toHaveBeenCalledOnce());
    expect(cleared).toBe(false);
    drain.resolve(); await clearing; expect(cleared).toBe(true);
  });
});
