import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../../workbench/ai/v4/testReactRenderer'
import { ModelCapabilityEditor } from './ModelCapabilityEditor'

const seen = vi.hoisted(() => ({
  controls: new Map<string, Record<string, any>>(),
  save: undefined as undefined | (() => Promise<void>),
  list: vi.fn(),
  upsert: vi.fn(),
  t: (key: string) => key,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: seen.t }) }))
vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => ({ modelCatalog: { listModels: seen.list, upsertModel: seen.upsert } }) }))
vi.mock('../../design', () => ({
  confirmDialog: vi.fn(),
  DesignButton: (props: Record<string, any>) => { if (props['aria-label']?.endsWith('editor.save')) seen.save = props.onClick; return null },
  DesignSwitch: (props: Record<string, any>) => { seen.controls.set(props['aria-label'], props); return null },
  NomiSelect: (props: Record<string, any>) => { seen.controls.set(props.ariaLabel, props); return null },
}))
vi.mock('./ModelSettingsWorkspacePages', () => ({ ModelSettingsPageHeader: ({ actions }: { actions: React.ReactNode }) => <>{actions}</> }))

describe('native text input capability editor', () => {
  afterEach(() => { seen.controls.clear(); seen.save = undefined; vi.clearAllMocks() })

  it('saves all declared media and a model-local protocol without discarding current metadata', async () => {
    const renderer = createReactTestRenderer()
    const model = { modelKey: 'user-named-model', vendorKey: 'mixed-relay', labelZh: 'My model', kind: 'text' as const, enabled: true, meta: { original: 1, supportsImageInput: true } }
    seen.list.mockResolvedValue([{ ...model, meta: { original: 1, laterUpdate: 2, supportsImageInput: true } }])
    seen.upsert.mockResolvedValue({})
    const saved = vi.fn()
    const back = vi.fn()
    renderer.render(<ModelCapabilityEditor model={model} vendorName="Relay" onBack={back} onSaved={saved} />)
    renderer.flushPassiveEffects()
    for (const kind of ['audio', 'video']) {
      seen.controls.get(`onboardingProviders.workspace.capability.nativeInput.${kind}`)!.onChange({ currentTarget: { checked: true } })
      renderer.flushPassiveEffects()
    }
    seen.controls.get('onboardingProviders.workspace.capability.textProtocol')!.onChange('google-generative-ai')
    renderer.flushPassiveEffects()
    await seen.save!()
    expect(seen.upsert).toHaveBeenCalledWith({ vendorKey: 'mixed-relay', modelKey: 'user-named-model', meta: {
      original: 1, laterUpdate: 2, textProviderKind: 'google-generative-ai', supportsImageInput: true, supportsAudioInput: true, supportsVideoInput: true,
    } })
    expect(saved).toHaveBeenCalledOnce()
    expect(back).toHaveBeenCalledOnce()
    renderer.close()
  })
})
