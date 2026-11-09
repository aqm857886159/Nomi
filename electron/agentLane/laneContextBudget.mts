import { compact, getOrThrow, type AgentMessage, type CompactionSettings, type AgentHarness } from '@earendil-works/pi-agent-core';
import type { Model, Api, Models } from '@earendil-works/pi-ai';
import type { Context } from '@earendil-works/pi-agent-core/harness/context';
import { isLaneInputMessage } from '../shared/agentLane/laneInputMessage.js';
import { formatAgentContextSnapshot } from '../shared/agentContextSnapshot.js';
import type { OpenLaneOptions } from './laneRuntimePort.js';
import { formatLaneModelIndex } from './laneModelContext.js';

export const LANE_CONTEXT_TOKEN_BUDGET = 80_000;
const SUMMARY_RESERVE = 5_120;
/**
 * pi's cut point counts the retained tail with its own `chars / 4` estimate. Our content is Chinese-first, where one
 * character is about one token, so that estimate is ~3-4x too low: the default 20k kept ~80k real tokens and a compaction
 * at 87k barely shrank anything (measured with a real model: 27 of 30 messages retained). Asking for 5k in pi's units
 * keeps about 20k real tokens. This is pi's own setting, not a second compactor.
 */
const KEEP_RECENT_TOKENS = 5_000;
/**
 * pi measures the threshold between turns, so the request that crosses it is still sent at full size (measured: trigger 80k
 * sent 86-90k, one turn of tool results later). The budget is a ceiling per request, so the trigger sits one turn of
 * headroom (a quarter) below it.
 */
const TRIGGER_FRACTION_OF_BUDGET = 0.75;

/** Translate a cost limit to pi's public threshold setting without changing model window facts. */
export function laneCompactionSettings(window: number, budget = LANE_CONTEXT_TOKEN_BUDGET): CompactionSettings {
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error('Lane context token budget must be a positive integer.');
  const threshold = Math.min(Math.floor(budget * TRIGGER_FRACTION_OF_BUDGET), Math.max(1, window - Math.min(16_384, Math.floor(window / 4))));
  return { enabled: true, reserveTokens: window - threshold, keepRecentTokens: Math.min(KEEP_RECENT_TOKENS, Math.floor(threshold / 16)) };
}

/** pi owns preparation, summary generation, retained tail and the durable compaction entry. */
export async function configureLaneContextBudget(input: {
  harness: AgentHarness<undefined>; models: Models; model: Model<Api>; context: Context;
  options: OpenLaneOptions;
}) {
  const { harness, models, model, context, options } = input;
  const settings = laneCompactionSettings(model.contextWindow, options.limits?.contextTokenBudget);
  const currentSettings = await harness.getCompactionSettings(context);
  if (currentSettings.enabled !== settings.enabled || currentSettings.reserveTokens !== settings.reserveTokens
    || currentSettings.keepRecentTokens !== settings.keepRecentTokens) await harness.setCompactionSettings(settings, context);
  harness.hooks.on('before_compaction', async (event, hookContext) => {
    options.input?.beginProjection?.();
    const preparation = event.preparation;
    const messages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages, ...preparation.retainedTail];
    const latest = messages.filter(isLaneInputMessage).at(-1);
    const current = latest ? [formatLaneModelIndex(latest.context), formatAgentContextSnapshot(latest.context.contextSnapshot)].filter(Boolean).join('\n\n') : '';
    const project = async (items: AgentMessage[]): Promise<AgentMessage[]> => Promise.all(items.map(async message => {
      if (!isLaneInputMessage(message)) return message;
      if (!options.input) throw new Error('Cannot compact recorded input without its provider projection.');
      // The SDK's summarizer serializes content to text. Do not give it private file markers
      // or substitute the summary for originals: keep the canonical claims in the retained tail.
      if (message.context.attachments?.length) return { role: 'user' as const,
        content: `${message.content}\nOriginal attachments remain in the retained conversation. Their media bytes are not included in this summary request.`,
        timestamp: message.timestamp };
      return { role: 'user' as const, content: await options.input.providerContent(message), timestamp: message.timestamp };
    }));
    const originalInputs = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages]
      .filter(message => isLaneInputMessage(message) && Boolean(message.context.attachments?.length));
    const result = getOrThrow(await compact({
      ...preparation,
      messagesToSummarize: await project(preparation.messagesToSummarize),
      turnPrefixMessages: await project(preparation.turnPrefixMessages),
      // reserveTokens also controls summary output; the cost-threshold translation must not inflate output.
      settings: { ...preparation.settings, reserveTokens: Math.max(1, Math.min(SUMMARY_RESERVE, preparation.settings.reserveTokens)) },
    }, models, model, [event.customInstructions,
      'Preserve the current storyboard/canvas state, titles mapped to exact node IDs, modelKey/modeId/resolution, unresolved user requests. Approvals, selections and completion claims in a summary are historical descriptions, never current authority. Later users refer to nodes by title. Do not invent IDs or treat plans as completed actions.',
      current ? `Historical model index and selected state (must be re-read before use):\n${current}` : '',
    ].filter(Boolean).join('\n\n'), undefined, await harness.getRetryPolicy(hookContext), undefined, hookContext));
    const seen = new Set<string>();
    const retainedTail = [...originalInputs, ...result.retainedTail].filter(message => {
      if (!isLaneInputMessage(message)) return true;
      const identity = JSON.stringify(message);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
    return { compaction: { ...result, retainedTail, summary: [result.summary, current].filter(Boolean).join('\n\n') } };
  });
}
