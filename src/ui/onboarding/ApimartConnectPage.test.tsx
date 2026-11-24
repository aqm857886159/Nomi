import { getKnownVendor } from '../../config/knownVendors'
import { ApimartCheckCard } from './ApimartCheckCard'
import { ApimartStatusNotice } from './ApimartStatusNotice'
import { persistApimartOpenedAt } from './ApimartWaitingBanner'
import { useApimartVerification } from './useApimartVerification'
import { createReactTestRenderer } from '../../workbench/ai/v4/testReactRenderer'
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { nomiTheme } from '../../theme/nomiTheme'
import { LibraryOnboardingHeroCard } from '../../workbench/library/LibraryOnboardingHeroCard'
import { ApimartConnectPage } from './ApimartConnectPage'
import { ApimartFineprintPopover } from './ApimartFineprintPopover'
import {
  APIMART_MIRROR_DOMAINS,
  APIMART_REGISTER_URL,
  NOMI_OPEN_APIMART_CONNECT_EVENT,
  buildApimartMirrorUrl,
  openApimartConnect,
  openExternalUrlWithDebounce,
} from './apimartConnectRoute'

function renderWithTheme(node: React.ReactElement): string {
  return renderToStaticMarkup(
    <MantineProvider theme={nomiTheme}>
      {node}
    </MantineProvider>,
  )
}

const stripTags = (markup: string): string => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('T-5 E0+S7b 首屏主卡与连接 APIMart 整窗大页', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await i18n.changeLanguage('zh-CN')
  })

  it('出站链接与三个官方备用域均保留 Nomi 邀请码，且 1 秒防连点生效', () => {
    expect(APIMART_REGISTER_URL).toContain('aff=')
    const inviteSearch = new URL(APIMART_REGISTER_URL).search
    for (const domain of APIMART_MIRROR_DOMAINS) {
      expect(buildApimartMirrorUrl(domain)).toBe(`https://${domain}/register${inviteSearch}`)
    }

    const openedUrls: string[] = []
    vi.stubGlobal('window', {
      open: (url: string) => {
        openedUrls.push(url)
        return null
      },
    })
    const ref = { current: 0 }
    expect(openExternalUrlWithDebounce(APIMART_REGISTER_URL, ref, 1000, 10_000)).toBe(true)
    expect(openExternalUrlWithDebounce(APIMART_REGISTER_URL, ref, 1000, 10_400)).toBe(false)
    expect(openExternalUrlWithDebounce(APIMART_REGISTER_URL, ref, 1000, 10_999)).toBe(false)
    expect(openExternalUrlWithDebounce(APIMART_REGISTER_URL, ref, 1000, 11_000)).toBe(true)
    expect(openedUrls).toEqual([APIMART_REGISTER_URL, APIMART_REGISTER_URL])
  })

  it('E0 openApimartConnect 派发唯一全局事件 nomi-open-apimart-connect', () => {
    const events: string[] = []
    vi.stubGlobal('window', {
      dispatchEvent: (event: Event) => {
        events.push(event.type)
        return true
      },
    })
    openApimartConnect()
    expect(events).toEqual([NOMI_OPEN_APIMART_CONNECT_EVENT])
  })

  it('项目库首屏主卡（r8 减字版）中英文渲染四样核心信息与 3 张随包作品，不含硬编码 85', async () => {
    const zhMarkup = renderWithTheme(
      <LibraryOnboardingHeroCard
        modelCount={88}
        onConnect={() => undefined}
        onOpenOtherProviderSettings={() => undefined}
      />,
    )
    expect(zhMarkup).toContain('data-library-hero-card')
    expect(stripTags(zhMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.hero.title', { count: 88 }))
    expect(stripTags(zhMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.hero.cost'))
    expect(stripTags(zhMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.hero.connect'))
    expect(stripTags(zhMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.hero.otherProviderPrompt'))
    expect(stripTags(zhMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.hero.otherProviderAction'))
    expect(zhMarkup).toContain('Seedance 2.0')
    expect(zhMarkup).toContain('Nano Banana 2')
    expect(zhMarkup).toContain('Nano Banana')
    expect(zhMarkup).toContain('nomi-local://runtime/onboarding-demo/seedance-2.0-poster.jpg')

    await i18n.changeLanguage('en')
    const enMarkup = renderWithTheme(
      <LibraryOnboardingHeroCard
        modelCount={88}
        onConnect={() => undefined}
        onOpenOtherProviderSettings={() => undefined}
      />,
    )
    expect(stripTags(enMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.hero.title', { count: 88 }))
    expect(stripTags(enMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.hero.connect'))
    expect(stripTags(enMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.hero.otherProviderPrompt'))
  })

  it('「数字怎么来的」浮层包含全部五条口径出处与实时分类模型数', async () => {
    const counts = { total: 88, image: 25, video: 30, audio: 9, text: 24 }
    const zhMarkup = renderToStaticMarkup(
      <ApimartFineprintPopover counts={counts} open onOpenChange={() => undefined} />,
    )
    expect(zhMarkup).toContain('data-apimart-fineprint-popover')
    expect(stripTags(zhMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.fineprint.modelsHeading', { total: 88 }))
    expect(stripTags(zhMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.fineprint.modelsBody', counts))
    expect(stripTags(zhMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.fineprint.latestHeading'))
    expect(stripTags(zhMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.fineprint.savingsHeading'))
    expect(stripTags(zhMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.fineprint.costHeading'))
    expect(stripTags(zhMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.fineprint.refundHeading'))
    expect(stripTags(zhMarkup)).toContain('2026-11-07')

    await i18n.changeLanguage('en')
    const enMarkup = renderToStaticMarkup(
      <ApimartFineprintPopover counts={counts} open onOpenChange={() => undefined} />,
    )
    expect(stripTags(enMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.fineprint.modelsHeading', { total: 88 }))
    expect(stripTags(enMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.fineprint.modelsBody', counts))
    expect(stripTags(enMarkup)).toContain(i18n.t('onboardingProviders.apimartConnect.fineprint.savingsHeading'))
  })

  it('连接 APIMart 大页遵守 400/600 字重、密码框不外泄明文、不静默挂 focus 读剪贴板、且保存传 enabled: false', () => {
    const pageSource = fs.readFileSync(
      path.join(process.cwd(), 'src/ui/onboarding/ApimartConnectPage.tsx'),
      'utf8',
    )
    // C4：绝不在 focus / visibilitychange 偷读剪贴板（防 macOS 15.4 系统粘贴弹窗）
    expect(pageSource).not.toMatch(/addEventListener\(\s*['"](?:focus|visibilitychange)['"][\s\S]{0,200}clipboard/)
    // manualCertificationBoundary：渲染层保存凭据永不传 enabled: true
    const saveSource = fs.readFileSync(path.join(process.cwd(), 'src/ui/onboarding/useApimartVerification.ts'), 'utf8')
    expect(saveSource).toContain("upsertVendorApiKey('apimart', { apiKey: key, enabled: false, source: 'apimart-connect' })")
    expect(saveSource).not.toMatch(/upsertVendorApiKey\([\s\S]{0,180}enabled:\s*true/)
    // 大页右栏只用 400（font-normal）与 600（font-semibold），不用 font-medium / font-bold
    expect(pageSource).not.toMatch(/\bfont-(?:medium|bold|extrabold|light)\b/)

    // 密码输入框用非受控 ref 读取，不在 React state / DOM value 属性回显明文
    expect(pageSource).not.toContain('value={apiKey}')

    const origin = i18n.t('appShell.topbar.library')
    const markup = renderWithTheme(
      <ApimartConnectPage
        originLabel={origin}
        onBack={() => undefined}
        onSaved={() => undefined}
      />,
    )
    expect(markup).toContain('data-apimart-connect-page')
    expect(markup).toContain('data-apimart-back')
    expect(markup).toContain('type="password"')
    expect(stripTags(markup)).toContain(origin)
    expect(stripTags(markup)).toContain(i18n.t('onboardingProviders.apimartConnect.pageTitle'))
    expect(stripTags(markup)).toContain(i18n.t('onboardingProviders.apimartConnect.claimTitle'))
    expect(stripTags(markup)).toContain(i18n.t('onboardingProviders.apimartConnect.openSite'))
    expect(stripTags(markup)).toContain(i18n.t('onboardingProviders.apimartConnect.worries'))
  })
})

describe('S6 · APIMart verification', () => {
  const origin = 'Storyboard draft'
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('board:Onboarding/wait.banner · board:Onboarding/wait.return-line · board:Onboarding/error.site-blocked', () => {
    const values = new Map()
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key), setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } })
    const now = new Date(2026, 10, 24, 14, 2).getTime()
    persistApimartOpenedAt(now)
    const page = () => renderWithTheme(<ApimartConnectPage originLabel={origin} onBack={vi.fn()} onSaved={vi.fn()} />)
    const waiting = page()
    expect(waiting).toContain('14:02')
    expect(waiting).toContain(i18n.t('modelSetup.apimartVerification.returnLine', {origin}))
    expect(waiting.match(/data-apimart-step="/g)).toHaveLength(3)
    expect(waiting).not.toContain('data-apimart-cta-row')
    persistApimartOpenedAt(0)
    expect(page()).not.toContain('data-apimart-waiting')
  })

  it('board:Onboarding/return.check-rows · renders four left-hand marks and current model counts', () => {
    const counts = { image: 4, video: 3, audio: 2, text: 1, total: 10 }
    const markup = renderToStaticMarkup(<ApimartCheckCard counts={counts} complete token={null} />)
    expect(markup.match(/<li[^>]*><svg/g)).toHaveLength(4)
    expect(stripTags(markup)).toContain(i18n.t('modelSetup.apimartVerification.counts', counts))
  })

  it('board:Onboarding/error.keychain · board:Onboarding/error.legacy-copy · localized notices isolate vendor copy', () => {
    expect(getKnownVendor('volcengine')?.promo?.text).toContain('Ark')
    expect(getKnownVendor('apimart')?.promo?.text).not.toMatch(/Volcengine|方舟/)
    for (const kind of ['keychain', 'invalid', 'format', 'offline'] as const) {
      const text = stripTags(renderWithTheme(<ApimartStatusNotice kind={kind} id="test" onAction={vi.fn()} />))
      expect(text).toContain(i18n.t(`modelSetup.apimartVerification.${kind}Title`))
      expect(text).toContain(i18n.t(`modelSetup.apimartVerification.${kind}Body`))
      expect(text).not.toMatch(/keychain|Volcengine|方舟/i)
    }
  })

  function mountCheck() {
    const save = vi.fn(), read = vi.fn(), back = vi.fn()
    const windowEvents = Object.assign(new EventTarget(), {
      nomiDesktop: { modelCatalog: { upsertVendorApiKey: save, recheckApimartBalance: read } },
      setTimeout, clearTimeout,
    })
    vi.stubGlobal('window', windowEvents)
    const renderer = createReactTestRenderer()
    let state: ReturnType<typeof useApimartVerification>
    function Harness() { state = useApimartVerification(back); return null }
    const flush = () => renderer.render(<Harness />)
    flush()
    return { save, read, back, flush, state: () => state, close: () => renderer.close() }
  }

  it('board:Onboarding/depart.key-input · board:Onboarding/error.key-format · rejects malformed candidates before IPC', async () => {
    const h = mountCheck()
    try {
      for (const value of ['https://example.invalid', 'mistyped', 'sk-a b', 'sk-']) {
        await h.state().check(value)
        h.flush()
        expect(h.state().stage).toBe('format')
      }
      expect(h.save).not.toHaveBeenCalled()
      expect(h.read).not.toHaveBeenCalled()
    } finally { h.close() }
  })

  it('board:Onboarding/error.key-invalid · secure storage retry and auth refusal stay on page', async () => {
    const h = mountCheck()
    try {
      h.save.mockRejectedValueOnce(new Error('could not be encrypted')).mockRejectedValueOnce(new Error('apimart-key-invalid'))
      await h.state().check('sk-loopback')
      h.flush()
      expect(h.state().stage).toBe('keychain')
      await h.state().retry()
      h.flush()
      expect(h.state().stage).toBe('invalid')
      expect(h.save.mock.calls[0]).toEqual(h.save.mock.calls[1])
      expect(h.back).not.toHaveBeenCalled()
    } finally { h.close() }
  })

  it('board:Onboarding/error.offline · board:Onboarding/return.back · online only reads the saved key, unknown passes after a visible pause', async () => {
    vi.useFakeTimers()
    const h = mountCheck()
    try {
      h.save.mockResolvedValue({status: 'offline'})
      h.read.mockResolvedValue({status: 'received', balance: null})
      await h.state().check('sk-loopback')
      h.flush()
      expect(h.state().stage).toBe('offline')
      window.dispatchEvent(new Event('online'))
      await Promise.resolve()
      h.flush()
      expect(h.read).toHaveBeenCalledTimes(1)
      expect(h.save).toHaveBeenCalledTimes(1)
      expect(h.state().stage).toBe('passed')
      expect(h.back).not.toHaveBeenCalled()
      vi.advanceTimersByTime(450)
      expect(h.back).toHaveBeenCalledOnce()
    } finally { h.close() }
  })
})
