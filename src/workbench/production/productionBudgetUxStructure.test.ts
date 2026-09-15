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
  it('turns every not-connected provider/model into one direct action: go connect it', () => {
    expect(dialogSource).toContain('incompletePolicy')
    expect(dialogSource).toContain('missingPolicyProviders')
    expect(dialogSource).toContain('missingPolicyModels')
    expect(dialogSource).toContain('pending.onOpenPolicySettings')
    // 2026-09-14：全局白名单已删，「缺」= 没接入 → 深链落到「模型」tab，不再带 requiredProviderModels 去勾框。
    expect(recoverySource).toContain("tab: 'models'")
    expect(recoverySource).not.toContain('production-policy')
  })

  it('labels the unset ceiling and exact provider/model connection status', () => {
    expect(summarySource).toContain('data-production-hard-budget')
    expect(summarySource).toContain('data-production-provider-model-status')
    expect(summarySource).toContain('production.contract.notSet')
  })

  it('no longer hosts a provider/model allowlist in settings', () => {
    for (const marker of [
      'data-production-policy-context',
      'data-production-policy-required',
      'data-settings-field="production-provider"',
      'data-settings-field="production-model"',
      'data-production-policy-unavailable',
      'allowedProviders',
      'allowedModels',
    ]) expect(settingsSource, marker).not.toContain(marker)
  })
})
