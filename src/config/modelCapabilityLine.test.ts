import { afterEach, describe, expect, it } from 'vitest'
import { getArchetypeById, specializeArchetypeForVariant } from '../../electron/shared/modelArchetypes'
import i18n from '../i18n'
import { modelCapabilityLine } from './modelCapabilityLine'

describe('modelCapabilityLine（一行能力描述，按档案现算）', () => {
  afterEach(async () => { await i18n.changeLanguage('zh-CN') })

  it('视频：输入方式 · 最高分辨率 · 最长时长，至多 3 项', () => {
    const line = modelCapabilityLine(getArchetypeById('seedance-2.5-apimart'))
    expect(line.split(' · ').length).toBeLessThanOrEqual(3)
    expect(line).toMatch(/文生/)
    expect(line).toMatch(/最高 \d+/)
    expect(line).toMatch(/最长 \d+ 秒/)
  })

  it('变体按自己收窄后的档案算：Fast 的分辨率上限不高于标准', () => {
    const base = getArchetypeById('seedance-2-apimart')!
    const rank = (line: string) => { const m = /最高 (\d+)([pK])/.exec(line); return m ? Number(m[1]) * (m[2] === 'K' ? 1000 : 1) : 0 }
    expect(rank(modelCapabilityLine(specializeArchetypeForVariant(base, 'fast')))).toBeLessThan(rank(modelCapabilityLine(specializeArchetypeForVariant(base, 'standard'))))
  })

  it('图片：文生图 / 改图；没有档案 → 空串（不编）', () => {
    expect(modelCapabilityLine(getArchetypeById('gpt-image-2.6-flare'))).toMatch(/文生图/)
    expect(modelCapabilityLine(null)).toBe('')
    expect(modelCapabilityLine(undefined)).toBe('')
  })

  it('英文界面走英文词表，同一份档案同一个结构', async () => {
    await i18n.changeLanguage('en')
    const line = modelCapabilityLine(getArchetypeById('seedance-2.5-apimart'))
    expect(line).toMatch(/Text/)
    expect(line).toMatch(/Up to \d+/)
    expect(line).not.toMatch(/[一-鿿]/)
  })
})
