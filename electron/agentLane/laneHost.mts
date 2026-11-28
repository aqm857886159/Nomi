// Agent lane · 主进程宿主生命周期与命令装配（`pi-agent-core@1.7.0` `Agent` + `pi-coding-agent@1.7.0` `SessionManager` v3）
import { randomUUID } from 'node:crypto';
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import {
  createModels,
  getSupportedThinkingLevels,
  isContextOverflow,
  isRetryableAssistantError,
  type JsonValue,
} from '@earendil-works/pi-ai';
import { awaitWithAbortSignal, createLaneInputAdmission } from './laneInputAdmission.mjs';
import { originalLaneEntry, precedingLaneInput, resolveLaneReplay } from './laneOriginalInput.mjs';
import { withRestoredTemplate } from './laneInputIntent.mjs';
import { openLaneHistoryPage } from './laneHistoryPage.mjs';
import { attachLaneTrace, createLaneTraceBridge } from './laneTraceRecorder.mjs';
import type { LaneInputMessage } from '../shared/agentLane/laneDesktopContracts.js';
import { LANE_CODING_TOOL_NAMES } from './laneCodingTools.mjs';
import { LANE_LEGACY_NOTE, LANE_LEGACY_TOOLS_NOTE, laneLegacyFacts } from '../shared/agentLane/laneLegacyNote.js';
import { findLaneReceiptAuthority } from './laneReceiptAuthority.mjs';
import { createLaneRepeatedFailureTracker } from './laneRepeatedFailure.mjs';
import { createLaneTurnBudget } from './laneTurnBudget.mjs';
import { createLaneToolInputBoundary } from './laneToolInputBoundary.mjs';
import { ASK_USER_VERB_NAME } from '../shared/agentCapabilities/askUser.js';
import { laneCompactionSettings } from './laneContextBudget.mjs';
import { formatLaneModelIndex } from './laneModelContext.js';
import { draftInputFromMessage, isLaneInputMessage } from '../shared/agentLane/laneInputMessage.js';
import { createNomiProvider } from './laneModelProvider.mjs';
import { LANE_STREAM_WATCHDOG } from './laneProviderGuard.mjs';
import type {
  LaneOperationSnapshot,
  LaneQueueItem,
  LaneSnapshot,
} from '../shared/agentLane/laneSnapshotTypes.js';
import {
  LANE_APPROVAL_NOTE_TYPE,
  LANE_TASK_NOTE_TYPE,
  LANE_UI_NOTE_PREFIX,
  laneNoteEntersModelContext,
  type LaneCancelQueuedResult,
  type LaneCommand,
  type LaneCommandOutcome,
  type LaneHandle,
  type LaneProjection,
  type LaneSkillIndexEntry,
  type LaneThinkingLevel,
} from '../shared/agentLane/laneContracts.js';
import { createLaneApprovalGate } from './laneApprovalGate.js';
import type { OpenLane, OpenLaneOptions } from './laneRuntimePort.js';
import { composeLaneSystemPrompt } from './lanePromptSections.js';
import { loadPiSkillFormatter, renderLaneSkillSection, laneSkillUnlockReason } from './laneSkillCatalog.mjs';
import { openLaneSession } from './laneSession.mjs';
import { createLaneTools } from './laneTools.mjs';
import { projectLaneSnapshot, type LaneModelFacts } from '../shared/agentLane/laneProjection.js';
import { LANE_DEFERRED_TOOL_GROUPS } from './laneToolCatalog.js';
import { laneContinuationText } from './laneContinuation.mjs';
import {
  createLaneHostDrive,
  interruptedToolCalls,
  type LaneOrderObservation,
  type LiveLaneOperation,
  type QueuedMessageRecord,
} from './laneHostDrive.mjs';

export type { LaneOrderObservation };

type LaneNativeDesktop = Awaited<ReturnType<typeof import('./laneNativeDesktop.mjs').openLaneNativeDesktop>>;
const loadLaneNativeDesktop = () => import('./laneNativeDesktop.mjs');

export const LANE_RETRY_POLICY = Object.freeze({ enabled: true, maxRetries: 3, baseDelayMs: 1_000 } as const);
export const LANE_MAX_MODEL_REQUESTS: number | undefined = undefined;
export { LANE_REPEATED_FAILURE_BLOCK } from './laneRepeatedFailure.mjs';

export interface LaneHandleWithObservations extends LaneHandle {
  orderObservations(): readonly LaneOrderObservation[];
}

const ACTIVE_TOOLS_NOTE = 'nomi.ui.active-tools';

function assertUiOnlyNotes(...noteTypes: readonly string[]): void {
  for (const noteType of noteTypes) {
    if (!noteType.startsWith(LANE_UI_NOTE_PREFIX) || laneNoteEntersModelContext(noteType)) {
      throw new Error(`${noteType} is not a UI-only lane note; it needs a real projector, not () => undefined`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const openLane: OpenLane = async (options: OpenLaneOptions): Promise<LaneHandleWithObservations> => {
  assertUiOnlyNotes(LANE_APPROVAL_NOTE_TYPE, LANE_TASK_NOTE_TYPE, ACTIVE_TOOLS_NOTE);
  const inputs = createLaneInputAdmission();
  const laneName = options.laneName ?? 'main';
  const { session, sessionId, release } = await openLaneSession({ ...options, laneName });
  let native: LaneNativeDesktop | undefined;
  try {
    return await assemble();
  } catch (cause) {
    try { await native?.close(); }
    finally {
      await session.close().catch(() => undefined);
      await release();
    }
    throw cause;
  }

  async function assemble(): Promise<LaneHandleWithObservations> {
    if (options.native) {
      native = await (await loadLaneNativeDesktop()).openLaneNativeDesktop({
        projectDir: options.projectDir,
        ...options.native,
        deferredGroups: LANE_DEFERRED_TOOL_GROUPS.map((group) => ({
          ...group,
          toolNames: group.toolNames.filter((name) => options.tools.some((tool) => tool.name === name)),
        })).filter((group) => group.toolNames.length > 0),
        availableModels: () => snapshot.transcript.flatMap((entry) =>
          entry.type === 'message' && isLaneInputMessage(entry.message)
            ? [entry.message.context.availableModels ?? []]
            : []).at(-1) ?? [],
        modelAvailability: options.modelAvailability,
      });
    }

    const { provider, model, credentials, pricingBasis } = await createNomiProvider(options.model, options.fetch, {
      firstResponseMs: options.watchdog?.firstResponseMs ?? LANE_STREAM_WATCHDOG.firstResponseMs,
      firstTokenMs: options.watchdog?.firstTokenMs ?? LANE_STREAM_WATCHDOG.firstTokenMs,
      idleMs: options.watchdog?.idleMs ?? LANE_STREAM_WATCHDOG.idleMs,
    });

    const failures = createLaneRepeatedFailureTracker();
    const turn = createLaneTurnBudget(failures, options.limits?.maxModelRequests ?? LANE_MAX_MODEL_REQUESTS);
    const traceBridge = createLaneTraceBridge(options, pricingBasis, turn);
    const toolInput = createLaneToolInputBoundary({
      failures,
      specs: options.tools,
      onFailure: traceBridge.onFailure,
      turn,
    });

    const modelFacts: LaneModelFacts = {
      pricing: pricingBasis,
      supportedThinkingLevels: getSupportedThinkingLevels(model) as readonly LaneThinkingLevel[],
      toolInputFailure: toolInput.failureOf,
      isTransientError: isRetryableAssistantError,
      isContextOverflow: (message) => isContextOverflow(message, options.model.contextWindow),
      ...(options.model.contextWindow === undefined ? {} : { contextWindow: options.model.contextWindow }),
    };

    const models = createModels({ credentials });
    models.setProvider(provider);

    const gateRef: { current: ReturnType<typeof createLaneApprovalGate> | undefined } = { current: undefined };
    const tools: AgentTool<object, unknown>[] = toolInput.wrap([
      ...createLaneTools(
        options.tools,
        (toolCallId) => gateRef.current?.decisionFor(toolCallId),
        (toolCallId) => gateRef.current?.answerFor(toolCallId),
      ),
      ...(native?.tools ?? []),
    ]);
    const registeredToolNames = new Set(tools.map((tool) => tool.name));
    let activeToolNames: string[] = [...registeredToolNames];

    const sessionCtx = session.buildSessionContext();
    if (sessionCtx.model?.provider !== model.provider || sessionCtx.model?.modelId !== model.id) {
      await session.appendModelChange(model.provider, model.id);
    }
    const thinkingLevel = (sessionCtx.thinkingLevel || 'off') as LaneThinkingLevel;

    const savedActiveToolsEntry = session.findBranchEntries({
      type: 'custom',
      customType: ACTIVE_TOOLS_NOTE,
      order: 'newestFirst',
      limit: 1,
    })[0];
    const restoredActiveTools = savedActiveToolsEntry?.type === 'custom'
      && isRecord(savedActiveToolsEntry.data)
      && Array.isArray(savedActiveToolsEntry.data.names)
      ? savedActiveToolsEntry.data.names.filter((n): n is string => typeof n === 'string' && registeredToolNames.has(n))
      : undefined;
    if (restoredActiveTools && restoredActiveTools.length > 0) {
      activeToolNames = restoredActiveTools;
    }

    const setActiveTools = async (nextNames: readonly string[]): Promise<void> => {
      activeToolNames = nextNames.filter((name) => registeredToolNames.has(name));
      await session.appendCustomEntry(ACTIVE_TOOLS_NOTE, { names: activeToolNames });
    };

    const legacySource = session.findBranchEntries({ type: 'custom', customType: LANE_LEGACY_NOTE, limit: 1 })[0];
    if (
      legacySource?.type === 'custom'
      && laneLegacyFacts(legacySource.data)
      && !session.findBranchEntries({ type: 'custom', customType: LANE_LEGACY_TOOLS_NOTE, limit: 1 }).length
    ) {
      await setActiveTools([...registeredToolNames]);
      await session.appendCustomEntry(LANE_LEGACY_TOOLS_NOTE, { version: 1 });
    }

    if (native) {
      const resident = native.activeToolNames().filter((name) => registeredToolNames.has(name));
      native.bindActiveTools(session);
      const hasLegacyToolsNote = session.findBranchEntries({ type: 'custom', customType: LANE_LEGACY_TOOLS_NOTE, limit: 1 }).length > 0;
      if (
        restoredActiveTools
        && !hasLegacyToolsNote
        && LANE_CODING_TOOL_NAMES.every((name) => restoredActiveTools.includes(name))
      ) {
        await native.unlockCoding();
      }
      if (resident.some((name) => !activeToolNames.includes(name))) {
        await setActiveTools([...resident, ...activeToolNames.filter((name) => !resident.includes(name))]);
      }
    }

    const staticSkills = options.skills ?? [];
    const staticSection = !native && staticSkills.length > 0
      ? renderLaneSkillSection(await loadPiSkillFormatter(), staticSkills)
      : '';
    const currentSkills = (): readonly LaneSkillIndexEntry[] => native?.skillIndex.current().entries ?? staticSkills;
    const promptTools = [...options.tools, ...(native?.promptTools ?? [])];
    const composeSystemPrompt = (): string => composeLaneSystemPrompt(
      typeof options.systemPrompt === 'function' ? options.systemPrompt() : options.systemPrompt,
      promptTools,
      native?.skillIndex.current().promptSection ?? staticSection,
    );
    const composeClosing = (): string =>
      typeof options.systemPromptClosing === 'function' ? options.systemPromptClosing() : options.systemPromptClosing ?? '';

    let promptRunId: string | undefined;
    let promptForRun = composeSystemPrompt();
    let closingForRun = composeClosing();
    const systemPromptForRun = async (runId: string): Promise<{ prompt: string; closing: string }> => {
      if (runId === promptRunId) return { prompt: promptForRun, closing: closingForRun };
      promptRunId = runId;
      await native?.skillIndex.refresh();
      promptForRun = composeSystemPrompt();
      closingForRun = composeClosing();
      return { prompt: promptForRun, closing: closingForRun };
    };
    const systemPrompt = promptForRun;

    const compactionSettings = laneCompactionSettings(model.contextWindow, options.limits?.contextTokenBudget);

    const pendingSteer: QueuedMessageRecord[] = [];
    const pendingFollowUp: QueuedMessageRecord[] = [];
    const consumedQueueIds = new Set<string>();
    const deferredCustomNotes: Array<{ entryId: string; customType: string; data?: JsonValue }> = [];
    let closed = false;
    let readLiveOperation: () => LiveLaneOperation | null = () => null;

    const buildSnapshot = (): LaneSnapshot => {
      const liveOp = readLiveOperation();
      const queues: LaneQueueItem[] = [
        ...pendingSteer.map((item) => ({
          entryId: item.entryId,
          kind: 'steer' as const,
          type: 'message' as const,
          message: item.message,
        })),
        ...pendingFollowUp.map((item) => ({
          entryId: item.entryId,
          kind: 'followUp' as const,
          type: 'message' as const,
          message: item.message,
        })),
        ...deferredCustomNotes.map((note) => ({
          entryId: note.entryId,
          kind: 'write' as const,
          type: 'custom' as const,
          customType: note.customType,
          ...(note.data === undefined ? {} : { data: note.data }),
        })),
      ];
      const operation: LaneOperationSnapshot | null = liveOp
        ? {
            id: liveOp.id,
            kind: 'run',
            startedAt: liveOp.startedAt,
            fromTipId: liveOp.fromTipId,
            status: 'open',
            ...(liveOp.streamingMessage ? { streamingMessage: liveOp.streamingMessage } : {}),
            ...(liveOp.runningTools.length > 0 ? { runningTools: [...liveOp.runningTools] } : {}),
            ...(liveOp.retry ? { retry: liveOp.retry } : {}),
          }
        : null;
      return {
        lane: laneName,
        transcript: session.activeTranscript(),
        tipId: session.getTipId(),
        configuration: {
          model: { provider: model.provider, modelId: model.id },
          thinkingLevel,
          activeToolNames: [...activeToolNames],
        },
        stats: session.getStats(),
        operation,
        queues,
        faulted: false,
      };
    };

    let snapshot: LaneSnapshot = buildSnapshot();
    const interrupted = interruptedToolCalls(snapshot);
    const history = await openLaneHistoryPage(session, snapshot.tipId);

    const approval = options.approval;
    const gate = approval
      ? createLaneApprovalGate({
          specs: options.tools,
          hasUserInterface: approval.hasUserInterface,
          resolveSubject: (request) => native?.resolveApprovalSubject(request) ?? approval.resolveSubject?.(request),
          ...(approval.policy ? { policy: approval.policy } : {}),
          ...(approval.workMode ? { workMode: approval.workMode } : {}),
          restoredToolCallIds: interrupted.ids,
          onChange: () => publish(),
        })
      : undefined;
    gateRef.current = gate;

    const sandboxFacts = native?.sandboxInactive ? { sandboxInactive: native.sandboxInactive.code } : {};
    const currentProjection = (): LaneProjection => {
      const awaitingDecisionToolCallIds = gate?.awaitingDecisionToolCallIds();
      return {
        ...projectLaneSnapshot(
          snapshot,
          modelFacts,
          gate?.pending(),
          options.tasks,
          history.entries(),
          history.previousInputId(),
          options.attachments,
        ),
        history: history.state(),
        ...sandboxFacts,
        ...(awaitingDecisionToolCallIds?.length ? { awaitingDecisionToolCallIds } : {}),
      };
    };
    let projection = currentProjection();
    const listeners = new Set<(next: LaneProjection) => void>();
    const publish = () => {
      snapshot = buildSnapshot();
      projection = currentProjection();
      for (const listener of listeners) listener(projection);
    };

    const appendCustomDuringOrAfterRun = async (customType: string, data?: JsonValue): Promise<void> => {
      if (readLiveOperation() !== null) {
        deferredCustomNotes.push({ entryId: randomUUID(), customType, ...(data === undefined ? {} : { data }) });
        publish();
        return;
      }
      const id = await session.appendCustomEntry(customType, data);
      const entry = session.getEntry(id);
      if (entry) history.append(entry);
      publish();
    };

    const flushDeferredNotes = async (): Promise<void> => {
      for (const note of deferredCustomNotes.splice(0)) {
        const id = await session.appendCustomEntry(note.customType, note.data);
        const entry = session.getEntry(id);
        if (entry) history.append(entry);
      }
      for (const note of gate?.drainNotes() ?? []) {
        const id = await session.appendCustomEntry(LANE_APPROVAL_NOTE_TYPE, { ...note });
        const entry = session.getEntry(id);
        if (entry) history.append(entry);
      }
    };

    const trace = attachLaneTrace({
      session,
      runtimeBridge: traceBridge,
      isContextOverflow: modelFacts.isContextOverflow,
    });
    await trace.refresh().catch(() => undefined);

    const drive = createLaneHostDrive({
      laneName,
      session,
      sessionId,
      history,
      options,
      model,
      models,
      thinkingLevel,
      compactionSettings,
      retryPolicy: LANE_RETRY_POLICY,
      turn,
      failures,
      toolInput,
      gate,
      toolAccessDenial: async (toolName) => native?.toolAccessDenial(toolName),
      trace,
      executableTools: () => tools.filter((tool) => activeToolNames.includes(tool.name)),
      registeredToolNames,
      initialPrompt: systemPrompt,
      renderModelIndex: (context) => formatLaneModelIndex(context, options.modelDefaults?.()),
      systemPromptForRun,
      pendingSteer,
      pendingFollowUp,
      consumedQueueIds,
      appendCustomDuringOrAfterRun,
      flushDeferredNotes,
      publish,
      isClosed: () => closed,
      interrupted,
    });
    readLiveOperation = drive.getLiveOperation;

    async function inputMessage(text: string): Promise<AgentMessage> {
      if (!options.input) {
        return { role: 'user', content: text, timestamp: Date.now() };
      }
      const captured = structuredClone(options.input.capture());
      const { restoredIntent, ...currentAdmission } = captured;
      if (restoredIntent && (captured.continueFromEntryId || captured.retryFromEntryId)) {
        throw new Error('agent_lane_invalid_command');
      }
      let message: LaneInputMessage;
      if (captured.continueFromEntryId) {
        const stopped = originalLaneEntry(session, captured.continueFromEntryId);
        laneContinuationText(stopped);
        const original = precedingLaneInput(session, stopped.parentId);
        if (!original) throw new Error('agent_lane_input_reference_invalid');
        message = resolveLaneReplay(session, original, captured, text);
      } else if (captured.retryFromEntryId) {
        message = resolveLaneReplay(session, originalLaneEntry(session, captured.retryFromEntryId), captured, text);
      } else {
        const { admissionSurface: _submitted, ...intent } = withRestoredTemplate(currentAdmission, restoredIntent);
        message = {
          role: 'nomi.input',
          content: text,
          timestamp: Date.now(),
          context: { ...intent, ...(captured.target ? { admissionSurface: captured.target.kind } : {}) },
        };
      }
      if (message.context.continueFromEntryId) {
        laneContinuationText(originalLaneEntry(session, message.context.continueFromEntryId));
      }
      if (options.input.prepare) message.context = await options.input.prepare(message.context);
      return message;
    }

    let closing: Promise<void> | undefined;
    return {
      laneName,
      sessionId,
      receiptAuthority: (proposalId) => findLaneReceiptAuthority(snapshot, proposalId),
      projection: () => projection,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      orderObservations: () => drive.observations,
      appendTaskNote: async (note) => {
        await appendCustomDuringOrAfterRun(LANE_TASK_NOTE_TYPE, { ...note });
      },
      refreshTasks: () => publish(),
      execute: async (command: LaneCommand, executionOptions): Promise<LaneCommandOutcome> => {
        if (closed) throw new Error('Closed');
        if (command.kind === 'abort') inputs.cancel();
        const admission = inputs.capture(executionOptions?.admissionSignal);
        if (command.kind === 'history-older') {
          await history.older(command.before);
          publish();
          return {};
        }
        if (command.kind === 'prompt' && !projection.running && !gate?.pending() && !drive.hasActiveDrive()) {
          const message = await awaitWithAbortSignal(inputMessage(command.text), admission);
          await awaitWithAbortSignal(Promise.resolve(native?.skillIndex.refresh()), admission);
          const unlock = isLaneInputMessage(message)
            ? laneSkillUnlockReason(currentSkills(), [message.context.skillKey ?? ''])
            : null;
          if (native && unlock) {
            await native.unlockCoding(admission);
            admission.throwIfAborted();
          }
          admission.throwIfAborted();
          const fromTipId = session.getTipId();
          const queuedBeforePrompt = [
            ...pendingSteer.splice(0),
            ...pendingFollowUp.splice(0),
          ];
          if (queuedBeforePrompt.length > 0) {
            drive.agent.clearAllQueues();
          }
          const promptEntryIds: string[] = [];
          for (const item of queuedBeforePrompt) {
            consumedQueueIds.add(item.entryId);
            turn.onMessageEnd('pending', item.message);
            const queuedId = await session.appendMessage(item.message);
            drive.entryIdByMessage.set(item.message as object, queuedId);
            const queuedPersisted = session.getEntry(queuedId);
            if (queuedPersisted) history.append(queuedPersisted);
            promptEntryIds.push(queuedId);
          }
          turn.onMessageEnd('pending', message);
          const promptEntryId = await session.appendMessage(message);
          drive.entryIdByMessage.set(message as object, promptEntryId);
          const persisted = session.getEntry(promptEntryId);
          if (persisted) history.append(persisted);
          promptEntryIds.push(promptEntryId);
          publish();
          executionOptions?.onAccepted?.();
          await drive.startDrive(promptEntryIds, fromTipId);
          await trace.flush();
          return {};
        }
        if (command.kind === 'steer' || command.kind === 'follow-up' || command.kind === 'prompt') {
          const question = gate?.pending();
          if (
            gate
            && question?.toolName === ASK_USER_VERB_NAME
            && command.text.trim()
            && gate.answer(question.toolCallId, 'answer', command.text)
          ) {
            failures.reset();
            executionOptions?.onAccepted?.();
            return {};
          }
          const held = gate?.holding();
          if (
            gate
            && held
            && command.text.trim()
            && gate.settleHold(held.toolCallId, { kind: 'redirected', text: command.text.trim() })
          ) {
            failures.reset();
            executionOptions?.onAccepted?.();
            return {};
          }
          const steering = command.kind !== 'follow-up' || Boolean(gate?.pending());
          const message = await awaitWithAbortSignal(inputMessage(command.text), admission);
          admission.throwIfAborted();
          if (closed) throw new Error('Closed');
          const entryId = randomUUID();
          if (steering) {
            pendingSteer.push({ entryId, kind: 'steer', message });
            drive.agent.steer(message);
          } else {
            pendingFollowUp.push({ entryId, kind: 'followUp', message });
            drive.agent.followUp(message);
          }
          publish();
          if (steering) {
            while (gate?.pending()) {
              gate.answer(
                gate.pending()!.toolCallId,
                'deny',
                'The user interrupted this unapproved action. It did not run; follow the new user message.',
              );
            }
          }
          if (!drive.hasActiveDrive() && !drive.getLiveOperation()) {
            void drive.startDrive([], session.getTipId());
          }
          executionOptions?.onAccepted?.();
          return { queuedEntryId: entryId };
        }
        if (command.kind === 'cancel-queued') {
          const steerIdx = pendingSteer.findIndex((item) => item.entryId === command.entryId);
          if (steerIdx !== -1) {
            const [removed] = pendingSteer.splice(steerIdx, 1);
            drive.agent.clearSteeringQueue();
            for (const remaining of pendingSteer) drive.agent.steer(remaining.message);
            publish();
            return {
              cancelQueued: 'cancelled' as LaneCancelQueuedResult,
              ...(removed ? { restoredInput: [draftInputFromMessage(removed.message)] } : {}),
            };
          }
          const followIdx = pendingFollowUp.findIndex((item) => item.entryId === command.entryId);
          if (followIdx !== -1) {
            const [removed] = pendingFollowUp.splice(followIdx, 1);
            drive.agent.clearFollowUpQueue();
            for (const remaining of pendingFollowUp) drive.agent.followUp(remaining.message);
            publish();
            return {
              cancelQueued: 'cancelled' as LaneCancelQueuedResult,
              ...(removed ? { restoredInput: [draftInputFromMessage(removed.message)] } : {}),
            };
          }
          if (consumedQueueIds.has(command.entryId)) {
            return { cancelQueued: 'already_consumed' as LaneCancelQueuedResult };
          }
          return { cancelQueued: 'not_found' as LaneCancelQueuedResult };
        }
        if (command.kind === 'lane-select' || command.kind === 'lane-create' || command.kind === 'lane-delete') {
          throw new Error(`A single agent lane cannot handle ${command.kind}; that command belongs to the workspace`);
        }
        if (command.kind === 'approval') {
          if (!gate) throw new Error('agent_lane_approval_missing');
          if (!gate.answer(command.toolCallId, command.action, command.reason)) {
            throw new Error('agent_lane_approval_missing');
          }
          return {};
        }
        // abort
        const drained = drive.drainQueuesForAbort();
        gate?.cancelAll('stopped');
        drive.abortLiveOperation();
        drive.agent.abort();
        await drive.waitActiveDrive();
        await flushDeferredNotes();
        publish();
        await trace.refresh().catch(() => undefined);
        const restoredInput = drained.map((item) => draftInputFromMessage(item.message));
        return restoredInput.length > 0 ? { restoredInput } : {};
      },
      close: () => closing ??= (async () => {
        closed = true;
        inputs.cancel();
        try {
          if (drive.getLiveOperation() !== null || gate?.pending() || drive.hasActiveDrive()) {
            drive.drainQueuesForAbort();
            gate?.cancelAll('window-closed');
            drive.abortLiveOperation();
            drive.agent.abort();
            await drive.waitActiveDrive();
            await flushDeferredNotes();
          }
        } finally {
          drive.stopSubscription();
          listeners.clear();
          try {
            try {
              await trace.close();
            } finally {
              await session.close();
            }
          } finally {
            try { await native?.close(); }
            finally { await release(); }
          }
        }
      })(),
    };
  }
};
