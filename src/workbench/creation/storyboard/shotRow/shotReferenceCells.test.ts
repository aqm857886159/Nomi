import { describe, expect, it } from 'vitest'
import type { ArchetypeMode } from '../../../../config/modelArchetypes/types'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { cellCount, referenceColumnOf } from './shotReferenceCells'

const modeOf = (slots: ArchetypeMode['slots']): ArchetypeMode => ({
  id: 'm', intent: 'character', vendorTerm: 'x', hint: '', slots, params: [], promptRequired: true,
})
const shotOf = (bindings?: PlanShot['referenceBindings']): PlanShot => ({
  index: 1, durationSec: 5, anchorIds: [], prompt: 'p', ...(bindings ? { referenceBindings: bindings } : {}),
})

describe('shotReferenceCells', () => {
  it('一个槽一个格：30 张图的 image_ref 仍然只占一个格（v5 是一张图一个格，会把行高撑爆）', () => {
    const column = referenceColumnOf(
      modeOf([{ kind: 'image_ref', label: '角色参考', min: 0, max: 30, characterIndexed: true }]),
      shotOf({ image_ref: Array.from({ length: 30 }, (_, i) => ({ url: `u${i}` })) }).referenceBindings,
    )
    expect(column.kind).toBe('cells')
    if (column.kind !== 'cells') return
    expect(column.cells).toHaveLength(1)
    expect(cellCount(column.cells[0])).toEqual({ used: 30, total: 30 })
    expect(column.cells[0].numbered).toBe(true)
  })

  it('同一 mode 内必填度可以不同（Veo 帧：首帧红必填、尾帧灰可选）——判据只看 min', () => {
    const column = referenceColumnOf(
      modeOf([
        { kind: 'first_frame', label: '首帧', min: 1, max: 1 },
        { kind: 'last_frame', label: '尾帧', min: 0, max: 1 },
      ]),
      shotOf().referenceBindings,
    )
    if (column.kind !== 'cells') throw new Error('expected cells')
    expect(column.cells.map((cell) => cell.required)).toEqual([true, false])
  })

  it('max 缺省 = 供应商没公布上限：角标不显分母，不编造一个假上限', () => {
    const column = referenceColumnOf(modeOf([{ kind: 'image_ref', label: '参考图', min: 0 }]), shotOf({ image_ref: [{ url: 'a' }] }).referenceBindings)
    if (column.kind !== 'cells') throw new Error('expected cells')
    expect(cellCount(column.cells[0])).toEqual({ used: 1, total: null })
  })

  it('不吃参考 / 契约未知是两种不同的空，不许混成一个', () => {
    expect(referenceColumnOf(modeOf([]), shotOf().referenceBindings).kind).toBe('none-accepted')
    expect(referenceColumnOf(null, shotOf().referenceBindings).kind).toBe('unknown-contract')
  })

  it('换 mode 后只画新 mode 声明的槽，上一个 mode 的绑定不显示（但数据仍留着，切回来还在）', () => {
    const shot = shotOf({ first_frame: [{ url: 'f' }], image_ref: [{ url: 'i' }] })
    const column = referenceColumnOf(modeOf([{ kind: 'image_ref', label: '参考图', min: 0, max: 3 }]), shot.referenceBindings)
    if (column.kind !== 'cells') throw new Error('expected cells')
    expect(column.cells.map((cell) => cell.key)).toEqual(['image_ref'])
    expect(shot.referenceBindings?.first_frame).toHaveLength(1)
  })
})
