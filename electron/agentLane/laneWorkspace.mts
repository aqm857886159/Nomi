// Agent lane · 一个项目的多条对话（方案 §2.2 G2「多线程 = 多 lane」）
//
// ── 它解决的真实摩擦（D1）──
// 今天一个项目只有一条 Agent 对话（`laneIpc.ts` 自陈「一个窗口一条」）。用户想一边让它
// 改第三场戏、一边另起一条问「这个片种一般怎么排」，就只能把两件事挤进同一条历史里——
// 于是上下文越滚越长、压缩把前面那件事的细节吃掉、模型开始把两件事搅在一起。
// 「多条对话」不是一个多窗口功能，它是**上下文隔离**：一条对话一件事。
//
// ── 为什么它是独立一层，而不是给 `laneHost` 加几个方法 ──
// `openLane()` 返回的那个 handle 按定义只认识**自己这一条**：它持有一条会话的写权、
// 一份快照、一个闸。让它同时知道「隔壁还有几条」，就等于给每条 lane 发一份全局视图——
// 而两条 lane 各自更新那份视图的那一刻，就有了第二个所有者。所以列表、切换、增删住这里，
// 转录、用量、审批住 `laneHost`，两边不重叠。
//
// ── 落盘长什么样（R29：全是 pi 自己的能力）──
// 一条对话 = 一条 pi 会话，住在 `<project>/.nomi/agent-sessions/--nomi-lane-<名字>--/` 下。
//   · 列表 = `JsonlSessionRepo.list()`（只读每个文件的表头，不读转录）
//   · 新建 = `repo.create({cwd})`
//   · 删除 = `repo.delete(metadata)`
// 四条命令里只有「切换」是我们的活，而它就是「关掉这条、打开那条」。**没有第二份对话索引**：
// 索引文件会和盘上的真相分叉（用户手动删掉一个会话文件之后，索引仍然说它在），表头不会。
// 项目只另存当前选择的 laneName/sessionId 指针；恢复时必须重新对上 pi 的真实会话列表。
import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/pi-agent-core/harness/context';

import type {
  LaneCommand, LaneCommandOutcome, LaneHandle, LaneSummary, LaneWorkspaceHandle, LaneWorkspaceProjection,
} from '../shared/agentLane/laneContracts.js';
import { openLaneHistory } from './laneHistory.mjs';
import { openLane } from './laneHost.mjs';
import { deleteLaneSession, listLaneSessions } from './laneSession.mjs';
import type { OpenLaneOptions } from './laneRuntimePort.js';
import { readLaneWorkspaceSelection, writeLaneWorkspaceSelection } from './laneWorkspaceSelection.js';

/** 打开一个项目的对话工作区。缺省恢复上次选择；只有没有会话的新项目才创建 `main`。 */
export type LaneWorkspaceOptions = Omit<OpenLaneOptions, 'sessionId' | 'model'> & { model?: OpenLaneOptions['model'] };

/** 换 lane 时怎么造那条 lane 的宿主。测试用它注入一个假宿主；生产恒 `openLane`。 */
export type LaneOpener = (options: LaneWorkspaceOptions) => Promise<LaneHandle>;

const DEFAULT_LANE = 'main';

export async function openLaneWorkspace(
  options: LaneWorkspaceOptions,
  openOne: LaneOpener = (next) => next.model ? openLane({ ...next, model: next.model }) : openLaneHistory(next),
): Promise<LaneWorkspaceHandle> {
  const context: Context = BACKGROUND_CONTEXT;
  const listeners = new Set<(projection: LaneWorkspaceProjection) => void>();
  let closed = false;
  let structuralPending = 0;
  // 其中**换掉了这条对话**的那些（新建/切换/删除）。换模型不算：它开的还是同一条对话。
  let laneChangePending = 0;
  let structure = Promise.resolve();
  let lanes: readonly LaneSummary[] = await readLanes();
  let selection = readLaneWorkspaceSelection(options.projectDir);
  const selected = lanes.find(lane => lane.laneName === selection?.laneName && lane.sessionId === selection.sessionId);
  const explicit = options.laneName === undefined ? undefined : lanes.find(lane => lane.laneName === options.laneName);
  if (options.laneName !== undefined && lanes.length && !explicit) {
    throw new Error('agent_lane_conversation_missing');
  }
  const initialLane = explicit?.laneName ?? selected?.laneName ?? lanes[0]?.laneName ?? options.laneName ?? DEFAULT_LANE;
  let active: LaneHandle = await openOne({ ...options, laneName: initialLane });
  try { rememberSelection(); lanes = await readLanes(); }
  catch (error) { await active.close(); throw error; }
  let projection: LaneWorkspaceProjection = { lanes, active: active.projection() };
  let unsubscribeActive = active.subscribe(() => publish());

  function rememberSelection(): void {
    if (selection?.laneName === active.laneName && selection.sessionId === active.sessionId) return;
    const next = { laneName: active.laneName, sessionId: active.sessionId };
    writeLaneWorkspaceSelection(options.projectDir, next);
    selection = next;
  }

  function publish(): void {
    if (closed || structuralPending) return;
    projection = { lanes, active: active.projection() };
    for (const listener of listeners) listener(projection);
  }

  function assertOpen(): void {
    if (closed) throw new Error('agent_lane_disposed');
  }

  /**
   * 等这一轮结构性变化（换模型 / 切对话 / 新建 / 删除）落定。
   *
   * 2026-09-11 用户真机截图的落点就在这里：以前 `assertReady()` 在 `structuralPending > 0` 时
   * **直接抛**，抛的还是一句英文散句，于是面板顶部糊出「The agent is opening a conversation.」。
   * 而这个窗口一点都不窄——`switchTo` 要关掉 pi 会话再开一条（读盘 + 载入转录），几百毫秒到
   * 几秒；用户在面板里挑完模型接着打字，正好撞在里面。
   *
   * 换模型这件事本身就是「我要用它发下一句」，所以正确的行为是**等它换完再发**，而不是让
   * 用户对着一条红字把那句话重打一遍。逐次等：`structure` 没再被换掉就说明没有后续；
   * 上限只防一条卡死的切换把命令永远挂住，真挂满了以 `agent_lane_opening` 收尾（有码可译）。
   */
  async function settleStructure(): Promise<void> {
    for (let step = 0; structuralPending && !laneChangePending && step < 8; step += 1) {
      const awaited = structure;
      await awaited;
      if (structure === awaited) break;
    }
  }

  async function awaitReady(): Promise<void> {
    assertOpen();
    // 换对话（新建/切换/删除）**不等**：等完再执行，用户那句话就落进了另一条对话里。
    // 它该以「对话已经换过了，重新发一次」收尾——这正是 `agent_lane_workspace_stale` 说的事。
    if (laneChangePending) throw new Error('agent_lane_workspace_stale');
    if (structuralPending) await settleStructure();
    assertOpen();
    if (laneChangePending) throw new Error('agent_lane_workspace_stale');
    if (structuralPending) throw new Error('agent_lane_opening');
  }

  // Only resource changes hold this queue. Model turns, approvals and abort never
  // enter it; commands during replacement fail before touching the closing handle.
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

  /**
   * 盘上有哪些对话。**每次结构性变化后重读，不维护一份内存副本**：内存副本要靠每条改动
   * 路径都记得同步，而漏掉的那一条不会报错——它只是让列表少一行，看起来像「那条对话没了」。
   */
  async function readLanes(): Promise<readonly LaneSummary[]> {
    const summaries = await listLaneSessions(options.projectDir, context);
    return summaries.map((summary) => ({
      laneName: summary.laneName, sessionId: summary.sessionId,
      createdAt: summary.createdAt, updatedAt: summary.updatedAt,
    }));
  }

  /**
   * 切到另一条对话：**先关掉这一条，再开那一条**。
   *
   * 顺序不能反，也不能两条同时开着。pi 的单打开者名单是按会话算的（#8852），两条不同会话
   * 同时开着虽然不写坏文件，但意味着用户看不见的那一条仍然在跑、在花钱——而他以为自己
   * 已经离开了。关掉这一条同时也让等待中的审批卡以 `window-closed` 收尾（`laneHost.close`），
   * 那正是「我切走了，那个动作不该背着我执行」的正确语义。
   */
  async function switchTo(laneName: string, nextOptions = options): Promise<void> {
    unsubscribeActive();
    try {
      await active.close();
      assertOpen();
      const opened = await openOne({ ...nextOptions, laneName });
      // close marks admission before waiting for this opener. Its late result
      // cannot become visible or retain a session owner after the window leaves.
      if (closed) { await opened.close(); assertOpen(); }
      active = opened;
      options = nextOptions;
      rememberSelection();
      unsubscribeActive = active.subscribe(() => publish());
    } catch (error) {
      // The previous handle has already been closed. It is not a usable fallback.
      closed = true;
      listeners.clear();
      await active.close();
      throw error;
    }
  }

  async function handleLaneCommand(command: Extract<LaneCommand, { laneName: string }>): Promise<void> {
    if (command.kind === 'lane-create') {
      // 同名已存在 → 抛。「新建」悄悄变成「打开一条有历史的对话」是最坏的那种默认值：
      // 用户以为自己在一张白纸上开始，而模型看得见上一件事的全部上下文。
      if (lanes.some((lane) => lane.laneName === command.laneName)) {
        throw new Error('agent_lane_conversation_exists');
      }
      await switchTo(command.laneName);
      lanes = await readLanes();
      return;
    }
    if (command.kind === 'lane-select') {
      if (command.laneName === active.laneName) return;
      // 不存在 → 抛，不静默新建：面板拿着一份过期列表点进一条已被删掉的对话时，
      // 静默新建会给他一条空白对话，而他以为那是自己昨天写的东西。
      if (!lanes.some((lane) => lane.laneName === command.laneName)) {
        throw new Error('agent_lane_conversation_missing');
      }
      await switchTo(command.laneName);
      lanes = await readLanes();
      return;
    }
    // 删除。当前这条不许删——删完就没有活着的对话了，而「工作区没有 active」这个状态
    // 下游一个消费者都没有。产品上的正确姿势是先切走再删，面板照这条来。
    if (command.laneName === active.laneName) {
      throw new Error('agent_lane_conversation_in_use');
    }
    if (!(await deleteLaneSession(options.projectDir, command.laneName, context))) {
      throw new Error('agent_lane_conversation_missing');
    }
    lanes = await readLanes();
  }

  let closing: Promise<void> | undefined;
  return {
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
      await awaitReady();
      const outcome = await active.execute(command, executionOptions);
      publish();
      return outcome;
    },
    appendTaskNote: async (note) => { await awaitReady(); await active.appendTaskNote(note); },
    refreshTasks: () => { if (!closed && !structuralPending) active.refreshTasks(); },
    close: () => {
      closed = true;
      unsubscribeActive();
      listeners.clear();
      return closing ??= (async () => {
        await structure;
        await active.close();
      })();
    },
  };
}
