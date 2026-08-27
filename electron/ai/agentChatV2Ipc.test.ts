import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { AgentChatV2Hooks } from './agentChatV2';
import type { AgentChatResponse } from '../harness/agentChatContracts';

const state = vi.hoisted(() => ({ handlers: new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => unknown>(),
  run: vi.fn(), seed: vi.fn(), alive: vi.fn(), clear: vi.fn(), trace: vi.fn(), decision: vi.fn(),
  oldSend: vi.fn(), translate: vi.fn(() => 'confirmation expired'), trust: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (event: IpcMainInvokeEvent, payload: unknown) => unknown) => state.handlers.set(name, fn) },
  webContents: { fromId: () => ({ send: state.oldSend, isDestroyed: () => false }) } }));
vi.mock('../ipcSenderGuard', () => ({ assertTrustedSender: state.trust }));
vi.mock('../events/agentChatTrace', () => ({ beginTurnTrace: () => {}, traceChatEvent: state.trace, traceToolDecision: state.decision, traceGateDenied: () => {} }));
vi.mock('../i18n', () => ({ desktopT: state.translate }));
vi.mock('./agentChatV2', () => ({ runAgentChatV2: state.run, seedAgentChatV2History: state.seed,
  agentChatV2HasHistory: state.alive, clearAgentChatV2History: state.clear }));
import { registerAgentChatV2Ipc } from './agentChatV2Ipc';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function owner(id = 1, processId = 10) {
  const frame = { routingId: 2, processId, url: 'file:///nomi/index.html', detached: false, isDestroyed: () => false, send: vi.fn() };
  const sender = Object.assign(new EventEmitter(), { id, mainFrame: frame, isDestroyed: () => false });
  const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  return { event, sender, frame };
}
const payload = () => ({ requestId: `test-${crypto.randomUUID()}`, request: { prompt: 'hello', capability: 'canvas-agent',
  history: { kind: 'persistent', binding: { sessionKey: 'nomi:workbench:p:generation', threadId: 't' } } } });
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
beforeEach(() => { vi.clearAllMocks(); state.trust.mockReset(); state.handlers.clear(); registerAgentChatV2Ipc(); });
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
    await vi.waitFor(() => expect(state.run).toHaveBeenCalledOnce());
    finish.resolve(response());
    await vi.waitFor(() => expect(state.trace).toHaveBeenCalledWith(input.requestId, { type: 'done', reason: 'finished' }));
    expect(source.frame.send).toHaveBeenCalled();
    expect(state.oldSend).not.toHaveBeenCalled();
    expect(source.sender.eventNames()).toEqual([]);
  });

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
    const decision = seenHooks!.awaitToolConfirmation({ toolCallId: 'c', toolName: 'read_canvas_state', args: {} }, seenHooks!.abortSignal!);
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
