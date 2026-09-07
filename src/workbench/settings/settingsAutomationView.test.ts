import { describe, expect, it } from 'vitest'

import { DEFAULT_AUTOMATION_POLICY_SETTINGS } from '../../../electron/settings/automationPolicySettings'
import { buildAutomationSettingsView, buildProviderHealthView } from './settingsAutomationView'

describe('settings automation view', () => {
  it('defaults to Balanced and exposes only known initiators', () => {
    const view = buildAutomationSettingsView(DEFAULT_AUTOMATION_POLICY_SETTINGS)

    expect(view.mode).toBe('balanced')
    expect(view.hosts).toEqual([
      { key: 'nomi', enabled: true, locked: true },
      { key: 'claude', enabled: true, locked: false },
      { key: 'codex', enabled: true, locked: false },
      { key: 'cursor', enabled: false, locked: false },
      // 新加的内置客户端默认**不可信**（和 Cursor 一样要用户显式勾）——写档不等于给权限。
      { key: 'pi', enabled: false, locked: false },
    ])
    expect(view.mandatoryGates).toEqual(['first-spend', 'irreversible'])
  })

  it('derives provider health from the real catalog state', () => {
    expect(buildProviderHealthView([
      { key: 'openai', name: 'OpenAI Compatible', enabled: true, authType: 'bearer', hasApiKey: true },
      { key: 'comfy', name: 'Local ComfyUI', enabled: true, authType: 'none' },
      { key: 'anthropic', name: 'Anthropic', enabled: true, authType: 'bearer', hasApiKey: false },
      { key: 'off', name: 'Disabled', enabled: false, authType: 'bearer', hasApiKey: true },
    ])).toEqual([
      { key: 'openai', name: 'OpenAI Compatible', state: 'connected', capabilities: [] },
      { key: 'comfy', name: 'Local ComfyUI', state: 'local', capabilities: [] },
      { key: 'anthropic', name: 'Anthropic', state: 'needs-key', capabilities: [] },
      { key: 'off', name: 'Disabled', state: 'disabled', capabilities: [] },
    ])
  })

  // 病根：旧口径只看「启用 + 有 key」就报绿色「已连接」——那是连接层的真话、能不能干活层的假话。
  // 用户接了一家中转、设置页一片绿，生成时却处处「没有可用图像模型」，这一页没有一个字对得上。
  describe('模型级口径（别在没有可用模型时报「已连接」）', () => {
    const providers = [
      { key: 'relay', name: 'Relay', enabled: true, authType: 'bearer', hasApiKey: true },
      { key: 'empty', name: 'Empty', enabled: true, authType: 'bearer', hasApiKey: true },
    ]

    it('有模型 → 已连接 + 按类型给出能力摘要（这是唯一不点开就能看出「82 个全是文本」的地方）', () => {
      const view = buildProviderHealthView(
        providers,
        [
          { vendorKey: 'relay', kind: 'image' },
          { vendorKey: 'relay', kind: 'text' },
          { vendorKey: 'relay', kind: 'text' },
        ],
        { modelsLoaded: true },
      )
      expect(view[0].state).toBe('connected')
      // 展示序固定（text 在 image 之前），与抽屉能力条同序。
      expect(view[0].capabilities).toEqual([{ kind: 'text', count: 2 }, { kind: 'image', count: 1 }])
    })

    it('一个可用模型都没有 → no-models，不再谎报「已连接」', () => {
      const view = buildProviderHealthView(providers, [{ vendorKey: 'relay', kind: 'text' }], { modelsLoaded: true })
      expect(view[1].state).toBe('no-models')
    })

    it('停用的模型不计入（它们本就不进生成下拉）', () => {
      const view = buildProviderHealthView(providers, [{ vendorKey: 'empty', kind: 'text', enabled: false }], { modelsLoaded: true })
      expect(view[1].state).toBe('no-models')
      expect(view[1].capabilities).toEqual([])
    })

    it('模型还没加载完时**不降级**（否则每家都会先闪一下「无可用模型」）', () => {
      const view = buildProviderHealthView(providers, [], { modelsLoaded: false })
      expect(view.map((row) => row.state)).toEqual(['connected', 'connected'])
    })

    it('needs-key / disabled 不被改写（它们各自已经说清了问题，改口反而丢信息）', () => {
      const view = buildProviderHealthView(
        [
          { key: 'nokey', name: 'No key', enabled: true, authType: 'bearer', hasApiKey: false },
          { key: 'off', name: 'Off', enabled: false, authType: 'bearer', hasApiKey: true },
        ],
        [],
        { modelsLoaded: true },
      )
      expect(view.map((row) => row.state)).toEqual(['needs-key', 'disabled'])
    })
  })
})
