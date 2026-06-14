// R1 通用解析器：把 request 里的本地素材(nomi-local://)在发送前变成 vendor 够得着的值。
// **通用第一**：本模块与任何具体供应商无关——它只认「一份 AssetIngestion 声明」,按 strategy 分叉。
// KIE 等具体供应商的端点/字段/响应路径只住在各自的声明里(单源),由 curatedAssetIngestion 提供。
// 全部依赖注入(读本地字节 read / POST 上传 postJson),故可零网络零额度单测。

import type { AssetIngestion } from "./types";

const NOMI_LOCAL_PREFIX = "nomi-local://";

export type LocalAsset = { bytes: Buffer; contentType: string; fileName: string; originalUrl?: string };
export type LocalAssetReader = (url: string) => LocalAsset | null;
export type HttpPostJson = (url: string, headers: Record<string, string>, body: unknown) => Promise<unknown>;
export type HttpPostMultipart = (url: string, headers: Record<string, string>, file: Buffer, fileName: string, contentType: string) => Promise<unknown>;

export function isLocalAssetUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(NOMI_LOCAL_PREFIX);
}

/** 递归收集任意 JSON 结构里所有 nomi-local URL(去重)。标量/数组元素/对象值都认。 */
export function collectLocalAssetUrls(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (isLocalAssetUrl(value)) out.add(value);
  else if (Array.isArray(value)) for (const item of value) collectLocalAssetUrls(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectLocalAssetUrls(item, out);
  return out;
}

/** 递归把结构里的 nomi-local URL 按映射替换(返回新结构,不改原对象)。 */
export function replaceLocalAssetUrls<T>(value: T, urlMap: Map<string, string>): T {
  if (isLocalAssetUrl(value)) return (urlMap.get(value) ?? value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => replaceLocalAssetUrls(item, urlMap)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = replaceLocalAssetUrls(item, urlMap);
    return out as unknown as T;
  }
  return value;
}

function readNestedPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

/** 把一个本地素材按 vendor 声明的策略解析成可达值(data:URI 或上传后的公网 URL)。 */
export async function resolveLocalAsset(
  localUrl: string,
  ingestion: AssetIngestion,
  apiKey: string,
  read: LocalAssetReader,
  postJson: HttpPostJson,
  postMultipart: HttpPostMultipart,
): Promise<string> {
  if (ingestion.strategy === "none") {
    throw new Error("当前供应商不支持本地素材上传，请改用公网图片 URL(或为该供应商声明 assetIngestion)");
  }
  const asset = read(localUrl);
  if (!asset) throw new Error(`本地素材读取失败：${localUrl}`);
  // sidecar originalUrl 优先：公网 URL 所有 vendor 直接使用，不转 base64、不需供应商上传 API。
  if (asset.originalUrl) return asset.originalUrl;
  const base64 = asset.bytes.toString("base64");
  const dataUrl = `data:${asset.contentType};base64,${base64}`;

  if (ingestion.strategy === "inline-base64") return dataUrl;

  if (ingestion.strategy === "upload-multipart") {
    // multipart/form-data 上传（如 apimart POST /v1/uploads/images）
    // apiKey 为空时不发 Authorization（nomi-relay 等无鉴权中转端点）
    const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const response = await postMultipart(ingestion.endpoint, headers, asset.bytes, asset.fileName, asset.contentType);
    const url = readNestedPath(response, ingestion.urlPath);
    if (typeof url !== "string" || !url) {
      throw new Error(`上传响应缺少可达 URL(期望路径 ${ingestion.urlPath})`);
    }
    return url;
  }

  // upload-url（base64 JSON，如 KIE）
  const body: Record<string, unknown> = {
    [ingestion.base64Field]: ingestion.dataUrlPrefix === false ? base64 : dataUrl,
  };
  if (ingestion.uploadPathField) body[ingestion.uploadPathField] = ingestion.uploadPath ?? "uploads";
  if (ingestion.fileNameField) body[ingestion.fileNameField] = asset.fileName;
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  const response = await postJson(ingestion.endpoint, headers, body);
  const url = readNestedPath(response, ingestion.urlPath);
  if (typeof url !== "string" || !url) {
    throw new Error(`上传响应缺少可达 URL(期望路径 ${ingestion.urlPath})`);
  }
  return url;
}

/**
 * 对一整个值(通常是 request.extras)做本地素材本地化:扫出所有 nomi-local、每个唯一 URL 只上传一次、
 * 替换成可达值。无本地素材时原样返回(零开销)。
 */
export async function localizeAssetsForVendor(
  value: unknown,
  ingestion: AssetIngestion | null | undefined,
  apiKey: string,
  read: LocalAssetReader,
  postJson: HttpPostJson,
  postMultipart: HttpPostMultipart,
): Promise<{ value: unknown; uploaded: number }> {
  const urls = Array.from(collectLocalAssetUrls(value));
  if (urls.length === 0) return { value, uploaded: 0 };
  const effective: AssetIngestion = ingestion ?? { strategy: "none" };
  const urlMap = new Map<string, string>();
  for (const url of urls) {
    urlMap.set(url, await resolveLocalAsset(url, effective, apiKey, read, postJson, postMultipart));
  }
  return { value: replaceLocalAssetUrls(value, urlMap), uploaded: urls.length };
}

/**
 * Curated 供应商的吞入策略注册表(代码级单源,不依赖持久化目录——curated 传输塑形本就住代码,
 * 见 kieSeedance.ts)。onboarding 自接的 vendor 走 Vendor.assetIngestion(持久化)。
 */
const CURATED_ASSET_INGESTION: Record<string, AssetIngestion> = {
  // KIE:免费 base64 上传端点 → 临时公网 URL(文件 24h~3天,够一次生成)。docs.kie.ai/file-upload-api
  kie: {
    strategy: "upload-url",
    endpoint: "https://kieai.redpandaai.co/api/file-base64-upload",
    base64Field: "base64Data",
    dataUrlPrefix: true,
    uploadPathField: "uploadPath",
    uploadPath: "images/nomi",
    fileNameField: "fileName",
    urlPath: "data.downloadUrl",
  },
  // apimart:POST /v1/uploads/images（multipart/form-data），返回有效 72h 公网 URL（field: url）。
  // 统一走 upload-multipart，图片端点 inline-base64 也可，但 upload 路径对所有端点（视频）通用。
  apimart: { strategy: "upload-multipart", endpoint: "https://api.apimart.ai/v1/uploads/images", urlPath: "url" },
};

/** 取某 vendor 的吞入策略:优先持久化声明,回退 curated 注册表。 */
export function resolveAssetIngestion(vendor: { key?: string; assetIngestion?: AssetIngestion } | null | undefined): AssetIngestion | null {
  if (!vendor) return null;
  if (vendor.assetIngestion) return vendor.assetIngestion;
  if (vendor.key && CURATED_ASSET_INGESTION[vendor.key]) return CURATED_ASSET_INGESTION[vendor.key];
  return null;
}

/**
 * 通用素材上传策略解析（带跨供应商 fallback）。
 *
 * 目标供应商无上传能力时自动用其他已配置供应商中转上传，返回公网 URL 供任意目标使用。
 * 优先级：目标 vendor 自身策略 → KIE（免费）→ apimart（免费 72h）→ 其他有上传能力的供应商。
 *
 * 返回 null = 所有已配置供应商均无上传通道（用户需至少配置一个有上传能力的供应商）。
 */
export function resolveAssetIngestionWithFallback(
  targetVendor: { key?: string; assetIngestion?: AssetIngestion } | null | undefined,
  allVendors: Array<{ key?: string; assetIngestion?: AssetIngestion }>,
  getApiKey: (vendorKey: string) => string | null,
): { ingestion: AssetIngestion; uploadApiKey: string } | null {
  // 1. 目标供应商自己有上传能力 → 直接用（apiKey 也是目标供应商的）
  const targetIngestion = resolveAssetIngestion(targetVendor);
  if (targetIngestion && targetIngestion.strategy !== "none") {
    const key = targetVendor?.key ? (getApiKey(targetVendor.key) ?? "") : "";
    return { ingestion: targetIngestion, uploadApiKey: key };
  }
  // 2. KIE：免费上传，返回公网 URL，所有供应商均可用该 URL
  const kieKey = getApiKey("kie");
  if (kieKey) return { ingestion: CURATED_ASSET_INGESTION.kie, uploadApiKey: kieKey };
  // 3. apimart：免费上传（72h），目标不是 apimart 本身时才用（避免 key 二选一歧义）
  if (targetVendor?.key !== "apimart") {
    const apimartKey = getApiKey("apimart");
    if (apimartKey) return { ingestion: CURATED_ASSET_INGESTION.apimart, uploadApiKey: apimartKey };
  }
  // 4. 其他任意有上传能力（非 inline-base64）的已配供应商
  for (const vendor of allVendors) {
    if (!vendor.key || vendor.key === targetVendor?.key) continue;
    const ing = resolveAssetIngestion(vendor);
    if (!ing || ing.strategy === "none" || ing.strategy === "inline-base64") continue;
    const key = getApiKey(vendor.key);
    if (key) return { ingestion: ing, uploadApiKey: key };
  }
  return null;
}
