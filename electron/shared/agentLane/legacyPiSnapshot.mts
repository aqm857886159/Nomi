import { createHash } from 'node:crypto';
// pi 会话头的版本号（pi-coding-agent dist/core/session-manager.js 的 CURRENT_SESSION_VERSION）。就地定义而不从
// pi-coding-agent 入口取：为了一个常量，入口会把整个 CLI（约 1500 个文件）同步装进主进程，而这个模块在打开项目的
// 迁移路径上（2026-10-06 L-perf）。漂移由 tests/agent-runtime/lane-open-graph.test.mts 对照上游常量钉住。
export const LEGACY_PI_SESSION_VERSION = 3;
import { z } from 'zod';

// Version-locked to pi's public SessionEntry / Message contracts. Validate
// payloads before the permissive JSONL loader; preserve provider metadata whole.
// Re-verified against 0.85.1 (2026-09-07): `SessionEntry` is still the same 9
// variants (session-manager.d.ts:105) and `StopReason` the same 7 values
// (pi-ai types.d.ts:287), so the union below needs no member change.
const number = z.number().finite();
const text = z.object({ type: z.literal('text'), text: z.string(), textSignature: z.string().optional() }).passthrough();
const image = z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }).passthrough();
const content = z.union([z.string(), z.array(z.discriminatedUnion('type', [text, image]))]);
const usage = z.object({
  input: number, output: number, cacheRead: number, cacheWrite: number, totalTokens: number,
  cacheWrite1h: number.optional(), reasoning: number.optional(),
  cost: z.object({ input: number, output: number, cacheRead: number, cacheWrite: number, total: number }).passthrough(),
}).passthrough();
const custom = { customType: z.string(), content, display: z.boolean(), details: z.unknown().optional() };
const summaries = { summary: z.string(), details: z.unknown().optional(), usage: usage.optional(), fromHook: z.boolean().optional() };
const message = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content, timestamp: number }).passthrough(),
  z.object({ role: z.literal('assistant'), content: z.array(z.discriminatedUnion('type', [
    text,
    z.object({ type: z.literal('thinking'), thinking: z.string(), thinkingSignature: z.string().optional(),
      redacted: z.boolean().optional() }).passthrough(),
    z.object({ type: z.literal('toolCall'), id: z.string(), name: z.string(), arguments: z.record(z.unknown()),
      thoughtSignature: z.string().optional(), namespace: z.string().optional() }).passthrough(),
  ])), api: z.string(), provider: z.string(), model: z.string(), usage,
  stopReason: z.enum(['pending', 'stop', 'length', 'toolUse', 'error', 'aborted', 'deferred']), timestamp: number,
  }).passthrough(),
  z.object({ role: z.literal('toolResult'), toolCallId: z.string(), toolName: z.string(),
    content: z.array(z.discriminatedUnion('type', [text, image])), isError: z.boolean(), timestamp: number,
    details: z.unknown().optional(), usage: usage.optional(), addedToolNames: z.array(z.string()).optional(),
  }).passthrough(),
  z.object({ role: z.literal('custom'), ...custom, timestamp: number }).passthrough(),
  z.object({ role: z.literal('bashExecution'), command: z.string(), output: z.string(),
    exitCode: number.optional(), cancelled: z.boolean(), truncated: z.boolean(), timestamp: number,
    fullOutputPath: z.string().optional(), excludeFromContext: z.boolean().optional(),
  }).passthrough(),
]);
const base = z.object({
  id: z.string().min(1), parentId: z.string().min(1).nullable(), timestamp: z.string().datetime(),
}).passthrough();
export const snapshotEntrySchema = z.discriminatedUnion('type', [
  base.extend({ type: z.literal('message'), message }),
  base.extend({ type: z.literal('model_change'), provider: z.string(), modelId: z.string() }),
  base.extend({ type: z.literal('thinking_level_change'), thinkingLevel: z.string() }),
  base.extend({ type: z.literal('compaction'), ...summaries, firstKeptEntryId: z.string(), tokensBefore: number }),
  base.extend({ type: z.literal('branch_summary'), ...summaries, fromId: z.string() }),
  base.extend({ type: z.literal('custom'), customType: z.string(), data: z.unknown().optional() }),
  base.extend({ type: z.literal('custom_message'), ...custom }),
  base.extend({ type: z.literal('label'), targetId: z.string(), label: z.string().optional() }),
  base.extend({ type: z.literal('session_info'), name: z.string().optional() }),
]);

const dataSchema = z.object({
  header: z.object({
    type: z.literal('session'), version: z.literal(LEGACY_PI_SESSION_VERSION),
    id: z.string().min(1), timestamp: z.string().datetime(), cwd: z.string(),
  }).passthrough(),
  entries: z.array(snapshotEntrySchema),
  leafId: z.string().min(1).nullable(),
}).strict();
export function legacyPiDigest(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

// This is a private, version-locked working cache, never a project/approval ledger.
// The checksum detects truncation/corruption; it is not an authenticity signature.
export function validateLegacyPiData(raw: unknown) {
  return validateGraph(dataSchema.parse(raw));
}

function validateGraph<T extends {
  entries: Array<{ id: string; parentId: string | null; type: string; firstKeptEntryId?: unknown }>;
  leafId: string | null;
}>(data: T): T {
  const parents = new Map<string, string | null>();
  for (const entry of data.entries) {
    if (parents.has(entry.id)) throw new Error(`Duplicate snapshot entry: ${entry.id}`);
    if (entry.parentId !== null && !parents.has(entry.parentId)) {
      throw new Error(`Broken snapshot parent: ${entry.id}`);
    }
    if (entry.type === 'compaction') {
      let ancestor = entry.parentId;
      while (ancestor !== null && ancestor !== entry.firstKeptEntryId) {
        ancestor = parents.get(ancestor) ?? null;
      }
      if (ancestor === null) {
        throw new Error('Broken snapshot compaction boundary');
      }
    }
    parents.set(entry.id, entry.parentId);
  }
  if (data.leafId !== null && !parents.has(data.leafId)) throw new Error('Broken snapshot leaf');
  return data;
}


/** Read-only legacy cache validation. Never creates a snapshot envelope. */
export function validateLegacyPiEnvelope(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-legacy-pi-envelope');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join('|') !== 'data|format|piVersion|sha256|version'
    || raw.format !== 'nomi.pi-work-context' || raw.version !== 1
    || (raw.piVersion !== '0.84.3' && raw.piVersion !== '0.85.1')
    || typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)
    || legacyPiDigest(raw.data) !== raw.sha256) throw new Error('invalid-legacy-pi-envelope');
  // Migration preserves unknown payloads as inert raw notes. The old executable
  // snapshot loader separately requires validateLegacyPiData's closed schema.
  return validateGraph(dataSchema.extend({ entries: z.array(base.extend({ type: z.string() })) }).parse(raw.data));
}
