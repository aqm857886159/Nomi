import { describe, expect, it } from 'vitest'
import type { ArchetypeMode, ModelArchetype } from '../../../../config/modelArchetypes/types'
import { composerBarParams, composerBarPlan, composerModeOptions } from './composerBarModel'
import { resolveArchetypeForModel } from '../../../generationCanvas/nodes/controls/archetypeMeta'
import { resolveRenderedControls } from '../../../generationCanvas/nodes/nodeModelArchetype'
import { isParameterControl } from '../../../generationCanvas/nodes/controls/parameterControlModel'
import type { ModelOption } from '../../../../config/models'

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
  it('select 摆在行上、boolean 收进行尾 ⋯（2026-09-06 用户：一行、再简洁些）', () => {
    const mode = modeOf([
      control({}),
      control({ key: 'generate_audio', label: '生成音频', type: 'boolean', options: [] }),
      control({ key: 'return_last_frame', label: '返回尾帧', type: 'boolean', options: [] }),
    ])
    const plan = composerBarPlan(mode)
    expect(plan.inline.map((c) => c.key)).toEqual(['resolution'])
    expect(plan.overflow.map((c) => c.key)).toEqual(['generate_audio', 'return_last_frame'])
    // 两边加起来 = 全集：收起不等于丢掉。
    expect([...plan.inline, ...plan.overflow].map((c) => c.key).sort())
      .toEqual(composerBarParams(mode).map((c) => c.key).sort())
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

  /**
   * P4 通用第一：分镜行的参数集合与**画布图片/视频节点**是同一份档案投影，只是分镜行另外把
   * 画幅与时长交给了各自的 owner（`storyboardAspectScope` / `PlanShot.durationSec`）。
   * 这条断言就是"别另造一套"的机器判据——档案改了两边同时跟着改，谁都别写第二张映射表。
   */
  it('与画布节点 composer 同一集合（差集只有画幅与时长两个另有 owner 的键）', () => {
    const modelKey = 'bytedance/seedance-2-5'
    const option: ModelOption = {
      value: 'seedance-2-5', label: 'Seedance 2.5', vendor: 'kie', vendorName: 'kie', modelKey,
    }
    const archetype = resolveArchetypeForModel({ modelKey, vendorKey: option.vendor })
    const mode = archetype?.modes.find((candidate) => candidate.id === 'first')
    expect(mode).toBeTruthy()

    // 画布那一侧：同一个 mode 的渲染控件（只看能在底栏摆的那两类，键盘输入类两边都不摆）。
    const canvasKeys = resolveRenderedControls(option, { archetypeModeId: 'first' }, false, true)
      .filter(isParameterControl)
      .filter((canvasControl) => canvasControl.type === 'select' || canvasControl.type === 'boolean')
      .map((canvasControl) => canvasControl.key)
    const rowKeys = composerBarParams(mode).map((rowControl) => rowControl.key)

    expect(canvasKeys.length).toBeGreaterThan(0)
    expect(rowKeys).toEqual(canvasKeys.filter((key) => key !== 'aspect_ratio' && key !== 'duration'))
    expect(canvasKeys.filter((key) => !rowKeys.includes(key))).toEqual(['aspect_ratio'])
  })
})
