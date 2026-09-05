import { ipcMain, type IpcMainInvokeEvent, type WebContents, type WebFrameMain, type WebContentsDidStartNavigationEventParams } from 'electron';
import { beginTurnTrace, traceChatEvent, traceGateDenied, traceToolDecision } from '../events/agentChatTrace';
import { desktopT } from '../i18n';
import { assertTrustedSender } from '../ipcSenderGuard';
import { captureAgentChatRequest, captureAgentHistory } from '../harness/agentChatPolicy';
import type { AgentChatErrorCode, AgentChatHistoryRequest, AgentChatResponse, AgentChatStartRequest, AgentChatToolDecision, AgentChatWireEvent } from '../harness/agentChatContracts';
import type { RuntimeToolCall } from '../harness/runtime/runtimePort';
import type { PiCanvasReadIpcCapture, PiCanvasReadTransportAdapter } from '../capabilityCore/canvasReadTransportAdapters';
import { createPiSkillReadTransportAdapter, type PiSkillReadTransportAdapter } from '../capabilityCore/skillReadTransportAdapters';
import { SurfacePortWireError } from '../shared/surfacePortBinding';

const CONFIRM_TIMEOUT_MS = 10 * 60_000;
type Owner = { contents: WebContents; frame: WebFrameMain; webContentsId: number; processId: number; routingId: number; origin: string };
type Pending = { settle(decision: AgentChatToolDecision): void };
type Session = { id: string; owner: Owner; controller: AbortController; pending: Map<string, Pending>;
  canvasRead: PiCanvasReadTransportAdapter; skillRead: PiSkillReadTransportAdapter; documentAlive: boolean; cleanup(): void };
const sessions = new Map<string, Session>();
const usedIds = new WeakMap<WebContents, Set<string>>();
let modulePromise: Promise<typeof import('./agentChatV2')> | undefined;
const loadAgent = () => modulePromise ??= import('./agentChatV2');

function origin(url: string): string {
  const parsed = new URL(url);
  return parsed.protocol === 'file:' ? 'file://' : parsed.origin;
}

function captureOwner(event: IpcMainInvokeEvent): Owner {
  const frame = event.senderFrame;
  const mainFrame = event.sender.mainFrame;
  if (!frame || frame.detached || frame.isDestroyed() || event.sender.isDestroyed()
    || frame.processId !== mainFrame.processId || frame.routingId !== mainFrame.routingId) throw new Error('Agent IPC requires the live main frame');
  return { contents: event.sender, frame, webContentsId: event.sender.id, processId: frame.processId, routingId: frame.routingId, origin: origin(frame.url) };
}

function sameOwner(event: IpcMainInvokeEvent, session: Session): boolean {
  if (!session.documentAlive) return false;
  try {
    const current = captureOwner(event);
    const expected = session.owner;
    return current.contents === expected.contents && current.webContentsId === expected.webContentsId
      && current.processId === expected.processId && current.routingId === expected.routingId && current.origin === expected.origin;
  } catch { return false; }
}

function observe(work: () => void): void {
  try { work(); } catch (error) { console.warn('Agent trace unavailable', error); }
}

function send(session: Session, event: AgentChatWireEvent): void {
  observe(() => traceChatEvent(session.id, event));
  const { contents, frame } = session.owner;
  if (!session.documentAlive || contents.isDestroyed() || frame.detached || frame.isDestroyed()) return;
  try { frame.send('nomi:agents:chatV2:event', { sessionId: session.id, event }); }
  catch { invalidateDocument(session); }
}

function cancel(session: Session): void {
  session.controller.abort();
  session.canvasRead.dispose();
  session.skillRead.dispose();
  for (const pending of session.pending.values()) pending.settle({ ok: false, message: 'Agent request cancelled' });
}

function invalidateDocument(session: Session): void {
  session.documentAlive = false;
  cancel(session);
}

function bindLifecycle(session: Session): void {
  const contents = session.owner.contents;
  const gone = () => invalidateDocument(session);
  const navigate = (details: WebContentsDidStartNavigationEventParams) => {
    if (details.isMainFrame && !details.isSameDocument) gone();
  };
  contents.on('did-start-navigation', navigate);
  contents.on('render-process-gone', gone);
  contents.on('destroyed', gone);
  session.cleanup = () => {
    contents.removeListener('did-start-navigation', navigate);
    contents.removeListener('render-process-gone', gone);
    contents.removeListener('destroyed', gone);
    for (const pending of session.pending.values()) pending.settle({ ok: false, message: 'Agent request settled' });
    session.canvasRead.dispose();
    session.skillRead.dispose();
  };
}

async function awaitConfirmation(session: Session, call: RuntimeToolCall, signal: AbortSignal): Promise<AgentChatToolDecision> {
  if (signal.aborted || session.controller.signal.aborted || !session.documentAlive) return Promise.resolve({ ok: false, message: 'Agent request cancelled' });
  try {
    const skillDecision = await session.skillRead.tryExecute(call, signal);
    if (skillDecision) return skillDecision;
    const capabilityDecision = await session.canvasRead.tryExecute(call, signal);
    if (capabilityDecision) return capabilityDecision;
  } catch {
    return { ok: false, code: 'capability_execution_failed', message: 'capability_execution_failed' };
  }
  if (session.pending.has(call.toolCallId)) return Promise.reject(new Error('Duplicate pending Agent tool call'));
  return new Promise((resolve) => {
    const abort = () => pending.settle({ ok: false, message: 'Agent request cancelled' });
    const timeout = setTimeout(() => pending.settle({ ok: false, message: desktopT('agent.confirmTimeout') }), CONFIRM_TIMEOUT_MS);
    const pending: Pending = { settle(decision) {
      if (session.pending.get(call.toolCallId) !== pending) return;
      session.pending.delete(call.toolCallId);
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      resolve(decision);
    } };
    session.pending.set(call.toolCallId, pending); // A synchronous renderer reply can now find it.
    signal.addEventListener('abort', abort, { once: true });
    send(session, { type: 'tool-call-pending', ...call });
  });
}

function emptyResult(id: string, status: 'error' | 'cancelled'): AgentChatResponse {
  return { id, status, text: '', toolCalls: [], artifacts: [], finishReason: status === 'cancelled' ? 'aborted' : 'error',
    ...(status === 'cancelled' ? { raw: { cancelled: true as const } } : {}),
    usage: { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, totalTokens: 0 } };
}

function structuredErrorCode(error: unknown): AgentChatErrorCode | undefined {
  if (!error || typeof error !== 'object') return undefined;
  return (error as { code?: unknown }).code === 'text_model_credential_locked'
    ? 'text_model_credential_locked' : undefined;
}

async function execute(session: Session, request: AgentChatStartRequest['request']): Promise<void> {
  let result: AgentChatResponse;
  try {
    const agent = await loadAgent();
    result = session.controller.signal.aborted ? emptyResult(session.id, 'cancelled')
      : await agent.runAgentChatV2(request, { emit: (event) => send(session, event), abortSignal: session.controller.signal,
        awaitToolConfirmation: (call, signal) => awaitConfirmation(session, call, signal) });
    if (session.controller.signal.aborted && result.status === 'finished') {
      result = { ...result, status: 'cancelled', finishReason: 'aborted', raw: { cancelled: true } };
    }
  } catch (error) {
    const status = session.controller.signal.aborted ? 'cancelled' : 'error';
    if (status === 'error') {
      const code = structuredErrorCode(error);
      send(session, { type: 'error', message: error instanceof Error ? error.message : String(error), ...(code ? { code } : {}) });
    }
    result = emptyResult(session.id, status);
  }
  try {
    send(session, { type: 'result', result });
    send(session, { type: 'done', reason: result.status });
  } finally {
    session.cleanup();
    sessions.delete(session.id);
  }
}

function validDecision(value: unknown): value is AgentChatToolDecision {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.ok !== true && record.ok !== false) return false;
  if (record.ok) return (record.silent === undefined || typeof record.silent === 'boolean')
    && (record.proposalId === undefined || typeof record.proposalId === 'string')
    && ['effectiveArgs', 'overridesDelta'].every((key) => record[key] === undefined || Boolean(record[key] && typeof record[key] === 'object' && !Array.isArray(record[key])));
  return (record.message === undefined || typeof record.message === 'string')
    && (record.code === undefined || typeof record.code === 'string')
    && (record.denied === undefined || typeof record.denied === 'boolean');
}

function assertSurfaceMatchesRequest(
  request: AgentChatStartRequest['request'],
  surfaceBinding: unknown,
): void {
  if (surfaceBinding === undefined) return;
  const surface = surfaceBinding && typeof surfaceBinding === 'object' && !Array.isArray(surfaceBinding)
    ? surfaceBinding as Record<string, unknown> : null;
  const binding = surface?.binding && typeof surface.binding === 'object' && !Array.isArray(surface.binding)
    ? surface.binding as Record<string, unknown> : null;
  const boundProjectId = typeof binding?.projectId === 'string' ? binding.projectId : null;
  const requestProjectId = canvasReadRequestProjectId(request)
  if (!requestProjectId || boundProjectId !== requestProjectId) {
    throw new SurfacePortWireError('surface_port_stale');
  }
  if (request.history.kind === 'persistent'
    && boundProjectId !== request.history.binding.project.projectId) {
    throw new SurfacePortWireError('surface_port_stale');
  }
}

function canvasReadRequestProjectId(request: AgentChatStartRequest['request']): string {
  const value = request.projectId ?? request.canvasProjectId
    ?? (request.history.kind === 'persistent' ? request.history.binding.project.projectId : '')
  return typeof value === 'string' ? value.trim() : ''
}

export function registerAgentChatV2Ipc(deps: Readonly<{ canvasRead: PiCanvasReadIpcCapture }>): void {
  ipcMain.handle('nomi:agents:chatV2:start', (event, input: AgentChatStartRequest) => {
    assertTrustedSender(event);
    const owner = captureOwner(event); // Never read event.senderFrame after an await.
    const id = input?.requestId;
    if (typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(id)) throw new Error('Invalid Agent request id');
    const ids = usedIds.get(owner.contents) ?? new Set<string>();
    if (ids.has(id) || sessions.has(id)) throw new Error('Duplicate Agent request id');
    const request = captureAgentChatRequest(input.request);
    if (input.surfaceBinding !== undefined && input.capturedCanvasReadSnapshot !== undefined) {
      throw new SurfacePortWireError('surface_port_stale')
    }
    if (input.capturedCanvasReadSnapshot !== undefined
      && (request.capability !== 'storyboard' || request.history.kind !== 'ephemeral')) {
      throw new SurfacePortWireError('surface_port_stale')
    }
    assertSurfaceMatchesRequest(request, input.surfaceBinding);
    const requestProjectId = canvasReadRequestProjectId(request)
    if (input.capturedCanvasReadSnapshot !== undefined && !requestProjectId) {
      throw new SurfacePortWireError('surface_port_stale')
    }
    // Exchange the renderer wire for B3's exact captured handle while the event
    // frame is still current, before queueMicrotask, dynamic import, or model IO.
    const canvasRead = deps.canvasRead.capture(event, {
      ...(input.surfaceBinding !== undefined ? { surfaceBinding: input.surfaceBinding } : {}),
      ...(input.capturedCanvasReadSnapshot !== undefined
        ? { capturedCanvasReadSnapshot: input.capturedCanvasReadSnapshot }
        : {}),
      projectId: requestProjectId,
    }, id);
    ids.add(id); usedIds.set(owner.contents, ids);
    const session: Session = { id, owner, controller: new AbortController(), pending: new Map(), canvasRead, skillRead: createPiSkillReadTransportAdapter(), documentAlive: true, cleanup: () => {} };
    sessions.set(id, session);
    bindLifecycle(session);
    observe(() => beginTurnTrace(id, request as unknown as Record<string, unknown>));
    queueMicrotask(() => { void execute(session, request); });
    return { sessionId: id };
  });

  ipcMain.handle('nomi:agents:chatV2:confirmTool', (event, input: { sessionId?: string; toolCallId?: string; decision?: unknown }) => {
    assertTrustedSender(event);
    const session = sessions.get(input?.sessionId ?? '');
    if (!session || !sameOwner(event, session)) return { ok: false, error: 'Agent request owner mismatch or missing' };
    if (session.controller.signal.aborted) return { ok: false, error: 'Agent request cancelled' };
    const toolCallId = input.toolCallId ?? '';
    const pending = session.pending.get(toolCallId);
    if (!pending) return { ok: false, error: 'Agent confirmation missing or already settled' };
    if (!validDecision(input.decision)) return { ok: false, error: 'Invalid Agent tool decision' };
    const decision = input.decision;
    if (decision.ok ? !decision.silent : !decision.denied) observe(() => traceToolDecision(session.id, toolCallId, decision));
    if (!decision.ok && decision.denied) observe(() => traceGateDenied(session.id, toolCallId, decision.message ?? 'Tool denied'));
    pending.settle(decision);
    return { ok: true };
  });

  ipcMain.handle('nomi:agents:chatV2:cancel', (event, input: { sessionId?: string }) => {
    assertTrustedSender(event);
    const session = sessions.get(input?.sessionId ?? '');
    if (!session || !sameOwner(event, session)) return { ok: false, error: 'Agent request owner mismatch or missing' };
    cancel(session);
    return { ok: true };
  });

  ipcMain.handle('nomi:agents:chatV2:clearSession', async (event, input: AgentChatHistoryRequest) => {
    assertTrustedSender(event);
    captureOwner(event);
    const history = captureAgentHistory(input?.history);
    await (await loadAgent()).clearAgentChatV2History({ history });
    return { ok: true };
  });
  ipcMain.handle('nomi:agents:chatV2:sessionAlive', async (event, input: AgentChatHistoryRequest) => {
    assertTrustedSender(event);
    captureOwner(event);
    const history = captureAgentHistory(input?.history);
    return { alive: await (await loadAgent()).agentChatV2HasHistory({ history }) };
  });
  ipcMain.handle('nomi:agents:chatV2:seedSession', async (event, input: AgentChatHistoryRequest) => {
    assertTrustedSender(event);
    captureOwner(event);
    const history = captureAgentHistory(input?.history);
    const messages = input.messages?.map((message) => ({ ...message }));
    await (await loadAgent()).seedAgentChatV2History({ history, messages });
    return { ok: true };
  });
}
