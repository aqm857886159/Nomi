/** 景别量不到时不写「未测量」：镜头卡 / 小窗只留运镜（外包卡 20，用户 10-05 拍板）；量得到时照旧「景别 · 运镜」。 */
import { afterAll, describe, expect, it } from 'vitest'
import i18n from '../../../../../../i18n'
import type { DirectorShotSummary } from '../../model/directorShotSummaries'
import { makeShotLabels } from './shotLabels'

const shot = (shotSize: DirectorShotSummary['shotSize'], move: string): DirectorShotSummary => ({ start: 8.3, end: 10.3, cameraId: 'shot:c/camera', shotSize, move, actions: [] })

describe.each([['zh-CN', false, '未测量', '固定', '中近景 · 固定', '镜头 3 · 固定'], ['en', true, i18n.getFixedT('en')('director.view.unknown'), 'Static', 'Medium close · Static', 'Shot 3 · Static']] as const)(
  '%s',
  (lng, english, unknownWord, staticWord, measured, pipMoveOnly) => {
    afterAll(() => i18n.changeLanguage('zh-CN'))
    it('量不到景别：只留运镜，不出现「未测量」', async () => {
      await i18n.changeLanguage(lng)
      const labels = makeShotLabels(i18n.t.bind(i18n) as never, english)
      expect(labels.headline(shot(null, 'static'))).toBe(staticWord)
      expect(labels.pip(shot(null, 'static'), 2)).toBe(pipMoveOnly)
      expect(labels.headline(shot(null, 'static'))).not.toContain(unknownWord)
    })
    it('量得到景别：照旧「景别 · 运镜」', async () => {
      await i18n.changeLanguage(lng)
      expect(makeShotLabels(i18n.t.bind(i18n) as never, english).headline(shot('中近景', 'static'))).toBe(measured)
    })
  },
)
