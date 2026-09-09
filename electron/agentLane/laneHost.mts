import { attachLaneTrace } from './laneTraceRecorder.mjs';
import { capabilityContractById } from '../shared/agentCapabilities/registry.js';
import { modelToolCapabilityId } from '../shared/agentCapabilities/modelFacingTools.js';
import type { LaneComposerContext } from '../shared/agentLane/laneDesktopContracts.js';
import { LANE_CODING_TOOL_NAMES } from './laneCodingTools.mjs';
import { LANE_LEGACY_NOTE, LANE_LEGACY_TOOLS_NOTE, laneLegacyFacts } from '../shared/agentLane/laneLegacyNote.js';
import { findLaneReceiptAuthority } from './laneReceiptAuthority.mjs';
// Agent lane · 主进程宿主（**薄**）
//
// 它只做三件事，方案 §2.1 ⑤ 写死的那三件：
//   a. lane 生命周期（会话打开/关闭、项目 ↔ lane 映射）
//   b. 把 Nomi 的闸与两条上限（回合请求数、连续同一失败）挂到 pi 的 `before_tool` / `after_tool`
//   c. 把 Nomi 的领域记录以 `appendCustomEntry` 放进**同一条** transcript
//
// 它**不存转录 · 不排序 · 不重试 · 不算钱**——四条都是 pi 的活，这也是
// `docs/engineering/framework-boundaries.json` 把 `electron/agentLane/` 加进
// session-persistence / retry-policy / steering / ordered-transcript 四条 scope 的原因：
// 新目录里再出现自研版本，`check:framework-boundary` **当场报红**（R28）。
// 「不重试」说的是不写重试循环：`LANE_RETRY_POLICY` 是**配置**，退避、事件、状态全是 pi 的。
//
// 对照今天的宿主：`electron/projectAgentHost/` 是 52 个生产文件、9 688 行。
import { configureLaneContextBudget, laneCompactionSettings } from './laneContextBudget.mjs';
import { formatLaneModelIndex } from './laneModelContext.js';
import { convertToLlm } from '@earendil-works/pi-agent-core';
import { draftInputFromMessage, isLaneInputMessage } from '../shared/agentLane/laneInputMessage.js';
import type { LaneInputMessage } from '../shared/agentLane/laneDesktopContracts.js';
import { AgentHarness, reduceLaneSnapshot, type AgentLane, type LaneSnapshot } from '@earendil-works/pi-agent-core';
import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/pi-agent-core/harness/context';
import { createModels, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { createNomiProvider } from './laneModelProvider.mjs';
import {
  LANE_APPROVAL_NOTE_TYPE, LANE_TASK_NOTE_TYPE, LANE_UI_NOTE_PREFIX, laneNoteEntersModelContext,
  type LaneApprovalNote, type LaneCancelQueuedResult, type LaneCommand, type LaneCommandOutcome,
  type LaneHandle, type LanePendingApproval, type LaneProjection, type LaneThinkingLevel,
} from '../shared/agentLane/laneContracts.js';
import { createLaneApprovalGate } from './laneApprovalGate.js';
import type { OpenLane, OpenLaneOptions } from './laneRuntimePort.js';
import { composeLaneSystemPrompt } from './lanePromptSections.js';
import { loadPiSkillFormatter, renderLaneSkillSection } from './laneSkillIndex.mjs';
import { openLaneSession } from './laneSession.mjs';
import { createLaneTools } from './laneTools.mjs';
import { projectLaneSnapshot, type LaneModelFacts } from '../shared/agentLane/laneProjection.js';
import { openLaneNativeDesktop } from './laneNativeDesktop.mjs';
import { LANE_DEFERRED_TOOL_GROUPS } from './laneToolCatalog.js';
import { laneSkillUnlockReason } from './laneSkillIndex.mjs';
import { appendLaneContinuation, laneContinuationText } from './laneContinuation.mjs';

/** 阶段 1 的观测：pi 每个 delta 自报的 `contentIndex`，与我们从 content 数组下标推出来的那个。 */
export interface LaneOrderObservation {
  /** pi 说的（`AssistantMessageEvent.contentIndex`，探针报告 §5.1）。 */
  reported: number
  /** 该下标处那一段的类型，用来证明「我们数的和它说的是同一段」。 */
  partType: string
}

/**
 * 传输层看门狗的两个预算。**旧路 `run.mts` 用的是同样两个数**（90s / 120s），
 * 而它们在这里第一次对新通路生效——影子期的 lane 在供应商流卡住时会永远转圈
 * （方案 §0 的实核，G3c 的先红后绿就是这条）。
 */
export const LANE_FIRST_RESPONSE_MS = 90_000;
export const LANE_IDLE_MS = 120_000;

/**
 * 重试策略。**显式传，不吃默认值**——数值和 pi 的 `DEFAULT_RETRY_POLICY` 相同
 * （`harness/config.js:1`），但「相同」和「继承」是两件事：上游哪天改了默认值，
 * 我们的退避窗口会跟着变而没有任何一条测试会红。
 *
 * 3 次上限下最长退避 1+2+4 = 7s，所以上游那条「退避无上限」的 open issue
 * （[#8826](https://github.com/earendil-works/pi/issues/8826)）对我们无感。
 */
export const LANE_RETRY_POLICY = Object.freeze({ enabled: true, maxRetries: 3, baseDelayMs: 1_000 } as const);

/**
 * 一个回合最多几次模型请求。**唯一一层策略**（方案 §1.6 第六行）。
 *
 * 挂点是 `before_request`：harness 没有 `shouldStopAfterTurn`（那是老路
 * `createAgentSession` 的），它能停一个 run 的口子只有 `before_tool` 的 `block.terminate`、
 * `after_tool` 的 `terminate` 和 `requestAbort` 三个。所以这里数数、在 `before_tool` 拦。
 */
export const LANE_MAX_MODEL_REQUESTS = 24;

/**
 * 同一个工具连着撞同一堵墙几次就拦下来（Nomi 独有的那条规则）。
 *
 * 它在解决哪个真实摩擦：用户撞到过「连续 6 次被自己拒收」——模型收到一句它读不懂的
 * 错误，于是把一模一样的调用又发一遍，六次。上游没有这条规则（它假设错误正文足够
 * 可行动），我们两边都做：正文可行动（`laneToolContract`）**且**连续撞墙有上限。
 */
export const LANE_REPEATED_FAILURE_BLOCK = 3;
export const LANE_REPEATED_FAILURE_TERMINATE = 5;

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

const PART_TYPE_BY_EVENT: Readonly<Record<string, string>> = {
  text_start: 'text', text_delta: 'text', text_end: 'text',
  thinking_start: 'thinking', thinking_delta: 'thinking', thinking_end: 'thinking',
  toolcall_start: 'toolCall', toolcall_delta: 'toolCall', toolcall_end: 'toolCall',
};

export const openLane: OpenLane = async (options: OpenLaneOptions): Promise<LaneHandleWithObservations> => {
  const context: Context = BACKGROUND_CONTEXT;
  const laneName = options.laneName ?? 'main';
  const { session, sessionId, release } = await openLaneSession({ ...options, laneName }, context);
  let native: Awaited<ReturnType<typeof openLaneNativeDesktop>> | undefined;
  // 会话一旦打开，这个进程就是它**唯一**的持有者。装配到一半失败（模型配置写错、
  // 工具名重复、schema 门岗报红）而不交还持有权，用户下一次打开同一条历史会撞上
  // 「已经有人开着」——而那个人是一个早就失败退出的调用。
  try {
    return await assemble();
  } catch (cause) {
    try { await native?.close(); }
    finally {
      await session.close(context).catch(() => undefined);
      await release(context);
    }
    throw cause;
  }

  async function assemble(): Promise<LaneHandleWithObservations> {
  if (options.native) native = await openLaneNativeDesktop({ projectDir: options.projectDir,
    ...options.native, deferredGroups: LANE_DEFERRED_TOOL_GROUPS.map(group => ({ ...group,
      toolNames: group.toolNames.filter(name => options.tools.some(tool => tool.name === name)),
    })).filter(group => group.toolNames.length > 0),
    availableModels: () => snapshot.transcript.flatMap(entry => entry.type === 'message' && isLaneInputMessage(entry.message) ? [entry.message.context.availableModels ?? []] : []).at(-1) ?? [],
  });
  // 看门狗装在 provider 的流上，所以**每一次**模型请求都带着它——包括压缩与分支摘要那两次
  // （它们走 `streamSimple`，只用 `result()`）。装在别处就会漏掉那两条路，而它们卡住的样子
  // 和主请求卡住一模一样。
  const { provider, model, credentials, pricingBasis } = await createNomiProvider(options.model, options.fetch, {
    firstResponseMs: options.watchdog?.firstResponseMs ?? LANE_FIRST_RESPONSE_MS,
    idleMs: options.watchdog?.idleMs ?? LANE_IDLE_MS,
  });
  // 三行（花费/上下文/推理）需要的**模型侧事实**，在这里定死一次，投影层不再回头问任何人。
  // `contextWindow` 只收显式声明的那个：provider 内部的 128k 兜底是给 pi 的类型用的，不是分母。
  //
  // 推理档在**这一层**问 pi（`getSupportedThinkingLevels`），而不是在投影里问：判据还是 pi 那一把
  // 尺子，但这里是最后一个天然认识 pi 运行时的地方。再往下（`shared/agentLane/laneProjection`）
  // 是浏览器也 import 的中立层，在那里 import 一个 pi 的函数就等于把整个 SDK 拖进渲染 bundle。
  const modelFacts: LaneModelFacts = { pricing: pricingBasis,
    supportedThinkingLevels: getSupportedThinkingLevels(model) as readonly LaneThinkingLevel[],
    ...(options.model.contextWindow === undefined ? {} : { contextWindow: options.model.contextWindow }) };
  const models = createModels({ credentials });
  models.setProvider(provider);
  const tools = [...createLaneTools(options.tools), ...(native?.tools ?? [])];
  const activeToolNames = native?.activeToolNames() ?? tools.map((tool) => tool.name);
  // `Available tools` / `Guidelines` 两段由宿主拼，不靠调用方记得（G-03 的后一半）。
  // 2026-09-07 合并评审实核：`composeLaneSystemPrompt` 此前零生产调用者——通道②③写满了，
  // 一个字都到不了模型。拼接点放在这里，是因为这里是唯一知道「这条 lane 装了哪些工具」的地方。
  // 技能索引那一段用 pi 的 `formatSkillsForPrompt` 渲染（`laneSkillIndex.mts` 里一行渲染代码都没有）。
  // 没有技能时不去 import 那个包：一条 lane 不该为了拿一个空串付一次 ESM 解析。
  const skills = native?.skills ?? options.skills ?? [];
  const skillSection = skills.length > 0
    ? renderLaneSkillSection(await loadPiSkillFormatter(), skills)
    : '';
  const promptTools = [...options.tools, ...(native?.promptTools ?? [])];
  const systemPrompt = composeLaneSystemPrompt(options.systemPrompt, promptTools, skillSection);
  const { harness } = await AgentHarness.create<undefined>({
    session, models, model, systemPrompt, tools,
    compaction: laneCompactionSettings(model.contextWindow, options.limits?.contextTokenBudget),
    toProviderMessages: async (messages) => convertToLlm(await Promise.all(messages.map(async (message, index) => {
      // pi's AJV preparation failures are immediate results, before after_tool.
      // Enrich the model projection without revalidating or changing its recorded arguments.
      if (message.role === 'toolResult' && message.isError
        && message.content.some(part => part.type === 'text' && /additional properties/.test(part.text))) {
        const example = options.tools.find(tool => tool.name === message.toolName)?.examples[0];
        if (example) return { ...message, content: [...message.content,
          { type: 'text' as const, text: '应长这样：' + JSON.stringify(example.arguments) }] };
      }
      if (!isLaneInputMessage(message)) return message;
      if (!options.input) throw new Error('This lane cannot resolve its recorded input context.');
      const content = await options.input.providerContent(message, messages.slice(0, index).reverse().find(isLaneInputMessage)?.context);
      const reference = message.context.continueFromEntryId;
      return { role: 'user' as const, content: reference === undefined ? content
        : appendLaneContinuation(content, laneContinuationText(await session.getEntry(reference, context))),
      timestamp: message.timestamp };
    }))),
    activeToolNames: [...activeToolNames],
    toolExecution: 'sequential',
    // **一次只吃一句**（G-24）。pi 的默认是 `"all"`（`harness/runtime/harness.js:44-45`）：
    // 用户连打三句，下一次模型请求会把三句**一起**注入同一轮。在写码场景那是效率；
    // 在创作场景那是灾难——三条指令的效果搅在同一批改动里，用户看不出哪一句造成了哪一处，
    // 也没法单独撤销其中一句。`one-at-a-time` 让「一句话 → 一轮 → 一次可撤销的结果」
    // 成为结构事实。这是领域约束（可撤销的创作），不是排队口味。
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    retry: { ...LANE_RETRY_POLICY },
    entryProjectors: uiOnlyProjectors(LANE_APPROVAL_NOTE_TYPE, LANE_TASK_NOTE_TYPE),
  }, context);
  await configureLaneContextBudget({ harness, models, model, context, options });
  const lane: AgentLane = await harness.lane(laneName, context);
  // Constructor model only seeds new lanes; restored configuration still holds
  // the previous selection. Bind Nomi's explicit selection through the public
  // API while retaining pi's persisted active tools (including addedToolNames).
  // Same-model opens are read-only: a redundant commit changes list ordering.
  const currentModel = await lane.getModel(context);
  if (currentModel?.provider !== model.provider || currentModel?.id !== model.id) {
    await lane.setModel({ provider: model.provider, modelId: model.id }, context);
  }
  const legacySource = (await lane.findEntries({ type: 'custom', customType: LANE_LEGACY_NOTE, limit: 1 }, context))[0];
  if (legacySource?.type === 'custom' && laneLegacyFacts(legacySource.data)
    && !(await lane.findEntries({ type: 'custom', customType: LANE_LEGACY_TOOLS_NOTE, limit: 1 }, context)).length) {
    // Import seeds no tools. Initialize only once through the public API; later
    // opens must retain the user's selected group and pi's addedToolNames.
    await lane.setActiveTools([...activeToolNames], context);
    await lane.appendCustomEntry(LANE_LEGACY_TOOLS_NOTE, { version: 1 }, context);
  }
  // Upgrade old menus once, preserving explicit coding access before schemas become resident.
  if (native) {
    const resident = native.activeToolNames();
    const restored = await lane.getActiveTools(context);
    native.bindActiveTools(lane);
    if (resident.some(name => !restored.includes(name)) && LANE_CODING_TOOL_NAMES.every(name => restored.includes(name))) {
      await native.unlockCoding(context);
    }
    if (resident.some(name => !restored.includes(name))) {
      await lane.setActiveTools([...resident, ...restored.filter(name => !resident.includes(name))], context);
    }
  }

  // 投影先立起来，闸才挂得上去：「它在等你」这一段**不在 pi 的快照里**（停在预检里的
  // 调用不在 `runningTools`，`operation.status` 只会写 `open`——探针 §2.1），所以它由
  // 宿主自己维护，和快照一起被 `publish()` 摊平成同一份 `LaneProjection`。
  const watch = await lane.watch(context);
  let snapshot: LaneSnapshot = watch.snapshot;
  let pending: LanePendingApproval | undefined;
  let projection: LaneProjection = projectLaneSnapshot(snapshot, modelFacts, pending, options.tasks);
  const listeners = new Set<(next: LaneProjection) => void>();
  const publish = () => {
    projection = projectLaneSnapshot(snapshot, modelFacts, pending, options.tasks);
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
        resolveSubject: (request) => native?.resolveApprovalSubject(request) ?? approval.resolveSubject?.(request),
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
  const directlyApplied = new Set<string>();
  const maxModelRequests = options.limits?.maxModelRequests ?? LANE_MAX_MODEL_REQUESTS;
  // 计数按 **run** 走，不按 lane 走：上限说的是「这一轮」，一条 lane 活一整天。
  const requests = { runId: '', count: 0 };
  // 连续撞墙：一个 key + 一个计数。**连续**的定义就写在这两行里——换了 key 或者成功一次，
  // 计数归零。累计次数不在这里算，那是另一个问题（「这个工具总在坏」是审计的活，不是拦截的活）。
  const failures = { key: '', count: 0 };

  harness.hooks.on('before_request', (event) => {
    if (event.step !== 'assistant') return undefined;
    // 重试不消耗预算：`attempt` 在重试时递增，同一步会带着 2、3、4 再来一次。
    // 把重试算进步数，等于让一次网络抖动吃掉用户的回合。
    if (event.attempt !== 1) return undefined;
    if (requests.runId !== event.runId) { requests.runId = event.runId; requests.count = 0; }
    requests.count += 1;
    return undefined;
  });

  harness.hooks.on('before_payload', (event) => options.input
    ? { payload: options.input.rewritePayload(event.payload, event.model.api) } : undefined);

  let consumedContext: LaneComposerContext | undefined;
  harness.hooks.on('transform_context', async (event) => {
    const input = [...event.messages].reverse().find(isLaneInputMessage);
    consumedContext = input?.context;
    if (input && options.input) options.input.activate(input.context);
    const catalogBase = event.messages.find(isLaneInputMessage);
    const authority = gate ? tools.filter(tool => options.tools.some(spec => spec.name === tool.name))
      .flatMap(tool => {
        const operation = (tool.parameters as unknown as { properties?: Record<string, { enum?: unknown[] }> }).properties?.operation;
        const operations = operation?.enum?.filter((value): value is string => typeof value === 'string') ?? [undefined];
        return operations.map(value => `- ${tool.name}${value ? `.${value}` : ''}: ${gate.describe({
          toolCallId: '', toolName: tool.name, args: value ? { operation: value } : {},
        })}`);
      }).join('\n') : '';
    return { systemPrompt: [systemPrompt, catalogBase ? formatLaneModelIndex(catalogBase.context) : '', input?.context.systemPrompt, authority].filter(Boolean).join('\n\n') };
  });

  harness.hooks.on('before_tool', async (event, hookContext) => {
    // ① 回合上限。**模型看到的是一句人话，不是一个 `step-limit` 错误码**——它还有机会
    // 用这一步把结论说出来，而错误码只会让这一轮以「失败」收场，尽管活已经干了大半。
    if (requests.count >= maxModelRequests) {
      return { block: { terminate: true, reason:
        `This turn has reached its ${maxModelRequests}-model-request limit, so no further tool call will run. `
        + 'State your conclusion and what is still undone, in text, now.' } };
    }
    // Destructive actions require their own surface, even with approval. Reversible
    // workflows may intentionally cross surfaces (e.g. planning a storyboard from a document).
    // Use the consumed input (also on replay), not capture(): that may be a queued draft.
    const spec = options.tools.find(tool => tool.name === event.toolName);
    const contract = spec ? capabilityContractById(modelToolCapabilityId(spec, event.args)) : undefined;
    if (options.input && contract?.effect === 'destructive' && contract.execution.availability === 'renderer_required'
      && consumedContext?.target?.kind !== contract.targetKind) {
      return { block: { reason: `surface_authority_denied: This action requires the ${contract.targetKind} surface. `
        + 'Ask the user to switch to that surface and send the action again; approval cannot grant another surface.' } };
    }
    const accessDenial = await native?.toolAccessDenial(event.toolName);
    if (accessDenial) return { block: { reason: accessDenial } };
    await options.toolLifecycle?.prepare(event, hookContext.abortSignal ?? new AbortController().signal);
    // ② 闸。上限先判：到了上限就没有「问用户要不要放行」这回事了。
    if (gate) {
      const outcome = await gate.preflight(
        { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args },
        hookContext.abortSignal,
      );
      if (outcome.allow && outcome.decision === 'auto-granted' && outcome.undoable) directlyApplied.add(event.toolCallId);
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
      // **放行的那一支不 return**：它要继续走 ③ 那条「连续撞同一堵墙」的判断。
      if (!outcome.allow) {
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
      }
    }
    // ③ 连续撞同一堵墙。判在闸之后：被闸拒收不是工具坏了，那条路有自己的文案。
    if (failures.count >= LANE_REPEATED_FAILURE_BLOCK && failures.key.startsWith(`${event.toolName} `)) {
      const terminate = failures.count >= LANE_REPEATED_FAILURE_TERMINATE;
      return { block: { ...(terminate ? { terminate: true } : {}), reason:
        `${event.toolName} has failed the same way ${failures.count} times in a row. `
        + 'Do not send it again. Either take a different route — a different tool, a narrower scope, '
        + 'values re-read from the current state — or tell the user plainly that this cannot be done.' } };
    }
    await options.toolLifecycle?.approved(event, async (type, data) => {
      await lane.appendCustomEntry(type, data, hookContext);
    });
    return undefined;
  });

  harness.hooks.on('after_tool', (event) => {
    options.toolLifecycle?.settled(event);
    const appliedDirectly = directlyApplied.delete(event.toolCallId);
    // 「同一个失败」按**工具名 + 失败正文首行**认。为什么是首行：`renderLaneToolFailure`
    // 把 `code` 留给了 UI 分档、没写进正文（那是刻意的，`[error] E_DENIED` 对模型等于没说），
    // 而首行正是那句「哪里错、期望什么」——同一堵墙每次都给同一句。
    const body = event.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
    const key = event.isError ? `${event.toolName} ${body.split('\n', 1)[0]}` : '';
    // 「连续」的定义就在这一行：任何一条别的结果——成功了，或者换了一堵墙——都把计数清掉。
    if (key !== failures.key) { failures.key = key; failures.count = key ? 1 : 0; }
    else if (key) failures.count += 1;
    return appliedDirectly && !event.isError
      ? { content: [...event.content, { type: 'text', text: '\nApplied directly (undoable)' }] } : undefined;
  });

  function inputMessage(text: string): string | LaneInputMessage {
    if (!options.input) return text;
    const captured = structuredClone(options.input.capture());
    // Validate the actual selected branch before pi persists or acknowledges any input.
    // An older stopped card on this branch remains selectable; IDs from other lanes do not.
    if (captured.continueFromEntryId !== undefined) {
      laneContinuationText(snapshot.transcript.find((entry) => entry.id === captured.continueFromEntryId));
    }
    return { role: 'nomi.input', content: text, timestamp: Date.now(), context: captured };
  }

  const trace = attachLaneTrace({ harness, session, pricing: pricingBasis,
    model: { provider: options.model.providerId, model: options.model.modelId },
    secrets: [options.model.apiKey ?? '', ...Object.values(options.model.headers ?? {})] });
  await trace.refresh().catch(() => undefined);

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
    receiptAuthority: (proposalId) => findLaneReceiptAuthority(snapshot, proposalId),
    projection: () => projection,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    orderObservations: () => observations,
    // 领域侧记一张任务卡。**只写引用**（`LaneTaskNote` 就两个 id），会动的数字每次投影时
    // 现去领域读——写进转录的那一刻它就冻住了，而任务还在跑。
    appendTaskNote: async (note) => {
      await lane.appendCustomEntry(LANE_TASK_NOTE_TYPE, { ...note }, context);
    },
    // 领域说它那边的任务变了。转录一个字没动，卡却该换个样子——这正是「引用而不复制」
    // 想要的效果，代价就是需要有人来说这一句。
    refreshTasks: () => publish(),
    execute: async (command: LaneCommand, executionOptions): Promise<LaneCommandOutcome> => {
      if (command.kind === 'prompt' && !projection.running && !pending) {
        const message = inputMessage(command.text);
        const unlock = typeof message !== 'string' ? laneSkillUnlockReason(skills, [message.context.skillKey ?? '']) : null;
        if (native && unlock) {
          await native.unlockCoding(context);
        }
        // pi's public admission boundary persists the input before acknowledging the composer.
        // The same accepted operation then drives to settlement for every caller, including tests.
        const request = typeof message === 'string'
          ? { kind: 'prompt' as const, prompt: message } : { kind: 'prompt' as const, prompt: message };
        const admission = await lane.accept(request, context);
        if (!admission.ok) throw new Error(admission.error._tag);
        executionOptions?.onAccepted?.();
        const result = await lane.drive({ operationId: admission.value.operationId, waitForRetry: true }, context);
        await trace.flush();
        if (!result.ok) throw new Error(result.error._tag);
        return {};
      }
      // 插话两条。**回值带 pi 铸的 `entryId`**：没有它，用户点「撤回」时面板只能靠
      // 「队里最后那条」去猜，而队列随时会被消费——猜出来的那条可能是别人的话。
      if (command.kind === 'steer' || command.kind === 'follow-up' || command.kind === 'prompt') {
        const steering = command.kind !== 'follow-up';
        const queued = steering
          ? await lane.steer(inputMessage(command.text), undefined, context)
          : await lane.followUp(inputMessage(command.text), undefined, context);
        // 错误只报 `_tag`（`Closed` / `InvalidMessage`），不报 `message`：那句话是 pi 写给
        // 开发者的，直接弹给用户等于把内部词表当文案用。人话在调用方按 `_tag` 选。
        if (!queued.ok) throw new Error(`This agent lane refused the message: ${queued.error._tag}`);
        // Persist steering first: settling the card can immediately resume the drive.
        if (steering) {
          while (gate?.pending()) gate.answer(gate.pending()!.toolCallId, 'deny', 'The user interrupted this unapproved action. It did not run; follow the new user message.');
        }
        executionOptions?.onAccepted?.();
        return { queuedEntryId: queued.value.entryId };
      }
      // 撤回一条排队的话。**三态原样交出去**，不折成一个布尔：`already_consumed`
      // （刚被吃进去了）和 `cancelled`（没送出去）在用户那里是两件相反的事。
      if (command.kind === 'cancel-queued') {
        const queued = snapshot.queues.find((item) => item.entryId === command.entryId && item.kind !== 'write');
        const cancelled = await lane.cancelQueued(command.entryId, context);
        if (!cancelled.ok) throw new Error(`This agent lane could not cancel that message: ${cancelled.error._tag}`);
        return { cancelQueued: cancelled.value.kind as LaneCancelQueuedResult,
          ...(cancelled.value.kind === 'cancelled' && queued?.type === 'message'
            ? { restoredInput: [draftInputFromMessage(queued.message)] } : {}) };
      }
      // lane 的增删切在 `laneWorkspace` 那一层：它才知道这个项目里还有哪些对话。
      // 一条 lane 的宿主对隔壁一无所知，**这是它该有的样子**——知道了就会长出第二个所有者。
      if (command.kind === 'lane-select' || command.kind === 'lane-create' || command.kind === 'lane-delete') {
        throw new Error(`A single agent lane cannot handle ${command.kind}; that command belongs to the workspace`);
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
      await trace.refresh().catch(() => undefined);
      // pi returns both unconsumed queues with their original nomi.input context.
      const restoredInput = aborted.ok ? [...aborted.value.steer, ...aborted.value.followUp].map(draftInputFromMessage) : [];
      return restoredInput.length > 0 ? { restoredInput } : {};
    },
    close: () => closing ??= (async () => {
      // 关窗 / 切项目：等待中的卡以 `cancelled{cause:'window-closed'}` 收尾，**记录先落盘**。
      // 顺序反过来就没得写了——`harness.close()` 之后这条 lane 再也 append 不进任何东西，
      // 用户重开这条对话会看到一个永远停在「在等你」的幽灵。
      try {
        if (snapshot.operation !== null || gate?.pending()) {
          gate?.cancelAll('window-closed');
          await lane.abort(context).catch(() => undefined);
          await flushApprovalNotes();
        }
      } finally {
        stopObserving();
        watch.unsubscribe();
        listeners.clear();
        try { await trace.close(); await harness.close(context); }
        finally {
          try { await native?.close(); }
          // The repository is shared by project; return this handle's ownership even after cleanup failure.
          finally { await release(context); }
        }
      }
    })(),
  };
  }
};
