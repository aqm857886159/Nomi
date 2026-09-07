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
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { LanePart, LaneProjection } from '../shared/agentLane/laneContracts.js';

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
export function projectLaneSnapshot(snapshot: LaneSnapshot): LaneProjection {
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
  const cost = usage.cost?.total;
  return {
    lane: snapshot.lane,
    parts,
    running: snapshot.operation !== null,
    usage: {
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalTokens: usage.totalTokens,
      // 0 不是「免费」，是「运行时对这个模型没有价目」。把它当数字印出去就是一个
      // 我们没资格下的断言（同 `run.mts:20-30` 的判断，一字不差地保持一致）。
      ...(typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? { costUsd: cost } : {}),
    },
  };
}
