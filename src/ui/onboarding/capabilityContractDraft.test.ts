import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES, type CustomCapabilityContractV1, type ModelArchetype } from '../../config/modelArchetypes'
import {
  createCapabilityContractDraft,
  createCapabilityModeDraft,
  createCapabilityParameterDraft,
  createCapabilitySlotDraft,
  replaceCapabilityModeDraft,
  removeCapabilitySlotDraft,
  validateCapabilityContractDraft,
} from './capabilityContractDraft'

const existingContract: CustomCapabilityContractV1 = {
  version: 1,
  kind: 'video',
  defaultModeId: 'reference',
  transportTaskKind: 'image_to_video',
  modes: [{
    id: 'reference',
    intent: 'character',
    vendorTerm: 'Multi reference',
    hint: 'Keep the image order stable',
    promptRequired: true,
    transportTaskKind: 'image_to_video',
    slots: [{
      kind: 'image_ref',
      label: 'Reference images',
      min: 1,
      max: 4,
      inputKey: 'reference_images',
      asArray: true,
      characterIndexed: true,
    }],
    params: [{
      key: 'duration',
      label: 'Duration',
      type: 'number',
      options: [],
      defaultValue: 5,
      min: 1,
      max: 10,
      step: 1,
    }],
    fixedParams: { generation_mode: 'reference' },
  }],
}

describe('capability contract form draft', () => {
  it('round-trips a valid contract while retaining advanced fields the basic form does not edit', () => {
    const draft = createCapabilityContractDraft({
      modelKind: 'video',
      customContract: existingContract,
      defaultModeLabel: 'Default mode',
    })

    expect(draft).not.toBeNull()
    const result = validateCapabilityContractDraft(draft!)

    expect(result.errors).toEqual({})
    expect(result.contract).toEqual(existingContract)
  })

  it('builds multiple modes with distinct task kinds, slots, and parameters for a new model', () => {
    const draft = createCapabilityContractDraft({ modelKind: 'image', defaultModeLabel: 'Text image' })!
    draft.modes[0].displayName = 'Text image'
    draft.modes[0].taskKind = 'text_to_image'
    const editMode = createCapabilityModeDraft('image', 1, 'Reference edit')
    editMode.id = 'edit'
    editMode.intent = 'edit'
    editMode.taskKind = 'image_edit'
    const slot = createCapabilitySlotDraft()
    slot.label = 'Reference images'
    slot.min = '1'
    slot.max = '3'
    slot.inputKey = 'image_urls'
    editMode.slots.push(slot)
    const parameter = createCapabilityParameterDraft()
    parameter.key = 'strength'
    parameter.label = 'Strength'
    parameter.type = 'number'
    parameter.hasDefaultValue = true
    parameter.defaultValue = '0.7'
    parameter.defaultValueType = 'number'
    parameter.min = '0'
    parameter.max = '1'
    editMode.parameters.push(parameter)
    draft.modes.push(editMode)

    const result = validateCapabilityContractDraft(draft)

    expect(result.errors).toEqual({})
    expect(result.contract?.modes).toEqual([
      expect.objectContaining({ id: 'default', transportTaskKind: 'text_to_image' }),
      expect.objectContaining({
        id: 'edit',
        transportTaskKind: 'image_edit',
        slots: [expect.objectContaining({ inputKey: 'image_urls', min: 1, max: 3 })],
        params: [expect.objectContaining({ key: 'strength', defaultValue: 0.7 })],
      }),
    ])
  })

  it('reports invalid fields at their form paths instead of producing a partial contract', () => {
    const draft = createCapabilityContractDraft({
      modelKind: 'video',
      customContract: existingContract,
      defaultModeLabel: 'Default mode',
    })!
    draft.modes[0].id = 'bad id'
    draft.modes[0].slots[0].max = '0'
    draft.modes[0].parameters[0].min = '20'
    draft.modes[0].parameters[0].max = '10'

    const result = validateCapabilityContractDraft(draft)

    expect(result.contract).toBeNull()
    expect(result.errors).toMatchObject({
      'defaultModeId': 'defaultModeMissing',
      'modes.0.id': 'invalidId',
      'modes.0.slots.0.max': 'invalidRange',
      'modes.0.parameters.0.max': 'invalidRange',
    })
  })

  it('prefills a curated archetype when no custom override exists', () => {
    const archetype: ModelArchetype = {
      id: 'future-image',
      family: 'future',
      label: 'Future Image',
      kind: 'image',
      defaultModeId: 'text',
      transportTaskKind: 'text_to_image',
      identifierPatterns: ['future-image'],
      modes: [{
        id: 'text',
        intent: 'text',
        vendorTerm: 'Text image',
        hint: '',
        promptRequired: true,
        slots: [],
        params: [],
      }],
    }

    const draft = createCapabilityContractDraft({
      modelKind: 'image',
      archetype,
      defaultModeLabel: 'Default mode',
    })

    expect(draft?.modes[0]).toMatchObject({ id: 'text', displayName: 'Text image' })
    expect(validateCapabilityContractDraft(draft!).contract).not.toBeNull()
  })

  it('does not offer a media capability contract for text models', () => {
    expect(createCapabilityContractDraft({ modelKind: 'text', defaultModeLabel: 'Default mode' })).toBeNull()
  })

  it('keeps legal source-key reuse when a mode combines its slots into another output', () => {
    const contract: CustomCapabilityContractV1 = {
      version: 1,
      kind: 'video',
      defaultModeId: 'frame',
      transportTaskKind: 'image_to_video',
      modes: [{
        id: 'frame',
        intent: 'firstlast',
        vendorTerm: 'Frames',
        hint: '',
        promptRequired: true,
        transportTaskKind: 'image_to_video',
        slots: [{ kind: 'first_frame', label: 'First', min: 1, max: 1, inputKey: 'first_image' }],
        params: [{ key: 'first_image', label: 'Fallback URL', type: 'text', options: [] }],
        combineSlotsInto: { key: 'frame_images', flat: true },
      }],
    }
    const draft = createCapabilityContractDraft({
      modelKind: 'video',
      customContract: contract,
      defaultModeLabel: 'Default mode',
    })!

    expect(validateCapabilityContractDraft(draft)).toEqual({ contract, errors: {} })
  })

  it('puts duplicate input-key errors on the repeated slot even when earlier slots omit a key', () => {
    const draft = createCapabilityContractDraft({ modelKind: 'video', defaultModeLabel: 'Default mode' })!
    draft.modes[0].slots = [
      { kind: 'first_frame', label: 'First', min: '1', max: '1', inputKey: '' },
      { kind: 'image_ref', label: 'Images', min: '0', max: '3', inputKey: 'shared' },
      { kind: 'video_ref', label: 'Videos', min: '0', max: '3', inputKey: 'shared' },
    ]

    const result = validateCapabilityContractDraft(draft)

    expect(result.errors['modes.0.slots.2.inputKey']).toBe('duplicateKey')
    expect(result.errors['modes.0.slots.1.inputKey']).toBeUndefined()
  })

  it('does not move the default mode when the non-default copy of a temporary duplicate id is fixed', () => {
    const draft = createCapabilityContractDraft({ modelKind: 'video', defaultModeLabel: 'Default mode' })!
    draft.modes.push({ ...draft.modes[0], displayName: 'Second' })
    const nextSecond = { ...draft.modes[1], id: 'second' }

    const result = replaceCapabilityModeDraft(draft, 1, nextSecond)

    expect(result.defaultModeId).toBe('default')
    expect(result.modes.map((mode) => mode.id)).toEqual(['default', 'second'])
  })

  it('drops a hidden slot-combining rule when its final source slot is removed', () => {
    const draft = createCapabilityContractDraft({ modelKind: 'video', customContract: existingContract, defaultModeLabel: 'Default mode' })!
    draft.modes[0].combineSlotsInto = { key: 'assets', flat: true }

    const mode = removeCapabilitySlotDraft(draft.modes[0], 0)

    expect(mode.slots).toEqual([])
    expect(mode.combineSlotsInto).toBeUndefined()
  })

  it('locates a hidden fixed-parameter collision at the edited input key', () => {
    const draft = createCapabilityContractDraft({ modelKind: 'video', customContract: existingContract, defaultModeLabel: 'Default mode' })!
    draft.modes[0].slots[0].inputKey = 'generation_mode'

    const result = validateCapabilityContractDraft(draft)

    expect(result.errors['modes.0.slots.0.inputKey']).toBe('duplicateKey')
  })

  it('locates numbers beyond the contract safety range at the numeric field', () => {
    const draft = createCapabilityContractDraft({ modelKind: 'video', defaultModeLabel: 'Default mode' })!
    const parameter = createCapabilityParameterDraft()
    parameter.key = 'guidance'
    parameter.label = 'Guidance'
    parameter.type = 'number'
    parameter.max = '1000000000001'
    draft.modes[0].parameters.push(parameter)

    expect(validateCapabilityContractDraft(draft).errors['modes.0.parameters.0.max']).toBe('invalidNumber')
  })

  it('reports the whole form when individually valid entries exceed the contract JSON ceiling', () => {
    const draft = createCapabilityContractDraft({ modelKind: 'video', defaultModeLabel: 'Default mode' })!
    const parameter = createCapabilityParameterDraft()
    parameter.key = 'preset'
    parameter.label = 'Preset'
    parameter.type = 'select'
    parameter.options = Array.from({ length: 128 }, (_, index) => ({
      value: `${index}-${'x'.repeat(1_600)}`,
      label: `Preset ${index}`,
      valueType: 'string' as const,
    }))
    draft.modes[0].parameters.push(parameter)

    expect(validateCapabilityContractDraft(draft).errors.form).toBe('limitExceeded')
  })

  it.each(MODEL_ARCHETYPES.map((archetype) => [archetype.id, archetype] as const))(
    'can open and save the existing %s profile without dropping it into an invalid draft',
    (_id, archetype) => {
      const draft = createCapabilityContractDraft({
        modelKind: archetype.kind,
        archetype,
        defaultModeLabel: 'Default mode',
      })

      expect(draft).not.toBeNull()
      expect(validateCapabilityContractDraft(draft!).errors).toEqual({})
    },
  )
})
