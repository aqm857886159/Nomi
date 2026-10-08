// 分镜面「选 APIMart、实际发给自定义供应商」——三个入口各一条复现（2026-09-21 群反馈延伸）。
//
// 场景：用户自定义了一个 modelKey 也叫 gpt-image-2 的中转模型，与 APIMart 的 gpt-image-2 同名。
// 画布节点模型框在 v0.21.0 已修（按 (value, vendor) 选），但分镜的三处模型框各自只写/只读 modelKey：
//   ① 镜头卡底栏（ShotComposerBar → 画布同款 InlineParameterBar，2026-10-06 起）：调去重 hook 不传 vendor、回写只写 modelKey → 旧 modelVendor 残留；
//   ② 批量条（StoryboardBulkBar）：把 BulkModelPicker 回调的 vendor 丢了；
//   ③ 锚行（StoryboardAnchorRow，同样改用画布同款底栏）：原生下拉 option value 是裸 modelKey，两家同值、只写 modelKey。
// 两处的模型下拉现在是同一个组件（InlineParameterBar 的模型按钮），按它的无障碍名找。
// 这里只用真实组件 + 被记录的 NomiSelect（不 mock 选择逻辑本身），断言「写进 plan 的供应商」。
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelOption } from '../../../config/models'
import type { PlanAnchor, PlanShot, StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'

type RecordedSelect = {
  ariaLabel?: string
  value?: string
  options: Array<{ value: string; label: string; chips?: Array<{ value: string; label: string }> }>
  onChange: (value: string) => void
  onChipChange?: (rowValue: string, chipValue: string) => void
}
const recorded: RecordedSelect[] = []

vi.mock('../../../design', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    NomiSelect: (props: RecordedSelect) => {
      recorded.push(props)
      return null
    },
  }
})

const { default: ShotComposerBar } = await import('./shotRow/ShotComposerBar')
const { default: StoryboardBulkBar } = await import('./StoryboardBulkBar')
const { default: StoryboardAnchorRow } = await import('./anchorZone/StoryboardAnchorRow')
const i18n = (await import('../../../i18n')).default

const CUSTOM = 'my-relay-example-com'
const customGptImage2 = {
  value: 'gpt-image-2', label: 'image2', modelKey: 'gpt-image-2', vendor: CUSTOM, vendorName: 'My Relay', kind: 'image',
} as ModelOption
const apimartGptImage2 = {
  value: 'gpt-image-2', label: 'GPT Image 2', modelKey: 'gpt-image-2', vendor: 'apimart', kind: 'image',
  meta: { canonicalModelId: 'gpt image 2' },
} as ModelOption
// 自定义排在前面 = catalog newest-first 的真实顺序（用户刚加的自定义模型最新）。
const OPTIONS: ModelOption[] = [customGptImage2, apimartGptImage2]

function imageShot(over: Partial<PlanShot> = {}): PlanShot {
  return { index: 1, shotKind: 'image', durationSec: 3, anchorIds: [], prompt: 'a cat', ...over }
}

function findSelect(aria: string): RecordedSelect {
  const hit = recorded.find((props) => props.ariaLabel === aria)
  if (!hit) throw new Error(`no NomiSelect with ariaLabel ${aria}; saw ${recorded.map((props) => props.ariaLabel).join(', ')}`)
  return hit
}

beforeEach(() => {
  recorded.length = 0
})

describe('① 镜头卡底栏：选 APIMart 那条 → 镜头的 (modelKey, modelVendor) 成对落 APIMart', () => {
  function renderBar(shot: PlanShot) {
    const onUpdate = vi.fn()
    renderToStaticMarkup(createElement(ShotComposerBar, {
      shot, modelOptions: OPTIONS, aspect: '16:9', onChangeAspect: () => {}, onUpdate,
    }))
    return { onUpdate, select: findSelect(i18n.t('generationCommon.parameters.model')) }
  }

  it('当前在自定义那家，点 APIMart 那一行：写进去的供应商是 apimart（不是残留的自定义）', () => {
    const { onUpdate, select } = renderBar(imageShot({ modelKey: 'gpt-image-2', modelVendor: CUSTOM }))
    const apimartRow = select.options.find((option) => option.label === 'GPT Image 2')!
    select.onChange(apimartRow.value)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0]![0]).toMatchObject({ modelKey: 'gpt-image-2', modelVendor: 'apimart' })
  })

  it('镜头存的是 (gpt-image-2, apimart)：下拉回显 APIMart 那一组，不被同名自定义组抢走', () => {
    const { select } = renderBar(imageShot({ modelKey: 'gpt-image-2', modelVendor: 'apimart' }))
    const apimartRow = select.options.find((option) => option.label === 'GPT Image 2')!
    expect(select.value).toBe(apimartRow.value)
  })

  it('选回「默认模型」：modelKey 与 modelVendor 一起清空（不留一个孤儿供应商）', () => {
    const { onUpdate, select } = renderBar(imageShot({ modelKey: 'gpt-image-2', modelVendor: 'apimart' }))
    select.onChange('')
    expect(onUpdate.mock.calls[0]![0]).toHaveProperty('modelVendor', undefined)
    expect(onUpdate.mock.calls[0]![0]).toHaveProperty('modelKey', undefined)
  })
})

describe('② 批量条「统一模型」：选 APIMart 那一行 → 每一镜都写 apimart', () => {
  it('批量条的模型按钮（与行底栏同一个 InlineParameterBar）回调的 vendor 一路写进每一镜', () => {
    const onChange = vi.fn()
    const plan: StoryboardPlan = {
      title: 't', anchors: [],
      shots: [imageShot({ index: 1, modelKey: 'gpt-image-2', modelVendor: CUSTOM }), imageShot({ index: 2 })],
    }
    renderToStaticMarkup(createElement(StoryboardBulkBar, { plan, imageModelOptions: OPTIONS, videoModelOptions: [], onChange }))
    const select = findSelect(i18n.t('generationCommon.parameters.model'))
    const apimartRow = select.options.find((option) => option.label === 'GPT Image 2')!
    select.onChange(apimartRow.value)
    const next = onChange.mock.calls[0]![0] as StoryboardPlan
    expect(next.shots.map((shot) => [shot.modelKey, shot.modelVendor])).toEqual([
      ['gpt-image-2', 'apimart'],
      ['gpt-image-2', 'apimart'],
    ])
  })
})

describe('③ 锚行模型框：两家同名模型是两个可区分的选项，选 APIMart 写 apimart', () => {
  function renderAnchor(anchor: PlanAnchor) {
    const onUpdate = vi.fn()
    renderToStaticMarkup(createElement(StoryboardAnchorRow, {
      runtime: {
        anchor, node: null, visual: true, resultUrl: null, generating: false, failed: false, recoverable: false,
        errorMessage: null, progressPercent: null, locked: false, referencedByCount: 0,
      },
      aspect: '16:9', modelOptions: OPTIONS, onUpdate,
      onChangeKind: () => {}, onRemove: () => {}, onGenerate: () => {}, onRegenerate: () => {}, onToggleLock: () => {},
    }))
    return { onUpdate, select: findSelect(i18n.t('generationCommon.parameters.model')) }
  }
  const anchor = (over: Partial<PlanAnchor> = {}): PlanAnchor => ({
    id: 'a1', kind: 'character', name: 'Hero', description: '', carrier: 'visual', scope: 'all', ...over,
  })

  it('同名两家不撞值：下拉里 APIMart 与自定义是两个不同的 value', () => {
    const { select } = renderAnchor(anchor())
    const values = select.options.filter((option) => option.value !== '').map((option) => option.value)
    expect(new Set(values).size).toBe(values.length)
    expect(values.length).toBe(2)
  })

  it('当前在自定义那家，点 APIMart 那一行：写进去的是 (gpt-image-2, apimart)', () => {
    const { onUpdate, select } = renderAnchor(anchor({ modelKey: 'gpt-image-2', modelVendor: CUSTOM }))
    const apimartRow = select.options.find((option) => option.label === 'GPT Image 2')!
    select.onChange(apimartRow.value)
    expect(onUpdate.mock.calls[0]![0]).toMatchObject({ modelKey: 'gpt-image-2', modelVendor: 'apimart' })
  })

  it('锚存的是 (gpt-image-2, apimart)：回显 APIMart 那一行', () => {
    const { select } = renderAnchor(anchor({ modelKey: 'gpt-image-2', modelVendor: 'apimart' }))
    const apimartRow = select.options.find((option) => option.label === 'GPT Image 2')!
    expect(select.value).toBe(apimartRow.value)
  })
})
