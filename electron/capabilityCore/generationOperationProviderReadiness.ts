/**
 * A provider identity as exposed by the runtime bootstrap.  Keeping this
 * structural avoids coupling the readiness projection to a concrete provider
 * implementation (and makes the rule easy to exercise without Electron).
 */
export type GenerationProviderIdentity = Readonly<{ providerId: string }>

export type GenerationOperationProviderRequirements = Readonly<{
  /** Providers required by every included generation unit in submission order. */
  providerIds: readonly string[]
  /** Included units that have no sealed/candidate provider identity. */
  unresolvedShotIds: readonly string[]
}>

/**
 * The readiness projection intentionally consumes only provider identities,
 * rather than the full candidate/contract objects.  This keeps it usable by
 * both the durable Operation adapter and restart/recovery projections, while
 * malformed snapshots fail closed instead of throwing during a status check.
 */
export type GenerationOperationProviderShape = Readonly<{
  contract?: Readonly<{ providerId?: unknown }> | null
  shots?: readonly Readonly<{
    shotId: string
    included?: boolean
    candidate?: Readonly<{ providerId?: unknown }> | null
    contract?: Readonly<{ providerId?: unknown }> | null
  }>[]
}>

/**
 * Derive the provider set for a generation start from the units that the
 * scheduler can actually submit.  The top-level contract is only a fallback
 * for the legacy single-shot shape; a semantic multi-shot plan is checked per
 * included shot.  This matters when shot 1 is an image anchor: looking only at
 * `operation.contract.providerId` can report the wrong provider and either
 * block a valid video batch or let an unconfigured video provider through.
 */
export function generationOperationProviderRequirements(
  operation: GenerationOperationProviderShape,
  /** Durable job providers are supplied by recovery callers; live starts omit this. */
  additionalProviderIds: readonly unknown[] = [],
): GenerationOperationProviderRequirements {
  const providerIds = new Set<string>()
  const unresolvedShotIds: string[] = []
  const includedShots = (operation.shots ?? []).filter((shot) => shot.included !== false)

  if (includedShots.length > 0) {
    for (const shot of includedShots) {
      const providerId = shot.contract?.providerId ?? shot.candidate?.providerId
      if (typeof providerId === 'string' && providerId.trim()) {
        providerIds.add(providerId.trim())
      } else {
        unresolvedShotIds.push(shot.shotId)
      }
    }
  } else {
    const providerId = operation.contract?.providerId
    if (typeof providerId === 'string' && providerId.trim()) providerIds.add(providerId.trim())
  }

  // A restarted Run may have jobs whose sealed shot projection is older than
  // the current in-memory operation. Include those provider namespaces too so
  // recovery cannot silently proceed with only the first candidate's adapter.
  for (const providerId of additionalProviderIds) {
    if (typeof providerId === 'string' && providerId.trim()) providerIds.add(providerId.trim())
  }

  return {
    providerIds: [...providerIds],
    unresolvedShotIds,
  }
}

/**
 * Return the provider identities that are not present in the bootstrap.  A
 * malformed included shot (without either a sealed contract or candidate
 * provider) is represented by its shot id so callers fail closed instead of
 * claiming readiness for a partial plan.
 */
export function missingGenerationOperationProviders(
  operation: GenerationOperationProviderShape,
  providers: readonly GenerationProviderIdentity[],
  additionalProviderIds: readonly unknown[] = [],
): string[] {
  const requirements = generationOperationProviderRequirements(operation, additionalProviderIds)
  const configured = new Set(
    providers
      .map((provider) => provider.providerId)
      .filter((providerId): providerId is string => typeof providerId === 'string' && providerId.trim().length > 0)
      .map((providerId) => providerId.trim()),
  )
  return [
    ...requirements.unresolvedShotIds.map((shotId) => `shot:${shotId}`),
    ...requirements.providerIds.filter((providerId) => !configured.has(providerId)),
  ]
}

export function hasGenerationOperationProviderReadiness(
  operation: GenerationOperationProviderShape,
  providers: readonly GenerationProviderIdentity[],
  additionalProviderIds: readonly unknown[] = [],
): boolean {
  const requirements = generationOperationProviderRequirements(operation, additionalProviderIds)
  return requirements.providerIds.length > 0 && missingGenerationOperationProviders(operation, providers, additionalProviderIds).length === 0
}
