import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CUSTOM_CALL_VARIABLES } from '../../../electron/catalog/customCallContract'
import { enOnboardingProviders, zhOnboardingProviders } from '../../i18n/locales/onboardingProviders'

const source = (name: string): string => fs.readFileSync(path.join(process.cwd(), 'src/ui/onboarding', name), 'utf8')

describe('embedded model settings presentation', () => {
  it('owns the page marker and back control in one shared surface', () => {
    const surface = source('ModelSettingsPageSurface.tsx')

    expect(surface).toContain('data-model-settings-page={page}')
    expect(surface).toContain('data-model-settings-page-content')
    expect(surface).toContain('onClick={onBack}')
    expect(surface).toContain("page === 'script' ? 'max-w-[1120px]' : 'max-w-[760px]'")
    expect(surface).toContain("'min-h-0 w-full flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-5'")
    expect(surface).toContain('data-model-settings-page-footer')
  })

  it('does not expose the fixed detail summary as a dead keyboard button', () => {
    const card = source('FoldableModelCard.tsx')

    expect(card).toContain('disabled={detailMode}')
    expect(card).toContain('tabIndex={detailMode ? -1 : undefined}')
  })

  it('keeps onboarding modal-compatible while exposing one shared page surface', () => {
    const wizard = source('OnboardingWizard.tsx')

    expect(wizard).toContain("presentation?: 'modal' | 'page'")
    expect(wizard).toContain("presentation = 'modal'")
    expect(wizard).toContain("presentation === 'page'")
    expect(wizard).toMatch(/<ModelSettingsPageSurface\s+page="add"/)
    expect(wizard.indexOf("presentation === 'page'")).toBeLessThan(wizard.indexOf('<DesignModal'))
    expect(wizard).toContain('<OnboardingWizardResult')
    expect(source('OnboardingWizardResult.tsx')).toContain('onClick={onClose}')
  })

  it('keeps automatic adaptation out of the save-first wizard', () => {
    const wizard = source('OnboardingWizard.tsx')

    expect(wizard).not.toContain('DesktopProviderAdapterRun')
    expect(wizard).not.toContain('onAdapterRunChange')
    expect(wizard).not.toContain('onSelfConnect')
    expect(wizard).not.toContain('adapterStart(')
    expect(wizard).not.toContain('adapterStartExisting(')
    expect(wizard).not.toContain('<AdapterVerificationScreen')
  })

  it('keeps custom-call modal-compatible while reusing one full-width page workspace', () => {
    const editor = source('CustomCallEditor.tsx')

    expect(editor).toContain("presentation?: 'modal' | 'page'")
    expect(editor).toContain("presentation = 'modal'")
    expect(editor).toContain("presentation === 'page'")
    expect(editor).toContain('page="script"')
    expect(editor.indexOf("presentation === 'page'")).toBeLessThan(editor.indexOf('<DesignModal'))
    expect(editor).toContain("presentation === 'page' ? 'min-h-[240px]")
    expect(editor).toContain('sm:flex-1')
    expect(editor).toContain('const requestClose = React.useCallback')
    expect(editor).toContain('onBack={() => { void requestClose() }}')
    expect(editor).toContain('onCancel={() => { void requestClose() }}')
    expect(editor).toContain('testResultRef.current?.scrollIntoView')
  })

  it('keeps compact call help before the editor on narrow screens and beside it only when space allows', () => {
    const editor = source('CustomCallEditor.tsx')
    const sidebar = source('CustomCallContractSidebar.tsx')
    const presentation = `${editor}\n${sidebar}`

    expect(presentation).toContain('data-custom-call-contract-sidebar')
    expect(editor).toContain('data-custom-call-editor-main')
    expect(editor).toContain('sm:grid-cols-[11rem_minmax(0,1fr)]')
    expect(presentation).toContain('sm:hidden')
    expect(presentation).toContain('hidden border-b border-nomi-line-soft pb-3 sm:block')
    expect(presentation).toContain('customCall.apiHelpTitle')
    expect(editor).toContain('contract?.returnContract')
    expect(presentation).toContain('variable.type')
    expect(presentation).toContain('customCall.variableGroup.input')
    expect(editor).toContain('footer={actionBar}')
    expect(editor).toContain("presentation !== 'page'")
  })

  it('documents every injected variable in both supported languages', () => {
    const variableNames = CUSTOM_CALL_VARIABLES.map((variable) => variable.name)

    expect(Object.keys(zhOnboardingProviders.customCall.vars)).toEqual(variableNames)
    expect(Object.keys(enOnboardingProviders.customCall.vars)).toEqual(variableNames)
    expect(zhOnboardingProviders.customCall.returnContract).not.toHaveLength(0)
    expect(enOnboardingProviders.customCall.returnContract).not.toHaveLength(0)
  })
})
