import type { Dispatcher } from "undici";
import type { Vendor } from "./catalog/types";
import { createExplicitProxyDispatcher, normalizeExplicitProxyUrl } from "./systemProxy";

/** Optional network route stored with one provider connection, not application-global. */
export type ProviderNetworkConfig = { proxyUrl?: string };

export function normalizeProviderProxyUrl(raw: string | null | undefined): string {
  return normalizeExplicitProxyUrl(raw);
}

export function providerProxyUrl(vendor: Pick<Vendor, "network">): string | undefined {
  if (vendor.network?.proxyEnabled === false) return undefined;
  const raw = vendor.network?.proxyUrl;
  const normalized = normalizeProviderProxyUrl(raw);
  return normalized || undefined;
}

export function providerDispatcher(vendor: Pick<Vendor, "network">): Dispatcher | undefined {
  const proxyUrl = providerProxyUrl(vendor);
  return proxyUrl ? createExplicitProxyDispatcher(proxyUrl) : undefined;
}
