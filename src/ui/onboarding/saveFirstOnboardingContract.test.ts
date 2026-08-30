import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (name: string): string => fs.readFileSync(path.join(process.cwd(), 'src/ui/onboarding', name), 'utf8')
const walkthrough = (name: string): string => fs.readFileSync(path.join(process.cwd(), 'scripts', name), 'utf8')

describe('save-first gateway onboarding contract', () => {
  it('never binds model-list retrieval to field blur', () => {
    const wizard = source('OnboardingWizard.tsx')

    expect(wizard).not.toContain('maybeAutoFetchModels')
    expect(wizard).not.toContain('autoFetchSigRef')
    expect(wizard).not.toMatch(/onBlur=\{[^}]*handleFetchModels/)
    expect(wizard).toContain('onClick={handleFetchModels}')
  })

  it('starts canonical certification when selected models are confirmed', () => {
    const wizard = source('OnboardingWizard.tsx')

    expect(wizard).toContain('bridge.onboarding.httpCertificationStartExisting({')
    expect(wizard).toContain("entryPoint: 'manual-ui'")
    expect(wizard).toContain('onCertificationStarted(res.run)')
    expect(wizard).not.toContain('adapterRegisterExisting(')
    expect(wizard).not.toContain('adapterAdaptExisting(')
    expect(wizard).not.toContain('if (onCommitted) onCommitted(res.registration)')
  })

  it('opens the canonical verification task instead of treating registration as completed', () => {
    const wizard = source('OnboardingWizard.tsx')
    const drawer = source('OnboardingDrawer.tsx')

    expect(wizard).toContain('onCertificationStarted(res.run)')
    expect(drawer).toContain('const handleCertificationStarted')
    expect(drawer).toContain('recordAdapterRun(run)')
    expect(drawer).toContain("openModelSettingsPage(current, { type: 'verification', runId: run.id })")
    expect(drawer).toContain('onCertificationStarted={handleCertificationStarted}')
    expect(drawer).not.toContain('handleRegistrationCommitted')
  })

  it('saves the connection before any model is selected or discovered', () => {
    const wizard = source('OnboardingWizard.tsx')

    expect(wizard).toContain('const saveConnection = React.useCallback')
    expect(wizard).toContain('bridge.onboarding.httpConnectionConfigure({')
    expect(wizard).toContain('models: []')
    expect(wizard).toContain('data-model-connection-saved')
    expect(wizard).toContain("t('modelSetup.fetchModels')")
    expect(wizard).toContain("t('modelSetup.manualEnter')")
    expect(wizard).not.toContain('forceSaveArmed')
    expect(wizard).not.toContain('manualSaveAction')
    expect(wizard).not.toContain('resolvePrecheckGateAction')
  })

  it('keeps connection testing optional and gives each setup state one primary action', () => {
    const wizard = source('OnboardingWizard.tsx')

    expect(wizard).toContain('data-model-connection-diagnostics')
    expect(wizard).toContain("t('modelSetup.diagnostics')")
    expect(wizard).toMatch(/variant="light"\s+onClick=\{handleTestConnection\}/)
    expect(wizard).toMatch(/variant="light"\s+onClick=\{\(\) => setScreen\('select'\)\}/)
    expect(wizard).toMatch(/variant="filled"\s+onClick=\{handleFetchModels\}/)
  })

  it('offers manual model IDs before any list request and discloses immediate certification work', () => {
    const wizard = source('OnboardingWizard.tsx')
    const picker = source('ModelPickerScreen.tsx')

    expect(wizard).toContain("t('modelSetup.manualEnter')")
    expect(picker).toContain('data-model-picker-save-disclosure')
    expect(picker).toContain("t('onboardingProviders.modelControls.saveModelsDisclosure')")
    expect(wizard).toContain('confirming={saving}')
  })

  it('continues model certification through the saved main-process connection', () => {
    const wizard = source('OnboardingWizard.tsx')

    expect(wizard).toContain('const savedVendorKey = savedConnection?.vendorKey')
    expect(wizard).toContain('httpCertificationStartExisting({')
    expect(wizard).toContain('onConnectionConfigured?.(res.registration)')
  })

  it('never exposes the removed direct provider-adapter completion callbacks', () => {
    const wizard = source('OnboardingWizard.tsx')
    const bridge = fs.readFileSync(path.join(process.cwd(), 'src/desktop/onboardingBridgeTypes.ts'), 'utf8')

    expect(wizard).not.toContain('onCommitted')
    expect(wizard).not.toContain('onConnectionSaved')
    expect(bridge).not.toContain('adapterRegisterExisting')
    expect(bridge).not.toContain('adapterAdaptExisting')
  })

  it('keeps the real onboarding walkthroughs on the canonical certification bridge', () => {
    const scripts = [
      walkthrough('settings-model-access-save-first-walkthrough.mjs'),
      walkthrough('settings-existing-connection-add-walkthrough.mjs'),
    ].join('\n')

    expect(scripts).toContain('certificationList')
    expect(scripts).toContain('httpConnectionListModels')
    expect(scripts).not.toContain('adapterList')
    expect(scripts).not.toContain('existingConnectionListModels')
    expect(scripts).not.toMatch(/保存 \d+ 个模型/)
    expect(scripts).not.toContain('Saving models made an unexpected upstream request')
  })

  it('routes manual ComfyUI import, edit, and test through the persistent integration session', () => {
    const importPanel = source('ComfyuiWorkflowImportPanel.tsx')
    const settingsPage = fs.readFileSync(
      path.join(process.cwd(), 'src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx'),
      'utf8',
    )
    const productionSurfaces = `${importPanel}\n${settingsPage}`

    expect(importPanel).toContain('integrationSessionPrepareComfy')
    expect(settingsPage).toContain('integrationSessionPrepareComfy')
    expect(productionSurfaces).not.toContain('runTestGeneration')
    expect(productionSurfaces).not.toContain('importComfyWorkflow(')
    expect(productionSurfaces).not.toContain('updateComfyWorkflow(')
    expect(productionSurfaces).not.toContain('mintSpendGrant')
  })
})
