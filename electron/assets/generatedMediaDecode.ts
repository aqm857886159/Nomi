// 「这个生成产物能不能解码」的**唯一**判定（2026-09-29，Seedream 5.0：供应商出了图，Nomi 判 decode_failed）。
//
// 病根不在某一家供应商，在这条判定的**定义**：它问的是「解码器一句抱怨都没有」——
// `-xerror`（任何一个解码错误、包括第一张图之后的尾包错误，都让 ffmpeg 退出 1）叠 `-err_detect explode`
// （解码器碰到最轻微的异常就中止）。用户要的是另一件事：「我能不能拿到这张图」。
//
// 实测（随包 ffmpeg 4.1，20181217；矩阵写在 docs/fixes/2026-09-29-generated-media-decode-verdict.root-cause.json 的
// generality_proof 里，可重跑的版本就是同目录的 generatedMediaDecode.test.ts——它用随包 ffmpeg 现场编码同样的输入）：
//   · PNG 后面多了几个字节（IEND 之后的尾数据，常见于带水印 / 元数据 / CDN 补丁的产物）：`-xerror` 判 1，
//     而它是一张完整、可显示的图——旧判定把已经付了钱的图当成失败；
//   · JPEG 的畸形 EXIF / APP 段、XMP、JSON 元数据、尾部垃圾：解码器只是抱怨或干脆不吭声，图完好；
//   · 真损坏（随机字节顶着 JPEG 魔数、PNG 内部位翻转、WebP 截半）：解码器一帧都出不来。
// 所以新定义 = **解码器把第一帧画面拿出来了，且宽高是真的**。这是一个**事实**（有没有一帧、多大），
// 不是对解码器措辞的评价：抱怨照样记进日志（下面 `recordDecode`），但不再决定判决。
//
// 三态判决，因为「没法检查」和「检查了、读不出来」对用户是两件事、对日志也是：
//   · decodable   —— 出了一帧且宽高为正；
//   · undecodable —— ffmpeg 跑完了（或自己退出了）却没有产出一帧；
//   · unverified  —— 我们这边没能把检查跑完（超时 / 解码器起不来）。仍然拒收（不是评判已经验证过的图），
//                    但日志里写明是「没验证成」而不是「读不出来」。
//
// 超时随文件大小放宽：以前固定 12 秒，一张大图在忙的机器上（杀毒实时扫描、同时别的进程占满磁盘）就会被判失败。
// 判决不再拿超时当「文件有问题」的证据——超时是「没验证成」，且有随大小放宽的余量。
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { MEDIA_DECODER_PROTOCOL_WHITELIST } from "../export/mediaProbe";
import { logInfo, logWarn } from "../logging/logger";
import { tagNomiError } from "../shared/nomiErrorCodes";
import { removeScratchAfterUseSync } from "./scratchCleanup";

export type GeneratedMediaKind = "image" | "video" | "audio";

/** 判决的全部可能。`message` 是 ffmpeg 的原话（截断后），只给日志，不给用户界面。 */
export type DecodeVerdict =
  | Readonly<{ verdict: "decodable"; width?: number; height?: number; message: string }>
  | Readonly<{ verdict: "undecodable"; reason: "decoder_exit" | "no_frame" | "no_dimensions"; message: string }>
  | Readonly<{ verdict: "unverified"; reason: "timeout" | "decoder_unavailable"; message: string }>;

/** 12 秒是旧的固定上限，留作**底**：小文件的行为不变；大文件在这上面按大小加。 */
export const DECODE_TIMEOUT_BASE_MS = 12_000;
/** 每 MiB 多给 1 秒——随包 ffmpeg 4.1 单线程解码大 PNG 也远快于此，余量留给杀毒扫描与磁盘排队。 */
export const DECODE_TIMEOUT_PER_MIB_MS = 1_000;
/** 主进程这一步是同步的（`spawnSync`），所以要有天花板：再大的文件也不许把主进程冻住超过两分钟。 */
export const DECODE_TIMEOUT_CAP_MS = 120_000;

export function decodeTimeoutMs(byteLength: number): number {
  const mib = Math.max(0, Number.isFinite(byteLength) ? byteLength : 0) / (1024 * 1024);
  return Math.min(DECODE_TIMEOUT_CAP_MS, Math.round(DECODE_TIMEOUT_BASE_MS + mib * DECODE_TIMEOUT_PER_MIB_MS));
}

/**
 * 解码这一段字节要跑的 ffmpeg 参数。刻意**没有** `-xerror` / `-err_detect explode`：
 * 判决看「出没出画面」，不看解码器有没有抱怨。`framehash` 把「第几帧、多大」打到 stdout，
 * 判决据此读事实；`-v error` 让真正的错误仍然写进 stderr，供日志记录。
 */
export function decodeInvocation(kind: GeneratedMediaKind, inputPath: string): string[] {
  return [
    "-hide_banner", "-v", "error",
    "-protocol_whitelist", MEDIA_DECODER_PROTOCOL_WHITELIST,
    "-i", inputPath,
    "-map", kind === "audio" ? "0:a:0" : "0:v:0",
    ...(kind === "audio" ? ["-t", "1"] : ["-frames:v", "1"]),
    "-f", "framehash", "-hash", "crc32", "-",
  ];
}

type DecodeRun = Pick<SpawnSyncReturns<string>, "status" | "signal" | "stdout" | "stderr"> & {
  error?: { code?: string; message?: string };
};

/** 一次 ffmpeg 运行 → 判决。纯函数：单测直接喂真实输出 / 模拟输出。 */
export function interpretDecodeRun(kind: GeneratedMediaKind, run: DecodeRun): DecodeVerdict {
  const message = String(run.stderr ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (run.error) {
    const timedOut = run.error.code === "ETIMEDOUT";
    // 输出爆缓冲（ENOBUFS）= ffmpeg 对这个文件吐了上百 KB 的错误，不是「没验证成」而是它真的一团糟。
    if (run.error.code === "ENOBUFS") return { verdict: "undecodable", reason: "decoder_exit", message };
    return {
      verdict: "unverified",
      reason: timedOut ? "timeout" : "decoder_unavailable",
      message: message || String(run.error.message ?? run.error.code ?? ""),
    };
  }
  if (run.status !== 0) return { verdict: "undecodable", reason: "decoder_exit", message };
  const stdout = String(run.stdout ?? "");
  const frames = stdout.split(/\r?\n/).filter((line) => /^0,/.test(line)).length;
  if (frames < 1) return { verdict: "undecodable", reason: "no_frame", message };
  if (kind === "audio") return { verdict: "decodable", message };
  const dimensions = /^#dimensions 0: (\d+)x(\d+)$/m.exec(stdout);
  const width = Number(dimensions?.[1]);
  const height = Number(dimensions?.[2]);
  if (!(width > 0) || !(height > 0)) return { verdict: "undecodable", reason: "no_dimensions", message };
  return { verdict: "decodable", width, height, message };
}

/**
 * 生成产物校验失败（落盘前的字节 / 解码检查没过）。结构化类型让取回器不读人话就知道：同一份字节再校验
 * 一万次也是同一个结论（#975 V-975：坏 MP4 被当成暂时错误，每 15 秒整段重下一次）。
 */
export class GeneratedMediaValidationError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(tagNomiError("output-unreadable", `Generated media validation failed (${reason})`));
    this.name = "GeneratedMediaValidationError";
    this.reason = reason;
  }
}

/** 生成产物校验失败的**唯一**抛法：带机器码，渲染层按码归类，不靠这句英文。 */
export function generatedMediaValidationError(reason: string): GeneratedMediaValidationError {
  return new GeneratedMediaValidationError(reason);
}

export type GeneratedMediaDecodeInput = {
  kind: GeneratedMediaKind;
  bytes: Uint8Array;
  /** 调用方已有的、Nomi 自己拥有的文件路径（MP4 的 moov 常在尾部，管道读不了，必须给可 seek 的文件）。 */
  sourcePath?: string;
  contentType: string;
};

export type GeneratedMediaDecodeDeps = {
  run?: (command: string, args: string[], options: { timeout: number }) => DecodeRun;
  resolveFfmpeg?: () => string;
};

function defaultRun(command: string, args: string[], options: { timeout: number }): DecodeRun {
  return spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeout,
    // stdout 只有几行 framehash；stderr 给足空间（一个糟糕的文件可以逐包报错），爆了算「一团糟」，见 interpretDecodeRun。
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

/**
 * ffmpeg 的原话进日志，判决不受它左右。「抱怨了但出图」也记一笔：以后真实供应商的产物长什么样、
 * 解码器对它说了什么，日志里有据可查——不用再等下一次用户报障才去猜。
 */
function recordDecode(input: GeneratedMediaDecodeInput, verdict: DecodeVerdict, timeoutMs: number, elapsedMs: number): void {
  const fields = {
    kind: input.kind,
    contentType: input.contentType,
    bytes: input.bytes.byteLength,
    verdict: verdict.verdict,
    ms: elapsedMs,
    timeoutMs,
    decoderMessage: verdict.message,
    ...("reason" in verdict ? { reason: verdict.reason } : {}),
    ...(verdict.verdict === "decodable" && verdict.width ? { width: verdict.width, height: verdict.height } : {}),
  };
  if (verdict.verdict === "decodable") {
    if (verdict.message) logInfo("assets", "generated-media-decoded-with-warnings", fields);
    return;
  }
  logWarn("assets", "generated-media-decode-rejected", fields);
}

/**
 * 校验一份**生成产物**的字节能不能被解码。不能 → 抛带机器码的错（渲染层说「生成的文件没能读出来」，
 * 不说「服务商失败了」、不劝换一家）。能 → 静默返回。
 */
export function verifyGeneratedMediaDecodes(input: GeneratedMediaDecodeInput, deps: GeneratedMediaDecodeDeps = {}): DecodeVerdict {
  // MP4/MOV 的索引（moov）常在文件尾：走管道的话 ffmpeg 会报 partial file（管道不能 seek）。
  // 所以字节要落在一个 0600 的临时文件里再读——除非调用方已经有一个 Nomi 自己拥有的路径。
  let validationPath = input.sourcePath;
  let validationDir = "";
  if (!validationPath || !fs.existsSync(validationPath)) {
    validationDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-generated-validation-"));
    validationPath = path.join(validationDir, "artifact.media");
    fs.writeFileSync(validationPath, Buffer.from(input.bytes), { mode: 0o600, flag: "wx" });
  }
  try {
    const timeoutMs = decodeTimeoutMs(input.bytes.byteLength);
    const ffmpeg = (deps.resolveFfmpeg ?? resolveFfmpegPath)();
    const startedAt = Date.now();
    const run = ffmpeg
      ? (deps.run ?? defaultRun)(ffmpeg, decodeInvocation(input.kind, validationPath), { timeout: timeoutMs })
      : ({ status: null, signal: null, stdout: "", stderr: "", error: { code: "ENOENT", message: "ffmpeg not found" } } satisfies DecodeRun);
    const verdict = interpretDecodeRun(input.kind, run);
    recordDecode(input, verdict, timeoutMs, Date.now() - startedAt);
    if (verdict.verdict !== "decodable") {
      throw generatedMediaValidationError(verdict.verdict === "unverified" ? "decode_unverified" : "decode_failed");
    }
    return verdict;
  } finally {
    if (validationDir) removeScratchAfterUseSync(validationDir);
  }
}
