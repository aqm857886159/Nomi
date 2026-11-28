// Agent lane · 能力契约 → pi 的 `AgentTool` 工具面（`pi-agent-core@1.7.0` + `pi-coding-agent@1.7.0`）
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { formatSize, truncateHead } from '@earendil-works/pi-coding-agent';
import { logWarn } from '../logging/logger.js';
import { LANE_MODEL_OUTPUT_MAX_BYTES, LANE_MODEL_OUTPUT_MAX_LINES } from '../shared/agentLane/laneContracts.js';
import {
  LANE_READ_TOOL_TIMEOUT_MS,
  laneToolBillable,
  laneToolModelDescription,
  laneToolMutates,
  laneToolPublicFailure,
  renderLaneToolFailure,
  renderLaneToolNextAction,
  toolArgumentsRejected,
  type LaneToolFailureShape,
} from '../shared/agentLane/laneToolContract.js';
import { issuesFromZod } from '../shared/agentLane/toolInputIssues.js';
import type { LaneToolPublicFailure } from '../shared/agentLane/laneToolFailureEnvelope.js';
import { VERB_EFFECTS } from '../shared/agentCapabilities/verbDeclaration.js';
import type { LaneApprovalDecision } from '../shared/agentLane/laneContracts.js';
import type { LaneToolDescriptor } from './laneRuntimePort.js';
import { toModelVisibleSchema } from './laneToolSchema.mjs';

const TOOL_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
const LANE_TOOL_DEADLOCK_GUARD_MARGIN_MS = 5_000;

class LaneToolFailure extends Error {}

const pendingToolFailures = new Map<string, LaneToolPublicFailure>();

function rememberToolFailure(toolCallId: string, failure: LaneToolFailureShape): void {
  pendingToolFailures.set(toolCallId, laneToolPublicFailure(failure));
}

export function takeLaneToolFailure(toolCallId: string): LaneToolPublicFailure | undefined {
  const failure = pendingToolFailures.get(toolCallId);
  if (failure) pendingToolFailures.delete(toolCallId);
  return failure;
}

export interface LaneOutputTruncation {
  readonly truncatedBy: 'lines' | 'bytes';
  readonly shownLines: number;
  readonly totalLines: number;
  readonly shownBytes: number;
  readonly totalBytes: number;
}

function truncateForModel(text: string): { text: string; truncation?: LaneOutputTruncation } {
  const result = truncateHead(text, {
    maxLines: LANE_MODEL_OUTPUT_MAX_LINES,
    maxBytes: LANE_MODEL_OUTPUT_MAX_BYTES,
  });
  if (!result.truncated || result.truncatedBy === null) return { text };
  if (result.firstLineExceedsLimit) {
    const bytes = Buffer.from(text, 'utf8');
    let end = LANE_MODEL_OUTPUT_MAX_BYTES;
    while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    result.content = bytes.subarray(0, end).toString('utf8');
    result.outputBytes = end;
    result.outputLines = 1;
  }
  const note = `\n\n[Truncated: showing the first ${result.outputLines} of ${result.totalLines} lines `
    + `(${formatSize(result.outputBytes)} of ${formatSize(result.totalBytes)}). `
    + 'The rest was not sent, so do not assume the content ends here. '
    + 'Ask for a narrower scope — a selection, a section — and call again.]';
  return {
    text: `${result.content}${note}`,
    truncation: {
      truncatedBy: result.truncatedBy,
      shownLines: result.outputLines,
      totalLines: result.totalLines,
      shownBytes: result.outputBytes,
      totalBytes: result.totalBytes,
    },
  };
}

function timeoutFailure(toolName: string, timeoutMs: number): LaneToolFailureShape {
  return {
    code: 'tool_timed_out',
    message: `${toolName} did not finish within ${Math.round(timeoutMs / 1000)}s and was stopped.`,
    nextAction: 'Do not resend the identical call — it will hit the same budget. '
      + 'Read the current state with the matching read tool, then either narrow the request '
      + '(fewer items, a smaller scope) or tell the user this step needs their attention.',
  };
}

function detailsWithTruncation(details: unknown, truncation: LaneOutputTruncation): Record<string, unknown> {
  if (details === undefined) return { truncation };
  if (!details || typeof details !== 'object' || Array.isArray(details)) return { value: details, truncation };
  return { ...(details as Record<string, unknown>), truncation };
}

export type LaneApprovalDecisionReader = (toolCallId: string) => LaneApprovalDecision | undefined;
export type LaneApprovalAnswerReader = (toolCallId: string) => string | undefined;

export function createLaneTools(
  descriptors: readonly LaneToolDescriptor[],
  approvalDecision?: LaneApprovalDecisionReader,
  approvalAnswer?: LaneApprovalAnswerReader,
): AgentTool<Record<string, unknown>, unknown>[] {
  const names = new Set<string>();
  return descriptors.map((descriptor) => {
    if (!TOOL_NAME.test(descriptor.name) || names.has(descriptor.name)) {
      throw new Error(`Invalid or duplicate Nomi lane tool name: ${descriptor.name}`);
    }
    if (!descriptor.description.trim()) {
      throw new Error(`Nomi lane tool ${descriptor.name} needs a model-visible description`);
    }
    const effect = descriptor.effect;
    if (!VERB_EFFECTS.includes(effect)) {
      throw new Error(`Nomi lane tool ${descriptor.name} declares effect "${String(effect)}"; allowed: ${VERB_EFFECTS.join(', ')}.`);
    }
    const mutates = laneToolMutates(effect);
    const billable = laneToolBillable(effect);
    const timeoutMs = descriptor.execution.timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error(`Nomi lane tool ${descriptor.name} needs a positive execution.timeoutMs budget.`);
    }
    if (billable && timeoutMs > LANE_READ_TOOL_TIMEOUT_MS) {
      throw new Error(
        `Nomi lane tool ${descriptor.name} spends money and claims a ${timeoutMs}ms budget. `
        + `A billable tool must submit and return an id within ${LANE_READ_TOOL_TIMEOUT_MS}ms; `
        + 'progress belongs to a separate status tool, not to this call.',
      );
    }
    names.add(descriptor.name);
    const parameters = toModelVisibleSchema(descriptor.schema, { toolName: descriptor.name });
    const tool: AgentTool<Record<string, unknown>, unknown> = {
      name: descriptor.name,
      label: descriptor.name,
      description: laneToolModelDescription(descriptor),
      parameters,
      executionMode: mutates ? 'sequential' : 'parallel',
      replay: mutates ? 'never' : 'safe',
      ...(descriptor.prepareArguments
        ? { prepareArguments: descriptor.prepareArguments as (args: unknown) => never }
        : {}),
      execute: async (toolCallId, params, parentSignal) => {
        parentSignal?.throwIfAborted();
        const bound = descriptor.schema.safeParse(params);
        if (!bound.success) {
          const failure = toolArgumentsRejected(
            descriptor.name,
            issuesFromZod(bound.error.issues, params, parameters),
            descriptor.examples[0]?.arguments,
          );
          rememberToolFailure(toolCallId, failure);
          throw new LaneToolFailure(renderLaneToolFailure(failure));
        }
        const startedAt = performance.now();
        const guardTimeoutMs = timeoutMs + LANE_TOOL_DEADLOCK_GUARD_MARGIN_MS;
        const guard = AbortSignal.timeout(guardTimeoutMs);
        const signal = parentSignal ? AbortSignal.any([parentSignal, guard]) : guard;
        let onAbort!: () => void;
        const stopped = new Promise<never>((_resolve, reject) => {
          onAbort = () => {
            if (parentSignal?.aborted) { reject(parentSignal.reason); return; }
            const failure = timeoutFailure(descriptor.name, guardTimeoutMs);
            rememberToolFailure(toolCallId, failure);
            reject(new LaneToolFailure(renderLaneToolFailure(failure)));
            logWarn('agent', 'tool_timed_out', {
              toolName: descriptor.name,
              subOperation: 'descriptor.execute',
              elapsedMs: Math.round(performance.now() - startedAt),
              timeoutMs: guardTimeoutMs,
            });
          };
          signal.addEventListener('abort', onAbort, { once: true });
        });
        const execution = async () => descriptor.execute(bound.data, {
          toolCallId,
          signal,
          ...(() => { const decision = approvalDecision?.(toolCallId); return decision ? { approvalDecision: decision } : {}; })(),
          ...(() => { const answer = approvalAnswer?.(toolCallId); return answer ? { approvalAnswer: answer } : {}; })(),
        });
        const outcome = await Promise.race([stopped, execution()])
          .finally(() => signal.removeEventListener('abort', onAbort));
        if (!outcome.ok) {
          rememberToolFailure(toolCallId, outcome.failure);
          throw new LaneToolFailure(renderLaneToolFailure(outcome.failure));
        }
        const shown = truncateForModel(outcome.text);
        const text = outcome.nextAction ? `${shown.text}\n${renderLaneToolNextAction(outcome.nextAction)}` : shown.text;
        const details = shown.truncation ? detailsWithTruncation(outcome.details, shown.truncation) : outcome.details ?? {};
        const result: AgentToolResult<unknown> = {
          content: [{ type: 'text', text }],
          details: outcome.nextAction && details && typeof details === 'object' && !Array.isArray(details)
            ? { ...(details as Record<string, unknown>), nextAction: outcome.nextAction }
            : details,
        };
        return result;
      },
    };
    return tool;
  });
}
