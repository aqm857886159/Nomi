import React from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NomiSelectProps } from '../../../design/NomiSelect'
import { toCatalogModelOptions } from '../../../config/modelOptionMappers'
import InlineParameterBar from './InlineParameterBar'

const captured = vi.hoisted(() => ({ selects: [] as NomiSelectProps[] }))
vi.mock('../../../design', () => ({
  NomiSelect: (props: NomiSelectProps) => {
    captured.selects.push(props)
    return React.createElement('span', null, props.options.find(option => option.value === props.value)?.label)
  },
}))

describe('InlineParameterBar catalog variant control', () => {
  beforeEach(() => { captured.selects = [] })

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
})
