import { createLaneInputAdmission } from './laneInputAdmission.mjs';
import { originalLaneEntry, precedingLaneInput, resolveLaneReplay, laneOriginalText } from './laneOriginalInput.mjs';
import { laneInputIntent } from './laneInputIntent.mjs';
import { openLaneHistoryPage } from './laneHistoryPage.mjs';
import { attachLaneTrace } from './laneTraceRecorder.mjs';
import { logWarn } from '../logging/logger.js';
import { capabilityContractById } from '../shared/agentCapabilities/registry.js';
import { modelToolCapabilityId } from '../shared/agentCapabilities/modelFacingTools.js';
import type { LaneComposerContext } from '../shared/agentLane/laneDesktopContracts.js';
import { LANE_CODING_TOOL_NAMES } from './laneCodingTools.mjs';
import { LANE_LEGACY_NOTE, LANE_LEGACY_TOOLS_NOTE, laneLegacyFacts } from '../shared/agentLane/laneLegacyNote.js';
import { findLaneReceiptAuthority } from './laneReceiptAuthority.mjs';
import { createLaneRepeatedFailureTracker } from './laneRepeatedFailure.mjs';
import { ASK_USER_VERB_NAME } from '../shared/agentCapabilities/askUser.js';
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
import { director3dBoxProof } from '../shared/featureFlags/director3dbox.js';
import { configureLaneContextBudget, laneCompactionSettings } from './laneContextBudget.mjs';
import { formatLaneModelIndex } from './laneModelContext.js';
import { convertToLlm } from '@earendil-works/pi-agent-core';
import { draftInputFromMessage, isLaneInputMessage } from '../shared/agentLane/laneInputMessage.js';
import type { LaneInputMessage } from '../shared/agentLane/laneDesktopContracts.js';
import { AgentHarness, reduceLaneSnapshot, type AgentLane, type LaneSnapshot } from '@earendil-works/pi-agent-core';
import { BACKGROUND_CONTEXT, awaitWithContext, type Context } from '@earendil-works/pi-agent-core/harness/context';
import { createModels, getSupportedThinkingLevels, isContextOverflow, isRetryableAssistantError } from '@earendil-works/pi-ai';
import { createNomiProvider } from './laneModelProvider.mjs';
import { LANE_STREAM_WATCHDOG } from './laneProviderGuard.mjs';
import { omitSupersededReads } from './laneSupersededReads.mjs';
import {
  LANE_APPROVAL_NOTE_TYPE, LANE_TASK_NOTE_TYPE, LANE_UI_NOTE_PREFIX, laneNoteEntersModelContext,
  type LaneApprovalNote, type LaneCancelQueuedResult, type LaneCommand, type LaneCommandOutcome,
  type LaneHandle, type LanePendingApproval, type LaneProjection, type LaneSkillIndexEntry, type LaneThinkingLevel,
} from '../shared/agentLane/laneContracts.js';
import { createLaneApprovalGate } from './laneApprovalGate.js';
import type { OpenLane, OpenLaneOptions } from './laneRuntimePort.js';
import { composeLaneSystemPrompt, laneSceneUnavailableNotice } from './lanePromptSections.js';
import { loadPiSkillFormatter, renderLaneSkillSection, laneSkillUnlockReason } from './laneSkillCatalog.mjs';
import { openLaneSession } from './laneSession.mjs';
import { createLaneTools, takeLaneToolFailure } from './laneTools.mjs';
import { projectLaneSnapshot, type LaneModelFacts } from '../shared/agentLane/laneProjection.js';
// 本机能力（bash / 沙箱 / pi-coding-agent 的工具）只在真开一条带模型的 lane 时才装：静态引入会把 pi-coding-agent
// 整个入口（约 1500 个文件，主进程同步装载）拖进「打开项目」那条只读历史的路径（2026-10-06 L-perf 实测）。
// 与 laneCodingTools / laneSkillCatalog 的按需加载同一个做法。tests/agent-runtime/lane-open-graph.test.mts 钉住。
type LaneNativeDesktop = Awaited<ReturnType<typeof import('./laneNativeDesktop.mjs').openLaneNativeDesktop>>;
const loadLaneNativeDesktop = () => import('./laneNativeDesktop.mjs');
import { LANE_DEFERRED_TOOL_GROUPS } from './laneToolCatalog.js';
import { createLaneSceneTools } from './laneToolGroups.mjs';
import type { LaneToolScene } from '../shared/agentCapabilities/verbDeclaration.js';
import { appendLaneContinuation, laneContinuationText } from './laneContinuation.mjs';

// Bootstrap proof is intentionally read before the pi runtime is assembled.
export const DIRECTOR_3DBOX_BOOTSTRAP_PROOF = director3dBoxProof();

/** 阶段 1 的观测：pi 每个 delta 自报的 `contentIndex`，与我们从 content 数组下标推出来的那个。 */
export interface LaneOrderObservation {
  /** pi 说的（`AssistantMessageEvent.contentIndex`，探针报告 §5.1）。 */
  reported: number
  /** 该下标处那一段的类型，用来证明「我们数的和它说的是同一段」。 */
  partType: string
}

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
 * 一个回合的模型请求数上限。**缺省不设**（2026-09-18 用户拍板：「不要给什么次数限制」）。
 *
 * 为什么原来有一个 24、又为什么去掉它：
 * 数总次数来拦人，恰恰是本仓自己否掉的做法——`laneRepeatedFailure.mts` 的注释原话是
 * 「累计次数不在这里算——『这个工具总在坏』是审计的活，**不是拦截的活**」。而 24 这个数干的正是那件事。
 *
 * 真正的危险各有各的守卫，一个都不靠这个数：
 *   · 模型卡在循环里重发同一个调用 → `laneRepeatedFailure`（同工具同错误连撞 3 次拦、5 次终止，
 *     用户再说一句话即清零）。它 3 次就拦住了，轮不到 24。
 *   · 上下文撑爆 → `laneContextBudget` 的自动压缩（8 万 token 预算）。
 *   · 花钱失控 → 报价卡，每次提交由用户点头。
 * 所以 24 不保护任何具体的东西，它只在一种情况下生效：**活是真的多**——而那恰恰是不该拦的时候。
 * 单位也不对：24 次 `look_at_canvas` 一分钱不花，24 次生成是真金白银，而后者本来就被报价卡挡着。
 * 用「次数」当刹车，量的是干活的多少，不是危险的大小。
 *
 * 机制留着（`options.limits.maxModelRequests` 仍然生效，拦法与措辞一字未动）：
 * 评测要跑「撞上限会怎样」，宿主也可能有自己的理由设一个。缺省 = 不设。
 */
export const LANE_MAX_MODEL_REQUESTS: number | undefined = undefined;

// 「同一个工具连着撞同一堵墙」的规则住 laneRepeatedFailure.mts（含用户新消息即清零）。
export { LANE_REPEATED_FAILURE_BLOCK, LANE_REPEATED_FAILURE_TERMINATE } from './laneRepeatedFailure.mjs';

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
  const inputs = createLaneInputAdmission(context);
  const laneName = options.laneName ?? 'main';
  const { session, sessionId, release } = await openLaneSession({ ...options, laneName }, context);
  let native: LaneNativeDesktop | undefined;
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
  if (options.native) native = await (await loadLaneNativeDesktop()).openLaneNativeDesktop({ projectDir: options.projectDir,
    ...options.native, deferredGroups: LANE_DEFERRED_TOOL_GROUPS.map(group => ({ ...group,
      toolNames: group.toolNames.filter(name => options.tools.some(tool => tool.name === name)),
    })).filter(group => group.toolNames.length > 0),
    availableModels: () => snapshot.transcript.flatMap(entry => entry.type === 'message' && isLaneInputMessage(entry.message) ? [entry.message.context.availableModels ?? []] : []).at(-1) ?? [],
    modelAvailability: options.modelAvailability,
  });
  // 看门狗装在 provider 的流上，所以**每一次**模型请求都带着它——包括压缩与分支摘要那两次
  // （它们走 `streamSimple`，只用 `result()`）。装在别处就会漏掉那两条路，而它们卡住的样子
  // 和主请求卡住一模一样。
  const { provider, model, credentials, pricingBasis } = await createNomiProvider(options.model, options.fetch, {
    // 三个预算的唯一一份在 `laneProviderGuard.mts`（`LANE_STREAM_WATCHDOG`），这里只允许宿主逐项覆盖。
    firstResponseMs: options.watchdog?.firstResponseMs ?? LANE_STREAM_WATCHDOG.firstResponseMs,
    firstTokenMs: options.watchdog?.firstTokenMs ?? LANE_STREAM_WATCHDOG.firstTokenMs,
    idleMs: options.watchdog?.idleMs ?? LANE_STREAM_WATCHDOG.idleMs,
  });
  // 三行（花费/上下文/推理）需要的**模型侧事实**，在这里定死一次，投影层不再回头问任何人。
  // `contextWindow` 只收显式声明的那个：provider 内部的 128k 兜底是给 pi 的类型用的，不是分母。
  //
  // 推理档在**这一层**问 pi（`getSupportedThinkingLevels`），而不是在投影里问：判据还是 pi 那一把
  // 尺子，但这里是最后一个天然认识 pi 运行时的地方。再往下（`shared/agentLane/laneProjection`）
  // 是浏览器也 import 的中立层，在那里 import 一个 pi 的函数就等于把整个 SDK 拖进渲染 bundle。
  const modelFacts: LaneModelFacts = { pricing: pricingBasis,
    supportedThinkingLevels: getSupportedThinkingLevels(model) as readonly LaneThinkingLevel[],
    isTransientError: isRetryableAssistantError,
    // 「上下文装不下」同样只问 pi 那一张表（各家溢出原话），投影把结论变成 `fault`（NF-0928-0003）。
    isContextOverflow: (message) => isContextOverflow(message, options.model.contextWindow),
    ...(options.model.contextWindow === undefined ? {} : { contextWindow: options.model.contextWindow }) };
  const models = createModels({ credentials });
  models.setProvider(provider);
  // 闸的结论交给工具执行上下文：回执要说「用户此刻看到什么」，就不能查静态表（T-ED-02）。
  // `gate` 在下面才建，这里给的是一个到执行时才求值的读法，不是快照。
  const tools = [...createLaneTools(options.tools, (toolCallId) => gate?.decisionFor(toolCallId),
      (toolCallId) => gate?.answerFor(toolCallId)),
    ...(native?.tools ?? [])];
  // The native menu is a visibility catalogue, while desktop surface assembly
  // owns the executable descriptors. Keep only names that are actually
  // registered in this process; otherwise pi rejects the whole turn with
  // `configured_tools_unavailable` before it can reach the provider.
  const registeredToolNames = new Set(tools.map((tool) => tool.name));
  // 工具定义也是请求输入的一部分（每次请求都带）；估一次，从预算里先扣掉。
  // Every descriptor assembled by the desktop surface is resident for this
  // lane. The native menu may contain projected aliases, but only registered
  // descriptors can be handed to the harness.
  // Scene tools (`residentScene`) stay registered so pi can still run them, but join the active list only
  // while the user stands in that scene (switched per admission by `scenes.sync`).
  const scenes = createLaneSceneTools(options.tools);
  const activeToolNames = scenes.initialActive(registeredToolNames);
  // `Available tools` / `Guidelines` 两段由宿主拼，不靠调用方记得（G-03 的后一半）。
  // 2026-09-07 合并评审实核：`composeLaneSystemPrompt` 此前零生产调用者——通道②③写满了，
  // 一个字都到不了模型。拼接点放在这里，是因为这里是唯一知道「这条 lane 装了哪些工具」的地方。
  // 技能索引那一段用 pi 的 `formatSkillsForPrompt` 渲染（`laneSkillCatalog.mts` 里一行渲染代码都没有）。
  //
  // 索引有两种来源，寿命不同：
  //   · 桌面原生（`native.skillIndex`）**是活的**——每个回合重扫一次技能库，用户中途导入的技能
  //     下一个回合就在索引里，而且 `read` 同时被允许读它（同一份快照，见 `laneSkillCatalog.mts`）。
  //   · `options.skills` 是影子夹具/单测那条路：调用方自己给一份定死的索引，本来就不会变。
  // 没有技能时不去 import 那个包：一条 lane 不该为了拿一个空串付一次 ESM 解析。
  const staticSkills = options.skills ?? [];
  const staticSection = !native && staticSkills.length > 0
    ? renderLaneSkillSection(await loadPiSkillFormatter(), staticSkills)
    : '';
  const currentSkills = (): readonly LaneSkillIndexEntry[] => native?.skillIndex.current().entries ?? staticSkills;
  const promptTools = [...options.tools, ...(native?.promptTools ?? [])];
  const composeSystemPrompt = (): string => {
    const hidden = scenes.hidden();
    const identity = typeof options.systemPrompt === 'function' ? options.systemPrompt() : options.systemPrompt;
    return composeLaneSystemPrompt(
      hidden.length > 0 ? [identity.trimEnd(), laneSceneUnavailableNotice(hidden)].join('\n\n') : identity,
      promptTools.filter(tool => !hidden.includes(tool.name)), native?.skillIndex.current().promptSection ?? staticSection);
  };
  /**
   * **一条 lane 的系统提示词，每个回合整体重新求值一次；回合内不变。**
   *
   * 这是这一层唯一的「什么时候求值」规则，替掉了此前「哪个字段自己记得刷新」的逐字段约定：
   *   · 回合内不变——正在跑的那一个回合不会中途改口（技能、界面语言、项目记忆一视同仁）。
   *     用户在模型说到一半时切了语言，这一轮说完再改，而不是一句中文一句英文。
   *   · 每个回合都变——会变的事实由**来源**提供（函数 / `LaneSkillIndexSource`），
   *     不是开 lane 那一刻的闭包常量；以后再加一个会变的段落，不必再发明一条刷新路径。
   *
   * 粒度是回合不是请求：一个回合最多 `LANE_MAX_MODEL_REQUESTS` 次模型请求，按请求刷等于
   * 把技能库全量重扫乘 24，而且回合内会改口——那恰恰是评审裁决明确不要的行为。
   */
  const composeClosing = (): string => typeof options.systemPromptClosing === 'function' ? options.systemPromptClosing() : options.systemPromptClosing ?? '';
  let promptRunId: string | undefined;
  let promptSceneKey = '';
  let promptForRun = composeSystemPrompt();
  let closingForRun = composeClosing();
  const systemPromptForRun = async (runId: string): Promise<string> => {
    // 回合内不变的唯一例外：运行中进出场景时，「本轮不可用」交代要与清单同步（只重拼，不刷新技能索引）。
    const sceneKey = scenes.hidden().join(',');
    if (runId === promptRunId) {
      if (sceneKey !== promptSceneKey) { promptSceneKey = sceneKey; promptForRun = composeSystemPrompt(); }
      return promptForRun;
    }
    promptRunId = runId;
    promptSceneKey = sceneKey;
    await native?.skillIndex.refresh();
    promptForRun = composeSystemPrompt();
    closingForRun = composeClosing();
    return promptForRun;
  };
  const systemPrompt = promptForRun;
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
      const source = message.context.continueFromEntryId && message.context.retryFromEntryId
        ? await session.getEntry(message.context.retryFromEntryId, context) : undefined;
      const originalText = source ? laneOriginalText(source) : undefined;
      const providerInput = originalText ? { ...message, content: message.content + '\n\nOriginal task to continue:\n' + originalText } : message;
      const content = await options.input.providerContent(providerInput, messages.slice(0, index).reverse().find(isLaneInputMessage)?.context);
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
    const resident = native.activeToolNames().filter((name) => registeredToolNames.has(name));
    const restored = await lane.getActiveTools(context);
    native.bindActiveTools(lane);
    if (resident.some(name => !restored.includes(name)) && LANE_CODING_TOOL_NAMES.every(name => restored.includes(name))) {
      await native.unlockCoding(context);
    }
    if (resident.some(name => !restored.includes(name))) {
      await lane.setActiveTools([...resident, ...restored.filter(name => !resident.includes(name))], context);
    }
  }

  await scenes.sync(lane, [], context);

  // 投影先立起来，闸才挂得上去：「它在等你」这一段**不在 pi 的快照里**（停在预检里的
  // 调用不在 `runningTools`，`operation.status` 只会写 `open`——探针 §2.1），所以它由
  // 宿主自己维护，和快照一起被 `publish()` 摊平成同一份 `LaneProjection`。
  const watch = await lane.watch(context);
  let snapshot: LaneSnapshot = watch.snapshot;
  const history = await openLaneHistoryPage(session, laneName, context, snapshot.tipId);
  let pending: LanePendingApproval | undefined;
  // 沙箱状态**整条 lane 只测一次**（`openLaneNativeDesktop` 开 lane 那一刻），所以它不是
  // 快照的函数，也不该进 `projectLaneSnapshot` 的参数表——那个纯函数的入参每多一个，
  // 「这次投影为什么和上次不一样」的可能来源就多一个。这里摊进去，投影层一个字都不用改。
  const sandboxFacts = native?.sandboxInactive ? { sandboxInactive: native.sandboxInactive.code } : {};
  let projection: LaneProjection = { ...projectLaneSnapshot(snapshot, modelFacts, pending, options.tasks, history.entries(), history.previousInputId(), options.attachments), history: history.state(), ...sandboxFacts };
  const listeners = new Set<(next: LaneProjection) => void>();
  const publish = () => {
    projection = { ...projectLaneSnapshot(snapshot, modelFacts, pending, options.tasks, history.entries(), history.previousInputId(), options.attachments), history: history.state(), ...sandboxFacts };
    for (const listener of listeners) listener(projection);
  };
  watch.start(async (event, eventContext) => {
    if (reduceLaneSnapshot(snapshot, event) === 'rebase') {
      // pi buffers and serializes events until this listener installs the returned snapshot.
      snapshot = await watch.resnapshot(eventContext);
      await history.reset(snapshot.tipId);
    } else if (event.type === 'entry_added') {
      history.append(event.entry);
    }
    publish();
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
  // 缺省不设上限时这一支整条不参与：不计数、不拦截，逐字节等同于没有这个机制。
  // 计数按 **run** 走，不按 lane 走：上限说的是「这一轮」，一条 lane 活一整天。
  const requests = { runId: '', count: 0 };
  const failures = createLaneRepeatedFailureTracker();

  if (maxModelRequests !== undefined) {
    harness.hooks.on('before_request', (event) => {
      if (event.step !== 'assistant') return undefined;
      // 重试不消耗预算：`attempt` 在重试时递增，同一步会带着 2、3、4 再来一次。
      // 把重试算进步数，等于让一次网络抖动吃掉用户的回合。
      if (event.attempt !== 1) return undefined;
      if (requests.runId !== event.runId) { requests.runId = event.runId; requests.count = 0; }
      requests.count += 1;
      return undefined;
    });
  }

  harness.hooks.on('before_payload', (event) => options.input
    ? { payload: options.input.rewritePayload(event.payload, event.model.api) } : undefined);

  let consumedContext: LaneComposerContext | undefined;
  harness.hooks.on('transform_context', async (event, hookContext) => {
    const { quote, input, catalogInput } = await laneInputIntent(session, laneName, event.runId, event.messages, hookContext);
    consumedContext = input?.context;
    if (input && options.input) options.input.activate(input.context);
    const hiddenScene = scenes.hidden();
    const authority = gate ? tools.filter(tool => options.tools.some(spec => spec.name === tool.name) && !hiddenScene.includes(tool.name))
      .flatMap(tool => {
        const operation = (tool.parameters as unknown as { properties?: Record<string, { enum?: unknown[] }> }).properties?.operation;
        const operations = operation?.enum?.filter((value): value is string => typeof value === 'string') ?? [undefined];
        return operations.map(value => `- ${tool.name}${value ? `.${value}` : ''}: ${gate.describe({
          toolCallId: '', toolName: tool.name, args: value ? { operation: value } : {},
        })}`);
      }).join('\n') : '';
    const systemPrompt = [await systemPromptForRun(event.runId), catalogInput ? formatLaneModelIndex(catalogInput.context, options.modelDefaults?.()) : '', input?.context.systemPrompt, input?.context.skillPrompt, quote, authority, closingForRun].filter(Boolean).join('\n\n');
    // 被后来的读取取代了的旧快照不再随每次请求重发（NF-0928-0003，理由在 `laneSupersededReads.mts`）。只改发出去的这一份。
    return { systemPrompt, messages: omitSupersededReads(event.messages, options.tools) };
  });

  harness.hooks.on('before_tool', async (event, hookContext) => {
    // ① 回合上限。**模型看到的是一句人话，不是一个 `step-limit` 错误码**——它还有机会
    // 用这一步把结论说出来，而错误码只会让这一轮以「失败」收场，尽管活已经干了大半。
    if (maxModelRequests !== undefined && requests.count >= maxModelRequests) {
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
      && consumedContext?.admissionSurface !== contract.targetKind) {
      return { block: { reason: `surface_authority_denied: This action requires the ${contract.targetKind} surface. `
        + 'Ask the user to switch to that surface and send the action again; approval cannot grant another surface.' } };
    }
    const accessDenial = await native?.toolAccessDenial(event.toolName);
    if (accessDenial) return { block: { reason: accessDenial } };
    await options.toolLifecycle?.prepare(event, hookContext.abortSignal ?? new AbortController().signal);
    // ② 闸。上限先判：到了上限就没有「问用户要不要放行」这回事了。
    if (gate) {
      // 撞满 3 次之后模型改去问用户：那张卡上要多一句**我们自己**说的话
      // （「试了 3 次还是不对，所以来问你」）。它只传一个码 + 一个数，文案在渲染层 i18n——
      // 生产者传成句的字符串就绕过了翻译，英文用户会读到中文（`askUser.ts` 的
      // `askUserHostReasonSchema`）。模型填不出这个字段，也不该填得出：能自己声称
      // 「这是第 3 次了」就是给它一个伪造理由的字段。
      const exhausted = event.toolName === ASK_USER_VERB_NAME ? failures.exhausted() : undefined;
      const askArgs = exhausted && event.args && typeof event.args === 'object' && !Array.isArray(event.args)
        ? { ...event.args as Record<string, unknown>, askReason: { code: 'retry_exhausted', attempts: exhausted.attempts } }
        : event.args;
      const outcome = await gate.preflight(
        { toolCallId: event.toolCallId, toolName: event.toolName, args: askArgs },
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
    const wall = failures.block(event.toolName);
    if (wall) return { block: { ...(wall.terminate ? { terminate: true } : {}), reason: wall.reason } };
    const preflightSignal = hookContext.abortSignal ?? new AbortController().signal;
    await options.toolLifecycle?.approved(event, async (type, data) => {
      await lane.appendCustomEntry(type, data, hookContext);
    }, {
      signal: preflightSignal,
      canAskUser: Boolean(gate) && approval?.hasUserInterface === true,
      // 等待的 owner 是闸：端口只说「替我等这一次」。没装闸的夹具没有人可等——当场以「被停下」收尾。
      waitForUser: () => gate
        ? { outcome: gate.hold({ toolCallId: event.toolCallId, toolName: event.toolName }, preflightSignal),
            settle: (outcome) => gate.settleHold(event.toolCallId, outcome) }
        : { outcome: Promise.resolve({ kind: 'cancelled' as const, cause: 'stopped' as const }), settle: () => false },
    });
    return undefined;
  });

  harness.hooks.on('after_tool', (event) => {
    options.toolLifecycle?.settled(event);
    // 回执已经写完了，这条结论没有第二个读者。留着就是让一条活一整天的 lane 慢慢长表。
    gate?.forget(event.toolCallId);
    const appliedDirectly = directlyApplied.delete(event.toolCallId);
    const body = event.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
    // 信封在计数**之前**取走：撞满之后要转成一次提问，而那张卡上的选项就是这份 `allowed`
    // （见 `laneRepeatedFailure.mts` 的 `exhausted()`）。让模型自己回忆拒收信里写了哪几个值，
    // 是在赌它——而它已经连着错了三次的正是这件事。
    const failure = event.isError ? takeLaneToolFailure(event.toolCallId) : undefined;
    // 墙按**语义码 + 出错字段**认，不按正文首行（正文里有 id、镜头数、字段值，同一堵墙每次都不一样）。
    const consecutive = failures.note(event.toolName, event.isError, body, failure);
    // 工具失败要在**主进程日志**里留一行（2026-09-17）。此前整条失败链只有 lane 自己的会话 JSONL
    // 记得住：真机复现 `surface_port_stale` 那一轮，`read_script` 连挂 3 次、会话里 12 处命中，
    // 而 `logs/nomi-<date>.log` 一共 9 行、**一个字都没提这件事**。排查的人打开日志看到的是「什么都没发生」。
    // 只记工具名、首行和连续次数：正文可能带用户文稿，绝不整条落盘。
    if (event.isError) {
      logWarn('agent', 'lane-tool-failed', {
        tool: event.toolName,
        firstLine: body.split('\n', 1)[0].slice(0, 200),
        consecutive,
      });
    }
    // C5：失败的结构化信封挂回 `details`，让面板按 `code` 查 i18n 词条，而不是去正则
    // 那段英文散文（中文界面上印出 `... (surface_port_stale). Next: …` 的就是它）。
    // 走 pi 自己的 `after_tool` result.details，和成功那条路的 `details.nextAction` 同形。
    // `details` 是**整体替换**（`harness/agent-harness.d.ts:576`），所以必须带上原有的那份。
    const details = failure
      ? { ...(event.details && typeof event.details === 'object' && !Array.isArray(event.details)
          ? event.details as Record<string, unknown> : {}), failure }
      : undefined;
    if (appliedDirectly && !event.isError) {
      return { content: [...event.content, { type: 'text', text: '\nApplied directly (undoable)' }] };
    }
    return details ? { details: details as never } : undefined;
  });

  let admissionScenes: readonly LaneToolScene[] = [];

  /** 用户消息进 lane 的唯一入口（prompt / steer / follow-up）：按本条消息的 admission 同步场景工具，下一次模型请求生效。 */
  async function inputMessage(text: string, ctx: Context): Promise<string | LaneInputMessage> {
    const message = await buildInputMessage(text);
    await awaitWithContext(scenes.sync(lane, admissionScenes, ctx), ctx);
    return message;
  }

  async function buildInputMessage(text: string): Promise<string | LaneInputMessage> {
    admissionScenes = [];
    if (!options.input) return text;
    const captured = structuredClone(options.input.capture());
    admissionScenes = captured.directorOpen === true ? ['director'] : [];
    const { restoredIntent, ...currentAdmission } = captured;
    if (restoredIntent && (captured.continueFromEntryId || captured.retryFromEntryId)) throw new Error('agent_lane_invalid_command');
    let message: LaneInputMessage;
    if (captured.continueFromEntryId) {
      const stopped = await originalLaneEntry(lane, captured.continueFromEntryId, context);
      laneContinuationText(stopped);
      const original = await precedingLaneInput(lane, stopped.parentId, context);
      if (!original) throw new Error('agent_lane_input_reference_invalid');
      message = await resolveLaneReplay(lane, original, captured, text, context);
    } else if (captured.retryFromEntryId) {
      message = await resolveLaneReplay(lane, await originalLaneEntry(lane, captured.retryFromEntryId, context), captured, text, context);
    } else {
      // The surface that may run destructive verbs is always **this** admission's own target.
      // Whatever the envelope carried is destructured away first — a submitted value, and the
      // restored draft's historical one, are both discarded — and the key only reappears when
      // this admission actually holds a target. No target = no surface authority (fail-closed).
      const { admissionSurface: _submitted, ...intent } = { ...currentAdmission, ...restoredIntent };
      message = { role: 'nomi.input', content: text, timestamp: Date.now(),
        context: { ...intent, ...(captured.target ? { admissionSurface: captured.target.kind } : {}) } };
    }
    if (message.context.continueFromEntryId) laneContinuationText(await originalLaneEntry(lane, message.context.continueFromEntryId, context));
    if (options.input.prepare) message.context = await options.input.prepare(message.context);
    return message;
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
    // 失败要留一行：吞掉它的后果是这条对话永远停在「在跑」，用户之后打的每一句都安静地排在后面。
    void lane.resume(context).then(flushApprovalNotes).catch((error: unknown) => {
      logWarn('agent', 'lane-resume-failed', { lane: laneName }, error);
    });
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
      if (command.kind === 'abort') inputs.cancel();
      const admission = inputs.capture(executionOptions?.admissionSignal);
      if (command.kind === 'history-older') { await history.older(command.before); publish(); return {}; }
      if (command.kind === 'prompt' && !projection.running && !pending) {
        const message = await awaitWithContext(inputMessage(command.text, admission), admission);
        // 「这条技能要不要 coding 工具」判在准入这一刻，而用户可能就是刚导入它的——
        // 所以先把索引刷到这个回合，再问。不刷的症状是模型说「我去跑它的 selftest」，然后说它没有工具。
        await awaitWithContext(Promise.resolve(native?.skillIndex.refresh()), admission);
        const unlock = typeof message !== 'string' ? laneSkillUnlockReason(currentSkills(), [message.context.skillKey ?? '']) : null;
        if (native && unlock) {
          await native.unlockCoding(admission);
          admission.abortSignal?.throwIfAborted();
        }
        // pi's public admission boundary persists the input before acknowledging the composer.
        // The same accepted operation then drives to settlement for every caller, including tests.
        const request = typeof message === 'string'
          ? { kind: 'prompt' as const, prompt: message } : { kind: 'prompt' as const, prompt: message };
        // 用户又开口了：连续撞墙的计数归零（用户动作即解除熔断）。
        failures.reset();
        admission.abortSignal?.throwIfAborted();
        const accepted = await lane.accept(request, admission);
        if (!accepted.ok) throw new Error(accepted.error._tag);
        executionOptions?.onAccepted?.();
        const result = await lane.drive({ operationId: accepted.value.operationId, waitForRetry: true }, context);
        await trace.flush();
        if (!result.ok) throw new Error(result.error._tag);
        return {};
      }
      // 插话两条。**回值带 pi 铸的 `entryId`**：没有它，用户点「撤回」时面板只能靠
      // 「队里最后那条」去猜，而队列随时会被消费——猜出来的那条可能是别人的话。
      if (command.kind === 'steer' || command.kind === 'follow-up' || command.kind === 'prompt') {
        // ── 有一道闸在等人时，用户在 composer 里打的这句话 = **对这道闸的回答**（2026-09-22 裁决 E）──
        //
        // 提问卡待答 → 这句话**就是那道题的答案**：走 `answer`（落成 `decision: 'answered'`，面板印「已回答 · 原话」），
        // 它一字不改成为那次 `ask_user` 的 tool result，回合在同一轮里继续。**不再另排一条插话**——
        // 同一句话既当答案又当新消息，模型会读到两遍。
        // 此前这里对提问卡也走 deny：话送到了，但面板上那一行读作「✕ 已拒绝」——用户明明刚回答了一个问题
        // （`tests/ux/agent-gate-typing-answers.walk.mjs` 的第一张截图就是它）。
        const question = gate?.pending();
        if (gate && question?.toolName === ASK_USER_VERB_NAME && command.text.trim()
          && gate.answer(question.toolCallId, 'answer', command.text)) {
          failures.reset();
          executionOptions?.onAccepted?.();
          return {};
        }
        // 报价卡待答（闸替那张画在别处的卡等着）→ 这句话同样是对它的回答：这一次出价收回，那句话一字不改
        // 成为 `generate` 的结果，回合在同一轮里照它继续。不另排插话，理由同上。
        const held = gate?.holding();
        if (gate && held && command.text.trim()
          && gate.settleHold(held.toolCallId, { kind: 'redirected', text: command.text.trim() })) {
          failures.reset();
          executionOptions?.onAccepted?.();
          return {};
        }
        // 「排在这一轮之后」在有卡等人的时候是一句空话：这一轮不等他答就永远结束不了，
        // 于是那条 follow-up 会安静地排在一张他以为已经答过的卡后面（裁决 E：绝不允许石沉大海）。
        // 所以只要有闸在等，两种手势同义——都是「先别做那件事，听我这句」。
        const steering = command.kind !== 'follow-up' || Boolean(gate?.pending());
        failures.reset();
        const message = await awaitWithContext(inputMessage(command.text, admission), admission);
        admission.abortSignal?.throwIfAborted();
        const queued = steering
          ? await lane.steer(message, undefined, admission)
          : await lane.followUp(message, undefined, admission);
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
        if (!gate) throw new Error('agent_lane_approval_missing');
        // 答的不是当前那张卡（用户点得慢、卡已经翻篇了）——**抛**，不静默吞掉。
        // 吞掉的后果是面板上那张卡一直转，而没有任何东西再来兑现它。
        if (!gate.answer(command.toolCallId, command.action, command.reason)) {
          throw new Error('agent_lane_approval_missing');
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
      inputs.cancel();
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
