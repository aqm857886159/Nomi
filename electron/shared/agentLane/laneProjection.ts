// Agent lane · `LaneSnapshot` → `LaneProjection`（纯函数，中立契约层）
//
// **它住在 `electron/shared/` 而不是 `electron/agentLane/`，因为它一个运行时依赖都没有。**
// 输入是 pi 的快照形状（`import type`，编译后一行不剩）、输出是本目录里那份中立契约，
// 中间只有算术和分支——没有 pi 的函数、没有 Electron、没有 Node。谁需要「这份快照画出来
// 长什么样」谁就能调它：主进程的 `laneHost`、设计实验室、以及阶段 4 之后的渲染层。
//
// 这不是搬家图省事，是把一条今天真的炸过的路堵死：投影早先 `import { getSupportedThinkingLevels }
// from '@earendil-works/pi-ai'`——一个**运行时**导入。设计实验室 import 它的那一刻，
// 整个 pi-ai（以及它内部那条 CJS 的 `partial-json`）就被拖进了浏览器 bundle，实验室页面
// 当场白屏，只能靠 `vite.config.ts` 的 `optimizeDeps` 兜一层（#614 的止血贴）。
// 档位表现在由**调用方**（认识 pi 的那一层）算好装进 `LaneModelFacts` 传进来，
// 于是这一层对 pi 只剩类型；止血贴随之删掉，`check:boundaries` 的 `src/devlab` 规则
// 负责保证没人再把主进程实现文件拉回浏览器（R28：能让门岗拦的别留给人）。
//
// **这一层唯一的职责是「走一遍，不重排」。** pi 的 transcript 已经有序（探针报告 §5.1：
// 一条助手消息里 thinking / text / toolCall 各占一个 `contentIndex`，顺序是落盘的），
// 所以这里做的事就是从头走到尾、顺手给每一段编号。编号（`sequence`）之后是下游唯一
// 认的顺序凭据——不变量 I1「顺序只有一个来源」。
//
// 对照今天：`agentPanelV4Projection.sortedItems()` 拿 `createdAt` 加数组下标排一遍，
// 是因为宿主那边的记录本来就没有可信顺序。那个 `sort` 在阶段 4 会被整个删掉。
import type { LaneSnapshot } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai';
import { draftInputFromMessage, isLaneInputMessage } from './laneInputMessage.js';
import type { NomiPricingBasis } from './laneModelConfig.js';
import { LANE_LEGACY_NOTE, LANE_LEGACY_COMPLETE_NOTE, LANE_LEGACY_TOOLS_NOTE, laneLegacyFacts } from './laneLegacyNote.js';
import {
  LANE_TASK_NOTE_TYPE, isLaneTaskNote,
  type LaneMetric, type LanePart, type LanePendingApproval, type LaneProjection,
  type LaneQueueKind, type LaneQueuedMessage, type LaneTaskFacts, type LaneThinking, type LaneThinkingLevel,
} from './laneContracts.js';

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type: 'text'; text: string } =>
      !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'text')
    .map((part) => part.text)
    .join('');
}

function pushAssistantParts(
  message: AssistantMessage, entrySeq: number, streaming: boolean,
  runningToolCallIds: ReadonlySet<string>, out: LanePart[], entryId?: string,
): void {
  message.content.forEach((part, contentIndex) => {
    const identity = { sequence: out.length, entrySeq, contentIndex };
    if (part.type === 'text') {
      out.push({ ...identity, kind: 'assistant-text', text: part.text, streaming,
        ...(message.stopReason === 'aborted' ? { interrupted: true as const,
          ...(entryId && part.text.trim() ? { continuationEntryId: entryId } : {}) } : {}) });
      return;
    }
    if (part.type === 'thinking') {
      out.push({ ...identity, kind: 'thinking', text: part.thinking, streaming });
      return;
    }
    if (part.type === 'toolCall') {
      out.push({ ...identity, kind: 'tool-call', toolCallId: part.id, toolName: part.name,
        args: part.arguments, running: runningToolCallIds.has(part.id) });
    }
  });
}

/**
 * 把一份 lane 快照摊成有序段。
 *
 * 没有排序、没有 join 第二真相、没有缓存正文——三条都是刻意的：
 * 排序会引入第二个顺序来源；join 会引入第二份真相；缓存正文就是今天
 * `residentToolProjection` 把工具正文写进 localStorage 的那条路（清浏览器存储 =
 * 历史收据静默清空）。
 */
export interface LaneModelFacts {
  /**
   * 这个模型真正可选的推理档，**由调用方喂 `getSupportedThinkingLevels(model)` 算好**
   * （`laneHost.mts` 那一行）。判据仍然只有 pi 那一把尺子——搬的是「谁去问它」，不是尺子本身：
   * 在这里调那个函数会把整个 pi-ai 运行时拖进每一个 import 本模块的地方（含浏览器）。
   * 长度 ≤ 1 就是「这个模型没有推理这回事」，与 pi 的 `thinkingLevelMap` 语义一致。
   */
  readonly supportedThinkingLevels: readonly LaneThinkingLevel[];
  /** 目录声明的计费三态。**不从 `model.cost` 反推**——那份全零同时长得像三件事。 */
  readonly pricing: NomiPricingBasis;
  /**
   * 上下文窗口。只收**显式声明**的那个：`createNomiProvider` 为了满足 pi 的类型给了 128k 兜底，
   * 拿它当分母会画出一个我们没量过的百分比（2026-09-06 打包版实测：真实目录里的对话模型
   * 一个都没写 contextWindow）。
   */
  readonly contextWindow?: number;
}

const KNOWN = (value: number): LaneMetric => ({ state: 'known', value });

/**
 * 上下文占用 + 推理 token，从**转录本身**取。
 *
 * 为什么不能用 `snapshot.stats.usage`：那是**会话累计**（`SessionStats.usage`），累加会随聊天
 * 次数一路涨到超过窗口；而且它在并的时候把 `reasoning` 丢掉了（pi `core/usage-totals.js`）。
 * 每条助手消息自己带着那次请求的 `usage`（`pi-ai` `AssistantMessage.usage`），走一遍转录就都有了。
 *
 * 「刚压缩完」的判据是**位置**不是内容：压缩条目出现在最后一条结算助手消息之后，就说明那条消息
 * 的 prompt 描述的是压缩前的上下文——数字还在，但它已经不回答「现在装了多少」这个问题了。
 */
function walkUsage(snapshot: LaneSnapshot): {
  lastPrompt?: number; compactedAfterLastTurn: boolean; reasoning?: number; sawSettledTurn: boolean;
} {
  let lastPrompt: number | undefined;
  let compactedAfterLastTurn = false;
  let reasoning: number | undefined;
  let sawSettledTurn = false;
  for (const entry of snapshot.transcript) {
    if (entry.type === 'compaction') { compactedAfterLastTurn = true; continue; }
    if (entry.type !== 'message' || entry.message.role !== 'assistant') continue;
    const usage: Usage = entry.message.usage;
    sawSettledTurn = true;
    compactedAfterLastTurn = false;
    // pi 自己对「输入」的定义就是这三列之和（`calculateCost` 第一行），照抄，不另立一份。
    lastPrompt = usage.input + usage.cacheRead + usage.cacheWrite;
    if (typeof usage.reasoning === 'number' && Number.isFinite(usage.reasoning)) {
      reasoning = (reasoning ?? 0) + usage.reasoning;
    }
  }
  return { ...(lastPrompt === undefined ? {} : { lastPrompt }), compactedAfterLastTurn,
    ...(reasoning === undefined ? {} : { reasoning }), sawSettledTurn };
}

function costMetric(snapshot: LaneSnapshot, pricing: NomiPricingBasis, sawSettledTurn: boolean): LaneMetric {
  if (pricing === 'free') return { state: 'not-applicable', reason: 'model-is-free' };
  if (pricing === 'unpriced') return { state: 'unknown', reason: 'model-has-no-pricing' };
  // 有价目、但一条回合都还没结算：那个 0 是「还没开始」，不是「花了 0 块」。
  if (!sawSettledTurn) return { state: 'unknown', reason: 'no-settled-turn' };
  const total = snapshot.stats.usage.cost?.total;
  return typeof total === 'number' && Number.isFinite(total)
    ? KNOWN(total) : { state: 'unknown', reason: 'no-settled-turn' };
}

function reasoningMetric(levels: readonly LaneThinkingLevel[], walk: ReturnType<typeof walkUsage>): LaneMetric {
  // 「这个模型有没有推理这回事」仍由 pi 判（`getSupportedThinkingLevels`），只是那一问
  // 发生在调用方那一层；我们不看名字也不另列一张档位表。
  if (levels.length <= 1) return { state: 'not-applicable', reason: 'model-has-no-reasoning' };
  if (!walk.sawSettledTurn) return { state: 'unknown', reason: 'no-settled-turn' };
  // 会思考，但供应商这一轮一个 reasoning 字段都没报——那是「没告诉我们」，不是「思考了 0 个 token」。
  return walk.reasoning === undefined
    ? { state: 'unknown', reason: 'provider-omits-reasoning' } : KNOWN(walk.reasoning);
}

/**
 * pi 的队列 → 面板要画的那几条。
 *
 * **`kind:"write"` 一条都不画**（方案 §1.4 规则三）。pi 把「操作进行中的 `appendCustomEntry`」
 * 也排进同一个 inbox（`runtime/lane.js:1490-1545`），所以等待期的 `queues` 里躺着的
 * 可能是我们自己那条审批记录——把它画成「排队的用户消息」，用户会在队列里读到一句
 * 他从没打过的话。判据是 `kind`，不是「看内容像不像用户说的」。
 *
 * 反过来，**除 write 之外的每一条都画**（含我们今天不发的 `nextRun`）：一条排在队里
 * 却在面板上不存在的话，比多画一行危险得多——用户没法取消一个他看不见的东西。
 */
function projectQueues(snapshot: LaneSnapshot): LaneQueuedMessage[] {
  const queued: LaneQueuedMessage[] = [];
  for (const item of snapshot.queues) {
    if (item.kind === 'write') continue;
    // 拿不出文本的（纯图片插话）不编一个占位串：面板画一行空白，比画一句我们编的话诚实。
    queued.push({ entryId: item.entryId, kind: QUEUE_KIND[item.kind], ...draftInputFromMessage(item.message) });
  }
  return queued;
}

/** pi 的 camelCase 队列词 → 中立层的词表。两侧各自的拼写习惯，一张表管死。 */
const QUEUE_KIND: Readonly<Record<'steer' | 'followUp' | 'nextRun', LaneQueueKind>> = {
  steer: 'steer', followUp: 'follow-up', nextRun: 'next-run',
};

function contextMetric(walk: ReturnType<typeof walkUsage>): LaneMetric {
  if (!walk.sawSettledTurn) return { state: 'unknown', reason: 'no-settled-turn' };
  if (walk.compactedAfterLastTurn) return { state: 'unknown', reason: 'just-compacted' };
  return walk.lastPrompt === undefined ? { state: 'unknown', reason: 'no-settled-turn' } : KNOWN(walk.lastPrompt);
}

function projectThinking(snapshot: LaneSnapshot, supportedLevels: readonly LaneThinkingLevel[]): LaneThinking {
  return {
    supportedLevels,
    level: snapshot.configuration.thinkingLevel as LaneThinkingLevel,
    canTurnOff: supportedLevels.includes('off'),
  };
}

export function projectLaneSnapshot(
  snapshot: LaneSnapshot,
  facts: LaneModelFacts,
  /**
   * 「它在等你」。**它不在快照里，所以它只能当参数进来**：停在预检里的调用 `execute`
   * 还没开始，pi 眼里它不存在（`runningTools` 空、`operation.status` 恒 `open`——
   * 探针 §2.1）。想从快照里把它推出来，只能靠猜。
   */
  pending?: LanePendingApproval,
  /**
   * 任务卡的领域读口。**每次投影都重问一遍**：任务卡上的进度和金额是领域侧的活数字，
   * 缓存一份就会出现「转录说 37%、任务中心说完成」这种两份真相（K4）。
   * 不传 = 卡上只有标题，那是诚实的「这一刻没 join 到」。
   */
  tasks?: (productionRunId: string) => LaneTaskFacts | undefined,
): LaneProjection {
  const parts: LanePart[] = [];
  let legacy: ReturnType<typeof laneLegacyFacts>;
  const running = snapshot.operation?.runningTools ?? [];
  const runningToolCallIds = new Set(running.filter((tool) => tool.status === 'running').map((tool) => tool.toolCallId));
  for (const entry of snapshot.transcript) {
    if (entry.type === 'custom') {
      if (entry.customType === LANE_LEGACY_NOTE) {
        const facts = laneLegacyFacts(entry.data);
        if (facts) { legacy = facts; continue; }
      }
      if (entry.customType === LANE_LEGACY_COMPLETE_NOTE || entry.customType === LANE_LEGACY_TOOLS_NOTE) continue;
      // 任务卡是**一种**宿主记录，但它在流里占一行（用户看得见的一张卡），所以它有自己的段。
      // 其余宿主记录仍是 `host-note`：它们不占行，只用来修正别的行的状态（审批那条）。
      if (entry.customType === LANE_TASK_NOTE_TYPE && isLaneTaskNote(entry.data)) {
        const facts = tasks?.(entry.data.productionRunId);
        parts.push({ sequence: parts.length, entrySeq: entry.seq, contentIndex: 0, kind: 'task',
          productionRunId: entry.data.productionRunId,
          ...(entry.data.operationId === undefined ? {} : { operationId: entry.data.operationId }),
          ...(facts === undefined ? {} : { facts }) });
        continue;
      }
      parts.push({ sequence: parts.length, entrySeq: entry.seq, contentIndex: 0,
        kind: 'host-note', noteType: entry.customType, data: entry.data });
      continue;
    }
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (message.role === 'user' || isLaneInputMessage(message)) {
      // 技能只从**这条消息自己**的 context 读。用「当前选中的技能」去补历史那几条，
      // 会把今天选的技能追认到昨天那句话上——那是编一个用户没做过的操作。
      const skillKey = isLaneInputMessage(message) ? message.context.skillKey : undefined;
      parts.push({ sequence: parts.length, entrySeq: entry.seq, contentIndex: 0,
        kind: 'user', text: isLaneInputMessage(message) ? message.context.displayText ?? message.content : textOf(message.content),
        ...(skillKey ? { skillKey } : {}) });
      continue;
    }
    if (message.role === 'assistant') {
      pushAssistantParts(message, entry.seq, false, runningToolCallIds, parts, entry.id);
      if (message.stopReason === 'error' && message.errorMessage) {
        parts.push({ kind: 'error', text: message.errorMessage, sequence: parts.length,
          entrySeq: entry.seq, contentIndex: message.content.length });
      }
      continue;
    }
    if (message.role === 'toolResult') {
      parts.push({ sequence: parts.length, entrySeq: entry.seq, contentIndex: 0, kind: 'tool-result',
        toolCallId: message.toolCallId, toolName: message.toolName,
        text: textOf(message.content), isError: message.isError });
    }
  }
  // 流式中的那条助手消息还没落成 entry。它接在转录末尾，用同一套编号继续往下走——
  // 落定之后它变成一条真 entry，段的相对顺序一个字都不会变。
  const streaming = snapshot.operation?.streamingMessage;
  if (streaming) {
    const nextSeq = (snapshot.transcript.at(-1)?.seq ?? 0) + 1;
    pushAssistantParts(streaming, nextSeq, true, runningToolCallIds, parts);
  }
  const usage = snapshot.stats.usage;
  const walk = walkUsage(snapshot);
  // 重试三元组原样带出来。**不换算成百分比、不算倒计时**：那两件事各有一个更靠近用户的
  // 归宿（渲染层每帧自己算），在这里先算一遍就是第二个真相，而它会和屏幕差半秒。
  const retry = snapshot.operation?.retry;
  return {
    ...(legacy ? { legacy } : {}),
    lane: snapshot.lane,
    ...(snapshot.configuration.model.provider && snapshot.configuration.model.modelId
      ? { model: { ...snapshot.configuration.model } } : {}),
    parts,
    running: snapshot.operation !== null,
    ...(retry ? { retry: { attempt: retry.attempt, maxAttempts: retry.maxAttempts,
      nextAttemptAt: retry.nextAttemptAt } } : {}),
    ...(pending ? { pending } : {}),
    queues: projectQueues(snapshot),
    usage: {
      inputTokens: usage.input,
      outputTokens: usage.output,
      // 缓存两列原样带出来，不并进 `inputTokens`（理由在 `LaneUsage` 的注释里）。
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      totalTokens: usage.totalTokens,
      cost: costMetric(snapshot, facts.pricing, walk.sawSettledTurn),
      contextTokens: contextMetric(walk),
      reasoningTokens: reasoningMetric(facts.supportedThinkingLevels, walk),
      ...(facts.contextWindow === undefined ? {} : { contextWindow: facts.contextWindow }),
    },
    thinking: projectThinking(snapshot, facts.supportedThinkingLevels),
  };
}

/** A one-shot response has no session. Reuse the same native-message projection and accounting. */
export function projectSingleShotResponse(message: AssistantMessage, facts: LaneModelFacts): LaneProjection {
  return projectLaneSnapshot({
    lane: 'single-shot',
    // This local ordinal is projection identity only; it is never saved or admitted to a user lane.
    transcript: [{ type: 'message', id: 'single-shot', parentId: null, seq: 1,
      timestamp: message.timestamp, message }],
    tipId: null, operation: null, queues: [], faulted: false,
    configuration: { model: { provider: message.provider, modelId: message.model }, thinkingLevel: 'off', activeToolNames: [] },
    stats: { messageCount: 1, usage: message.usage },
  }, facts);
}
