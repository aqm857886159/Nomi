import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const dialogSource = fs.readFileSync(
  path.join(process.cwd(), 'src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx'),
  'utf8',
)
const summarySource = fs.readFileSync(
  path.join(process.cwd(), 'src/workbench/generationCanvas/spend/ProductionContractSummary.tsx'),
  'utf8',
)
const recoverySource = fs.readFileSync(path.join(process.cwd(), 'src/workbench/production/productionPolicyRecovery.ts'), 'utf8')
const settingsSource = fs.readFileSync(path.join(process.cwd(), 'src/workbench/settings/AiModelsSection.tsx'), 'utf8')

describe('production policy UX structure', () => {
  it('turns every incomplete policy into one direct settings action', () => {
    expect(dialogSource).toContain('incompletePolicy')
    expect(dialogSource).toContain('missingPolicyProviders')
    expect(dialogSource).toContain('missingPolicyModels')
    expect(dialogSource).toContain('pending.onOpenPolicySettings')
    expect(recoverySource).toContain("section: 'production-policy'")
  })

  it('labels the unset ceiling and exact provider/model policy status', () => {
    expect(summarySource).toContain('data-production-hard-budget')
    expect(summarySource).toContain('data-production-provider-model-status')
    expect(summarySource).toContain('production.contract.notSet')
  })

  it('marks the exact Run requirements in the shared settings block', () => {
    expect(settingsSource).toContain('data-production-policy-context')
    expect(settingsSource).toContain('data-production-policy-required')
    expect(settingsSource).toContain('data-settings-field="production-provider"')
    expect(settingsSource).toContain('data-settings-field="production-model"')
    expect(settingsSource).toContain('data-production-policy-unavailable')
    expect(settingsSource).toContain('onOpenModelCatalog')
  })
})
