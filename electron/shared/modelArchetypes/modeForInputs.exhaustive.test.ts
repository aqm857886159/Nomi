// 设计卡 ★9 第 1 条：每个档案 × 每个存着的 modeId（外加一个乱写的）× 9 种输入 × 两种偏好来历，现算出的方式都和输入对得上。
// 反例：把 modeForInputs 改回「直接用存着的 modeId」→ 下面「没输入 → 文字生成」「有输入 → 收得下」两组都红。
import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES } from './index'
import { SLOT_ACCEPTS } from './anchorPolicy'
import { modeForInputs, type ModeInput, type ModePreference } from './modeForInputs'
import type { ArchetypeMode } from './types'

const REFERENCE: ModeInput['slots'] = ['image_ref', 'video_ref', 'source_video', 'first_frame', 'last_frame', 'audio_ref']
const image = (): ModeInput => ({ slots: REFERENCE, asset: 'image' })
const INPUTS: Record<string, ModeInput[]> = {
  none: [],
  oneImage: [image()],
  twoImages: [image(), image()],
  fiveImages: [image(), image(), image(), image(), image()],
  onlyFirstFrame: [{ slots: ['first_frame', 'image_ref'], asset: 'image' }],
  onlyLastFrame: [{ slots: ['last_frame'], asset: 'image' }],
  referenceVideo: [{ slots: REFERENCE, asset: 'video' }],
  onlyReferenceAudio: [{ slots: REFERENCE, asset: 'audio' }],
  sourceVideo: [{ slots: ['source_video', 'video_ref'], asset: 'video' }],
}

function acceptsAny(mode: ArchetypeMode, inputs: readonly ModeInput[]): boolean {
  return inputs.some((input) => input.slots.some((kind) => SLOT_ACCEPTS[kind].includes(input.asset) && mode.slots.some((slot) => slot.kind === kind)))
}

const cells = MODEL_ARCHETYPES.flatMap((archetype) =>
  [...archetype.modes.map((mode) => mode.id), 'not-a-mode'].flatMap((modeId) =>
    (['unknown', 'human'] as const).flatMap((chosenBy) =>
      Object.entries(INPUTS).map(([inputName, inputs]) => ({ archetype, preference: { modeId, chosenBy } as ModePreference, inputName, inputs })))))

describe('modeForInputs 穷举（档案 × 存着的方式 × 输入）', () => {
  it('覆盖了全部档案', () => {
    expect(MODEL_ARCHETYPES.length).toBeGreaterThanOrEqual(130)
    expect(cells.length).toBeGreaterThan(130 * 9 * 2)
  })

  it('没有任何输入、档案有文字生成 → 按文字生成（声音档案除外：方式是人选的任务，照旧）', () => {
    const wrong = cells.filter(({ archetype, preference, inputs }) => {
      if (inputs.length || archetype.kind === 'audio' || !archetype.modes.some((mode) => mode.intent === 'text')) return false
      return modeForInputs(archetype, inputs, preference).mode.intent !== 'text'
    }).map(({ archetype, preference }) => `${archetype.id}:${preference.modeId}/${preference.chosenBy}`)
    expect(wrong).toEqual([])
  })

  it('有输入 → 方式至少收下一件、必需格子都满足；否则如实返回 needsInput / inputsNotAccepted', () => {
    const wrong = cells.filter(({ archetype, preference, inputs }) => {
      if (!inputs.length || archetype.kind === 'audio') return false
      const result = modeForInputs(archetype, inputs, preference)
      if (result.status !== 'ok') return false
      return !(result.taken > 0 && acceptsAny(result.mode, inputs))
    }).map(({ archetype, preference, inputName }) => `${archetype.id}:${preference.modeId}/${preference.chosenBy}/${inputName}`)
    expect(wrong).toEqual([])
  })

  it('有输入、某个方式收得下，就不会返回「没收下」', () => {
    const wrong = cells.filter(({ archetype, preference, inputs }) => {
      if (!inputs.length || archetype.kind === 'audio') return false
      const result = modeForInputs(archetype, inputs, preference)
      return result.status === 'inputsNotAccepted' && archetype.modes.some((mode) => acceptsAny(mode, inputs) && modeForInputs(archetype, inputs, { modeId: mode.id, chosenBy: 'human' }).taken > 0)
    }).map(({ archetype, preference, inputName }) => `${archetype.id}:${preference.modeId}/${inputName}`)
    expect(wrong).toEqual([])
  })

  it('来历不明的偏好放不下全部图 → 换成收得最多的方式（5 张图停在首尾帧写不出来）', () => {
    const wrong = cells.filter(({ archetype, preference, inputs }) => {
      if (preference.chosenBy !== 'unknown' || archetype.kind === 'audio' || inputs.length < 2) return false
      const result = modeForInputs(archetype, inputs, preference)
      const most = Math.max(...archetype.modes.map((mode) => {
        const r = modeForInputs(archetype, inputs, { modeId: mode.id, chosenBy: 'human' })
        return r.mode.id === mode.id && r.status === 'ok' ? r.taken : 0
      }))
      return result.status === 'ok' && result.taken < most
    }).map(({ archetype, preference, inputName }) => `${archetype.id}:${preference.modeId}/${inputName}`)
    expect(wrong).toEqual([])
  })

  it('layout 与 mode 不一致只出现在 mode 一张输入都没收下的情形', () => {
    const wrong = cells.filter(({ archetype, preference, inputs }) => {
      const result = modeForInputs(archetype, inputs, preference)
      return result.layout.id !== result.mode.id && result.taken > 0
    }).map(({ archetype, preference, inputName }) => `${archetype.id}:${preference.modeId}/${inputName}`)
    expect(wrong).toEqual([])
  })

  it('声音档案：照旧用存着的方式（认不出的落默认），不按输入改', () => {
    const wrong = cells.filter(({ archetype, preference, inputs }) => {
      if (archetype.kind !== 'audio') return false
      const expected = archetype.modes.find((mode) => mode.id === preference.modeId) ?? archetype.modes.find((mode) => mode.id === archetype.defaultModeId) ?? archetype.modes[0]
      return modeForInputs(archetype, inputs, preference).mode.id !== expected!.id
    }).map(({ archetype, preference, inputName }) => `${archetype.id}:${preference.modeId}/${inputName}`)
    expect(wrong).toEqual([])
  })
})

describe('modeForInputs 拍板稿的几格', () => {
  const seedance = MODEL_ARCHETYPES.find((archetype) => archetype.id === 'seedance-2')!
  const agnes = MODEL_ARCHETYPES.find((archetype) => archetype.id === 'agnes-video-2.5')!
  const five = INPUTS.fiveImages!

  it('人手选首尾帧 + 5 张 → 首尾帧，只收两张（其余「未用到」）', () => {
    const result = modeForInputs(seedance, five, { modeId: 'firstlast', chosenBy: 'human' })
    expect([result.mode.id, result.taken]).toEqual(['firstlast', 2])
  })

  it('来历不明的首尾帧 + 5 张 → 按参考，5 张都收', () => {
    const result = modeForInputs(seedance, five, { modeId: 'firstlast', chosenBy: 'unknown' })
    expect([result.mode.intent, result.taken]).toEqual(['character', 5])
  })

  it('人手选首尾帧只放一张 → 按首帧发（尾帧空则按首帧生成）', () => {
    expect(modeForInputs(seedance, INPUTS.oneImage!, { modeId: 'firstlast', chosenBy: 'human' }).mode.id).toBe('first')
  })

  it('人手选首尾帧、什么都没放 → 按文字发，参考行照首尾帧摆两个空格', () => {
    const result = modeForInputs(seedance, [], { modeId: 'firstlast', chosenBy: 'human' })
    expect([result.mode.intent, result.layout.id, result.notice]).toEqual(['text', 'firstlast', 'firstFrameEmpty'])
  })

  it('首帧特意空着、只放了尾帧、首帧必填 → 按文字发，尾帧不收（参考行照首尾帧摆）', () => {
    const result = modeForInputs(seedance, INPUTS.oneImage!, { modeId: 'firstlast', chosenBy: 'human' }, { firstFrameEmpty: true })
    expect([result.mode.intent, result.layout.id, result.notice, result.taken]).toEqual(['text', 'firstlast', 'onlyLastFrame', 0])
  })

  it('首帧特意空着、只放了尾帧、档案声明首帧可空 → 照发首尾帧', () => {
    const result = modeForInputs(agnes, INPUTS.oneImage!, { modeId: 'keyframe', chosenBy: 'human' }, { firstFrameEmpty: true })
    expect([result.mode.id, result.taken]).toEqual(['keyframe', 1])
  })

  it('存着文生、连着角色图 → 按参考发（07-28 反方向）', () => {
    expect(modeForInputs(seedance, INPUTS.oneImage!, { modeId: 't2v', chosenBy: 'unknown' }).mode.intent).toBe('character')
  })

  it('存着「参考」、没放图 → 按文字发', () => {
    const result = modeForInputs(seedance, [], { modeId: 'omni', chosenBy: 'unknown' })
    expect([result.mode.intent, result.status]).toEqual(['text', 'ok'])
  })

  it('没有文字生成的档案、没放图 → needsInput（情况 a）', () => {
    const upscale = MODEL_ARCHETYPES.find((archetype) => archetype.id === 'topaz-image-upscale')!
    expect(modeForInputs(upscale, [], null).status).toBe('needsInput')
  })
})
