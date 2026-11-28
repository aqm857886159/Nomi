// Rebuildable views of pi entries. No second session writer or raw JSONL parser.
import { applyTraceRedactions } from './laneTraceRedaction.mjs';
import { mkdir, writeFile, lstat, chmod, rm, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LaneEntry } from '../shared/agentLane/laneSnapshotTypes.js';
import type { LaneSession, LaneSessionMetadata } from './laneSession.mjs';
import { renameWithRetry } from '../jsonFile.js';
import { redactDeep } from '../events/redact.js';
import { draftInputFromMessage, isLaneInputMessage } from '../shared/agentLane/laneInputMessage.js';
import { isLaneApprovalNote, LANE_APPROVAL_NOTE_TYPE, type LaneApprovalDecision } from '../shared/agentLane/laneContracts.js';
import { isClosedTrajectoryToolFailureCode, laneToolFailureOf } from '../shared/agentLane/laneToolFailureEnvelope.js';
import { laneAssistantFaultOf, laneOutputTruncatedOf, laneVendorFailureText } from '../shared/agentLane/laneAssistantFault.js';
import { parseVendorErrorFromMessage } from '../shared/generationFailureWire.js';
import type { NomiPricingBasis } from '../shared/agentLane/laneModelConfig.js';
import { LANE_DIR_MODE, LANE_FILE_MODE } from './laneFileSystem.mjs';

export const LANE_TRACE_NOTE = 'nomi.ui.trace';
export interface LaneTraceRun {
  runId: string; fromTipId: string | null; tipId: string | null;
  startedAt: number | null; endedAt: number; status: string;
  pricing: NomiPricingBasis; error: string | null;
  model: { provider: string; model: string };
  tools: { toolCallId: string; durationMs?: number; failureCode?: string }[];
}
export interface LaneTraceTurn {
  schemaVersion: 1; sessionId: string; turnId: string; timestamp: number;
  spanName: string; prompt: string; response: string;
  models: { provider: string; model: string }[];
  tokens: { input: number; cacheRead: number; cacheWrite: number; output: number };
  /** 每一次模型请求各自的输入（input + cacheRead），顺序即请求顺序。 */
  requestInputs: number[];
  estimatedCostUsd: number | null; pricing: NomiPricingBasis | null;
  durationMs: number | null; status: string;
  tools: { toolCallId: string; name: string; spanName: string; arguments: unknown;
    resultSummary: string | null; durationMs: number | null; failed: boolean | null; failureCode: string | null }[];
  approvals: unknown[]; errors: string[];
}

/** 运行失败在轨迹与会话运行记录里的唯一写法（不带原文）。 */
export const LANE_RUN_FAILED = 'run-failed';

export function laneErrorKind(errorMessage: string): string {
  const fault = laneAssistantFaultOf(errorMessage);
  if (fault) return fault.kind === 'model-timeout' ? `model-timeout:${fault.phase}` : fault.kind;
  const marker = /\[nomi-classified: ([a-z_ ]{1,32})\]\s*$/.exec(errorMessage);
  if (marker) return marker[1]!;
  const trimmed = errorMessage.trim();
  if (/^(?:HTTP\s+|status\s+)?(401|403)\b/i.test(trimmed)) return 'auth';
  if (/^(?:HTTP\s+|status\s+)?402\b/i.test(trimmed)) return 'balance';
  if (/^(?:HTTP\s+|status\s+)?429\b/i.test(trimmed)) return 'rate-limit';
  if (/^(?:HTTP\s+|status\s+)?(?:408|504)\b/i.test(trimmed)) return 'timeout';
  if (/^(?:HTTP\s+|status\s+)?4\d\d\b/i.test(trimmed)) return 'upstream-4xx';
  if (/^(?:HTTP\s+|status\s+)?5\d\d\b/i.test(trimmed)) return 'upstream-5xx';
  if (/invalid json|unexpected token|json parse|schema|protocol error/i.test(trimmed)) return 'protocol-error';
  return 'provider-error';
}

function vendorDiagnosticErrorKind(message: { readonly diagnostics?: readonly { readonly type?: unknown; readonly details?: unknown }[] }): string | null {
  const text = laneVendorFailureText(message);
  if (!text) return null;
  const structured = parseVendorErrorFromMessage(text);
  if (!structured) return 'provider-error';
  const status = typeof structured.httpStatus === 'number' ? structured.httpStatus : 0;
  if (structured.category === 'auth' || status === 401 || status === 403) return 'auth';
  if (structured.category === 'balance' || status === 402) return 'balance';
  if (structured.category === 'quota' || status === 429) return 'rate-limit';
  if (structured.category === 'timeout' || status === 408 || status === 504) return 'timeout';
  if (structured.category === 'network') return 'network';
  if (structured.category === 'input' || (status >= 400 && status < 500)) return 'upstream-4xx';
  if (structured.category === 'server' || (status >= 500 && status < 600)) return 'upstream-5xx';
  return 'provider-error';
}

function closedCode(candidate: string | undefined | null): string | null {
  return isClosedTrajectoryToolFailureCode(candidate) ? candidate : null;
}

function approvalFailureCode(decision: LaneApprovalDecision | undefined): string | null {
  if (decision === 'denied-by-policy') return 'approval_denied_by_policy';
  if (decision === 'denied') return 'approval_denied_by_user';
  if (decision === 'cancelled') return 'tool_cancelled';
  return null;
}

function immediateToolFailureCode(text: string): string | null {
  const trimmed = text.trim();
  const firstLine = trimmed.split('\n', 1)[0] ?? '';
  const validationHead = /^Validation failed for tool "[^"]+" \(([a-z][a-z0-9_]{0,47})\):/.exec(firstLine);
  if (validationHead && isClosedTrajectoryToolFailureCode(validationHead[1])) return validationHead[1];
  const stoppedHead = /^[a-zA-Z_][a-zA-Z0-9_-]* was not run \(([a-z][a-z0-9_]{0,47})\)\./.exec(firstLine);
  if (stoppedHead && isClosedTrajectoryToolFailureCode(stoppedHead[1])) return stoppedHead[1];
  if (/^Validation failed for tool "[^"]+"/.test(trimmed)) return 'tool_arguments_invalid';
  if (/^surface_authority_denied:/.test(trimmed)) return 'surface_authority_denied';
  if (/^Request coding before accessing project files\./.test(trimmed)) return 'coding_access_denied';
  if (/does not do this:[\s\S]*\nUse [a-z][a-z0-9_]* instead\./.test(trimmed)) return 'wrong_verb';
  if (/^Tool "[^"]+" (?:not found|is not available|is not active)|^unknown tool\b/i.test(trimmed)) return 'unknown_tool';
  if (/^Tool execution was cancelled before completion\b/i.test(trimmed)) return 'tool_cancelled';
  return null;
}

/** Strip binary parts before serialization; keep ordinary local manuscript text intact. */
export function traceSafeValue(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === 'string') return redactDeep(value, secrets).replace(/data:[^\s;,]+;base64,[A-Za-z0-9+/=]+/gi, '[binary omitted]');
  if (Array.isArray(value)) return value.map((item) => traceSafeValue(item, secrets));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.type === 'image' || record.type === 'image_url' || record.type === 'input_image') return '[image omitted]';
    return Object.fromEntries(Object.entries(redactDeep(record, secrets)).map(([key, item]) => [key, traceSafeValue(item, secrets)]));
  }
  return value;
}

export function deriveLaneTrace(entries: readonly LaneEntry[], sessionId: string): LaneTraceTurn[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const approvalByCallId = new Map<string, LaneApprovalDecision>();
  const recordedFailureByCallId = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === LANE_APPROVAL_NOTE_TYPE && isLaneApprovalNote(entry.data)) {
      approvalByCallId.set(entry.data.toolCallId, entry.data.decision);
    }
    if (entry.type === 'custom' && entry.customType === LANE_TRACE_NOTE && entry.data && typeof entry.data === 'object') {
      const run = entry.data as Partial<LaneTraceRun>;
      for (const item of run.tools ?? []) {
        const code = closedCode(item?.failureCode);
        if (item?.toolCallId && code) recordedFailureByCallId.set(item.toolCallId, code);
      }
    }
  }
  const turns = new Map<string, LaneTraceTurn>();
  const rawCosts = new Map<string, number>();
  const owner = (id: string | null): LaneTraceTurn | undefined => {
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      if (turns.has(id)) return turns.get(id);
      seen.add(id);
      id = byId.get(id)?.parentId ?? null;
    }
    return undefined;
  };
  for (const entry of entries) {
    if (entry.type === 'message' && (entry.message.role === 'user' || isLaneInputMessage(entry.message))) {
      turns.set(entry.id, {
        schemaVersion: 1, sessionId, turnId: entry.id, timestamp: entry.timestamp,
        spanName: 'invoke_agent Nomi', prompt: draftInputFromMessage(entry.message).text, response: '', models: [],
        tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, requestInputs: [], estimatedCostUsd: null, pricing: null,
        durationMs: null, status: 'incomplete', tools: [], approvals: [], errors: [],
      });
    }
    const turn = owner(entry.id);
    if (!turn) continue;
    if (entry.type === 'message' && entry.message.role === 'assistant') {
      const message = entry.message;
      if (!turn.models.some((model) => model.provider === message.provider && model.model === message.model)) {
        turn.models.push({ provider: message.provider, model: message.model });
      }
      for (const key of Object.keys(turn.tokens) as (keyof LaneTraceTurn['tokens'])[]) turn.tokens[key] += message.usage[key];
      turn.requestInputs.push(message.usage.input + message.usage.cacheRead);
      rawCosts.set(turn.turnId, (rawCosts.get(turn.turnId) ?? 0) + message.usage.cost.total);
      turn.response += message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
      const diagnosticKind = vendorDiagnosticErrorKind(message);
      const primaryKind = diagnosticKind ?? (message.errorMessage ? laneErrorKind(message.errorMessage) : null);
      if (primaryKind) turn.errors.push(primaryKind);
      if (laneOutputTruncatedOf(message) && primaryKind !== 'output-truncated') turn.errors.push('output-truncated');
      for (const part of message.content) {
        if (part.type === 'toolCall') {
          turn.tools.push({
            toolCallId: part.id, name: part.name, spanName: `execute_tool ${part.name}`,
            arguments: part.arguments, resultSummary: null, durationMs: null, failed: null, failureCode: null,
          });
        }
      }
    }
    if ((entry.type === 'compaction' || entry.type === 'branch_summary') && entry.usage) {
      for (const key of Object.keys(turn.tokens) as (keyof LaneTraceTurn['tokens'])[]) turn.tokens[key] += entry.usage[key];
      turn.requestInputs.push(entry.usage.input + entry.usage.cacheRead);
      rawCosts.set(turn.turnId, (rawCosts.get(turn.turnId) ?? 0) + entry.usage.cost.total);
    }
    if (entry.type === 'message' && entry.message.role === 'toolResult') {
      const message = entry.message;
      const tool = turn.tools.find((item) => item.toolCallId === message.toolCallId);
      const text = message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
      const coded = message.isError
        ? closedCode(laneToolFailureOf(message.details)?.code)
          ?? recordedFailureByCallId.get(message.toolCallId)
          ?? approvalFailureCode(approvalByCallId.get(message.toolCallId))
          ?? immediateToolFailureCode(text)
        : null;
      const failureCode = message.isError ? (coded ?? 'unknown_tool_failure') : null;
      // 失败工具的原文可能转述了上游原话（生成失败时）：轨迹落盘只留失败码，原文留在 pi 会话里给模型。
      if (tool) {
        tool.resultSummary = message.isError ? null : text.slice(0, 2000);
        tool.failed = message.isError;
        tool.failureCode = failureCode;
      }
      if (message.isError && failureCode) turn.errors.push(`tool:${failureCode}`);
    }
    if (entry.type === 'custom' && entry.customType === LANE_APPROVAL_NOTE_TYPE) turn.approvals.push(entry.data);
  }
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== LANE_TRACE_NOTE || !entry.data || typeof entry.data !== 'object') continue;
    const run = entry.data as unknown as LaneTraceRun;
    const affected = new Set<LaneTraceTurn>();
    let cursor = run.tipId;
    const seen = new Set<string>();
    while (cursor && cursor !== run.fromTipId && !seen.has(cursor)) {
      seen.add(cursor);
      const turn = owner(cursor);
      if (turn) affected.add(turn);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    for (const turn of affected) {
      if (!turn.models.length && run.model) turn.models.push(run.model);
      turn.pricing = run.pricing;
      turn.estimatedCostUsd = run.pricing === 'unpriced' ? null : rawCosts.get(turn.turnId) ?? 0;
      turn.status = run.status;
      turn.durationMs = run.startedAt === null ? null : Math.max(0, run.endedAt - Math.max(run.startedAt, turn.timestamp));
      if (run.error) turn.errors.push(LANE_RUN_FAILED);
      for (const tool of turn.tools) {
        const recorded = run.tools.find((item) => item.toolCallId === tool.toolCallId);
        tool.durationMs = recorded?.durationMs ?? null;
      }
    }
  }
  return [...turns.values()];
}

const readable = (value: unknown) => JSON.stringify(value, null, 2);
export function laneTraceMarkdown(turns: readonly LaneTraceTurn[], sessionId: string): string {
  const total = turns.every((turn) => turn.estimatedCostUsd !== null)
    ? turns.reduce((sum, turn) => sum + (turn.estimatedCostUsd ?? 0), 0)
    : null;
  return [
    `# Agent trace · ${sessionId}`, '', 'Derived from pi JSONL. Local text; images omitted. Costs are estimates in USD, not a bill.',
    `Turns: ${turns.length} · Estimated USD: ${total ?? 'unknown'}`, '',
    ...turns.flatMap((turn, index) => [
      `## Turn ${index + 1} · ${new Date(turn.timestamp).toISOString()}`, '',
      `Model: ${turn.models.map((model) => `${model.provider}/${model.model}`).join(', ') || 'unknown'}`,
      `Status: ${turn.status} · Duration ms: ${turn.durationMs ?? 'unknown'} · Estimated USD: ${turn.estimatedCostUsd ?? 'unknown'}`,
      `Tokens (input / cache read / cache write / output): ${Object.values(turn.tokens).join(' / ')}`, '',
      '### Prompt', '', turn.prompt, '', '### Response', '', turn.response, '',
      '### Tools / approvals / errors', '', '````json', readable({ tools: turn.tools, approvals: turn.approvals, errors: turn.errors }), '````', '',
    ]),
  ].join('\n');
}

export function laneTraceDirectory(metadata: Pick<LaneSessionMetadata, 'id' | 'path'>): string {
  // Never put derived .jsonl in pi's top-level *.jsonl session scan.
  return join(dirname(metadata.path), `${encodeURIComponent(metadata.id)}.trace`);
}

export async function writeTraceFile(directory: string, name: string, content: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: LANE_DIR_MODE });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Refusing a symbolic trace directory');
  await chmod(directory, LANE_DIR_MODE);
  const destination = join(directory, name);
  if (await readFile(destination, 'utf8').then((existing) => existing === content, () => false)) return;
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: LANE_FILE_MODE, flag: 'wx' });
    await renameWithRetry(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function writeLaneTrace(session: LaneSession, secrets: readonly string[] = []): Promise<string> {
  const entries = session.entries();
  const turns = traceSafeValue(deriveLaneTrace(applyTraceRedactions(entries), session.metadata.id), secrets) as LaneTraceTurn[];
  const directory = laneTraceDirectory(session.metadata);
  await writeTraceFile(directory, 'trace.jsonl', turns.map((turn) => JSON.stringify(turn)).join('\n') + (turns.length ? '\n' : ''));
  await writeTraceFile(directory, 'trace.md', laneTraceMarkdown(turns, session.metadata.id));
  return directory;
}
