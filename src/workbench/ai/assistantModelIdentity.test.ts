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

describe('助手可选模型 = 主进程的可用性结论 + 本下拉独有的角色要求', () => {
  // 「能不能用」在 2026-09-12 之前是这里自己拼的第二份判据（vendor.enabled && hasApiKey && published），
  // 与设置页、首页横幅各答各的——P0-10。现在它只读 `model.availability`，
  // 剩下的只有角色：必须是 text、不是 prompt_refine 专用、发得出工具调用。
  const usable = { usable: true } as const
  const unusable = { usable: false, reason: 'credential_missing' } as const

  it('不把纯文字 CLI 显示成能执行工具的助手模型', () => {
    expect(filterUsableAssistantTextModels([
      { vendorKey: 'local', modelKey: 'auto', kind: 'text', availability: usable, meta: { supportsToolCalls: false } },
    ])).toEqual([])
  })

  it('可用的行里只保留 text、非 prompt_refine、身份完整的那几条', () => {
    const models = filterUsableAssistantTextModels([
      { vendorKey: 'apimart', modelKey: 'deepseek-v4-pro', kind: 'text', availability: usable, labelZh: 'DeepSeek V4 Pro' },
      { vendorKey: 'apimart', modelKey: 'prompt-refiner', kind: 'text', availability: usable, meta: { promptRefineOnly: true }, labelZh: 'Prompt Refiner' },
      { vendorKey: 'apimart', modelKey: 'image-model', kind: 'image', availability: usable, labelZh: 'Image' },
      { vendorKey: '', modelKey: 'missing-vendor', kind: 'text', availability: usable, labelZh: 'Missing vendor' },
      { vendorKey: 'local', modelKey: 'local-text', kind: 'text', availability: usable, labelZh: 'Local text' },
    ])

    expect(models.map((model) => `${model.vendorKey}:${model.modelKey}`)).toEqual([
      'apimart:deepseek-v4-pro',
      'local:local-text',
    ])
  })

  it('主进程判为不可用的行一律不进下拉（未发布 / 没钥匙 / 被停用都走同一个答案）', () => {
    const models = filterUsableAssistantTextModels([
      { vendorKey: 'apimart', modelKey: 'unverified', kind: 'text', labelZh: 'Unverified', availability: { usable: false, reason: 'model_unpublished' } },
      { vendorKey: 'kie', modelKey: 'fake-text', kind: 'text', labelZh: 'Fake', availability: unusable },
      { vendorKey: 'apimart', modelKey: 'disabled', kind: 'text', labelZh: 'Disabled', availability: { usable: false, reason: 'model_disabled' } },
    ])

    expect(models).toEqual([])
  })
})
