import type { AssetIngestion, AssetMediaKind } from './types'

export type AnonymousAssetConsent = 'ask' | 'allow' | 'deny'
export type AssetTransportVisibility = 'provider-private' | 'public-provider' | 'public-anonymous'

export function anonymousConsentFromUnknown(value: unknown): AnonymousAssetConsent {
  return value === 'allow' || value === 'deny' ? value : 'ask'
}

export function canUseAnonymousAssetHosting(consent: AnonymousAssetConsent): boolean {
  return consent === 'allow'
}

export function ingestionVisibility(ingestion: AssetIngestion): AssetTransportVisibility {
  return ingestion.visibility || (ingestion.strategy === 'anon-chain' ? 'public-anonymous' : 'provider-private')
}

/** Minimum URL lifetime we need before handing a reference to a generator. */
export function minimumLeaseSecondsForMedia(kind: AssetMediaKind): number {
  if (kind === 'video') return 45 * 60
  if (kind === 'audio') return 30 * 60
  return 15 * 60
}

export function ingestionHasSufficientLease(ingestion: AssetIngestion, kind: AssetMediaKind): boolean {
  const ttl = ingestion.ttlSeconds
  return typeof ttl !== 'number' || ttl >= minimumLeaseSecondsForMedia(kind)
}
