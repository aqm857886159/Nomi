import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { validateAntigravityImage } from "../ai/antigravityArtifacts";
import { contentTypeFromMagicBytes, extensionFromContentType } from "../assets/mediaTypes";
import { probeMediaMetadata, type MediaProbeMetadata } from "../export/mediaProbe";
import { hardenedFetch, type HardenedFetchResult } from "../hardenedFetch";

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
    inputPath: string,
    options: { signal?: AbortSignal; timeoutMs: number; maxStdoutBytes: number; maxStderrBytes: number },
  ) => Promise<MediaProbeMetadata>;
  certificationRoot?: string;
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
      declaredType: declaredType || "missing",
      expectedKind,
    });
  }
  const detectedType = detectContentType(bytes);
  if (!detectedType) throw new CertificationMediaError("media_corrupt", { expectedKind });
  const detectedKind = kindForContentType(detectedType);
  const ambiguousContainer = isAmbiguousContainerMatch(declaredType, detectedType, expectedKind);
  if (!detectedKind || (detectedKind !== expectedKind && !ambiguousContainer)) {
    throw new CertificationMediaError("media_kind_mismatch", {
      expectedKind,
      detectedKind: detectedKind || "unknown",
    });
  }
  if (declaredType !== "application/octet-stream" && declaredType !== detectedType && !ambiguousContainer) {
    throw new CertificationMediaError("media_mime_mismatch", { declaredType, detectedType });
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

function validateGlb(bytes: Buffer): void {
  if (bytes.byteLength < 20
    || bytes.toString("ascii", 0, 4) !== "glTF"
    || bytes.readUInt32LE(4) !== 2
    || bytes.readUInt32LE(8) !== bytes.byteLength) {
    throw new CertificationMediaError("media_corrupt", { expectedKind: "model3d" });
  }
  let offset = 12;
  let sawJson = false;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new CertificationMediaError("media_corrupt", { expectedKind: "model3d" });
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    const next = offset + 8 + chunkLength;
    if (chunkLength % 4 !== 0 || next > bytes.byteLength) {
      throw new CertificationMediaError("media_corrupt", { expectedKind: "model3d" });
    }
    if (!sawJson) {
      if (chunkType !== 0x4e4f534a) throw new CertificationMediaError("media_unsupported_3d");
      try {
        const parsed = JSON.parse(bytes.toString("utf8", offset + 8, next).trim()) as { asset?: { version?: unknown } };
        if (parsed.asset?.version !== "2.0") throw new Error("unsupported version");
      } catch {
        throw new CertificationMediaError("media_corrupt", { expectedKind: "model3d" });
      }
      sawJson = true;
    }
    offset = next;
  }
  if (!sawJson || offset !== bytes.byteLength) throw new CertificationMediaError("media_corrupt", { expectedKind: "model3d" });
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

export async function certifyMediaArtifact(
  input: CertificationMediaInput,
  dependencies: CertificationMediaDependencies = {},
): Promise<CertificationMediaEvidence> {
  const limits = resolvedLimits(input);
  const acquired = await acquireBytes(input, dependencies, limits);
  const typed = assertDeclaredAndDetectedTypes(acquired.bytes, acquired.contentType, input.expectedKind);
  const root = dependencies.certificationRoot || path.join(os.tmpdir(), "nomi-certification-media");
  let runDirectory = "";
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    runDirectory = await mkdtemp(path.join(root, "run-"));
    const extension = extensionFromContentType(typed.contentType)
      || (input.expectedKind === "model3d" ? "glb" : "bin");
    const managedPath = path.join(runDirectory, `artifact.${extension}`);
    await writeFile(managedPath, acquired.bytes, { flag: "wx", mode: 0o600 });
    const managedBytes = await readFile(managedPath);
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
      const probe = dependencies.probeMedia || probeMediaMetadata;
      let probed: MediaProbeMetadata;
      try {
        probed = await runWithDecoderDeadline(
          (signal) => probe(managedPath, {
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
      if (probed.kind !== input.expectedKind) {
        throw new CertificationMediaError("media_kind_mismatch", {
          expectedKind: input.expectedKind,
          detectedKind: probed.kind,
        });
      }
      if (!probed.durationSeconds || probed.durationSeconds > limits.maxDurationSeconds) {
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
      metadata = safeMetadata(probed);
    } else {
      validateGlb(managedBytes);
    }

    return Object.freeze({
      kind: input.expectedKind,
      contentType: typed.contentType,
      byteLength: managedBytes.byteLength,
      sha256: crypto.createHash("sha256").update(managedBytes).digest("hex"),
      metadata,
    });
  } catch (error) {
    if (error instanceof CertificationMediaError) throw error;
    throw new CertificationMediaError("media_storage_failed");
  } finally {
    if (runDirectory) await rm(runDirectory, { recursive: true, force: true });
  }
}
