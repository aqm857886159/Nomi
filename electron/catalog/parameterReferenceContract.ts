import { isComfyuiVendor } from './types'

export type ParameterReferenceGroup = 'first_frame' | 'last_frame' | 'reference'
export type ParameterReferenceSlot = {
  key: string
  label: string
  group: ParameterReferenceGroup
  mediaKind?: 'image' | 'video'
}
export type ParameterReferenceContract = {
  modelKey: string
  vendorKey: string
  slots: ParameterReferenceSlot[]
}
/**
 * `modelKey` 是**目录身份**（选哪条 mapping / 比对 comfy 契约用）。
 * `wireModelKey` 是**要发到线上的 model 串的回落值**——与 `{{model.modelKey}}` 同一个表达式
 * （modelAlias 优先、否则 modelKey）。两者语义不同故不能合并：comfy 契约必须按目录身份比对，
 * 而线上字段必须跟别名走。taskTemplateParams 用它给没有变体的模型补 params.model（见那边注释）。
 */
export type ParameterReferenceSelection = { modelKey?: string; vendorKey: string; wireModelKey?: string }

const DECLARATION_KEY = 'parameterReferenceSlots'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function parameterReferenceModelIdentity(meta: Record<string, unknown>): { modelKey: string; vendorKey: string } {
  return {
    modelKey: text(meta.modelKey) || text(meta.modelAlias) || text(meta.imageModel) || text(meta.videoModel),
    vendorKey: text(meta.modelVendor) || text(meta.vendor) || text(meta.imageModelVendor) || text(meta.videoModelVendor),
  }
}

/** Read and validate the persisted declaration against the node/request identity. */
export function readParameterReferenceContract(meta: Record<string, unknown> | undefined): ParameterReferenceContract | null {
  if (!meta) return null
  const declaration = record(meta[DECLARATION_KEY])
  const identity = parameterReferenceModelIdentity(meta)
  if (declaration.modelKey !== identity.modelKey || declaration.vendorKey !== identity.vendorKey) return null
  if (!Array.isArray(declaration.slots)) return null
  const seen = new Set<string>()
  const slots: ParameterReferenceSlot[] = []
  for (const value of declaration.slots) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const slot = value as Record<string, unknown>
    if (typeof slot.key !== 'string' || typeof slot.label !== 'string' || typeof slot.group !== 'string') return null
    const key = slot.key.trim()
    if (!key || seen.has(key) || !['reference', 'first_frame', 'last_frame'].includes(slot.group)) return null
    if (slot.mediaKind !== undefined && slot.mediaKind !== 'image' && slot.mediaKind !== 'video') return null
    seen.add(key)
    slots.push({
      key,
      label: slot.label.trim() || key,
      group: slot.group as ParameterReferenceGroup,
      ...(slot.mediaKind === 'image' || slot.mediaKind === 'video' ? { mediaKind: slot.mediaKind } : {}),
    })
  }
  return { ...identity, slots }
}

export function readParameterReferenceSlotsContract(meta: Record<string, unknown> | undefined): ParameterReferenceSlot[] {
  return readParameterReferenceContract(meta)?.slots ?? []
}

/** A declaration is exact-only only for the Comfy model actually selected for this request. */
export function readSelectedComfyReferenceContract(
  meta: Record<string, unknown> | undefined,
  selected?: ParameterReferenceSelection,
): ParameterReferenceContract | null {
  const contract = readParameterReferenceContract(meta)
  if (!contract || !isComfyuiVendor({ key: contract.vendorKey })) return null
  if (selected && (contract.vendorKey !== selected.vendorKey
    || (selected.modelKey !== undefined && contract.modelKey !== selected.modelKey))) return null
  return contract
}
