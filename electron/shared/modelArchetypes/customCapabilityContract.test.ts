import { describe, expect, it } from 'vitest'
import {
  parseCustomCapabilityContract,
  resolveArchetypeForModel,
} from './index'

const FUTURE_VIDEO_CONTRACT = {
  version: 1,
  kind: 'video',
  defaultModeId: 'references',
  transportTaskKind: 'image_to_video',
  modes: [
    {
      id: 'references',
      intent: 'character',
      vendorTerm: 'Multi reference',
      hint: 'One to eight ordered reference images',
      promptRequired: true,
      transportTaskKind: 'image_to_video',
      slots: [
        {
          kind: 'image_ref',
          label: 'Reference images',
          min: 1,
          max: 8,
          inputKey: 'reference_images',
          asArray: true,
          characterIndexed: true,
        },
      ],
      params: [
        {
          key: 'duration',
          label: 'Duration',
          type: 'number',
          options: [],
          defaultValue: 5,
          min: 1,
          max: 30,
          step: 1,
        },
      ],
    },
    {
      id: 'frames',
      intent: 'firstlast',
      vendorTerm: 'First and last frame',
      hint: 'The last frame is optional',
      promptRequired: true,
      transportTaskKind: 'image_to_video',
      slots: [
        { kind: 'first_frame', label: 'First frame', min: 1, max: 1, inputKey: 'first_image' },
        { kind: 'last_frame', label: 'Last frame', min: 0, max: 1, inputKey: 'last_image' },
      ],
      params: [
        {
          key: 'quality',
          label: 'Quality',
          type: 'select',
          options: [
            { value: 'standard', label: 'Standard' },
            { value: 'high', label: 'High' },
          ],
          defaultValue: 'standard',
        },
      ],
      fixedParams: { generation_mode: 'frames' },
      combineSlotsInto: { key: 'frame_images', flat: true },
    },
  ],
} as const

const model = (contract: unknown, modelKey = 'future-video-v1') => ({
  modelKey,
  vendorKey: 'any-relay',
  meta: { customCapabilityContract: contract },
})

describe('custom capability contract v1', () => {
  it('lets an unknown model explicitly expose multiple modes that share one task kind', () => {
    const archetype = resolveArchetypeForModel(model(FUTURE_VIDEO_CONTRACT))

    expect(archetype).toMatchObject({
      kind: 'video',
      defaultModeId: 'references',
      transportTaskKind: 'image_to_video',
    })
    expect(archetype?.id).toBe('custom-capability:future-video-v1')
    expect(archetype?.modes.map((mode) => [mode.id, mode.transportTaskKind])).toEqual([
      ['references', 'image_to_video'],
      ['frames', 'image_to_video'],
    ])
    expect(archetype?.modes[0].slots[0]).toEqual(expect.objectContaining({
      kind: 'image_ref',
      min: 1,
      max: 8,
      inputKey: 'reference_images',
      characterIndexed: true,
    }))
    expect(archetype?.modes[1]).toEqual(expect.objectContaining({
      fixedParams: { generation_mode: 'frames' },
      combineSlotsInto: { key: 'frame_images', flat: true },
    }))
  })

  it('prioritizes a valid explicit contract over a curated identity match', () => {
    const archetype = resolveArchetypeForModel(model(FUTURE_VIDEO_CONTRACT, 'bytedance/seedance-2'))

    expect(archetype?.id).toBe('custom-capability:bytedance%2Fseedance-2')
    expect(archetype?.modes.map((mode) => mode.id)).toEqual(['references', 'frames'])
  })

  it('normalizes to a plain JSON contract and survives a JSON round trip', () => {
    const parsed = parseCustomCapabilityContract({
      customCapabilityContract: {
        ...FUTURE_VIDEO_CONTRACT,
        defaultModeId: ' references ',
        modes: FUTURE_VIDEO_CONTRACT.modes.map((mode) => ({ ...mode, id: ` ${mode.id} ` })),
      },
    })
    const roundTripped = JSON.parse(JSON.stringify(parsed))

    expect(parsed?.defaultModeId).toBe('references')
    expect(parsed?.modes.map((mode) => mode.id)).toEqual(['references', 'frames'])
    expect(parseCustomCapabilityContract({ customCapabilityContract: roundTripped })).toEqual(parsed)
  })

  it('allows a combined output to reuse a source slot key because source keys are removed first', () => {
    const frameMode = FUTURE_VIDEO_CONTRACT.modes[1]
    const parsed = parseCustomCapabilityContract({
      customCapabilityContract: {
        ...FUTURE_VIDEO_CONTRACT,
        defaultModeId: 'frames',
        modes: [{
          ...frameMode,
          slots: [
            { ...frameMode.slots[0], inputKey: 'frame_images' },
            frameMode.slots[1],
          ],
          combineSlotsInto: { key: 'frame_images', flat: true },
        }],
      },
    })

    expect(parsed?.modes[0].combineSlotsInto).toEqual({ key: 'frame_images', flat: true })
  })

  it.each([
    ['unknown version', { ...FUTURE_VIDEO_CONTRACT, version: 2 }],
    ['duplicate mode id', {
      ...FUTURE_VIDEO_CONTRACT,
      modes: [FUTURE_VIDEO_CONTRACT.modes[0], { ...FUTURE_VIDEO_CONTRACT.modes[1], id: 'references' }],
    }],
    ['missing default mode', { ...FUTURE_VIDEO_CONTRACT, defaultModeId: 'missing' }],
    ['slot min exceeds max', {
      ...FUTURE_VIDEO_CONTRACT,
      modes: [{
        ...FUTURE_VIDEO_CONTRACT.modes[0],
        slots: [{ ...FUTURE_VIDEO_CONTRACT.modes[0].slots[0], min: 9, max: 8 }],
      }],
      defaultModeId: 'references',
    }],
    ['slot max exceeds the safety cap', {
      ...FUTURE_VIDEO_CONTRACT,
      modes: [{
        ...FUTURE_VIDEO_CONTRACT.modes[0],
        slots: [{ ...FUTURE_VIDEO_CONTRACT.modes[0].slots[0], max: 65 }],
      }],
      defaultModeId: 'references',
    }],
    ['parameter min exceeds max', {
      ...FUTURE_VIDEO_CONTRACT,
      modes: [{
        ...FUTURE_VIDEO_CONTRACT.modes[0],
        params: [{
          ...FUTURE_VIDEO_CONTRACT.modes[0].params[0],
          min: 20,
          max: 10,
        }],
      }],
      defaultModeId: 'references',
    }],
    ['unsafe combined key', {
      ...FUTURE_VIDEO_CONTRACT,
      modes: [{
        ...FUTURE_VIDEO_CONTRACT.modes[1],
        combineSlotsInto: { key: '__proto__' },
      }],
      defaultModeId: 'frames',
    }],
    ['kind and task kind disagree', {
      ...FUTURE_VIDEO_CONTRACT,
      transportTaskKind: 'text_to_image',
    }],
  ])('rejects %s without throwing and falls back to curated/identity resolution', (_name, invalid) => {
    expect(parseCustomCapabilityContract({ customCapabilityContract: invalid })).toBeNull()
    expect(resolveArchetypeForModel(model(invalid, 'bytedance/seedance-2'))?.id).toBe('seedance-2')
    expect(resolveArchetypeForModel(model(invalid))).toBeNull()
  })

  it('does not throw on a non-JSON/circular contract', () => {
    const circular: Record<string, unknown> = { ...FUTURE_VIDEO_CONTRACT }
    circular.self = circular

    expect(() => parseCustomCapabilityContract({ customCapabilityContract: circular })).not.toThrow()
    expect(parseCustomCapabilityContract({ customCapabilityContract: circular })).toBeNull()
  })
})


it.each([null,{binding:{}}])('preserves validated explicit custom contract over historical invalid import marker', comfyWorkflowImport => {
  const a=resolveArchetypeForModel({vendorKey:'local',modelKey:'workflow',meta:{customCapabilityContract:FUTURE_VIDEO_CONTRACT,comfyWorkflowImport,parameters:[]}});
  expect(a?.defaultModeId).toBe(FUTURE_VIDEO_CONTRACT.defaultModeId);
});


it('does not let a generic text default erase the declared inputs of a valid imported graph', () => {
  const generic={version:1,kind:'video',defaultModeId:'default',transportTaskKind:'text_to_video',modes:[{id:'default',intent:'text',vendorTerm:'Default mode',hint:'',promptRequired:true,transportTaskKind:'text_to_video',slots:[],params:[]}]};
  const a=resolveArchetypeForModel({vendorKey:'comfyui-local',modelKey:'local-i2v',meta:{customCapabilityContract:generic,comfyWorkflowImport:{binding:{outputKind:'video'}},parameters:[{key:'first_frame_url',type:'image-url',mediaKind:'image'}]}});
  expect(a?.transportTaskKind).toBe('image_to_video');
  expect(a?.modes.map(mode=>mode.id)).toEqual(['image_to_video']);
  expect(a?.modes[0]?.slots).toEqual([expect.objectContaining({inputKey:'first_frame_url',kind:'image_ref',asArray:false})]);
});
