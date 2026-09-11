import { describe, expect, it } from 'vitest'
import {
  MAX_CHIP_RANGE_STEPS,
  numericRangeChipOptions,
  overflowParameterControls,
  parameterChipLabel,
  parameterChipOptions,
  parameterChipValue,
  planParameterChips,
  splitPrimaryParameterControls,
} from './primaryParameterChips'
import type { DynamicModelControl } from './controls/parameterControlModel'

// 底栏「哪几个参数自己占一颗 chip」（2026-09-11 02:10 拍板方案 B）。
// 这条规则的全部价值在「换个模型照样说得对」——所以每条都拿**档案里真实存在的控件形状**去验，
// 不是拿一个手搓的理想 control。形状出处写在各常量旁边。

const ratio: DynamicModelControl = {
  key: 'aspect_ratio', label: '比例', type: 'select', binding: 'parameter',
  options: [{ value: '1:1', label: '1:1' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }],
  defaultValue: '16:9',
}
// 档案里 duration 常是 number + 区间、options 为空（electron/shared/videoCapabilities/seedance.ts）。
const duration: DynamicModelControl = {
  key: 'duration', label: '时长', type: 'number', binding: 'parameter',
  options: [], min: 4, max: 15, defaultValue: 5,
}
const resolution: DynamicModelControl = {
  key: 'resolution', label: '清晰度', type: 'select', binding: 'parameter',
  options: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }], defaultValue: '720p',
}
const generateAudio: DynamicModelControl = {
  key: 'generate_audio', label: '生成音频', type: 'boolean', binding: 'parameter', options: [], defaultValue: true,
}
const seed: DynamicModelControl = {
  key: 'seed', label: '种子', type: 'number', binding: 'parameter', options: [],
}
// 目录模型（没有档案）走 binding，不走 key。
const catalogSize: DynamicModelControl = {
  key: 'aspect_ratio', label: '画幅', binding: 'size',
  options: [{ value: '16:9', label: '16:9' }], defaultValue: '16:9',
}
const catalogDuration: DynamicModelControl = {
  key: 'durationSeconds', label: '时长', binding: 'durationSeconds',
  options: [{ value: 5, label: '5s' }, { value: 10, label: '10s' }], defaultValue: 5,
}

const keys = (controls: readonly DynamicModelControl[]): string[] => controls.map((control) => control.key)

describe('splitPrimaryParameterControls — 哪几个参数直接露在底栏上', () => {
  it('比例 / 时长 / 清晰度上底栏，开关与种子退到 ⚙', () => {
    const { primary, rest } = splitPrimaryParameterControls([resolution, ratio, duration, generateAudio, seed])
    expect(keys(primary)).toEqual(['aspect_ratio', 'duration', 'resolution'])
    expect(keys(rest)).toEqual(['generate_audio', 'seed'])
  })

  it('顺序按角色固定，不随档案声明顺序漂（换模型不用重新找比例在哪）', () => {
    const { primary } = splitPrimaryParameterControls([duration, resolution, ratio])
    expect(keys(primary)).toEqual(['aspect_ratio', 'duration', 'resolution'])
  })

  it('档案没声明的角色就没有那颗 chip——不补默认值假装模型支持', () => {
    const { primary } = splitPrimaryParameterControls([ratio, resolution])
    expect(keys(primary)).toEqual(['aspect_ratio', 'resolution'])
  })

  it('目录模型（无档案）按 binding 认角色，与档案模型同一条路', () => {
    const { primary, rest } = splitPrimaryParameterControls([catalogDuration, catalogSize])
    expect(keys(primary)).toEqual(['aspect_ratio', 'durationSeconds'])
    expect(rest).toEqual([])
  })

  it('点开选不出东西的（无候选项、无可用区间）不上 chip：它在 ⚙ 里是输入框/滑杆', () => {
    const openEnded: DynamicModelControl = { ...duration, min: undefined, max: undefined }
    const { primary, rest } = splitPrimaryParameterControls([ratio, openEnded])
    expect(keys(primary)).toEqual(['aspect_ratio'])
    expect(keys(rest)).toEqual(['duration'])
  })

  it('导入的 ComfyUI 工作流（采样步数 / 帧率这类）一颗 chip 都不出，全在 ⚙ 里', () => {
    const steps: DynamicModelControl = { key: 'steps', label: '采样步数', type: 'number', binding: 'parameter', options: [], min: 1, max: 50 }
    const fps: DynamicModelControl = { key: 'frame_rate', label: '帧率', type: 'select', binding: 'parameter', options: [{ value: 24, label: '24' }] }
    const { primary, rest } = splitPrimaryParameterControls([steps, fps])
    expect(primary).toEqual([])
    expect(keys(rest)).toEqual(['steps', 'frame_rate'])
  })
})

describe('numericRangeChipOptions — 区间型时长切成下拉档位', () => {
  it('4–15 秒切成 12 档（Seedance 2 的真实声明）', () => {
    const options = numericRangeChipOptions(duration)
    expect(options.map((option) => option.value)).toEqual(['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'])
  })

  it('切不出两档以上的区间不切（0–1 未声明步长），交给 ⚙ 里的输入框', () => {
    expect(numericRangeChipOptions({ key: 'duration', label: '时长', type: 'number', binding: 'parameter', options: [], min: 0, max: 1 })).toEqual([])
  })

  it('档数超过一个下拉能扫完的量就不切（连续量不该用下拉选）', () => {
    const long = { ...duration, min: 1, max: 1 + MAX_CHIP_RANGE_STEPS }
    expect(numericRangeChipOptions(long)).toEqual([])
  })

  it('小数步长不渲出浮点毛刺（0.30000000000000004）', () => {
    const strength: DynamicModelControl = { key: 'duration', label: '时长', type: 'number', binding: 'parameter', options: [], min: 0.1, max: 0.5, step: 0.1 }
    expect(numericRangeChipOptions(strength).map((option) => option.value)).toEqual(['0.1', '0.2', '0.3', '0.4', '0.5'])
  })
})

describe('chip 上的值与文案', () => {
  it('值从 meta derive；meta 没有就落到档案默认值（与面板同一条链）', () => {
    expect(parameterChipValue(ratio, { aspect_ratio: '9:16' })).toBe('9:16')
    expect(parameterChipValue(ratio, {})).toBe('16:9')
    expect(parameterChipValue(catalogDuration, {})).toBe('5')
  })

  it('时长补单位；档案标签已经带单位就不补第二次（否则渲出「5ss」）', () => {
    const seconds = (value: string): string => `${value}s`
    expect(parameterChipLabel(duration, '5', seconds)).toBe('5s')
    expect(parameterChipLabel(catalogDuration, '5s', seconds)).toBe('5s')
    expect(parameterChipLabel(ratio, '16:9', seconds)).toBe('16:9')
  })

  it('候选项优先用档案声明的枚举', () => {
    expect(parameterChipOptions(resolution)).toEqual([{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }])
  })
})

describe('planParameterChips / overflowParameterControls — 装不下时退回 ⚙', () => {
  const { primary } = splitPrimaryParameterControls([ratio, duration, resolution, generateAudio])

  it('从尾巴退，不重排、不跳着退', () => {
    expect(keys(planParameterChips(primary, 2).chips)).toEqual(['aspect_ratio', 'duration'])
    expect(keys(planParameterChips(primary, 2).demoted)).toEqual(['resolution'])
    expect(keys(planParameterChips(primary, 1).chips)).toEqual(['aspect_ratio'])
  })

  it('一颗都装不下 → 全退，底栏不换行', () => {
    expect(planParameterChips(primary, 0).chips).toEqual([])
    expect(keys(planParameterChips(primary, 0).demoted)).toEqual(['aspect_ratio', 'duration', 'resolution'])
  })

  it('装得下就全摆（要几颗给几颗，不留位）', () => {
    expect(keys(planParameterChips(primary, 99).chips)).toEqual(['aspect_ratio', 'duration', 'resolution'])
  })

  it('退回来的参数回到它在档案里的原位，不因为刚从底栏退下来就排到末尾', () => {
    const declared = [resolution, ratio, duration, generateAudio]
    const { chips } = planParameterChips(splitPrimaryParameterControls(declared).primary, 2)
    expect(keys(overflowParameterControls(declared, chips))).toEqual(['resolution', 'generate_audio'])
  })

  it('摆在底栏上的参数不会在 ⚙ 里再出现一次（同一个值只有一个家）', () => {
    const declared = [ratio, duration, resolution, generateAudio]
    const { chips } = planParameterChips(splitPrimaryParameterControls(declared).primary, 3)
    expect(keys(overflowParameterControls(declared, chips))).toEqual(['generate_audio'])
  })
})
