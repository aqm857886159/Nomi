import { describe, expect, it } from 'vitest'
import { readParameterReferenceContract } from './parameterReferenceContract'

const validSlot = { key: 'comfy_image_1', label: 'Reference', group: 'reference' }

function metaWithSlots(slots: unknown[]) {
  return {
    modelKey: 'workflow',
    modelVendor: 'comfyui-local',
    parameterReferenceSlots: {
      modelKey: 'workflow',
      vendorKey: 'comfyui-local',
      slots,
    },
  }
}

describe('readParameterReferenceContract', () => {
  it.each([
    ['non-object slot', [validSlot, null]],
    ['invalid group', [validSlot, { ...validSlot, key: 'bad-group', group: 'other' }]],
    ['array group', [validSlot, { ...validSlot, key: 'bad-group', group: ['reference'] }]],
    ['empty key', [validSlot, { ...validSlot, key: '   ' }]],
    ['numeric key', [validSlot, { ...validSlot, key: 1 }]],
    ['numeric label', [validSlot, { ...validSlot, key: 'bad-label', label: 1 }]],
    ['duplicate key', [validSlot, { ...validSlot, label: 'Duplicate' }]],
    // 'audio' 曾在这条黑名单里(把 ComfyUI LoadAudio 声明的媒体槽当整份契约作废) —— 这正是用户报的
    // 根因之一(「ComfyUI 音频输入用不了」)：档案/扫描器早就能产出 mediaKind:'audio'，这道校验却把它当
    // 非法值,把整份 parameterReferenceSlots 契约判 null,退化回旧的启发式/legacy 解析。'model3d' 才是
    // 真正超出 mediaKind 定义域(image/video/audio)的值,顶替占住这条"未知 mediaKind 必须整份拒绝"的覆盖。
    ['model3d mediaKind (真正超出 image/video/audio 定义域)', [validSlot, { ...validSlot, key: 'bad-media', mediaKind: 'model3d' }]],
    ['null mediaKind', [validSlot, { ...validSlot, key: 'bad-media', mediaKind: null }]],
    ['numeric mediaKind', [validSlot, { ...validSlot, key: 'bad-media', mediaKind: 1 }]],
  ])('rejects the whole contract for a mixed declaration containing %s', (_name, slots) => {
    expect(readParameterReferenceContract(metaWithSlots(slots))).toBeNull()
  })

  it('accepts a fully valid contract and treats omitted mediaKind as image-compatible', () => {
    expect(readParameterReferenceContract(metaWithSlots([
      validSlot,
      { ...validSlot, key: 'comfy_video_1', mediaKind: 'video' },
      { ...validSlot, key: 'comfy_image_2', mediaKind: 'image' },
      { ...validSlot, key: 'comfy_audio_1', mediaKind: 'audio' },
    ]))?.slots).toEqual([
      validSlot,
      { ...validSlot, key: 'comfy_video_1', mediaKind: 'video' },
      { ...validSlot, key: 'comfy_image_2', mediaKind: 'image' },
      { ...validSlot, key: 'comfy_audio_1', mediaKind: 'audio' },
    ])
  })

  it('rejects a declaration whose persisted identity does not match the node', () => {
    const meta = metaWithSlots([validSlot])
    meta.parameterReferenceSlots.modelKey = 'other-workflow'
    expect(readParameterReferenceContract(meta)).toBeNull()
  })
})
