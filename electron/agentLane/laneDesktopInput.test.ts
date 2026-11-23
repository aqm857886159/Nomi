import { describe, expect, it } from 'vitest'
import { parseLaneComposerContext } from './laneDesktopInput'

function sampleModel(modelId: string) {
  return {
    vendor: 'apimart',
    modelId,
    modelAlias: null,
    label: modelId,
    kind: 'image' as const,
    defaultModeId: 't2i',
    modes: [{ modeId: 't2i', vendorTerm: 'Text to Image', intent: 'generate', hint: 'text to image', slots: [], params: [] }],
  }
}

describe('parseLaneComposerContext availableModels 缓存与严格校验', () => {
  it('相同 availableModels 复用已校验引用；改动任一字段立刻重新解析；非法字段照旧 fail-closed', () => {
    const modelsA = [sampleModel('seedream-5.0'), sampleModel('seedance-2.0')]
    const first = parseLaneComposerContext({
      approvalPolicy: { mode: 'request' },
      availableModels: modelsA,
    })
    const second = parseLaneComposerContext({
      approvalPolicy: { mode: 'request' },
      availableModels: [sampleModel('seedream-5.0'), sampleModel('seedance-2.0')],
    })
    expect(second.availableModels).toBe(first.availableModels)

    // 反例 1：列表项变了，必须重新解析拿到新值
    const third = parseLaneComposerContext({
      approvalPolicy: { mode: 'request' },
      availableModels: [sampleModel('seedream-5.0'), sampleModel('kling-4.0')],
    })
    expect(third.availableModels).not.toBe(first.availableModels)
    expect(third.availableModels?.map((m) => m.modelId)).toEqual(['seedream-5.0', 'kling-4.0'])

    // 反例 2：带多余未知字段仍被 strict schema 拒收
    expect(() => parseLaneComposerContext({
      approvalPolicy: { mode: 'request' },
      availableModels: [{ ...sampleModel('seedream-5.0'), injectedField: true }],
    })).toThrow()
  })
})
