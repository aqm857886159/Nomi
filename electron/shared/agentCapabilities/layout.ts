import { z } from 'zod'
import type { CapabilityContract } from './capabilityContract'

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
  id: 'layout.read', version: 1, aliases: { pi: 'layout.read', mcp: 'nomi_layout_read' }, inputSchema: layoutReadInputSchema, outputSchema: layoutResultSchema,
  effect: 'read', effectClass: 'reversible_local', execution: { port: 'document', availability: 'renderer_required' }, exposure: 'mcp_safe', requiredScope: 'layout:read', targetKind: 'editing-layout',
  projections: { pi: { description: 'Read the current five-panel editing layout.' }, mcp: { description: 'Read the current five-panel editing layout.' } },
} as const satisfies CapabilityContract<z.infer<typeof layoutReadInputSchema>, LayoutResult>

export const LAYOUT_WRITE_CAPABILITY = {
  id: 'layout.write', version: 1, aliases: { pi: 'layout.write', mcp: 'nomi_layout_write' }, inputSchema: layoutWriteInputSchema, outputSchema: layoutResultSchema,
  effect: 'reversible_write', effectClass: 'reversible_local', execution: { port: 'document', availability: 'renderer_required' }, exposure: 'mcp_safe', requiredScope: 'layout:write', targetKind: 'editing-layout',
  projections: { pi: { description: 'Write a reversible local editing layout change.' }, mcp: { description: 'Write a reversible local editing layout change.' } },
} as const satisfies CapabilityContract<z.infer<typeof layoutWriteInputSchema>, LayoutResult>

export function layoutPiDescriptionForAlias(alias: string): string | undefined { return alias === 'layout.read' ? LAYOUT_READ_CAPABILITY.projections.pi.description : alias === 'layout.write' ? LAYOUT_WRITE_CAPABILITY.projections.pi.description : undefined }
export function layoutPiInputSchemaForAlias(alias: string) { return alias === 'layout.read' ? z.object({}).strict() : alias === 'layout.write' ? layoutWriteInputSchema.omit({ operation: true }) : undefined }
