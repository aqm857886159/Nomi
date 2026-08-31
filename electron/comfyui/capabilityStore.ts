import { comfyuiEndpoint, normalizeComfyuiBaseUrl } from "./endpointResolver";

export type ComfyuiCapabilitySnapshot = {
  baseUrl: string;
  reachable: boolean;
  featuresEndpoint: boolean;
  supportsPreviewMetadata: boolean;
  checkedAt: number;
};

const TTL_MS = 60_000;
const cache = new Map<string, ComfyuiCapabilitySnapshot>();
const inFlight = new Map<string, Promise<ComfyuiCapabilitySnapshot>>();

function legacySnapshot(baseUrl: string, reachable: boolean): ComfyuiCapabilitySnapshot {
  return { baseUrl, reachable, featuresEndpoint: false, supportsPreviewMetadata: false, checkedAt: Date.now() };
}

/** `/features` 是能力事实；404/异形表示可达的兼容模式，网络失败才表示不可达。 */
export async function getComfyuiCapabilities(baseUrl: string, force = false): Promise<ComfyuiCapabilitySnapshot> {
  const base = normalizeComfyuiBaseUrl(baseUrl);
  const cached = cache.get(base);
  if (!force && cached && Date.now() - cached.checkedAt < TTL_MS) return cached;
  const pending = inFlight.get(base);
  if (pending) return pending;

  const request = (async (): Promise<ComfyuiCapabilitySnapshot> => {
    try {
      const response = await fetch(comfyuiEndpoint(base, "features"), { signal: AbortSignal.timeout(3500) });
      // 收到任何 HTTP 响应都证明实例可达；只有 2xx JSON 才声明增强能力，其余保守回落兼容模式。
      if (!response.ok) return legacySnapshot(base, true);
      const json = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!json || typeof json !== "object" || Array.isArray(json)) return legacySnapshot(base, true);
      return {
        baseUrl: base,
        reachable: true,
        featuresEndpoint: true,
        supportsPreviewMetadata: json.supports_preview_metadata === true,
        checkedAt: Date.now(),
      };
    } catch {
      return legacySnapshot(base, false);
    }
  })();
  inFlight.set(base, request);
  try {
    const snapshot = await request;
    cache.set(base, snapshot);
    return snapshot;
  } finally {
    if (inFlight.get(base) === request) inFlight.delete(base);
  }
}

export function resetComfyuiCapabilitiesForTest(): void {
  cache.clear();
  inFlight.clear();
}
