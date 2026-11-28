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
import { LANE_APPROVAL_NOTE_TYPE } from '../shared/agentLane/laneContracts.js';
import { laneToolFailureOf } from '../shared/agentLane/laneToolFailureEnvelope.js';
import { laneAssistantFaultOf } from '../shared/agentLane/laneAssistantFault.js';
import type { NomiPricingBasis } from '../shared/agentLane/laneModelConfig.js';
import { LANE_DIR_MODE, LANE_FILE_MODE } from './laneFileSystem.mjs';

export const LANE_TRACE_NOTE = 'nomi.ui.trace';
export interface LaneTraceRun {
  runId: string; fromTipId: string | null; tipId: string | null;
  startedAt: number | null; endedAt: number; status: string;
  pricing: NomiPricingBasis; error: string | null;
  model: { provider: string; model: string };
  tools: { toolCallId: string; durationMs: number }[];
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
  return marker ? marker[1]! : 'provider-error';
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
      if (message.errorMessage) turn.errors.push(laneErrorKind(message.errorMessage));
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
      const failureCode = message.isError ? laneToolFailureOf(message.details)?.code ?? null : null;
      if (tool) {
        tool.resultSummary = message.isError ? null : text.slice(0, 2000);
        tool.failed = message.isError;
        tool.failureCode = failureCode;
      }
      if (message.isError) turn.errors.push(failureCode ?? 'tool-failed');
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
        tool.durationMs = run.tools.find((item) => item.toolCallId === tool.toolCallId)?.durationMs ?? null;
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
