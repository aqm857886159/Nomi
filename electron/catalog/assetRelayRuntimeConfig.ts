export const DEFAULT_NOMI_ASSET_RELAY_URL = "https://nomi-asset-relay.2373272608.workers.dev/v1/assets";

export type AssetRelayRuntimeConfig = {
  endpoint: string;
  token: string;
  source: "default" | "custom" | "environment";
};

let customConfig: { endpoint: string; token: string } | null = null;

export function setAssetRelayRuntimeConfig(endpoint: string, token: string): void {
  const normalizedEndpoint = endpoint.trim();
  const normalizedToken = token.trim();
  customConfig = normalizedEndpoint ? { endpoint: normalizedEndpoint, token: normalizedToken } : null;
}

export function readAssetRelayRuntimeConfig(): AssetRelayRuntimeConfig {
  const endpoint = String(process.env.NOMI_ASSET_RELAY_URL || "").trim();
  if (endpoint) {
    return { endpoint, token: String(process.env.NOMI_ASSET_RELAY_TOKEN || "").trim(), source: "environment" };
  }
  if (customConfig) return { ...customConfig, source: "custom" };
  return { endpoint: DEFAULT_NOMI_ASSET_RELAY_URL, token: "", source: "default" };
}

export function readDefaultAssetRelayRuntimeConfig(): AssetRelayRuntimeConfig {
  return { endpoint: DEFAULT_NOMI_ASSET_RELAY_URL, token: "", source: "default" };
}
