import React from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NomiSelectProps } from '../../../design/NomiSelect'
import type { WorkbenchIconButtonProps } from '../../../design/actions'
import { toCatalogModelOptions } from '../../../config/modelOptionMappers'
import InlineParameterBar from './InlineParameterBar'
import type { DynamicModelControl } from './controls/parameterControlModel'

const captured = vi.hoisted(() => ({ selects: [] as NomiSelectProps[], iconButtons: [] as WorkbenchIconButtonProps[] }))
vi.mock('../../../design', () => ({
  NomiSelect: (props: NomiSelectProps) => {
    captured.selects.push(props)
    return React.createElement('span', null, props.options.find(option => option.value === props.value)?.label)
  },
  WorkbenchIconButton: (props: WorkbenchIconButtonProps) => {
    captured.iconButtons.push(props)
    return React.createElement('button', { type: 'button' }, props.label)
  },
  NomiSegmented: () => null,
  DesignSwitch: () => null,
}))

describe('InlineParameterBar catalog variant control', () => {
  beforeEach(() => { captured.selects = []; captured.iconButtons = [] })

  function render(tiers: string[], selected: string) {
    const modelOptions = toCatalogModelOptions(tiers.map(tier => ({
      modelKey: `gemini-3.7-flash-${tier}`, vendorKey: 'antigravity-cli', labelZh: `Gemini 3.7 Flash ${tier}`,
      kind: 'text', enabled: true, published: true, publishedModes: ['chat' as const], createdAt: '', updatedAt: '',
    })))
    const onModelChange = vi.fn()
    const html = renderToStaticMarkup(React.createElement(InlineParameterBar, {
      modelOptions, selectedModelOption: modelOptions.find(option => option.value.endsWith(selected))!,
      modelCatalogStatus: { message: '' }, renderedControls: [], archetype: null, meta: {},
      onModelChange, onCatalogControlChange: vi.fn(), onParameterControlChange: vi.fn(),
    }))
    return { html, onModelChange }
  }

  it('uses the existing model + variant controls and writes the exact selected ID', () => {
    const { html, onModelChange } = render(['low', 'medium', 'high'], 'high')
    expect(captured.selects).toHaveLength(2)
    expect(html).toContain('Gemini 3.7 Flash')
    expect(html).toContain('High')
    const variant = captured.selects[1]
    variant.onChange(variant.options.find(option => option.label === 'Low')!.value)
    expect(onModelChange).toHaveBeenCalledWith('gemini-3.7-flash-low', 'antigravity-cli')
  })

  it('shows a single enabled tier as a fixed value without offering disabled tiers', () => {
    const { html } = render(['high'], 'high')
    expect(captured.selects).toHaveLength(2)
    expect(captured.selects[1].disabled).toBe(true)
    expect(captured.selects[1].options.map(option => option.label)).toEqual(['High'])
    expect(html).toContain('High')
  })
})

// 同一个组件两种参数摆法（`parameterLayout`）：
//   · `summary`（**默认**，画布节点）= 摘要 pill + 全部参数进面板；
//   · `chips`（付费确认卡显式传）= 每个主参数一颗下拉 chip，长尾收进一颗 ⚙。
// 两组测试用同一份档案夹具，差别只在传不传 `parameterLayout`——这正是「一个属性、不是两个组件」的证据。
// chip 判据本身由 primaryParameterChips.test.ts 钉死，不在这里重复一遍。
describe('InlineParameterBar 参数摆法（parameterLayout）', () => {
  const ratio: DynamicModelControl = {
    key: 'aspect_ratio', label: '比例', type: 'select', binding: 'parameter',
    options: [{ value: '1:1', label: '1:1' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }],
    defaultValue: '16:9',
  }
  const duration: DynamicModelControl = {
    key: 'duration', label: '时长', type: 'number', binding: 'parameter', options: [], min: 4, max: 8, defaultValue: 5,
  }
  const generateAudio: DynamicModelControl = {
    key: 'generate_audio', label: '生成音频', type: 'boolean', binding: 'parameter', options: [], defaultValue: true,
  }

  const modelOptions = toCatalogModelOptions([{
    modelKey: 'seedance-2', vendorKey: 'apimart', labelZh: 'Seedance 2',
    kind: 'video', enabled: true, published: true, publishedModes: ['text_to_video' as const], createdAt: '', updatedAt: '',
  }])

  function render(
    renderedControls: DynamicModelControl[],
    meta: Record<string, unknown> = {},
    extra: Partial<React.ComponentProps<typeof InlineParameterBar>> = {},
  ) {
    const onParameterControlChange = vi.fn()
    const html = renderToStaticMarkup(React.createElement(InlineParameterBar, {
      modelOptions, selectedModelOption: modelOptions[0], modelCatalogStatus: { message: '' },
      renderedControls, archetype: null, meta,
      onModelChange: vi.fn(), onCatalogControlChange: vi.fn(), onParameterControlChange,
      ...extra,
    }))
    return { html, onParameterControlChange }
  }
  const renderChips = (
    renderedControls: DynamicModelControl[],
    meta: Record<string, unknown> = {},
  ) => render(renderedControls, meta, { parameterLayout: 'chips' })

  beforeEach(() => { captured.selects = []; captured.iconButtons = [] })

  // ── summary（默认 · 画布节点，用户 2026-09-11 04:30 拍板保持原样）────────────────
  it('默认就是 summary：一颗摘要 pill，一颗参数 chip 都不摆', () => {
    const { html } = render([ratio, duration, generateAudio], { aspect_ratio: '9:16', duration: 5 })
    expect(html).toContain('data-parameter-summary="9:16 · 5 · 生成音频"')
    expect(html).not.toContain('data-parameter-chip')
    expect(html).not.toContain('data-parameter-more')
    // 模型芯片之外一颗 NomiSelect 都不该多出来（参数全在点开的面板里）。
    expect(captured.selects.map(select => select.ariaLabel)).toEqual(['模型'])
  })

  it('summary 的 pill 文案可被 summaryOverride 顶掉（导入工作流那条窄例外还在）', () => {
    const { html } = render([ratio], { aspect_ratio: '9:16' }, { summaryOverride: '工作流参数 · 7 项' })
    expect(html).toContain('data-parameter-summary="工作流参数 · 7 项"')
  })

  it('summary 里没有任何参数时不留一颗点开是空白的 pill', () => {
    const { html } = render([], {})
    expect(html).not.toContain('data-parameter-summary')
  })

  // ── chips（付费确认卡显式传）────────────────────────────────────────────────
  it('chips：主参数各自一颗下拉（一步到位），长尾不占底栏', () => {
    renderChips([ratio, duration, generateAudio], { aspect_ratio: '9:16', duration: 5 })
    // [0] 模型芯片，其后是主参数 chip（比例 → 时长），生成音频不在其中。
    expect(captured.selects.slice(1).map(select => select.ariaLabel)).toEqual(['比例', '时长'])
    expect(captured.selects[1].value).toBe('9:16')
    expect(captured.selects[2].options.map(option => option.label)).toEqual(['4s', '5s', '6s', '7s', '8s'])
  })

  it('chips：chip 选完直接回写 store，不经过任何面板', () => {
    const { onParameterControlChange } = renderChips([ratio], { aspect_ratio: '16:9' })
    captured.selects[1].onChange('1:1')
    expect(onParameterControlChange).toHaveBeenCalledWith(ratio, '1:1')
  })

  it('chips：比例下拉按常用序排（16:9 / 9:16 领头），与面板那组分段同一把尺子', () => {
    renderChips([ratio], {})
    expect(captured.selects[1].options.map(option => option.value)).toEqual(['16:9', '9:16', '1:1'])
  })

  it('chips：⚙ 只在里面真有东西时出现，名字里带条数', () => {
    renderChips([ratio, generateAudio], {})
    expect(captured.iconButtons).toHaveLength(1)
    expect(captured.iconButtons[0].label).toContain('1')
    captured.iconButtons = []
    renderChips([ratio], {})
    expect(captured.iconButtons).toHaveLength(0)
  })

  it('chips：走查锚点跟着 chip 走：key 找得到、当前值读得出（不靠中文 aria-label）', () => {
    const { html } = renderChips([ratio], { aspect_ratio: '9:16' })
    expect(html).toContain('data-parameter-chip="aspect_ratio"')
    expect(html).toContain('data-parameter-chip-value="9:16"')
    // 换个摆法之后 pill 就不该再在了（同一处不许两个家）。
    expect(html).not.toContain('data-parameter-summary')
  })
})

describe('InlineParameterBar semantic option presentation wiring', () => {
  const source = readFileSync(fileURLToPath(new URL('./InlineParameterBar.tsx', import.meta.url)), 'utf8')

  it('passes supplier semantics through the shared option renderer', () => {
    expect(source).toMatch(
      /renderOptions\([\s\S]*?modelSelect\.providerOptions\.map\([\s\S]*?modelSelect\.onProviderPick,[\s\S]*?'provider',[\s\S]*?\)/,
    )
  })

  it('resolves semantic purpose before choosing shapes or a searchable list', () => {
    expect(source).toContain('resolveParameterOptionPurpose(rawOptions, requestedPurpose)')
  })

  // 两种摆法是**同一个组件的一个属性**，不是两份实现：面板与它那批控件渲染函数只能有一处。
  it('两种摆法共用同一块面板（renderParameterPanel 只有一个定义、只被声明一次）', () => {
    expect(source.match(/const renderParameterPanel = /g) ?? []).toHaveLength(1)
    expect(source.match(/const renderPanelGroup = /g) ?? []).toHaveLength(1)
    expect(source).toContain("parameterLayout = 'summary'")
  })
})
