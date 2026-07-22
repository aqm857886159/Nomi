import { afterEach, describe, expect, it, vi } from 'vitest'

function installBrowserState(storedLocale?: string): { values: Map<string, string>; documentElement: { lang: string } } {
  const values = new Map<string, string>()
  if (storedLocale !== undefined) values.set('nomi:locale:v1', storedLocale)
  const documentElement = { lang: '' }
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  })
  vi.stubGlobal('document', { documentElement })
  return { values, documentElement }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('app locale', () => {
  it('defaults to zh-CN and rejects unsupported persisted locales', async () => {
    const { documentElement } = installBrowserState('fr')
    const locale = await import('./index')

    expect(locale.readStoredLocale()).toBe('zh-CN')
    expect(locale.getAppLocale()).toBe('zh-CN')
    expect(documentElement.lang).toBe('zh-CN')
    expect(locale.default.t('common.loading')).toBe('加载中')
  })

  it('restores and persists English while syncing the document language', async () => {
    const { values, documentElement } = installBrowserState('en')
    const locale = await import('./index')

    expect(locale.getAppLocale()).toBe('en')
    expect(documentElement.lang).toBe('en')
    expect(locale.default.t('common.loading')).toBe('Loading')

    locale.setAppLocale('zh-CN')
    expect(values.get(locale.LOCALE_STORAGE_KEY)).toBe('zh-CN')
    expect(documentElement.lang).toBe('zh-CN')
    expect(locale.default.t('common.loading')).toBe('加载中')
  })

  it('supports only zh-CN and en', async () => {
    installBrowserState()
    const { isAppLocale, SUPPORTED_LOCALES } = await import('./index')

    expect(SUPPORTED_LOCALES).toEqual(['zh-CN', 'en'])
    expect(isAppLocale('zh-CN')).toBe(true)
    expect(isAppLocale('en')).toBe(true)
    expect(isAppLocale('en-US')).toBe(false)
  })
})
