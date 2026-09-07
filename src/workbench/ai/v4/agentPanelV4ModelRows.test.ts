// 模型弹层的行数据：同名模型折成一行，留偏好序最靠前的那一家。
//
// 2026-09-06 打包版实测：弹层里是 17 行、每行标签都写「对话」、一个下拉都没有。
// 这份测试钉的是「17 行为什么该收成一行一类」的那一半——供应商去重。
import { describe, expect, it } from 'vitest'
import type { ModelCatalogModelDto } from '../../api/modelCatalogApi'
import { chatModelChoices, dedupeByModelKey } from './agentPanelV4ModelRows'

const model = (vendorKey: string, modelKey: string, labelZh = modelKey): ModelCatalogModelDto =>
  ({
    vendorKey,
    modelKey,
    labelZh,
    kind: 'text',
    enabled: true,
    published: true,
    publishedModes: [],
    createdAt: '2026-09-06',
    updatedAt: '2026-09-06',
  }) as unknown as ModelCatalogModelDto

describe('供应商去重：同一个模型经三家中转接进来，对用户仍然是一个模型', () => {
  it('折成一行，留下用户排在最前的那一家', () => {
    const rows = dedupeByModelKey(
      [model('kie', 'deepseek-v4-pro'), model('apimart', 'deepseek-v4-pro'), model('api-deepseek-com', 'deepseek-v4-pro')],
      ['api-deepseek-com', 'apimart', 'kie'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.vendorKey).toBe('api-deepseek-com')
  })

  it('没排进偏好的家接在后面，不因此被扔掉', () => {
    const rows = dedupeByModelKey([model('unranked', 'm1'), model('ranked', 'm2')], ['ranked'])
    expect(rows.map((row) => row.vendorKey).sort()).toEqual(['ranked', 'unranked'])
  })

  it('不同模型不合并——去重的单位是模型键，不是供应商', () => {
    const rows = dedupeByModelKey([model('apimart', 'a'), model('apimart', 'b')], [])
    expect(rows).toHaveLength(2)
  })
})

describe('对话那一行的选项', () => {
  const encode = (m: ModelCatalogModelDto): string => `${m.vendorKey}/${m.modelKey}`

  it('值就是模型身份，标签走 labelForModel（同名才补供应商）', () => {
    const choices = chatModelChoices(
      [model('apimart', 'deepseek-v4-pro', 'DeepSeek V4 Pro'), model('minimax', 'MiniMax-M3', 'MiniMax M3')],
      { apimart: 'APIMart', minimax: 'MiniMax' },
      ['apimart', 'minimax'],
      encode,
      (cost) => `${cost} 积分`,
    )
    expect(choices.map((choice) => choice.value)).toEqual(['apimart/deepseek-v4-pro', 'minimax/MiniMax-M3'])
    expect(choices[0]!.label).toBe('DeepSeek V4 Pro')
  })

  it('目录没写价就没有价——不印一个编出来的 ≈¥0.00', () => {
    const [plain] = chatModelChoices([model('apimart', 'm')], {}, [], encode, (cost) => `${cost} 积分`)
    expect(plain?.trailing).toBeUndefined()

    const priced = { ...model('apimart', 'p'), pricing: { enabled: true, cost: 3, specCosts: [] } } as ModelCatalogModelDto
    const [withPrice] = chatModelChoices([priced], {}, [], encode, (cost) => `${cost} 积分`)
    expect(withPrice?.trailing).toBe('3 积分')
  })
})
