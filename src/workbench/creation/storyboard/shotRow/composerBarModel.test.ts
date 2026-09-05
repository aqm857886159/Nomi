import { describe, expect, it } from 'vitest'
import type { ArchetypeMode, ModelArchetype } from '../../../../config/modelArchetypes/types'
import { composerBarLayout, composerBarParams, composerModeOptions } from './composerBarModel'

const control = (over: Partial<ArchetypeMode['params'][number]>): ArchetypeMode['params'][number] => ({
  key: 'resolution',
  label: '清晰度',
  type: 'select',
  options: [{ value: '720p', label: '720p' }],
  ...over,
})
const modeOf = (params: ArchetypeMode['params']): ArchetypeMode => ({
  id: 'm', intent: 'text', vendorTerm: '文生视频', hint: '', slots: [], params, promptRequired: true,
})

describe('shotComposerBar', () => {
  it('固定七列，空画幅列也保留位置', () => {
    expect(composerBarLayout()).toEqual(['model', 'mode', 'aspect', 'duration', 'quality', 'media', 'generate'])
  })
  it('画幅与时长不进底栏参数（各自另有 owner，进来就是第二份真相）', () => {
    const mode = modeOf([
      control({}),
      control({ key: 'aspect_ratio', label: '比例', options: [{ value: '16:9', label: '16:9' }] }),
      control({ key: 'duration', label: '时长', type: 'number', options: [] }),
    ])
    expect(composerBarParams(mode).map((c) => c.key)).toEqual(['resolution'])
  })

  it('无选项的 select 不渲染（点开是空的 = 死控件）；boolean 照出；number/text 不进底栏', () => {
    const mode = modeOf([
      control({ key: 'empty', options: [] }),
      control({ key: 'generate_audio', label: '生成音频', type: 'boolean', options: [] }),
      control({ key: 'seed', label: '种子', type: 'number', options: [] }),
    ])
    expect(composerBarParams(mode).map((c) => c.key)).toEqual(['generate_audio'])
  })

  it('契约未知（无档案 mode）时一枚控件都不出——不假装知道能调什么', () => {
    expect(composerBarParams(null)).toEqual([])
    expect(composerBarParams(undefined)).toEqual([])
  })

  it('只有一种模式的模型不出模式胶囊（一个选项的选择器不是选择，是噪音）', () => {
    const archetypeOf = (modes: ArchetypeMode[]): ModelArchetype => ({
      id: 'a', family: 'f', label: 'A', kind: 'video', sources: [], defaultModeId: modes[0]?.id ?? '',
      identifierPatterns: [], transportTaskKind: 'text_to_video', modes,
    })
    expect(composerModeOptions(archetypeOf([modeOf([])]))).toEqual([])
    expect(composerModeOptions(null)).toEqual([])
    const two = archetypeOf([modeOf([]), { ...modeOf([]), id: 'n2', vendorTerm: '首帧' }])
    expect(composerModeOptions(two)).toEqual([
      { value: 'm', label: '文生视频' },
      { value: 'n2', label: '首帧' },
    ])
  })
})
