import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Mapping } from '../../../electron/catalog/types'
import type { ChipModel } from './ModelChipGroups'
import { modelsVisibleOnHome, resolveModelHomeStatus, summarizeModelHomeConnection } from './modelSettingsHomeState'

const model = (patch: Partial<ChipModel> = {}): ChipModel => ({
  vendorKey: 'future-api',
  modelKey: 'future-video-v1',
  labelZh: 'Future Video',
  kind: 'video',
  enabled: true,
  ...patch,
})

describe('model settings home', () => {
  it('does not call a merely saved media model usable', () => {
    expect(resolveModelHomeStatus(model(), [])).toBe('needsSetup')
    expect(resolveModelHomeStatus(model({ customCallDraft: true }), [])).toBe('needsSetup')
  })

  it('shows configured, verified, disabled, working and failed states from real contracts', () => {
    const mapping = [{
      id: 'future-video',
      vendorKey: 'future-api',
      modelKey: 'future-video-v1',
      taskKind: 'text_to_video',
      enabled: true,
      request: { method: 'POST', path: '/generate' },
      response: { type: 'url', path: 'data.url' },
    }] as unknown as Mapping[]
    const configured = model({
      meta: {
        customCapabilityContract: {
          version: 1,
          kind: 'video',
          defaultModeId: 'prompt',
          transportTaskKind: 'text_to_video',
          modes: [{
            id: 'prompt',
            vendorTerm: 'Prompt',
            hint: '',
            intent: 'text',
            promptRequired: true,
            slots: [],
            params: [],
          }],
        },
      },
    })
    expect(resolveModelHomeStatus(configured, mapping)).toBe('ready')
    expect(resolveModelHomeStatus({ ...configured, adapterState: 'verified' }, mapping)).toBe('verified')
    expect(resolveModelHomeStatus({ ...configured, enabled: false }, mapping)).toBe('disabled')
    expect(resolveModelHomeStatus({ ...configured, adapterState: 'testing' }, mapping)).toBe('working')
    expect(resolveModelHomeStatus({ ...configured, adapterState: 'failed' }, mapping)).toBe('failed')

    expect(summarizeModelHomeConnection([{ ...configured, adapterState: 'testing' }], mapping)).toMatchObject({
      state: 'working',
      ready: 0,
      working: 1,
    })
    expect(summarizeModelHomeConnection([{ ...configured, enabled: false }], mapping)).toMatchObject({
      state: 'disabled',
      ready: 0,
      disabled: 1,
    })
    expect(summarizeModelHomeConnection([{ ...configured, adapterState: 'verified' }], mapping)).toMatchObject({
      state: 'verified',
      ready: 1,
    })
  })

  it('uses the Nomi primitives and keeps the direct-script action inside the advanced section', () => {
    const home = fs.readFileSync(path.join(process.cwd(), 'src/ui/onboarding/ModelSettingsHome.tsx'), 'utf8')
    const wizard = fs.readFileSync(path.join(process.cwd(), 'src/ui/onboarding/OnboardingWizard.tsx'), 'utf8')
    expect(home).toContain('DesignSearchInput')
    expect(home).toContain('DesignButton')
    expect(home).toContain('NomiLoadingMark')
    expect(home).toContain('data-model-home-direct-script')
    const advancedSection = home.slice(home.indexOf('data-model-home-advanced'))
    expect(advancedSection).toContain('dataMarker="direct-script"')
    expect(advancedSection).toContain('directScript')
    const rowGroup = home.slice(home.indexOf('function RowGroup'), home.indexOf('function ActionRow'))
    expect(rowGroup).toContain('bg-nomi-ink-05')
    expect(rowGroup).toContain('border-nomi-line-soft')
    expect(rowGroup).not.toContain('border border-nomi-line')
    expect(wizard).not.toContain('<DirectScriptDraftEntry')
  })

  it('puts adapted platforms before custom APIs and does not render empty-state controls', () => {
    const home = fs.readFileSync(path.join(process.cwd(), 'src/ui/onboarding/ModelSettingsHome.tsx'), 'utf8')

    expect(home).toContain("import { translateModelDisplayText } from '../../i18n/modelDisplayText'")
    expect(home).toContain('const displayName = translateModelDisplayText(connection.name)')
    expect(home).toContain('data-model-home-adapted-platforms')
    expect(home).toContain('data-model-home-other-methods')
    expect(home).toContain('data-model-home-advanced')
    expect(home.indexOf('data-model-home-adapted-platforms')).toBeLessThan(home.indexOf('data-model-home-other-methods'))
    expect(home.indexOf('data-model-home-other-methods')).toBeLessThan(home.indexOf('data-model-home-advanced'))
    expect(home).toContain("const showSearch = hasConnections &&")
    expect(home).toContain('data-model-home-task-strip')
    expect(home).not.toContain("kind: 'api' | 'local' | 'account' | 'assistant'")
  })

  it('shows only work needing attention until the user searches or opens the connection', () => {
    const needsSetup = model({ modelKey: 'future-video-v1', labelZh: 'Future Video' })
    const working = model({ modelKey: 'future-video-v2', labelZh: 'Future Video 2', adapterState: 'testing' })
    const readyText = model({ modelKey: 'future-chat', labelZh: 'Future Chat', kind: 'text' })
    const models = [needsSetup, working, readyText]

    expect(modelsVisibleOnHome({ models, mappings: [], search: '', connectionName: 'Future API' }))
      .toEqual([needsSetup, working])
    expect(modelsVisibleOnHome({ models, mappings: [], search: 'chat', connectionName: 'Future API' }))
      .toEqual([readyText])
    expect(modelsVisibleOnHome({ models, mappings: [], search: 'future api', connectionName: 'Future API' }))
      .toEqual(models)
  })
})
