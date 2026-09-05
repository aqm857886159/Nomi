import { resolveCapabilityAlias } from '../../../../electron/shared/agentCapabilities/registry'
import type { TranslationKey } from '../../../i18n/translationKey'
import type { ProjectAgentStatus } from '../../../../electron/shared/projectAgentContracts'
import { normalizeResidentToolProjection, type ResidentToolProjection } from './residentToolProjection'
import type { ResidentApprovalDetail, ResidentProposalData } from './residentProposalDisplay'

type Translate = (key: string, options?: Record<string, unknown>) => string

const SEMANTIC_GENERATION_TOOL_NAMES = new Set([
  'nomi_get_generation_context',
  'nomi_operation_create',
  'nomi_submit_generation_plan',
  'nomi_preview_execution',
  'nomi_request_generation_gate',
  'nomi_start_generation',
  'nomi_operation_read',
  'nomi_cancel_generation',
  'nomi_reconcile_generation',
])

export function isGenerationToolName(name: string): boolean {
  const normalized = name.toLowerCase()
  return SEMANTIC_GENERATION_TOOL_NAMES.has(normalized)
    || normalized.includes('generation')
    || normalized.includes('image')
    || normalized.includes('video')
}
/**
 * What this tool call actually does — name **and** `args.operation` together.
 *
 * After the MCP surface collapse the tool name is generic (`nomi_canvas_maintenance`,
 * `nomi_canvas_edit`, `nomi_canvas_plan`, …) and the semantics moved into `args.operation`. Every
 * recognizer below used to substring-match the name alone, so a real `delete_canvas_nodes` arriving
 * as `nomi_canvas_maintenance` matched nothing and fell through to the generic
 * `agentResident.toolInspectDetails` label. Measured 2026-09-06: the approval card for an
 * irreversible canvas delete named neither the action nor the count — a human was asked to approve a
 * destructive write with no information about what it destroyed.
 *
 * Matching on both halves fixes every branch at once, and keeps working for the pi-side aliases whose
 * names still carry the operation.
 */
function toolIdentity(name: string, args?: unknown): string {
  const record = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {}
  const operation = typeof record.operation === 'string' ? record.operation : ''
  // Ask the registry that owns the tool what it is before falling back to reading its name. Every
  // surface names the same capability differently — pi says `apply_edit_plan` / `insert_at_cursor`,
  // MCP says `nomi_timeline_edit` / `nomi_document_edit` — and matching those by hand is how the
  // recognisers drifted in the first place. The canonical contract id (`timeline.write`,
  // `document.write`, …) is the one name that does not move.
  return `${canonicalCapabilityId(name)} ${name} ${operation}`.toLowerCase()
}

function canonicalCapabilityId(name: string): string {
  return resolveCapabilityAlias(name)?.contract.id ?? ''
}

/** True for canvas *creation* only. A delete is not a write here — it has its own, louder treatment. */
export function isCanvasWriteToolName(name: string, args?: unknown): boolean {
  const normalized = toolIdentity(name, args)
  if (isCanvasDeleteToolName(name, args)) return false
  return normalized.includes('create_canvas_nodes') || normalized.includes('canvas.write') || normalized.includes('canvas_nodes')
}

/**
 * Read-only tools. They had no branch of their own in `readableToolPreview`, so every read fell
 * through to the generic `toolInspectDetails` — the row for "read the draft" said the same thing as
 * the row for a tool nobody could identify. A read's honest effect line is that nothing changes.
 */
export function isReadOnlyToolName(name: string, args?: unknown): boolean {
  // When the registry owns this name its contract id is authoritative: `propose_edit_plan` is a
  // `timeline.read` despite the word "edit" in the alias, and no word-matching gets that right.
  const canonical = canonicalCapabilityId(name)
  if (canonical) return canonical.endsWith('.read')
  const normalized = toolIdentity(name, args)
  if (/write|edit|delete|create|apply|maintenance/.test(normalized)) return false
  // `nomi_export_job` publishes only `status` / `verify` today — the Host starts and cancels exports,
  // this tool can only ask about them. If it ever gains a write operation, that operation must be
  // matched above (the `write|edit|…` guard) rather than quietly inheriting this read classification.
  return /(?:^|[._])read(?:$|[._\s])/.test(normalized) || normalized.includes('media_query')
    || normalized.includes('operation_preview') || normalized.includes('export_job')
}

/**
 * Deletes must be recognised before writes: `canvas_nodes` is a substring of `delete_canvas_nodes`,
 * so the write matcher swallowed every delete that carried the operation in its name, and
 * `readableToolPreview`'s delete branch had been unreachable for that alias the whole time.
 */
export function isCanvasDeleteToolName(name: string, args?: unknown): boolean {
  const normalized = toolIdentity(name, args)
  return normalized.includes('delete_canvas_nodes') || normalized.includes('canvas.delete')
}

// 整键，不拼命名空间（拼接会让死键门岗对整棵 agentResident 失明）。
// 用 `as const satisfies`（而不是把 TranslationKey 当值类型标注）：TranslationKey 只适合做**约束**，
// 标注成值类型会把字面量擦成它自身、`t()` 收不了。见 src/i18n/translationKey.ts。
const READABLE_PARAMETER_LABELS = {
  size: 'agentResident.toolParameterSize',
  aspectRatio: 'agentResident.toolParameterAspectRatio',
  aspect_ratio: 'agentResident.toolParameterAspectRatio',
  duration: 'agentResident.toolParameterDuration',
  fps: 'agentResident.toolParameterFrameRate',
  frameRate: 'agentResident.toolParameterFrameRate',
  quality: 'agentResident.toolParameterQuality',
  count: 'agentResident.toolParameterCount',
  copies: 'agentResident.toolParameterCount',
  resolution: 'agentResident.toolParameterResolution',
  negative_prompt: 'agentResident.toolParameterNegativePrompt',
  negativePrompt: 'agentResident.toolParameterNegativePrompt',
  // The model's own justification. It is the single most useful thing on an approval card and it was
  // being swallowed into the anonymous "other settings" count.
  reason: 'agentResident.toolParameterReason',
  seed: 'agentResident.toolParameterSeed',
  steps: 'agentResident.toolParameterSteps',
  guidance_scale: 'agentResident.toolParameterGuidance',
  guidanceScale: 'agentResident.toolParameterGuidance',
} as const satisfies Record<string, TranslationKey>

type ParameterLabelKey = (typeof READABLE_PARAMETER_LABELS)[keyof typeof READABLE_PARAMETER_LABELS]

// `operation` is already what the card is titled with; counting it as an anonymous "other setting"
// turned a delete card into "生成设置：其他设置 2 项" and buried the model's own stated reason with it.
const TOOL_CONTEXT_KEYS = new Set(['model', 'modelKey', 'modelId', 'providerId', 'moduleId', 'variantId', 'prompt', 'text', 'content', 'nodes', 'edges', 'nodeIds', 'clientId', 'title', 'kind', 'summary', 'parameters', 'candidate', 'patch', 'shots', 'references', 'scriptText', 'operationId', 'taskKind', 'mode', 'modeId', 'leaseHandle', 'operation'])

function readableParameterValue(t: Translate, value: unknown): string {
  if (typeof value === 'boolean') return value ? t('agentResident.toolParameterOn') : t('agentResident.toolParameterOff')
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return ''
}

/** Keep internal schema keys out of the first layer; controls expose exact values later. */
function readableParameters(t: Translate, record: Record<string, unknown>): string {
  const readable: string[] = []
  let hidden = 0
  for (const [key, rawValue] of Object.entries(record)) {
    if (TOOL_CONTEXT_KEYS.has(key)) continue
    const value = readableParameterValue(t, rawValue)
    if (!value) continue
    const labelKey = (READABLE_PARAMETER_LABELS as Record<string, ParameterLabelKey | undefined>)[key]
    if (!labelKey) {
      hidden += 1
      continue
    }
    readable.push(`${t(labelKey)}: ${value}`)
  }
  if (hidden) readable.push(t('agentResident.toolParameterHidden', { count: hidden }))
  return readable.join(' · ')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Generation tools keep effective settings under patch/candidate/parameters or per-shot records. */
function nestedParameterRecords(record: Record<string, unknown>): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []
  const patch = asRecord(record.patch)
  if (patch) {
    records.push(patch)
    const patchParameters = asRecord(patch.parameters)
    if (patchParameters) records.push(patchParameters)
  }
  const parameters = asRecord(record.parameters)
  if (parameters) records.push(parameters)
  const candidate = asRecord(record.candidate)
  if (candidate) {
    records.push(candidate)
    const candidateParameters = asRecord(candidate.parameters)
    if (candidateParameters) records.push(candidateParameters)
  }
  const shots = Array.isArray(record.shots) ? record.shots : []
  for (const shot of shots) {
    const shotRecord = asRecord(shot)
    if (!shotRecord) continue
    records.push(shotRecord)
    const shotCandidate = asRecord(shotRecord.candidate)
    if (shotCandidate) {
      records.push(shotCandidate)
      const shotCandidateParameters = asRecord(shotCandidate.parameters)
      if (shotCandidateParameters) records.push(shotCandidateParameters)
    }
    const shotParameters = asRecord(shotRecord.parameters)
    if (shotParameters) records.push(shotParameters)
  }
  return records
}

function readableParameterSummary(t: Translate, record: Record<string, unknown>, proposal = false): string {
  const formatter = proposal ? readableProposalParameters : readableParameters
  return [formatter(t, record), ...nestedParameterRecords(record).map((nested) => formatter(t, nested))]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(' · ')
}

export function readableToolName(t: Translate, name: string, args?: unknown): string {
  const normalized = toolIdentity(name, args)
  if (isCanvasDeleteToolName(name, args)) return t('agentResident.toolCanvasDelete')
  if (normalized.includes('append_to_end') || normalized.includes('document_append')) return t('agentResident.toolDocumentWrite')
  if (normalized.includes('create_canvas_nodes') || normalized.includes('canvas_nodes')) return t('agentResident.toolCanvasWrite')
  if (normalized.includes('document.read') || normalized.includes('document_read')) return t('agentResident.toolDocumentRead')
  if (normalized.includes('document.write') || normalized.includes('document_edit')) return t('agentResident.toolDocumentWrite')
  if (normalized.includes('canvas.read') || normalized.includes('canvas_read')) return t('agentResident.toolCanvasRead')
  if (normalized.includes('canvas.write') || normalized.includes('canvas_edit')) return t('agentResident.toolCanvasWrite')
  if (normalized.includes('timeline.read') || normalized.includes('timeline_read')) return t('agentResident.toolTimelineRead')
  if (normalized.includes('timeline.write') || normalized.includes('timeline_edit')) return t('agentResident.toolTimelineWrite')
  if (normalized.includes('asset.read') || normalized.includes('media_query')) return t('agentResident.toolAssetRead')
  if (normalized.includes('production.artifact')) return t('agentResident.toolArtifactRevise')
  if (normalized.includes('production.run.read')) return t('agentResident.toolProductionRead')
  if (normalized.includes('production.run.write')) return t('agentResident.toolProductionWrite')
  if (normalized.includes('skill.read')) return t('agentResident.toolSkillRead')
  if (normalized.includes('skill.write')) return t('agentResident.toolSkillWrite')
  if (normalized.includes('layout_read') || normalized.includes('layout.read')) return t('agentResident.toolLayoutRead')
  if (normalized.includes('layout_write') || normalized.includes('layout.write')) return t('agentResident.toolLayoutWrite')
  if (normalized.includes('asset_import')) return t('agentResident.toolAssetImport')
  if (normalized.includes('nomi_read')) return t('agentResident.toolProjectRead')
  if (normalized.includes('export')) return t('agentResident.toolExport')
  if (isGenerationToolName(name)) return t('agentResident.toolGeneration')
  return t('agentResident.toolGeneric')
}

export function readableToolSummary(t: Translate, name: string, args?: unknown): string {
  const normalized = toolIdentity(name, args)
  const record = args && typeof args === 'object' ? args as Record<string, unknown> : {}
  const patch = asRecord(record.patch) ?? {}
  const candidate = asRecord(record.candidate) ?? {}
  const model = typeof record.model === 'string' ? record.model : typeof record.modelKey === 'string' ? record.modelKey : typeof record.modelId === 'string' ? record.modelId : typeof record.variantId === 'string' ? record.variantId : typeof patch.model === 'string' ? patch.model : typeof patch.modelKey === 'string' ? patch.modelKey : typeof patch.modelId === 'string' ? patch.modelId : typeof patch.variantId === 'string' ? patch.variantId : typeof candidate.model === 'string' ? candidate.model : typeof candidate.modelKey === 'string' ? candidate.modelKey : typeof candidate.modelId === 'string' ? candidate.modelId : typeof candidate.variantId === 'string' ? candidate.variantId : ''
  const prompt = typeof record.prompt === 'string' ? record.prompt : typeof record.text === 'string' ? record.text : typeof record.scriptText === 'string' ? record.scriptText : typeof patch.prompt === 'string' ? patch.prompt : typeof candidate.prompt === 'string' ? candidate.prompt : ''
  const parameters = readableParameterSummary(t, record)
  const modelKind = model.toLowerCase().includes('video') ? t('agentResident.toolVideoModel') : model.toLowerCase().includes('image') ? t('agentResident.toolImageModel') : ''
  const details = [model ? `${modelKind || t('agentResident.toolModel', { model })}${modelKind ? ` (${model})` : ''}` : '', parameters ? t('agentResident.toolParameters', { parameters }) : '', prompt ? t('agentResident.toolPrompt', { prompt: prompt.slice(0, 96) }) : ''].filter(Boolean).join(' · ')
  const shotCards = Array.isArray(record.nodes) ? record.nodes.slice(0, 4).map((node) => {
    if (!node || typeof node !== 'object') return ''
    const shot = node as Record<string, unknown>
    const title = typeof shot.title === 'string' ? shot.title : t('agentResident.untitledShot')
    const shotModelKey = typeof shot.modelKey === 'string' ? shot.modelKey : ''
    const shotModel = shotModelKey ? (shotModelKey.toLowerCase().includes('video') ? t('agentResident.toolVideoModel') : shotModelKey.toLowerCase().includes('image') ? t('agentResident.toolImageModel') : shotModelKey) : ''
    const shotPrompt = typeof shot.prompt === 'string' ? shot.prompt.slice(0, 72) : ''
    const shotParams = shot.params && typeof shot.params === 'object' ? readableParameters(t, shot.params as Record<string, unknown>) : ''
    return [title, shotModel, shotParams, shotPrompt].filter(Boolean).join(' · ')
  }).filter(Boolean).join(' | ') : ''
  const relations = Array.isArray(record.edges) && record.edges.length ? t('agentResident.toolReferences', { count: record.edges.length }) : ''
  if (isCanvasDeleteToolName(name, args)) return t('agentResident.toolCanvasDeleteSummary')
  if (normalized.includes('append_to_end') || normalized.includes('document.write') || normalized.includes('document_edit') || normalized.includes('document_append')) return details ? `${t('agentResident.toolDocumentWriteSummary')} · ${details}` : t('agentResident.toolDocumentWriteSummary')
  if (isCanvasWriteToolName(name, args)) return [t('agentResident.toolCanvasWriteSummary'), shotCards ? t('agentResident.toolShotConfig', { details: shotCards }) : '', relations, t('agentResident.toolNoGeneration'), details].filter(Boolean).join(' · ')
  if (normalized.includes('timeline.write') || normalized.includes('timeline_edit')) return details ? `${t('agentResident.toolTimelineWriteSummary')} · ${details}` : t('agentResident.toolTimelineWriteSummary')
  if (isGenerationToolName(name)) return details ? `${t('agentResident.toolGenerationSummary')} · ${details}` : t('agentResident.toolGenerationSummary')
  return details || t('agentResident.toolPendingSummary')
}

export function readableToolPreview(t: Translate, name: string, args?: unknown): string {
  const normalized = toolIdentity(name, args)
  const record = args && typeof args === 'object' ? args as Record<string, unknown> : {}
  if (normalized.includes('append_to_end') || normalized.includes('document.write') || normalized.includes('document_edit') || normalized.includes('document_append')) return typeof record.content === 'string' && record.content.trim() ? t('agentResident.toolContentCount', { count: 1 }) : t('agentResident.toolInspectDetails')
  if (isCanvasDeleteToolName(name, args)) {
    const count = Array.isArray(record.nodeIds) ? record.nodeIds.length : 0
    return count ? t('agentResident.toolTargetCount', { count }) : t('agentResident.toolInspectDetails')
  }
  if (isCanvasWriteToolName(name, args)) {
    const nodes = Array.isArray(record.nodes) ? record.nodes.length : 0
    const edges = Array.isArray(record.edges) ? record.edges.length : 0
    return [nodes ? t('agentResident.toolShotCount', { count: nodes }) : '', edges ? t('agentResident.toolRelationCount', { count: edges }) : '', t('agentResident.toolNoGenerationShort')].filter(Boolean).join(' · ') || t('agentResident.toolInspectDetails')
  }

  if (normalized.includes('timeline.write') || normalized.includes('timeline_edit')) return t('agentResident.toolTimelineWriteSummary')
  if (isGenerationToolName(name)) return t('agentResident.toolGenerationSummary')
  if (normalized.includes('layout_write') || normalized.includes('layout.write')) return t('agentResident.toolLayoutWriteSummary')
  if (normalized.includes('asset_import')) return t('agentResident.toolAssetImportSummary')
  if (isReadOnlyToolName(name, args)) return t('agentResident.toolReadNoChange')
  return t('agentResident.toolInspectDetails')
}

export function readableToolTarget(t: Translate, name: string, args?: unknown): string {
  const normalized = toolIdentity(name, args)
  const record = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {}
  if (Array.isArray(record.nodeIds) && record.nodeIds.length) return t('agentResident.targetShotCount', { count: record.nodeIds.length })
  if (Array.isArray(record.nodes) && record.nodes.length) return t('agentResident.targetShotCount', { count: record.nodes.length })
  if (Array.isArray(record.shots) && record.shots.length) return t('agentResident.targetShotCount', { count: record.shots.length })
  if (Array.isArray(record.clipIds) && record.clipIds.length) return t('agentResident.targetClipCount', { count: record.clipIds.length })
  if ((typeof record.runId === 'string' && record.runId.trim()) || (typeof record.operationId === 'string' && record.operationId.trim())) return t('agentResident.targetProductionRun')
  if (typeof record.documentId === 'string' && record.documentId.trim()) return t('agentResident.targetDocument')
  if (normalized.includes('timeline') || normalized.includes('export')) return t('agentResident.targetTimeline')
  if (normalized.includes('canvas') || isGenerationToolName(name)) return t('agentResident.targetCanvas')
  if (normalized.includes('document')) return t('agentResident.targetDocument')
  return t('agentResident.targetCurrentScene')
}

function readableEstimate(t: Translate, record: Record<string, unknown>): string {
  const raw = record.estimatedCost ?? record.estimated_cost ?? record.cost ?? record.price ?? record.credits
  if (typeof raw === 'number' && Number.isFinite(raw)) return t('agentResident.proposalEstimateAmount', { amount: raw.toFixed(2) })
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const amount = (raw as Record<string, unknown>).amount
    const currency = (raw as Record<string, unknown>).currency
    if ((typeof amount === 'number' || typeof amount === 'string') && String(amount).trim()) return `${currency ? `${String(currency)} ` : ''}${String(amount)}`
  }
  return t('agentResident.costUnknown')
}

function readableProposalModel(t: Translate, model: string): string {
  const normalized = model.toLowerCase()
  const machineId = normalized.includes('agent-runtime') || normalized.includes('/')
  if (machineId && normalized.includes('image')) return t('agentResident.toolImageModel')
  if (machineId && normalized.includes('video')) return t('agentResident.toolVideoModel')
  if (machineId && normalized.includes('text')) return t('agentResident.proposalText')
  return model
}

function readableProposalParameters(t: Translate, record: Record<string, unknown>): string {
  return readableParameters(t, record)
    .replace(/21:9/g, t('agentResident.proposalAspectCinematic'))
    .replace(/16:9/g, t('agentResident.proposalAspectLandscape'))
    .replace(/9:16/g, t('agentResident.proposalAspectPortrait'))
    .replace(/1:1/g, t('agentResident.proposalAspectSquare'))
}

export function proposalForTool(t: Translate, name: string, args?: unknown): ResidentProposalData | undefined {
  const record = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {}
  const generationLike = isGenerationToolName(name) || isCanvasWriteToolName(name, record)
  if (!generationLike) return undefined
  const nodes = Array.isArray(record.nodes) ? record.nodes.filter((node): node is Record<string, unknown> => Boolean(node && typeof node === 'object' && !Array.isArray(node))) : []
  const shots = Array.isArray(record.shots) ? record.shots.map(asRecord).filter((shot): shot is Record<string, unknown> => Boolean(shot)) : []
  const candidate = asRecord(record.candidate)
  const patch = asRecord(record.patch)
  const prompts = [
    typeof record.prompt === 'string' ? record.prompt.trim() : '',
    typeof record.text === 'string' ? record.text.trim() : '',
    typeof record.scriptText === 'string' ? record.scriptText.trim() : '',
    typeof patch?.prompt === 'string' ? patch.prompt.trim() : '',
    typeof candidate?.prompt === 'string' ? candidate.prompt.trim() : '',
    ...nodes.map((node) => typeof node.prompt === 'string' ? node.prompt.trim() : ''),
    ...shots.map((shot) => typeof shot.prompt === 'string' ? shot.prompt.trim() : ''),
    ...shots.map((shot) => asRecord(shot.candidate)).map((shotCandidate) => typeof shotCandidate?.prompt === 'string' ? shotCandidate.prompt.trim() : ''),
  ].filter(Boolean)
  const models = [
    typeof record.model === 'string' ? record.model.trim() : '',
    typeof record.modelKey === 'string' ? record.modelKey.trim() : '',
    typeof record.modelId === 'string' ? record.modelId.trim() : '',
    typeof record.variantId === 'string' ? record.variantId.trim() : '',
    typeof patch?.model === 'string' ? patch.model.trim() : '',
    typeof patch?.modelKey === 'string' ? patch.modelKey.trim() : '',
    typeof patch?.modelId === 'string' ? patch.modelId.trim() : '',
    typeof patch?.variantId === 'string' ? patch.variantId.trim() : '',
    typeof candidate?.model === 'string' ? candidate.model.trim() : '',
    typeof candidate?.modelKey === 'string' ? candidate.modelKey.trim() : '',
    typeof candidate?.modelId === 'string' ? candidate.modelId.trim() : '',
    typeof candidate?.variantId === 'string' ? candidate.variantId.trim() : '',
    ...nodes.map((node) => typeof node.modelKey === 'string' ? node.modelKey.trim() : ''),
    ...shots.map((shot) => typeof shot.modelId === 'string' ? shot.modelId.trim() : ''),
    ...shots.map((shot) => typeof shot.variantId === 'string' ? shot.variantId.trim() : ''),
    ...shots.map((shot) => { const shotCandidate = asRecord(shot.candidate); return typeof shotCandidate?.modelId === 'string' ? shotCandidate.modelId.trim() : '' }),
    ...shots.map((shot) => { const shotCandidate = asRecord(shot.candidate); return typeof shotCandidate?.variantId === 'string' ? shotCandidate.variantId.trim() : '' }),
  ].filter(Boolean)
  const parameterParts = [
    readableParameterSummary(t, record, true),
    ...nodes.map((node) => node.params && typeof node.params === 'object' && !Array.isArray(node.params) ? readableProposalParameters(t, node.params as Record<string, unknown>) : ''),
  ].filter(Boolean)
  const referenceCount = [
    record.references,
    patch?.references,
    candidate?.references,
    ...shots.map((shot) => shot.references),
    ...shots.map((shot) => asRecord(shot.candidate)?.references),
  ].reduce<number>((count, value) => count + (Array.isArray(value) ? value.length : 0), 0)
  const fields: ResidentApprovalDetail[] = []
  if (prompts.length) fields.push({ label: t('agentResident.proposalPrompt'), value: prompts.slice(0, 2).join(' · '), kind: 'prompt' })
  fields.push({ label: t('agentResident.proposalModel'), value: models.length ? Array.from(new Set(models.map((model) => readableProposalModel(t, model)))).join(' · ') : t('agentResident.modelAuto'), kind: 'model' })
  fields.push({ label: t('agentResident.proposalParameters'), value: parameterParts.length ? parameterParts.join(' · ') : t('agentResident.proposalParametersPending'), kind: 'parameters' })
  fields.push({ label: t('agentResident.proposalEstimate'), value: readableEstimate(t, record), kind: 'estimate' })
  fields.push({ label: t('agentResident.proposalTarget'), value: readableToolTarget(t, name, record), kind: 'target' })
  if (referenceCount) fields.push({ label: t('agentResident.referencesLabel'), value: t('agentResident.proposalReferences', { count: referenceCount }), kind: 'references' })
  fields.push({ label: t('agentResident.proposalBoundary'), value: isCanvasWriteToolName(name, record) ? t('agentResident.boundaryCanvasOnly') : t('agentResident.boundaryGeneration'), kind: 'boundary' })
  return { fields }
}

export function readableToolDetailRows(t: Translate, name: string, args?: unknown): readonly ResidentApprovalDetail[] {
  const normalized = name.toLowerCase()
  const record = args && typeof args === 'object' ? args as Record<string, unknown> : {}
  const rows: ResidentApprovalDetail[] = []
  rows.push({ label: t('agentResident.toolTargetLabel'), value: readableToolTarget(t, name, record), kind: 'target' })
  if (typeof record.content === 'string' && record.content.trim()) rows.push({ label: t('agentResident.toolContentLabel'), value: record.content.trim(), kind: 'prompt' })
  const nodes = Array.isArray(record.nodes) ? record.nodes : []
  if (nodes.length) {
    const shots = nodes.slice(0, 4).map((node) => {
      if (!node || typeof node !== 'object') return ''
      const shot = node as Record<string, unknown>
      const title = typeof shot.title === 'string' ? shot.title : t('agentResident.untitledShot')
      const model = typeof shot.modelKey === 'string' ? shot.modelKey : ''
      const prompt = typeof shot.prompt === 'string' ? shot.prompt : ''
      const params = shot.params && typeof shot.params === 'object' ? readableParameters(t, shot.params as Record<string, unknown>) : ''
      return [title, model, params, prompt].filter(Boolean).join(' · ')
    }).filter(Boolean).join(' | ')
    if (shots) rows.push({ label: t('agentResident.toolShotLabel'), value: shots, kind: 'target' })
  }
  if (Array.isArray(record.edges) && record.edges.length) {
    const titles = new Map(nodes.map((node) => {
      const shot = node && typeof node === 'object' ? node as Record<string, unknown> : {}
      return [typeof shot.clientId === 'string' ? shot.clientId : '', typeof shot.title === 'string' ? shot.title : t('agentResident.untitledShot')] as const
    }))
    const relations = record.edges.slice(0, 4).map((edge) => {
      if (!edge || typeof edge !== 'object') return ''
      const relation = edge as Record<string, unknown>
      const source = typeof relation.sourceClientId === 'string' ? relation.sourceClientId : ''
      const target = typeof relation.targetClientId === 'string' ? relation.targetClientId : ''
      const mode = relation.mode === 'reference' ? t('agentResident.referenceRelation') : typeof relation.mode === 'string' ? relation.mode : t('agentResident.referenceRelation')
      return `${titles.get(source) || source || t('agentResident.untitledShot')} → ${titles.get(target) || target || t('agentResident.untitledShot')} · ${mode}`
    }).filter(Boolean)
    rows.push({ label: t('agentResident.toolRelationLabel'), value: relations.join(' | ') || t('agentResident.toolRelationCount', { count: record.edges.length }), kind: 'target' })
  }
  if (isCanvasWriteToolName(name, args)) rows.push({ label: t('agentResident.toolBoundaryLabel'), value: t('agentResident.toolNoGeneration'), kind: 'boundary' })
  const patch = asRecord(record.patch)
  const candidate = asRecord(record.candidate)
  const modelValues = [record.model, record.modelKey, record.modelId, record.variantId, patch?.model, patch?.modelKey, patch?.modelId, patch?.variantId, candidate?.model, candidate?.modelKey, candidate?.modelId, candidate?.variantId].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  if (modelValues.length) rows.push({ label: t('agentResident.toolModelLabel'), value: Array.from(new Set(modelValues)).join(' · '), kind: 'model' })
  const promptValues = [record.prompt, record.text, record.scriptText, patch?.prompt, candidate?.prompt].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  if (promptValues.length) rows.push({ label: t('agentResident.toolPromptLabel'), value: Array.from(new Set(promptValues)).join(' · '), kind: 'prompt' })
  if (!nodes.length && Array.isArray(record.shots) && record.shots.length) rows.push({ label: t('agentResident.toolShotLabel'), value: t('agentResident.targetShotCount', { count: record.shots.length }), kind: 'target' })
  const parameterEntries = readableParameterSummary(t, record)
  // 「生成设置」 on a delete card is inherited from the generation path and is plainly wrong there —
  // nothing is being generated. Label the row for what this tool actually is.
  if (parameterEntries) rows.push({ label: t(isGenerationToolName(name) ? 'agentResident.toolParametersLabel' : 'agentResident.toolOperationDetailsLabel'), value: parameterEntries, kind: 'parameters' })
  if (isGenerationToolName(name) || normalized.includes('canvas.write')) rows.push({ label: t('agentResident.proposalEstimate'), value: readableEstimate(t, record), kind: 'estimate' })
  if (!rows.length && isCanvasDeleteToolName(name, args)) rows.push({ label: t('agentResident.toolTargetLabel'), value: t('agentResident.toolTargetCount', { count: Array.isArray(record.nodeIds) ? record.nodeIds.length : 0 }), kind: 'target' })
  if (!rows.length) rows.push({ label: t('agentResident.toolDetailLabel'), value: readableToolSummary(t, name, args), kind: 'technical' })
  return rows
}

export function readableToolResult(t: Translate, status: ProjectAgentStatus): string {
  if (status === 'done') return t('agentResident.toolCompleted')
  if (status === 'failed') return t('agentResident.toolFailed')
  if (status === 'declined') return t('agentResident.toolDeclined')
  if (status === 'stopped') return t('agentResident.toolStopped')
  if (status === 'proposed') return t('agentResident.waitingApproval')
  if (status === 'running') return t('agentResident.toolRunning')
  return t('agentResident.toolPendingSummary')
}

export function residentToolProjectionForCall(t: Translate, name: string, args: unknown, status: ProjectAgentStatus): ResidentToolProjection {
  return normalizeResidentToolProjection({
    effect: readableToolPreview(t, name, args) || readableToolResult(t, status),
    target: readableToolTarget(t, name, args),
    technicalDetails: readableToolSummary(t, name, args) || readableToolResult(t, status),
  })
}
