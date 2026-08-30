// 同名 modelKey 跨厂商共存（2026-07-31 群反馈根因）：两个中转站各自提供 gpt-image-2 时，
// 裸 modelKey 去重会把数组靠后那家整条吞掉（store newest-first → 表现为「先接的被最新添加的覆盖」）。
// 去重键必须带 vendor；跨厂商同模型的合并归 dedupeModelOptions（providers[] 多家可用）。
import { describe, expect, it } from 'vitest'
import { toCatalogModelOptions } from './modelOptionMappers'
import { findModelOptionByIdentifier, resolveExecutableImageModelFromOptions } from './modelOptionResolvers'
import type { ModelCatalogModelDto } from '../workbench/api/modelCatalogApi'
import { dedupeModelOptions } from './modelIdentity'

function dto(modelKey: string, vendorKey: string, labelZh = modelKey): ModelCatalogModelDto {
  return {
    modelKey,
    vendorKey,
    labelZh,
    kind: 'image',
    enabled: true,
    published: true,
    publishedModes: ['text_to_image'],
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  }
}

describe('toCatalogModelOptions — 同名 modelKey 跨厂商不互吞', () => {
  it('groups known text variants without dropping their exact catalog identities', () => {
    const ids = [
      ...['3.7', '3.6', '3.5'].flatMap(version => ['low', 'medium', 'high'].map(tier => `gemini-${version}-flash-${tier}`)),
      'gemini-3.1-pro-low', 'gemini-3.1-pro-high', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium',
    ]
    const rows = ids.map(id => ({ ...dto(id, 'antigravity-cli'), kind: 'text' as const }))
    const options = toCatalogModelOptions(rows)
    expect(options.map(option => option.value)).toEqual(ids)
    expect(options.map(option => option.modelKey)).toEqual(ids)
    const grouped = dedupeModelOptions(options)
    expect(grouped).toHaveLength(7)
    expect(grouped[0].label).toBe('Gemini 3.7 Flash')
    expect(grouped[0].providers.map(provider => provider.option.value)).toEqual(ids.slice(0, 3))
  })

  it('keeps unknown CLI IDs independent even if labels coincide with a known family', () => {
    const options = toCatalogModelOptions([
      dto('gemini-3.7-flash-medium', 'antigravity-cli', 'Gemini 3.7 Flash'),
      dto('gemini-3.7-flash-future', 'antigravity-cli', 'Gemini 3.7 Flash'),
      dto('gemini-3.7-flash-next', 'antigravity-cli', 'Gemini 3.7 Flash'),
      dto('gemini-3.7-flash', 'antigravity-cli', 'Gemini 3.7 Flash'),
      dto('gemini-3.7-flash-medium', 'other-vendor', 'Gemini 3.7 Flash'),
    ])
    expect(dedupeModelOptions(options)).toHaveLength(5)
    expect(options.slice(1).every(option => option.variant === undefined)).toBe(true)
  })

  it('两个厂商同名模型都存活，各自带 vendor（newest-first 时先接那家不再被覆盖）', () => {
    const options = toCatalogModelOptions([
      dto('gpt-image-2', 'relay-b'), // 最新接入，数组在前
      dto('gpt-image-2', 'relay-a'), // 先接的那家
    ])
    expect(options).toHaveLength(2)
    expect(options.map((o) => o.vendor)).toEqual(['relay-b', 'relay-a'])
    expect(options.every((o) => o.value === 'gpt-image-2')).toBe(true)
  })

  it('同一厂商内同名模型仍去重（原有语义不变）', () => {
    const options = toCatalogModelOptions([dto('gpt-image-2', 'relay-a'), dto('gpt-image-2', 'relay-a')])
    expect(options).toHaveLength(1)
  })
})

describe('findModelOptionByIdentifier — vendor 二次寻址', () => {
  const options = toCatalogModelOptions([dto('gpt-image-2', 'relay-b'), dto('gpt-image-2', 'relay-a')])

  it('带 vendor 时命中该厂商那条，而不是数组首条', () => {
    expect(findModelOptionByIdentifier(options, 'gpt-image-2', 'relay-a')?.vendor).toBe('relay-a')
  })

  it('不带 vendor 保持旧行为：首条', () => {
    expect(findModelOptionByIdentifier(options, 'gpt-image-2')?.vendor).toBe('relay-b')
  })

  it('vendor 没命中（该家已断开）回退首条，不落空', () => {
    expect(findModelOptionByIdentifier(options, 'gpt-image-2', 'gone-vendor')?.vendor).toBe('relay-b')
  })

  it('resolveExecutableImageModelFromOptions 尊重节点锁定的 vendor', () => {
    const resolved = resolveExecutableImageModelFromOptions(options, {
      kind: 'image',
      value: 'gpt-image-2',
      vendor: 'relay-a',
    })
    expect(resolved.vendor).toBe('relay-a')
  })
})
