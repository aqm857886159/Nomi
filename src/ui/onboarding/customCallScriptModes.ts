import {
  modeTransportFor,
  EVERY_VARIANT,
  resolveModelArchetype,
  type ArchetypeReferenceSlot,
  type ArchetypeTransportTaskKind,
} from '../../../electron/shared/modelArchetypes'
import { isLayerSplitMode } from '../../../electron/shared/modelArchetypes/modeForInputs'
import type { ModelParameterControl } from '../../config/modelCatalogMeta'

export type CustomCallCatalogModel = {
  vendorKey: string
  modelKey: string
  modelAlias?: string | null
  kind?: 'text' | 'image' | 'video' | 'audio' | 'model3d'
  enabled?: boolean
  meta?: unknown
  customCall?: unknown
}

export type CustomCallScriptMode = {
  id: string
  label: string
  hint: string
  taskKind: ArchetypeTransportTaskKind
  promptRequired: boolean
  slots: ArchetypeReferenceSlot[]
  parameters: ModelParameterControl[]
  fixedParams: Record<string, string>
  unsupportedReasonKey?: 'onboardingProviders.customCall.scopeUnsupportedLayerSplit'
}

export type CustomCallScriptDrafts = {
  fallback: string
  modes: Record<string, string>
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null
}

function readScript(value: unknown): string {
  const script = asRecord(value)?.script
  return typeof script === 'string' ? script : ''
}

/**
 * Only an explicit built-in or user-authored capability archetype may expose script modes.
 * Unknown models stay on the model-level fallback instead of guessing from taskKind or names.
 */
export function resolveCustomCallScriptModes(
  model: CustomCallCatalogModel | null,
  allowModes: boolean,
): CustomCallScriptMode[] {
  if (!model || !allowModes) return []
  const archetype = resolveModelArchetype(model, { variant: EVERY_VARIANT })
  if (!archetype) return []
  return archetype.modes.map((mode) => ({
    id: mode.id,
    label: mode.vendorTerm,
    hint: mode.hint,
    taskKind: modeTransportFor(mode, archetype, model.vendorKey),
    promptRequired: mode.promptRequired,
    slots: mode.slots.map((slot) => ({ ...slot })),
    parameters: mode.params.map((parameter) => ({
      ...parameter,
      options: parameter.options.map((option) => ({ ...option })),
    })),
    fixedParams: { ...(mode.fixedParams ?? {}) },
    ...(isLayerSplitMode(mode) ? { unsupportedReasonKey: 'onboardingProviders.customCall.scopeUnsupportedLayerSplit' as const } : {}),
  }))
}

export function readCustomCallScriptDrafts(
  model: CustomCallCatalogModel | null,
  fallbackScript: string,
): CustomCallScriptDrafts {
  const customCall = asRecord(model?.customCall)
  const rawModes = asRecord(customCall?.modes)
  const modes: Record<string, string> = {}
  if (rawModes) {
    for (const [modeId, value] of Object.entries(rawModes)) {
      const script = readScript(value)
      if (script.trim()) modes[modeId] = script
    }
  }
  const storedFallback = typeof customCall?.script === 'string' ? customCall.script : fallbackScript
  return { fallback: storedFallback, modes }
}

export function updateCustomCallScriptDraft(
  drafts: CustomCallScriptDrafts,
  modeId: string | null,
  script: string,
): CustomCallScriptDrafts {
  if (!modeId) return { ...drafts, fallback: script }
  return { ...drafts, modes: { ...drafts.modes, [modeId]: script } }
}

/** A scope save is deliberately a partial patch so sibling scripts are never overwritten. */
export function customCallScriptPatch(modeId: string | null, script: string): UnknownRecord {
  if (!modeId) return { script }
  return { modes: { [modeId]: script.trim() ? { script } : null } }
}

export function requiresCustomCallCapabilitySetup(model: CustomCallCatalogModel | null): boolean {
  return Boolean(model && model.kind !== 'text' && !resolveModelArchetype(model, { variant: EVERY_VARIANT }))
}
