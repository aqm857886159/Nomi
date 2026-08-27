import type { RuntimeLegacyTextTurn } from '../runtime/runtimePort';
import { sanitizeForBroadCompat } from '../../ai/promptSanitize';

export interface LegacyAgentBubble {
  role?: string;
  content?: string;
}

/**
 * Existing UI normalization, now shared by the old seam and the private importer.
 * A tool bubble is only an assistant text note, never a tool call/result or approval.
 */
export function bubblesToSeedTurns(bubbles: readonly LegacyAgentBubble[]): RuntimeLegacyTextTurn[] {
  const turns: RuntimeLegacyTextTurn[] = [];
  for (const bubble of bubbles) {
    const rawRole = bubble?.role;
    const role = rawRole === 'user' ? 'user' : rawRole === 'assistant' || rawRole === 'tool' ? 'assistant' : null;
    if (!role) continue;
    let content = sanitizeForBroadCompat(typeof bubble?.content === 'string' ? bubble.content.trim() : '');
    if (!content) continue;
    if (rawRole === 'tool') content = `（已执行操作：${content.split('\n')[0].slice(0, 100)}）`;
    const last = turns[turns.length - 1];
    if (last && last.role === role && typeof last.content === 'string') {
      last.content = `${last.content}\n\n${content}`;
    } else {
      turns.push({ role, content });
    }
  }
  while (turns.length && turns[0].role === 'assistant') turns.shift();
  while (turns.length && turns[turns.length - 1].role === 'user') turns.pop();
  return turns;
}
