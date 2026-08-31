// R1 通用解析器：把 request 里的本地素材在发送前变成 vendor 够得着的值。
// 「本地素材」= `nomi-local://`（项目内文件）**与** `data:`（内联字节）——形态判定住 assetValueScheme，
// 两者共用同一条物化/上传链，于是每个 vendor 收到的永远是公网 URL，不再「这家收 data: 那家 500」。
// **通用第一**：本模块与任何具体供应商无关——它只认「一份 AssetIngestion 声明」,按 strategy 分叉。
// KIE 等具体供应商的端点/字段/响应路径只住在各自的声明里(单源),由 curatedAssetIngestion 提供。
// 全部依赖注入(读本地字节 read / POST 上传 postJson),故可零网络零额度单测。

import { DOMParser } from "@xmldom/xmldom";
import { isComfyuiVendor, type AssetIngestion, type AssetMediaKind } from "./types";
import {
  anonymousConsentFromUnknown,
  canUseAnonymousAssetHosting,
  ingestionHasSufficientLease,
  ingestionVisibility,
  type AnonymousAssetConsent,
} from "./assetTransportPolicy";
import {
  classifyAssetValue,
  describeAssetValue,
  humanSize,
  isLocalizableAssetValue,
  parseInlineDataAsset,
  unreachableAssetValueError,
} from "./assetValueScheme";
import { contentTypeFromMagicBytes } from "../assets/mediaTypes";
import {
  ingestionAccepts,
  resolveAssetIngestionForKind,
  ANON_UPLOAD_CHAIN,
} from "./assetIngestionRegistry";
import { readAssetRelayRuntimeConfig, readDefaultAssetRelayRuntimeConfig } from "./assetRelayRuntimeConfig";

export {
  ingestionAccepts,
  resolveAssetIngestion,
  resolveAssetIngestionForKind,
  LITTERBOX_INGESTION,
  TMPFILES_INGESTION,
  ANON_UPLOAD_CHAIN,
} from "./assetIngestionRegistry";

export type LocalAsset = {
  bytes: Buffer;
  contentType: string;
  fileName: string;
  originalUrl?: string;
  /** 资产落盘至今的毫秒数（文件 mtime 推）。用于判 originalUrl（服务商临时直链）是否仍新鲜。 */
  ageMs?: number;
};

export class AnonymousAssetConsentRequiredError extends Error {
  constructor() {
    super("参考素材需要上传到公共临时托管。KIE 视频文件上传免费，配置 KIE 后可优先使用；继续前请确认公共链接和有效期风险。");
    this.name = "AnonymousAssetConsentRequiredError";
  }
}

/** sidecar originalUrl 的信任窗：kie ~3 天 / apimart 72h 的安全下界。窗内直接用公网直链（零上传
 *  零延迟）；过窗视为可能已死 → 走上传链用本地字节换新链。ageMs 未知（老调用方/stat 失败）按新鲜
 *  处理（保持既有行为，不为不可知情况加惩罚）。 */
export const ORIGINAL_URL_TRUST_MS = 48 * 60 * 60 * 1000;

export function trustedOriginalUrl(asset: Pick<LocalAsset, "originalUrl" | "ageMs"> | null | undefined): string | null {
  if (!asset?.originalUrl) return null;
  if (typeof asset.ageMs === "number" && asset.ageMs > ORIGINAL_URL_TRUST_MS) return null;
  return asset.originalUrl;
}

/**
 * 代码所有的本地生成后端可回收产物 origin。安全例外集中在素材边界，不让通用 runtime 写供应商分支；
 * 仅 curated ComfyUI（含多实例的每一台）生效，用户导入的普通 vendor 不能靠持久化字段自行打开私网下载。
 * 多实例下信任范围不变：仍是「只信这个 vendor **自己** 配置的 origin」，多一台=多一个用户亲手填的地址。
 */
export function trustedLocalOutputOrigin(
  vendor: { key?: string; baseUrlHint?: string | null } | null | undefined,
): string | null {
  if (!isComfyuiVendor(vendor) || !vendor?.baseUrlHint) return null;
  try {
    const url = new URL(vendor.baseUrlHint);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
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
export type HttpPutBinary = (
  url: string,
  headers: Record<string, string>,
  file: Buffer,
  contentType: string,
) => Promise<unknown>;

/**
 * 「这个值发送前必须先本地化」——即 `nomi-local://`（读盘）**或** `data:` 内联字节（就地解码）。
 * 形态判定住 assetValueScheme（单一真相源），本函数只是本模块的门面。
 */
export function isLocalAssetUrl(value: unknown): value is string {
  return isLocalizableAssetValue(value);
}

/** contentType → 媒体类型(image/video/audio)。未知一律按 image(今天的通道都面向图片)。 */
export function mediaKindFromContentType(contentType: string | undefined): AssetMediaKind {
  const ct = (contentType || "").toLowerCase();
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "audio";
  return "image";
}

/** 递归收集任意 JSON 结构里所有待本地化素材值(nomi-local:// / data:,去重)。标量/数组元素/对象值都认。 */
export function collectLocalAssetUrls(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (isLocalAssetUrl(value)) out.add(value);
  else if (Array.isArray(value)) for (const item of value) collectLocalAssetUrls(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectLocalAssetUrls(item, out);
  return out;
}

/** 递归收集所有「谁都够不着」的素材值(blob:/file:)——判定与理由见 assetValueScheme.classifyAssetValue。 */
export function collectUnreachableAssetValues(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (classifyAssetValue(value) === "unreachable") out.add(value as string);
  else if (Array.isArray(value)) for (const item of value) collectUnreachableAssetValues(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectUnreachableAssetValues(item, out);
  return out;
}

/** 出站前拦住 blob:/file:：它们进 body 必错(vendor 拉不到),而这一步在付费守卫之前,失败零花费。 */
function assertNoUnreachableAssetValues(value: unknown): void {
  for (const unreachable of collectUnreachableAssetValues(value)) throw unreachableAssetValueError(unreachable);
}

/**
 * 素材值 → 字节。`data:` 就地解码（零 IO，与 vendor 无关），其余交给注入的读盘器。
 * 这是「本地素材只有 nomi-local:// 一种」那个假设的收口点：新增一种本地形态只改这里。
 */
function readLocalizableAsset(url: string, read: LocalAssetReader): LocalAsset | null {
  if (classifyAssetValue(url) === "inline-data") return parseInlineDataAsset(url);
  return read(url);
}

/** 上传前按全局媒体表核对本地图片字节；SVG 单独验证文本结构，其余格式必须命中对应魔数。 */
export function assertLocalAssetMediaBytes(asset: LocalAsset, mediaKind = mediaKindFromContentType(asset.contentType)): void {
  if (mediaKind !== "image") return;
  const declared = asset.contentType.toLowerCase().split(";")[0].trim();
  const sniffed = contentTypeFromMagicBytes(asset.bytes);
  if (sniffed && !sniffed.startsWith("image/")) {
    throw new Error(`图片素材「${asset.fileName}」的真实文件头是 ${sniffed}，不能作为图片上传。`);
  }
  if (declared === "image/svg+xml") {
    const svg = asset.bytes.toString("utf8").trim();
    try {
      // SVG 素材只需结构验证，不需要 DTD；显式拒绝实体声明，避免外部实体与实体展开入口。
      if (/<!DOCTYPE\b|<!ENTITY\b/i.test(svg)) throw new Error("DTD/entity is not allowed");
      const document = new DOMParser({ onError: (_level, message) => { throw new Error(message); } })
        .parseFromString(svg, "image/svg+xml");
      if (document.documentElement?.localName?.toLowerCase() !== "svg"
        || document.documentElement.namespaceURI !== "http://www.w3.org/2000/svg") throw new Error("root is not svg");
      return;
    } catch {
      throw new Error(`图片素材「${asset.fileName}」声明为 SVG，但内容不是完整且安全的 SVG 文档。`);
    }
  }
  const prefix = asset.bytes.subarray(0, 2048).toString("utf8");
  if (/<!doctype\s+html|<html\b|<\?xml\b|<svg\b/i.test(prefix)) {
    throw new Error(`图片素材「${asset.fileName}」的内容实际是 HTML/XML/SVG 文本，不是可用于视频生成的栅格图片。请重新导入原图。`);
  }
  const knownRasterTypes = new Set([
    "image/png", "image/jpeg", "image/webp", "image/gif", "image/avif",
    "image/bmp", "image/x-icon", "image/tiff", "image/heic",
  ]);
  if (knownRasterTypes.has(declared) && sniffed !== declared) {
    throw new Error(`图片素材「${asset.fileName}」声明为 ${declared}，但文件头识别为 ${sniffed || "未知/损坏"}。请重新导入原图。`);
  }
}

/** 递归把结构里的待本地化素材值按映射替换(返回新结构,不改原对象)。 */
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

/**
 * 付费守卫前的纯本地/策略预检：不上传、不调用供应商，只确认本地字节可读、媒体类型明确，
 * 且至少存在一条能覆盖本次生成窗口的安全通道。这样项目迁移后丢文件、`.bin` 未知素材或
 * 未披露的公共 fallback 都不会先消耗 spend grant 再失败。
 */
export function assertLocalAssetTransportReady(
  value: unknown,
  resolveIngestion: IngestionResolver,
  read: LocalAssetReader,
  options: LocalizeAssetsOptions = {},
): void {
  const effectiveValue = options.minimizeUploads && options.activeAssetUrls
    ? pruneInactiveLocalAssets(value, new Set(options.activeAssetUrls))
    : value;
  assertNoUnreachableAssetValues(effectiveValue);
  for (const url of collectLocalAssetUrls(effectiveValue)) {
    const asset = readLocalizableAsset(url, read);
    if (!asset) throw new Error(`参考素材的本地文件读取失败（可能已被删除或随项目迁移）：${describeAssetValue(url)}。请重新生成该节点或重新导入这张素材。`);
    if (!asset.contentType || asset.contentType.toLowerCase().split(";")[0].trim() === "application/octet-stream") {
      throw new Error(`无法识别本地素材「${asset.fileName || describeAssetValue(url)}」的类型，不能安全判断它是图片、视频还是音频。请重新导入并保留正确的文件扩展名。`);
    }
    assertLocalAssetMediaBytes(asset);
    if (trustedOriginalUrl(asset)) continue;
    const mediaKind = mediaKindFromContentType(asset.contentType);
    const candidates = resolveIngestion(mediaKind);
    let consentRequired = false;
    const safe = candidates.some((candidate) => {
      if (!ingestionHasSufficientLease(candidate.ingestion, mediaKind)) return false;
      if (ingestionVisibility(candidate.ingestion) === "public-anonymous") {
        const consent = anonymousConsentFromUnknown(options.anonymousConsent ?? "ask");
        if (!canUseAnonymousAssetHosting(consent)) {
          consentRequired = true;
          return false;
        }
      }
      return true;
    });
    if (safe) continue;
    if (consentRequired) throw new AnonymousAssetConsentRequiredError();
    throw new Error(
      mediaKind === "video"
        ? "运镜参考视频需要支持视频上传的通道：请在「模型接入」配置 KIE key（免费）或部署 relay。"
        : `没有可用的${mediaKind === "audio" ? "音频" : "图片"}上传通道：请配置一个支持该媒体类型的供应商通道。`,
    );
  }
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

function authorizationHeaders(ingestion: AssetIngestion, apiKey: string): Record<string, string> {
  if (!apiKey) return {};
  const scheme = "authType" in ingestion && ingestion.authType === "key" ? "Key" : "Bearer";
  return { Authorization: `${scheme} ${apiKey}` };
}

/** 把一个本地素材按 vendor 声明的策略解析成可达值(data:URI 或上传后的公网 URL)。 */
export async function resolveLocalAsset(
  localUrl: string,
  ingestion: AssetIngestion,
  apiKey: string,
  read: LocalAssetReader,
  postJson: HttpPostJson,
  postMultipart: HttpPostMultipart,
  putBinary: HttpPutBinary = async () => { throw new Error("当前上传通道需要 raw PUT 执行器"); },
): Promise<string> {
  if (ingestion.strategy === "none") {
    throw new Error("当前供应商不支持本地素材上传，请改用公网图片 URL(或为该供应商声明 assetIngestion)");
  }
  // 匿名上传 fallback 链：逐个 host 试，谁先产出合法 http(s) URL 就用谁；全失败抛诚实错误。
  if (ingestion.strategy === "anon-chain") {
    const errors: string[] = [];
    for (const host of ingestion.chain) {
      try {
        const url = await resolveLocalAsset(localUrl, host, "", read, postJson, postMultipart, putBinary);
        if (/^https?:\/\//i.test(url)) return url;
        errors.push(`${hostLabel(host)}: 返回非 http URL`);
      } catch (err) {
        errors.push(`${hostLabel(host)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(`所有免配置上传 host 都失败：${errors.join("；") || "(链为空)"}`);
  }
  const asset = readLocalizableAsset(localUrl, read);
  if (!asset) throw new Error(`参考素材的本地文件读取失败（可能已被删除或随项目迁移）：${describeAssetValue(localUrl)}。请重新生成该节点或重新导入这张素材。`);
  assertLocalAssetMediaBytes(asset);
  // 本地 ComfyUI：LoadImage 只认上传回的 input 目录文件名（非公网 URL），故**跳过下面的 trustedOriginalUrl
  // 公网 URL 快路**，恒把本地字节 POST 到 /upload/image 换文件名（field 名 "image"、type=input、overwrite 避重名堆积）。
  if (ingestion.strategy === "comfyui-upload") {
    const response = await postMultipart(
      ingestion.endpoint,
      {}, // 本地服务无鉴权
      asset.bytes,
      asset.fileName,
      asset.contentType,
      { type: "input", overwrite: "true" },
      "image",
    );
    const rec = response && typeof response === "object" ? (response as Record<string, unknown>) : {};
    const name = typeof rec.name === "string" ? rec.name : "";
    if (!name) throw new Error(`ComfyUI /upload/image 未返回文件名（检查地址与 ComfyUI 是否在跑）：${JSON.stringify(response).slice(0, 120)}`);
    const sub = typeof rec.subfolder === "string" ? rec.subfolder : "";
    return sub ? `${sub}/${name}` : name; // LoadImage 的 image 输入按 subfolder/name 引用
  }
  // sidecar originalUrl **新鲜窗内**优先：公网 URL 所有 vendor 直接使用，不转 base64、不需供应商上传 API。
  // 过窗（服务商临时链可能已死）→ 落到下面的上传/内联路径，用本地字节换新值（参考图永不过期的关键）。
  const trusted = trustedOriginalUrl(asset);
  if (trusted) return trusted;
  // base64 **按需算**：只有 inline-base64 / upload-url 两条策略要它。此前无条件先算一遍，
  // multipart / stream 上传（视频走的就是这两条）白白在主进程上同步造一个 1.33× 文件大小的字符串
  // ——一段 200MB 的 mp4 = 267MB 字符串 + 一次同步 CPU 峰值，整个 app 当场卡住（R17 卡死一族同款）。
  const base64Of = () => asset.bytes.toString("base64");
  if (ingestion.strategy === "inline-base64") return `data:${asset.contentType};base64,${base64Of()}`;

  if (ingestion.strategy === "upload-presigned") {
    // Vendor-owned two-step upload (Runway Dev): initialize with the API key,
    // then send the bytes to the returned signed URL without forwarding the
    // key. The resulting runway:// URI stays private to the vendor and avoids
    // the anonymous-host fallback entirely.
    const initHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(ingestion.initHeaders || {}),
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
    const initBody: Record<string, unknown> = {
      ...(ingestion.initFields || {}),
      [ingestion.filenameField || "filename"]: asset.fileName,
      [ingestion.typeField || "type"]: "ephemeral",
    };
    const initialized = await postJson(ingestion.endpoint, initHeaders, initBody);
    const uploadUrl = readNestedPath(initialized, ingestion.uploadUrlPath);
    const uri = readNestedPath(initialized, ingestion.uriPath);
    if (typeof uploadUrl !== "string" || !uploadUrl) {
      throw new Error(`供应商上传初始化缺少 uploadUrl（期望路径 ${ingestion.uploadUrlPath}）`);
    }
    if (typeof uri !== "string" || !uri) {
      throw new Error(`供应商上传初始化缺少资源 URI（期望路径 ${ingestion.uriPath}）`);
    }
    const rawFields = readNestedPath(initialized, ingestion.fieldsPath || "fields");
    const fields = rawFields && typeof rawFields === "object"
      ? Object.fromEntries(Object.entries(rawFields).map(([key, value]) => [key, String(value)]))
      : undefined;
    await postMultipart(
      uploadUrl,
      {}, // uploadUrl is signed; never forward the provider API key.
      asset.bytes,
      asset.fileName,
      asset.contentType,
      fields,
      ingestion.uploadFileField || "file",
    );
    return uri;
  }

  if (ingestion.strategy === "upload-multipart") {
    // multipart/form-data 上传（如 apimart POST /v1/uploads/images；litterbox 匿名临时托管）
    // apiKey 为空时不发 Authorization（litterbox/tmpfiles 匿名）；Nomi relay
    // 只有 token 配置完整时才会进入候选列表。
    const headers = authorizationHeaders(ingestion, apiKey);
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
    const headers = authorizationHeaders(ingestion, apiKey);
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

  if (ingestion.strategy === "upload-initiate-put") {
    const initBody = {
      [ingestion.initFileNameField ?? "file_name"]: asset.fileName,
      [ingestion.initContentTypeField ?? "content_type"]: asset.contentType,
    };
    const response = await postJson(
      ingestion.endpoint,
      { "Content-Type": "application/json", ...authorizationHeaders(ingestion, apiKey) },
      initBody,
    );
    const uploadUrl = readNestedPath(response, ingestion.uploadUrlPath);
    const fileUrl = readNestedPath(response, ingestion.urlPath);
    if (typeof uploadUrl !== "string" || !uploadUrl || typeof fileUrl !== "string" || !fileUrl) {
      throw new Error(`上传初始化响应缺少 signed URL 或文件 URL(期望 ${ingestion.uploadUrlPath} / ${ingestion.urlPath})`);
    }
    await putBinary(uploadUrl, { "Content-Type": asset.contentType }, asset.bytes, asset.contentType);
    return fileUrl;
  }

  if (ingestion.strategy === "upload-initiate-multipart") {
    const response = await postJson(
      ingestion.endpoint,
      { "Content-Type": "application/json", ...authorizationHeaders(ingestion, apiKey) },
      {
        [ingestion.initFileNameField ?? "filename"]: asset.fileName,
        [ingestion.initTypeField ?? "type"]: ingestion.initType ?? "ephemeral",
      },
    );
    const uploadUrl = readNestedPath(response, ingestion.uploadUrlPath);
    const fields = readNestedPath(response, ingestion.fieldsPath);
    const uri = readNestedPath(response, ingestion.uriPath);
    if (typeof uploadUrl !== "string" || !uploadUrl || !fields || typeof fields !== "object" || typeof uri !== "string" || !uri) {
      throw new Error(`上传初始化响应缺少 signed 表单或 provider URI(期望 ${ingestion.uploadUrlPath} / ${ingestion.fieldsPath} / ${ingestion.uriPath})`);
    }
    const extraFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value !== "string") throw new Error(`上传初始化字段 ${key} 不是字符串`);
      extraFields[key] = value;
    }
    await postMultipart(uploadUrl, {}, asset.bytes, asset.fileName, asset.contentType, extraFields, ingestion.fileField ?? "file");
    return uri;
  }

  // upload-url（base64 JSON，如 KIE）
  const base64 = base64Of();
  const body: Record<string, unknown> = {
    [ingestion.base64Field]: ingestion.dataUrlPrefix === false ? base64 : `data:${asset.contentType};base64,${base64}`,
  };
  if (ingestion.uploadPathField) body[ingestion.uploadPathField] = ingestion.uploadPath ?? "uploads";
  if (ingestion.fileNameField) body[ingestion.fileNameField] = asset.fileName;
  const headers: Record<string, string> = { "Content-Type": "application/json", ...authorizationHeaders(ingestion, apiKey) };
  const response = await postJson(ingestion.endpoint, headers, body);
  const url = readNestedPath(response, ingestion.urlPath);
  if (typeof url !== "string" || !url) {
    throw new Error(`上传响应缺少可达 URL(期望路径 ${ingestion.urlPath})`);
  }
  return url;
}

/** 按某素材的媒体类型选出**按优先级排好的**上传通道候选(+ 各自的 apiKey);无可用通道返回空数组。 */
export type IngestionResolver = (
  mediaKind: AssetMediaKind,
) => Array<IngestionCandidate>;

/** 一条上传通道候选。`vendorKey` 是这条通道属于哪家(匿名公共托管为 null)——
 *  上传本身用不到它,设置页的「现在走哪条」要靠它说出托管方名字(靠 endpoint 反猜 host 太脆)。 */
export type IngestionCandidate = {
  ingestion: AssetIngestion;
  uploadApiKey: string;
  vendorKey: string | null;
};

export type LocalizeAssetsOptions = {
  anonymousConsent?: AnonymousAssetConsent;
  minimizeUploads?: boolean;
  activeAssetUrls?: ReadonlyArray<string>;
};

function pruneInactiveLocalAssets(value: unknown, active: ReadonlySet<string>): unknown {
  // 内联字节永远算「活的」：它是本次请求**当场带进来**的，不可能是画布上早已过期的残留引用
  // （剪枝要解决的是那个）。若按 activeAssetUrls 名单剪，调用方自己拼名单时漏了它 = 参考被
  // 静默丢掉照样出图照样扣费——这是本次修复最不该复制的失败形状。
  if (classifyAssetValue(value) === "inline-data") return value;
  if (isLocalAssetUrl(value)) return active.has(value) ? value : undefined;
  if (Array.isArray(value)) return value.map((item) => pruneInactiveLocalAssets(item, active)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const next = pruneInactiveLocalAssets(item, active);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return value;
}

/** 内部传输提示只给本地上传策略使用，绝不能泄漏到供应商请求体。 */
function stripTransportHints(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTransportHints);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "activeAssetUrls") continue;
      out[key] = stripTransportHints(item);
    }
    return out;
  }
  return value;
}

const MEDIA_LABEL: Record<AssetMediaKind, string> = { image: "图片", video: "视频", audio: "音频" };

/**
 * 所有候选通道都失败时的诚实错误。
 *
 * 两件事必须写进去，否则用户没法行动：**哪个素材、多大**，以及**每条通道各自为什么挂**。
 * 413 单独说成人话——那不是「服务商临时故障」（此前用户看到的正是这句，于是不停重试，而重试
 * 永远不可能成：每次都是把同一个超限文件完整传上去再被拒）。
 */
function allChannelsFailedError(asset: LocalAsset | null, mediaKind: AssetMediaKind, failures: string[]): Error {
  const what = asset ? `${asset.fileName}（${humanSize(asset.bytes.length)}）` : "这个素材";
  const detail = failures.join("；") || "(无候选通道)";
  if (failures.some((line) => line.includes("HTTP 413"))) {
    return new Error(
      `${MEDIA_LABEL[mediaKind]}「${what}」超过了所有可用上传通道的大小上限，传不上去。` +
        `请把它压缩 / 裁短后再放进来，或在「模型接入」配置一个上传上限更高的通道。详情：${detail}`,
    );
  }
  return new Error(`素材上传失败：${what} 的所有上传通道都没成功。详情：${detail}`);
}

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
  options: LocalizeAssetsOptions = {},
  putBinary: HttpPutBinary = async () => { throw new Error("当前上传通道需要 raw PUT 执行器"); },
): Promise<{ value: unknown; uploaded: number }> {
  const effectiveValue = options.minimizeUploads && options.activeAssetUrls
    ? pruneInactiveLocalAssets(value, new Set(options.activeAssetUrls))
    : value;
  assertNoUnreachableAssetValues(effectiveValue);
  const urls = Array.from(collectLocalAssetUrls(effectiveValue));
  if (urls.length === 0) {
    return { value: effectiveValue === value ? value : stripTransportHints(effectiveValue), uploaded: 0 };
  }
  const urlMap = new Map<string, string>();
  for (const url of urls) {
    const asset = readLocalizableAsset(url, read);
    if (asset && (!asset.contentType || asset.contentType.toLowerCase().split(";")[0].trim() === "application/octet-stream")) {
      throw new Error(`无法识别本地素材「${asset.fileName || describeAssetValue(url)}」的类型，不能安全判断它是图片、视频还是音频。请重新导入并保留正确的文件扩展名。`);
    }
    const mediaKind = mediaKindFromContentType(asset?.contentType);
    if (asset) assertLocalAssetMediaBytes(asset, mediaKind);
    const candidates = resolveIngestion(mediaKind);
    // 本地 ComfyUI（comfyui-upload）：公网 URL 用不了，必须传到它自己的 input 目录换文件名 → 跳过 trusted 快路，恒上传。
    const skipTrusted = candidates[0]?.ingestion.strategy === "comfyui-upload";
    if (!skipTrusted) {
      // sidecar originalUrl（新鲜窗内，见 trustedOriginalUrl）优先:已是公网 URL,不需任何上传通道,
      // 任意媒体类型直接用。过窗 → 走下面的通道解析用本地字节重新换链。
      const trusted = trustedOriginalUrl(asset);
      if (trusted) {
        urlMap.set(url, trusted);
        continue;
      }
    }
    if (candidates.length === 0) {
      throw new Error(
        mediaKind === "video"
          ? "运镜参考视频需要支持视频上传的通道：请在「模型接入」配置 KIE key（免费）或部署 relay。"
          : `没有可用的${mediaKind === "audio" ? "音频" : "图片"}上传通道：请配置一个支持该媒体类型的供应商通道。`,
      );
    }
    // 逐条候选试，谁先换出可达值就用谁。一条失败不等于这个素材没救——最常见的就是 HTTP 413
    // （这条 host 的 body 上限装不下），换一条收得下的就过了（2026-08-20 用户反馈修）。
    const failures: string[] = [];
    let consentRequired = false;
    let resolvedValue: string | null = null;
    for (const candidate of candidates) {
      const visibility = ingestionVisibility(candidate.ingestion);
      const consent = anonymousConsentFromUnknown(options.anonymousConsent ?? "allow");
      if (visibility === "public-anonymous" && !canUseAnonymousAssetHosting(consent)) {
        consentRequired = true;
        failures.push(`${hostLabel(candidate.ingestion)}: 需要先确认公共临时托管`);
        continue;
      }
      if (!ingestionHasSufficientLease(candidate.ingestion, mediaKind)) {
        failures.push(`${hostLabel(candidate.ingestion)}: URL 有效期不足以覆盖${MEDIA_LABEL[mediaKind]}生成`);
        continue;
      }
      try {
        resolvedValue = await resolveLocalAsset(url, candidate.ingestion, candidate.uploadApiKey, read, postJson, postMultipart, putBinary);
        break;
      } catch (error) {
        failures.push(`${hostLabel(candidate.ingestion)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (resolvedValue === null) {
      // Do not hide a failed provider-owned upload behind the anonymous-hosting
      // consent prompt.  That turned a concrete Runway/KIE 4xx into a generic
      // privacy dialog, leaving users unable to repair the actual contract.
      const privateFailures = failures.filter((line) => !line.includes("需要先确认公共临时托管"));
      if (consentRequired && privateFailures.length === 0) throw new AnonymousAssetConsentRequiredError();
      if (consentRequired && privateFailures.length > 0) throw allChannelsFailedError(asset, mediaKind, privateFailures);
      throw allChannelsFailedError(asset, mediaKind, failures);
    }
    urlMap.set(url, resolvedValue);
  }
  return { value: stripTransportHints(replaceLocalAssetUrls(effectiveValue, urlMap)), uploaded: urls.length };
}

/**
 * 可选的 Nomi-owned relay。R2 credential 只放在 Worker，Electron 只拿部署者显式注入的
 * endpoint/token；未配置时返回 null，设置页不会谎报「Nomi relay 已启用」。
 */
function relayCandidate(config: { endpoint: string; token: string }): IngestionCandidate | null {
  const endpoint = config.endpoint;
  const uploadApiKey = config.token;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && !(url.hostname === "127.0.0.1" || url.hostname === "localhost")) return null;
  } catch {
    return null;
  }
  return {
    ingestion: {
      strategy: "upload-multipart",
      endpoint,
      fileField: "file",
      urlPath: "url",
      authType: "bearer",
      accepts: ["image", "video", "audio"],
      visibility: "public-provider",
      ttlSeconds: 24 * 60 * 60,
      ...(uploadApiKey ? { authType: "bearer" as const } : {}),
    },
    uploadApiKey,
    vendorKey: "nomi-relay",
  };
}

/** 自定义/自部署 Relay：环境变量或设置页配置；没有自定义配置时返回 null。 */
export function nomiAssetRelayCandidateFromEnvironment(): IngestionCandidate | null {
  const config = readAssetRelayRuntimeConfig();
  return config.source === "default" ? null : relayCandidate(config);
}

/** Nomi 官方受限公共 Relay：桌面端内置地址，不需要把 R2 Secret 发给用户。 */
export function nomiPublicAssetRelayCandidate(): IngestionCandidate | null {
  return relayCandidate(readDefaultAssetRelayRuntimeConfig());
}

/**
 * 通用素材上传策略解析（带跨供应商 fallback + 内容类型感知）。
 *
 * 返回**按优先级排好的候选通道列表**（不是单个）：目标 vendor 自身 → 其他已配置供应商的上传 API
 *（包括 KIE/APIMart）→ Nomi relay（受控兜底）→ 匿名链（零配置兜底）。
 * 调用方从头试，一条挂了换下一条。
 *
 * 为什么必须是列表（2026-08-20 用户报 HTTP 413）：此前只返回**第一条**，那条一失败整个生成就死。
 * 而 413（文件超过该 host 的 body 上限）恰恰是「换一条就能成」的失败——匿名链的 litterbox 收得下的
 * 文件，KIE/apimart 前面的反代可能直接 413 掉。「fallback」当时只对**能力**（这家收不收 mp4）生效，
 * 对**失败**不生效，于是排在后面那条能接住的通道永远没被试过。
 * 各家的尺寸上限**不硬编码**：官方文档没写、且随时会改；用 413 本身当「这条装不下」的信号即可。
 *
 * 关键：apimart 的 /uploads/images 是 image-only（收 mp4 会 400），故视频素材会跳过 apimart。
 *
 * 返回空数组 = 没有任何接受该媒体类型的上传通道（调用方据此抛诚实错误，如视频缺 KIE/relay）。
 */
export function resolveAssetIngestionWithFallback(
  targetVendor: { key?: string; assetIngestion?: AssetIngestion; baseUrlHint?: string | null } | null | undefined,
  allVendors: Array<{ key?: string; assetIngestion?: AssetIngestion }>,
  getApiKey: (vendorKey: string) => string | null,
  mediaKind: AssetMediaKind = "image",
): Array<IngestionCandidate> {
  const candidates: Array<IngestionCandidate> = [];
  const seen = new Set<string>();
  // 同一个物理端点只试一次（目标 vendor 恰好就是 KIE 时会被推两遍）。
  const push = (ingestion: AssetIngestion | null | undefined, uploadApiKey: string, vendorKey: string | null) => {
    if (!ingestion || ingestion.strategy === "none") return;
    const id = ingestion.strategy === "anon-chain" ? "anon-chain" : `${ingestion.strategy}:${hostLabel(ingestion)}`;
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push({ ingestion, uploadApiKey, vendorKey });
  };
  // 本地 ComfyUI：素材必须传到它自己的 /upload/image 换本地文件名（LoadImage/LoadVideo 都不认公网 URL），
  // 不走 KIE/apimart 中转（那给公网 URL）。端点从 vendor baseUrl 动态派生（用户可改地址）。
  // **视频同走这个端点**——真机 ComfyUI 0.29 实测：POST mp4 进 /upload/image 返回
  // {name,subfolder,type}，返回的文件名当场就出现在 LoadVideo.file 的 combo 选项里。
  // （此处原注释断言「视频是另一套 VHS 机制、非本端点」，是**没验过的假设**，实测证伪。）
  // 它是**唯一**候选，不给 fallback：公网 URL 对 LoadImage 没用，换通道等于换成一个必错的值。
  if (isComfyuiVendor(targetVendor) && (mediaKind === "image" || mediaKind === "video")) {
    const base = String(targetVendor?.baseUrlHint || "http://127.0.0.1:8188").replace(/\/+$/, "");
    return [{ ingestion: { strategy: "comfyui-upload", endpoint: `${base}/upload/image`, accepts: ["image", "video"] }, uploadApiKey: "", vendorKey: targetVendor?.key ?? null }];
  }
  // 1. 目标供应商自己接受该类型 → 直接用（apiKey 也是目标供应商的）
  const targetIngestion = resolveAssetIngestionForKind(targetVendor, mediaKind);
  if (targetIngestion && targetIngestion.strategy !== "none") {
    const key = targetVendor?.key ? (getApiKey(targetVendor.key) ?? "") : "";
    push(targetIngestion, key, targetVendor?.key ?? null);
  }
  // 2. 其他已配置供应商的上传 API。catalog 顺序是既有供应商选择顺序，
  // 不因部署了 Nomi relay 而把所有素材先写入我们的 R2。
  for (const vendor of allVendors) {
    if (!vendor.key || vendor.key === targetVendor?.key) continue;
    const ing = resolveAssetIngestionForKind(vendor, mediaKind);
    if (!ing || ing.strategy === "none" || ing.strategy === "inline-base64") continue;
    const key = getApiKey(vendor.key);
    if (key) push(ing, key, vendor.key);
  }
  // 3. KIE/APIMart 可能未出现在旧存量 catalog；已配置时补入，push 去重。
  const kieKey = getApiKey("kie");
  if (kieKey) push(resolveAssetIngestionForKind({ key: "kie" }, mediaKind), kieKey, "kie");
  if (targetVendor?.key !== "apimart") {
    const apimartKey = getApiKey("apimart");
    if (apimartKey) push(resolveAssetIngestionForKind({ key: "apimart" }, mediaKind), apimartKey, "apimart");
  }
  // 4. Nomi relay：用户自己的 Relay 优先于 Nomi 公共 Relay，二者均只作为受控兜底。
  const nomiRelay = nomiAssetRelayCandidateFromEnvironment();
  if (nomiRelay && ingestionAccepts(nomiRelay.ingestion, mediaKind)) {
    push(nomiRelay.ingestion, nomiRelay.uploadApiKey, nomiRelay.vendorKey);
  }
  const nomiPublicRelay = nomiPublicAssetRelayCandidate();
  if (nomiPublicRelay && ingestionAccepts(nomiPublicRelay.ingestion, mediaKind)) {
    push(nomiPublicRelay.ingestion, nomiPublicRelay.uploadApiKey, nomiPublicRelay.vendorKey);
  }
  // 5. 匿名上传链：零配置兜底（无 key、收任意文件 → 临时公网直链）。多 host 有序 fallback
  //    (litterbox → tmpfiles)，单 host 限速/宕机时自动切下一个。走到这里说明上面更优的通道都没命中
  //    （图片几乎总有 apimart；视频缺 KIE 时此处接住）。NET：上传零配置"开箱即用"，诚实错误
  //    只在链里**所有** host 都不可达时才触发。
  if (ingestionAccepts(ANON_UPLOAD_CHAIN, mediaKind)) push(ANON_UPLOAD_CHAIN, "", null);
  return candidates;
}
