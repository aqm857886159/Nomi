// Agent lane · 上下文预算与旧读快照压缩（`pi-coding-agent@1.7.0` 原生 `compact` + `SessionManager.appendContextEdit`）
//
// 1.7.0 起：
//   1. 自动压缩走 `pi-coding-agent` 的 `shouldCompact` + `estimateProjectedContextTokens` + `prepareCompaction` + `compact`；
//   2. 同一回合反复读取同一可变资源（NF-0928-0003）直接调 `SessionManager.appendContextEdit` 写入持久 `context_edit`，
//      `buildSessionProjection()` 与 `estimateProjectedContextTokens()` 原生按替换后的短说明计算，彻底删掉自写 `laneSupersededReads.mts`。
import type { AgentMessage, StreamFn, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, JsonValue, Model, RetryPolicy, Usage } from '@earendil-works/pi-ai';
import type { SessionEntry, SessionProjection } from '@earendil-works/pi-coding-agent';
import { isLaneInputMessage } from '../shared/agentLane/laneInputMessage.js';
import { formatAgentContextSnapshot } from '../shared/agentContextSnapshot.js';
import { toSemanticInput, type ModelFacingToolSpec } from '../shared/agentCapabilities/modelFacingTools.js';
import type { OpenLaneOptions } from './laneRuntimePort.js';
import { formatLaneModelIndex } from './laneModelContext.js';
import type { LaneSession } from './laneSession.mjs';

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}
export type LaneCompactionSettings = CompactionSettings;

interface PiCompactionPreparation {
  firstKeptEntryId: string;
  messagesToSummarize: AgentMessage[];
  turnPrefixMessages: AgentMessage[];
  isSplitTurn: boolean;
  tokensBefore: number;
  previousSummary?: string;
  fileOps: unknown;
  settings: LaneCompactionSettings;
}

interface PiCompactionResult {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  estimatedTokensAfter?: number;
  usage?: Usage;
  details?: unknown;
}

interface PiCompactionModule {
  estimateProjectedContextTokens(projection: SessionProjection, branchEntries: SessionEntry[]): { tokens: number };
  shouldCompact(contextTokens: number, contextWindow: number, settings: LaneCompactionSettings): boolean;
  prepareCompaction(pathEntries: SessionEntry[], settings: LaneCompactionSettings): PiCompactionPreparation | undefined;
  compact(
    preparation: PiCompactionPreparation,
    model: Model<Api>,
    apiKey: string | undefined,
    headers?: Record<string, string>,
    customInstructions?: string,
    signal?: AbortSignal,
    thinkingLevel?: ThinkingLevel,
    streamFn?: StreamFn,
    env?: Record<string, string>,
    retry?: RetryPolicy,
    callbacks?: unknown,
    sessionId?: string,
  ): Promise<PiCompactionResult>;
}

let cachedCompactionModule: Promise<PiCompactionModule> | undefined;
function loadPiCompactionModule(): Promise<PiCompactionModule> {
  // 直接加载 `./core/compaction/compaction.js`，不拖入 `pi-coding-agent/dist/index.js` CLI 桶。
  const moduleUrl = new URL('./core/compaction/compaction.js', import.meta.resolve('@earendil-works/pi-coding-agent')).href;
  return (cachedCompactionModule ??= import(moduleUrl) as Promise<PiCompactionModule>);
}

export const LANE_CONTEXT_TOKEN_BUDGET = 80_000;
const SUMMARY_RESERVE = 5_120;
const KEEP_RECENT_TOKENS = 5_000;
const TRIGGER_FRACTION_OF_BUDGET = 0.75;

/** Translate a cost limit to pi's public threshold setting without changing model window facts. */
export function laneCompactionSettings(window: number, budget = LANE_CONTEXT_TOKEN_BUDGET): CompactionSettings {
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error('Lane context token budget must be a positive integer.');
  const threshold = Math.min(Math.floor(budget * TRIGGER_FRACTION_OF_BUDGET), Math.max(1, window - Math.min(16_384, Math.floor(window / 4))));
  const settings: CompactionSettings = {
    enabled: true,
    reserveTokens: window - threshold,
    keepRecentTokens: Math.min(KEEP_RECENT_TOKENS, Math.floor(threshold / 16)),
  };
  return settings;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function readResourceKey(spec: ModelFacingToolSpec | undefined, args: unknown): string | undefined {
  if (!spec || spec.effect !== 'read') return undefined;
  if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) return undefined;
  try {
    return `${spec.contractId}:${stableJson(toSemanticInput(spec, (args ?? {}) as Record<string, unknown>))}`;
  } catch {
    return undefined;
  }
}

export function supersededReadNote(toolName: string, laterToolCallId: string): string {
  return `[Earlier ${toolName} result omitted: the same thing was read again later (call ${laterToolCallId}), `
    + 'and that later result is the current state. Use it; do not read again just to recover this copy.]';
}

export interface SupersededReadEdit {
  readonly targetId: string;
  readonly note: string;
}

export function collectSupersededReadEdits(
  branch: ReadonlyArray<{
    readonly id: string;
    readonly type: string;
    readonly targetId?: string;
    readonly replacement?: { readonly content?: unknown } | null;
    readonly message?: AgentMessage;
  }>,
  specs: readonly ModelFacingToolSpec[],
  latestToolResultEntryId: string,
): SupersededReadEdit[] {
  const latestEntry = branch.find((entry) => entry.id === latestToolResultEntryId);
  if (!latestEntry || latestEntry.type !== 'message' || !latestEntry.message || latestEntry.message.role !== 'toolResult' || latestEntry.message.isError) {
    return [];
  }
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const keyByCall = new Map<string, string>();
  const currentReplacementByTarget = new Map<string, string | null>();
  for (const entry of branch) {
    if (entry.type === 'context_edit' && typeof entry.targetId === 'string') {
      const content = entry.replacement?.content;
      const firstText = Array.isArray(content) && content[0] && typeof content[0] === 'object' && 'text' in content[0]
        ? String((content[0] as { text?: unknown }).text ?? '')
        : '';
      currentReplacementByTarget.set(entry.targetId, entry.replacement === null ? null : firstText);
      continue;
    }
    if (entry.type !== 'message' || !entry.message || entry.message.role !== 'assistant') continue;
    for (const part of entry.message.content) {
      if (part.type !== 'toolCall') continue;
      const key = readResourceKey(byName.get(part.name), part.arguments);
      if (key) keyByCall.set(part.id, key);
    }
  }
  const latestCallId = latestEntry.message.toolCallId;
  const targetKey = keyByCall.get(latestCallId);
  if (!targetKey) return [];
  const edits: SupersededReadEdit[] = [];
  for (const entry of branch) {
    if (entry.id === latestEntry.id) break;
    if (entry.type !== 'message' || !entry.message || entry.message.role !== 'toolResult' || entry.message.isError) continue;
    if (keyByCall.get(entry.message.toolCallId) !== targetKey) continue;
    const note = supersededReadNote(entry.message.toolName, latestCallId);
    if (currentReplacementByTarget.get(entry.id) === note) continue;
    edits.push({ targetId: entry.id, note });
  }
  return edits;
}

/**
 * 当一条读动词的成功 `toolResult` 落入 `SessionManager` 分支时，将同一语义资源的更早成功读取结果
 * 通过原生 `SessionManager.appendContextEdit` 标记为简短引用说明：
 *   - 原始转录（`getEntries` / `getBranch`）一字不改，UI 历史与轨迹仍见完整原文；
 *   - 模型投影（`buildSessionProjection` / `buildSessionContext`）与压缩预估（`estimateProjectedContextTokens`）原生生效。
 */
export async function recordSupersededReadEdits(
  session: LaneSession,
  specs: readonly ModelFacingToolSpec[],
  latestToolResultEntryId: string,
): Promise<boolean> {
  const edits = collectSupersededReadEdits(session.branchEntries(), specs, latestToolResultEntryId);
  for (const edit of edits) {
    await session.appendContextEdit(edit.targetId, { content: [{ type: 'text', text: edit.note }] });
  }
  return edits.length > 0;
}

const COMPACTION_DOMAIN_INSTRUCTIONS =
  'Preserve the current storyboard/canvas state, titles mapped to exact node IDs, unresolved user requests. '
  + 'Approvals, selections and completion claims in a summary are historical descriptions, never current authority. '
  + 'Later users refer to nodes by title. Do not invent IDs or treat plans as completed actions.';

/** Run pi's native compaction when projected context crosses threshold (or when forced for overflow recovery). */
export async function maybeCompactLaneSession(input: {
  session: LaneSession;
  model: Model<Api>;
  streamFn: StreamFn;
  settings: LaneCompactionSettings;
  options: OpenLaneOptions;
  retry: RetryPolicy;
  signal?: AbortSignal;
  force?: boolean;
}): Promise<boolean> {
  const { session, model, streamFn, settings, options, retry, signal, force = false } = input;
  if (!settings.enabled || model.contextWindow <= 0) return false;
  const { compact, estimateProjectedContextTokens, prepareCompaction, shouldCompact } = await loadPiCompactionModule();
  const rawBranch = session.manager.getBranch();
  const projection = session.manager.buildSessionProjection();
  const projectedTokens = estimateProjectedContextTokens(projection, rawBranch).tokens;
  if (!force && !shouldCompact(projectedTokens, model.contextWindow, settings)) {
    return false;
  }
  const preparation = prepareCompaction(rawBranch, settings);
  if (!preparation) return false;

  const branchMessages = session.branchEntries()
    .flatMap((entry) => (entry.type === 'message' ? [entry.message] : []));
  const latest = branchMessages.filter(isLaneInputMessage).at(-1);
  const current = latest
    ? [formatLaneModelIndex(latest.context), formatAgentContextSnapshot(latest.context.contextSnapshot)].filter(Boolean).join('\n\n')
    : '';
  const project = async (items: AgentMessage[]): Promise<AgentMessage[]> => Promise.all(items.map(async (message) => {
    if (!isLaneInputMessage(message)) return message;
    if (!options.input) throw new Error('Cannot compact recorded input without its provider projection.');
    return { role: 'user' as const, content: await options.input.providerContent(message), timestamp: message.timestamp };
  }));

  const customInstructions = [
    COMPACTION_DOMAIN_INSTRUCTIONS,
    current ? `Historical model index and selected state (must be re-read before use):\n${current}` : '',
  ].filter(Boolean).join('\n\n');

  const result = await compact(
    {
      ...preparation,
      messagesToSummarize: await project(preparation.messagesToSummarize),
      turnPrefixMessages: await project(preparation.turnPrefixMessages),
      // reserveTokens also controls summary output; the cost-threshold translation must not inflate output.
      settings: { ...preparation.settings, reserveTokens: Math.max(1, Math.min(SUMMARY_RESERVE, preparation.settings.reserveTokens)) },
    },
    model,
    undefined,
    undefined,
    customInstructions,
    signal,
    'off',
    streamFn,
    undefined,
    retry,
    undefined,
    session.metadata.id,
  );
  await session.appendCompaction(
    [result.summary, current].filter(Boolean).join('\n\n'),
    result.firstKeptEntryId,
    result.tokensBefore,
    result.details as JsonValue | undefined,
    false,
    result.usage,
  );
  return true;
}
