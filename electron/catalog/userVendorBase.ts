/**
 * 「这个用户的这条连接，接口地址 base 是什么」——全仓唯一的回答者（2026-10-03 走查铁律 1）。
 *
 * 病根：APIMart 的参考图上传端点曾在 assetIngestionRegistry 里写死成国际域名，只有生成请求跟着
 * 用户在设置里填的地址走。填了国内地址 api.apib.ai、又不会翻墙的用户，生成请求发得出去、参考图传不上去；
 * 零花费走查里同一条就表现为「有请求打到真实服务商」。0.22.5 只修了生成那一条，没有收口。
 *
 * 判据只有两层：
 *  1. 走查/E2E 夹具口（production E2E fixture gate + 回环地址，只对夹具点名的那一家）；
 *  2. 用户保存在这条连接上的 baseUrlHint。
 * 端点（上传、健康探测……）一律由它推出来，不许再各拼各的域名。
 * 域名重试（vendorBaseFallback）照旧在发请求那一层按 origin 改写，和这里无关。
 */
import type { AssetIngestion } from "./types";
import { productionFixtureBaseOriginFromEnv } from "../shared/productionRunE2eFixtureGate";

/** 夹具只认一家：`NOMI_E2E_FIXTURE_VENDOR`（缺省 apimart）。与 generationProviderBootstrap 同一口子。 */
function fixtureVendorKey(): string {
  return String(process.env.NOMI_E2E_FIXTURE_VENDOR || "apimart").trim() || "apimart";
}

/** 用户这条连接的 base（无尾斜杠）；没填 = 空串。 */
export function userVendorBaseUrl(vendor: { key?: string; baseUrlHint?: string | null } | null | undefined): string {
  const fixture = vendor?.key && vendor.key === fixtureVendorKey()
    ? productionFixtureBaseOriginFromEnv(process.env)
    : undefined;
  if (fixture) return fixture;
  return String(vendor?.baseUrlHint ?? "").trim().replace(/\/+$/, "");
}

/** base 末尾若已带 /v1（用户可能这样填），去掉再拼 endpointPath（路径自己带 /v1）。 */
function joinBase(base: string, path: string): string {
  return `${base.replace(/\/v1$/i, "")}${path}`;
}

/** 声明了 endpointPath 的吞入通道：endpoint 由用户连接的 base 重算；没有 base 保持默认。 */
export function bindIngestionToUserBase(
  ingestion: AssetIngestion,
  vendor: { key?: string; baseUrlHint?: string | null } | null | undefined,
): AssetIngestion {
  if (ingestion.strategy !== "upload-multipart" || !ingestion.endpointPath) return ingestion;
  const base = userVendorBaseUrl(vendor);
  if (!/^https?:\/\//i.test(base)) return ingestion;
  return { ...ingestion, endpoint: joinBase(base, ingestion.endpointPath) };
}
