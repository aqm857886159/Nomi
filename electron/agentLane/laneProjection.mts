// Agent lane · `LaneSnapshot` → `LaneProjection`（纯函数，主进程侧）
//
// **这一层唯一的职责是「走一遍，不重排」。** pi 的 transcript 已经有序（探针报告 §5.1：
// 一条助手消息里 thinking / text / toolCall 各占一个 `contentIndex`，顺序是落盘的），
// 所以这里做的事就是从头走到尾、顺手给每一段编号。编号（`sequence`）之后是下游唯一
// 认的顺序凭据——不变量 I1「顺序只有一个来源」。
//
// 对照今天：`agentPanelV4Projection.sortedItems()` 拿 `createdAt` 加数组下标排一遍，
// 是因为宿主那边的记录本来就没有可信顺序。那个 `sort` 在阶段 4 会被整个删掉。
import type { LaneSnapshot } from '@earendil-works/pi-agent-core';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import type { Api, AssistantMessage, Model, Usage } from '@earendil-works/pi-ai';
import type { NomiPricingBasis } from '../harness/runtime/pi/model.mjs';
import type { LaneMetric, LanePart, LaneProjection, LaneThinking, LaneThinkingLevel }
  from '../shared/agentLane/laneContracts.js';

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
  runningToolCallIds: ReadonlySet<string>, out: LanePart[],
): void {
  message.content.forEach((part, contentIndex) => {
    const identity = { sequence: out.length, entrySeq, contentIndex };
    if (part.type === 'text') {
      out.push({ ...identity, kind: 'assistant-text', text: part.text, streaming });
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
  /** pi 的模型定义（`createNomiProvider` 造的那一份）。推理档从它 derive，不另列表。 */
  readonly model: Model<Api>;
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

function reasoningMetric(model: Model<Api>, walk: ReturnType<typeof walkUsage>): LaneMetric {
  // 「这个模型有没有推理这回事」由 pi 判，我们不看名字也不看档位表。
  const levels = getSupportedThinkingLevels(model);
  if (levels.length <= 1) return { state: 'not-applicable', reason: 'model-has-no-reasoning' };
  if (!walk.sawSettledTurn) return { state: 'unknown', reason: 'no-settled-turn' };
  // 会思考，但供应商这一轮一个 reasoning 字段都没报——那是「没告诉我们」，不是「思考了 0 个 token」。
  return walk.reasoning === undefined
    ? { state: 'unknown', reason: 'provider-omits-reasoning' } : KNOWN(walk.reasoning);
}

function contextMetric(walk: ReturnType<typeof walkUsage>): LaneMetric {
  if (!walk.sawSettledTurn) return { state: 'unknown', reason: 'no-settled-turn' };
  if (walk.compactedAfterLastTurn) return { state: 'unknown', reason: 'just-compacted' };
  return walk.lastPrompt === undefined ? { state: 'unknown', reason: 'no-settled-turn' } : KNOWN(walk.lastPrompt);
}

function projectThinking(snapshot: LaneSnapshot, model: Model<Api>): LaneThinking {
  const supportedLevels = getSupportedThinkingLevels(model) as readonly LaneThinkingLevel[];
  return {
    supportedLevels,
    level: snapshot.configuration.thinkingLevel as LaneThinkingLevel,
    canTurnOff: supportedLevels.includes('off'),
  };
}

export function projectLaneSnapshot(snapshot: LaneSnapshot, facts: LaneModelFacts): LaneProjection {
  const parts: LanePart[] = [];
  const running = snapshot.operation?.runningTools ?? [];
  const runningToolCallIds = new Set(running.filter((tool) => tool.status === 'running').map((tool) => tool.toolCallId));
  for (const entry of snapshot.transcript) {
    if (entry.type === 'custom') {
      parts.push({ sequence: parts.length, entrySeq: entry.seq, contentIndex: 0,
        kind: 'host-note', noteType: entry.customType, data: entry.data });
      continue;
    }
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (message.role === 'user') {
      parts.push({ sequence: parts.length, entrySeq: entry.seq, contentIndex: 0,
        kind: 'user', text: textOf(message.content) });
      continue;
    }
    if (message.role === 'assistant') {
      pushAssistantParts(message, entry.seq, false, runningToolCallIds, parts);
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
  return {
    lane: snapshot.lane,
    parts,
    running: snapshot.operation !== null,
    usage: {
      inputTokens: usage.input,
      outputTokens: usage.output,
      // 缓存两列原样带出来，不并进 `inputTokens`（理由在 `LaneUsage` 的注释里）。
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      totalTokens: usage.totalTokens,
      cost: costMetric(snapshot, facts.pricing, walk.sawSettledTurn),
      contextTokens: contextMetric(walk),
      reasoningTokens: reasoningMetric(facts.model, walk),
      ...(facts.contextWindow === undefined ? {} : { contextWindow: facts.contextWindow }),
    },
    thinking: projectThinking(snapshot, facts.model),
  };
}
