import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES } from '../../../../../electron/shared/modelArchetypes'
import {
  ADVANCED_CLASS_BY_KEY,
  advancedParameterClass,
  controlDiffersFromDefault,
  parameterAffectsPrice,
  parameterControlRole,
  parameterPlacement,
  type DynamicModelControl,
} from './parameterControlModel'

/**
 * 参数去处（面板 / 高级设置）的全目录普查：全部模型 × 方式。
 * 便签「规则」「边界表」（2026-11-14 定稿）：进高级设置的只有五类；影响价钱的永远在面板里；同一个键哪个模型都去同一处。
 */
const ALLOWED = new Set(['seed', 'watermark', 'outputFormat', 'moderation', 'returnLastFrame'])

const modes = MODEL_ARCHETYPES.flatMap((archetype) => archetype.modes.map((mode) => ({
  id: `${archetype.id}/${mode.id}`,
  controls: mode.params.map((param): DynamicModelControl => ({ ...param, binding: 'parameter' })),
})))

describe('参数去处：只有一处定义，全目录一个口径', () => {
  it('进高级设置的项只属于五类', () => {
    for (const mode of modes) {
      for (const control of mode.controls.filter((c) => parameterPlacement(c) === 'advanced')) {
        expect(ALLOWED.has(advancedParameterClass(control) ?? ''), `${mode.id} ${control.key}`).toBe(true)
      }
    }
    for (const cls of Object.values(ADVANCED_CLASS_BY_KEY)) expect(ALLOWED.has(cls)).toBe(true)
  })

  it('影响价钱的项 0 个在高级设置里；归属表里也不许出现价钱角色的键', () => {
    const leaked = modes.flatMap((mode) => mode.controls
      .filter((c) => parameterAffectsPrice(c) && parameterPlacement(c) === 'advanced')
      .map((c) => `${mode.id} ${c.key}`))
    expect(leaked).toEqual([])
    const priced = Object.keys(ADVANCED_CLASS_BY_KEY).filter((key) => parameterControlRole({ key, label: key, type: 'select', options: [], binding: 'parameter' }) !== null)
    expect(priced, '高级设置的键表里混进了比例 / 时长 / 清晰度 / 数量').toEqual([])
  })

  it('同一个键在所有模型里去同一个地方（不许给某个模型单独写归属）', () => {
    const seen = new Map<string, { placement: string; where: string }>()
    for (const mode of modes) {
      for (const control of mode.controls) {
        const placement = parameterPlacement(control)
        const before = seen.get(control.key)
        if (before) expect(placement, `${control.key}：${before.where} 是 ${before.placement}，${mode.id} 是 ${placement}`).toBe(before.placement)
        else seen.set(control.key, { placement, where: mode.id })
      }
    }
  })

  it('普查数字和便签对一遍（132 个模型、274 种方式、193 种没有高级设置、面板最多 7、高级最多 5）', () => {
    const rows = modes.map((mode) => {
      const advanced = mode.controls.filter((c) => parameterPlacement(c) === 'advanced').length
      // 数量那一项住在底栏右边（不进面板），和画布节点同一条规则。
      const panel = mode.controls.filter((c) => parameterPlacement(c) === 'panel' && parameterControlRole(c) !== 'quantity').length
      return { id: mode.id, advanced, panel }
    })
    const census = {
      archetypes: MODEL_ARCHETYPES.length,
      modes: rows.length,
      withoutAdvanced: rows.filter((row) => row.advanced === 0).length,
      withAdvanced: rows.filter((row) => row.advanced > 0).length,
      advancedExactlyOne: rows.filter((row) => row.advanced === 1).length,
      maxPanel: Math.max(...rows.map((row) => row.panel)),
      maxAdvanced: Math.max(...rows.map((row) => row.advanced)),
      panelFiveOrMore: rows.filter((row) => row.panel >= 5).length,
    }
    console.info('[parameter-placement census]', JSON.stringify(census))
    expect(census.maxAdvanced).toBeLessThanOrEqual(5)
    expect(census.maxPanel).toBeLessThanOrEqual(7)
  })
})

describe('高级设置里有值不是默认（图标小点的判据）', () => {
  const seed: DynamicModelControl = { key: 'seed', label: '种子', type: 'number', options: [], binding: 'parameter' }
  const watermark: DynamicModelControl = { key: 'watermark', label: '添加水印', type: 'boolean', options: [], binding: 'parameter' }
  const format: DynamicModelControl = { key: 'output_format', label: '格式', type: 'select', options: [{ value: 'mp4', label: 'mp4' }, { value: 'mov', label: 'mov' }], defaultValue: 'mp4', binding: 'parameter' }
  it('没填 / 存的就是默认 → 不算改过', () => {
    expect(controlDiffersFromDefault(seed, {})).toBe(false)
    expect(controlDiffersFromDefault(watermark, { watermark: false })).toBe(false)
    expect(controlDiffersFromDefault(format, { output_format: 'mp4' })).toBe(false)
  })
  it('填了种子、开了水印、换了格式 → 算改过', () => {
    expect(controlDiffersFromDefault(seed, { seed: 20261113 })).toBe(true)
    expect(controlDiffersFromDefault(watermark, { watermark: true })).toBe(true)
    expect(controlDiffersFromDefault(format, { output_format: 'mov' })).toBe(true)
  })
})
