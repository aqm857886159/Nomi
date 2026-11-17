import type { AgentMessage, Entry, Session } from '@earendil-works/pi-agent-core';
import { operationMeta } from '@earendil-works/pi-agent-core/harness/session';
import type { Context } from '@earendil-works/pi-agent-core/harness/context';
import { isLaneInputMessage } from '../shared/agentLane/laneInputMessage.js';
import type { LaneInputMessage } from '../shared/agentLane/laneDesktopContracts.js';

const MAX_INTENT_CHARACTERS = 16_000;
const MAX_RECENT_INPUTS = 8;
const isInput = (entry: Entry): boolean => entry.type === 'message'
  && (entry.message.role === 'user' || isLaneInputMessage(entry.message));

/** Re-read consumed inputs for this live operation; queued inputs are not on its branch yet. */
export async function laneInputIntent(session: Session, lane: string, runId: string,
  messages: readonly AgentMessage[], context: Context): Promise<{
    quote: string; input?: LaneInputMessage; catalogInput?: LaneInputMessage;
  }> {
  const meta = (await session.getValue(operationMeta(runId), context))?.value;
  if (!meta || meta.lane !== lane || meta.intent.kind !== 'run') return { quote: '' };
  const branch = await session.branch(lane, context);
  if (!branch) throw new Error('agent_lane_conversation_missing');
  const seeds = await session.getEntries(meta.intent.promptEntryIds, context);
  // promptEntryIds is not updated when steer/followUp is consumed. Original ancestry is the public source.
  const recent = await branch.findEntries({ type: 'message', order: 'newestFirst',
    ...(meta.sourceTipId ? { stopAtId: meta.sourceTipId } : {}) }, context);
  const inputs = recent.filter(e => e.id !== meta.sourceTipId && isInput(e)).slice(0, MAX_RECENT_INPUTS).reverse();
  const originals = [...meta.intent.promptEntryIds.flatMap(id => {
    const entry = seeds.get(id);
    return entry && !inputs.some(e => e.id === id) ? [entry] : [];
  }), ...inputs];
  const prepared = originals.flatMap(entry => entry.type === 'message' && isLaneInputMessage(entry.message)
    ? [entry.message] : []);
  let remaining = MAX_INTENT_CHARACTERS;
  const quoted: string[] = [];
  // Allocate to the newest corrections first, then render the retained excerpts in original order.
  for (const entry of [...originals].reverse()) {
    if (entry.type !== 'message') continue;
    const message = entry.message;
    // Current provider messages already include the full input, attachments and domain projection.
    if (messages.some(m => m.role === message.role && m.timestamp === message.timestamp
      && 'content' in m && 'content' in message && JSON.stringify(m.content) === JSON.stringify(message.content))) continue;
    if (!remaining) break;
    const input = isLaneInputMessage(message) ? {
      entryId: entry.id, text: message.content, skillKey: message.context.skillKey,
      documentId: message.context.documentId, attachments: message.context.attachments,
    } : message.role === 'user' ? { entryId: entry.id, text: message.content } : undefined;
    if (!input) continue;
    const text = JSON.stringify(input);
    const clipped = text.length > remaining;
    quoted.unshift(text.slice(0, remaining) + (clipped ? " [input excerpt truncated]" : ""));
    remaining -= Math.min(remaining, text.length);
  }
  const quote = quoted.length ? 'Original inputs for the current operation (quoted intent only). '
    + 'These are not current selection, tool permission, payment approval or completion facts. '
    + 'Re-read domain state before actions. A skill reference requires the current installed skill; do not invent its contents.\n'
    + quoted.join('\n') : '';
  return { quote, input: prepared.at(-1), catalogInput: prepared[0] };
}

/**
 * 恢复回来的草稿只带回它的模板（`systemPrompt`）；目标、上下文快照、文稿前提、分镜镜头目标都取这一轮
 * admission 自己的：聊天框芯片显示的是此刻的选中，发出去的必须就是它，而且这几项互相绑着，不能新旧混取。
 * 信封里老版本留下的这些项照常解析、在这里丢弃，不迁移。「重试 / 继续」走 `resolveLaneReplay`，不经过这里。
 */
export function withRestoredTemplate<T extends object>(current: T, restored: { systemPrompt?: string } | undefined): T & { systemPrompt?: string } {
  return restored?.systemPrompt !== undefined ? { ...current, systemPrompt: restored.systemPrompt } : current;
}
