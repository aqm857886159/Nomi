import type { ProductionPolicyReadiness } from '../../../electron/productionRun/productionPolicyReadiness'

export type ProductionPolicyRequirement = Pick<ProductionPolicyReadiness, 'requiredProviderModels'>

export type ProductionPolicySettingsTarget = {
  tab: 'ai'
  section: 'production-policy'
  productionPolicy: ProductionPolicyRequirement
}

export function buildProductionPolicySettingsTarget(
  readiness: ProductionPolicyReadiness,
): ProductionPolicySettingsTarget {
  return {
    tab: 'ai',
    section: 'production-policy',
    productionPolicy: {
      requiredProviderModels: readiness.requiredProviderModels.map((item) => ({ ...item })),
    },
  }
}

export function isProductionPolicyError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return /productionpolicyincomplete|制作合同暂不能批准|production contract policy|production approval requires.*(?:budget|provider|model)/i.test(message)
}
