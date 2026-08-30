// 回归钉：助手模型选择器必须按 (vendorKey, modelKey) 两段身份认模型。
// 用户 2026-08-12 反馈「右侧 agent 显示的模型不是真实模型」——同一个 modelKey 挂在多个供应商下时，
// 只认 modelKey 会显示成第一条、选中还会绑到另一个供应商去。
import { describe, expect, it } from 'vitest'

import {
  decodeModelIdentity,
  encodeModelIdentity,
  filterUsableAssistantTextModels,
  labelForModel,
} from './assistantModelIdentity'

describe('模型身份编解码', () => {
  it('两段身份可逆', () => {
    for (const identity of [
      { vendorKey: 'apimart', modelKey: 'gpt-5.2' },
      { vendorKey: 'code-newcli-com', modelKey: 'anthropic/claude-opus-4.8' },
      { vendorKey: 'http://127.0.0.1:8188', modelKey: 'a/b c?d=1&e' },
    ]) {
      expect(decodeModelIdentity(encodeModelIdentity(identity))).toEqual(identity)
    }
  })

  it('同名模型在不同供应商下编出的值必须不同（否则下拉里重复 value 就会张冠李戴）', () => {
    const a = encodeModelIdentity({ vendorKey: 'apimart', modelKey: 'gpt-5.2' })
    const b = encodeModelIdentity({ vendorKey: 'my-relay', modelKey: 'gpt-5.2' })
    expect(a).not.toBe(b)
  })

  it('残缺值解不出来就给 null，不猜', () => {
    expect(decodeModelIdentity('')).toBeNull()
    expect(decodeModelIdentity('gpt-5.2')).toBeNull()
  })
})

describe('标签消歧', () => {
  const apimart = { vendorKey: 'apimart', modelKey: 'gpt-5.2', labelZh: 'GPT-5.2' }
  const relay = { vendorKey: 'my-relay', modelKey: 'gpt-5.2', labelZh: 'GPT-5.2' }
  const solo = { vendorKey: 'apimart', modelKey: 'deepseek-v4', labelZh: 'DeepSeek V4' }
  const names = { apimart: 'APIMart', 'my-relay': '我的中转' }

  it('只接一家时不缀供应商名（凭空多出「· 某某」是噪音）', () => {
    expect(labelForModel(solo, [solo], names)).toBe('DeepSeek V4')
  })

  it('同名模型来自多家时缀上供应商名，让用户分得清', () => {
    const all = [apimart, relay, solo]
    expect(labelForModel(apimart, all, names)).toBe('GPT-5.2 · APIMart')
    expect(labelForModel(relay, all, names)).toBe('GPT-5.2 · 我的中转')
  })

  it('取不到供应商名时退回 key，不显示空白', () => {
    expect(labelForModel(relay, [apimart, relay], {})).toBe('GPT-5.2 · my-relay')
  })
})

describe('助手可选模型必须来自真实可用 catalog', () => {
  it('不把纯文字 CLI 显示成能执行工具的助手模型', () => {
    expect(filterUsableAssistantTextModels([
      { vendorKey: 'local', modelKey: 'auto', kind: 'text', enabled: true, published: true, meta: { supportsToolCalls: false } },
    ], [{ key: 'local', enabled: true, authType: 'none' }])).toEqual([])
  })
  const vendors = [
    { key: 'apimart', enabled: true, authType: 'bearer' as const, hasApiKey: true },
    { key: 'kie', enabled: true, authType: 'bearer' as const, hasApiKey: false },
    { key: 'local', enabled: true, authType: 'none' as const, hasApiKey: false },
  ]

  it('只保留 text、启用、身份完整且供应商真实可用的目录行', () => {
    const models = filterUsableAssistantTextModels([
      { vendorKey: 'apimart', modelKey: 'deepseek-v4-pro', kind: 'text', enabled: true, published: true, labelZh: 'DeepSeek V4 Pro' },
      { vendorKey: 'apimart', modelKey: 'unverified', kind: 'text', enabled: true, published: false, labelZh: 'Unverified' },
      { vendorKey: 'apimart', modelKey: 'prompt-refiner', kind: 'text', enabled: true, published: true, meta: { promptRefineOnly: true }, labelZh: 'Prompt Refiner' },
      { vendorKey: 'kie', modelKey: 'fake-text', kind: 'text', enabled: true, published: true, labelZh: 'Fake' },
      { vendorKey: 'apimart', modelKey: 'disabled', kind: 'text', enabled: false, published: true, labelZh: 'Disabled' },
      { vendorKey: 'apimart', modelKey: 'image-model', kind: 'image', enabled: true, published: true, labelZh: 'Image' },
      { vendorKey: '', modelKey: 'missing-vendor', kind: 'text', enabled: true, published: true, labelZh: 'Missing vendor' },
      { vendorKey: 'local', modelKey: 'local-text', kind: 'text', enabled: true, published: true, labelZh: 'Local text' },
    ], vendors)

    expect(models.map((model) => `${model.vendorKey}:${model.modelKey}`)).toEqual([
      'apimart:deepseek-v4-pro',
      'local:local-text',
    ])
  })

  it('没有真实可用供应商时返回空，调用方必须显示配置入口而不是假下拉', () => {
    const models = filterUsableAssistantTextModels([
      { vendorKey: 'apimart', modelKey: 'deepseek-v4-pro', kind: 'text', enabled: true, published: true, labelZh: 'DeepSeek V4 Pro' },
    ], [{ key: 'apimart', enabled: true, authType: 'bearer', hasApiKey: false }])

    expect(models).toEqual([])
  })
})
