import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../../config/models'
import { storyboardComposerChange, storyboardComposerControls, storyboardComposerMeta } from './storyboardComposerModel'

/**
 * 分镜行复用画布底栏的数据适配层：显示值走落画布同一个构造器，改一个控件写回分镜的那一处。
 * 用真档案（seedance-2-5 / gpt-image-2），参数集合由档案 derive。
 */
const SEEDANCE = { value: 'seedance-2-5', label: 'Seedance 2.5', vendor: 'kie', modelKey: 'seedance-2-5' } as ModelOption
const GPT_IMAGE = { value: 'gpt-image-2', label: 'GPT Image 2', vendor: 'apimart', modelKey: 'gpt-image-2' } as ModelOption

describe('storyboardComposerMeta：面板显示 = 落画布的 meta', () => {
  it('镜头的模式 / 生效画幅 / 已写参数都进 meta，没写的取档案默认', () => {
    const meta = storyboardComposerMeta({ modelKey: 'seedance-2-5', modelVendor: 'kie', modeId: 'omni', params: { aspect_ratio: '9:16', resolution: '480p' } }, 'video')
    expect((meta.archetype as { modeId: string }).modeId).toBe('omni')
    expect(meta.aspect_ratio).toBe('9:16')
    expect(meta.resolution).toBe('480p')
    expect(meta.modelVendor).toBe('kie')
  })

  it('没选模型 → 空：不知道是哪个模型就不假装知道它有什么参数', () => {
    expect(storyboardComposerMeta({}, 'video')).toEqual({})
    expect(storyboardComposerControls(null, {}, 'video')).toEqual([])
  })

  it('参考卡（图片模型）按档案拿到比例与清晰度（反馈 #3 #11：参考卡也要按模型给全参数）', () => {
    const meta = storyboardComposerMeta({ modelKey: 'gpt-image-2', modelVendor: 'apimart', params: { aspect_ratio: '3:4' } }, 'image')
    const keys = storyboardComposerControls(GPT_IMAGE, meta, 'image').map((control) => control.key)
    expect(keys).toEqual(expect.arrayContaining(['aspect_ratio', 'resolution']))
    expect(meta.aspect_ratio).toBe('3:4')
  })
})

describe('storyboardComposerChange：控件 → 分镜字段', () => {
  const meta = storyboardComposerMeta({ modelKey: 'seedance-2-5', modelVendor: 'kie', modeId: 't2v' }, 'video')
  const controls = storyboardComposerControls(SEEDANCE, meta, 'video')
  const control = (key: string) => controls.find((candidate) => candidate.key === key)! as Parameters<typeof storyboardComposerChange>[0]

  it('比例控件 → 画幅（行级覆盖 / 锚的语义槽），不进 params', () => {
    expect(storyboardComposerChange(control('aspect_ratio'), '9:16', controls)).toEqual({ kind: 'aspect', value: '9:16' })
  })

  it('时长 → durationSec（合计时长与时间轴都读它），按声明的数值类型', () => {
    expect(storyboardComposerChange(control('duration'), '8', controls)).toEqual({ kind: 'duration', value: 8 })
  })

  it('其余参数 → params，按声明类型（开关是布尔）', () => {
    expect(storyboardComposerChange(control('resolution'), '480p', controls)).toEqual({ kind: 'param', key: 'resolution', value: '480p' })
    expect(storyboardComposerChange(control('generate_audio'), 'false', controls)).toEqual({ kind: 'param', key: 'generate_audio', value: false })
  })
})
