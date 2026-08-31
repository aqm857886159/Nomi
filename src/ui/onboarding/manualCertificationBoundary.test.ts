import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('manual onboarding certification boundary', () => {
  it('delegates credential activation to the main-process policy', () => {
    for (const file of [
      'src/ui/onboarding/KnownVendorKeyConnectPage.tsx',
      'src/ui/onboarding/VendorOnboardCard.tsx',
    ]) {
      const source = read(file)
      expect(source).toContain('upsertVendorApiKey')
      expect(source).toContain('enabled: true')
      expect(source).toContain('saved?.enabled === true')
    }
    const custom = read('src/ui/onboarding/CustomVendorManage.tsx')
    expect(custom).toContain('upsertVendorApiKey')
    expect(custom).toContain('enabled: false')
    expect(custom).not.toMatch(/upsertVendorApiKey\([\s\S]{0,180}enabled:\s*true/)
  })

  it('creates ComfyUI instances as disabled candidates and routes workflow import to handoff', () => {
    const add = read('src/ui/onboarding/AddComfyuiInstanceButton.tsx')
    const card = read('src/ui/onboarding/ComfyuiLocalCard.tsx')
    const templateLibrary = read('src/ui/onboarding/ComfyuiTemplateLibrary.tsx')
    const presetSection = read('src/ui/onboarding/ComfyuiPresetSection.tsx')
    expect(add).toContain('enabled: false')
    expect(add).not.toMatch(/upsertVendor\([\s\S]{0,220}enabled:\s*true/)
    expect(card).toContain('<ComfyuiWorkflowImportPanel')
    expect(card).toContain('onVerificationRequested={onVerificationRequested}')
    for (const source of [templateLibrary, presetSection]) {
      expect(source).toContain('integrationSessionPrepareComfy')
      expect(source).not.toContain('importComfyWorkflow(')
    }
  })
})
