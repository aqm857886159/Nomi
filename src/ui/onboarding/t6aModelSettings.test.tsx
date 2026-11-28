// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import i18n from '../../i18n'
import { QuotedUiNames } from './QuotedUiNames'
import { projectOnboardingConnections } from './onboardingDrawerConnections'
import type { OnboardingVendorMeta } from './useOnboardingDrawerCatalog'
import { projectModelSettingsCatalog } from './modelSettingsCatalogProjection'
import { ModelUsagePage } from './ModelSettingsWorkspacePages'
import { ModelSettingsHome } from './ModelSettingsHome'

import board from '../../../tests/fixtures/boards/model-surfaces-settings-home.json'
import old from '../../../tests/fixtures/old-user-data/catalogs/v0.24.1-wizard/model-catalog.json'

const m1EnBoardHtml = fs.readFileSync(path.join(process.cwd(), 'docs/design/boards/2026-11-07-model-surfaces/source/M1-en.dc.html'), 'utf8')

const noop = () => {}
const meta = (name: string, saved: boolean, enabled: boolean, builtinPreset = true): OnboardingVendorMeta =>
  ({ name, enabled, hasApiKey: saved, credentialMaterialSaved: saved, builtinPreset, authType: 'bearer', baseUrl: '', customCallOnly: false })

function project(vendorMeta: Map<string, OnboardingVendorMeta>) {
  return projectOnboardingConnections({ vendorMeta, models: projectModelSettingsCatalog(old.models).models,
    dreaminaStatus: null, localNames: { dreamina: 'Dreamina', codex: 'Codex', antigravity: 'Antigravity' }, openPage: noop })
}
function homeView(p: ReturnType<typeof project>) {
  return <MantineProvider env="test"><ModelSettingsHome accounts={p.accounts} previous={p.previous}
    connections={p.homeConnections} loaded bridgeMissing={false} loadError={null} readOnly={null} taskCount={0} adapterRuns={[]}
    onAddress={noop} onUsage={noop} onWays={noop} onChanged={noop} onReload={noop} /></MantineProvider>
}

const home = (p: ReturnType<typeof project>) => renderToStaticMarkup(homeView(p))

describe('ModelSurfaces connection ownership', () => {
  it('only offers APIMart for fresh credentials, including machines with disabled local CLI presets', () => {
    const p = project(new Map(['apimart', 'kie', 'codex-local', 'antigravity-cli', 'higgsfield'].map(k => [k, meta(k, false, false)])))
    expect(p.accounts).toEqual([])
    // A catalog model without its corresponding vendor cannot manufacture a previous connection.
    expect(p.previous).toEqual([])
    expect(home(p)).toContain('data-model-home-available="apimart"')
    expect(home(p)).not.toContain('data-model-account=')
  })
  it('projects the shipped connection, disabled saved keys and previously configured CLIs without rewriting credentials', () => {
    const before = JSON.stringify(old.apiKeysByVendor)
    const vendors = new Map<string, OnboardingVendorMeta>(old.vendors.map((v: { key: string; name: string; enabled: boolean }) =>
      [v.key, meta(v.name, Object.hasOwn(old.apiKeysByVendor, v.key), v.enabled, false)]))
    for (const key of ['codex-local', 'antigravity-cli']) vendors.set(key, { ...meta(key, false, true), authType: 'none' })
    vendors.set('kie', meta('KIE', true, false))
    vendors.set('apimart', meta('APIMart', true, true))
    const p = project(vendors)
    expect(p.previous.map(c => c.vendorKey).sort()).toEqual(['antigravity-cli', 'codex-local', 'kie', 'local-39017'])
    expect(p.accounts.map(c => c.vendorKey)).toEqual(['apimart'])
    expect(home(p)).toContain('data-model-account="apimart"')
    const usage = renderToStaticMarkup(<MantineProvider><ModelUsagePage vendor="apimart" name="APIMart" onBack={noop} /></MantineProvider>)
    expect(usage).toContain('data-model-settings-page="usage"')
    expect(usage).toContain('APIMart')
    expect(home(p)).toContain('data-legacy-notice')
    expect(home(p)).not.toContain('type="search"')
    expect(home({ ...p, previous: [...p.previous, { ...p.previous[0], vendorKey: 'fifth' }] })).toContain('type="search"')
    expect(JSON.stringify(old.apiKeysByVendor)).toBe(before)
  })
  it('renders the connected English home with the approved entry and account details', async () => {
    const previousLanguage = i18n.language
    const container = document.createElement('div')
    const root = createRoot(container)
    const storageRead = vi.spyOn(Storage.prototype, 'getItem')
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('nomiDesktop', { onboarding: {
      modelAccount: () => ({ keySuffix: 'f3a9', accountCredits: 52.3, unlimited: true }),
      modelUsage: () => ({ 7: [{ modelKey: 'image', runs: 41, credits: 19.6 }] }),
    } })
    try {
      await i18n.changeLanguage('en')
      const projection = project(new Map([['apimart', meta('APIMart', true, true)]]))
      const kinds = ['image', 'video', 'audio', 'text'] as const
      projection.accounts[0].models = kinds.flatMap((kind, i) => Array.from({ length: [24, 28, 9, 24][i] }, (_, j) => ({
        kind, vendorKey: 'apimart', modelKey: kind + j, labelZh: kind, enabled: true, availability: { usable: true as const },
      })))
      await act(async () => root.render(homeView(projection)))
      const element = (selector: string) => {
        const item = container.querySelector(selector)
        expect(item, selector).toBeTruthy()
        return item!
      }
      const account = '[data-model-account]'
      const assisted = '[data-model-home-assisted-onboarding]'
      const ways = '[data-model-home-action="other-ways"]'
      const approvedDoc = new DOMParser().parseFromString(m1EnBoardHtml, 'text/html')
      const approvedAssistedTitle = approvedDoc.querySelector('.card.row.g12 .bs.w6')?.textContent
      expect(approvedAssistedTitle).toBeTruthy()
      expect(element('header p').textContent).toBe(board.englishSubtitle)
      expect(element(assisted + ' [data-model-entry-title]').textContent).toBe(approvedAssistedTitle)
      expect(element(ways + ' [data-model-entry-icon] path').getAttribute('d')).toBe(board.plugFirstPath)
      for (const selector of [account, assisted, ways]) expect(element(selector).classList).toContain('rounded-nomi')
      expect(Array.from(element('[data-model-key-storage]').classList)).toEqual(expect.arrayContaining(['font-mono', 'text-nomi-ink-60']))
      expect(element('[data-model-key-storage]').textContent).toContain('f3a9 · ')
      expect(element(account + ' header strong').classList).toContain('font-semibold')
      const badge = element(account + ' header strong + span')
      expect(badge.textContent).toBe('Connected')
      expect(badge.classList).toContain('h-5')
      expect(element('header').classList).toContain('min-h-14')
      expect(element('h3').classList).toContain('mt-1')
      expect(element(account + ' header button').classList).toContain('rounded-nomi-sm')
      for (const selector of [assisted, ways]) {
        expect(element(selector).classList).toContain('py-2.5')
        expect(element(selector + ' [data-model-entry-title]').classList).toContain('leading-5')
      }
      const stats = element(account + ' dl')
      expect(Array.from(stats.classList)).toEqual(expect.arrayContaining(['border-t', 'divide-x', '[&>div]:px-3.5', '[&>div]:py-2.5']))
      expect(stats.querySelectorAll('strong')).toHaveLength(3)
      for (const value of stats.querySelectorAll('strong')) expect(value.classList).toContain('tabular-nums')
      for (const selector of ['dl a', 'dl button']) {
        expect(element(selector).classList).toContain('font-medium')
        expect(element(selector + ' svg').getAttribute('width')).toBe('12')
      }
      const usage = element('dl button').parentElement!
      expect(usage.textContent?.trim()).toBe('41 runsUsage & prices')
      expect(usage.classList).toContain('gap-2')
      expect(container.querySelector('[data-first-seen]')).toBeNull()
      expect(storageRead).not.toHaveBeenCalledWith('nomi:assisted-onboarding-seen:v1')
      expect(storageWrite.mock.calls.map(([key]) => key)).not.toContain('nomi:assisted-onboarding-seen:v1')
    } finally {
      await act(async () => root.unmount())
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      await i18n.changeLanguage(previousLanguage)
    }
  })
  it.each(['zh-CN', 'en'])('keeps each quoted control name inside one inline nowrap span (%s)', async lang => {
    await i18n.changeLanguage(lang)
    const quotedKeys = lang === 'zh-CN'
      ? (['settings.ai.defaultModels.hint', 'settings.modelsHome.kie'] as const)
      : (['settings.modelsHome.kie'] as const)
    for (const key of quotedKeys) {
      const sentence: string = i18n.t(key)
      const name = sentence.match(/「[^」]+」|“[^”]+”/u)?.[0]
      expect(name).toBeTruthy()
      expect(renderToStaticMarkup(<QuotedUiNames text={sentence} />)).toContain('<span class="whitespace-nowrap">' + name + '</span>')
      expect(sentence).not.toMatch(/[\u200B-\u200D\u2060\uFEFF]/)
    }
    expect(i18n.t('settings.ai.defaultModels.hint')).not.toMatch(/[\u200B-\u200D\u2060\uFEFF]/)
  })
})
