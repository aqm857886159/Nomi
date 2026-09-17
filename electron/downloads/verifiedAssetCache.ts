/**
 * 「按需下载的第三方资产」—— 校验、落盘与缓存的**唯一实现**。
 *
 * 由来：这段逻辑原本只住在 `electron/video/depthVideoModelCache.ts` 里（深度权重专用）。
 * 2026-09-17 接本地转写时，需要下载的东西从「一个 onnx 权重」变成「whisper 权重 + sidecar 二进制
 * 压缩包」两家——两家要的保证一模一样（钉死的 URL、精确字节数、sha256、原子落盘、带进度）。
 * 按 P1「加新必删旧」：**不复制第二份**，把主体抽到这里，深度那边变成一层薄壳（家族名 + 类型别名）。
 *
 * ── 三条不许绕的规矩（从深度那份原样继承，理由未变）─────────────────────────────
 * 1. **只走 `hardenedFetch`**。不 new 第二条出站路——目的地策略只有一个 owner
 *    （`electron/networkOutboundPolicy.ts`，`check:outbound-policy` 盯着谁在自己判）。
 *    进度是给 `hardenedFetch` 加了一个流式 sink（`onChunk`）拿到的，不是绕开它拿的。
 * 2. **sha256 边下边算，不匹配就删**。没有「首下即信任、把算出来的哈希写进本地清单」
 *    这种自举分支——那是备忘录不是防线（R17，旧 R28）。清单里的哈希是我们实下载一次算好、
 *    钉死在代码里的。
 * 3. **先落 `.part` 再原子改名**。中断留下的半文件永远不会被当成可用资产：
 *    存在 `<fileName>` 就意味着它已经通过过校验。
 *
 * ── 这一版比深度那版多的一件事 ──────────────────────────────────────────────────
 * **磁盘写满要说人话**。深度权重 50MB，撑爆磁盘是理论问题；whisper 默认档 574MB、最高档 1.08GB，
 * 磁盘满是**真会发生**的一条路（本机写这段时剩 13GB）。所以 `ENOSPC` / `EDQUOT` 单独归一成
 * `disk-full`，调用方据此给「腾出空间再试」而不是「网络错误，重试」——错误文案指错方向
 * 比没有文案更耗人（D4：缺口明着标）。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getSettingsRoot } from "../settings/settingsRoot";
import { ensureDir } from "../runtimePaths";
import { fsyncIfDurable } from "../durability";
import { hardenedFetch } from "../hardenedFetch";
import { logInfo, logWarn } from "../logging/logger";

/**
 * 一件按需下载的资产。字段为什么长这样：
 * · `downloadUrl` 必须钉在**不可变的版本**上（HF 用 commit sha、GitHub 用 release tag），
 *   不用 `resolve/main` / `latest`——上游一前进就把下面钉死的 sha256 变成「哪天突然全员失败」。
 * · `sha256` 是**实下载一次算出来的**，不是抄文档的。
 * · `sizeBytes` 是精确值不是约数：它同时是进度条分母和「响应体是不是被换了」的第一道判据。
 * · `license` 列出来是为了让「能不能商用」在代码里可查，不用回头翻文档。
 */
export type VerifiedAsset = Readonly<{
  id: string;
  /** 落在缓存目录下的文件名（同时是对外白名单键）；不许含路径分隔符。 */
  fileName: string;
  downloadUrl: string;
  sizeBytes: number;
  sha256: string;
  license: string;
  sourcePage: string;
}>;

export type VerifiedDownloadProgress = {
  assetId: string;
  fileName: string;
  doneBytes: number;
  totalBytes: number;
};

export type VerifiedDownloadErrorCode =
  | "download-failed"
  | "checksum-mismatch"
  | "size-mismatch"
  | "disk-full";

export class VerifiedDownloadError extends Error {
  readonly code: VerifiedDownloadErrorCode;
  readonly assetId: string;
  readonly retryable: boolean;

  constructor(input: { code: VerifiedDownloadErrorCode; assetId: string; message: string; retryable: boolean }) {
    super(input.message);
    this.name = "VerifiedDownloadError";
    this.code = input.code;
    this.assetId = input.assetId;
    this.retryable = input.retryable;
  }
}

/** 缓存根：`userData/model-cache/<family>`。跟 `getUserSkillsRoot()` 一个形状，因此白拿 `NOMI_SETTINGS_DIR` 的测试隔离。 */
export function verifiedAssetRoot(family: string): string {
  return path.join(getSettingsRoot(), "model-cache", family);
}

/**
 * 清单里某件资产在磁盘上的绝对路径。
 * `fileName` 来自编译期常量且被测试断言过「无路径分隔符」，所以这里拼出来的路径
 * 不可能越出缓存根——不是靠调用方自觉。
 */
export function verifiedAssetPath(family: string, asset: VerifiedAsset): string {
  return path.join(verifiedAssetRoot(family), asset.fileName);
}

/** 已经下过并通过校验的资产（存在即可用，见文件头第 3 条）。 */
export function isVerifiedAssetCached(family: string, asset: VerifiedAsset): boolean {
  try {
    const stat = fs.statSync(verifiedAssetPath(family, asset));
    return stat.isFile() && stat.size === asset.sizeBytes;
  } catch {
    return false;
  }
}

/** 还需要下载多少字节（用于开跑前告诉用户「这次要先下 N MB」）。 */
export function pendingVerifiedAssetBytes(family: string, assets: readonly VerifiedAsset[]): number {
  return assets.reduce((sum, asset) => (isVerifiedAssetCached(family, asset) ? sum : sum + asset.sizeBytes), 0);
}

/** 清单里所有下载源的 origin——出站白名单与 `check:outbound-policy` 共用。 */
export function verifiedAssetOrigins(assets: readonly VerifiedAsset[]): readonly string[] {
  return [...new Set(assets.map((asset) => new URL(asset.downloadUrl).origin))];
}

/** 磁盘满是它自己一档：文案要指向「腾空间」，不能混进「网络不好，重试」。 */
function isDiskFull(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOSPC" || code === "EDQUOT";
}

async function downloadOne(
  family: string,
  asset: VerifiedAsset,
  options: { onProgress?: (progress: VerifiedDownloadProgress) => void; signal?: AbortSignal },
): Promise<void> {
  const root = verifiedAssetRoot(family);
  ensureDir(root);
  const finalPath = verifiedAssetPath(family, asset);
  // `.part` 名带随机后缀：两个窗口同时触发下载时互不覆盖，最后一个改名的赢，内容一样。
  const partPath = `${finalPath}.${crypto.randomUUID().slice(0, 8)}.part`;

  const hash = crypto.createHash("sha256");
  let handle: fs.promises.FileHandle | null = null;
  let written = 0;
  try {
    handle = await fs.promises.open(partPath, "wx");
    const openHandle = handle;
    await hardenedFetch(asset.downloadUrl, {
      // 清单里的精确大小 +1MB 余量：响应比声明大很多本身就是「不是这个文件」的信号。
      maxBytes: asset.sizeBytes + 1024 * 1024,
      timeoutMs: 30 * 60_000,
      signal: options.signal,
      onChunk: async (chunk, doneBytes) => {
        hash.update(chunk);
        await openHandle.write(chunk);
        written = doneBytes;
        options.onProgress?.({ assetId: asset.id, fileName: asset.fileName, doneBytes, totalBytes: asset.sizeBytes });
      },
    });

    if (written !== asset.sizeBytes) {
      throw new VerifiedDownloadError({
        code: "size-mismatch",
        assetId: asset.id,
        message: `expected ${asset.sizeBytes} bytes, received ${written}`,
        retryable: true,
      });
    }
    const digest = hash.digest("hex");
    if (digest !== asset.sha256) {
      throw new VerifiedDownloadError({
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
    logInfo("downloads", "verified-asset-downloaded", { family, assetId: asset.id, bytes: asset.sizeBytes });
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
    if (error instanceof VerifiedDownloadError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (isDiskFull(error)) {
      logWarn("downloads", "verified-asset-disk-full", { family, assetId: asset.id, needBytes: asset.sizeBytes });
      throw new VerifiedDownloadError({ code: "disk-full", assetId: asset.id, message, retryable: false });
    }
    logWarn("downloads", "verified-asset-download-failed", { family, assetId: asset.id, reason: message });
    throw new VerifiedDownloadError({ code: "download-failed", assetId: asset.id, message, retryable: true });
  }
}

/**
 * 确保这批资产都在本地。已在的跳过（不重下、不重校验——存在即已校验）。
 * 进度按「当前这个文件的字节数」回报；跨文件的总进度由调用方按清单大小自己合成。
 */
export async function ensureVerifiedAssets(
  family: string,
  assets: readonly VerifiedAsset[],
  options: { onProgress?: (progress: VerifiedDownloadProgress) => void; signal?: AbortSignal } = {},
): Promise<void> {
  for (const asset of assets) {
    if (options.signal?.aborted) return;
    if (isVerifiedAssetCached(family, asset)) continue;
    await downloadOne(family, asset, options);
  }
}
