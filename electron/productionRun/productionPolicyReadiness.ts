import type { AutomationPolicy, ProductionJob } from './productionRunTypes'

export type ProductionPolicyProviderModel = {
  provider: string
  model: string
}

export type ProductionPolicyReadiness = {
  ready: boolean
  issueCount: number
  missingHardBudget: boolean
  requiredProviderModels: ProductionPolicyProviderModel[]
  missingProviders: string[]
  missingModels: string[]
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

export function evaluateProductionPolicyReadiness(
  policy: Pick<AutomationPolicy, 'maxSpend' | 'allowedProviders' | 'allowedModels'>,
  jobs: readonly Pick<ProductionJob, 'provider' | 'model'>[],
): ProductionPolicyReadiness {
  const requiredProviderModels = jobs
    .map((job) => ({ provider: job.provider.trim(), model: job.model.trim() }))
    .filter((item) => item.provider && item.model)
    .filter((item, index, values) => values.findIndex((candidate) =>
      candidate.provider === item.provider && candidate.model === item.model) === index)
  const requiredProviders = unique(requiredProviderModels.map((item) => item.provider))
  const requiredModels = unique(requiredProviderModels.map((item) => item.model))
  const missingHardBudget = typeof policy.maxSpend !== 'number' || !Number.isFinite(policy.maxSpend) || policy.maxSpend < 0
  const missingProviders = requiredProviders.filter((provider) => !policy.allowedProviders.includes(provider))
  const missingModels = requiredModels.filter((model) => !policy.allowedModels.includes(model))
  const issueCount = Number(missingHardBudget) + missingProviders.length + missingModels.length

  return {
    ready: issueCount === 0,
    issueCount,
    missingHardBudget,
    requiredProviderModels,
    missingProviders,
    missingModels,
  }
}

export class ProductionPolicyIncompleteError extends Error {
  readonly readiness: ProductionPolicyReadiness

  constructor(readiness: ProductionPolicyReadiness) {
    const issues = [
      ...(readiness.missingHardBudget ? ['未设置硬预算上限'] : []),
      ...(readiness.missingProviders.length
        ? [`供应商「${readiness.missingProviders.join('、')}」未加入白名单`]
        : []),
      ...(readiness.missingModels.length
        ? [`模型「${readiness.missingModels.join('、')}」未加入白名单`]
        : []),
    ]
    super(`制作合同暂不能批准：${issues.join('；')}`)
    this.name = 'ProductionPolicyIncompleteError'
    this.readiness = readiness
  }
}

export function assertProductionPolicyReady(
  policy: Pick<AutomationPolicy, 'maxSpend' | 'allowedProviders' | 'allowedModels'>,
  jobs: readonly Pick<ProductionJob, 'provider' | 'model'>[],
): void {
  const readiness = evaluateProductionPolicyReadiness(policy, jobs)
  if (!readiness.ready) throw new ProductionPolicyIncompleteError(readiness)
}
