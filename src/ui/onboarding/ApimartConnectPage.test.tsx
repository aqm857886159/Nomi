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
    expect(pageSource).toContain("upsertVendorApiKey('apimart', { apiKey: cleanKey, enabled: false })")
    expect(pageSource).not.toMatch(/upsertVendorApiKey\([\s\S]{0,180}enabled:\s*true/)
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
