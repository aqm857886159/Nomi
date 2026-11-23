import type { AssetIngestion } from './types'

export type AssetTransportVisibility = 'provider-private' | 'public-provider' | 'public-anonymous'

export function ingestionVisibility(ingestion: AssetIngestion): AssetTransportVisibility {
  return ingestion.visibility || (ingestion.strategy === 'anon-chain' ? 'public-anonymous' : 'provider-private')
}
