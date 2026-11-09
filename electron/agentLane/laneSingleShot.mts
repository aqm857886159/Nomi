import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { callModelOnce } from './laneModelCall.mjs';
import type { NomiModelConfig } from '../shared/agentLane/laneModelConfig.js';
import type { LaneProjection, LaneThinkingLevel } from '../shared/agentLane/laneContracts.js';
import type { OpenLaneOptions } from './laneRuntimePort.js';
import { projectSingleShotResponse } from '../shared/agentLane/laneProjection.js';

/** One provider call, without an Agent loop or session. No tool can trigger a continuation. */
export async function runLaneSingleShot(options: {
  model: NomiModelConfig;
  fetch: typeof globalThis.fetch;
  systemPrompt?: string;
  systemPromptClosing?: string;
  prompt: string;
  input?: OpenLaneOptions['input'];
  signal?: AbortSignal;
}): Promise<LaneProjection> {
  options.signal?.throwIfAborted();
  let captured = options.input?.capture();
  if (captured?.restoredIntent) throw new Error('agent_lane_invalid_command');
  if (captured && options.input?.prepare) captured = await options.input.prepare(captured);
  if (captured) options.input?.activate(captured);
  options.input?.beginProjection?.();
  const content = captured && options.input
    ? await options.input.providerContent({ role: 'nomi.input', content: options.prompt, context: captured, timestamp: Date.now() })
    : options.prompt;
  const systemPrompt = [options.systemPrompt, captured?.systemPrompt, captured?.skillPrompt, options.systemPromptClosing].filter(Boolean).join('\n\n');
  const { message, model, pricingBasis } = await callModelOnce({
    model: options.model, fetch: options.fetch, content,
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.input ? { onPayload: (payload: unknown, api) => options.input!.rewritePayload(payload, api) } : {}),
  });
  if (message.stopReason === 'error' && !message.errorMessage) throw new Error('agent_lane_provider_error');
  return projectSingleShotResponse(message, {
    pricing: pricingBasis,
    supportedThinkingLevels: getSupportedThinkingLevels(model) as readonly LaneThinkingLevel[],
    ...(options.model.contextWindow === undefined ? {} : { contextWindow: options.model.contextWindow }),
  });
}
