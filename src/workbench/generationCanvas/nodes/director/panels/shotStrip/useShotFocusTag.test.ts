/** 「正在改：镜头 N」标签的措辞（画布七态里的文字部分），中英两轨。 */
import { afterAll, describe, expect, it } from 'vitest'
import i18n from '../../../../../../i18n'
import type { DirectorShotFocus } from '../../model/directorShotFocus'
import { makeShotLabels } from './shotLabels'
import { shotFocusTagText } from './useShotFocusTag'

const measured = { start: 4.3, end: 8.3, cameraId: 'shot:two/camera', shotSize: '中近景' as const, move: 'static', actions: [] }
const focus = (indices: number[], withMeasure = true): DirectorShotFocus => ({ directorNodeId: 'n', revision: 'r', shots: indices.map((index) => ({ shotId: `s${index}`, index, measured: withMeasure && indices.length === 1 ? measured : null })) })

describe.each([
  ['zh-CN', false, ['正在改：镜头 2', '· 中近景 · 固定', '正在改：镜头 1、3', '正在改：4 个镜头', '不针对这一镜', '发送时会告诉 Agent 你说的是这一镜']],
  ['en', true, ['Editing: Shot 2', '· Medium close · Static', 'Editing: Shots 1, 3', 'Editing: 4 shots', 'Stop targeting this shot', 'Your next message will be about this shot']],
] as const)('%s', (lng, english, [one, detail, two, many, clear, hint]) => {
  afterAll(() => i18n.changeLanguage('zh-CN'))
  it('没选中不出现；一镜带实测；两到三镜列编号；超过三镜写个数', async () => {
    await i18n.changeLanguage(lng)
    const t = i18n.t.bind(i18n) as never
    const headline = makeShotLabels(t, english).headline
    expect(shotFocusTagText(null, t, headline)).toBeNull()
    expect(shotFocusTagText(focus([2]), t, headline)).toEqual({ label: one, detail, hint, clearLabel: clear })
    expect(shotFocusTagText(focus([2], false), t, headline)?.detail).toBeUndefined()
    expect(shotFocusTagText(focus([1, 3]), t, headline)?.label).toBe(two)
    expect(shotFocusTagText(focus([1, 2, 3, 4]), t, headline)?.label).toBe(many)
  })
})
