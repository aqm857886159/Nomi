import type { AssetIngestion } from "./types";

/** fal.ai 的通用连接档案；模型 endpoint 仍由用户选择，CDN 上传能力在这里集中声明。 */
export const FAL_VENDOR_SEED = {
  key: "fal",
  name: "fal.ai",
  baseUrl: "https://fal.run",
  authType: "bearer" as const,
  authHeader: "Authorization",
  assetIngestion: {
    strategy: "upload-initiate-put",
    endpoint: "https://rest.alpha.fal.ai/storage/upload/initiate",
    uploadUrlPath: "upload_url",
    urlPath: "file_url",
    authType: "key",
    accepts: ["image", "video", "audio"],
    visibility: "public-provider",
  } as AssetIngestion,
} as const;
