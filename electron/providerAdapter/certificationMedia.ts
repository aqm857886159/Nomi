import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { validateAntigravityImage } from "../ai/antigravityArtifacts";
import { Model3DValidationError, validateGlbStructure } from "../assets/model3dValidation";
import { contentTypeFromMagicBytes, extensionFromContentType, isCertifiableMediaContentType, MEDIA_TYPES } from "../assets/mediaTypes";
import { decodeMediaBytes, decodeMediaFile, probeMediaBytes, probeMediaMetadata, type MediaProbeMetadata } from "../export/mediaProbe";
import { hardenedFetch, type HardenedFetchResult } from "../hardenedFetch";
import {
  completeCertificationCleanupLease,
  recordCertificationCleanupFailure,
  registerCertificationCleanupLease,
  retryCertificationCleanup,
} from "./certificationCleanup";

export type CertificationMediaKind = "image" | "video" | "audio" | "model3d";

export type CertificationMediaReasonCode =
  | "media_cancelled"
  | "media_content_type_unsupported"
  | "media_corrupt"
  | "media_decode_failed"
  | "media_fetch_failed"
  | "media_invalid_source"
  | "media_kind_mismatch"
  | "media_markup_masquerade"
  | "media_mime_mismatch"
  | "media_redirect_forbidden"
  | "media_storage_failed"
  | "media_stream_limit_exceeded"
  | "media_timeout"
  | "media_too_large"
  | "media_unsupported_format"
  | "media_unsupported_3d";

export type CertificationMediaErrorParams = Readonly<Record<string, string | number | boolean>>;

export class CertificationMediaError extends Error {
  readonly reasonCode: CertificationMediaReasonCode;
  readonly params: CertificationMediaErrorParams;

  constructor(reasonCode: CertificationMediaReasonCode, params: CertificationMediaErrorParams = {}) {
    super(`Media certification failed (${reasonCode})`);
    this.name = "CertificationMediaError";
    this.reasonCode = reasonCode;
    this.params = Object.freeze({ ...params });
  }
}

export type CertificationMediaEvidence = {
  kind: CertificationMediaKind;
  contentType: string;
  byteLength: number;
  sha256: string;
  metadata: Readonly<{
    width?: number;
    height?: number;
    durationSeconds?: number;
    fps?: number;
    videoCodec?: string;
    audioCodec?: string;
    sampleRate?: number;
    channels?: number;
    streamCount?: number;
  }>;
};

export type CertificationMediaLimits = {
  maxBytes?: number;
  fetchTimeoutMs?: number;
  decoderTimeoutMs?: number;
  maxDurationSeconds?: number;
  maxPixels?: number;
  maxStreams?: number;
};

export type CertificationMediaInput = {
  source: string | { bytes: Uint8Array; contentType: string };
  expectedKind: CertificationMediaKind;
  allowedPrivateOrigins?: readonly string[];
  limits?: CertificationMediaLimits;
  signal?: AbortSignal;
};

export type CertificationMediaDependencies = {
  fetch?: (
    url: string,
    options: {
      timeoutMs: number;
      maxBytes: number;
      allowRedirect: boolean;
      allowedPrivateOrigins?: readonly string[];
      signal?: AbortSignal;
    },
  ) => Promise<Pick<HardenedFetchResult, "bytes" | "contentType"> & { finalUrl?: string }>;
  decodeImage?: (
    bytes: Uint8Array,
    declaredMime: string,
    signal?: AbortSignal,
  ) => Promise<{ mimeType: string; width: number; height: number }>;
  probeMedia?: (
    bytes: Uint8Array,
    options: { signal?: AbortSignal; timeoutMs: number; maxStdoutBytes: number; maxStderrBytes: number },
  ) => Promise<MediaProbeMetadata>;
  decodeMedia?: (
    bytes: Uint8Array,
    kind: "video" | "audio",
    options: { signal?: AbortSignal; timeoutMs: number; maxStdoutBytes: number; maxStderrBytes: number },
  ) => Promise<void>;
  certificationRoot?: string;
  cleanup?: (target: string) => Promise<void>;
};

const DEFAULT_LIMITS: Record<CertificationMediaKind, Required<CertificationMediaLimits>> = {
  image: {
    maxBytes: 12 * 1024 * 1024,
    fetchTimeoutMs: 20_000,
    decoderTimeoutMs: 10_000,
    maxDurationSeconds: 1,
    maxPixels: 16_777_216,
    maxStreams: 1,
  },
  video: {
    maxBytes: 25 * 1024 * 1024,
    fetchTimeoutMs: 20_000,
    decoderTimeoutMs: 12_000,
    maxDurationSeconds: 90,
    maxPixels: 16_777_216,
    maxStreams: 8,
  },
  audio: {
    maxBytes: 25 * 1024 * 1024,
    fetchTimeoutMs: 20_000,
    decoderTimeoutMs: 12_000,
    maxDurationSeconds: 180,
    maxPixels: 1,
    maxStreams: 8,
  },
  model3d: {
    maxBytes: 25 * 1024 * 1024,
    fetchTimeoutMs: 20_000,
    decoderTimeoutMs: 10_000,
    maxDurationSeconds: 1,
    maxPixels: 1,
    maxStreams: 1,
  },
};

const DEFAULT_PROCESS_STDOUT_LIMIT = 256 * 1024;
const DEFAULT_PROCESS_STDERR_LIMIT = 64 * 1024;
const MARKUP_SCAN_BYTES = 4_096;

export function defaultCertificationMediaRoot(): string {
  const suffix = typeof process.getuid === "function" ? String(process.getuid()) : String(process.pid);
  return path.join(os.tmpdir(), `nomi-certification-media-${suffix}`);
}

export async function recoverCertificationMediaStorage(): Promise<number> {
  const root = defaultCertificationMediaRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  await assertTrustedCertificationRoot(root);
  return retryCertificationCleanup(root);
}

function resolvedLimits(input: CertificationMediaInput): Required<CertificationMediaLimits> {
  const defaults = DEFAULT_LIMITS[input.expectedKind];
  return {
    maxBytes: input.limits?.maxBytes ?? defaults.maxBytes,
    fetchTimeoutMs: input.limits?.fetchTimeoutMs ?? defaults.fetchTimeoutMs,
    decoderTimeoutMs: input.limits?.decoderTimeoutMs ?? defaults.decoderTimeoutMs,
    maxDurationSeconds: input.limits?.maxDurationSeconds ?? defaults.maxDurationSeconds,
    maxPixels: input.limits?.maxPixels ?? defaults.maxPixels,
    maxStreams: input.limits?.maxStreams ?? defaults.maxStreams,
  };
}

function normalizedContentType(value: string): string {
  const normalized = String(value || "").toLowerCase().split(";", 1)[0]?.trim() || "";
  if (normalized === "image/jpg") return "image/jpeg";
  if (normalized === "audio/x-wav") return "audio/wav";
  return normalized;
}

const KNOWN_MEDIA_CONTENT_TYPES = new Set(MEDIA_TYPES.map((entry) => entry.contentType));

function safeDeclaredTypeParam(value: string): string {
  return KNOWN_MEDIA_CONTENT_TYPES.has(value) || value === "application/octet-stream" ? value : "unsupported";
}

function kindForContentType(contentType: string): CertificationMediaKind | null {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType === "model/gltf-binary") return "model3d";
  return null;
}

function isMarkupMasquerade(bytes: Uint8Array): boolean {
  const prefix = Buffer.from(bytes.subarray(0, MARKUP_SCAN_BYTES))
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  return /^(?:<!doctype\s+html|<html\b|<\?xml\b|<svg\b|<(?:error|response|message)\b|\{\s*"(?:error|message)"\s*:)/i.test(prefix);
}

function detectContentType(bytes: Uint8Array): string | null {
  if (bytes.byteLength >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "glTF") {
    return "model/gltf-binary";
  }
  return contentTypeFromMagicBytes(bytes);
}

function isAmbiguousContainerMatch(declaredType: string, detectedType: string, expectedKind: CertificationMediaKind): boolean {
  return (expectedKind === "audio" && declaredType === "audio/mp4" && detectedType === "video/mp4")
    || (expectedKind === "audio" && declaredType === "audio/webm" && detectedType === "video/webm")
    || (expectedKind === "video" && declaredType === "video/ogg" && detectedType === "audio/ogg");
}

function assertDeclaredAndDetectedTypes(
  bytes: Buffer,
  declaredTypeRaw: string,
  expectedKind: CertificationMediaKind,
): { contentType: string; detectedType: string } {
  if (isMarkupMasquerade(bytes)) throw new CertificationMediaError("media_markup_masquerade");
  const declaredType = normalizedContentType(declaredTypeRaw);
  const declaredKind = kindForContentType(declaredType);
  if (!declaredType || (!declaredKind && declaredType !== "application/octet-stream")) {
    throw new CertificationMediaError("media_content_type_unsupported", {
      declaredType: declaredType ? safeDeclaredTypeParam(declaredType) : "missing",
      expectedKind,
    });
  }
  const detectedType = detectContentType(bytes);
  if (!detectedType) throw new CertificationMediaError("media_corrupt", { expectedKind });
  if (!isCertifiableMediaContentType(detectedType)) {
    throw new CertificationMediaError("media_unsupported_format", { detectedType });
  }
  const detectedKind = kindForContentType(detectedType);
  const ambiguousContainer = isAmbiguousContainerMatch(declaredType, detectedType, expectedKind);
  if (!detectedKind || (detectedKind !== expectedKind && !ambiguousContainer)) {
    throw new CertificationMediaError("media_kind_mismatch", {
      expectedKind,
      detectedKind: detectedKind || "unknown",
    });
  }
  if (declaredType !== "application/octet-stream" && declaredType !== detectedType && !ambiguousContainer) {
    throw new CertificationMediaError("media_mime_mismatch", { declaredType: safeDeclaredTypeParam(declaredType), detectedType });
  }
  if (declaredKind && declaredKind !== expectedKind && !ambiguousContainer) {
    throw new CertificationMediaError("media_kind_mismatch", { expectedKind, declaredKind });
  }
  return {
    detectedType,
    contentType: ambiguousContainer ? declaredType : detectedType,
  };
}

function strictDataUrl(source: string, maxBytes: number): { bytes: Buffer; contentType: string } {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(source);
  if (!match) throw new CertificationMediaError("media_invalid_source");
  const contentType = normalizedContentType(match[1] || "application/octet-stream");
  const encoded = match[3] || "";
  let bytes: Buffer;
  if (match[2]) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new CertificationMediaError("media_invalid_source");
    }
    if (Math.floor((encoded.length * 3) / 4) > maxBytes) {
      throw new CertificationMediaError("media_too_large", { limitBytes: maxBytes });
    }
    bytes = Buffer.from(encoded, "base64");
  } else {
    if (encoded.length > maxBytes * 3) throw new CertificationMediaError("media_too_large", { limitBytes: maxBytes });
    try {
      bytes = Buffer.from(decodeURIComponent(encoded), "utf8");
    } catch {
      throw new CertificationMediaError("media_invalid_source");
    }
  }
  if (!bytes.byteLength) throw new CertificationMediaError("media_invalid_source");
  if (bytes.byteLength > maxBytes) throw new CertificationMediaError("media_too_large", { limitBytes: maxBytes });
  return { bytes, contentType };
}

function safeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function mapFetchFailure(error: unknown, timeoutMs: number, signal?: AbortSignal): CertificationMediaError {
  if (signal?.aborted) return new CertificationMediaError("media_cancelled");
  const message = error instanceof Error ? error.message : String(error);
  if (/redirect/i.test(message)) return new CertificationMediaError("media_redirect_forbidden");
  if (/timed?\s*out|timeout|abort/i.test(message)) {
    return new CertificationMediaError("media_timeout", { stage: "fetch", timeoutMs });
  }
  if (/too large|exceed(?:ed|s)?/i.test(message)) {
    return new CertificationMediaError("media_too_large");
  }
  if (/invalid url|only http/i.test(message)) return new CertificationMediaError("media_invalid_source");
  return new CertificationMediaError("media_fetch_failed");
}

async function acquireBytes(
  input: CertificationMediaInput,
  dependencies: CertificationMediaDependencies,
  limits: Required<CertificationMediaLimits>,
): Promise<{ bytes: Buffer; contentType: string }> {
  if (input.signal?.aborted) throw new CertificationMediaError("media_cancelled");
  if (typeof input.source !== "string") {
    const bytes = Buffer.from(input.source.bytes);
    if (!bytes.byteLength) throw new CertificationMediaError("media_invalid_source");
    if (bytes.byteLength > limits.maxBytes) {
      throw new CertificationMediaError("media_too_large", { limitBytes: limits.maxBytes });
    }
    return { bytes, contentType: input.source.contentType };
  }
  if (/^data:/i.test(input.source)) return strictDataUrl(input.source, limits.maxBytes);
  const initialOrigin = safeOrigin(input.source);
  if (!initialOrigin) throw new CertificationMediaError("media_invalid_source");
  const fetchMedia = dependencies.fetch || hardenedFetch;
  let fetched: Pick<HardenedFetchResult, "bytes" | "contentType"> & { finalUrl?: string };
  try {
    fetched = await fetchMedia(input.source, {
      timeoutMs: limits.fetchTimeoutMs,
      maxBytes: limits.maxBytes,
      // Certification never needs redirects: accepting a different origin would expand the
      // user's grant and make evidence depend on a second unconfirmed endpoint.
      allowRedirect: false,
      ...(input.allowedPrivateOrigins?.length ? { allowedPrivateOrigins: input.allowedPrivateOrigins } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    throw mapFetchFailure(error, limits.fetchTimeoutMs, input.signal);
  }
  const finalOrigin = safeOrigin(fetched.finalUrl || input.source);
  if (!finalOrigin || finalOrigin !== initialOrigin) throw new CertificationMediaError("media_redirect_forbidden");
  const bytes = Buffer.from(fetched.bytes);
  if (!bytes.byteLength) throw new CertificationMediaError("media_corrupt", { expectedKind: input.expectedKind });
  if (bytes.byteLength > limits.maxBytes) {
    throw new CertificationMediaError("media_too_large", { limitBytes: limits.maxBytes });
  }
  return { bytes, contentType: fetched.contentType };
}

async function runWithDecoderDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<T> {
  if (callerSignal?.aborted) throw new CertificationMediaError("media_cancelled");
  const controller = new AbortController();
  let timedOut = false;
  let rejectDeadline: ((reason: CertificationMediaError) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  const abortForCaller = () => {
    controller.abort(callerSignal?.reason);
    rejectDeadline?.(new CertificationMediaError("media_cancelled"));
  };
  callerSignal?.addEventListener("abort", abortForCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectDeadline?.(new CertificationMediaError("media_timeout", { stage: "decode", timeoutMs }));
  }, Math.max(1, timeoutMs));
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortForCaller);
    if (!controller.signal.aborted && (timedOut || callerSignal?.aborted)) controller.abort();
  }
}

function safeMetadata(metadata: MediaProbeMetadata): CertificationMediaEvidence["metadata"] {
  return Object.freeze({
    ...(metadata.width !== undefined ? { width: metadata.width } : {}),
    ...(metadata.height !== undefined ? { height: metadata.height } : {}),
    ...(metadata.durationSeconds !== undefined ? { durationSeconds: metadata.durationSeconds } : {}),
    ...(metadata.fps !== undefined ? { fps: metadata.fps } : {}),
    ...(metadata.videoCodec !== undefined ? { videoCodec: metadata.videoCodec } : {}),
    ...(metadata.audioCodec !== undefined ? { audioCodec: metadata.audioCodec } : {}),
    ...(metadata.sampleRate !== undefined ? { sampleRate: metadata.sampleRate } : {}),
    ...(metadata.channels !== undefined ? { channels: metadata.channels } : {}),
    ...(metadata.streamCount !== undefined ? { streamCount: metadata.streamCount } : {}),
  });
}

function wavDurationSeconds(bytes: Uint8Array): number | undefined {
  if (bytes.byteLength < 44 || Buffer.from(bytes.subarray(0, 4)).toString("ascii") !== "RIFF"
    || Buffer.from(bytes.subarray(8, 12)).toString("ascii") !== "WAVE") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let byteRate = 0;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const chunkType = Buffer.from(bytes.subarray(offset, offset + 4)).toString("ascii");
    const chunkLength = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkStart + chunkLength > bytes.byteLength) return undefined;
    if (chunkType === "fmt " && chunkLength >= 12) byteRate = view.getUint32(chunkStart + 8, true);
    if (chunkType === "data") dataBytes = chunkLength;
    offset = chunkStart + chunkLength + (chunkLength % 2);
  }
  const duration = byteRate > 0 && dataBytes > 0 ? dataBytes / byteRate : 0;
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

async function assertTrustedCertificationRoot(root: string): Promise<void> {
  const info = await lstat(root);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (!info.isDirectory() || info.isSymbolicLink() || (currentUid !== undefined && info.uid !== currentUid)) throw new Error("unsafe root");
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    await chmod(root, 0o700);
    const secured = await lstat(root);
    if ((secured.mode & 0o077) !== 0 || secured.isSymbolicLink()) throw new Error("unsafe root");
  }
}

async function cleanupWithRetry(target: string, cleanup: (target: string) => Promise<void>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await cleanup(target);
      return true;
    } catch {
      if (attempt < 2) await new Promise<void>((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
  return false;
}

export async function certifyMediaArtifact(
  input: CertificationMediaInput,
  dependencies: CertificationMediaDependencies = {},
): Promise<CertificationMediaEvidence> {
  const limits = resolvedLimits(input);
  const acquired = await acquireBytes(input, dependencies, limits);
  const typed = assertDeclaredAndDetectedTypes(acquired.bytes, acquired.contentType, input.expectedKind);
  const root = dependencies.certificationRoot || defaultCertificationMediaRoot();
  let runDirectory = "";
  let operationFailed = false;
  let evidence: CertificationMediaEvidence | undefined;
  let caughtError: CertificationMediaError | undefined;
  let cleanupFailed = false;
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await assertTrustedCertificationRoot(root);
    await retryCertificationCleanup(root, dependencies.cleanup).catch(() => undefined);
    runDirectory = await mkdtemp(path.join(root, "run-"));
    await registerCertificationCleanupLease(root, runDirectory);
    const extension = extensionFromContentType(typed.contentType)
      || (input.expectedKind === "model3d" ? "glb" : "bin");
    const managedPath = path.join(runDirectory, `artifact.${extension}`);
    await writeFile(managedPath, acquired.bytes, { flag: "wx", mode: 0o600 });
    // This immutable in-memory copy is the single source for the digest. The
    // managed file is a bounded Nomi-owned materialization of those exact bytes;
    // ffprobe/ffmpeg read it so seek-required containers (notably MP4) are
    // validated faithfully instead of being misread as truncated stdin.
    const managedBytes = Buffer.from(acquired.bytes);
    let metadata: CertificationMediaEvidence["metadata"] = Object.freeze({});

    if (input.expectedKind === "image") {
      const decodeImage = dependencies.decodeImage || (async (bytes, declaredMime, signal) => {
        const decoded = await validateAntigravityImage(bytes, declaredMime, signal);
        return { mimeType: decoded.mimeType, width: decoded.width, height: decoded.height };
      });
      try {
        const decoded = await runWithDecoderDeadline(
          (signal) => decodeImage(managedBytes, typed.detectedType, signal),
          limits.decoderTimeoutMs,
          input.signal,
        );
        if (normalizedContentType(decoded.mimeType) !== typed.detectedType
          || decoded.width <= 0
          || decoded.height <= 0
          || decoded.width * decoded.height > limits.maxPixels) {
          throw new CertificationMediaError("media_corrupt", { expectedKind: "image" });
        }
        metadata = Object.freeze({ width: decoded.width, height: decoded.height });
      } catch (error) {
        if (error instanceof CertificationMediaError) throw error;
        throw new CertificationMediaError("media_corrupt", { expectedKind: "image" });
      }
    } else if (input.expectedKind === "video" || input.expectedKind === "audio") {
      const probe = dependencies.probeMedia || probeMediaBytes;
      const decode = dependencies.decodeMedia || decodeMediaBytes;
      let probed: MediaProbeMetadata;
      try {
        probed = await runWithDecoderDeadline(
          (signal) => dependencies.probeMedia
            ? probe(managedBytes, {
                signal,
                timeoutMs: limits.decoderTimeoutMs,
                maxStdoutBytes: DEFAULT_PROCESS_STDOUT_LIMIT,
                maxStderrBytes: DEFAULT_PROCESS_STDERR_LIMIT,
              })
            : probeMediaMetadata(managedPath, {
                signal,
                timeoutMs: limits.decoderTimeoutMs,
                maxStdoutBytes: DEFAULT_PROCESS_STDOUT_LIMIT,
                maxStderrBytes: DEFAULT_PROCESS_STDERR_LIMIT,
              }),
          limits.decoderTimeoutMs,
          input.signal,
        );
      } catch (error) {
        if (error instanceof CertificationMediaError) throw error;
        throw new CertificationMediaError("media_corrupt", { expectedKind: input.expectedKind });
      }
      if (probed.durationSeconds === undefined && typed.contentType === "audio/wav") {
        const durationSeconds = wavDurationSeconds(managedBytes);
        if (durationSeconds !== undefined) probed = { ...probed, durationSeconds };
      }
      if (probed.kind !== input.expectedKind) {
        throw new CertificationMediaError("media_kind_mismatch", {
          expectedKind: input.expectedKind,
          detectedKind: probed.kind,
        });
      }
      // Non-seekable stdin deliberately prevents TOCTOU. Some valid audio containers
      // omit duration on a pipe; bounded decode/bytes/time still apply, and a reported
      // duration must remain within policy.
      if (probed.durationSeconds !== undefined && probed.durationSeconds > limits.maxDurationSeconds) {
        throw new CertificationMediaError("media_decode_failed", {
          expectedKind: input.expectedKind,
          maxDurationSeconds: limits.maxDurationSeconds,
        });
      }
      if (!probed.streamCount || probed.streamCount > limits.maxStreams) {
        throw new CertificationMediaError("media_stream_limit_exceeded", { maxStreams: limits.maxStreams });
      }
      if (input.expectedKind === "video"
        && (!probed.width || !probed.height || probed.width * probed.height > limits.maxPixels)) {
        throw new CertificationMediaError("media_decode_failed", {
          expectedKind: "video",
          maxPixels: limits.maxPixels,
        });
      }
      try {
        await runWithDecoderDeadline(
          (signal) => dependencies.decodeMedia
            ? decode(managedBytes, input.expectedKind as "video" | "audio", {
                signal,
                timeoutMs: limits.decoderTimeoutMs,
                maxStdoutBytes: DEFAULT_PROCESS_STDOUT_LIMIT,
                maxStderrBytes: DEFAULT_PROCESS_STDERR_LIMIT,
              })
            : decodeMediaFile(managedPath, input.expectedKind as "video" | "audio", {
                signal,
                timeoutMs: limits.decoderTimeoutMs,
                maxStdoutBytes: DEFAULT_PROCESS_STDOUT_LIMIT,
                maxStderrBytes: DEFAULT_PROCESS_STDERR_LIMIT,
              }),
          limits.decoderTimeoutMs,
          input.signal,
        );
      } catch (error) {
        if (error instanceof CertificationMediaError) throw error;
        throw new CertificationMediaError("media_decode_failed", { expectedKind: input.expectedKind });
      }
      metadata = safeMetadata(probed);
    } else {
      try {
        validateGlbStructure(managedBytes);
      } catch (error) {
        if (error instanceof Model3DValidationError
          && (error.code === "external_uri" || error.code === "unsupported_version" || error.code === "resource_limit")) {
          throw new CertificationMediaError("media_unsupported_3d");
        }
        throw new CertificationMediaError("media_corrupt", { expectedKind: "model3d" });
      }
    }

    evidence = Object.freeze({
      kind: input.expectedKind,
      contentType: typed.contentType,
      byteLength: managedBytes.byteLength,
      sha256: crypto.createHash("sha256").update(managedBytes).digest("hex"),
      metadata,
    });
  } catch (error) {
    operationFailed = true;
    caughtError = error instanceof CertificationMediaError ? error : new CertificationMediaError("media_storage_failed");
  } finally {
    const cleanup = dependencies.cleanup || ((target: string) => rm(target, { recursive: true, force: true }));
    let cleaned = true;
    if (runDirectory) {
      cleaned = await cleanupWithRetry(runDirectory, cleanup);
      if (cleaned) {
        try {
          await completeCertificationCleanupLease(root, runDirectory);
        } catch {
          cleanupFailed = true;
        }
      } else {
        try {
          await recordCertificationCleanupFailure(root, runDirectory);
        } catch {
          cleanupFailed = true;
        }
      }
    }
    cleanupFailed = cleanupFailed || (!cleaned && !operationFailed && !evidence);
  }
  if (caughtError) throw caughtError;
  if (cleanupFailed || !evidence) throw new CertificationMediaError("media_storage_failed");
  return evidence;
}
