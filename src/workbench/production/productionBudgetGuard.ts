export const PRODUCTION_BUDGET_SETTINGS_TARGET = {
  tab: 'ai',
  section: 'hard-budget',
} as const

/** The service intentionally refuses paid production without an explicit ceiling. */
export function isMissingHardBudgetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /制作合同暂不能批准.*硬预算上限|hard\s+(?:production\s+)?budget|hard\s+spend\s+limit/i.test(message)
}
