import { z } from 'zod'
import type { CapabilityContract } from './capabilityContract'

// ⚠️ `aliases.pi` 是**模型看得见的工具名**，运行时按 `/^[a-zA-Z_][a-zA-Z0-9_-]*$/` 校验
// （`electron/harness/runtime/pi/tools.mts`）。这两条原本写的是 `layout.read` / `layout.write`
// ——带点，过不了那条正则。后果不是「layout 工具不可用」，而是**整个 timeline / production
// 工具档一次请求都发不出去**：`createHostTools` 在组装阶段就抛，回合直接失败，
// 没有出站请求、没有 failure item，用户只看到一句「发送失败，请检查后重试。」
// 而 `PRODUCTION_INTENT` 命中「短片 / 成片 / 剧本 / 制作 / N 分钟」，
// 也就是说「帮我做一条 20 秒短片」这句 Nomi 最核心的话，每一次都发不出去。
// 2026-09-06 由 `tests/ux/agent-v4-short-film.walk.mjs` 这条真实任务走查抓到。
// 契约 id（`layout.read`）不变——RPC method、requiredScope、MCP 名都还按它走，
// 变的只有喂给模型的那个名字。同类问题的防线在 `registry.test.ts`：
// 每一个 pi 别名都要过运行时那条正则。

const bool = z.boolean()
const layoutShape = z.object({
  sourceWidth: z.number().int().min(240).max(520),
  inspectorWidth: z.number().int().min(200).max(420),
  assistantWidth: z.number().int().min(320).max(600),
  timelineHeight: z.number().int().min(140).max(360),
  visibility: z.object({ source: bool, inspector: bool, assistant: bool }).strict(),
  preset: z.enum(['default', 'focus', 'result', 'portrait', 'custom']),
}).strict()
export const layoutWriteTransportInputSchema = z.object({ operation: z.literal('write'), layout: layoutShape }).strict()

export const layoutReadInputSchema = z.object({ operation: z.literal('read_layout') }).strict()
export const layoutWriteInputSchema = z.object({ operation: z.literal('write_layout'), layout: layoutShape }).strict()
export const layoutSemanticInputSchema = z.union([layoutReadInputSchema, layoutWriteInputSchema])
export const layoutResultSchema = z.object({ operation: z.enum(['read_layout', 'write_layout']), ok: z.boolean(), layout: layoutShape, undoToken: z.string().optional(), receipt: z.string().optional() }).strict()
export type LayoutSemanticInput = z.infer<typeof layoutSemanticInputSchema>
export type LayoutResult = z.infer<typeof layoutResultSchema>

export const LAYOUT_READ_CAPABILITY = {
  id: 'layout.read', version: 1, aliases: { pi: 'layout_read', mcp: 'nomi_layout_read' }, inputSchema: layoutReadInputSchema, outputSchema: layoutResultSchema,
  effect: 'read', effectClass: 'reversible_local', execution: { port: 'document', availability: 'renderer_required' }, exposure: 'mcp_safe', requiredScope: 'layout:read', targetKind: 'editing-layout',
  projections: { pi: { description: 'Read the current five-panel editing layout.' }, mcp: { description: 'Read the current five-panel editing layout.' } },
} as const satisfies CapabilityContract<z.infer<typeof layoutReadInputSchema>, LayoutResult>

export const LAYOUT_WRITE_CAPABILITY = {
  id: 'layout.write', version: 1, aliases: { pi: 'layout_write', mcp: 'nomi_layout_write' }, inputSchema: layoutWriteInputSchema, outputSchema: layoutResultSchema,
  effect: 'reversible_write', effectClass: 'reversible_local', execution: { port: 'document', availability: 'renderer_required' }, exposure: 'mcp_safe', requiredScope: 'layout:write', targetKind: 'editing-layout',
  projections: { pi: { description: 'Write a reversible local editing layout change.' }, mcp: { description: 'Write a reversible local editing layout change.' } },
} as const satisfies CapabilityContract<z.infer<typeof layoutWriteInputSchema>, LayoutResult>

export function layoutPiDescriptionForAlias(alias: string): string | undefined { return alias === 'layout_read' ? LAYOUT_READ_CAPABILITY.projections.pi.description : alias === 'layout_write' ? LAYOUT_WRITE_CAPABILITY.projections.pi.description : undefined }
export function layoutPiInputSchemaForAlias(alias: string) { return alias === 'layout_read' ? z.object({}).strict() : alias === 'layout_write' ? layoutWriteInputSchema.omit({ operation: true }) : undefined }
