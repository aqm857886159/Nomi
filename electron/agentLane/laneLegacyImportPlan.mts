import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, ImageContent, JsonObject, JsonValue, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import type { ProjectBinding } from '../shared/projectBinding.js';
import { legacyRecord, type LegacySource, type LegacySourceKind, type LegacyItem } from './laneLegacySources.js';
import { validateLegacySource, type ValidatedLegacyConversation } from './laneLegacyIntegrity.mjs';

export type LegacyAppendOperation = { sourceIndex: number } & (
  { type: 'message'; message: AgentMessage } | { type: 'custom'; customType: string; data: JsonValue }
);
export interface LegacyConversationPlan {
  sourceKind: LegacySourceKind;
  key: string;
  operations: LegacyAppendOperation[];
  expectedParts: number;
  sourceItems: number;
  facts: { arrayOrder: boolean; summaries: boolean; archivedItems: boolean; missingToolArguments: boolean };
}
import type { LegacyImportLabels } from '../shared/agentLane/laneLegacyMigrationContract.js';

function note(item: LegacyItem, reason: string): LegacyAppendOperation {
  return { sourceIndex: item.sourceIndex, type: 'custom', customType: 'nomi.ui.legacy',
    data: { sourceIndex: item.sourceIndex, reason, raw: item.raw as JsonValue } };
}
function timestampOf(raw: Record<string, unknown>): number {
  if (typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp)) return raw.timestamp;
  const timestamp = typeof raw.createdAt === 'string' ? Date.parse(raw.createdAt) : NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}
function assistant(content: AssistantMessage['content'], timestamp: number): AssistantMessage {
  // Old CoreMessage/host summaries did not save usage or model identity. These
  // are API-required synthetic fields, not measured historical billing.
  return { role: 'assistant', content, timestamp, api: 'openai-completions', provider: 'legacy', model: 'legacy',
    stopReason: content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
const messageOp = (item: LegacyItem, message: AgentMessage): LegacyAppendOperation =>
  ({ sourceIndex: item.sourceIndex, type: 'message', message });

function hostItem(item: LegacyItem, labels: LegacyImportLabels): LegacyAppendOperation[] {
  const raw = legacyRecord(item.raw)!; const timestamp = timestampOf(raw);
  if (raw.kind === 'user' && typeof raw.text === 'string') {
    return [messageOp(item, { role: 'user', content: raw.text, timestamp })];
  }
  if (raw.kind === 'assistant' && typeof raw.text === 'string') {
    return [messageOp(item, assistant([{ type: 'text', text: raw.text }], timestamp))];
  }
  if (raw.kind === 'tool') {
    const capability = legacyRecord(raw.capability);
    if (typeof capability?.id !== 'string' || !capability.id) throw new Error('legacy-tool-identity-invalid');
    // A host item represents a whole historical invocation. Generate a stable
    // pair identity from its array position; retain its original id in details.
    const id = `legacy-host-${item.sourceIndex}`;
    const text = typeof raw.text === 'string' ? raw.text : '';
    return [messageOp(item, assistant([{ type: 'toolCall', id, name: capability.id, arguments: {} }], timestamp)),
      messageOp(item, { role: 'toolResult', toolCallId: id, toolName: capability.id, timestamp,
        content: [{ type: 'text', text: `${labels.unverifiedToolResult}${text ? `\n${text}` : ''}` }],
        isError: raw.status !== 'done' || !text,
        details: { legacy: { raw: raw as unknown as JsonObject, argumentsRecorded: false, statusIsHistoricalOnly: true } } })];
  }
  return [note(item, 'inert-host-item')];
}

function piItem(item: LegacyItem, conversation: ValidatedLegacyConversation, labels: LegacyImportLabels): LegacyAppendOperation[] {
  const raw = legacyRecord(item.raw)!;
  if (typeof raw.id !== 'string' || !conversation.activeEntryIds?.has(raw.id)) return [note(item, 'inactive-branch')];
  if (!conversation.supportedEntryIds?.has(raw.id)) return [note(item, 'unsupported-native-entry')];
  if (raw.type === 'message') {
    const message = legacyRecord(raw.message)!;
    if (message.role === 'user' || message.role === 'toolResult'
      || (message.role === 'assistant' && message.stopReason !== 'pending')) {
      // Integrity admission already validated the complete native payload. Keep
      // provider metadata, signatures and content array intact.
      return [messageOp(item, raw.message as AgentMessage)];
    }
    return [note(item, 'inert-native-message')];
  }
  if ((raw.type === 'compaction' || raw.type === 'branch_summary') && typeof raw.summary === 'string') {
    return [note(item, 'legacy-summary'), messageOp(item, { role: 'user',
      content: labels.summaryPrefix + raw.summary, timestamp: Date.parse(String(raw.timestamp)) })];
  }
  return [note(item, 'inert-native-entry')];
}

function sdkContent(value: unknown): TextContent | ThinkingContent | ToolCall | ImageContent | undefined {
  const raw = legacyRecord(value);
  if (!raw) return;
  if (raw.type === 'text' && typeof raw.text === 'string') return { type: 'text', text: raw.text };
  if (raw.type === 'reasoning' && typeof raw.text === 'string') return { type: 'thinking', thinking: raw.text };
  if (raw.type === 'tool-call' && typeof raw.toolCallId === 'string' && raw.toolCallId
    && typeof raw.toolName === 'string' && raw.toolName && legacyRecord(raw.args)) {
    return { type: 'toolCall', id: raw.toolCallId, name: raw.toolName, arguments: raw.args as unknown as JsonObject };
  }
  if (raw.type === 'image' && typeof raw.image === 'string') {
    const embedded = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(raw.image);
    if (embedded) return { type: 'image', mimeType: embedded[1], data: embedded[2] };
    if (typeof raw.mimeType === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(raw.image)) {
      return { type: 'image', mimeType: raw.mimeType, data: raw.image };
    }
  }
}

function sdkItem(item: LegacyItem): LegacyAppendOperation[] {
  const raw = legacyRecord(item.raw);
  if (!raw) return [note(item, 'unsupported-message')];
  const timestamp = timestampOf(raw);
  if (raw.role === 'tool' && Array.isArray(raw.content) && raw.content.length) {
    const results: LegacyAppendOperation[] = [];
    for (const value of raw.content) {
      const result = legacyRecord(value);
      if (result?.type !== 'tool-result' || typeof result.toolCallId !== 'string' || !result.toolCallId
        || typeof result.toolName !== 'string' || !result.toolName
        || (!Object.hasOwn(result, 'result') && !Object.hasOwn(result, 'output'))) return [note(item, 'unsupported-tool-result')];
      const output = Object.hasOwn(result, 'result') ? result.result : result.output;
      results.push(messageOp(item, { role: 'toolResult', toolCallId: result.toolCallId, toolName: result.toolName,
        content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }],
        isError: result.isError === true, timestamp, details: { legacy: result as unknown as JsonObject } }));
    }
    return results;
  }
  if (raw.role !== 'user' && raw.role !== 'assistant') return [note(item, 'unsupported-role')];
  const content = typeof raw.content === 'string' ? [{ type: 'text' as const, text: raw.content }]
    : Array.isArray(raw.content) ? raw.content.map(sdkContent) : [undefined];
  if (content.some(part => part === undefined)) return [note(item, 'unsupported-content')];
  if (raw.role === 'user') {
    if (content.some(part => part!.type !== 'text' && part!.type !== 'image')) return [note(item, 'unsupported-user-content')];
    return [messageOp(item, { role: 'user', content: content as Array<TextContent | ImageContent>, timestamp })];
  }
  if (content.some(part => part!.type === 'image')) return [note(item, 'unsupported-assistant-content')];
  return [messageOp(item, assistant(content as AssistantMessage['content'], timestamp))];
}

/** pi accepts malformed pairs on append. Build message dependencies once and
 * propagate invalidity across connected source items without quadratic rescans. */
function pairSafe(operations: LegacyAppendOperation[], items: readonly LegacyItem[]): LegacyAppendOperation[] {
  const rawByIndex = new Map(items.map(item => [item.sourceIndex, item]));
  type Occurrence = { index: number; name: string; predecessor: number };
  const calls = new Map<string, Occurrence[]>(); const results = new Map<string, Occurrence[]>();
  let predecessor = -1;
  function add(map: Map<string, Occurrence[]>, id: string, index: number, name: string): void {
    const records = map.get(id) ?? []; records.push({ index, name, predecessor }); map.set(id, records);
  }
  for (const [index, op] of operations.entries()) {
    if (op.type !== 'message') continue;
    if (op.message.role === 'toolResult') add(results, op.message.toolCallId, index, op.message.toolName);
    else {
      predecessor = index;
      if (op.message.role === 'assistant') for (const part of op.message.content) {
        if (part.type === 'toolCall') add(calls, part.id, index, part.name);
      }
    }
  }
  const bad = new Set<number>(); const neighbors = new Map<number, Set<number>>();
  function link(left: number, right: number): void {
    const set = neighbors.get(left) ?? new Set<number>(); set.add(right); neighbors.set(left, set);
  }
  for (const id of new Set([...calls.keys(), ...results.keys()])) {
    const left = calls.get(id) ?? []; const right = results.get(id) ?? [];
    const records = [...left, ...right]; const anchor = operations[records[0].index].sourceIndex;
    const paired = left.length === 1 && right.length === 1 && left[0].index === right[0].predecessor
      && left[0].index < right[0].index && left[0].name === right[0].name;
    for (const record of records) {
      const index = operations[record.index].sourceIndex;
      link(anchor, index); link(index, anchor);
      if (!paired) bad.add(index);
    }
  }
  const queue = [...bad];
  for (let index = 0; index < queue.length; index++) for (const neighbor of neighbors.get(queue[index]) ?? []) {
    if (!bad.has(neighbor)) { bad.add(neighbor); queue.push(neighbor); }
  }
  const archived = new Set<number>();
  return operations.flatMap(op => {
    if (!bad.has(op.sourceIndex)) return [op];
    if (archived.has(op.sourceIndex)) return [];
    archived.add(op.sourceIndex);
    return [note(rawByIndex.get(op.sourceIndex)!, 'unpaired-tool-message')];
  });
}

function partCount(op: LegacyAppendOperation): number {
  if (op.type === 'custom') return 1;
  if (op.message.role !== 'assistant') return 1;
  return op.message.content.length + (op.message.stopReason === 'error' && op.message.errorMessage ? 1 : 0);
}

export function planLegacyImport(sources: readonly LegacySource[], binding: ProjectBinding, labels: LegacyImportLabels): {
  conversations: LegacyConversationPlan[]; suppressed: string[]; archivedOnly: string[];
} {
  // Complete all admission checks before selecting priority; corrupt context
  // must not silently fall back to the host's lower-priority history.
  const admitted = sources.map(source => validateLegacySource(source, binding));
  const contextThreads = new Set(admitted.filter(source => source.kind === 'pi-snapshot')
    .flatMap(source => source.conversations.flatMap(conversation => conversation.boundThreadId ? [conversation.boundThreadId] : [])));
  const conversations: LegacyConversationPlan[] = []; const suppressed: string[] = []; const archivedOnly: string[] = [];
  for (const source of admitted) for (const conversation of source.conversations) {
    if (source.kind === 'host-snapshot' && conversation.boundThreadId && contextThreads.has(conversation.boundThreadId)) {
      suppressed.push(conversation.key); continue;
    }
    if (conversation.state === 'unsupported') { archivedOnly.push(conversation.key); continue; }
    const operations = pairSafe(conversation.items.flatMap(item => conversation.format === 'host' ? hostItem(item, labels)
      : conversation.format === 'pi' ? piItem(item, conversation, labels) : sdkItem(item)), conversation.items);
    conversations.push({ sourceKind: source.kind, key: conversation.key, operations,
      expectedParts: operations.reduce((sum, operation) => sum + partCount(operation), 0), sourceItems: conversation.items.length,
      facts: { arrayOrder: conversation.format === 'host',
        summaries: operations.some(op => op.type === 'custom' && legacyRecord(op.data)?.reason === 'legacy-summary'),
        archivedItems: operations.some(op => op.type === 'custom'),
        missingToolArguments: conversation.format === 'host' && conversation.items.some(item => legacyRecord(item.raw)?.kind === 'tool') },
    });
  }
  return { conversations, suppressed, archivedOnly };
}
