import type { ModelParameterControl } from '../../../config/modelCatalogMeta'

export type GenerationProposalNode = {
  clientId?: string
  kind?: string
  title?: string
  prompt?: string
  modelKey?: string
  /** Catalog routing identity emitted by the approval editor. */
  vendor?: string
  /** Backward-compatible alias of `vendor`; both are normalized before write. */
  modelVendor?: string
  modeId?: string
  variantId?: string
  params?: Record<string, string | number | boolean>
  [key: string]: unknown
}

export type GenerationProposalArgs = {
  nodes: GenerationProposalNode[]
  [key: string]: unknown
}

/**
 * Semantic generation calls (`nomi_operation_create` / `nomi_submit_generation_plan`)
 * carry the same editable values as a real generation node, but they do not
 * have a `nodes` envelope. Keep this shape separate from the canvas proposal
 * type so canvas callers cannot accidentally accept an unvalidated semantic
 * payload.
 */
export type SemanticGenerationProposalArgs = {
  [key: string]: unknown
  prompt?: string
  taskKind?: string
  moduleId?: string
  providerId?: string
  modelId?: string
  mode?: string
  modeId?: string
  variantId?: string
  parameters?: Record<string, unknown>
  references?: unknown[]
  shots?: unknown[]
  patch?: Record<string, unknown>
  candidate?: Record<string, unknown>
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

const SEMANTIC_EDIT_KEYS = new Set([
  'prompt', 'taskKind', 'moduleId', 'providerId', 'modelId', 'mode', 'modeId',
  'variantId', 'parameters', 'references', 'shots', 'scriptText', 'candidate',
])
const SEMANTIC_TOOL_NAMES = new Set(['nomi_operation_create', 'nomi_submit_generation_plan'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasEditableSemanticValue(value: Record<string, unknown>): boolean {
  return [...SEMANTIC_EDIT_KEYS].some((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function validPrimitiveRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.values(value).every((item) =>
    item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
      || (typeof item === 'object' && item !== null && !Array.isArray(item)),
  )
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) return {}
  const nested = value[key]
  return isRecord(nested) ? nested : {}
}

/** Parse a semantic proposal without accepting operation/lease bookkeeping as editable content. */
export function asSemanticGenerationProposalArgs(value: unknown): SemanticGenerationProposalArgs | null {
  if (!isRecord(value)) return null
  const patch = value.patch
  const candidate = value.candidate
  if (patch !== undefined && !validPrimitiveRecord(patch)) return null
  if (candidate !== undefined && !validPrimitiveRecord(candidate)) return null
  if (value.parameters !== undefined && !validPrimitiveRecord(value.parameters)) return null
  if (value.references !== undefined && !Array.isArray(value.references)) return null
  if (value.shots !== undefined && !Array.isArray(value.shots)) return null
  const editable = hasEditableSemanticValue(value)
    || (isRecord(patch) && hasEditableSemanticValue(patch))
    || (isRecord(candidate) && hasEditableSemanticValue(candidate))
  if (!editable) return null
  return {
    ...value,
    ...(isRecord(value.parameters) ? { parameters: { ...value.parameters } } : {}),
    ...(Array.isArray(value.references) ? { references: [...value.references] } : {}),
    ...(Array.isArray(value.shots) ? { shots: [...value.shots] } : {}),
    ...(isRecord(patch) ? { patch: { ...patch } } : {}),
    ...(isRecord(candidate) ? { candidate: { ...candidate } } : {}),
  }
}

function semanticEditTarget(args: SemanticGenerationProposalArgs): 'patch' | 'candidate' | 'root' {
  if (isRecord(args.patch) && hasEditableSemanticValue(args.patch)) return 'patch'
  if (isRecord(args.candidate) && hasEditableSemanticValue(args.candidate)) return 'candidate'
  return 'root'
}

/** Update a top-level semantic field while preserving operationId and other Host metadata. */
export function updateSemanticGenerationField(
  args: SemanticGenerationProposalArgs,
  key: string,
  value: unknown,
): SemanticGenerationProposalArgs {
  const target = semanticEditTarget(args)
  if (target === 'patch') return { ...args, patch: { ...(args.patch || {}), [key]: value } }
  if (target === 'candidate') return { ...args, candidate: { ...(args.candidate || {}), [key]: value } }
  return { ...args, [key]: value }
}

export function updateSemanticGenerationParameters(
  args: SemanticGenerationProposalArgs,
  patch: Record<string, unknown>,
): SemanticGenerationProposalArgs {
  const target = semanticEditTarget(args)
  if (target === 'patch') return { ...args, patch: { ...(args.patch || {}), parameters: { ...nestedRecord(args.patch, 'parameters'), ...patch } } }
  if (target === 'candidate') return { ...args, candidate: { ...(args.candidate || {}), parameters: { ...nestedRecord(args.candidate, 'parameters'), ...patch } } }
  return { ...args, parameters: { ...nestedRecord(args, 'parameters'), ...patch } }
}

export function updateSemanticGenerationReferences(
  args: SemanticGenerationProposalArgs,
  references: readonly unknown[],
): SemanticGenerationProposalArgs {
  const target = semanticEditTarget(args)
  if (target === 'patch') return { ...args, patch: { ...(args.patch || {}), references: [...references] } }
  if (target === 'candidate') return { ...args, candidate: { ...(args.candidate || {}), references: [...references] } }
  return { ...args, references: [...references] }
}

/** Update a shot's semantic fields without mutating the original approval payload. */
export function updateSemanticGenerationShot(
  args: SemanticGenerationProposalArgs,
  index: number,
  patch: Record<string, unknown>,
): SemanticGenerationProposalArgs {
  if (!Array.isArray(args.shots) || index < 0 || index >= args.shots.length) return args
  const shots = args.shots.map((shot, candidateIndex) => {
    if (candidateIndex !== index || !isRecord(shot)) return shot
    const nestedCandidate = isRecord(shot.candidate) ? shot.candidate : null
    const target = nestedCandidate && hasEditableSemanticValue(nestedCandidate) ? 'candidate' : 'shot'
    return target === 'candidate'
      ? { ...shot, candidate: { ...nestedCandidate, ...patch } }
      : { ...shot, ...patch }
  })
  return { ...args, shots }
}

export function isGenerationProposalTool(toolName: string, args: unknown): boolean {
  const normalized = toolName.toLowerCase()
  const canvas = (normalized.includes('create_canvas_nodes') || normalized.includes('canvas.write') || normalized.includes('canvas_nodes')) && Boolean(asGenerationProposalArgs(args))
  const semantic = SEMANTIC_TOOL_NAMES.has(normalized) && Boolean(asSemanticGenerationProposalArgs(args))
  return canvas || semantic
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
