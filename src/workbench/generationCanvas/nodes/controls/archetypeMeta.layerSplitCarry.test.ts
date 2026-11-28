// 换模型时「拆图层」这件人选的任务怎么带（设计卡 docs/plan/2026-11-26-layer-split.md）。
// 2026-11-26 真窗口复现：派生节点从 Seedream 5.0 Pro（图层分离）换成 5.5，偏好按「意图 edit」落成了普通改图 ——
// 发出去就是一次付费的普通改图、只回一张图。图层分离只能带到新档案的图层分离方式；新档案没有就不带。
import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES } from '../../../../../electron/shared/modelArchetypes/builtInCatalog'
import { LAYER_SPLIT_MODE_ID } from '../../../../../electron/shared/modelArchetypes/modeForInputs'
import { carryHumanModePreference } from './archetypeMeta'
import { readModePreference } from './modePreference'

const archetype = (id: string) => {
  const found = MODEL_ARCHETYPES.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`missing archetype ${id}`)
  return found
}

describe('换模型带「拆图层」', () => {
  const pro = archetype('seedream-5-pro')
  const v55 = archetype('seedream-5-5')
  const editOnly = MODEL_ARCHETYPES.find((candidate) => candidate.kind !== 'audio'
    && candidate.modes.some((mode) => mode.intent === 'edit') && !candidate.modes.some((mode) => mode.layerSplit))!

  it('5.0 Pro 的图层分离 → 5.5 的图层分离，仍算人手选的', () => {
    const meta = { archetype: { id: pro.id, modeId: LAYER_SPLIT_MODE_ID, modeChosenBy: 'human' } }
    expect(readModePreference(v55, carryHumanModePreference(meta, pro, v55))).toEqual({ modeId: LAYER_SPLIT_MODE_ID, chosenBy: 'human' })
  })

  it('换到不能拆的模型：不带（不落成普通改图），按输入现算', () => {
    const meta = { archetype: { id: v55.id, modeId: LAYER_SPLIT_MODE_ID, modeChosenBy: 'human' } }
    expect(readModePreference(editOnly, carryHumanModePreference(meta, v55, editOnly))).toBeNull()
  })

  it('普通改图照旧带成普通改图，不会落到图层分离', () => {
    const editMode = pro.modes.find((mode) => mode.intent === 'edit' && !mode.layerSplit)!
    const meta = { archetype: { id: pro.id, modeId: editMode.id, modeChosenBy: 'human' } }
    const carried = readModePreference(v55, carryHumanModePreference(meta, pro, v55))
    expect(carried?.modeId).not.toBe(LAYER_SPLIT_MODE_ID)
    expect(v55.modes.find((mode) => mode.id === carried?.modeId)?.intent).toBe('edit')
  })
})
