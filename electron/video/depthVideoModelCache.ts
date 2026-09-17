/**
 * 深度视频节点 —— 权重按需下载与本地缓存（**薄壳**）。
 *
 * 用户拍板①：权重**不进安装包**，第一次用这个节点时才下载（约 50MB），带进度。
 * 清单在 `electron/shared/canvas/videoDepthModels.ts`，落地目录在 `userData/model-cache/video-depth/`。
 *
 * 2026-09-17（接本地转写时）：下载/校验/原子落盘的**主体搬去了
 * `electron/downloads/verifiedAssetCache.ts`**，因为本地转写要下的 whisper 权重与 sidecar 压缩包
 * 要的是一模一样的保证（钉死 URL、精确字节、sha256、`.part` 原子改名、带进度）。按 P1「加新必删旧」
 * 那份实现在这里已被删除、不留并行版；本文件只剩「深度这一家的家族名 + 给既有调用方的类型别名」。
 * 三条不许绕的规矩（只走 hardenedFetch / sha256 不匹配就删 / 先 .part 再原子改名）原样住在新家的文件头。
 */
import {
  ensureVerifiedAssets,
  isVerifiedAssetCached,
  pendingVerifiedAssetBytes,
  verifiedAssetPath,
  verifiedAssetRoot,
  type VerifiedDownloadProgress,
} from "../downloads/verifiedAssetCache";
import type { VideoDepthModelAsset } from "../shared/canvas/videoDepthModels";

/** 缓存家族名——深度权重与其它按需资产分目录，互不干扰。 */
const FAMILY = "video-depth";

export function getVideoDepthModelRoot(): string {
  return verifiedAssetRoot(FAMILY);
}

export function videoDepthModelPath(asset: VideoDepthModelAsset): string {
  return verifiedAssetPath(FAMILY, asset);
}

export function isVideoDepthModelCached(asset: VideoDepthModelAsset): boolean {
  return isVerifiedAssetCached(FAMILY, asset);
}

export type VideoDepthDownloadProgress = VerifiedDownloadProgress;

export async function ensureVideoDepthModels(
  assets: readonly VideoDepthModelAsset[],
  options: { onProgress?: (progress: VideoDepthDownloadProgress) => void; signal?: AbortSignal } = {},
): Promise<void> {
  return ensureVerifiedAssets(FAMILY, assets, options);
}

/** 还需要下载多少字节（用于开跑前告诉用户「这次要先下 50MB」）。 */
export function pendingVideoDepthDownloadBytes(assets: readonly VideoDepthModelAsset[]): number {
  return pendingVerifiedAssetBytes(FAMILY, assets);
}
