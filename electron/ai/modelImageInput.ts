// 交给模型「看」的图：本机素材、data: URI、远程地址 → 一段字节 + 图片类型。全仓只这一处取图。
//
// 2026-10-21 文本任务迁 pi-ai 单次调用：pi 的图片入参只收 base64（ImageContent），于是远程图从「把 URL 交给上游自己取」
// 改成**本机取回再内联**（协调 10-21 定，D4）。这改变了「谁去取图」，所以取图必须走出站唯一的那条硬化取回：
//   · hardenedFetch 默认跟跳转，跨域跳转剥凭据头（结果图常走 CDN 跳转，不能「不跟」）；不按地址拦，只认响应类型；
//   · 类型只收 png / jpeg / webp / gif，上限 20MB。
// Antigravity（本机官方 CLI）走同一个函数，只是按它自己的进程约束收紧（不跟跳转、不收 gif）。
import { readNomiLocalAsset } from "../assets/localAssetFile";
import { hardenedFetch, type HardenedFetchDependencies } from "../hardenedFetch";
import { MEDIA_IMPORT_SURFACES } from "../shared/contracts/mediaImportPolicy";

/** 上限只登记在媒体导入的唯一主人那里（MEDIA_IMPORT_SURFACES 的 model-image-input），这里只读。 */
export const MODEL_IMAGE_MAX_BYTES = MEDIA_IMPORT_SURFACES["model-image-input"].hardCapBytes!;
export const MODEL_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type ModelImageBytes = { bytes: Uint8Array; mimeType: string };

export class ModelImageUnreadableError extends Error {
  constructor(message: string, readonly url: string) {
    super(message);
    this.name = "ModelImageUnreadableError";
  }
}

export type ReadModelImageOptions = {
  signal?: AbortSignal;
  /** 收哪些类型。缺省 png / jpeg / webp / gif。 */
  types?: readonly string[];
  /** 远程图跟不跟跳转。缺省跟（跨域跳转剥凭据头）。 */
  allowRedirect?: boolean;
};

const DATA_URI = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i;

export async function readModelImage(url: string, options: ReadModelImageOptions = {},
  dependencies?: HardenedFetchDependencies): Promise<ModelImageBytes> {
  options.signal?.throwIfAborted();
  const types = options.types ?? MODEL_IMAGE_TYPES;
  let bytes: Uint8Array;
  let mimeType: string;
  if (url.startsWith("nomi-local://")) {
    const asset = readNomiLocalAsset(url, { maxBytes: MODEL_IMAGE_MAX_BYTES });
    // 这句话是迁移前就有的错误契约（单图读不出时原样给用户），保留。
    if (!asset || !asset.contentType.startsWith("image/")) throw new ModelImageUnreadableError("Local image attachment is missing or unreadable", url);
    bytes = asset.bytes;
    mimeType = asset.contentType.split(";")[0]!.trim().toLowerCase();
  } else if (url.startsWith("data:")) {
    if (url.length > Math.ceil(MODEL_IMAGE_MAX_BYTES / 3) * 4 + 64) throw new ModelImageUnreadableError("Inline image is too large", url);
    const match = DATA_URI.exec(url);
    if (!match || match[2]!.length % 4 !== 0) throw new ModelImageUnreadableError("Inline image is not a base64 image", url);
    bytes = Buffer.from(match[2]!, "base64");
    mimeType = match[1]!.toLowerCase();
  } else if (/^https?:\/\//i.test(url)) {
    const fetchOptions = { signal: options.signal, maxBytes: MODEL_IMAGE_MAX_BYTES, timeoutMs: 20_000,
      allowContentTypes: types, ...(options.allowRedirect === false ? { allowRedirect: false } : {}) };
    const response = dependencies ? await hardenedFetch(url, fetchOptions, dependencies) : await hardenedFetch(url, fetchOptions);
    bytes = response.bytes;
    mimeType = response.contentType.split(";")[0]!.trim().toLowerCase();
  } else {
    throw new ModelImageUnreadableError("Unsupported image address", url);
  }
  options.signal?.throwIfAborted();
  if (!bytes.length || bytes.length > MODEL_IMAGE_MAX_BYTES || !types.includes(mimeType)) {
    throw new ModelImageUnreadableError(`Unsupported image (${mimeType || "unknown type"}, ${bytes.length} bytes)`, url);
  }
  return { bytes, mimeType };
}
