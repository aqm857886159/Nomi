import React from 'react'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ModelOption } from '../../../../config/models'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import type { PlanShotPatch } from '../../../generationCanvas/agent/storyboardPlanEdits'
import ShotComposerBar from './ShotComposerBar'

/**
 * 分镜图片镜存成「改图」、一张参考都没有时，这一行要有能切方式的入口，切到文生图后方式写回方案。
 * 2026-11-15 参数面板 PR 第二次验收补核：修补时拿掉了图片镜的方式入口，存成改图的镜（老数据 / Agent 写的 /
 * 自动引用切过去的）红框「缺输入图参考」却没有地方切回去，页底「生成剩余」一直跳过它。
 *
 * 量法：把设计系统的下拉换成记下属性的替身，从底栏里取「方式」那一颗，按创作者的选法调它的 onChange。
 */
type SelectProps = { ariaLabel?: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }
const selects: SelectProps[] = []

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('../../../../design', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../design')>(),
  NomiSelect: (props: SelectProps) => { selects.push(props); return null },
}))

const GPT_IMAGE = { value: 'gpt-image-2', label: 'GPT Image 2', vendor: 'apimart', modelKey: 'gpt-image-2', kind: 'image' } as ModelOption

const imageShot = (over: Partial<PlanShot> = {}): PlanShot => ({
  index: 1, shotId: 'shot-1', shotKind: 'image', durationSec: 3, anchorIds: [], prompt: '雨夜巷口',
  modelKey: 'gpt-image-2', modelVendor: 'apimart', modeId: 'i2i', ...over,
})

function modeSelectOf(shot: PlanShot, onUpdate: (patch: PlanShotPatch) => void): SelectProps | undefined {
  selects.length = 0
  renderToStaticMarkup(React.createElement(MantineProvider, { env: 'test' }, React.createElement(ShotComposerBar, {
    shot, modelOptions: [GPT_IMAGE], aspect: '16:9', onChangeAspect: () => {}, onUpdate,
  })))
  return selects.find((select) => select.ariaLabel === 'generationCommon.modeMenu.heading')
}

describe('分镜图片镜：存成改图、没有参考 → 这一行切得回文生图', () => {
  it('底栏有方式入口，当前显示改图，选项里有文生图', () => {
    const select = modeSelectOf(imageShot(), () => {})
    expect(select, '图片镜这一行要有方式入口').toBeDefined()
    expect(select!.value).toBe('i2i')
    expect(select!.options.map((option) => option.value)).toEqual(expect.arrayContaining(['t2i', 'i2i']))
  })

  it('选文生图 → 方式写回方案（参数随方式清掉，和视频镜同一条写法）', () => {
    const patches: PlanShotPatch[] = []
    const select = modeSelectOf(imageShot(), (patch) => patches.push(patch))
    select?.onChange('t2i')
    expect(patches).toEqual([{ modeId: 't2i', params: undefined }])
  })
})
