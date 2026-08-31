// 同名 modelKey 跨厂商共存（2026-07-31 群反馈根因）：两个中转站各自提供 gpt-image-2 时，
// 裸 modelKey 去重会把数组靠后那家整条吞掉（store newest-first → 表现为「先接的被最新添加的覆盖」）。
// 去重键必须带 vendor；跨厂商同模型的合并归 dedupeModelOptions（providers[] 多家可用）。
import { describe, expect, it } from 'vitest'
import { toCatalogModelOptions } from './modelOptionMappers'
import { findModelOptionByIdentifier, resolveExecutableImageModelFromOptions } from './modelOptionResolvers'
import type { ModelCatalogModelDto } from '../workbench/api/modelCatalogApi'

function dto(modelKey: string, vendorKey: string, labelZh = modelKey): ModelCatalogModelDto {
  return {
    modelKey,
    vendorKey,
    labelZh,
    kind: 'image',
    enabled: true,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  }
}

describe('toCatalogModelOptions — 同名 modelKey 跨厂商不互吞', () => {
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
