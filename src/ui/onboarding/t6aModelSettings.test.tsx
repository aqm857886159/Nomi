import fs from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import React from 'react'
import { MantineProvider } from '@mantine/core'
import i18n from '../../i18n'
import { QuotedUiNames } from './QuotedUiNames'
import { projectOnboardingConnections } from './onboardingDrawerConnections'
import type { OnboardingVendorMeta } from './useOnboardingDrawerCatalog'
import { projectModelSettingsCatalog } from './modelSettingsCatalogProjection'
import { ModelUsagePage } from './ModelSettingsWorkspacePages'
import { ModelSettingsHome } from './ModelSettingsHome'

const fixture = new URL('../../../tests/fixtures/old-user-data/catalogs/v0.24.1-wizard/model-catalog.json', import.meta.url)
const old = JSON.parse(fs.readFileSync(fixture, 'utf8'))
const noop = () => {}
const meta = (name: string, saved: boolean, enabled: boolean, builtinPreset = true): OnboardingVendorMeta =>
  ({ name, enabled, hasApiKey: saved, credentialMaterialSaved: saved, builtinPreset, authType: 'bearer', baseUrl: '', customCallOnly: false })

function project(vendorMeta: Map<string, OnboardingVendorMeta>) {
  return projectOnboardingConnections({ vendorMeta, models: projectModelSettingsCatalog(old.models).models,
    dreaminaStatus: null, localNames: { dreamina: 'Dreamina', codex: 'Codex', antigravity: 'Antigravity' }, openPage: noop })
}
function home(p: ReturnType<typeof project>) {
  return renderToStaticMarkup(<MantineProvider><ModelSettingsHome accounts={p.accounts} previous={p.previous}
    connections={p.homeConnections} loaded bridgeMissing={false} loadError={null} readOnly={null} taskCount={0} adapterRuns={[]}
    onAddress={noop} onUsage={noop} onWays={noop} onChanged={noop} onReload={noop} /></MantineProvider>)
}

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
      [v.key, meta(v.name, Boolean(old.apiKeysByVendor[v.key]), v.enabled, false)]))
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
  it.each(['zh-CN', 'en'])('keeps each quoted control name inside one inline nowrap span (%s)', async lang => {
    await i18n.changeLanguage(lang)
    for (const key of ['settings.ai.defaultModels.hint', 'settings.modelsHome.kie']) {
      const sentence = i18n.t(key)
      const name = sentence.match(/「[^」]+」|“[^”]+”/u)?.[0]
      expect(name).toBeTruthy()
      expect(renderToStaticMarkup(<QuotedUiNames text={sentence} />)).toContain('<span class="whitespace-nowrap">' + name + '</span>')
      expect(sentence).not.toMatch(/[\u200B-\u200D\u2060\uFEFF]/)
    }
  })
})
