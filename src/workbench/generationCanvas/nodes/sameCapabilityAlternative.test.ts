// 「这个模型此刻上游用不了」→ 失败卡「换成〈同能力的另一个〉」挑谁（用户 10-06 拍板：不自动换，点一下才换）。
import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import { pickSameCapabilityAlternative } from './sameCapabilityAlternative'

const option = (modelKey: string, vendor: string): ModelOption => ({ value: modelKey, label: `${vendor}/${modelKey}`, modelKey, vendor })
const editA = option('gpt-image-2', 'apimart')
const editB = option('nano-banana-2', 'kie')
const editSameKeyOtherVendor = option('gpt-image-2', 'kie')
const topaz = option('topaz/image-upscale', 'kie')
const recraft = option('recraft/crisp-upscale', 'kie')

describe('pickSameCapabilityAlternative', () => {
  it('取清单里第一个不是当前模型的（清单本来按偏好 / 健康排好）', () => {
    expect(pickSameCapabilityAlternative([editA, editB], { modelKey: 'gpt-image-2', vendorKey: 'apimart' })).toBe(editB)
  })

  it('同名模型换一家也算另一个（上游不可用是按供应商的）', () => {
    expect(pickSameCapabilityAlternative([editA, editSameKeyOtherVendor], { modelKey: 'gpt-image-2', vendorKey: 'apimart' })).toBe(editSameKeyOtherVendor)
  })

  it('普通改图不拿放大模型顶；放大只换放大', () => {
    expect(pickSameCapabilityAlternative([editA, topaz, editB], { modelKey: 'gpt-image-2', vendorKey: 'apimart' })).toBe(editB)
    expect(pickSameCapabilityAlternative([topaz, editA, recraft], { modelKey: 'topaz/image-upscale', vendorKey: 'kie' })).toBe(recraft)
  })

  it('同能力里没有另一个：返回 null（失败卡退回「换个模型」打开下拉）', () => {
    expect(pickSameCapabilityAlternative([editA, topaz], { modelKey: 'gpt-image-2', vendorKey: 'apimart' })).toBeNull()
    expect(pickSameCapabilityAlternative([], { modelKey: 'gpt-image-2', vendorKey: 'apimart' })).toBeNull()
  })
})
