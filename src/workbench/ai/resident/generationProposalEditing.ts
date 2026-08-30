import type { ModelParameterControl } from '../../../config/modelCatalogMeta'

export type GenerationProposalNode = {
  clientId?: string
  kind?: string
  title?: string
  prompt?: string
  modelKey?: string
  modeId?: string
  params?: Record<string, string | number | boolean>
  [key: string]: unknown
}

export type GenerationProposalArgs = {
  nodes: GenerationProposalNode[]
  [key: string]: unknown
}

export function asGenerationProposalArgs(value: unknown): GenerationProposalArgs | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.nodes)) return null
  const nodes = record.nodes.filter((node): node is GenerationProposalNode => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false
    const candidate = node as Record<string, unknown>
    if (candidate.kind !== undefined && candidate.kind !== 'image' && candidate.kind !== 'video' && candidate.kind !== 'text') return false
    if (candidate.params !== undefined && (!candidate.params || typeof candidate.params !== 'object' || Array.isArray(candidate.params))) return false
    return Object.values(candidate.params as Record<string, unknown> | undefined ?? {}).every((item) => ['string', 'number', 'boolean'].includes(typeof item))
  })
  if (!nodes.length || nodes.length !== record.nodes.length) return null
  return { ...record, nodes }
}

export function isGenerationProposalTool(toolName: string, args: unknown): boolean {
  const normalized = toolName.toLowerCase()
  return (normalized.includes('create_canvas_nodes') || normalized.includes('canvas.write') || normalized.includes('canvas_nodes')) && Boolean(asGenerationProposalArgs(args))
}

export function updateGenerationProposalNode(
  args: GenerationProposalArgs,
  index: number,
  patch: Partial<GenerationProposalNode>,
): GenerationProposalArgs {
  if (index < 0 || index >= args.nodes.length) return args
  const nodes = args.nodes.map((node, candidate) => candidate === index ? { ...node, ...patch } : node)
  return { ...args, nodes }
}

export function updateGenerationProposalParams(
  args: GenerationProposalArgs,
  index: number,
  patch: Record<string, string | number | boolean | null>,
): GenerationProposalArgs {
  if (index < 0 || index >= args.nodes.length) return args
  const node = args.nodes[index]
  const params = { ...(node.params || {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') delete params[key]
    else params[key] = value
  }
  return updateGenerationProposalNode(args, index, { params })
}

export function parseProposalControlValue(
  control: ModelParameterControl,
  value: string,
): string | number | boolean | null {
  if (control.type === 'boolean') return value === 'true'
  if (control.type === 'number') {
    if (!value.trim()) return null
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : null
  }
  const option = control.options.find((candidate) => String(candidate.value) === value)
  return option ? option.value : value
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Full final args + a compact audit delta; no mutation of the original proposal. */
export function proposalDecisionPayload(original: unknown, edited: unknown): {
  effectiveArgs?: Record<string, unknown>
  overridesDelta?: Record<string, unknown>
} {
  const base = original && typeof original === 'object' && !Array.isArray(original) ? original as Record<string, unknown> : null
  const next = edited && typeof edited === 'object' && !Array.isArray(edited) ? edited as Record<string, unknown> : null
  if (!base || !next) return {}
  const overridesDelta: Record<string, unknown> = {}
  const keys = new Set([...Object.keys(base), ...Object.keys(next)])
  for (const key of keys) {
    if (!sameValue(base[key], next[key])) overridesDelta[key] = next[key]
  }
  return Object.keys(overridesDelta).length
    ? { effectiveArgs: next, overridesDelta }
    : {}
}
