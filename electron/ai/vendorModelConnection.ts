import { extractVendorExtraHeaders, normalizeProviderKind } from '../catalog/catalogStore';
import type { Model, Vendor } from '../catalog/types';

function resolveSdkBaseUrl(vendor: Vendor): string {
  const base = (vendor.baseUrlHint || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error(`Base URL missing: ${vendor.key}`);
  try {
    const url = new URL(base);
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/v1';
      return url.toString();
    }
  } catch {
    // Keep the configured value so the existing request/configuration error remains authoritative.
  }
  return base;
}

/** Catalog connection rules shared by pi Agent and the non-Agent AI4 tasks. */
export function vendorModelConnection(vendor: Vendor, model: Model, apiKey: string) {
  const kind = normalizeProviderKind(vendor.providerKind);
  const headers = extractVendorExtraHeaders(vendor);
  return {
    kind,
    baseURL: kind === 'anthropic'
      ? (vendor.baseUrlHint || '').trim() || 'https://api.anthropic.com/v1'
      : resolveSdkBaseUrl(vendor),
    apiKey,
    authType: vendor.authType,
    modelId: (model.modelAlias || model.modelKey).trim(),
    ...(headers ? { headers } : {}),
  };
}
