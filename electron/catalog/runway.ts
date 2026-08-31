import type { AssetIngestion } from "./types";

/** Runway 的 ephemeral 文件入口；返回 runway:// URI，只对 Runway 请求有效。 */
export const RUNWAY_VENDOR_SEED = {
  key: "runway",
  name: "Runway",
  baseUrl: "https://api.dev.runwayml.com/v1",
  authType: "bearer" as const,
  authHeader: "Authorization",
  assetIngestion: {
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
  } as AssetIngestion,
} as const;
