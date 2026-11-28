import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AUTOMATION_POLICY_SETTINGS } from '../../../electron/settings/automationPolicyContract'
import { AiModelsSection } from './AiModelsSection'
import i18n from '../../i18n'

const { captureSwitch } = vi.hoisted(() => ({ captureSwitch: vi.fn() }))
vi.mock('../../design', async (original) => ({
  ...await original<typeof import('../../design')>(),
  DesignSwitch: (props: React.InputHTMLAttributes<HTMLInputElement>) => { captureSwitch(props); return null },
}))

describe('Ask before using public temporary hosting', () => {
  it.each([['ask', true, 'allow'], ['allow', false, 'ask']] as const)(
    'reads %s as checked=%s and writes %s when toggled', (saved, checked, next) => {
      captureSwitch.mockClear()
      const onChange = vi.fn()
      renderToStaticMarkup(<MantineProvider><AiModelsSection
        settings={{ ...DEFAULT_AUTOMATION_POLICY_SETTINGS, anonymousAssetHosting: saved }}
        onChange={onChange} /></MantineProvider>)
      const control = captureSwitch.mock.calls.map(([props]) => props)
        .find(props => props['aria-label'] === i18n.t('settings.ai.upload.anonymousPrompt'))
      expect(control?.checked).toBe(checked)
      control.onChange({ currentTarget: { checked: !checked } })
      expect(onChange).toHaveBeenCalledExactlyOnceWith({ anonymousAssetHosting: next })
    })
})
