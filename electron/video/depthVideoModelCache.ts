/**
 * 深度视频节点 —— 权重按需下载与本地缓存。
 *
 * 用户拍板①：权重**不进安装包**，第一次用这个节点时才下载（约 50MB），带进度。
 * 这个模块是那句话的全部实现：清单在 `electron/shared/canvas/videoDepthModels.ts`，
 * 落地目录在 `userData/model-cache/video-depth/`，出站判定借用**唯一的**那个 owner。
 *
 * ── 三条不许绕的规矩 ────────────────────────────────────────────────────────────
 * 1. **只走 `hardenedFetch`**。不 new 第二条出站路——目的地策略只有一个 owner
 *    （`electron/networkOutboundPolicy.ts`，`check:outbound-policy` 盯着谁在自己判）。
 *    进度是给 `hardenedFetch` 加了一个流式 sink（`onChunk`）拿到的，不是绕开它拿的。
 * 2. **sha256 边下边算，不匹配就删**。没有「首下即信任、把算出来的哈希写进本地清单」
 *    这种自举分支——那是备忘录不是防线（R28）。清单里的哈希是我们实下载一次算好、
 *    钉死在代码里的。
 * 3. **先落 `.part` 再原子改名**。中断留下的半文件永远不会被当成可用权重：
 *    存在 `<fileName>` 就意味着它已经通过过校验。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getSettingsRoot } from "../settings/settingsRoot";
import { ensureDir } from "../runtimePaths";
import { fsyncIfDurable } from "../durability";
import { hardenedFetch } from "../hardenedFetch";
import { logInfo, logWarn } from "../logging/logger";
import type { VideoDepthModelAsset } from "../shared/canvas/videoDepthModels";

/** 权重缓存根。跟 `getUserSkillsRoot()` 一个形状，因此白拿 `NOMI_SETTINGS_DIR` 的测试隔离。 */
export function getVideoDepthModelRoot(): string {
  return path.join(getSettingsRoot(), "model-cache", "video-depth");
}

/**
 * 清单里某个权重在磁盘上的绝对路径。
 * `fileName` 来自编译期常量且被测试断言过「无路径分隔符」，所以这里拼出来的路径
 * 不可能越出缓存根——不是靠调用方自觉。
 */
export function videoDepthModelPath(asset: VideoDepthModelAsset): string {
  return path.join(getVideoDepthModelRoot(), asset.fileName);
}

/** 已经下过并通过校验的权重（存在即可用，见文件头第 3 条）。 */
export function isVideoDepthModelCached(asset: VideoDepthModelAsset): boolean {
  try {
    const stat = fs.statSync(videoDepthModelPath(asset));
    return stat.isFile() && stat.size === asset.sizeBytes;
  } catch {
    return false;
  }
}

export type VideoDepthDownloadProgress = {
  assetId: string;
  fileName: string;
  doneBytes: number;
  totalBytes: number;
};

export class VideoDepthModelDownloadError extends Error {
  readonly code: "download-failed" | "checksum-mismatch" | "size-mismatch";
  readonly assetId: string;
  readonly retryable: boolean;

  constructor(input: { code: VideoDepthModelDownloadError["code"]; assetId: string; message: string; retryable: boolean }) {
    super(input.message);
    this.name = "VideoDepthModelDownloadError";
    this.code = input.code;
    this.assetId = input.assetId;
    this.retryable = input.retryable;
  }
}

async function downloadOne(
  asset: VideoDepthModelAsset,
  options: { onProgress?: (progress: VideoDepthDownloadProgress) => void; signal?: AbortSignal },
): Promise<void> {
  const root = getVideoDepthModelRoot();
  ensureDir(root);
  const finalPath = videoDepthModelPath(asset);
  // `.part` 名带随机后缀：两个窗口同时触发下载时互不覆盖，最后一个改名的赢，内容一样。
  const partPath = `${finalPath}.${crypto.randomUUID().slice(0, 8)}.part`;

  const hash = crypto.createHash("sha256");
  let handle: fs.promises.FileHandle | null = null;
  let written = 0;
  try {
    handle = await fs.promises.open(partPath, "wx");
    const openHandle = handle;
    await hardenedFetch(
      asset.downloadUrl,
      {
        // 清单里的精确大小 +1MB 余量：响应比声明大很多本身就是「不是这个文件」的信号。
        maxBytes: asset.sizeBytes + 1024 * 1024,
        timeoutMs: 15 * 60_000,
        signal: options.signal,
        onChunk: async (chunk, doneBytes) => {
          hash.update(chunk);
          await openHandle.write(chunk);
          written = doneBytes;
          options.onProgress?.({
            assetId: asset.id,
            fileName: asset.fileName,
            doneBytes,
            totalBytes: asset.sizeBytes,
          });
        },
      },
    );

    if (written !== asset.sizeBytes) {
      throw new VideoDepthModelDownloadError({
        code: "size-mismatch",
        assetId: asset.id,
        message: `expected ${asset.sizeBytes} bytes, received ${written}`,
        retryable: true,
      });
    }
    const digest = hash.digest("hex");
    if (digest !== asset.sha256) {
      throw new VideoDepthModelDownloadError({
        code: "checksum-mismatch",
        assetId: asset.id,
        message: `sha256 mismatch: expected ${asset.sha256}, got ${digest}`,
        retryable: false,
      });
    }
    fsyncIfDurable(openHandle.fd);
    await openHandle.close();
    handle = null;
    // rename 是原子的：`finalPath` 出现的那一刻，它已经通过了大小与哈希两道校验。
    await fs.promises.rename(partPath, finalPath);
    logInfo("video-depth", "model-downloaded", { assetId: asset.id, bytes: asset.sizeBytes });
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        /* 关不掉也要继续清理半文件 */
      }
    }
    try {
      await fs.promises.unlink(partPath);
    } catch {
      /* 半文件已经不在了 */
    }
    if (error instanceof VideoDepthModelDownloadError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    logWarn("video-depth", "model-download-failed", { assetId: asset.id, reason: message });
    throw new VideoDepthModelDownloadError({
      code: "download-failed",
      assetId: asset.id,
      message,
      retryable: true,
    });
  }
}

/**
 * 确保这批权重都在本地。已在的跳过（不重下、不重校验——存在即已校验）。
 * 进度按「当前这个文件的字节数」回报；跨文件的总进度由调用方按清单大小自己合成。
 */
export async function ensureVideoDepthModels(
  assets: readonly VideoDepthModelAsset[],
  options: { onProgress?: (progress: VideoDepthDownloadProgress) => void; signal?: AbortSignal } = {},
): Promise<void> {
  for (const asset of assets) {
    if (options.signal?.aborted) return;
    if (isVideoDepthModelCached(asset)) continue;
    await downloadOne(asset, options);
  }
}

/** 还需要下载多少字节（用于开跑前告诉用户「这次要先下 50MB」）。 */
export function pendingVideoDepthDownloadBytes(assets: readonly VideoDepthModelAsset[]): number {
  return assets.reduce((sum, asset) => (isVideoDepthModelCached(asset) ? sum : sum + asset.sizeBytes), 0);
}
