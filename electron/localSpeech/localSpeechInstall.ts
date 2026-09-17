/**
 * 本地转写 —— 引擎与权重的**安装**（下载、校验、解包、落盘）。
 *
 * 下载本身不在这里：它走 `electron/downloads/verifiedAssetCache.ts`（钉死 URL、精确字节、sha256、
 * `.part` 原子改名、带进度、磁盘满单独成档），与深度权重是同一份实现（P1）。这里只多做两件
 * 那一层管不着的事：
 *
 *  ① **解包**。引擎发的是 zip。**不自己写解压器**——macOS 与 Windows 10+ 都自带 bsdtar
 *     （`tar -xf` 认 zip），系统已经给的能力不许再长一份自研版（R17/框架边界）。
 *  ② **解包后逐个文件复验 sha256**。压缩包校验通过只证明「下到的 zip 是那个 zip」，
 *     证明不了解包器把哪些字节写到了哪里。Windows 那四个 MSVC 运行时 DLL 尤其不能少一个
 *     （少了是 0xC0000135 闪退，OpenWhispr CUS-113）——所以它们和 exe 一样是成员清单里的一条，
 *     不是「可选依赖」。
 *
 * 安装是**原子的**：先解到临时目录、逐条验完，再整目录 rename 到位。`engineDir` 存在
 * 就意味着里面每个文件都验过——与下载那层「存在即已校验」是同一条不变量。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
  ensureVerifiedAssets,
  isVerifiedAssetCached,
  pendingVerifiedAssetBytes,
  verifiedAssetPath,
  verifiedAssetRoot,
  VerifiedDownloadError,
  type VerifiedDownloadProgress,
} from "../downloads/verifiedAssetCache";
import { ensureDir } from "../runtimePaths";
import { logInfo } from "../logging/logger";
import {
  LOCAL_SPEECH_CACHE_FAMILY,
  LOCAL_SPEECH_ENGINE_RELEASE,
  LOCAL_SPEECH_VAD_MODEL,
  localSpeechEngineForPlatform,
  type LocalSpeechEnginePlatform,
  type LocalSpeechTier,
} from "../shared/localSpeech/localSpeechAssets";
import { localSpeechFailure, LocalSpeechError } from "./localSpeechErrors";

export type LocalSpeechInstallProgress = {
  /** 已下载字节 / 这次一共要下多少字节（引擎 + 权重合起来算，用户只关心一个数）。 */
  doneBytes: number;
  totalBytes: number;
};

/** 引擎解包后的目录。带 release 号：换版本 = 换目录，旧版本不会被误当成新版本。 */
export function localSpeechEngineDir(engine: LocalSpeechEnginePlatform): string {
  return path.join(verifiedAssetRoot(LOCAL_SPEECH_CACHE_FAMILY), `engine-${LOCAL_SPEECH_ENGINE_RELEASE}-${engine.platformKey}`);
}

export function localSpeechExecutablePath(engine: LocalSpeechEnginePlatform): string {
  return path.join(localSpeechEngineDir(engine), engine.executableFileName);
}

/** 装好了 = 清单里每个成员都在、且字节数对得上（sha 在安装那一刻验过，见文件头）。 */
export function isLocalSpeechEngineInstalled(engine: LocalSpeechEnginePlatform): boolean {
  const dir = localSpeechEngineDir(engine);
  return engine.members.every((member) => {
    try {
      const stat = fs.statSync(path.join(dir, member.fileName));
      return stat.isFile() && stat.size === member.sizeBytes;
    } catch {
      return false;
    }
  });
}

/** 这次点下去要先下多少字节（开跑前就要能告诉用户「首次使用需下载 ≈ N MB」）。 */
export function pendingLocalSpeechBytes(tier: LocalSpeechTier, engine: LocalSpeechEnginePlatform | undefined): number {
  // VAD 模型和权重一起算进分母：它是跑起来的必需件（见清单文件头④），不是可选加料，
  // 分母漏了它，进度条会在最后那 885 KB 上停在 100% 不动。
  const modelBytes = pendingVerifiedAssetBytes(LOCAL_SPEECH_CACHE_FAMILY, [tier.model, LOCAL_SPEECH_VAD_MODEL]);
  if (!engine) return modelBytes;
  const engineBytes = isLocalSpeechEngineInstalled(engine) ? 0 : engine.archive.sizeBytes;
  return modelBytes + engineBytes;
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/** `tar -xf` 解 zip：系统自带 bsdtar（macOS、Windows 10+）认 zip，不自研解压器。 */
function extractArchive(archivePath: string, intoDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xf", archivePath, "-C", intoDir], { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => reject(localSpeechFailure("extract-failed", error.message)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(localSpeechFailure("extract-failed", `tar exit ${code}: ${stderr.trim().slice(-200)}`));
    });
  });
}

/** 下载层的错误码 → 本地转写的错误族（同一件事在两层各有各的说法，翻译一次，不各写一套文案）。 */
function translateDownloadError(error: unknown): LocalSpeechError {
  if (error instanceof VerifiedDownloadError) {
    if (error.code === "checksum-mismatch" || error.code === "size-mismatch") {
      return localSpeechFailure("checksum-mismatch", `${error.assetId}: ${error.message}`);
    }
    if (error.code === "disk-full") return localSpeechFailure("disk-full", error.message);
    return localSpeechFailure("download-failed", error.message);
  }
  if (error instanceof LocalSpeechError) return error;
  return localSpeechFailure("download-failed", error instanceof Error ? error.message : String(error));
}

async function installEngine(
  engine: LocalSpeechEnginePlatform,
  options: { onProgress?: (progress: VerifiedDownloadProgress) => void; signal?: AbortSignal },
): Promise<void> {
  if (isLocalSpeechEngineInstalled(engine)) return;
  try {
    await ensureVerifiedAssets(LOCAL_SPEECH_CACHE_FAMILY, [engine.archive], options);
  } catch (error) {
    throw translateDownloadError(error);
  }
  const archivePath = verifiedAssetPath(LOCAL_SPEECH_CACHE_FAMILY, engine.archive);
  const finalDir = localSpeechEngineDir(engine);
  const stageDir = `${finalDir}.${crypto.randomUUID().slice(0, 8)}.stage`;
  try {
    ensureDir(stageDir);
    await extractArchive(archivePath, stageDir);
    for (const member of engine.members) {
      const memberPath = path.join(stageDir, member.fileName);
      if (!fs.existsSync(memberPath)) throw localSpeechFailure("extract-failed", `missing ${member.fileName}`);
      const size = fs.statSync(memberPath).size;
      if (size !== member.sizeBytes) {
        throw localSpeechFailure("checksum-mismatch", `${member.fileName}: expected ${member.sizeBytes} bytes, got ${size}`);
      }
      const digest = sha256File(memberPath);
      if (digest !== member.sha256) {
        throw localSpeechFailure("checksum-mismatch", `${member.fileName}: sha256 ${digest}`);
      }
    }
    // 可执行位：zip 不一定带住权限位，与 ffmpeg 那条链同一个自愈动作（ensureExecutable 的同款理由）。
    fs.chmodSync(path.join(stageDir, engine.executableFileName), 0o755);
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(stageDir, finalDir);
    logInfo("local-speech", "engine-installed", { platformKey: engine.platformKey, release: LOCAL_SPEECH_ENGINE_RELEASE });
  } catch (error) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    if (error instanceof LocalSpeechError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw localSpeechFailure((error as { code?: string } | null)?.code === "ENOSPC" ? "disk-full" : "extract-failed", message);
  } finally {
    // 压缩包只在安装那一刻有用；留着会让「还要不要下」多一个真相源。
    try {
      fs.rmSync(archivePath, { force: true });
    } catch {
      /* 删不掉不影响已装好的引擎 */
    }
  }
}

/**
 * 确保这一档能跑：引擎装好、权重在盘上。返回可执行文件与权重的绝对路径。
 * 进度回报的是**这次要下的总字节**里已完成多少——引擎和权重合起来算一根进度条。
 */
export async function ensureLocalSpeechReady(
  tier: LocalSpeechTier,
  options: { onProgress?: (progress: LocalSpeechInstallProgress) => void; signal?: AbortSignal } = {},
): Promise<{ executablePath: string; modelPath: string; vadModelPath: string }> {
  const engine = localSpeechEngineForPlatform();
  if (!engine) throw localSpeechFailure("unsupported-platform", `${process.platform}-${process.arch}`);

  const totalBytes = pendingLocalSpeechBytes(tier, engine);
  let completedBytes = 0;
  const report = (progress: VerifiedDownloadProgress) => {
    options.onProgress?.({ doneBytes: Math.min(completedBytes + progress.doneBytes, totalBytes), totalBytes });
    if (progress.doneBytes === progress.totalBytes) completedBytes += progress.totalBytes;
  };
  if (totalBytes > 0) options.onProgress?.({ doneBytes: 0, totalBytes });

  await installEngine(engine, { onProgress: report, signal: options.signal });
  const needed = [tier.model, LOCAL_SPEECH_VAD_MODEL].filter((asset) => !isVerifiedAssetCached(LOCAL_SPEECH_CACHE_FAMILY, asset));
  if (needed.length > 0) {
    try {
      await ensureVerifiedAssets(LOCAL_SPEECH_CACHE_FAMILY, needed, { onProgress: report, signal: options.signal });
    } catch (error) {
      throw translateDownloadError(error);
    }
  }
  if (options.signal?.aborted) throw localSpeechFailure("cancelled", tier.id);
  // 下载那层遇到 abort 会安静返回，不抛——所以这里要自己确认东西真的在盘上，
  // 否则「取消」会伪装成「装好了」，下一步以一个不存在的路径起进程（静默空结果的经典来路）。
  if (!isLocalSpeechEngineInstalled(engine)) throw localSpeechFailure("download-failed", engine.archive.id);
  for (const asset of [tier.model, LOCAL_SPEECH_VAD_MODEL]) {
    if (!isVerifiedAssetCached(LOCAL_SPEECH_CACHE_FAMILY, asset)) throw localSpeechFailure("download-failed", asset.id);
  }
  return {
    executablePath: localSpeechExecutablePath(engine),
    modelPath: verifiedAssetPath(LOCAL_SPEECH_CACHE_FAMILY, tier.model),
    vadModelPath: verifiedAssetPath(LOCAL_SPEECH_CACHE_FAMILY, LOCAL_SPEECH_VAD_MODEL),
  };
}
