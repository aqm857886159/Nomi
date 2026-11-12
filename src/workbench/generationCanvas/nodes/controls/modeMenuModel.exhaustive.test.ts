// 设计卡「11-12 改向」第 3 步：方式菜单每行的小字 = 档案算出来的纯函数。130+ 个档案 × 每种方式 × 0–4 张图（另加视频 / 音频），
// 中英两轨真翻译：不出空串、不漏 key、能点的就是选了会生效的、置灰的报的数和档案槽上限一致。
// 反例：把置灰判断改成恒不置灰 → 「能点 ⇔ 选了会生效」红；把小字里的数改成档案 max 以外的值 → 「报数和槽上限一致」红。
import { describe, expect, it } from 'vitest'
import i18n from '../../../../i18n'
import { MODEL_ARCHETYPES, specializeArchetypeForVendor, type ArchetypeMode } from '../../../../../electron/shared/modelArchetypes'
import { modeForInputs, modeTakenCount, type ModeInput } from '../../../../../electron/shared/modelArchetypes/modeForInputs'
import { buildModeMenu, modeDisplayKind, modeRowName, renderModeMenuText, type ModeMenuText } from './modeMenuModel'

const REFERENCE: ModeInput['slots'] = ['image_ref', 'video_ref', 'source_video', 'first_frame', 'last_frame', 'audio_ref']
const images = (count: number): ModeInput[] => Array.from({ length: count }, () => ({ slots: REFERENCE, asset: 'image' as const }))
const INPUTS: Record<string, ModeInput[]> = {
  none: [], one: images(1), two: images(2), three: images(3), four: images(4),
  video: [{ slots: REFERENCE, asset: 'video' }], imageAndAudio: [...images(1), { slots: REFERENCE, asset: 'audio' }],
}
const video = MODEL_ARCHETYPES.filter((archetype) => archetype.kind === 'video')
const LOCALES = ['zh-CN', 'en'] as const
const tOf = (locale: string) => i18n.getFixedT(locale) as unknown as (key: string, values?: Record<string, unknown>) => string

function keysOf(text: ModeMenuText): string[] {
  return [text.key, ...(text.list?.items.flatMap(keysOf) ?? []), ...(text.name && typeof text.name !== 'string' ? keysOf(text.name) : [])]
}

const cases = video.flatMap((archetype) => Object.entries(INPUTS).map(([inputName, inputs]) => {
  const resolved = modeForInputs(archetype, inputs, null)
  const menu = buildModeMenu({ nodeKind: 'video', archetype, visible: archetype.modes.map((mode) => ({ id: mode.id, vendorTerm: mode.vendorTerm })), inputs, resolvedModeId: resolved.mode.id })
  return { archetype, inputName, inputs, resolved, menu }
}))

describe('方式菜单穷举（视频档案 × 每种方式 × 0–4 张图）', () => {
  it('覆盖了全部视频档案，只有一种方式的不出菜单', () => {
    expect(video.length).toBeGreaterThan(40)
    for (const { archetype, menu } of cases) expect(Boolean(menu), archetype.id).toBe(archetype.modes.length > 1)
  })

  it('能点 ⇔ 选了它 owner 真按它发（放得下全部输入）；带勾的就是这次真发的', () => {
    const wrong: string[] = []
    for (const { archetype, inputName, inputs, resolved, menu } of cases) {
      if (!menu) continue
      if (menu.activeId !== resolved.mode.id) wrong.push(`${archetype.id}/${inputName}: active`)
      for (const row of menu.rows) {
        const takesEffect = modeForInputs(archetype, inputs, { modeId: row.id, chosenBy: 'human' }).mode.id === row.id
        if (row.disabled === takesEffect) wrong.push(`${archetype.id}/${inputName}/${row.id}`)
      }
      if (menu.rows.find((row) => row.id === resolved.mode.id)?.disabled && resolved.taken === inputs.length) wrong.push(`${archetype.id}/${inputName}: resolved row greyed`)
    }
    expect(wrong).toEqual([])
  })

  it('中英两轨：名字和小字都不空、key 都在词典里', () => {
    const wrong: string[] = []
    for (const locale of LOCALES) {
      const t = tOf(locale)
      for (const { archetype, inputName, menu } of cases) {
        for (const row of menu?.rows ?? []) {
          const name = modeRowName(t, row)
          const description = renderModeMenuText(t, row.description)
          if (!name.trim() || !description.trim()) wrong.push(`${locale}/${archetype.id}/${inputName}/${row.id}: empty`)
          for (const key of keysOf(row.description)) if (!i18n.exists(key, { lng: locale, count: 2 }) && !i18n.exists(`${key}_other`, { lng: locale })) wrong.push(`${locale}: ${key}`)
          if (/\{\{|undefined|NaN|Infinity/.test(description)) wrong.push(`${locale}/${archetype.id}/${inputName}/${row.id}: ${description}`)
        }
      }
    }
    expect([...new Set(wrong)]).toEqual([])
  })

  it('置灰行报的数和档案对得上：已放几件 = 输入数，最多几张 = 这个方式按槽上限收得下的数', () => {
    const wrong: string[] = []
    for (const { archetype, inputName, inputs, menu } of cases) {
      for (const row of menu?.rows ?? []) {
        if (!row.disabled || !inputs.length) continue
        const mode = archetype.modes.find((candidate) => candidate.id === row.id) as ArchetypeMode
        const values = row.description.values ?? {}
        if (/takes(One|UpTo|None)|textTakesNone/.test(row.description.key) && values.count !== inputs.length) wrong.push(`${archetype.id}/${inputName}/${row.id}: count`)
        if (/takesUpTo/.test(row.description.key) && values.taken !== modeTakenCount(mode, inputs)) wrong.push(`${archetype.id}/${inputName}/${row.id}: taken`)
        if (/takesOne/.test(row.description.key) && modeTakenCount(mode, inputs) !== 1) wrong.push(`${archetype.id}/${inputName}/${row.id}: one`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('能点的全能参考行报的上限 = 档案槽上限（Seedance 2.5：最多 30 张图、10 段视频、10 段音频）', () => {
    const seedance = cases.find((item) => item.archetype.id === 'seedance-2.5' && item.inputName === 'one')!
    const row = seedance.menu!.rows.find((candidate) => candidate.id === 'omni')!
    expect(renderModeMenuText(tOf('zh-CN'), row.description)).toBe('最多 30 张图、10 段视频、10 段音频')
    expect(renderModeMenuText(tOf('en'), row.description)).toBe('Up to 30 images, 10 videos, 10 audio clips')
    for (const { archetype, menu } of cases) {
      for (const row of menu?.rows ?? []) {
        if (row.disabled || row.description.key !== 'generationCommon.modeMenu.upTo') continue
        const mode = archetype.modes.find((candidate) => candidate.id === row.id)!
        const imageMax = mode.slots.filter((slot) => slot.kind === 'image_ref').reduce((sum, slot) => sum + (slot.max ?? 0), 0)
        const item = row.description.list!.items.find((candidate) => candidate.key.endsWith('limitImages'))
        if (item) expect(item.values!.count, `${archetype.id}/${row.id}`).toBe(Math.min(imageMax, mode.maxTotalReferences ?? Infinity))
      }
    }
  })

  it('样张 A / B / D 的原话（Seedance 2.5）', () => {
    const zh = tOf('zh-CN')
    const line = (inputName: string) => Object.fromEntries(cases.find((item) => item.archetype.id === 'seedance-2.5' && item.inputName === inputName)!.menu!.rows.map((row) => [modeRowName(zh, row), [renderModeMenuText(zh, row.description), row.disabled]]))
    expect(line('none')).toEqual({ 文生视频: ['只用文字', false], 图生视频: ['先放 1 张图', true], 首尾帧: ['先放 2 张图', true], 全能参考: ['先放图、视频或音频', true] })
    expect(line('one')).toMatchObject({ 文生视频: ['已放 1 张图，文生视频不带图', true], 图生视频: ['1 张图当开头', false], 全能参考: ['最多 30 张图、10 段视频、10 段音频', false] })
    expect(line('three')).toEqual({
      文生视频: ['已放 3 张图，文生视频不带图', true], 图生视频: ['已放 3 张，图生视频只用 1 张', true],
      首尾帧: ['已放 3 张，首尾帧最多 2 张', true], 全能参考: ['最多 30 张图、10 段视频、10 段音频', false],
    })
    // 连进一段参考视频：图生视频只能取它的尾帧当接力首帧——不算收下，灰掉报「用不上」；按全能参考发（2026-11-12）。
    expect(line('video')).toMatchObject({ 图生视频: ['已放 1 件素材，这种方式一件也用不上', true], 全能参考: ['最多 30 张图、10 段视频、10 段音频', false] })
  })

  // 2026-11-12 真 App 复现（tests/ux/mode-bar-replay.walk.mjs）：APIMart Seedance 2.0 的菜单里两行都叫「图生视频」、两行没图标。
  // 反例：撞名消解退回「撞了就都用档案真名、类改成 other」→ 下面三条红。
  const everyMenu = () => MODEL_ARCHETYPES.filter((archetype) => archetype.kind === 'video').flatMap((raw) => [undefined, 'apimart', 'kie', 'official'].map((vendor) => {
    const archetype = vendor ? specializeArchetypeForVendor(raw, vendor) : raw
    const menu = buildModeMenu({ nodeKind: 'video', archetype, visible: archetype.modes.map((mode) => ({ id: mode.id, vendorTerm: mode.vendorTerm })), inputs: [], resolvedModeId: archetype.modes[0]!.id })
    return { label: `${archetype.id}${vendor ? `@${vendor}` : ''}`, archetype, menu }
  }))

  it('同一个菜单里没有两行同名（全部视频档案 × 每个渠道特化 × 中英两轨）', () => {
    const wrong: string[] = []
    for (const locale of LOCALES) {
      const t = tOf(locale)
      for (const { label, menu } of everyMenu()) {
        const names = (menu?.rows ?? []).map((row) => modeRowName(t, row))
        if (new Set(names).size !== names.length) wrong.push(`${locale}/${label}: ${names.join(' / ')}`)
      }
    }
    expect([...new Set(wrong)]).toEqual([])
  })

  it('按槽形状认得出的方式每行都有图标（撞名消解不把类丢成 other）', () => {
    const wrong: string[] = []
    for (const { label, archetype, menu } of everyMenu()) {
      for (const row of menu?.rows ?? []) {
        const mode = archetype.modes.find((candidate) => candidate.id === row.id)!
        if (row.kind === 'other' && modeDisplayKind(archetype, mode) !== 'other') wrong.push(`${label}/${row.id}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('APIMart Seedance 2.0 的四行：文生视频 / 图生视频 / 全能参考 / 首尾帧，小字按槽说', () => {
    const item = cases.find((candidate) => candidate.archetype.id === 'seedance-2-apimart' && candidate.inputName === 'one')!
    const zh = tOf('zh-CN')
    expect(item.menu!.rows.map((row) => [modeRowName(zh, row), row.kind, renderModeMenuText(zh, row.description)])).toEqual([
      ['文生视频', 'text', '已放 1 张图，文生视频不带图'],
      ['图生视频', 'image', '最多 9 张图'],
      ['全能参考', 'reference', '最多 9 张图、3 段视频、3 段音频'],
      ['首尾帧', 'firstLast', '开头 1 张，结尾可以不放'],
    ])
    expect(item.menu!.rows.map((row) => modeRowName(tOf('en'), row))).toEqual(['Text to video', 'Image to video', 'Reference', 'First & last frame'])
  })

  it('可灵 4.0 只有两种：文生视频 / 图生视频（首尾帧并在图生视频里）', () => {
    const kling = cases.find((item) => item.archetype.id === 'kling-v4' && item.inputName === 'none')!
    expect(kling.menu!.rows.map((row) => modeRowName(tOf('zh-CN'), row))).toEqual(['文生视频', '图生视频'])
  })
})
