import { describe, expect, it, vi } from 'vitest'
import type { ChipModel } from './ModelChipGroups'
import type { OnboardingVendorMeta } from './useOnboardingDrawerCatalog'
import { projectOnboardingConnections } from './onboardingDrawerConnections'

function project(enabled: boolean, ids = ['auto']) {
  const vendorMeta = new Map<string, OnboardingVendorMeta>([['antigravity-cli', {
    name: 'Antigravity CLI', hasApiKey: false, baseUrl: '', enabled, authType: 'none', customCallOnly: false,
  }]])
  const model: ChipModel = { vendorKey: 'antigravity-cli', modelKey: 'auto', labelZh: 'Auto', kind: 'text', enabled: true }
  const openPage = vi.fn()
  return { openPage, ...projectOnboardingConnections({
    models: ids.map((modelKey) => ({ ...model, modelKey })), vendorMeta, dreaminaStatus: null, openPage,
    localNames: { dreamina: 'Dreamina', codex: 'Codex', antigravity: 'Antigravity CLI' },
  }) }
}

describe('model settings connection projection', () => {
  it.each([false, true])('routes the local CLI entry to its dedicated card when enabled=%s', (enabled) => {
    const result = project(enabled)
    expect(result.otherVendorGroups).toEqual([])
    const [entry] = enabled ? result.homeConnections : result.availableHomeConnections
    expect(entry).toMatchObject({ vendorKey: 'antigravity-cli', kind: 'local', name: 'Antigravity CLI' })
    expect(enabled ? result.availableHomeConnections : result.homeConnections).toEqual([])
    expect(entry.models).toHaveLength(0)
    entry.onOpen()
    expect(result.openPage).toHaveBeenCalledWith({ type: 'connection', vendorKey: 'antigravity-cli' })
  })
  it('counts families as models and keeps tools and automatic routing separate', () => {
    const [entry] = project(true, ['gemini-3.7-flash-high', 'gemini-3.7-flash-medium', 'gemini-3.7-flash-low', 'claude-sonnet-4-6', 'auto', 'generate_image']).homeConnections
    expect(entry.models).toHaveLength(2)
    expect(entry.auxiliaryCounts).toEqual({ tools: 1, routes: 1 })
    expect(entry.skipHealthProbe).toBe(true)
  })
})


it('keeps a saved offline credential visible as pending in the available platform row', () => {
  const result = projectOnboardingConnections({
    models: [], dreaminaStatus: null, openPage: vi.fn(),
    localNames: { dreamina: 'Dreamina', codex: 'Codex', antigravity: 'Antigravity' },
    vendorMeta: new Map([['apimart', { name: 'APIMart', hasApiKey: true, enabled: false,
      credentialVerificationPending: true, baseUrl: 'http://127.0.0.1:1', authType: 'bearer', customCallOnly: false }]]),
  })
  expect(result.homeConnections).toEqual([])
  expect(result.availableHomeConnections.find(item => item.vendorKey === 'apimart'))
    .toMatchObject({ hasApiKey: true, credentialVerificationPending: true })
})

// 第 8 轮验收抓到：英文界面的 Replicate / Runway / RunningHub 卡片底部、CTA 显示中文。
// 洞在「卡片拿的是原始目录（源里写死中文）而不是按语言取的那一份」，所以这里走真实投影入口，
// 把卡片会显示的每一个字段都拿出来查：英文轨里一个汉字都不许有。
describe('known vendor cards follow the UI language', () => {
  const HAN = /[\u3400-\u9fff]/u
  // 供应商行的名字用种子里的真名（含中文的那几家照抄种子），连接详情页的标题就是拿它显示的。
  const SEED_NAMES: Record<string, string> = { volcengine: '火山方舟', 'volcengine-speech': '火山豆包语音' }
  const allKnownVendorMeta = () => new Map<string, OnboardingVendorMeta>(
    ['apimart', 'agnes', 'kie', 'modelscope', 'volcengine', 'minimax', 'elevenlabs', 'meshy', 'fal', 'runway', 'runninghub', 'volcengine-speech', 'replicate']
      .map((key) => [key, { name: SEED_NAMES[key] ?? key, hasApiKey: false, baseUrl: '', enabled: false, authType: 'bearer', customCallOnly: false }]),
  )
  const project = () => projectOnboardingConnections({
    models: [], dreaminaStatus: null, openPage: vi.fn(),
    localNames: { dreamina: 'Dreamina', codex: 'Codex', antigravity: 'Antigravity' },
    vendorMeta: allKnownVendorMeta(),
  })
  const visibleStrings = (value: unknown): string[] => {
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.flatMap(visibleStrings)
    if (value && typeof value === 'object') {
      return Object.entries(value).flatMap(([key, child]) => (key === 'url' || key === 'logo' || key === 'vendorKey' || key === 'key' ? [] : visibleStrings(child)))
    }
    return []
  }
  const cards = () => project().knownCards

  it('English cards carry no CJK text in any displayed field', async () => {
    const { default: i18n } = await import('../../i18n')
    const before = i18n.language
    await i18n.changeLanguage('en')
    try {
      const shown = cards()
      expect(shown.map((card) => card.directory.vendorKey)).toContain('replicate')
      for (const card of shown) {
        for (const text of visibleStrings(card.directory)) {
          expect(text, `${card.directory.vendorKey}: ${text}`).not.toMatch(HAN)
        }
      }
      // 连接详情页标题（connectionTitle）同样是界面文字：英文轨不许把种子里的中文名原样端出去。
      const { connectionTitle } = project()
      for (const card of shown) expect(connectionTitle(card.directory.vendorKey), card.directory.vendorKey).not.toMatch(HAN)
      const doubao = shown.find((card) => card.directory.vendorKey === 'volcengine-speech')!
      // 合同：「部分音色需单独购买，以控制台为准」英文必须同义。
      expect(doubao.directory.credentialHint).toMatch(/purchased separately/i)
      expect(doubao.directory.credentialHint).toMatch(/console/i)
    } finally {
      await i18n.changeLanguage(before)
    }
  })

  it('Chinese cards keep the contract wording', async () => {
    const { default: i18n } = await import('../../i18n')
    const before = i18n.language
    await i18n.changeLanguage('zh-CN')
    try {
      const byKey = new Map(cards().map((card) => [card.directory.vendorKey, card.directory]))
      expect(byKey.get('replicate')!.promo!.text).toContain('用量与计费以你的 Replicate 账户为准')
      expect(byKey.get('runway')!.credentialHint).toContain('生成按你的 Runway 账户 credits 计算，以 Runway 账户为准')
      expect(byKey.get('runninghub')!.promo!.text).toContain('用量与计费以你的 RunningHub 账户为准')
      expect(byKey.get('volcengine-speech')!.credentialHint).toContain('部分音色需单独购买，以控制台为准')
    } finally {
      await i18n.changeLanguage(before)
    }
  })
})
