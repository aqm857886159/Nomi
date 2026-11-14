import { describe, expect, it } from 'vitest'
import { selectDefaultImageModels, observeDefaultModelTurn, DEFAULT_MODEL_SPEND_CARD } from './agent-default-model-real.steps.mjs'

const model = modelKey => ({ vendorKey: 'provider', modelKey, kind: 'image', enabled: true, labelZh: modelKey })
const fixed = model('gemini-3.1-flash-image-preview')
const alternative = model('gpt-image-2')
const newer = model('new-image-model')
const catalog = models => ({ vendors: [{ key: 'provider', enabled: true }], models })
const defaults = { byTaskKind: { text_to_image: fixed } }

describe('默认模型跟随当次目录', () => {
  it('读取当前显式默认，目录换序也不变', () => {
    const forward = selectDefaultImageModels(catalog([fixed, alternative, newer]), defaults)
    const reversed = selectDefaultImageModels(catalog([newer, alternative, fixed]), defaults)
    expect(forward).toEqual(reversed)
    expect(forward.imageDefault.modelKey).toBe(fixed.modelKey)
  })
  it('移除旧固定模型后不再沿用它，随可用目录选择', () => {
    const result = selectDefaultImageModels(catalog([alternative, newer]), defaults)
    expect(result.imageDefault.modelKey).toBe(alternative.modelKey)
    expect(result.imageOther.modelKey).toBe(newer.modelKey)
  })
  it('过滤停用模型和供应商；只有一个时没有其他模型', () => {
    const result = selectDefaultImageModels(catalog([{ ...fixed, enabled: false }, alternative]))
    expect(result.imageDefault.modelKey).toBe(alternative.modelKey)
    expect(result.imageOther).toBeNull()
    expect(() => selectDefaultImageModels({ vendors: [], models: [fixed] })).toThrow()
  })
})

describe('发送后才判卡片', () => {
  it('发送前的可见卡或空闲态都不能算本轮落地', () => {
    expect(observeDefaultModelTurn({ sent: false, cardVisible: true, turnRunning: false })).toEqual({ settled: false, cardShown: false })
  })
  it('发送后按当前挂载点的可见卡判定，无卡则等回合结束', () => {
    expect(observeDefaultModelTurn({ sent: true, cardVisible: true, turnRunning: true })).toEqual({ settled: true, cardShown: true })
    expect(observeDefaultModelTurn({ sent: true, cardVisible: false, turnRunning: true })).toEqual({ settled: false, cardShown: false })
    expect(observeDefaultModelTurn({ sent: true, cardVisible: false, turnRunning: false })).toEqual({ settled: true, cardShown: false })
    expect(DEFAULT_MODEL_SPEND_CARD).toBe('[data-v4-block="intervention"][data-kind="spend"]:visible')
  })
})
