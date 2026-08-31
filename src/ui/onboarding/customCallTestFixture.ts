import type { BillingModelKind } from '../../../electron/catalog/types'
import type { ArchetypeReferenceSlotKind } from '../../config/modelArchetypes'
import type { CustomCallScriptMode } from './customCallScriptModes'

export type CustomCallTestReferences = Partial<Record<ArchetypeReferenceSlotKind, string[]>>

export type MissingCustomCallTestReference = {
  kind: ArchetypeReferenceSlotKind
  label: string
  required: number
  provided: number
}

export type CustomCallTestFixture = {
  prompt: string
  params: Record<string, unknown>
  slots: CustomCallScriptMode['slots']
  missing: MissingCustomCallTestReference[]
  ready: boolean
}

function cleanUrls(values: readonly string[] | undefined, max: number): string[] {
  if (!values) return []
  return values.map((value) => value.trim()).filter(Boolean).slice(0, Math.max(0, max))
}

function defaultPrompt(kind: BillingModelKind): string {
  if (kind === 'text') return '把这段内容整理成三个清晰要点。'
  if (kind === 'audio') return '欢迎使用 Nomi。'
  if (kind === 'video') return '雨夜街头，镜头缓慢向前推进，光线自然。'
  if (kind === 'model3d') return '一个边缘圆润的红色旅行杯，白色背景。'
  return '一个放在木桌上的红苹果，自然柔光，细节清晰。'
}

function parameterDefaults(mode: CustomCallScriptMode | null, kind: BillingModelKind): Record<string, unknown> {
  const params: Record<string, unknown> = kind === 'image' ? { n: 1 } : kind === 'video' ? { duration: 5, n: 1 } : {}
  if (!mode) return params
  for (const parameter of mode.parameters) {
    const fallback = parameter.options[0]?.value
    const value = parameter.defaultValue ?? fallback
    if (value !== undefined) params[parameter.key] = value
  }
  return { ...params, ...mode.fixedParams }
}

function assignReferenceParams(
  params: Record<string, unknown>,
  kind: ArchetypeReferenceSlotKind,
  values: string[],
): void {
  if (values.length === 0) return
  if (kind === 'first_frame') params.first_frame_url = values[0]
  else if (kind === 'last_frame') params.last_frame_url = values[0]
  else if (kind === 'image_ref') {
    params.reference_image_urls = values
    params.reference_images = values
  } else if (kind === 'audio_ref') params.reference_audio_urls = values
  else {
    params.reference_video_urls = values
    if (kind === 'source_video') params.source_video_url = values[0]
  }
}

/**
 * Build the exact input shown in the script trial UI. Mode ids and vendor names are deliberately
 * opaque: the declared slots are the only source of reference requirements, so future modes work
 * without adding another if/else branch here.
 */
export function buildCustomCallTestFixture(input: {
  modelKind: BillingModelKind
  mode: CustomCallScriptMode | null
  references: CustomCallTestReferences
}): CustomCallTestFixture {
  const slots = input.mode?.slots ?? []
  const params = parameterDefaults(input.mode, input.modelKind)
  const missing: MissingCustomCallTestReference[] = []

  for (const slot of slots) {
    const values = cleanUrls(input.references[slot.kind], slot.max)
    assignReferenceParams(params, slot.kind, values)
    if (values.length < slot.min) {
      missing.push({ kind: slot.kind, label: slot.label, required: slot.min, provided: values.length })
    }
  }

  return {
    prompt: defaultPrompt(input.modelKind),
    params,
    slots,
    missing,
    ready: missing.length === 0,
  }
}
