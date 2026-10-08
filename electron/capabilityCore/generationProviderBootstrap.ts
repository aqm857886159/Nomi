import { apiKeyDecryptStatus, decryptApiKeyRecord } from "../catalog/secrets";
import { readCatalog } from "../catalog/catalogStore";
import type { CatalogState, Vendor } from "../catalog/types";
import { builtinVendorScopeMatches, isBuiltinDirectKeyVendor } from "../catalog/builtinVendorSeeds";
import { hasBuiltinCuratedExecution } from "../catalog/seedBuiltins";
import { isCertificationOwnedConnection } from "../catalog/certificationOwnership";
import type { GenerationProvider } from "./generationRuntimeAdapter";
import { createCatalogGenerationProvider } from "./apimartGenerationProvider";
import type { GenerationProviderReadiness, GenerationProviderReadinessMap } from "./moduleCatalogBootstrap";
import { modelHasPublishedExecution } from "../shared/modelPublication";

export type GenerationProviderBootstrapOptions = {
  connectionResolver?: (vendorKey: string) => { apiKey: string; baseUrl?: string } | null;
  catalogReader?: () => CatalogState;
  fetchImpl?: typeof fetch;
  /**
   * Zero-cost Electron journey seam: keep the catalog's built-in scope and
   * curated mapping intact while routing the decrypted Settings key to a
   * loopback fixture. It is accepted only under the explicit production
   * fixture flag and only for a loopback URL, and it only ever applies to the
   * one vendor named by `NOMI_E2E_FIXTURE_VENDOR`; normal users cannot
   * retarget a provider through this option.
   */
  fixtureBaseUrlOverride?: string;
};

export type GenerationProviderBootstrap = {
  providers: readonly GenerationProvider[];
  readinessByProvider: GenerationProviderReadinessMap;
};

const noRecovery = { submitIdempotency: false, query: false, reconcile: false, cancel: false } as const;

function readiness(providerReady: boolean, capabilities: GenerationProviderReadiness["capabilities"], missingForSubmit?: string[]): GenerationProviderReadiness {
  return { providerReady, capabilities, ...(missingForSubmit?.length ? { missingForSubmit } : {}) };
}

function hasPublishedExecutionForProvider(state: CatalogState, vendorKey: string): boolean {
  // A built-in direct-key row is a code-owned transport. A certification-owned
  // row of the same vendor must be served by the certification adapter
  // instead; treating its published metadata as curated execution would
  // silently take over a connection this executor does not own.
  if (isBuiltinDirectKeyVendor(vendorKey)) return hasBuiltinCuratedExecution(state, vendorKey);
  return state.models.some((model) => model.vendorKey === vendorKey
    && modelHasPublishedExecution(model, { mappings: state.mappings }));
}

function hasSafeDirectKeyScope(state: CatalogState, vendorKey: string): boolean {
  if (!isBuiltinDirectKeyVendor(vendorKey)) return true;
  const vendor = state.vendors.find((candidate) => candidate.key === vendorKey);
  if (!vendor) return false;
  return !isCertificationOwnedConnection(state, vendorKey) && builtinVendorScopeMatches(vendor);
}

/** 夹具只认一家：`NOMI_E2E_FIXTURE_VENDOR`（缺省 apimart）。 */
function fixtureVendorKey(): string {
  return String(process.env.NOMI_E2E_FIXTURE_VENDOR || "apimart").trim() || "apimart";
}

function safeFixtureBaseUrl(value: unknown): string | undefined {
  if (process.env.NOMI_E2E !== "1" || process.env.NOMI_E2E_PRODUCTION_FIXTURE !== "1" || typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function safeFixtureApiKey(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  const value = String(process.env.NOMI_E2E_FIXTURE_API_KEY || '').trim();
  return value || undefined;
}

function credentialIsUsable(state: CatalogState, vendorKey: string): boolean {
  const credential = state.apiKeysByVendor[vendorKey];
  return Boolean(typeof credential?.apiKey === "string"
    && credential.apiKey.trim()
    && credential.enabled === true
    && apiKeyDecryptStatus(credential) === "ok");
}

/**
 * The only main-process boundary that turns a saved credential into a
 * semantic generation provider.
 *
 * ── 为什么它遍历 vendors（BL-1）──────────────────────────────────────────────
 * 这里曾经只有一行 `state.vendors.find(v => v.key === "apimart")`，`providers` 数组
 * 从头到尾只可能有 0 或 1 个元素。用户在设置里接好的 kie / 火山 / Higgsfield /
 * 本地 ComfyUI / 自建中转，在画布节点上按生成能跑，同一个模型交给 Agent 付款卡、
 * 外部 MCP `nomi_start_generation` 或全自动 Run，就在「供应商就绪」这一步停下，
 * 错误码 `configured_provider`——**一个用户明明已经配好的供应商，被告知「没配」**。
 *
 * 判据现在是声明式的、与供应商无关：这家启用着 / 凭据存得下也解得开 / 至少有一个
 * 已发布执行的模型 / 内置 direct-key 家的代码契约还完好。满足就造一个执行器，
 * 剩下的（鉴权方案词、端点、轮询、参考通道）全部由那条 mapping 与用户保存的连接声明，
 * 经 `buildProfileHttpRequest` 渲染——与画布手动路同一个渲染器。
 *
 * ── 「认证接管」为什么只问内置 direct-key 家（#975，2026-10-04）──────────────────────
 * 「这条连接归认证管」（`catalog/certificationOwnership`）回答的是：**代码拥有的那份策展契约**
 * 是否已被认证 / 声明接管。只有内置 direct-key 家有这样一份代码契约（这个执行器替它守
 * scope、端点、curated mapping），被接管了它就必须让开。其余每一家——内置的非 direct-key、
 * AI 接入、声明卡、设置页手接的中转——这个执行器本来就只渲染目录里那条 mapping，
 * 认证晋升与声明登记写的也正是那条 mapping；没有第二个执行器、没有第二份契约可以让给。
 * 此前这里对非内置家也「让出」，于是声明卡 / 手加模型一写 `meta.adapter`，整条连接在正式生成
 * 落到 `configured_provider`，而画布（引擎 A）照常出图——让出去的东西没有人接。
 * 一行模型发布哪些模式，由模型级的发布判据（`shared/modelPublication`）管，不在连接级。
 */
export function createGenerationProviderBootstrap(
  state: CatalogState = readCatalog(),
  options: GenerationProviderBootstrapOptions = {},
): GenerationProviderBootstrap {
  const readinessByProvider: Record<string, GenerationProviderReadiness> = {};
  for (const vendor of state.vendors) readinessByProvider[vendor.key] = readiness(false, noRecovery, ["configured_provider"]);
  const providers: GenerationProvider[] = [];
  const catalogReader = options.catalogReader ?? readCatalog;
  const fixtureBaseUrl = safeFixtureBaseUrl(options.fixtureBaseUrlOverride);
  const fixtureApiKey = safeFixtureApiKey(fixtureBaseUrl);
  const fixtureVendor = fixtureVendorKey();

  for (const vendor of state.vendors) {
    if (!vendor.enabled) continue;
    const vendorKey = vendor.key;
    const fixtureKeyForVendor = vendorKey === fixtureVendor ? fixtureApiKey : undefined;
    const fixtureBaseForVendor = vendorKey === fixtureVendor ? fixtureBaseUrl : undefined;
    if (!credentialIsUsable(state, vendorKey) && !fixtureKeyForVendor) continue;
    if (!hasPublishedExecutionForProvider(state, vendorKey)) continue;
    // 「认证接管」只对内置 direct-key 家有意义，在它的 scope 判据里问（见文件头 #975 一段）。
    if (!hasSafeDirectKeyScope(state, vendorKey)) continue;

    const connectionResolver = options.connectionResolver;
    const resolveConnection = connectionResolver
      ? () => connectionResolver(vendorKey)
      : fixtureKeyForVendor
        ? () => ({ apiKey: fixtureKeyForVendor, baseUrl: fixtureBaseForVendor })
        : () => {
          const current = catalogReader();
          const live = current.vendors.find((candidate) => candidate.key === vendorKey && candidate.enabled);
          if (!live || !credentialIsUsable(current, vendorKey)) return null;
          if (isBuiltinDirectKeyVendor(vendorKey)
            && (isCertificationOwnedConnection(current, vendorKey)
              || !builtinVendorScopeMatches(live)
              || !hasBuiltinCuratedExecution(current, vendorKey))) {
            return null;
          }
          const apiKey = decryptApiKeyRecord(current.apiKeysByVendor[vendorKey]!).trim();
          return apiKey ? { apiKey, baseUrl: (fixtureBaseForVendor ?? live.baseUrlHint) || undefined } : null;
        };
    const provider = createCatalogGenerationProvider({
      vendorKey,
      resolveConnection,
      ...(fixtureBaseForVendor ? { fixtureBaseUrlOverride: fixtureBaseForVendor } : {}),
      // Keep provider capability/mode resolution on the same live catalog
      // snapshot used for the credential. This prevents a submit from
      // silently falling back to a stale bundled catalog after settings are
      // changed in the desktop app.
      catalogReader,
      initialState: state,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    providers.push(provider);
    readinessByProvider[vendorKey] = readiness(true, provider.capabilities);
  }
  return { providers, readinessByProvider };
}

/** 只为测试可读性导出：装配期用到的 vendor 形状。 */
export type BootstrapVendor = Vendor;
