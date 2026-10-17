import { isComfyuiVendor } from './types'

export type ParameterReferenceGroup = 'first_frame' | 'last_frame' | 'reference'
export type ParameterReferenceSlot = {
  key: string
  label: string
  group: ParameterReferenceGroup
  mediaKind?: 'image' | 'video' | 'audio'
}
export type ParameterReferenceContract = {
  modelKey: string
  vendorKey: string
  slots: ParameterReferenceSlot[]
}
/**
 * 这一次请求选中的连接。`modelKey` 是**目录身份**（选哪条 mapping / 比对 comfy 契约用）。
 * `modelAlias` / `modelMeta` / `operation` 只交给线上模型名的唯一 owner
 * （electron/shared/modelArchetypes/wireModelIdentity.resolveWireModel）：发哪个 model 串由「这条 op 有没有声明收档案名」
 * 与连接自己的名字决定，调用方不再自己算一个回落值传进来（2026-10-16）。
 */
export type ParameterReferenceSelection = {
  modelKey?: string
  vendorKey: string
  modelAlias?: string | null
  modelMeta?: unknown
  operation?: { wireModel?: unknown } | null
}

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
    if (slot.mediaKind !== undefined && slot.mediaKind !== 'image' && slot.mediaKind !== 'video' && slot.mediaKind !== 'audio') return null
    seen.add(key)
    slots.push({
      key,
      label: slot.label.trim() || key,
      group: slot.group as ParameterReferenceGroup,
      ...(slot.mediaKind === 'image' || slot.mediaKind === 'video' || slot.mediaKind === 'audio' ? { mediaKind: slot.mediaKind } : {}),
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
