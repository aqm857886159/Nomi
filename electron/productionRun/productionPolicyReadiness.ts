import type { AutomationPolicy, ProductionJob } from './productionRunTypes'

export type ProductionPolicyProviderModel = {
  provider: string
  model: string
}

export type ProductionPolicyReadiness = {
  ready: boolean
  issueCount: number
  requiredProviderModels: ProductionPolicyProviderModel[]
  missingProviders: string[]
  missingModels: string[]
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

export function evaluateProductionPolicyReadiness(
  policy: Pick<AutomationPolicy, 'allowedProviders' | 'allowedModels'>,
  jobs: readonly Pick<ProductionJob, 'provider' | 'model'>[],
): ProductionPolicyReadiness {
  const requiredProviderModels = jobs
    .map((job) => ({ provider: job.provider.trim(), model: job.model.trim() }))
    .filter((item) => item.provider && item.model)
    .filter((item, index, values) => values.findIndex((candidate) =>
      candidate.provider === item.provider && candidate.model === item.model) === index)
  const requiredProviders = unique(requiredProviderModels.map((item) => item.provider))
  const requiredModels = unique(requiredProviderModels.map((item) => item.model))
  const missingProviders = requiredProviders.filter((provider) => !policy.allowedProviders.includes(provider))
  const missingModels = requiredModels.filter((model) => !policy.allowedModels.includes(model))
  const issueCount = missingProviders.length + missingModels.length

  return {
    ready: issueCount === 0,
    issueCount,
    requiredProviderModels,
    missingProviders,
    missingModels,
  }
}

export class ProductionPolicyIncompleteError extends Error {
  readonly readiness: ProductionPolicyReadiness

  constructor(readiness: ProductionPolicyReadiness) {
    const issues = [
      ...(readiness.missingProviders.length
        ? [`供应商「${readiness.missingProviders.join('、')}」未接入`]
        : []),
      ...(readiness.missingModels.length
        ? [`模型「${readiness.missingModels.join('、')}」未接入或不可用`]
        : []),
    ]
    super(`制作合同暂不能批准：${issues.join('；')}`)
    this.name = 'ProductionPolicyIncompleteError'
    this.readiness = readiness
  }
}

export function assertProductionPolicyReady(
  policy: Pick<AutomationPolicy, 'allowedProviders' | 'allowedModels'>,
  jobs: readonly Pick<ProductionJob, 'provider' | 'model'>[],
): void {
  const readiness = evaluateProductionPolicyReadiness(policy, jobs)
  if (!readiness.ready) throw new ProductionPolicyIncompleteError(readiness)
}
