import type { ProductionGate, ProductionRun } from '../../../../electron/productionRun/productionRunTypes'
import {
  evaluateProductionPolicyReadiness,
  type ProductionPolicyReadiness,
} from '../../../../electron/productionRun/productionPolicyReadiness'

export type ProductionContractView = {
  planVersion: number
  planHash: string
  specs: {
    durationSeconds: number | null
    aspectRatio: string | null
    language: string | null
    shotCount: number | null
  }
  claims: Array<{ text: string; evidenceCount: number; verified: boolean }>
  skills: Array<{ name: string; version: string }>
  providerModels: Array<{ provider: string; providerLabel: string; model: string }>
  policy: ProductionPolicyReadiness
  maxAttemptsPerJob: number
  cost: {
    known: boolean
    currency: string
    minimum: number | null
    maximum: number | null
    hardLimit: number | null
  }
  requiresSeparateIrreversibleApproval: true
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function buildProductionContractView(
  run: ProductionRun,
  gate: ProductionGate,
  options: { providerLabels?: Readonly<Record<string, string>> } = {},
): ProductionContractView {
  const contract = gate.contract
  const evidenceIds = new Set((contract?.evidence ?? []).map((item) => item.evidenceId))
  const jobs = gate.jobIds
    .map((jobId) => run.jobs.find((job) => job.jobId === jobId))
    .filter((job): job is NonNullable<typeof job> => Boolean(job))
  const policy = evaluateProductionPolicyReadiness(run.policy, jobs)
  const minimum = finiteNonNegative(contract?.estimatedCost?.minimum)
  const maximum = finiteNonNegative(contract?.estimatedCost?.maximum)
  const known = minimum !== null && maximum !== null && minimum <= maximum

  return {
    planVersion: run.planVersion,
    planHash: gate.planHash,
    specs: {
      durationSeconds: finiteNonNegative(contract?.specs.durationSeconds),
      aspectRatio: contract?.specs.aspectRatio?.trim() || null,
      language: contract?.specs.language?.trim() || null,
      shotCount: finiteNonNegative(contract?.specs.shotCount),
    },
    claims: (contract?.claims ?? []).map((claim) => {
      const matched = claim.evidenceIds.filter((evidenceId) => evidenceIds.has(evidenceId))
      return {
        text: claim.text,
        evidenceCount: matched.length,
        verified: claim.evidenceIds.length > 0 && matched.length === claim.evidenceIds.length,
      }
    }),
    skills: contract?.skills ?? [],
    providerModels: policy.requiredProviderModels.map((item) => ({
      ...item,
      providerLabel: options.providerLabels?.[item.provider]
        ?? options.providerLabels?.[item.provider.toLowerCase()]
        ?? item.provider,
    })),
    policy,
    maxAttemptsPerJob: run.policy.maxAttemptsPerJob,
    cost: {
      known,
      currency: contract?.estimatedCost?.currency?.trim() || run.budget.currency,
      minimum: known ? minimum : null,
      maximum: known ? maximum : null,
      hardLimit: finiteNonNegative(run.policy.maxSpend),
    },
    requiresSeparateIrreversibleApproval: true,
  }
}
