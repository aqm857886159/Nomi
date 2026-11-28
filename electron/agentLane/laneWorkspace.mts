import { awaitWithAbortSignal, createLaneInputAdmission } from './laneInputAdmission.mjs';
// Agent lane · 一个项目的多条对话（方案 §2.2 G2「多线程 = 多 lane」）
//
// 一条对话 = 一条 pi `SessionManager` v3 会话，住在 `<project>/.nomi/agent-sessions/--nomi-lane-<名字>--/` 下。
//   · 列表 = `listLaneSessions`（只读每个文件的表头，不读转录）
//   · 新建 = `openLaneSession`（`SessionManager.create`）
//   · 删除 = `deleteLaneSession`
// 项目只另存当前选择的 laneName/sessionId 指针；恢复时必须重新对上盘上的真实会话列表。
import type {
  LaneCommand, LaneCommandOutcome, LaneHandle, LaneSummary, LaneWorkspaceHandle, LaneWorkspaceProjection,
} from '../shared/agentLane/laneContracts.js';
import { openLaneHistory } from './laneHistory.mjs';
import { deleteLaneSession, listLaneSessions } from './laneSession.mjs';
import type { OpenLaneOptions } from './laneRuntimePort.js';
import type { PendingSpendRead } from '../shared/contracts/pendingSpendConfirm.js';
import { readLaneWorkspaceSelection, writeLaneWorkspaceSelection } from './laneWorkspaceSelection.js';

/** 打开一个项目的对话工作区。缺省恢复上次选择；只有没有会话的新项目才创建 `main`。 */
export type LaneWorkspaceOptions = Omit<OpenLaneOptions, 'sessionId' | 'model'> & {
  model?: OpenLaneOptions['model'];
  /** 项目级的待决出价（付费卡）。工作区每次发布时现读一次，摊进投影；它不属于任何一条 lane。 */
  spend?: () => PendingSpendRead;
};

/** 换 lane 时怎么造那条 lane 的宿主。测试用它注入一个假宿主；生产恒 `openLane`。 */
export type LaneOpener = (options: LaneWorkspaceOptions) => Promise<LaneHandle>;

const DEFAULT_LANE = 'main';

export async function openLaneWorkspace(
  options: LaneWorkspaceOptions,
  openOne: LaneOpener = async (next) => next.model
    ? (await import('./laneHost.mjs')).openLane({ ...next, model: next.model })
    : openLaneHistory(next),
): Promise<LaneWorkspaceHandle> {
  const inputs = createLaneInputAdmission();
  const listeners = new Set<(projection: LaneWorkspaceProjection) => void>();
  let closed = false;
  let structuralPending = 0;
  let laneChangePending = 0;
  let structure = Promise.resolve();
  let lanes: readonly LaneSummary[] = await readLanes();
  let selection = readLaneWorkspaceSelection(options.projectDir);
  const selected = lanes.find((lane) => lane.laneName === selection?.laneName && lane.sessionId === selection.sessionId);
  const explicit = options.laneName === undefined ? undefined : lanes.find((lane) => lane.laneName === options.laneName);
  if (options.laneName !== undefined && lanes.length && !explicit) {
    throw new Error('agent_lane_conversation_missing');
  }
  const initialLane = explicit?.laneName ?? selected?.laneName ?? lanes[0]?.laneName ?? options.laneName ?? DEFAULT_LANE;
  let active: LaneHandle = await openOne({ ...options, laneName: initialLane });
  try {
    rememberSelection();
    lanes = await readLanes();
  } catch (error) {
    await active.close();
    throw error;
  }
  let projection: LaneWorkspaceProjection = withSpend({ lanes, active: active.projection() });
  let unsubscribeActive = active.subscribe(() => publish());

  function rememberSelection(): void {
    if (selection?.laneName === active.laneName && selection.sessionId === active.sessionId) return;
    const next = { laneName: active.laneName, sessionId: active.sessionId };
    writeLaneWorkspaceSelection(options.projectDir, next);
    selection = next;
  }

  function withSpend(next: LaneWorkspaceProjection): LaneWorkspaceProjection {
    return options.spend ? { ...next, spend: options.spend() } : next;
  }

  function publish(): void {
    if (closed || structuralPending) return;
    projection = withSpend({ lanes, active: active.projection() });
    for (const listener of listeners) listener(projection);
  }

  function publishClosed(): void {
    if (projection.closed) return;
    closed = true;
    unsubscribeActive();
    const snapshot = active.projection();
    const parts = snapshot.parts.map((part) => {
      if (part.kind === 'tool-call') return { ...part, running: false };
      if (part.kind === 'assistant-text' && part.streaming) return { ...part, streaming: false, interrupted: true as const };
      if (part.kind === 'thinking') return { ...part, streaming: false };
      return part;
    });
    projection = {
      lanes,
      closed: true,
      active: {
        ...snapshot,
        parts,
        running: false,
        pending: undefined,
        awaitingDecisionToolCallIds: undefined,
        retry: undefined,
        queues: [],
      },
    };
    try {
      for (const listener of listeners) listener(projection);
    } finally {
      listeners.clear();
    }
  }

  function assertOpen(): void {
    if (closed) throw new Error('agent_lane_disposed');
  }

  async function settleStructure(): Promise<void> {
    for (let step = 0; structuralPending && !laneChangePending && step < 8; step += 1) {
      const awaited = structure;
      await awaited;
      if (structure === awaited) break;
    }
  }

  async function awaitReady(): Promise<void> {
    assertOpen();
    if (laneChangePending) throw new Error('agent_lane_workspace_stale');
    if (structuralPending) await settleStructure();
    assertOpen();
    if (laneChangePending) throw new Error('agent_lane_workspace_stale');
    if (structuralPending) throw new Error('agent_lane_opening');
  }

  function changeStructure(change: () => Promise<void>, changesLane = false): Promise<void> {
    if (closed) return Promise.reject(new Error('agent_lane_disposed'));
    structuralPending += 1;
    if (changesLane) laneChangePending += 1;
    const next = structure.then(async () => { assertOpen(); await change(); }).finally(() => {
      structuralPending -= 1;
      if (changesLane) laneChangePending -= 1;
      publish();
    });
    structure = next.catch(() => undefined);
    return next;
  }

  async function readLanes(): Promise<readonly LaneSummary[]> {
    const summaries = await listLaneSessions(options.projectDir);
    return summaries.map((summary) => ({
      laneName: summary.laneName,
      sessionId: summary.sessionId,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    }));
  }

  async function switchTo(laneName: string, nextOptions = options): Promise<void> {
    unsubscribeActive();
    try {
      await active.close();
      assertOpen();
      const opened = await openOne({ ...nextOptions, laneName });
      if (closed) { await opened.close(); assertOpen(); }
      active = opened;
      options = nextOptions;
      rememberSelection();
      unsubscribeActive = active.subscribe(() => publish());
    } catch (error) {
      publishClosed();
      await active.close();
      throw error;
    }
  }

  async function handleLaneCommand(command: Extract<LaneCommand, { laneName: string }>): Promise<void> {
    if (command.kind === 'lane-create') {
      if (lanes.some((lane) => lane.laneName === command.laneName)) {
        throw new Error('agent_lane_conversation_exists');
      }
      await switchTo(command.laneName);
      lanes = await readLanes();
      return;
    }
    if (command.kind === 'lane-select') {
      if (command.laneName === active.laneName) return;
      if (!lanes.some((lane) => lane.laneName === command.laneName)) {
        throw new Error('agent_lane_conversation_missing');
      }
      await switchTo(command.laneName);
      lanes = await readLanes();
      return;
    }
    if (command.laneName === active.laneName) {
      throw new Error('agent_lane_conversation_in_use');
    }
    if (!(await deleteLaneSession(options.projectDir, command.laneName))) {
      throw new Error('agent_lane_conversation_missing');
    }
    lanes = await readLanes();
  }

  let closing: Promise<void> | undefined;
  return {
    captureInputSignal: () => { assertOpen(); return inputs.capture(); },
    configureModel: (model) => changeStructure(async () => {
      if (active.projection().running) throw new Error('agent_lane_busy_running');
      await switchTo(active.laneName, { ...options, model });
      lanes = await readLanes();
    }),
    receiptAuthority: (proposalId) => closed || structuralPending ? undefined : active.receiptAuthority(proposalId),
    projection: () => projection,
    subscribe: (listener) => {
      assertOpen();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    execute: async (command: LaneCommand, executionOptions): Promise<LaneCommandOutcome> => {
      if (command.kind === 'lane-select' || command.kind === 'lane-create' || command.kind === 'lane-delete') {
        await changeStructure(() => handleLaneCommand(command), true);
        return {};
      }
      const expected = executionOptions?.expectedConversation;
      if (command.kind === 'abort') {
        if (expected && (expected.laneName !== active.laneName || expected.sessionId !== active.sessionId)) {
          throw new Error('agent_lane_workspace_stale');
        }
        inputs.cancel();
      }
      const admission = command.kind === 'prompt' || command.kind === 'steer' || command.kind === 'follow-up'
        ? inputs.capture(executionOptions?.admissionSignal)
        : undefined;
      if (admission) await awaitWithAbortSignal(awaitReady(), admission);
      else await awaitReady();
      if (expected && (expected.laneName !== active.laneName || expected.sessionId !== active.sessionId)) {
        throw new Error('agent_lane_workspace_stale');
      }
      admission?.throwIfAborted();
      const outcome = await active.execute(command, {
        ...executionOptions,
        ...(admission ? { admissionSignal: admission } : {}),
      });
      publish();
      return outcome;
    },
    appendTaskNote: async (note) => { await awaitReady(); await active.appendTaskNote(note); },
    refreshTasks: () => { if (!closed && !structuralPending) active.refreshTasks(); },
    refreshSpend: () => publish(),
    close: () => {
      if (closing) return closing;
      inputs.cancel();
      closing = Promise.resolve().then(async () => {
        await structure;
        await active.close();
      });
      publishClosed();
      return closing;
    },
  };
}
