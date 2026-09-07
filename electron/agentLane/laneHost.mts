// Agent lane · 主进程宿主（**薄**）
//
// 它只做三件事，方案 §2.1 ⑤ 写死的那三件：
//   a. lane 生命周期（会话打开/关闭、项目 ↔ lane 映射）
//   b. 把 Nomi 的闸挂到 pi 的 `before_tool` 钩子
//   c. 把 Nomi 的领域记录以 `appendCustomEntry` 放进**同一条** transcript
//
// 它**不存转录 · 不排序 · 不重试 · 不算钱**——四条都是 pi 的活，这也是
// `docs/engineering/framework-boundaries.json` 把 `electron/agentLane/` 加进
// session-persistence / retry-policy / steering / ordered-transcript 四条 scope 的原因：
// 新目录里再出现自研版本，`check:framework-boundary` **当场报红**（R28）。
//
// 对照今天的宿主：`electron/projectAgentHost/` 是 52 个生产文件、9 688 行。
import { AgentHarness, reduceLaneSnapshot, type AgentLane, type LaneSnapshot } from '@earendil-works/pi-agent-core';
import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/pi-agent-core/harness/context';
import { createModels } from '@earendil-works/pi-ai';
import { createNomiProvider } from '../harness/runtime/pi/model.mjs';
import { LANE_APPROVAL_NOTE_TYPE, type LaneApprovalNote, type LaneCommand, type LaneHandle, type LaneProjection }
  from '../shared/agentLane/laneContracts.js';
import type { OpenLane, OpenLaneOptions } from './laneRuntimePort.js';
import { openLaneSession } from './laneSession.mjs';
import { createLaneTools } from './laneTools.mjs';
import { projectLaneSnapshot } from './laneProjection.mjs';

/** 阶段 1 的观测：pi 每个 delta 自报的 `contentIndex`，与我们从 content 数组下标推出来的那个。 */
export interface LaneOrderObservation {
  /** pi 说的（`AssistantMessageEvent.contentIndex`，探针报告 §5.1）。 */
  reported: number
  /** 该下标处那一段的类型，用来证明「我们数的和它说的是同一段」。 */
  partType: string
}

export interface LaneHandleWithObservations extends LaneHandle {
  /**
   * 为什么要留这个：`lane.watch()` **故意剥掉** `message_update` 的 `event` 字段
   * （`LaneWatchSourceEvent` 里写着 `Omit<…, "event">`），所以想看 `contentIndex`
   * 必须走 `harness.events.on()`。这里把两条流对上，证明投影里的 `contentIndex`
   * 是 pi 说的那个、不是我们数出来的巧合——顺序只有一个来源（不变量 I1）。
   */
  orderObservations(): readonly LaneOrderObservation[]
}

const PART_TYPE_BY_EVENT: Readonly<Record<string, string>> = {
  text_start: 'text', text_delta: 'text', text_end: 'text',
  thinking_start: 'thinking', thinking_delta: 'thinking', thinking_end: 'thinking',
  toolcall_start: 'toolCall', toolcall_delta: 'toolCall', toolcall_end: 'toolCall',
};

export const openLane: OpenLane = async (options: OpenLaneOptions): Promise<LaneHandleWithObservations> => {
  const context: Context = BACKGROUND_CONTEXT;
  const laneName = options.laneName ?? 'main';
  const { session, sessionId, release } = await openLaneSession(options, context);
  // 会话一旦打开，这个进程就是它**唯一**的持有者。装配到一半失败（模型配置写错、
  // 工具名重复、schema 门岗报红）而不交还持有权，用户下一次打开同一条历史会撞上
  // 「已经有人开着」——而那个人是一个早就失败退出的调用。
  try {
    return await assemble();
  } catch (cause) {
    await session.close(context).catch(() => undefined);
    await release(context);
    throw cause;
  }

  async function assemble(): Promise<LaneHandleWithObservations> {
  const { provider, model, credentials } = await createNomiProvider(options.model);
  const models = createModels({ credentials });
  models.setProvider(provider);
  const tools = createLaneTools(options.tools);
  const { harness } = await AgentHarness.create<undefined>({
    session, models, model, systemPrompt: options.systemPrompt, tools,
    activeToolNames: tools.map((tool) => tool.name),
    toolExecution: 'sequential',
    entryProjectors: {
      // 审批记录**不投给模型**：拒收的理由 pi 已经一字不改地做成了那次调用的 tool result
      // （探针 §4.2 臂 B），再投一遍就是同一句话说两遍、占两份上下文。留着这个注册点是因为
      // 阶段 3 的任务卡/失败卡要走同一个口子，那时它才真的需要投影。
      [LANE_APPROVAL_NOTE_TYPE]: () => undefined,
    },
  }, context);
  const lane: AgentLane = await harness.lane(laneName, context);

  const gate = options.gate;
  if (gate) {
    harness.hooks.on('before_tool', async (event, hookContext) => {
      const decision = await gate({ toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
      const note: LaneApprovalNote = {
        toolCallId: event.toolCallId, toolName: event.toolName,
        decision: decision.allow ? 'granted' : 'denied',
        ...(decision.allow ? {} : { reason: decision.reason }),
      };
      // 宿主领域记录骑在**同一条**转录上，按 `toolCallId` join，永不复制工具正文
      // （方案 §7 岔路 2 = B，2026-09-07 用户拍板）。
      await lane.appendCustomEntry(LANE_APPROVAL_NOTE_TYPE, { ...note }, hookContext);
      return decision.allow ? undefined : { block: { reason: decision.reason } };
    });
  }

  const observations: LaneOrderObservation[] = [];
  const stopObserving = harness.events.on('message_update', (event) => {
    const inner = event.event;
    // `start` 是这个联合体里唯一没有 `contentIndex` 的成员（`pi-ai` types.d.ts:410），
    // 因为它说的是「这条消息开始了」而不是「哪一段」。表里查不到就跳过——不编一个 0。
    const partType = PART_TYPE_BY_EVENT[inner.type];
    if (partType === undefined || !('contentIndex' in inner)) return;
    observations.push({ reported: inner.contentIndex, partType });
  });

  const watch = await lane.watch(context);
  let snapshot: LaneSnapshot = watch.snapshot;
  let projection: LaneProjection = projectLaneSnapshot(snapshot);
  const listeners = new Set<(next: LaneProjection) => void>();
  const publish = () => {
    projection = projectLaneSnapshot(snapshot);
    for (const listener of listeners) listener(projection);
  };
  watch.start((event, eventContext) => {
    if (reduceLaneSnapshot(snapshot, event) !== 'rebase') {
      publish();
      return;
    }
    // 导航（切分支）之后局部归约不成立，pi 明说要一份新快照。照做，不猜。
    void watch.resnapshot(eventContext).then((fresh) => { snapshot = fresh; publish(); });
  });

  let closing: Promise<void> | undefined;
  return {
    laneName, sessionId,
    projection: () => projection,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    orderObservations: () => observations,
    execute: async (command: LaneCommand) => {
      if (command.kind === 'prompt') {
        await lane.prompt(command.text, undefined, context);
        return;
      }
      await lane.abort(context);
    },
    close: () => closing ??= (async () => {
      stopObserving();
      watch.unsubscribe();
      listeners.clear();
      await harness.close(context);
      // repo 是**按项目共享的**（`laneSession.mts`：pi 的单打开者名单只有一张才拦得住 #8852），
      // 所以这里交还持有权，而不是替别的 lane 把它关掉。
      await release(context);
    })(),
  };
  }
};
