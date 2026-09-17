import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 2026-09-17 真机失败的回归（日志 09:51Z）：大脑是 Moonshot 时，视频拆解报
// 「没有可用的转写模型」，而 APIMart 的转写模型就在隔壁启用着。
// 根因：转写腿只在**文本大脑那一家**里找 audio 模型。
vi.mock('./detectShotCuts', () => ({ detectShotCuts: vi.fn() }))
vi.mock('../runtime', () => ({ runTask: vi.fn() }))

const catalog = {
  vendors: [
    { key: 'moonshot', enabled: true, authType: 'bearer' },
    { key: 'apimart', enabled: true, authType: 'bearer' },
  ],
  models: [
    { vendorKey: 'moonshot', modelKey: 'kimi-k2', kind: 'text', enabled: true, published: true },
    { vendorKey: 'apimart', modelKey: 'whisper-1', kind: 'audio', enabled: true, published: true },
  ],
  apiKeysByVendor: { moonshot: { enabled: true }, apimart: { enabled: true } },
}

vi.mock('../catalog/catalogStore', () => ({
  readCatalog: () => catalog,
  normalizeProviderKind: (value: string) => value,
  mutateCatalog: vi.fn(),
}))
vi.mock('../catalog/secrets', () => ({
  decryptApiKeyRecord: () => 'k',
  decryptCustomConfigWithLegacy: () => ({}),
  apiKeyDecryptStatus: () => 'ok',
}))
vi.mock('../catalog/catalogModelAvailability', () => ({
  catalogModelAvailability: () => ({ usable: true, reason: null }),
  createCatalogAvailability: () => ({ of: () => ({ usable: true, reason: null }) }),
}))

describe('转写腿的模型解析', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('在所有已启用供应商里找 audio 模型，不绑在文本大脑那一家上', async () => {
    const { findExecutableModelAnyVendor } = await import('../catalog/executableModel')
    const resolved = findExecutableModelAnyVendor('audio', [])
    expect(resolved?.vendor.key).toBe('apimart')
    expect(resolved?.model.modelKey).toBe('whisper-1')
    // 反面：只在大脑那家（moonshot）里找，就是线上那条失败路径。
    const { findExecutableModel } = await import('../catalog/executableModel')
    expect(() => findExecutableModel('moonshot', '', 'audio')).toThrow()
  })

  it('供应商偏好决定先挑谁——不在这里另发明一套排序', async () => {
    catalog.models.push({ vendorKey: 'moonshot', modelKey: 'moonshot-asr', kind: 'audio', enabled: true, published: true })
    try {
      const { findExecutableModelAnyVendor } = await import('../catalog/executableModel')
      expect(findExecutableModelAnyVendor('audio', ['moonshot', 'apimart'])?.vendor.key).toBe('moonshot')
      expect(findExecutableModelAnyVendor('audio', ['apimart', 'moonshot'])?.vendor.key).toBe('apimart')
    } finally {
      catalog.models.pop()
    }
  })

  it('一个能用的 audio 模型都没有时返回 null，而不是抛一句和大脑有关的话', async () => {
    const audio = catalog.models.filter((m) => m.kind === 'audio')
    catalog.models = catalog.models.filter((m) => m.kind !== 'audio')
    try {
      const { findExecutableModelAnyVendor } = await import('../catalog/executableModel')
      expect(findExecutableModelAnyVendor('audio', [])).toBeNull()
    } finally {
      catalog.models.push(...audio)
    }
  })
})

// 2026-09-17：转写语言写死 "zh"，英文用户的视频被按中文转写。改成随界面语言派生。
describe('转写语言随输入派生', () => {
  beforeEach(() => { vi.resetModules() })

  it('en 界面发 en，zh 界面发 zh —— 源码里不许再有写死的 language', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(new URL('./deconstructVideo.ts', import.meta.url), 'utf8')
    // 先剥注释：这条断言要盯的是**代码**，注释里引用旧写法（讲清为什么改）是正当的。
    const code = source.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/language:\s*['"]zh['"]/)
    expect(source).toContain('transcribeLanguage()')
    // 报价与调用看的是同一个值：spend plan 的那一行也带上它。
    expect(source).toContain('parameters: { language: transcribeLanguage() }')
  })
})
