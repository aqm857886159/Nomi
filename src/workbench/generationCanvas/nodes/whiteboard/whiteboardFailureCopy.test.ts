/**
 * 画板失败提示的词表（2026-10-27）：「完成」从 10-22 起出的是画好的图，不是截图，所以出图失败说「图没存下来」，
 * 只有相机在画板入口建截图节点时才说「截图没存下来」。旧的三个键（截图保存失败 / 截图失败 / 画板保存失败）同提交删掉，
 * 不留同义词。出图那句由三扇门共用（画板「完成」、图片入口「完成」、图片入口相机「保存为主图」），所以不点名任何一个按钮。
 * 值一律按键从词典取，不抄文案。
 */
import { describe, expect, it } from 'vitest'
import { enGenerationCommon, zhGenerationCommon } from '../../../../i18n/locales/generationCommon'

const locales = [
  ['zh', zhGenerationCommon.whiteboard],
  ['en', enGenerationCommon.whiteboard],
] as const

describe.each(locales)('画板失败提示（%s）', (_locale, whiteboard) => {
  const copy = whiteboard as Record<string, unknown>

  it('出图和截图各有一句失败提示', () => {
    expect(typeof copy.drawingSaveFailed).toBe('string')
    expect(typeof copy.screenshotSaveFailed).toBe('string')
    expect(String(copy.drawingSaveFailed).trim()).not.toBe('')
    expect(String(copy.screenshotSaveFailed).trim()).not.toBe('')
    expect(copy.drawingSaveFailed).not.toBe(copy.screenshotSaveFailed)
  })

  it('旧的截图 / 保存失败键都不在了', () => {
    expect(copy).not.toHaveProperty('snapshotSaveFailed')
    expect(copy).not.toHaveProperty('screenshotFailed')
    expect(copy).not.toHaveProperty('saveFailed')
  })

  it('出图那句三扇门共用，不点名「完成」或「保存为主图」', () => {
    const sentence = String(copy.drawingSaveFailed)
    expect(sentence).not.toContain(String(copy.done))
    expect(sentence).not.toContain(String(copy.savePrimary))
  })
})
