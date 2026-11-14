import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../../config/models'
import { parameterPlacement } from '../../../generationCanvas/nodes/controls/parameterControlModel'
import { composerEntryIndex, storyboardComposerChange, storyboardComposerControls, storyboardComposerMeta } from './storyboardComposerModel'

/**
 * 分镜行复用画布底栏的数据适配层：显示值走落画布同一个构造器，改一个控件写回分镜的那一处。
 * 用真档案（seedance-2-5 / gpt-image-2），参数集合由档案 derive。
 */
const SEEDANCE = { value: 'seedance-2-5', label: 'Seedance 2.5', vendor: 'kie', modelKey: 'seedance-2-5' } as ModelOption
const GPT_IMAGE = { value: 'gpt-image-2', label: 'GPT Image 2', vendor: 'apimart', modelKey: 'gpt-image-2' } as ModelOption

describe('storyboardComposerMeta：面板显示 = 落画布的 meta', () => {
  it('镜头的模式 / 生效画幅 / 已写参数都进 meta，没写的取档案默认', () => {
    const meta = storyboardComposerMeta({ modelKey: 'seedance-2-5', modelVendor: 'kie', modeId: 'omni', params: { aspect_ratio: '9:16', resolution: '480p' } }, composerEntryIndex(SEEDANCE))
    expect((meta.archetype as { modeId: string }).modeId).toBe('omni')
    expect(meta.aspect_ratio).toBe('9:16')
    expect(meta.resolution).toBe('480p')
    expect(meta.modelVendor).toBe('kie')
  })

  it('没选模型 → 空：不知道是哪个模型就不假装知道它有什么参数', () => {
    expect(storyboardComposerMeta({}, composerEntryIndex(null))).toEqual({})
    expect(storyboardComposerControls(null, {}, 'video')).toEqual([])
  })

  it('参考卡（图片模型）按档案拿到比例与清晰度（反馈 #3 #11：参考卡也要按模型给全参数）', () => {
    const meta = storyboardComposerMeta({ modelKey: 'gpt-image-2', modelVendor: 'apimart', params: { aspect_ratio: '3:4' } }, composerEntryIndex(GPT_IMAGE))
    const keys = storyboardComposerControls(GPT_IMAGE, meta, 'image').map((control) => control.key)
    expect(keys).toEqual(expect.arrayContaining(['aspect_ratio', 'resolution']))
    expect(meta.aspect_ratio).toBe('3:4')
  })

  it('只靠目录元数据（archetypeId）认档案的模型：用目录项建索引，meta 照样有模型与档案（不现拼）', () => {
    const relay = { value: 'relay-image', label: 'Relay Image', vendor: 'my-relay', modelKey: 'relay-image', kind: 'image', meta: { archetypeId: 'agnes-image' } } as ModelOption
    const meta = storyboardComposerMeta({ modelKey: 'relay-image', modelVendor: 'my-relay' }, composerEntryIndex(relay))
    expect(meta.modelKey).toBe('relay-image')
    expect((meta.archetype as { id: string }).id).toBe('agnes-image')
  })
})

describe('storyboardComposerChange：控件 → 分镜字段', () => {
  const meta = storyboardComposerMeta({ modelKey: 'seedance-2-5', modelVendor: 'kie', modeId: 't2v' }, composerEntryIndex(SEEDANCE))
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

/**
 * 2026-11-14 三处一套：分镜行底栏换成画布同一只组件、五类参数搬进「高级设置」之后，
 * **存的字段和发出去的字段一项不变**——搬的只是「在哪儿改」，不是「存什么、发什么」。
 * 发出去的 = 落画布同一个构造器（`buildPlannedNodeMeta`，projectShotNode 也用它）算出的 meta，所以冻结 meta 就是冻结请求字段。
 * 用真档案 doubao-seedance-2.5（apimart）：它一个模式里五类里占四类 + 返回尾帧，是高级项最多的一档。
 */
describe('分镜行搬进高级设置后：存的、发的字段改前改后一样', () => {
  const SEEDANCE_APIMART = { value: 'doubao-seedance-2.5', label: 'Seedance 2.5', vendor: 'apimart', modelKey: 'doubao-seedance-2.5' } as ModelOption
  const target = { modelKey: 'doubao-seedance-2.5', modelVendor: 'apimart', modeId: 't2v', params: { seed: 7, watermark: true } } as const
  const meta = storyboardComposerMeta(target, composerEntryIndex(SEEDANCE_APIMART))
  const controls = storyboardComposerControls(SEEDANCE_APIMART, meta, 'video')

  it('发出去的字段（meta）逐项冻结：老镜头存的种子 / 水印照发，没写的取档案默认，不多不少', () => {
    const { archetype: _archetype, ...fields } = meta
    expect(fields).toEqual({
      modelKey: 'doubao-seedance-2.5', modelLabel: 'Seedance 2.5', modelVendor: 'apimart', vendor: 'apimart',
      size: 'adaptive', resolution: '720p', duration: 5, generate_audio: true,
      return_last_frame: false, watermark: true, output_format: 'mp4', nsfw_check: false, seed: 7,
    })
  })

  it('每个控件不在面板就在高级设置，一个都不丢；高级里那几项改了照样写回 params', () => {
    const panel = controls.filter((control) => parameterPlacement(control) === 'panel').map((control) => control.key)
    const advanced = controls.filter((control) => parameterPlacement(control) === 'advanced').map((control) => control.key)
    expect(panel).toEqual(['size', 'resolution', 'duration', 'generate_audio'])
    expect(advanced).toEqual(['return_last_frame', 'seed', 'watermark', 'output_format', 'nsfw_check'])
    const control = (key: string) => controls.find((candidate) => candidate.key === key)! as Parameters<typeof storyboardComposerChange>[0]
    expect(storyboardComposerChange(control('seed'), '42', controls)).toEqual({ kind: 'param', key: 'seed', value: 42 })
    expect(storyboardComposerChange(control('watermark'), 'false', controls)).toEqual({ kind: 'param', key: 'watermark', value: false })
    expect(storyboardComposerChange(control('output_format'), 'mov', controls)).toEqual({ kind: 'param', key: 'output_format', value: 'mov' })
    expect(storyboardComposerChange(control('return_last_frame'), 'true', controls)).toEqual({ kind: 'param', key: 'return_last_frame', value: true })
  })
})
