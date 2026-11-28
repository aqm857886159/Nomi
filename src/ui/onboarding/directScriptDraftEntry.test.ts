import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (name: string): string => fs.readFileSync(path.join(process.cwd(), 'src/ui/onboarding', name), 'utf8')

describe('direct custom-call onboarding entry', () => {
  it('uses one isolated draft form and never invokes discovery or verification services', () => {
    const form = source('DirectScriptDraftForm.tsx')
    const mainDraft = fs.readFileSync(path.join(process.cwd(), 'electron/catalog/customCallDraft.ts'), 'utf8')

    expect(form).toContain('customCallDraftCreate')
    expect(form).toContain('authType: noApiKey ? \'none\' : \'bearer\'')
    expect(form).not.toContain('listModels')
    expect(form).not.toContain('fetchDocs')
    expect(form).not.toContain('adapterStart')
    expect(form).not.toContain('testConnection')
    expect(form).not.toContain('runWorkbenchTextTask')
    expect(mainDraft).toContain('customCallOnly: true')
  })

  it('offers one entry under other connection ways and opens the shared script workspace in a model dialog', () => {
    const wizard = source('OnboardingWizard.tsx')
    const drawer = source('OnboardingDrawer.tsx')
    const home = source('ModelSettingsHome.tsx')

    expect(home).not.toContain('data-model-home-direct-script')
    expect(source('ModelSettingsWorkspacePages.tsx')).toContain('data-model-home-direct-script')
    expect(drawer).toContain("onDirectScript={() => openWizard(undefined, undefined, 'scriptDraft')}")
    expect(wizard).toContain('<DirectScriptDraftForm')
    expect(wizard).toContain("initialScreen?: 'form' | 'scriptDraft'")
    expect(wizard).not.toContain('<DirectScriptDraftEntry')
    expect(drawer).toContain('onDirectScriptDraftCreated=')
    expect(drawer).toContain('openModelSettingsDialogPage(')
    expect(drawer).toContain("{ type: 'script', vendorKey: identity.vendorKey, modelKey: identity.modelKey }")
    expect(drawer).toContain('draft: true')
    expect(drawer).not.toContain('directScriptModal')
    // 打开面板探一次的「连接健康」整个删了（D-1117-delete-verification），草稿脚本连接也就没有要跳过的探测。
    expect(drawer).not.toContain('skipHealthProbe')
    expect(fs.existsSync(path.join(process.cwd(), 'src/ui/onboarding/useVendorHealth.ts'))).toBe(false)
  })

  it('keeps a draft disabled on cancel and delegates save-and-enable to main', () => {
    const editor = source('CustomCallEditor.tsx')
    const lock = source('adapterVerificationViewModel.ts')

    expect(editor).toContain('target.draft')
    expect(editor).toContain('customCallDraftFinalize')
    expect(lock).toContain('customCallDraft')
  })
})
