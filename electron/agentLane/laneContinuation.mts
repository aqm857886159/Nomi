import type { LaneEntry } from '../shared/agentLane/laneSnapshotTypes.js';
import type { UserMessage } from '@earendil-works/pi-ai';

/** pi deliberately excludes aborted assistants. Continue quotes only their durable prose. */
export function laneContinuationText(entry: LaneEntry | undefined): string {
  if (entry?.type !== 'message' || entry.message.role !== 'assistant' || entry.message.stopReason !== 'aborted') {
    throw new Error('Invalid lane continuation reference');
  }
  const text = entry.message.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n\n');
  if (!text.trim()) throw new Error('Lane continuation has no stopped prose');
  return text;
}

/** Provider-only context: never append another assistant or copy prose into nomi.input. */
export function appendLaneContinuation(content: UserMessage['content'], text: string): UserMessage['content'] {
  const quoted = 'Continue the following quoted assistant reply, which the user stopped. '
    + 'Only this prose was retained; no unfinished tool call was executed:\n' + JSON.stringify(text);
  return typeof content === 'string' ? `${content}\n\n${quoted}` : [...content, { type: 'text', text: quoted }];
}
