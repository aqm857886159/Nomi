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
const guardSource = fs.readFileSync(path.join(process.cwd(), 'src/workbench/production/productionBudgetGuard.ts'), 'utf8')

describe('production budget UX structure', () => {
  it('turns an unset hard budget into a direct settings action', () => {
    expect(dialogSource).toContain('missingHardBudget')
    expect(dialogSource).toContain('openBudgetSettings')
    expect(dialogSource).toContain('pending.onOpenBudgetSettings')
    expect(guardSource).toContain("section: 'hard-budget'")
  })

  it('labels the unset ceiling instead of showing an unexplained icon', () => {
    expect(summarySource).toContain('data-production-hard-budget')
    expect(summarySource).toContain('production.contract.notSet')
  })
})
