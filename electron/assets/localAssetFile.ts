// nomi-local 素材的文件侧读取 + 上传通道(从 runtime.ts 抽出 —— 规则 12 巨壳净减)。
// R1 用:把本地素材(nomi-local://)读成字节,或 POST 到 vendor 上传端点。
import fs from "node:fs";
import { appFetch } from "../appFetch";
import { resolveProjectRelativePath } from "../projects/repository";
import { resolveContentType } from "./mediaTypes";
import { categorizeVendorFailure } from "../vendor/vendorHttp";
import { maybeResolveVendorBase, rewriteVendorUrl } from "../vendor/vendorBaseFallback";
import type { LocalAsset } from "../catalog/assetLocalization";

/** nomi-local URL → 项目内文件绝对路径(校验 projectId 一致 + 是真实文件);否则 null。 */
export function absolutePathFromLocalAssetUrl(url: unknown, projectId: string): string | null {
  if (typeof url !== "string") return null;
  const prefix = "nomi-local://asset/";
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex < 0) return null;
  let urlProjectId: string;
  let relativePath: string;
  try {
    urlProjectId = decodeURIComponent(rest.slice(0, slashIndex));
    relativePath = rest.slice(slashIndex + 1).split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
  if (urlProjectId !== projectId || !relativePath) return null;
  try {
    const absolutePath = resolveProjectRelativePath(projectId, relativePath);
    return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile() ? absolutePath : null;
  } catch {
    return null;
  }
}

/**
 * 按 URL **自带的 projectId** 解析绝对路径(不强求等于当前项目)——与 readNomiLocalAsset 同口径。
 * C4 修:跨项目把素材库的图/视频拖进当前项目时,节点 URL 仍编源项目 id;生成侧(readNomiLocalAsset)本就
 * 自解析故能跑,但导出/抽帧侧用「当前 projectId 强匹配」→ urlProjectId !== projectId 返回 null → 跨项目素材
 * 在导出里读不到(整体回退 WebM)。统一成「信 URL 自带 id」消除这条不一致(无新暴露:生成侧早已这么读)。
 */
export function absolutePathFromLocalAssetUrlAnyProject(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const prefix = "nomi-local://asset/";
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex < 0) return null;
  let urlProjectId: string;
  try {
    urlProjectId = decodeURIComponent(rest.slice(0, slashIndex));
  } catch {
    return null;
  }
  return absolutePathFromLocalAssetUrl(url, urlProjectId);
}

/** R1：把 nomi-local URL(自带 projectId)读成字节 + contentType + 文件名,供 assetLocalization 上传/内联。
 *  同时读 sidecar `.meta` 文件里的 originalUrl（生成素材落盘时写入），
 *  供 assetLocalization 优先直接使用公网 URL 而无需转 base64 或调供应商上传 API。 */
export function readNomiLocalAsset(url: string, options: { maxBytes?: number } = {}): LocalAsset | null {
  const prefix = "nomi-local://asset/";
  if (typeof url !== "string" || !url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex < 0) return null;
  let projectId: string;
  let relativePath: string;
  try {
    projectId = decodeURIComponent(rest.slice(0, slashIndex));
    relativePath = rest.slice(slashIndex + 1).split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
  const absolutePath = absolutePathFromLocalAssetUrl(url, projectId);
  if (!absolutePath) return null;
  try {
    let boundedBytes: Buffer | undefined;
    if (options.maxBytes !== undefined) {
      if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) return null;
      const fd = fs.openSync(absolutePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        const info = fs.fstatSync(fd);
        if (!info.isFile() || info.size > options.maxBytes) return null;
        const buffer = Buffer.alloc(info.size + 1);
        let used = 0;
        while (used < buffer.length) {
          const n = fs.readSync(fd, buffer, used, buffer.length - used, used);
          if (!n) break;
          used += n;
        }
        if (used !== info.size) return null;
        boundedBytes = buffer.subarray(0, used);
      } finally { fs.closeSync(fd); }
    }
    let originalUrl: string | undefined;
    if (!boundedBytes) try {
      const sidecar = JSON.parse(fs.readFileSync(`${absolutePath}.meta`, "utf8")) as Record<string, unknown>;
      if (typeof sidecar.originalUrl === "string" && /^https?:\/\//i.test(sidecar.originalUrl)) {
        originalUrl = sidecar.originalUrl;
      }
    } catch { /* sidecar 不存在或格式异常，忽略 */ }
    // ageMs：资产落盘至今的毫秒数（mtime 推；生成素材落盘即写、之后不改 → mtime≈providerUrl 铸造时刻）。
    // 供 assetLocalization 判 sidecar originalUrl 是否仍在新鲜窗内（服务商临时链会过期）。
    let ageMs: number | undefined;
    try {
      ageMs = Math.max(0, Date.now() - fs.statSync(absolutePath).mtimeMs);
    } catch { /* stat 失败按未知处理 */ }
    // contentType 认不出时**读文件头**，不能只信扩展名：认不出会被 mediaKindFromContentType
    // 一律当图片，视频于是走进 base64 图片通道被反代 413 顶回来（2026-08-20 用户实测，2 秒的视频
    // 也失败）。字节已在手上，嗅探零额外 IO。
    const bytes = boundedBytes ?? fs.readFileSync(absolutePath);
    return {
      bytes,
      contentType: resolveContentType(absolutePath, bytes),
      fileName: relativePath.split("/").pop() || "asset",
      originalUrl,
      ...(typeof ageMs === "number" ? { ageMs } : {}),
    };
  } catch {
    return null;
  }
}

// 资产上传的瞬态失败有界重试。
//
// 根因(2026-06-28，用户实测）：本地参考图发送前要上传换公网地址，这步经系统代理（Clash 127.0.0.1:7897）。
// undici ProxyAgent 复用 keep-alive 长连接，代理掐掉空闲连接后复用陈旧 socket → connect/ECONNRESET 到
// 127.0.0.1（即「间歇性报 127.0.0.1 的错」）→ 上传一把过即抛 → 参考图拿不到公网地址。多参 = N 次顺序
// 上传 → N 倍撞概率，所以「多参视频」尤其常中。修法：瞬态失败（连接级 / 5xx / 429）有界重试自愈。
//
// 安全边界（[[retry-must-not-wrap-paid-submit]] 铁律）：此重试**只**裹免费的素材上传端点（apimart
// uploads / KIE file-upload / litterbox），绝不裹付费生成提交（那在 vendorHttp.requestJson，另有控制）。
// 重试不会二次扣费——上传不计费、且失败的上传根本没产出可计费结果。
const ASSET_UPLOAD_MAX_ATTEMPTS = 3;
const ASSET_UPLOAD_RETRY_BASE_MS = 400;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// 终态错误（4xx 鉴权/请求问题）包一层标记 → 立即冒泡不重试，区别于连接级瞬态错误。
class NonRetryableUploadError extends Error {
  constructor(readonly original: Error) {
    super(original.message);
    this.name = "NonRetryableUploadError";
  }
}

function uploadErrorDetail(json: unknown): string {
  if (typeof json === "string") {
    // Signed object stores (Runway's S3 upload) return XML rather than JSON.
    // Preserve only the short error fields; never copy a signed URL or the
    // complete untrusted response into the renderer error surface.
    const code = /<Code>([^<]{1,120})<\/Code>/i.exec(json)?.[1]?.trim();
    const message = /<Message>([^<]{1,240})<\/Message>/i.exec(json)?.[1]?.trim();
    return [code, message].filter(Boolean).join(": ") || json.slice(0, 240);
  }
  const record = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  return [record.msg, record.message, record.error].find((value): value is string => typeof value === "string" && value.length > 0) ?? "";
}

/**
 * 跑一次上传请求并按可重试性分诊；瞬态（连接级 / 5xx / 429）有界重试，终态（4xx）立即抛。
 * doFetch 是 thunk：每次重试重新构造请求体（multipart 的 FormData/Blob 重建，避免复用已被读过的流）。
 * opts.delayMs 仅供单测注 0 免真 sleep。
 */
export async function postWithUploadRetry(
  doFetch: () => Promise<Response>,
  opts: { maxAttempts?: number; delayMs?: number; onNetworkError?: (error: unknown) => Promise<void> } = {},
): Promise<unknown> {
  const maxAttempts = opts.maxAttempts ?? ASSET_UPLOAD_MAX_ATTEMPTS;
  const baseDelay = opts.delayMs ?? ASSET_UPLOAD_RETRY_BASE_MS;
  let lastError: Error = new Error("素材上传失败：未知错误");
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await doFetch();
      const text = await response.text();
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = text; }
      if (response.ok) return json;
      const { retryable } = categorizeVendorFailure(response.status);
      const httpError = new Error(`素材上传失败(HTTP ${response.status})：${uploadErrorDetail(json) || "(无详情)"}`);
      if (!retryable) throw new NonRetryableUploadError(httpError); // 4xx 鉴权/请求 → 不重试
      lastError = httpError; // 5xx / 429 → 可重试
    } catch (error) {
      if (error instanceof NonRetryableUploadError) throw error.original;
      // 连接级错误（fetch 抛、无 HTTP 响应）= 代理瞬态（127.0.0.1 reset/timeout 等）→ 可重试；
      // 给调用方一个自愈钩子（vendor 主域被墙 → 探测官方备用域），下次 attempt 的 thunk 即换线。
      if (opts.onNetworkError) await opts.onNetworkError(error).catch(() => {});
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < maxAttempts) await delay(baseDelay * attempt); // 线性退避
  }
  throw lastError;
}

/** R1 上传通道(JSON body):固定可信端点(vendor 声明里),用普通 fetch(与 requestJson 一致)。瞬态失败有界重试。 */
export async function postJsonForAssetUpload(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const serialized = JSON.stringify(body);
  let wireUrl = url;
  return postWithUploadRetry(
    () => {
      wireUrl = rewriteVendorUrl(url); // 每次 attempt 重取——自愈换线后下一跳即生效
      return appFetch(wireUrl, { method: "POST", headers, body: serialized });
    },
    { onNetworkError: async (error) => { await maybeResolveVendorBase(wireUrl, error); } },
  );
}

/** R1 上传通道(multipart/form-data):file 字段二进制 + 可选文本字段(如 KIE stream 的 uploadPath/fileName)。
 *  fileField 默认 "file";litterbox 等匿名托管用 "fileToUpload"。瞬态失败有界重试(每次重建 FormData)。 */
export async function postMultipartForAssetUpload(
  url: string,
  headers: Record<string, string>,
  file: Buffer,
  fileName: string,
  contentType: string,
  extraFields?: Record<string, string>,
  fileField = "file",
): Promise<unknown> {
  // 不手动设 Content-Type，fetch 会自动加 boundary。
  const { "Content-Type": _drop, ...restHeaders } = headers;
  const arrayBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  let wireUrl = url;
  return postWithUploadRetry(
    () => {
      // 每次重试重建 FormData/Blob：Blob 由 ArrayBuffer 支撑可重读，但重建最稳（不赌流是否已被消费）。
      wireUrl = rewriteVendorUrl(url);
      const form = new FormData();
      for (const [key, value] of Object.entries(extraFields ?? {})) form.append(key, value);
      // S3-compatible signed POST policies (Runway) require policy fields to
      // precede the file part.  Appending the file first yields a 400
      // `Bucket POST must contain a field named key` even though every field is
      // present.  Other multipart providers accept either order, so this shared
      // ordering is safe and keeps the presigned path generic.
      form.append(fileField, new Blob([arrayBuffer], { type: contentType }), fileName);
      return appFetch(wireUrl, { method: "POST", headers: restHeaders, body: form });
    },
    { onNetworkError: async (error) => { await maybeResolveVendorBase(wireUrl, error); } },
  );
}

/** 两阶段上传的 signed PUT（例如 fal CDN）。signed URL 已经包含授权，不带供应商 key。 */
export async function putBinaryForAssetUpload(
  url: string,
  headers: Record<string, string>,
  file: Buffer,
  contentType: string,
): Promise<unknown> {
  const arrayBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  let wireUrl = url;
  return postWithUploadRetry(
    () => {
      wireUrl = rewriteVendorUrl(url);
      return appFetch(wireUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType, ...headers },
        body: new Uint8Array(arrayBuffer),
      });
    },
    { onNetworkError: async (error) => { await maybeResolveVendorBase(wireUrl, error); } },
  );
}
