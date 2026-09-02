import {
  parseModelParameterControls,
  type ModelParameterControl,
} from '../../config/modelCatalogMeta'
import {
  modeTransportFor,
  resolveArchetypeForModel,
  type ArchetypeIntent,
  type ArchetypeReferenceSlotKind,
  type ModelArchetype,
} from '../../config/modelArchetypes'
import {
  selectTaskMapping,
  type Mapping,
  type ProfileKind,
} from '../../../electron/catalog/types'
import type { ChipModel } from './ModelChipGroups'

const PROFILE_KIND_ORDER = [
  'chat',
  'prompt_refine',
  'text_to_image',
  'image_to_prompt',
  'image_to_video',
  'text_to_video',
  'image_edit',
  'text_to_audio',
  'image_to_audio',
  'transcribe',
  'text_to_3d',
  'image_to_3d',
] as const satisfies readonly ProfileKind[]

const PROFILE_KINDS = new Set<string>(PROFILE_KIND_ORDER)

export type CapabilityInputProjection = {
  kind: ArchetypeReferenceSlotKind
  label: string
  mediaKind: 'image' | 'video' | 'audio'
  min: number
  max?: number
  inputKey?: string
  characterIndexed: boolean
}

export type CapabilityModeProjection = {
  id: string
  label: string
  hint: string
  intent: ArchetypeIntent
  taskKind: ProfileKind
  promptRequired: boolean
  requiredInputs: CapabilityInputProjection[]
  optionalInputs: CapabilityInputProjection[]
  parameters: ModelParameterControl[]
}

export type TransportMappingProjection = {
  id: string
  taskKind: ProfileKind
  scope: 'model' | 'vendor'
}

export type ModelCapabilityProjection = {
  source: 'archetype' | 'transport-only'
  inputContract: 'known' | 'unknown'
  modes: CapabilityModeProjection[]
  /** Flat catalog controls remain factual even when input-slot semantics are unknown. */
  parameters: ModelParameterControl[]
  transport: {
    mappings: TransportMappingProjection[]
    verifiedTaskKinds: ProfileKind[]
  }
  customCall: {
    enabled: boolean
    scope: 'model'
    sharedAcrossTaskKinds: true
    taskKindAware: true
    modeAware: true
    declaresInputContract: false
    supportsAudioDispatch: true
  }
}

export type ProjectModelCapabilityInput = {
  model: ChipModel
  /** `undefined` resolves the registered archetype; `null` explicitly means none. */
  archetype?: ModelArchetype | null
  mappings?: readonly Mapping[]
  hasCustomCall?: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isProfileKind(value: unknown): value is ProfileKind {
  return typeof value === 'string' && PROFILE_KINDS.has(value)
}

function sortTaskKinds(values: Iterable<ProfileKind>): ProfileKind[] {
  const found = new Set(values)
  return PROFILE_KIND_ORDER.filter((taskKind) => found.has(taskKind))
}

function verifiedAdapterTaskKinds(meta: unknown): ProfileKind[] {
  const adapter = asRecord(asRecord(meta)?.adapter)
  if (!adapter || !Array.isArray(adapter.modes)) return []
  const verified = adapter.modes.flatMap((value): ProfileKind[] => {
    const mode = asRecord(value)
    return mode?.state === 'verified' && isProfileKind(mode.taskKind) ? [mode.taskKind] : []
  })
  return sortTaskKinds(verified)
}

function applicableMappings(model: ChipModel, mappings: readonly Mapping[]): TransportMappingProjection[] {
  const taskKinds = new Set<ProfileKind>()
  for (const mapping of mappings) {
    if (!mapping.enabled || mapping.vendorKey !== model.vendorKey) continue
    if (mapping.modelKey && mapping.modelKey !== model.modelKey) continue
    taskKinds.add(mapping.taskKind)
  }
  return sortTaskKinds(taskKinds).flatMap((taskKind): TransportMappingProjection[] => {
    const selected = selectTaskMapping([...mappings], model.vendorKey, taskKind, model.modelKey)
    if (!selected) return []
    return [{
      id: selected.id,
      taskKind,
      scope: selected.modelKey ? 'model' : 'vendor',
    }]
  })
}

function mediaKindForSlot(kind: ArchetypeReferenceSlotKind): CapabilityInputProjection['mediaKind'] {
  if (kind === 'video_ref' || kind === 'source_video') return 'video'
  if (kind === 'audio_ref') return 'audio'
  return 'image'
}

function capabilityModes(archetype: ModelArchetype, vendorKey: string | null | undefined): CapabilityModeProjection[] {
  return archetype.modes.map((mode) => {
    const inputs = mode.slots.map((slot): CapabilityInputProjection => ({
      kind: slot.kind,
      label: slot.label,
      mediaKind: mediaKindForSlot(slot.kind),
      min: slot.min,
      max: slot.max,
      ...(slot.inputKey ? { inputKey: slot.inputKey } : {}),
      characterIndexed: Boolean(slot.characterIndexed),
    }))
    return {
      id: mode.id,
      label: mode.vendorTerm,
      hint: mode.hint,
      intent: mode.intent,
      taskKind: modeTransportFor(mode, archetype, vendorKey),
      promptRequired: mode.promptRequired,
      requiredInputs: inputs.filter((input) => input.min > 0),
      optionalInputs: inputs.filter((input) => input.min === 0),
      parameters: mode.params.map((parameter) => ({
        ...parameter,
        options: parameter.options.map((option) => ({ ...option })),
      })),
    }
  })
}

export function projectModelCapability(input: ProjectModelCapabilityInput): ModelCapabilityProjection {
  const { model } = input
  const archetype = input.archetype !== undefined
    ? input.archetype
    : resolveArchetypeForModel({
        modelKey: model.modelKey,
        vendorKey: model.vendorKey,
        meta: model.meta,
      })
  return {
    source: archetype ? 'archetype' : 'transport-only',
    inputContract: archetype ? 'known' : 'unknown',
    modes: archetype ? capabilityModes(archetype, model.vendorKey) : [],
    parameters: parseModelParameterControls(model.meta),
    transport: {
      mappings: applicableMappings(model, input.mappings ?? []),
      verifiedTaskKinds: verifiedAdapterTaskKinds(model.meta),
    },
    customCall: {
      enabled: input.hasCustomCall ?? Boolean(model.hasCustomCall),
      scope: 'model',
      sharedAcrossTaskKinds: true,
      taskKindAware: true,
      modeAware: true,
      declaresInputContract: false,
      supportsAudioDispatch: true,
    },
  }
}
