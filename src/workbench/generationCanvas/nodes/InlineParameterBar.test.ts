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

// 底栏 B 方案（2026-09-11 02:10 拍板）：每个主参数一颗下拉 chip，长尾收进一颗 ⚙。
// 这里验的是**接线**——判据本身由 primaryParameterChips.test.ts 钉死，不在这里重复一遍。
describe('InlineParameterBar 主参数 chip 接线', () => {
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

  function render(renderedControls: DynamicModelControl[], meta: Record<string, unknown> = {}) {
    const onParameterControlChange = vi.fn()
    const html = renderToStaticMarkup(React.createElement(InlineParameterBar, {
      modelOptions, selectedModelOption: modelOptions[0], modelCatalogStatus: { message: '' },
      renderedControls, archetype: null, meta,
      onModelChange: vi.fn(), onCatalogControlChange: vi.fn(), onParameterControlChange,
    }))
    return { html, onParameterControlChange }
  }

  beforeEach(() => { captured.selects = []; captured.iconButtons = [] })

  it('主参数各自一颗下拉（一步到位），长尾不占底栏', () => {
    render([ratio, duration, generateAudio], { aspect_ratio: '9:16', duration: 5 })
    // [0] 模型芯片，其后是主参数 chip（比例 → 时长），生成音频不在其中。
    expect(captured.selects.slice(1).map(select => select.ariaLabel)).toEqual(['比例', '时长'])
    expect(captured.selects[1].value).toBe('9:16')
    expect(captured.selects[2].options.map(option => option.label)).toEqual(['4s', '5s', '6s', '7s', '8s'])
  })

  it('chip 选完直接回写 store，不经过任何面板', () => {
    const { onParameterControlChange } = render([ratio], { aspect_ratio: '16:9' })
    captured.selects[1].onChange('1:1')
    expect(onParameterControlChange).toHaveBeenCalledWith(ratio, '1:1')
  })

  it('比例下拉按常用序排（16:9 / 9:16 领头），与面板那组分段同一把尺子', () => {
    render([ratio], {})
    expect(captured.selects[1].options.map(option => option.value)).toEqual(['16:9', '9:16', '1:1'])
  })

  it('⚙ 只在里面真有东西时出现，名字里带条数', () => {
    render([ratio, generateAudio], {})
    expect(captured.iconButtons).toHaveLength(1)
    expect(captured.iconButtons[0].label).toContain('1')
    captured.iconButtons = []
    render([ratio], {})
    expect(captured.iconButtons).toHaveLength(0)
  })

  it('走查锚点跟着 chip 走：key 找得到、当前值读得出（不靠中文 aria-label）', () => {
    const { html } = render([ratio], { aspect_ratio: '9:16' })
    expect(html).toContain('data-parameter-chip="aspect_ratio"')
    expect(html).toContain('data-parameter-chip-value="9:16"')
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

  it('摘要 pill 那条路整条删掉了（没有并行版）', () => {
    expect(source).not.toContain('summaryOverride')
    expect(source).not.toContain('data-parameter-summary')
  })
})
