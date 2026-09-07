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
