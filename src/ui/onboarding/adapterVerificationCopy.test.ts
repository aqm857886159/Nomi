import { describe, expect, it } from 'vitest'
import { enOnboardingProviders, zhOnboardingProviders } from '../../i18n/locales/onboardingProviders'

describe('adapter verification user-facing copy', () => {
  it.each([
    ['zh-CN', zhOnboardingProviders],
    ['en', enOnboardingProviders],
  ])('%s reports real terminal outcomes instead of pretending every run just saved models', (_locale, translations) => {
    const copy = translations.adapterVerification
    expect(copy.stage.completed).toContain(localeWord(_locale, 'completed'))
    expect(copy.stage.cancelled).toContain(localeWord(_locale, 'cancelled'))
    expect(copy.stage.timed_out).toContain(localeWord(_locale, 'timedOut'))
    expect(copy.addedSomeFailed).not.toContain(localeWord(_locale, 'stillUsable'))
    expect(copy.noContract).toContain(localeWord(_locale, 'manualSetup'))
  })

  // 3D 经通用中转接入时零通道，用户此前拿到的是一句生英文技术串。它必须①是本地化的
  // ②说清这不是他的错 ③**指出真的走得通的那条路**——3D 不是接不了，是走另一条路接。
  // 只断言「这个 key 存在」是不够的：一句本地化但没指路的话，读起来照样是「坏了」。
  it.each([
    ['zh-CN', zhOnboardingProviders],
    ['en', enOnboardingProviders],
  ])('%s tells the user which route actually works instead of leaving a dead end', (_locale, translations) => {
    const copy = translations.adapterVerification.why.noGenericContract
    // 不许把英文技术原文当人话摆出来（它只该出现在折叠的「看原始报错」里）。
    expect(copy).not.toContain('generic contract')
    for (const route of routeWords(_locale)) expect(copy).toContain(route)
  })
})

/** 真的接得上 3D 的两条路：直接脚本（DirectScriptDraftForm 的 KINDS 含 model3d）与 ComfyUI 工作流导入。 */
function routeWords(locale: string): readonly string[] {
  const values = {
    'zh-CN': ['我自己接', 'ComfyUI'],
    en: ['Connect it myself', 'ComfyUI'],
  } as const
  return values[locale as keyof typeof values]
}

function localeWord(locale: string, key: 'completed' | 'cancelled' | 'timedOut' | 'stillUsable' | 'manualSetup'): string {
  const values = {
    'zh-CN': { completed: '完成', cancelled: '停止', timedOut: '超时', stillUsable: '仍可使用', manualSetup: '手动配置' },
    en: { completed: 'complete', cancelled: 'stopped', timedOut: 'timed out', stillUsable: 'still usable', manualSetup: 'manual setup' },
  } as const
  return values[locale as keyof typeof values][key]
}
