import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { LaneEntry } from '../shared/agentLane/laneSnapshotTypes.js';
import type { LaneSession } from './laneSession.mjs';
import { isLaneInputMessage } from '../shared/agentLane/laneInputMessage.js';
import type { LaneInputMessage } from '../shared/agentLane/laneDesktopContracts.js';
import { laneOriginalText } from './laneOriginalInput.mjs';
import { holdsTurnGeneration } from './turnGenerationHold.js';
import { ASK_USER_VERB_NAME } from '../shared/agentCapabilities/askUser.js';
import { generateUserDecisionOf } from '../shared/agentLane/generateUserDecision.js';

const MAX_INTENT_CHARACTERS = 16_000;
const MAX_RECENT_INPUTS = 8;
const isInput = (entry: LaneEntry): boolean => entry.type === 'message'
  && (entry.message.role === 'user' || isLaneInputMessage(entry.message));

function userReplyToCard(entry: LaneEntry): string {
  if (entry.type !== 'message' || entry.message.role !== 'toolResult' || entry.message.isError) return '';
  const result = entry.message;
  if (result.toolName === 'generate') {
    const decision = generateUserDecisionOf(result.details);
    if (decision?.outcome === 'redirected') return decision.userSaid;
  }
  if (result.toolName === ASK_USER_VERB_NAME) {
    return result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  }
  return '';
}

export interface LaneActiveRunMeta {
  readonly sourceTipId: string | null;
  readonly promptEntryIds: readonly string[];
}

/** Re-read consumed inputs for this live operation; queued inputs are not on its branch yet. */
export function laneInputIntent(
  session: LaneSession,
  runMeta: LaneActiveRunMeta | undefined,
  messages: readonly AgentMessage[],
): {
  quote: string;
  input?: LaneInputMessage;
  catalogInput?: LaneInputMessage;
} {
  if (!runMeta) return { quote: '' };
  const seeds = session.getEntries(runMeta.promptEntryIds);
  const recent = session.findBranchEntries({
    type: 'message',
    order: 'newestFirst',
    ...(runMeta.sourceTipId ? { stopAtId: runMeta.sourceTipId } : {}),
  });
  const inputs = recent.filter((e) => e.id !== runMeta.sourceTipId && isInput(e)).slice(0, MAX_RECENT_INPUTS).reverse();
  const originals = [
    ...runMeta.promptEntryIds.flatMap((id) => {
      const entry = seeds.get(id);
      return entry && !inputs.some((e) => e.id === id) ? [entry] : [];
    }),
    ...inputs,
  ];
  const prepared = originals.flatMap((entry) => entry.type === 'message' && isLaneInputMessage(entry.message)
    ? [{ message: entry.message, seq: entry.seq }]
    : []);
  let remaining = MAX_INTENT_CHARACTERS;
  const quoted: string[] = [];
  for (const entry of [...originals].reverse()) {
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (messages.some((m) => m.role === message.role && m.timestamp === message.timestamp
      && 'content' in m && 'content' in message && JSON.stringify(m.content) === JSON.stringify(message.content))) {
      continue;
    }
    if (!remaining) break;
    const input = isLaneInputMessage(message) ? {
      entryId: entry.id,
      text: message.content,
      skillKey: message.context.skillKey,
      documentId: message.context.documentId,
      attachments: message.context.attachments,
    } : message.role === 'user' ? { entryId: entry.id, text: message.content } : undefined;
    if (!input) continue;
    const text = JSON.stringify(input);
    const clipped = text.length > remaining;
    quoted.unshift(text.slice(0, remaining) + (clipped ? ' [input excerpt truncated]' : ''));
    remaining -= Math.min(remaining, text.length);
  }
  const quote = quoted.length
    ? 'Original inputs for the current operation (quoted intent only). '
      + 'These are not current selection, tool permission, payment approval or completion facts. '
      + 'Re-read domain state before actions. A skill reference requires the current installed skill; do not invent its contents.\n'
      + quoted.join('\n')
    : '';
  const consumed = prepared.at(-1);
  const current = consumed?.message;
  const continuedFrom = current?.context.continueFromEntryId && current.context.retryFromEntryId;
  const original = continuedFrom ? session.getEntry(continuedFrom) : undefined;
  const held = consumed && (
    holdsTurnGeneration(consumed.message.content)
    || (original && holdsTurnGeneration(laneOriginalText(original) ?? ''))
    || recent.some((entry) => entry.seq > consumed.seq && holdsTurnGeneration(userReplyToCard(entry)))
  );
  const input = current && { ...current, context: { ...current.context, ...(held ? { generationHeld: true as const } : {}) } };
  return { quote, input, catalogInput: prepared[0]?.message };
}

export function withRestoredTemplate<T extends object>(current: T, restored: { systemPrompt?: string } | undefined): T & { systemPrompt?: string } {
  return restored?.systemPrompt !== undefined ? { ...current, systemPrompt: restored.systemPrompt } : current;
}
