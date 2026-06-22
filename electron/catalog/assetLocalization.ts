// R1 通用解析器：把 request 里的本地素材(nomi-local://)在发送前变成 vendor 够得着的值。
// **通用第一**：本模块与任何具体供应商无关——它只认「一份 AssetIngestion 声明」,按 strategy 分叉。
// KIE 等具体供应商的端点/字段/响应路径只住在各自的声明里(单源),由 curatedAssetIngestion 提供。
// 全部依赖注入(读本地字节 read / POST 上传 postJson),故可零网络零额度单测。

import type { AssetIngestion, AssetMediaKind } from "./types";

const NOMI_LOCAL_PREFIX = "nomi-local://";

export type LocalAsset = { bytes: Buffer; contentType: string; fileName: string; originalUrl?: string };
export type LocalAssetReader = (url: string) => LocalAsset | null;
export type HttpPostJson = (url: string, headers: Record<string, string>, body: unknown) => Promise<unknown>;
// extraFields：multipart 里除 file 外的文本字段(如 KIE stream 的 uploadPath/fileName)。
export type HttpPostMultipart = (
  url: string,
  headers: Record<string, string>,
  file: Buffer,
  fileName: string,
  contentType: string,
  extraFields?: Record<string, string>,
  fileField?: string,
) => Promise<unknown>;

export function isLocalAssetUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(NOMI_LOCAL_PREFIX);
}

/** contentType → 媒体类型(image/video/audio)。未知一律按 image(今天的通道都面向图片)。 */
export function mediaKindFromContentType(contentType: string | undefined): AssetMediaKind {
  const ct = (contentType || "").toLowerCase();
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "audio";
  return "image";
}

/** 该通道接受哪些媒体类型;缺省视为 ['image']（今天的通道都面向图片）。none 通道不接受任何。 */
export function ingestionAccepts(ingestion: AssetIngestion, kind: AssetMediaKind): boolean {
  if (ingestion.strategy === "none") return false;
  const accepts = ingestion.accepts ?? (["image"] as ReadonlyArray<AssetMediaKind>);
  return accepts.includes(kind);
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

/** 对提取出的 URL 做一次纯字符串替换(如 tmpfiles 页面 URL → 直链)。未声明 transform 时原样返回。 */
function applyUrlTransform(url: string, transform?: { search: string; replace: string }): string {
  if (!transform || !transform.search) return url;
  return url.replace(transform.search, transform.replace);
}

/** anon-chain 出错日志用的简短 host 名(从 endpoint 取域名)。 */
function hostLabel(ingestion: AssetIngestion): string {
  if (ingestion.strategy === "anon-chain") return "anon-chain";
  if (ingestion.strategy === "inline-base64" || ingestion.strategy === "none") return ingestion.strategy;
  try {
    return new URL(ingestion.endpoint).host;
  } catch {
    return ingestion.endpoint;
  }
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
  // 匿名上传 fallback 链：逐个 host 试，谁先产出合法 http(s) URL 就用谁；全失败抛诚实错误。
  if (ingestion.strategy === "anon-chain") {
    const errors: string[] = [];
    for (const host of ingestion.chain) {
      try {
        const url = await resolveLocalAsset(localUrl, host, "", read, postJson, postMultipart);
        if (/^https?:\/\//i.test(url)) return url;
        errors.push(`${hostLabel(host)}: 返回非 http URL`);
      } catch (err) {
        errors.push(`${hostLabel(host)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(`所有免配置上传 host 都失败：${errors.join("；") || "(链为空)"}`);
  }
  const asset = read(localUrl);
  if (!asset) throw new Error(`本地素材读取失败：${localUrl}`);
  // sidecar originalUrl 优先：公网 URL 所有 vendor 直接使用，不转 base64、不需供应商上传 API。
  if (asset.originalUrl) return asset.originalUrl;
  const base64 = asset.bytes.toString("base64");
  const dataUrl = `data:${asset.contentType};base64,${base64}`;

  if (ingestion.strategy === "inline-base64") return dataUrl;

  if (ingestion.strategy === "upload-multipart") {
    // multipart/form-data 上传（如 apimart POST /v1/uploads/images；litterbox 匿名临时托管）
    // apiKey 为空时不发 Authorization（litterbox 匿名、nomi-relay 无鉴权中转端点）
    const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const response = await postMultipart(
      ingestion.endpoint,
      headers,
      asset.bytes,
      asset.fileName,
      asset.contentType,
      ingestion.extraFields,
      ingestion.fileField,
    );
    // litterbox 等：整个响应体即直链(纯文本,非 JSON)。postMultipart 解析失败时返回原始字符串。
    if (ingestion.responseIsPlainTextUrl) {
      const text = typeof response === "string" ? response.trim() : "";
      if (!/^https?:\/\//i.test(text)) {
        throw new Error(`上传响应不是可达 URL(纯文本期望)：${text.slice(0, 120) || "(空)"}`);
      }
      return applyUrlTransform(text, ingestion.urlTransform);
    }
    if (!ingestion.urlPath) {
      throw new Error("upload-multipart 声明缺少 urlPath（且未启用 responseIsPlainTextUrl）");
    }
    const url = readNestedPath(response, ingestion.urlPath);
    if (typeof url !== "string" || !url) {
      throw new Error(`上传响应缺少可达 URL(期望路径 ${ingestion.urlPath})`);
    }
    // tmpfiles 等：JSON 给的是页面 URL，需转成直链(host 后插 /dl/)，否则 vendor fetch 到 HTML 页。
    return applyUrlTransform(url, ingestion.urlTransform);
  }

  if (ingestion.strategy === "upload-stream") {
    // multipart 流式上传二进制(大文件高效,如 KIE file-stream-upload 收 mp4)。
    // file=二进制 + uploadPath(目录) + fileName,响应公网 URL 在 urlPath。
    const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const extraFields: Record<string, string> = {
      [ingestion.uploadPathField ?? "uploadPath"]: ingestion.uploadPath ?? "uploads",
      [ingestion.fileNameField ?? "fileName"]: asset.fileName,
    };
    const response = await postMultipart(ingestion.endpoint, headers, asset.bytes, asset.fileName, asset.contentType, extraFields);
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

/** 按某素材的媒体类型选出该用哪个上传通道(+ 该通道的 apiKey);无可用通道返回 null。 */
export type IngestionResolver = (
  mediaKind: AssetMediaKind,
) => { ingestion: AssetIngestion; uploadApiKey: string } | null;

/**
 * 对一整个值(通常是 request.extras)做本地素材本地化:扫出所有 nomi-local、每个唯一 URL 只上传一次、
 * 替换成可达值。无本地素材时原样返回(零开销)。
 *
 * **内容类型感知路由**:每个素材先读出 contentType → 派生媒体类型(image/video/audio),用 `resolveIngestion`
 * 按该类型挑通道。图片走原有图片通道、视频走支持视频的通道(如 KIE stream)。某素材无可用通道时抛
 * 诚实错误(由调用方文案化),绝不静默丢/套错通道。
 */
export async function localizeAssetsForVendor(
  value: unknown,
  resolveIngestion: IngestionResolver,
  read: LocalAssetReader,
  postJson: HttpPostJson,
  postMultipart: HttpPostMultipart,
): Promise<{ value: unknown; uploaded: number }> {
  const urls = Array.from(collectLocalAssetUrls(value));
  if (urls.length === 0) return { value, uploaded: 0 };
  const urlMap = new Map<string, string>();
  for (const url of urls) {
    const asset = read(url);
    // sidecar originalUrl 优先:已是公网 URL,不需任何上传通道,任意媒体类型直接用。
    if (asset?.originalUrl) {
      urlMap.set(url, asset.originalUrl);
      continue;
    }
    const mediaKind = mediaKindFromContentType(asset?.contentType);
    const resolved = resolveIngestion(mediaKind);
    if (!resolved) {
      throw new Error(
        mediaKind === "video"
          ? "运镜参考视频需要支持视频上传的通道：请在「模型接入」配置 KIE key（免费）或部署 relay。"
          : `没有可用的${mediaKind === "audio" ? "音频" : "图片"}上传通道：请配置一个支持该媒体类型的供应商通道。`,
      );
    }
    urlMap.set(url, await resolveLocalAsset(url, resolved.ingestion, resolved.uploadApiKey, read, postJson, postMultipart));
  }
  return { value: replaceLocalAssetUrls(value, urlMap), uploaded: urls.length };
}

/**
 * Curated 供应商的吞入策略注册表(代码级单源,不依赖持久化目录——curated 传输塑形本就住代码,
 * 见 kieSeedance.ts)。onboarding 自接的 vendor 走 Vendor.assetIngestion(持久化)。
 */
const CURATED_ASSET_INGESTION: Record<string, AssetIngestion> = {
  // KIE:免费通用文件托管 → 临时公网 URL(文件 ~3天,够一次生成)。docs.kie.ai/file-upload-api
  // 图片走 base64(file-base64-upload);视频/音频走 stream(见 CURATED_VIDEO_INGESTION,base64 对 mp4 低效)。
  kie: {
    strategy: "upload-url",
    endpoint: "https://kieai.redpandaai.co/api/file-base64-upload",
    base64Field: "base64Data",
    dataUrlPrefix: true,
    uploadPathField: "uploadPath",
    uploadPath: "images/nomi",
    fileNameField: "fileName",
    urlPath: "data.downloadUrl",
    accepts: ["image"],
  },
  // apimart:POST /v1/uploads/images（multipart/form-data），返回有效 72h 公网 URL（field: url）。
  // 仅图片：该端点是 image-only（jpeg/png/webp/gif,20MB），收 mp4 会 HTTP 400。视频走 KIE/relay。
  apimart: { strategy: "upload-multipart", endpoint: "https://api.apimart.ai/v1/uploads/images", urlPath: "url", accepts: ["image"] },
  // 魔搭：改图（Qwen-Image-Edit）的 image_url 直收 data URL（真实 E2E 验证 2026-06-19），无需上传端点。仅图片。
  modelscope: { strategy: "inline-base64", accepts: ["image"] },
};

// 视频/音频专用上传通道(按 vendor)。KIE file-stream-upload:multipart 流式二进制,大文件高效(~33%),
// 返回公网 downloadUrl。docs.kie.ai/file-upload-api/upload-file-stream
const CURATED_VIDEO_INGESTION: Record<string, AssetIngestion> = {
  kie: {
    strategy: "upload-stream",
    endpoint: "https://kieai.redpandaai.co/api/file-stream-upload",
    uploadPathField: "uploadPath",
    uploadPath: "videos/nomi",
    fileNameField: "fileName",
    urlPath: "data.downloadUrl",
    accepts: ["image", "video", "audio"],
  },
};

/**
 * litterbox（catbox.moe 匿名临时文件托管）：零配置兜底通道——无 key、无账号、收任意文件。
 * POST https://litterbox.catbox.moe/resources/internals/api.php，multipart：
 *   reqtype=fileupload, time=1h, fileToUpload=<二进制>。无 Authorization（匿名）。
 * 响应体是**纯文本直链**（非 JSON），如 "https://litter.catbox.moe/abc123.mp4"。
 * 文件 1 小时有效，够一次生成。accepts 全媒体类型（它收任何文件）。
 * 用作视频上传的零配置兜底：目标 vendor 与 KIE 都没有视频通道时仍能"开箱即用"。
 */
export const LITTERBOX_INGESTION: AssetIngestion = {
  strategy: "upload-multipart",
  endpoint: "https://litterbox.catbox.moe/resources/internals/api.php",
  responseIsPlainTextUrl: true,
  fileField: "fileToUpload",
  extraFields: { reqtype: "fileupload", time: "1h" },
  accepts: ["image", "video", "audio"],
};

/**
 * tmpfiles.org：第二个零配置兜底 host——无 key、无账号、收任意文件。
 * POST https://tmpfiles.org/api/v1/upload，multipart：file=<二进制>。无 Authorization（匿名）。
 * 响应 JSON：{"status":"success","data":{"url":"https://tmpfiles.org/<id>/<name>"}}。
 * ⚠️ data.url 是**页面 URL**；vendor 必须 fetch 的是**直链**——host 后插 "/dl/"
 * (tmpfiles.org/<id>/<name> → tmpfiles.org/dl/<id>/<name>)。故 urlTransform 做这次替换。
 * accepts 全媒体类型（收任何文件）。
 */
export const TMPFILES_INGESTION: AssetIngestion = {
  strategy: "upload-multipart",
  endpoint: "https://tmpfiles.org/api/v1/upload",
  fileField: "file",
  urlPath: "data.url",
  urlTransform: { search: "tmpfiles.org/", replace: "tmpfiles.org/dl/" },
  accepts: ["image", "video", "audio"],
};

/**
 * 匿名上传 fallback 链(有序)：bake-in 的免 key 免账号公共托管。逐个试,谁先成功用谁。
 * litterbox(catbox)优先 → tmpfiles.org 兜底。单 host 限速/宕机/封禁时自动切下一个,
 * 全失败才抛诚实错误。两者都无 key、收任意文件(全媒体类型),故"开箱即用"永不要求用户配 key。
 */
export const ANON_UPLOAD_CHAIN: AssetIngestion = {
  strategy: "anon-chain",
  chain: [LITTERBOX_INGESTION, TMPFILES_INGESTION],
  accepts: ["image", "video", "audio"],
};

/** 取某 vendor 的吞入策略:优先持久化声明,回退 curated 注册表。 */
export function resolveAssetIngestion(vendor: { key?: string; assetIngestion?: AssetIngestion } | null | undefined): AssetIngestion | null {
  if (!vendor) return null;
  if (vendor.assetIngestion) return vendor.assetIngestion;
  if (vendor.key && CURATED_ASSET_INGESTION[vendor.key]) return CURATED_ASSET_INGESTION[vendor.key];
  return null;
}

/**
 * 取某 vendor 接受给定媒体类型的吞入策略。图片走主声明;视频/音频优先取该 vendor 的专用视频通道
 * (如 KIE stream),再回退主声明(若它本身 accepts 该类型)。该类型无任何可接受通道时返回 null。
 */
export function resolveAssetIngestionForKind(
  vendor: { key?: string; assetIngestion?: AssetIngestion } | null | undefined,
  kind: AssetMediaKind,
): AssetIngestion | null {
  if (!vendor) return null;
  if (kind !== "image" && vendor.key && CURATED_VIDEO_INGESTION[vendor.key]) {
    const video = CURATED_VIDEO_INGESTION[vendor.key];
    if (ingestionAccepts(video, kind)) return video;
  }
  const primary = resolveAssetIngestion(vendor);
  if (primary && ingestionAccepts(primary, kind)) return primary;
  return null;
}

/**
 * 通用素材上传策略解析（带跨供应商 fallback + 内容类型感知）。
 *
 * 目标供应商对该媒体类型无上传能力时自动用其他**接受该类型**的已配置供应商中转上传，
 * 返回公网 URL 供任意目标使用。优先级：目标 vendor 自身 → KIE（免费,通用文件托管,接图/视频/音频）
 * → apimart（免费 72h,仅图片）→ 其他接受该类型且有上传能力的供应商。
 *
 * 关键：apimart 的 /uploads/images 是 image-only（收 mp4 会 400），故视频素材会跳过 apimart。
 *
 * 返回 null = 没有任何接受该媒体类型的上传通道（调用方据此抛诚实错误，如视频缺 KIE/relay）。
 */
export function resolveAssetIngestionWithFallback(
  targetVendor: { key?: string; assetIngestion?: AssetIngestion } | null | undefined,
  allVendors: Array<{ key?: string; assetIngestion?: AssetIngestion }>,
  getApiKey: (vendorKey: string) => string | null,
  mediaKind: AssetMediaKind = "image",
): { ingestion: AssetIngestion; uploadApiKey: string } | null {
  // 1. 目标供应商自己接受该类型 → 直接用（apiKey 也是目标供应商的）
  const targetIngestion = resolveAssetIngestionForKind(targetVendor, mediaKind);
  if (targetIngestion && targetIngestion.strategy !== "none") {
    const key = targetVendor?.key ? (getApiKey(targetVendor.key) ?? "") : "";
    return { ingestion: targetIngestion, uploadApiKey: key };
  }
  // 2. KIE：免费上传，通用文件托管（图/视频/音频），返回公网 URL，所有供应商均可用该 URL
  const kieKey = getApiKey("kie");
  if (kieKey) {
    const kieIngestion = resolveAssetIngestionForKind({ key: "kie" }, mediaKind);
    if (kieIngestion) return { ingestion: kieIngestion, uploadApiKey: kieKey };
  }
  // 3. apimart：免费上传（72h，仅图片），目标不是 apimart 本身时才用（避免 key 二选一歧义）
  if (targetVendor?.key !== "apimart") {
    const apimartKey = getApiKey("apimart");
    if (apimartKey) {
      const apimartIngestion = resolveAssetIngestionForKind({ key: "apimart" }, mediaKind);
      if (apimartIngestion) return { ingestion: apimartIngestion, uploadApiKey: apimartKey };
    }
  }
  // 4. 其他任意接受该类型且有上传能力（非 inline-base64）的已配供应商
  for (const vendor of allVendors) {
    if (!vendor.key || vendor.key === targetVendor?.key) continue;
    const ing = resolveAssetIngestionForKind(vendor, mediaKind);
    if (!ing || ing.strategy === "none" || ing.strategy === "inline-base64") continue;
    const key = getApiKey(vendor.key);
    if (key) return { ingestion: ing, uploadApiKey: key };
  }
  // 5. 匿名上传链：零配置兜底（无 key、收任意文件 → 临时公网直链）。多 host 有序 fallback
  //    (litterbox → tmpfiles)，单 host 限速/宕机时自动切下一个。走到这里说明上面更优的通道都没命中
  //    （图片几乎总有 apimart；视频缺 KIE 时此处接住）。NET：上传零配置"开箱即用"，诚实错误
  //    只在链里**所有** host 都不可达时才触发。
  if (ingestionAccepts(ANON_UPLOAD_CHAIN, mediaKind)) {
    return { ingestion: ANON_UPLOAD_CHAIN, uploadApiKey: "" };
  }
  return null;
}
