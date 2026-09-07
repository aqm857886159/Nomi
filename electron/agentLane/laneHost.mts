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
import {
  LANE_APPROVAL_NOTE_TYPE, LANE_UI_NOTE_PREFIX, laneNoteEntersModelContext,
  type LaneApprovalNote, type LaneCommand, type LaneCommandOutcome, type LaneHandle,
  type LanePendingApproval, type LaneProjection,
} from '../shared/agentLane/laneContracts.js';
import { createLaneApprovalGate } from './laneApprovalGate.js';
import type { OpenLane, OpenLaneOptions } from './laneRuntimePort.js';
import { composeLaneSystemPrompt } from './lanePromptSections.js';
import { openLaneSession } from './laneSession.mjs';
import { createLaneTools } from './laneTools.mjs';
import { projectLaneSnapshot, type LaneModelFacts } from './laneProjection.mjs';

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

/**
 * 只给面板看的宿主记录 → 一张 projector 表，每一项都是 `() => undefined`。
 *
 * **为什么要显式注册一个什么都不投的 projector**：不注册也不会进模型上下文
 * （`harness/session/context.js:43-45` 查不到 projector 就跳过），但注册这一动作把
 * 「这一类不进模型」写成了代码里看得见的一行，而不是一个靠沉默维持的约定。
 * 名字本身就是判据（`nomi.ui.*` / `nomi.ctx.*`），所以这里顺手把它验一遍：
 * 有人把一个 `nomi.ctx.*` 塞进这张表，装配期就抛，而不是等到某天发现模型看不见它。
 */
function uiOnlyProjectors(...noteTypes: readonly string[]): Record<string, () => undefined> {
  const projectors: Record<string, () => undefined> = {};
  for (const noteType of noteTypes) {
    if (!noteType.startsWith(LANE_UI_NOTE_PREFIX) || laneNoteEntersModelContext(noteType)) {
      throw new Error(`${noteType} is not a UI-only lane note; it needs a real projector, not () => undefined`);
    }
    projectors[noteType] = () => undefined;
  }
  return projectors;
}

/**
 * 重开一条会话时**已经在飞、却没有结果**的工具调用。
 *
 * 「崩溃」不是 pi 词表里的一个 reason（`SuspendedRun.reason` 只有 `"deferred"`，那是供应商侧的
 * 异步响应）——它是重开时发现转录里有一个 toolCall 没有配对的 toolResult（方案 §1.5 的更正）。
 * 这份名单交给闸，它对这些调用一律 `cancelled{cause:'restart'}`：`resume()` 会对停在预检里的
 * 调用**再问一次** `before_tool`（探针 ③），放行就真的跑了——而那张卡用户从来没看见过。
 */
function interruptedToolCallIds(snapshot: LaneSnapshot): string[] {
  const called = new Set<string>();
  for (const entry of snapshot.transcript) {
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (message.role === 'assistant') {
      for (const part of message.content) if (part.type === 'toolCall') called.add(part.id);
      continue;
    }
    if (message.role === 'toolResult') called.delete(message.toolCallId);
  }
  return [...called];
}

/** `AbortResult.steer` 里那条消息的纯文本。拿不出文本的（图片等）不编一个占位串。 */
function textOfMessage(message: { role: string; content?: unknown }): string[] {
  if (!Array.isArray(message.content)) return typeof message.content === 'string' ? [message.content] : [];
  const text = message.content
    .filter((part): part is { type: 'text'; text: string } =>
      !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'text')
    .map((part) => part.text)
    .join('');
  return text ? [text] : [];
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
  const { provider, model, credentials, pricingBasis } = await createNomiProvider(options.model);
  // 三行（花费/上下文/推理）需要的**模型侧事实**，在这里定死一次，投影层不再回头问任何人。
  // `contextWindow` 只收显式声明的那个：provider 内部的 128k 兜底是给 pi 的类型用的，不是分母。
  const modelFacts: LaneModelFacts = { model, pricing: pricingBasis,
    ...(options.model.contextWindow === undefined ? {} : { contextWindow: options.model.contextWindow }) };
  const models = createModels({ credentials });
  models.setProvider(provider);
  const tools = createLaneTools(options.tools);
  // `Available tools` / `Guidelines` 两段由宿主拼，不靠调用方记得（G-03 的后一半）。
  // 2026-09-07 合并评审实核：`composeLaneSystemPrompt` 此前零生产调用者——通道②③写满了，
  // 一个字都到不了模型。拼接点放在这里，是因为这里是唯一知道「这条 lane 装了哪些工具」的地方。
  const systemPrompt = composeLaneSystemPrompt(options.systemPrompt, options.tools);
  const { harness } = await AgentHarness.create<undefined>({
    session, models, model, systemPrompt, tools,
    activeToolNames: tools.map((tool) => tool.name),
    toolExecution: 'sequential',
    entryProjectors: uiOnlyProjectors(LANE_APPROVAL_NOTE_TYPE),
  }, context);
  const lane: AgentLane = await harness.lane(laneName, context);

  // 投影先立起来，闸才挂得上去：「它在等你」这一段**不在 pi 的快照里**（停在预检里的
  // 调用不在 `runningTools`，`operation.status` 只会写 `open`——探针 §2.1），所以它由
  // 宿主自己维护，和快照一起被 `publish()` 摊平成同一份 `LaneProjection`。
  const watch = await lane.watch(context);
  let snapshot: LaneSnapshot = watch.snapshot;
  let pending: LanePendingApproval | undefined;
  let projection: LaneProjection = projectLaneSnapshot(snapshot, modelFacts, pending);
  const listeners = new Set<(next: LaneProjection) => void>();
  const publish = () => {
    projection = projectLaneSnapshot(snapshot, modelFacts, pending);
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

  const approval = options.approval;
  const gate = approval
    ? createLaneApprovalGate({
        specs: options.tools,
        hasUserInterface: approval.hasUserInterface,
        ...(approval.policy ? { policy: approval.policy } : {}),
        ...(approval.workMode ? { workMode: approval.workMode } : {}),
        // 重启后 pi 会对停在预检里的调用**再问一次** `before_tool`（探针 ③）。
        // 交给闸的这份名单是「重开这条会话时已经在飞、却没有结果」的调用——它们一律取消，
        // 不复活用户从没看见过的卡。名单从**转录本身**算，不靠一个「我在恢复」的布尔值：
        // 布尔值要有人记得关，而这份名单每消费一个就少一个。
        restoredToolCallIds: interruptedToolCallIds(watch.snapshot),
        onPendingChange: (next) => { pending = next; publish(); },
      })
    : undefined;
  if (gate) {
    harness.hooks.on('before_tool', async (event, hookContext) => {
      const outcome = await gate.preflight(
        { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args },
        hookContext.abortSignal,
      );
      // 宿主领域记录骑在**同一条**转录上，按 `toolCallId` join，永不复制工具正文
      // （方案 §7 岔路 2 = B，2026-09-07 用户拍板）。等待本身**不写**——它不是发生了的事。
      //
      // 被 **abort 打断**的取消是唯一不在这里写的那一支：abort 不是一个转录边界，
      // 钩子里追加的条目会悬在 `queues` 里（探针 §2.1）。它由 `drainNotes()` 在 abort 之后补。
      // 重启那一支没有 abort 在飞，照常在这里写。
      if (outcome.decision !== 'cancelled' || outcome.cause === 'restart') {
        const note: LaneApprovalNote = {
          toolCallId: event.toolCallId, toolName: event.toolName, decision: outcome.decision,
          ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
          ...(outcome.cause === undefined ? {} : { cause: outcome.cause }),
        };
        await lane.appendCustomEntry(LANE_APPROVAL_NOTE_TYPE, { ...note }, hookContext);
      }
      // 钩子的返回值（`before_tool` 的 result）只有两种形状：`undefined` = 放行，
      // `{ block: { reason } }` = 拦下，并把这句话变成模型看到的 tool result。
      // **永远不返回 `{ args }`**：改了参数，面板收据上写的和实际执行的就不是一回事，
      // 而用户是照着收据点的头。
      if (outcome.allow) return undefined;
      // **被 abort 打断的那一支返回 `undefined`**，让 pi 自己合成 `abortedOutcome`：
      // 返回一个 block 会把我们的理由印成模型看到的结果，而 pi 已经有一句更准确的
      // "Tool execution was cancelled before completion."（探针 ②，reject 那一臂的教训）。
      //
      // ⚠️ 只有**这条操作真的在中止**时才这样：`undefined` 在 pi 眼里是「放行」，
      // 它之所以变成一个取消结果，是因为 abort 已经在飞了。重启那一支没有 abort 在飞，
      // 同样写 `undefined` 就是把一次用户从没确认过的写入原样放过去（这条是实测出来的：
      // 第一版这么写，崩溃恢复的那条测试直接把文稿写了）。
      if (outcome.decision === 'cancelled' && outcome.cause !== 'restart') return undefined;
      return { block: { reason: outcome.reason ?? '' } };
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

  // 重开一条**没关干净**的会话（转录里有 toolCall 没有 toolResult）：让 pi 把那一轮接着跑完。
  // 不接着跑的后果不是安全，是这条对话永远停在半路——`operation` 一直开着，用户下一句话
  // 发不进去。接着跑之后，那次停在预检里的调用会被闸以 `cancelled{cause:'restart'}` 挡掉
  // （`interruptedToolCallIds`），模型读到「重启前没确认，已取消」，自己去告诉用户「再发一次」。
  //
  // **故意不 await**：`resume()` 会等一次真实的模型往返，而 `openLane()` 是打开一个面板的动作。
  // 进度通过 `watch` 照常流出去，和任何一轮没有区别。
  if (watch.snapshot.operation !== null) {
    void lane.resume(context).then(flushApprovalNotes).catch(() => undefined);
  }

  /**
   * 把闸攒下的 `cancelled` 记录补进转录。**只在 idle 路径上调**：abort 不是一个转录边界，
   * 钩子里追加的条目会悬在 `queues` 里，用户永远看不到（探针 §2.1）。
   */
  async function flushApprovalNotes(): Promise<void> {
    for (const note of gate?.drainNotes() ?? []) {
      await lane.appendCustomEntry(LANE_APPROVAL_NOTE_TYPE, { ...note }, context);
    }
  }

  let closing: Promise<void> | undefined;
  return {
    laneName, sessionId,
    projection: () => projection,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    orderObservations: () => observations,
    execute: async (command: LaneCommand): Promise<LaneCommandOutcome> => {
      if (command.kind === 'prompt') {
        await lane.prompt(command.text, undefined, context);
        return {};
      }
      if (command.kind === 'approval') {
        if (!gate) throw new Error('This agent lane has no approval gate');
        // 答的不是当前那张卡（用户点得慢、卡已经翻篇了）——**抛**，不静默吞掉。
        // 吞掉的后果是面板上那张卡一直转，而没有任何东西再来兑现它。
        if (!gate.answer(command.toolCallId, command.action, command.reason)) {
          throw new Error(`No approval is waiting for tool call ${command.toolCallId}`);
        }
        return {};
      }
      // 「停」= 整轮停。等待中的卡先各自收尾成 `cancelled`，再让 pi 打断这一轮：
      // 两件事的顺序不能反——先 abort 的那一版里，闸自己 race 出来的取消理由会和
      // `cancelAll` 的重复记一遍。
      gate?.cancelAll('stopped');
      const aborted = await lane.abort(context);
      await flushApprovalNotes();
      // 用户按停止的那一刻，他刚打进去还没送出的话不能丢（`AbortResult.steer`，
      // `lane.js:799-808`；TUI 的 `restoreQueuedMessagesToEditor` 就是这么做的）。
      const restoredInput = aborted.ok ? aborted.value.steer.flatMap(textOfMessage) : [];
      return restoredInput.length > 0 ? { restoredInput } : {};
    },
    close: () => closing ??= (async () => {
      // 关窗 / 切项目：等待中的卡以 `cancelled{cause:'window-closed'}` 收尾，**记录先落盘**。
      // 顺序反过来就没得写了——`harness.close()` 之后这条 lane 再也 append 不进任何东西，
      // 用户重开这条对话会看到一个永远停在「在等你」的幽灵。
      if (gate?.pending()) {
        gate.cancelAll('window-closed');
        await lane.abort(context).catch(() => undefined);
        await flushApprovalNotes();
      }
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
