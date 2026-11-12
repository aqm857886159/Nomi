// 设计卡「11-12 改向」第 3 步：每个档案 × 每个存着的方式（外加一个乱写的、和没存）× 0–4 张图和几种别的输入 × 两种偏好来历，
// 现算出的方式都守住这几条：没放输入 = 文生；偏好放得下全部才用；有方式放得下全部就一定放得下全部；都放不下时收得最多。
// 反例：把 modeForInputs 改回「直接用存着的 modeId」→「放得下全部就放得下全部」「偏好放不下不算数」两组红；
// 把自动换方式关掉（偏好放不下也照用）→ 同两组红。
import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES } from './index'
import { modeForInputs, modeTakenCount, modeTakesAllInputs, type ModeInput, type ModePreference } from './modeForInputs'

const REFERENCE: ModeInput['slots'] = ['image_ref', 'video_ref', 'source_video', 'first_frame', 'last_frame', 'audio_ref']
const image = (): ModeInput => ({ slots: REFERENCE, asset: 'image' })
const images = (count: number): ModeInput[] => Array.from({ length: count }, image)
const INPUTS: Record<string, ModeInput[]> = {
  none: [],
  oneImage: images(1),
  twoImages: images(2),
  threeImages: images(3),
  fourImages: images(4),
  onlyFirstFrame: [{ slots: ['first_frame', 'image_ref'], asset: 'image' }],
  firstFrameAndTwoRefs: [{ slots: ['first_frame', 'image_ref'], asset: 'image' }, image(), image()],
  referenceVideo: [{ slots: REFERENCE, asset: 'video' }],
  onlyReferenceAudio: [{ slots: REFERENCE, asset: 'audio' }],
  sourceVideo: [{ slots: ['source_video', 'video_ref'], asset: 'video' }],
}

const visual = MODEL_ARCHETYPES.filter((archetype) => archetype.kind !== 'audio')
const cells = visual.flatMap((archetype) =>
  [null, ...archetype.modes.map((mode) => mode.id), 'not-a-mode'].flatMap((modeId) =>
    (['unknown', 'human'] as const).flatMap((chosenBy) =>
      Object.entries(INPUTS).map(([inputName, inputs]) => ({
        archetype, preference: modeId === null ? null : ({ modeId, chosenBy } as ModePreference), inputName, inputs,
      })))))
const label = (cell: (typeof cells)[number]) => `${cell.archetype.id}:${cell.preference?.modeId ?? '-'}/${cell.preference?.chosenBy ?? '-'}/${cell.inputName}`
const requiredOk = (mode: (typeof visual)[number]['modes'][number], inputs: readonly ModeInput[]) =>
  modeTakenCount(mode, inputs) > 0 && modeForInputs({ ...visual[0]!, modes: [mode], defaultModeId: mode.id }, inputs, null).status === 'ok'

describe('modeForInputs 穷举（档案 × 存着的方式 × 输入）', () => {
  it('覆盖了全部档案和 0–4 张图', () => {
    expect(MODEL_ARCHETYPES.length).toBeGreaterThanOrEqual(130)
    expect(cells.length).toBeGreaterThan(visual.length * 10 * 2)
  })

  it('① 没放输入、档案有文字生成 → 文生（偏好不起作用）', () => {
    const wrong = cells.filter((cell) => !cell.inputs.length && cell.archetype.modes.some((mode) => mode.intent === 'text'))
      .filter((cell) => modeForInputs(cell.archetype, cell.inputs, cell.preference).mode.slots.length !== 0)
    expect(wrong.map(label)).toEqual([])
  })

  it('有方式放得下全部输入 → 现算的那种一定放得下全部（② ③ ④：自动换成放得下的）', () => {
    const wrong = cells.filter((cell) => cell.inputs.length > 0 && cell.archetype.modes.some((mode) => modeTakesAllInputs(mode, cell.inputs)))
      .filter((cell) => {
        const result = modeForInputs(cell.archetype, cell.inputs, cell.preference)
        return !(result.status === 'ok' && result.taken === cell.inputs.length && modeTakesAllInputs(result.mode, cell.inputs))
      })
    expect(wrong.map(label)).toEqual([])
  })

  /**
   * 偏好只能把参考视频当接力首帧（没有参考视频格、有首帧格），而另有方式原样收下这段视频：不算放得下。
   * 用每格只放一个件的笨办法判，不复用被测函数的内部。
   */
  const relayInsteadOfReference = (cell: (typeof cells)[number]): boolean => {
    if (cell.inputName !== 'referenceVideo') return false
    const preferred = cell.archetype.modes.find((mode) => mode.id === cell.preference!.modeId)!
    const kinds = new Set(preferred.slots.map((slot) => slot.kind))
    if (kinds.has('video_ref') || kinds.has('source_video') || !kinds.has('first_frame')) return false
    return cell.archetype.modes.some((mode) => mode.slots.some((slot) => slot.kind === 'video_ref' || slot.kind === 'source_video') && modeTakesAllInputs(mode, cell.inputs))
  }

  it('③ 偏好放得下全部 → 用偏好；放不下 → 不用它（手选只在放得下全部时生效；首帧偏好不把参考视频悄悄当接力首帧）', () => {
    const wrong = cells.filter((cell) => cell.preference && cell.inputs.length > 0).filter((cell) => {
      const preferred = cell.archetype.modes.find((mode) => mode.id === cell.preference!.modeId)
      if (!preferred) return false
      const result = modeForInputs(cell.archetype, cell.inputs, cell.preference)
      const fits = modeTakesAllInputs(preferred, cell.inputs) && !relayInsteadOfReference(cell)
      return fits ? result.mode.id !== preferred.id : result.mode.id === preferred.id && result.taken === cell.inputs.length
    })
    expect(wrong.map(label)).toEqual([])
  })

  it('⑧ 没有方式放得下全部 → 留在收得最多的那种（taken 不比任何能发的方式少），多出的不会发', () => {
    const wrong = cells.filter((cell) => cell.inputs.length > 0 && !cell.archetype.modes.some((mode) => modeTakesAllInputs(mode, cell.inputs)))
      .filter((cell) => {
        const result = modeForInputs(cell.archetype, cell.inputs, cell.preference)
        if (result.status !== 'ok') return false
        const best = Math.max(0, ...cell.archetype.modes.filter((mode) => requiredOk(mode, cell.inputs)).map((mode) => modeTakenCount(mode, cell.inputs)))
        return result.taken !== modeTakenCount(result.mode, cell.inputs) || result.taken < best || result.taken >= cell.inputs.length
      })
    expect(wrong.map(label)).toEqual([])
  })

  it('一件都收不下 → 有文生就按文生发（inputsNotAccepted），否则 needsInput；绝不说 ok 却一件没收', () => {
    const wrong = cells.filter((cell) => cell.inputs.length > 0).filter((cell) => {
      const result = modeForInputs(cell.archetype, cell.inputs, cell.preference)
      return result.status === 'ok' && result.taken === 0
    })
    expect(wrong.map(label)).toEqual([])
  })

  it('偏好来历不影响结果（人手选的和老项目存的同一个规则）', () => {
    const wrong = cells.filter((cell) => cell.preference?.chosenBy === 'human').filter((cell) => {
      const human = modeForInputs(cell.archetype, cell.inputs, cell.preference)
      const unknown = modeForInputs(cell.archetype, cell.inputs, { ...cell.preference!, chosenBy: 'unknown' })
      return human.mode.id !== unknown.mode.id || human.taken !== unknown.taken
    })
    expect(wrong.map(label)).toEqual([])
  })
})
