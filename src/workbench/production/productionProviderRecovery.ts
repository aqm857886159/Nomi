import type { ProductionRun } from '../../../electron/productionRun/productionRunTypes'
import type { ModelOption } from '../../config/models'
import { deriveCanonicalModelId, vendorTier } from '../../config/modelIdentity'
import {
  listWorkbenchModelCatalogModels,
  listWorkbenchModelCatalogVendors,
  type ModelCatalogModelDto,
  type ModelCatalogVendorDto,
} from '../api/modelCatalogApi'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'

export type ProductionProviderReplacement = {
  jobId: string
  provider: string
  model: string
}

export type ProductionProviderReplacementCandidate = {
  id: string
  provider: string
  model: string
  providerLabel: string
  modelLabel: string
  label: string
  replacements: ProductionProviderReplacement[]
}

export type ProductionProviderReplacementPlan = {
  failedProvider: string
  replacementProvider: string
  replacementProviderLabel: string
  affectedCount: number
  replacements: ProductionProviderReplacement[]
  candidates: ProductionProviderReplacementCandidate[]
}

export function buildProductionProviderLabels(
  vendors: readonly Pick<ModelCatalogVendorDto, 'key' | 'name'>[],
): Record<string, string> {
  return Object.fromEntries(vendors.flatMap((vendor) => {
    const key = vendor.key.trim().toLowerCase()
    const name = vendor.name.trim()
    return key && name ? [[key, name]] : []
  }))
}

export async function resolveProductionProviderLabels(): Promise<Record<string, string>> {
  try {
    return buildProductionProviderLabels(await listWorkbenchModelCatalogVendors())
  } catch {
    return {}
  }
}

const REPLACEABLE_STATUSES = new Set([
  'authorization_required',
  'authorized',
  'not_dispatched',
  'needs_attention',
])

function rowOption(row: ModelCatalogModelDto): ModelOption {
  return {
    value: row.modelKey,
    label: row.labelZh,
    vendor: row.vendorKey,
    modelKey: row.modelKey,
    modelAlias: row.modelAlias,
    meta: row.meta,
  }
}

function usableVendorKeys(vendors: readonly ModelCatalogVendorDto[]): Set<string> {
  return new Set(vendors
    .filter((vendor) => vendor.enabled && (vendor.authType === 'none' || vendor.hasApiKey))
    .map((vendor) => vendor.key))
}

function replacementCandidates(
  provider: string,
  model: string,
  rows: readonly ModelCatalogModelDto[],
  usable: ReadonlySet<string>,
  allowedProviders: ReadonlySet<string>,
): ModelCatalogModelDto[] {
  const current = rows.find((row) => row.vendorKey === provider && (row.modelKey === model || row.modelAlias === model))
  const canonical = current ? deriveCanonicalModelId(rowOption(current)) : ''
  return rows
    .filter((row) => row.enabled && row.vendorKey !== provider && usable.has(row.vendorKey))
    .filter((row) => {
      if (row.modelKey === model || row.modelAlias === model) return true
      return Boolean(canonical) && deriveCanonicalModelId(rowOption(row)) === canonical
    })
    .sort((left, right) => {
      const score = (row: ModelCatalogModelDto) => {
        const alreadyAllowed = allowedProviders.has(row.vendorKey) ? 0 : 2
        const exactModel = row.modelKey === model || row.modelAlias === model ? 0 : 1
        return alreadyAllowed + exactModel
      }
      return score(left) - score(right) || vendorTier(left.vendorKey) - vendorTier(right.vendorKey)
    })
}

export function buildProductionProviderReplacementPlan(input: {
  run: ProductionRun
  nodes: readonly GenerationCanvasNode[]
  models: readonly ModelCatalogModelDto[]
  vendors: readonly ModelCatalogVendorDto[]
}): ProductionProviderReplacementPlan | null {
  const blocker = input.run.jobs.find((job) => job.status === 'not_dispatched' && !job.providerTaskId)
  if (!blocker) return null
  const affected = input.run.jobs.filter((job) =>
    job.provider === blocker.provider &&
    job.model === blocker.model &&
    !job.providerTaskId &&
    REPLACEABLE_STATUSES.has(job.status),
  )
  if (affected.length === 0) return null
  const candidateRows = replacementCandidates(
    blocker.provider,
    blocker.model,
    input.models,
    usableVendorKeys(input.vendors),
    new Set(input.run.policy.allowedProviders),
  )
  if (candidateRows.length === 0) return null
  const candidates = candidateRows.map((candidate) => {
    const providerLabel = input.vendors.find((vendor) => vendor.key === candidate.vendorKey)?.name || candidate.vendorKey
    const modelLabel = candidate.labelZh || candidate.modelKey
    return {
      id: `${candidate.vendorKey}\u0000${candidate.modelKey}`,
      provider: candidate.vendorKey,
      model: candidate.modelKey,
      providerLabel,
      modelLabel,
      label: `${providerLabel} · ${modelLabel}`,
      replacements: affected.map((job) => ({ jobId: job.jobId, provider: candidate.vendorKey, model: candidate.modelKey })),
    }
  })
  const recommended = candidates[0]
  return {
    failedProvider: blocker.provider,
    replacementProvider: recommended.provider,
    replacementProviderLabel: recommended.label,
    affectedCount: affected.length,
    replacements: recommended.replacements,
    candidates,
  }
}

export async function resolveProductionProviderReplacementPlan(
  run: ProductionRun,
  nodes: readonly GenerationCanvasNode[],
): Promise<ProductionProviderReplacementPlan | null> {
  const [models, vendors] = await Promise.all([
    listWorkbenchModelCatalogModels({ enabled: true }),
    listWorkbenchModelCatalogVendors(),
  ])
  return buildProductionProviderReplacementPlan({ run, nodes, models, vendors })
}
