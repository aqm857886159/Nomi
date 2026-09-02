import type { ModelParameterControl, ModelParameterControlOption } from '../../config/modelCatalogMeta'
import {
  modeTransportFor,
  normalizeCustomCapabilityContract,
  type ArchetypeIntent,
  type ArchetypeReferenceSlot,
  type ArchetypeReferenceSlotKind,
  type ArchetypeTransportTaskKind,
  type CustomCapabilityContractV1,
  type CustomCapabilityModeV1,
  type ModelArchetype,
} from '../../config/modelArchetypes'
import type { ModelChipKind } from './modelChipGrouping'

export const CAPABILITY_SLOT_KINDS = [
  'first_frame',
  'last_frame',
  'image_ref',
  'video_ref',
  'audio_ref',
  'source_video',
] as const satisfies readonly ArchetypeReferenceSlotKind[]

export const CAPABILITY_INTENTS = ['text', 'single', 'firstlast', 'character', 'edit'] as const satisfies readonly ArchetypeIntent[]

export const CAPABILITY_PARAMETER_TYPES = ['select', 'number', 'text', 'boolean', 'image-url'] as const satisfies readonly ModelParameterControl['type'][]

export const CAPABILITY_TASK_KINDS_BY_MODEL_KIND = {
  video: ['text_to_video', 'image_to_video'],
  image: ['text_to_image', 'image_edit'],
  audio: ['text_to_audio', 'transcribe'],
  model3d: ['text_to_3d', 'image_to_3d'],
} as const satisfies Record<CustomCapabilityContractV1['kind'], readonly ArchetypeTransportTaskKind[]>

export const CAPABILITY_EDITOR_LIMITS = {
  modes: 16,
  slotsPerMode: 16,
  parametersPerMode: 64,
  optionsPerParameter: 128,
} as const

type CapabilityContractKind = CustomCapabilityContractV1['kind']
type ScalarType = 'string' | 'number' | 'boolean'

export type CapabilityOptionDraft = {
  value: string
  label: string
  valueType: ScalarType
  priceLabel?: string
}

export type CapabilityParameterDraft = {
  key: string
  label: string
  type: ModelParameterControl['type']
  hasDefaultValue: boolean
  defaultValue: string
  defaultValueType: ScalarType
  options: CapabilityOptionDraft[]
  min: string
  max: string
  step?: number
  placeholder?: string
}

export type CapabilitySlotDraft = {
  kind: ArchetypeReferenceSlotKind
  label: string
  min: string
  max: string
  inputKey: string
  asArray?: boolean
  characterIndexed?: boolean
  roleName?: string
}

export type CapabilityModeDraft = {
  id: string
  intent: ArchetypeIntent
  displayName: string
  description: string
  promptRequired: boolean
  taskKind: ArchetypeTransportTaskKind
  slots: CapabilitySlotDraft[]
  parameters: CapabilityParameterDraft[]
  fixedParams?: Record<string, string>
  combineSlotsInto?: { key: string; flat?: boolean }
}

export type CapabilityContractDraft = {
  kind: CapabilityContractKind
  defaultModeId: string
  modes: CapabilityModeDraft[]
}

export type CapabilityDraftErrorCode =
  | 'required'
  | 'invalidId'
  | 'duplicateId'
  | 'invalidKey'
  | 'duplicateKey'
  | 'invalidInteger'
  | 'invalidRange'
  | 'singleSlotLimit'
  | 'invalidNumber'
  | 'defaultOutOfRange'
  | 'invalidBoolean'
  | 'defaultNotOption'
  | 'optionsRequired'
  | 'duplicateOption'
  | 'defaultModeMissing'
  | 'limitExceeded'
  | 'contractInvalid'

export type CapabilityDraftValidation = {
  contract: CustomCapabilityContractV1 | null
  errors: Record<string, CapabilityDraftErrorCode>
}

const MODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/
const MAX_CONTRACT_JSON_CHARS = 200_000
const MAX_ABS_NUMBER = 1_000_000_000_000
const RESERVED_KEY_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
const SINGLE_REFERENCE_KINDS = new Set<ArchetypeReferenceSlotKind>(['first_frame', 'last_frame', 'source_video'])

export function isCapabilityContractKind(kind: ModelChipKind): kind is CapabilityContractKind {
  return kind === 'video' || kind === 'image' || kind === 'audio' || kind === 'model3d'
}

function scalarType(value: string | number | boolean): ScalarType {
  return typeof value as ScalarType
}

function scalarText(value: string | number | boolean | undefined): string {
  return typeof value === 'undefined' ? '' : String(value)
}

function optionDraft(option: ModelParameterControlOption): CapabilityOptionDraft {
  return {
    value: String(option.value),
    label: option.label,
    valueType: scalarType(option.value),
    ...(option.priceLabel ? { priceLabel: option.priceLabel } : {}),
  }
}

function parameterDraft(parameter: ModelParameterControl): CapabilityParameterDraft {
  const hasDefaultValue = Object.prototype.hasOwnProperty.call(parameter, 'defaultValue')
  return {
    key: parameter.key,
    label: parameter.label,
    type: parameter.type,
    hasDefaultValue,
    defaultValue: scalarText(parameter.defaultValue),
    defaultValueType: typeof parameter.defaultValue === 'undefined' ? 'string' : scalarType(parameter.defaultValue),
    options: parameter.options.map(optionDraft),
    min: scalarText(parameter.min),
    max: scalarText(parameter.max),
    ...(typeof parameter.step === 'number' ? { step: parameter.step } : {}),
    ...(parameter.placeholder ? { placeholder: parameter.placeholder } : {}),
  }
}

function slotDraft(slot: ArchetypeReferenceSlot): CapabilitySlotDraft {
  return {
    kind: slot.kind,
    label: slot.label,
    min: String(slot.min),
    max: scalarText(slot.max),
    inputKey: slot.inputKey ?? '',
    ...(typeof slot.asArray === 'boolean' ? { asArray: slot.asArray } : {}),
    ...(typeof slot.characterIndexed === 'boolean' ? { characterIndexed: slot.characterIndexed } : {}),
    ...(slot.roleName ? { roleName: slot.roleName } : {}),
  }
}

// 用户自建能力契约是**单供应商**的（CustomCapabilityModeV1 的 Pick 里就没有 vendorTransportTaskKind），
// 故这里 vendorKey 传 null = 不做供应商特化；读取仍走唯一入口 modeTransportFor，不另写 ?? 链。
function modeDraft(mode: CustomCapabilityModeV1, fallbackTaskKind: ArchetypeTransportTaskKind): CapabilityModeDraft {
  return {
    id: mode.id,
    intent: mode.intent,
    displayName: mode.vendorTerm,
    description: mode.hint,
    promptRequired: mode.promptRequired,
    taskKind: modeTransportFor(mode, { transportTaskKind: fallbackTaskKind }, null) ?? fallbackTaskKind,
    slots: mode.slots.map(slotDraft),
    parameters: mode.params.map(parameterDraft),
    ...(mode.fixedParams ? { fixedParams: { ...mode.fixedParams } } : {}),
    ...(mode.combineSlotsInto ? { combineSlotsInto: { ...mode.combineSlotsInto } } : {}),
  }
}

export function createCapabilityContractDraft({
  modelKind,
  customContract,
  archetype,
  defaultModeLabel,
}: {
  modelKind: ModelChipKind
  customContract?: CustomCapabilityContractV1 | null
  archetype?: ModelArchetype | null
  defaultModeLabel: string
}): CapabilityContractDraft | null {
  if (!isCapabilityContractKind(modelKind)) return null
  // Builtins may truthfully omit unpublished limits. Do not reject their entire
  // display draft through the stricter user-authored contract validator. Saving
  // a custom override still requires validateCapabilityContractDraft below.
  const source = customContract ?? (archetype?.kind === modelKind ? archetype : null)
  if (source?.kind === modelKind) {
    return {
      kind: source.kind,
      defaultModeId: source.defaultModeId,
      modes: source.modes.map((mode) => modeDraft(mode, source.transportTaskKind)),
    }
  }
  const taskKind = CAPABILITY_TASK_KINDS_BY_MODEL_KIND[modelKind][0]
  return {
    kind: modelKind,
    defaultModeId: 'default',
    modes: [{
      id: 'default',
      intent: 'text',
      displayName: defaultModeLabel,
      description: '',
      promptRequired: true,
      taskKind,
      slots: [],
      parameters: [],
    }],
  }
}

export function createCapabilityModeDraft(kind: CapabilityContractKind, index: number, label: string): CapabilityModeDraft {
  return {
    id: `mode-${index + 1}`,
    intent: 'text',
    displayName: label,
    description: '',
    promptRequired: true,
    taskKind: CAPABILITY_TASK_KINDS_BY_MODEL_KIND[kind][0],
    slots: [],
    parameters: [],
  }
}

export function createCapabilitySlotDraft(): CapabilitySlotDraft {
  return { kind: 'image_ref', label: '', min: '0', max: '1', inputKey: '' }
}

export function createCapabilityParameterDraft(): CapabilityParameterDraft {
  return {
    key: '',
    label: '',
    type: 'text',
    hasDefaultValue: false,
    defaultValue: '',
    defaultValueType: 'string',
    options: [],
    min: '',
    max: '',
  }
}

export function createCapabilityOptionDraft(): CapabilityOptionDraft {
  return { value: '', label: '', valueType: 'string' }
}

export function replaceCapabilityModeDraft(
  draft: CapabilityContractDraft,
  modeIndex: number,
  nextMode: CapabilityModeDraft,
): CapabilityContractDraft {
  const previousMode = draft.modes[modeIndex]
  if (!previousMode) return draft
  const defaultModeIndex = draft.modes.findIndex((mode) => mode.id === draft.defaultModeId)
  return {
    ...draft,
    defaultModeId: defaultModeIndex === modeIndex && draft.defaultModeId === previousMode.id
      ? nextMode.id
      : draft.defaultModeId,
    modes: draft.modes.map((mode, index) => index === modeIndex ? nextMode : mode),
  }
}

export function replaceCapabilitySlotDraft(
  mode: CapabilityModeDraft,
  slotIndex: number,
  nextSlot: CapabilitySlotDraft,
): CapabilityModeDraft {
  const compatibleSlot = mode.combineSlotsInto && mode.combineSlotsInto.flat !== true && nextSlot.kind === 'source_video'
    ? { ...nextSlot, roleName: nextSlot.roleName || 'source_video' }
    : nextSlot
  return {
    ...mode,
    slots: mode.slots.map((slot, index) => index === slotIndex ? compatibleSlot : slot),
  }
}

export function removeCapabilitySlotDraft(mode: CapabilityModeDraft, slotIndex: number): CapabilityModeDraft {
  const slots = mode.slots.filter((_, index) => index !== slotIndex)
  return {
    ...mode,
    slots,
    ...(slots.length === 0 ? { combineSlotsInto: undefined } : {}),
  }
}

function setError(
  errors: Record<string, CapabilityDraftErrorCode>,
  path: string,
  code: CapabilityDraftErrorCode,
): void {
  if (!errors[path]) errors[path] = code
}

function validKey(value: string): boolean {
  const normalized = value.trim()
  return Boolean(
    normalized &&
    KEY_PATTERN.test(normalized) &&
    !normalized.split('.').some((part) => RESERVED_KEY_SEGMENTS.has(part.toLowerCase())),
  )
}

function parseRequiredInteger(
  value: string,
  path: string,
  errors: Record<string, CapabilityDraftErrorCode>,
): number | null {
  const normalized = value.trim()
  if (!/^-?\d+$/.test(normalized)) {
    setError(errors, path, 'invalidInteger')
    return null
  }
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed)) {
    setError(errors, path, 'invalidInteger')
    return null
  }
  return parsed
}

function parseOptionalNumber(
  value: string,
  path: string,
  errors: Record<string, CapabilityDraftErrorCode>,
): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || Math.abs(parsed) > MAX_ABS_NUMBER) {
    setError(errors, path, 'invalidNumber')
    return undefined
  }
  return parsed
}

function parseScalar(value: string, type: ScalarType): string | number | boolean | null {
  if (type === 'string') return value
  if (type === 'number') {
    const parsed = Number(value)
    return value.trim() && Number.isFinite(parsed) && Math.abs(parsed) <= MAX_ABS_NUMBER ? parsed : null
  }
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function validateParameter(
  draft: CapabilityParameterDraft,
  path: string,
  errors: Record<string, CapabilityDraftErrorCode>,
): ModelParameterControl {
  const key = draft.key.trim()
  const label = draft.label.trim()
  if (!key) setError(errors, `${path}.key`, 'required')
  else if (!validKey(key)) setError(errors, `${path}.key`, 'invalidKey')
  if (!label) setError(errors, `${path}.label`, 'required')

  const min = draft.type === 'number' ? parseOptionalNumber(draft.min, `${path}.min`, errors) : undefined
  const max = draft.type === 'number' ? parseOptionalNumber(draft.max, `${path}.max`, errors) : undefined
  if (typeof min === 'number' && typeof max === 'number' && min > max) {
    setError(errors, `${path}.max`, 'invalidRange')
  }

  const options = draft.type === 'select'
    ? draft.options.map((option, optionIndex): ModelParameterControlOption => {
        const optionPath = `${path}.options.${optionIndex}`
        if (!option.label.trim()) setError(errors, `${optionPath}.label`, 'required')
        const value = parseScalar(option.value, option.valueType)
        if (value === null) {
          setError(errors, `${optionPath}.value`, option.valueType === 'boolean' ? 'invalidBoolean' : 'invalidNumber')
        }
        return {
          value: value ?? option.value,
          label: option.label.trim(),
          ...(option.priceLabel ? { priceLabel: option.priceLabel } : {}),
        }
      })
    : []
  if (draft.type === 'select' && options.length === 0) setError(errors, `${path}.options`, 'optionsRequired')
  const optionKeys = draft.options.map((option) => `${option.valueType}:${option.value}`)
  optionKeys.forEach((value, index) => {
    if (optionKeys.indexOf(value) !== index) setError(errors, `${path}.options.${index}.value`, 'duplicateOption')
  })

  let defaultValue: string | number | boolean | undefined
  if (draft.hasDefaultValue) {
    if (draft.type === 'number') {
      const value = Number(draft.defaultValue)
      if (!Number.isFinite(value) || Math.abs(value) > MAX_ABS_NUMBER) {
        setError(errors, `${path}.defaultValue`, 'invalidNumber')
      }
      else defaultValue = value
    } else if (draft.type === 'boolean') {
      if (draft.defaultValue !== 'true' && draft.defaultValue !== 'false') {
        setError(errors, `${path}.defaultValue`, 'invalidBoolean')
      } else defaultValue = draft.defaultValue === 'true'
    } else if (draft.type === 'select') {
      const optionIndex = draft.options.findIndex((option) =>
        option.value === draft.defaultValue && option.valueType === draft.defaultValueType)
      if (optionIndex < 0) setError(errors, `${path}.defaultValue`, 'defaultNotOption')
      else {
        const selected = draft.options[optionIndex]
        const value = parseScalar(selected.value, selected.valueType)
        if (value !== null) defaultValue = value
      }
    } else defaultValue = draft.defaultValue
  }
  if (
    typeof defaultValue === 'number' &&
    ((typeof min === 'number' && defaultValue < min) || (typeof max === 'number' && defaultValue > max))
  ) setError(errors, `${path}.defaultValue`, 'defaultOutOfRange')

  return {
    key,
    label,
    type: draft.type,
    options,
    ...(typeof defaultValue !== 'undefined' ? { defaultValue } : {}),
    ...(typeof min === 'number' ? { min } : {}),
    ...(typeof max === 'number' ? { max } : {}),
    ...(draft.type === 'number' && typeof draft.step === 'number' ? { step: draft.step } : {}),
    ...(draft.placeholder ? { placeholder: draft.placeholder } : {}),
  }
}

function validateSlot(
  draft: CapabilitySlotDraft,
  path: string,
  errors: Record<string, CapabilityDraftErrorCode>,
): ArchetypeReferenceSlot {
  const label = draft.label.trim()
  const inputKey = draft.inputKey.trim()
  if (!label) setError(errors, `${path}.label`, 'required')
  if (inputKey && !validKey(inputKey)) setError(errors, `${path}.inputKey`, 'invalidKey')
  const min = parseRequiredInteger(draft.min, `${path}.min`, errors)
  const max = parseRequiredInteger(draft.max, `${path}.max`, errors)
  if (min !== null && max !== null) {
    if (min < 0 || max < 1 || min > max || max > 64) setError(errors, `${path}.max`, 'invalidRange')
    if (SINGLE_REFERENCE_KINDS.has(draft.kind) && max !== 1) setError(errors, `${path}.max`, 'singleSlotLimit')
  }
  return {
    kind: draft.kind,
    label,
    min: min ?? 0,
    max: max ?? 1,
    ...(inputKey ? { inputKey } : {}),
    ...(typeof draft.asArray === 'boolean' ? { asArray: draft.asArray } : {}),
    ...(typeof draft.characterIndexed === 'boolean' ? { characterIndexed: draft.characterIndexed } : {}),
    ...(draft.roleName ? { roleName: draft.roleName } : {}),
  }
}

export function validateCapabilityContractDraft(draft: CapabilityContractDraft): CapabilityDraftValidation {
  const errors: Record<string, CapabilityDraftErrorCode> = {}
  if (draft.modes.length === 0) setError(errors, 'modes', 'required')
  if (draft.modes.length > CAPABILITY_EDITOR_LIMITS.modes) setError(errors, 'modes', 'limitExceeded')
  const ids = draft.modes.map((mode) => mode.id.trim())
  if (!ids.includes(draft.defaultModeId)) setError(errors, 'defaultModeId', 'defaultModeMissing')

  const allowedTaskKinds = new Set<ArchetypeTransportTaskKind>(CAPABILITY_TASK_KINDS_BY_MODEL_KIND[draft.kind])
  const modes = draft.modes.map((mode, modeIndex): CustomCapabilityModeV1 => {
    const path = `modes.${modeIndex}`
    const id = mode.id.trim()
    if (!id) setError(errors, `${path}.id`, 'required')
    else if (!MODE_ID_PATTERN.test(id)) setError(errors, `${path}.id`, 'invalidId')
    if (ids.indexOf(id) !== modeIndex) setError(errors, `${path}.id`, 'duplicateId')
    if (!mode.displayName.trim()) setError(errors, `${path}.displayName`, 'required')
    if (!allowedTaskKinds.has(mode.taskKind)) setError(errors, `${path}.taskKind`, 'required')

    const slots = mode.slots.map((slot, slotIndex) => validateSlot(slot, `${path}.slots.${slotIndex}`, errors))
    if (slots.length > CAPABILITY_EDITOR_LIMITS.slotsPerMode) setError(errors, `${path}.slots`, 'limitExceeded')
    if (mode.combineSlotsInto && slots.length === 0) setError(errors, `${path}.slots`, 'required')
    const slotKinds = slots.map((slot) => slot.kind)
    slotKinds.forEach((kind, slotIndex) => {
      if (slotKinds.indexOf(kind) !== slotIndex) setError(errors, `${path}.slots.${slotIndex}.kind`, 'duplicateKey')
    })
    const explicitInputKeys = slots.flatMap((slot) => slot.inputKey ? [slot.inputKey] : [])
    slots.forEach((slot, slotIndex) => {
      if (!slot.inputKey) return
      const firstIndex = slots.findIndex((candidate) => candidate.inputKey === slot.inputKey)
      if (firstIndex !== slotIndex) setError(errors, `${path}.slots.${slotIndex}.inputKey`, 'duplicateKey')
    })

    const params = mode.parameters.map((parameter, parameterIndex) =>
      validateParameter(parameter, `${path}.parameters.${parameterIndex}`, errors))
    if (params.length > CAPABILITY_EDITOR_LIMITS.parametersPerMode) {
      setError(errors, `${path}.parameters`, 'limitExceeded')
    }
    mode.parameters.forEach((parameter, parameterIndex) => {
      if (parameter.options.length > CAPABILITY_EDITOR_LIMITS.optionsPerParameter) {
        setError(errors, `${path}.parameters.${parameterIndex}.options`, 'limitExceeded')
      }
    })
    const parameterKeys = params.map((parameter) => parameter.key)
    parameterKeys.forEach((key, parameterIndex) => {
      if (parameterKeys.indexOf(key) !== parameterIndex) {
        setError(errors, `${path}.parameters.${parameterIndex}.key`, 'duplicateKey')
      }
    })

    const reservedOutputKeys = new Set([
      ...(mode.combineSlotsInto ? [mode.combineSlotsInto.key] : explicitInputKeys),
      ...Object.keys(mode.fixedParams ?? {}),
    ])
    params.forEach((parameter, parameterIndex) => {
      if (reservedOutputKeys.has(parameter.key)) setError(errors, `${path}.parameters.${parameterIndex}.key`, 'duplicateKey')
    })
    if (!mode.combineSlotsInto) {
      const fixedKeys = new Set(Object.keys(mode.fixedParams ?? {}))
      slots.forEach((slot, slotIndex) => {
        if (slot.inputKey && fixedKeys.has(slot.inputKey)) {
          setError(errors, `${path}.slots.${slotIndex}.inputKey`, 'duplicateKey')
        }
      })
    }

    return {
      id,
      intent: mode.intent,
      vendorTerm: mode.displayName.trim(),
      hint: mode.description.trim(),
      promptRequired: mode.promptRequired,
      transportTaskKind: mode.taskKind,
      slots,
      params,
      ...(mode.fixedParams ? { fixedParams: { ...mode.fixedParams } } : {}),
      ...(mode.combineSlotsInto ? { combineSlotsInto: { ...mode.combineSlotsInto } } : {}),
    }
  })

  const defaultMode = modes.find((mode) => mode.id === draft.defaultModeId)
  const rawContract = {
    version: 1,
    kind: draft.kind,
    defaultModeId: draft.defaultModeId,
    transportTaskKind: defaultMode?.transportTaskKind ?? CAPABILITY_TASK_KINDS_BY_MODEL_KIND[draft.kind][0],
    modes,
  }
  if (Object.keys(errors).length > 0) return { contract: null, errors }
  if (JSON.stringify(rawContract).length > MAX_CONTRACT_JSON_CHARS) {
    return { contract: null, errors: { form: 'limitExceeded' } }
  }
  const contract = normalizeCustomCapabilityContract(rawContract)
  if (!contract) return { contract: null, errors: { form: 'contractInvalid' } }
  return { contract, errors }
}
