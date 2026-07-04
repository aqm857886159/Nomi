import { describe, it, expect } from 'vitest'
import { filterModelsByQuery, enabledCount, bulkToggleTargets } from './modelEnableEditing'
import type { ChipModel } from './ModelChipGroups'

const m = (modelKey: string, labelZh: string, enabled: boolean, kind: ChipModel['kind'] = 'text'): ChipModel =>
  ({ modelKey, vendorKey: 'relay', labelZh, kind, enabled })

const MODELS: ChipModel[] = [
  m('flux-1.1-pro', 'Flux 1.1 Pro', true, 'image'),
  m('sdxl-turbo', 'SDXL Turbo', false, 'image'),
  m('deepseek-v3', 'DeepSeek V3', true),
  m('gpt-4o', 'GPT-4o', false),
]

describe('filterModelsByQuery', () => {
  it('空串返回全部；命中 modelKey 或 labelZh（大小写无关）', () => {
    expect(filterModelsByQuery(MODELS, '')).toHaveLength(4)
    expect(filterModelsByQuery(MODELS, '  ')).toHaveLength(4)
    expect(filterModelsByQuery(MODELS, 'flux').map((x) => x.modelKey)).toEqual(['flux-1.1-pro'])
    expect(filterModelsByQuery(MODELS, 'DEEPSEEK').map((x) => x.modelKey)).toEqual(['deepseek-v3'])
    expect(filterModelsByQuery(MODELS, 'gpt-4O').map((x) => x.modelKey)).toEqual(['gpt-4o'])
  })
  it('无匹配返回空', () => {
    expect(filterModelsByQuery(MODELS, 'zzz')).toEqual([])
  })
})

describe('enabledCount', () => {
  it('数已启用', () => {
    expect(enabledCount(MODELS)).toBe(2)
    expect(enabledCount([])).toBe(0)
  })
})

describe('bulkToggleTargets', () => {
  it('全选只翻当前未启用的（已启用不重复写库）', () => {
    expect(bulkToggleTargets(MODELS, true).map((x) => x.modelKey)).toEqual(['sdxl-turbo', 'gpt-4o'])
  })
  it('全不选只翻当前已启用的', () => {
    expect(bulkToggleTargets(MODELS, false).map((x) => x.modelKey)).toEqual(['flux-1.1-pro', 'deepseek-v3'])
  })
  it('作用于「当前可见」子集——批量只影响传入(搜索过滤后)的那几个', () => {
    const onlyImages = MODELS.filter((x) => x.kind === 'image')
    expect(bulkToggleTargets(onlyImages, true).map((x) => x.modelKey)).toEqual(['sdxl-turbo'])
    expect(bulkToggleTargets([], true)).toEqual([])
  })
})
