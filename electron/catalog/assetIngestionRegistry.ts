import { APIMART_VENDOR_SEED } from "./apimartVendor";
import { bindIngestionToUserBase } from "./userVendorBase";
import type { AssetIngestion, AssetMediaKind } from "./types";

const APIMART_UPLOAD_PATH = "/v1/uploads/images";

/** 该通道接受哪些媒体类型；缺省视为图片。none 通道不接受任何素材。 */
export function ingestionAccepts(ingestion: AssetIngestion, kind: AssetMediaKind): boolean {
  if (ingestion.strategy === "none") return false;
  if (kind !== "image" && (ingestion.strategy === "inline-base64" || ingestion.strategy === "upload-url")) return false;
  const accepts = ingestion.accepts ?? (["image"] as ReadonlyArray<AssetMediaKind>);
  return accepts.includes(kind);
}

/** 代码级 curated 供应商吞入声明单源；用户自接 vendor 走 Vendor.assetIngestion。 */
export const CURATED_ASSET_INGESTION: Record<string, AssetIngestion> = {
  // KIE 图片走 base64；视频/音频走下面的 stream 声明，避免大文件膨胀成 JSON。
  // 2026-08-24 真机实测：响应只有 data.downloadUrl，且回链有效期按 24h 保守处理。
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
    visibility: "provider-private",
    ttlSeconds: 24 * 60 * 60,
  },
  apimart: {
    strategy: "upload-multipart",
    // 默认值只在「没有用户连接」时用；有连接时由 userVendorBase 按用户保存的 base 重算。
    endpoint: `${APIMART_VENDOR_SEED.baseUrl}${APIMART_UPLOAD_PATH}`,
    endpointPath: APIMART_UPLOAD_PATH,
    urlPath: "url",
    accepts: ["image"],
    visibility: "provider-private",
    ttlSeconds: 72 * 60 * 60,
  },
  modelscope: { strategy: "inline-base64", accepts: ["image"] },
  // fal CDN 的 SDK upload_file 最终返回 public CDN URL；signed PUT 不带 fal key。
  fal: {
    strategy: "upload-initiate-put",
    endpoint: "https://rest.alpha.fal.ai/storage/upload/initiate",
    uploadUrlPath: "upload_url",
    urlPath: "file_url",
    authType: "key",
    accepts: ["image", "video", "audio"],
    visibility: "public-provider",
  },
  // Higgsfield 自有上传（2026-09-17 字节级实测通过，证据 docs/evidence/2026-09-17-higgsfield-contract）：
  //   POST /files/generate-upload-url {content_type}
  //     → { public_url, upload_url, content_type, upload_headers }
  //   PUT 字节到 upload_url（**不带 Higgsfield 凭据**，预签名 URL 自带授权）
  //   参考图给模型用的是 public_url（CloudFront，无需鉴权）
  //
  // 声明它的意义：resolveAssetIngestionWithFallback 的第 2 优先级是「目标 vendor 自己的通道」
  // （assetLocalization.ts），声明之后 Higgsfield 的参考图就**不会**落到第 4 优先级那条
  // 「KIE / APIMart 兜底」上——用户的图不经第三方，也不经匿名图床。
  //
  // uploadHeadersPath 是必须的：预签名 URL 把 x-amz-tagging 算进了签名
  // （X-Amz-SignedHeaders = content-type;host;x-amz-tagging），只发 Content-Type 会 403
  // SignatureDoesNotMatch（实测）。头从响应里读，不写死。
  //
  // ttlSeconds 取 **7 天**：文档只写了「1 小时」，但那是 upload_url 的预签名窗口
  // （X-Amz-Expires=3600）；对象本身的保留是 x-amz-expiration 里的
  // rule-id="Delete after 7 days"。参考图能被模型读多久，看的是后者。
  higgsfield: {
    strategy: "upload-initiate-put",
    endpoint: "https://api.higgsfield.ai/files/generate-upload-url",
    uploadUrlPath: "upload_url",
    uploadHeadersPath: "upload_headers",
    urlPath: "public_url",
    authType: "key",
    accepts: ["image", "video", "audio"],
    visibility: "public-provider",
    ttlSeconds: 7 * 24 * 60 * 60,
  },
  runninghub: {
    strategy: "upload-multipart",
    endpoint: "https://www.runninghub.cn/openapi/v2/media/upload/binary",
    fileField: "file",
    urlPath: "data.download_url",
    authType: "bearer",
    accepts: ["image", "video", "audio"],
    visibility: "provider-private",
    ttlSeconds: 24 * 60 * 60,
  },
};

/** KIE/Runway 的非图片专用上传协议。 */
export const CURATED_VIDEO_INGESTION: Record<string, AssetIngestion> = {
  kie: {
    strategy: "upload-stream",
    endpoint: "https://kieai.redpandaai.co/api/file-stream-upload",
    uploadPathField: "uploadPath",
    uploadPath: "videos/nomi",
    fileNameField: "fileName",
    urlPath: "data.downloadUrl",
    accepts: ["image", "video", "audio"],
    visibility: "provider-private",
    ttlSeconds: 24 * 60 * 60,
  },
  // Runway 初始化拿 uploadUrl + fields + runwayUri，runway:// URI 只交给 Runway。
  runway: {
    strategy: "upload-initiate-multipart",
    endpoint: "https://api.dev.runwayml.com/v1/uploads",
    uploadUrlPath: "uploadUrl",
    fieldsPath: "fields",
    uriPath: "runwayUri",
    fileField: "file",
    initFileNameField: "filename",
    initTypeField: "type",
    initType: "ephemeral",
    authType: "bearer",
    accepts: ["image", "video", "audio"],
    visibility: "provider-private",
    ttlSeconds: 24 * 60 * 60,
  },
};

export const LITTERBOX_INGESTION: AssetIngestion = {
  strategy: "upload-multipart",
  endpoint: "https://litterbox.catbox.moe/resources/internals/api.php",
  responseIsPlainTextUrl: true,
  fileField: "fileToUpload",
  extraFields: { reqtype: "fileupload", time: "24h" },
  accepts: ["image", "video", "audio"],
  visibility: "public-anonymous",
  ttlSeconds: 24 * 60 * 60,
  requiresConsent: true,
};

export const TMPFILES_INGESTION: AssetIngestion = {
  strategy: "upload-multipart",
  endpoint: "https://tmpfiles.org/api/v1/upload",
  fileField: "file",
  urlPath: "data.url",
  urlTransform: { search: "tmpfiles.org/", replace: "tmpfiles.org/dl/" },
  accepts: ["image", "video", "audio"],
  visibility: "public-anonymous",
  ttlSeconds: 60 * 60,
  requiresConsent: true,
};

export const ANON_UPLOAD_CHAIN: AssetIngestion = {
  strategy: "anon-chain",
  chain: [TMPFILES_INGESTION, LITTERBOX_INGESTION],
  accepts: ["image", "video", "audio"],
  visibility: "public-anonymous",
  ttlSeconds: 60 * 60,
  requiresConsent: true,
};

/** 取某 vendor 的主吞入策略：优先持久化声明，回退 curated 注册表。 */
export function resolveAssetIngestion(vendor: { key?: string; assetIngestion?: AssetIngestion; baseUrlHint?: string | null } | null | undefined): AssetIngestion | null {
  if (!vendor) return null;
  if (vendor.assetIngestion) return vendor.assetIngestion;
  if (vendor.key && CURATED_ASSET_INGESTION[vendor.key]) return bindIngestionToUserBase(CURATED_ASSET_INGESTION[vendor.key], vendor);
  return null;
}

/** 按媒体类型取专用通道，再回退主声明。 */
export function resolveAssetIngestionForKind(
  vendor: { key?: string; assetIngestion?: AssetIngestion; baseUrlHint?: string | null } | null | undefined,
  kind: AssetMediaKind,
): AssetIngestion | null {
  if (!vendor) return null;
  if (kind !== "image" && vendor.key && CURATED_VIDEO_INGESTION[vendor.key]) {
    const video = CURATED_VIDEO_INGESTION[vendor.key];
    if (ingestionAccepts(video, kind)) return video;
  }
  const primary = resolveAssetIngestion(vendor);
  return primary && ingestionAccepts(primary, kind) ? primary : null;
}
