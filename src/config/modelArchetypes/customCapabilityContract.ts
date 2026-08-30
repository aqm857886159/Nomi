import {
  CUSTOM_CAPABILITY_CONTRACT_META_KEY,
  parseCustomCapabilityContract,
  type CustomCapabilityContractV1,
} from '../../../electron/shared/customCapabilityContract'
import type { ModelArchetype } from './types'

export {
  CUSTOM_CAPABILITY_CONTRACT_META_KEY,
  CUSTOM_CAPABILITY_CONTRACT_VERSION,
  normalizeCustomCapabilityContract,
  parseCustomCapabilityContract,
} from '../../../electron/shared/customCapabilityContract'
export type {
  CustomCapabilityContractV1,
  CustomCapabilityModeV1,
} from '../../../electron/shared/customCapabilityContract'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Copy only a validated capability contract between catalog and canvas metadata. Existing
 * unrelated metadata is retained; an absent or invalid source contract removes a stale one.
 */
export function replaceCustomCapabilityContractMeta(targetMeta: unknown, sourceMeta: unknown): UnknownRecord {
  const target = isRecord(targetMeta) ? { ...targetMeta } : {}
  delete target[CUSTOM_CAPABILITY_CONTRACT_META_KEY]
  const contract = parseCustomCapabilityContract(sourceMeta)
  if (contract) target[CUSTOM_CAPABILITY_CONTRACT_META_KEY] = contract
  return target
}

function modelIdentifier(model: { modelKey?: string | null; modelAlias?: string | null }): string {
  for (const candidate of [model.modelKey, model.modelAlias]) {
    if (typeof candidate !== 'string') continue
    const normalized = candidate.trim()
    if (normalized) return normalized
  }
  return ''
}

/** Convert a valid custom contract into the existing archetype runtime shape. */
export function customCapabilityArchetypeForModel(model: {
  modelKey?: string | null
  modelAlias?: string | null
  meta?: unknown
}): ModelArchetype | null {
  const contract: CustomCapabilityContractV1 | null = parseCustomCapabilityContract(model.meta)
  const identifier = modelIdentifier(model)
  if (!contract || !identifier) return null
  return {
    id: `custom-capability:${encodeURIComponent(identifier)}`,
    family: 'custom-capability',
    label: identifier,
    kind: contract.kind,
    modes: contract.modes,
    defaultModeId: contract.defaultModeId,
    transportTaskKind: contract.transportTaskKind,
    identifierPatterns: [identifier],
  }
}
