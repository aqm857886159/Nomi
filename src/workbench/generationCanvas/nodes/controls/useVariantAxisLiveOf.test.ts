import { describe, expect, it } from 'vitest'
import { modeTransportFor, resolveArchetypeForModel } from '../../../../../electron/shared/modelArchetypes'
import type { ModelOption } from '../../../../config/models'
import { vendorMappingsReader } from './useChannelCreateBody'
import { variantAxisLiveForProviders } from './useVariantAxisLiveOf'

const option = { value: 'veo3.1', label: 'Veo 3.1', vendor: 'runwayish', modelKey: 'veo3.1', meta: { archetypeId: 'veo-3.1' } } as unknown as ModelOption
const archetype = resolveArchetypeForModel({ modelKey: option.modelKey, vendorKey: option.vendor, meta: option.meta })

/** 给这个档案的前 n 个模式各造一条该家的渠道映射。 */
function mappingsFor(model: string, modes: number) {
  return archetype!.modes.slice(0, modes).map((mode) => ({
    id: `m-${mode.id}`, vendorKey: 'runwayish', taskKind: modeTransportFor(mode, archetype!, 'runwayish'), modelKey: 'veo3.1',
    modeId: mode.id, enabled: true, create: { body: { model, prompt: '{{request.prompt}}' } },
  }))
}

describe('菜单行的变体轴起不起作用', () => {
  it('型号名写死的渠道（如 Runway）：线缆里没有 model 参数 → 不起作用，哪怕档案里还有别的模式这家没接', () => {
    expect(archetype && archetype.modes.length).toBeGreaterThan(1)
    const read = vendorMappingsReader(mappingsFor('veo3.1', 1))
    expect(variantAxisLiveForProviders([{ option }], read)).toBe(false)
  })
  it('型号名参数化的渠道：起作用', () => {
    const read = vendorMappingsReader(mappingsFor('{{request.params.model}}', 1))
    expect(variantAxisLiveForProviders([{ option }], read)).toBe(true)
  })
  it('查不到线缆（映射表还没载好）：不藏，算起作用', () => {
    expect(variantAxisLiveForProviders([{ option }], vendorMappingsReader(undefined))).toBe(true)
  })
})
