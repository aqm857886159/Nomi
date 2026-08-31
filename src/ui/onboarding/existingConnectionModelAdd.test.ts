import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (name: string): string => fs.readFileSync(path.join(process.cwd(), 'src/ui/onboarding', name), 'utf8')

describe('existing connection model add UI contract', () => {
  it('routes an existing connection to a dedicated picker instead of the credential form', () => {
    const wizard = source('OnboardingWizard.tsx')
    const drawer = source('OnboardingDrawer.tsx')

    expect(wizard).toContain('existingVendorKey?: string')
    expect(wizard).toContain("screen === 'form' && !existingVendorKey")
    expect(wizard).toContain('<ExistingConnectionModelPicker')
    expect(wizard).toMatch(/adapterRegisterExisting\(\{\s*vendorKey:\s*targetVendorKey,\s*models:\s*selected/)
    expect(drawer).toContain('existingVendorKey={page.existingVendorKey}')
    expect(drawer).not.toContain('updateWizardVerificationRoute')
    expect(drawer).not.toContain('onAdapterRunChange=')
  })

  it('loads by vendor id only and never handles an API key in the existing picker', () => {
    const picker = source('ExistingConnectionModelPicker.tsx')

    expect(picker).toContain('existingConnectionListModels({ vendorKey })')
    expect(picker).not.toContain('apiKey')
    expect(picker).toContain("result.code === 'MODEL_LIST_UNAVAILABLE'")
    expect(picker).toContain('alreadyAddedIds=')
  })

  it('does not contact the saved upstream until the user explicitly asks for its model list', () => {
    const picker = source('ExistingConnectionModelPicker.tsx')
    const effectStart = picker.indexOf('React.useEffect')
    const effectEnd = picker.indexOf('const resolveKind', effectStart)
    const mountEffect = picker.slice(effectStart, effectEnd)

    expect(picker).toContain('initialConnection: DesktopExistingConnectionSummary')
    expect(mountEffect).not.toContain('fetchModels()')
    expect(picker).toContain('onRefetch={fetchModels}')
    expect(picker).toContain('hasFetched={fetchAttempted}')
  })

  it('labels the first explicit request as fetch and only later calls it refresh', () => {
    const picker = source('ModelPickerScreen.tsx')

    expect(picker).toMatch(
      /t\(\s*hasFetched\s*\?\s*'onboardingProviders\.modelControls\.refetch'\s*:\s*'onboardingProviders\.modelControls\.fetch'\s*\)/,
    )
  })

  it('makes already-added rows immutable while keeping manual entry for unlisted models', () => {
    const picker = source('ModelPickerScreen.tsx')

    expect(picker).toContain('alreadyAdded.has(id)')
    expect(picker).toContain('disabled={isAlreadyAdded || controlsBlocked}')
    expect(picker).toContain('!alreadyAdded.has(m.id)')
    expect(picker).toContain('onResolveKind')
  })

  it('renders model-list failures independently even when existing models keep the list non-empty', () => {
    const existingPicker = source('ExistingConnectionModelPicker.tsx')
    const picker = source('ModelPickerScreen.tsx')

    expect(existingPicker).toContain('statusHint={message || undefined}')
    expect(existingPicker).not.toContain('emptyHint={message || undefined}')
    expect(picker).toContain('data-model-picker-status')
    expect(picker).toContain('{statusHint}')
    expect(picker.indexOf('data-model-picker-status')).toBeLessThan(picker.indexOf('{groups.length === 0 ?'))
  })

  it('keeps new-connection candidates and selections recoverable after a later failure', () => {
    const wizard = source('OnboardingWizard.tsx')
    const resetStart = wizard.indexOf('const resetToInput')
    const resetEnd = wizard.indexOf('const updateHeader', resetStart)
    const resetBody = wizard.slice(resetStart, resetEnd)

    expect(resetBody).not.toContain('setModels([])')
    expect(resetBody).not.toContain('setCandidateModels([])')
    expect(resetBody).not.toContain("setFetchModelsMsg('')")
    expect(wizard).toContain('statusHint={fetchModelsMsg || undefined}')
  })
})
