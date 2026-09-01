import { extensionFromContentType } from "../assets/mediaTypes";
import { buildProfileHttpRequest } from "../catalog/profileHttpRequest";
import type { HttpOperation, Model, Vendor } from "../catalog/types";
import { desktopT } from "../i18n";
import { firstString } from "../jsonUtils";
import type { TaskRequest } from "../runtime";
import { pathValues } from "../tasks/responseParsing";
import { requestBinary } from "../vendor/vendorHttp";

const MAX_SYNCHRONOUS_AUDIO_BYTES = 30 * 1024 * 1024;

const AUDIO_CONTENT_TYPE: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  pcm: "audio/L16",
};

export type SynchronousAudioOperationResult = {
  bytes: Buffer;
  contentType: string;
  extension: string;
  request: unknown;
};

function audioFormatFromWire(body: unknown, query: Record<string, unknown>): string {
  const bodyRecord = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const raw = firstString(bodyRecord.response_format, query.output_format).toLowerCase();
  const prefix = raw.split("_")[0];
  return AUDIO_CONTENT_TYPE[prefix] ? prefix : "wav";
}

function decodeEncodedAudio(value: unknown, encoding: "hex" | "base64"): Buffer {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(desktopT("syncAudio.missingDeclaredData"));
  }
  const encoded = value.replace(/\s+/g, "");
  if (encoding === "hex") {
    if (encoded.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(encoded)) {
      throw new Error(desktopT("syncAudio.invalidHex"));
    }
    return Buffer.from(encoded, "hex");
  }
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(encoded)) {
    throw new Error(desktopT("syncAudio.invalidBase64"));
  }
  return Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function decodeAudioBody(
  responseBytes: Buffer,
  responseContentType: string,
  operation: HttpOperation,
  body: unknown,
  query: Record<string, unknown>,
): Omit<SynchronousAudioOperationResult, "request"> {
  const declared = operation.audioResponse;
  if (declared === "ndjson-base64") {
    throw new Error("This synchronous audio response requires the dedicated NDJSON codec");
  }
  if (declared && typeof declared === "object" && declared.type === "json") {
    let json: unknown;
    try {
      json = JSON.parse(responseBytes.toString("utf8"));
    } catch {
      throw new Error(desktopT("syncAudio.invalidJson"));
    }
    const bytes = decodeEncodedAudio(pathValues(json, declared.dataPath)[0], declared.encoding);
    if (bytes.byteLength === 0) throw new Error(desktopT("syncAudio.empty"));
    return {
      bytes,
      contentType: declared.contentType,
      extension: declared.extension.toLowerCase(),
    };
  }

  if (responseBytes.byteLength === 0) throw new Error(desktopT("syncAudio.empty"));
  if (declared && typeof declared === "object") {
    const upstreamType = responseContentType.startsWith("audio/") ? responseContentType : "";
    return {
      bytes: responseBytes,
      contentType: upstreamType || declared.contentType,
      extension: extensionFromContentType(upstreamType) || declared.extension.toLowerCase(),
    };
  }

  const requestedFormat = audioFormatFromWire(body, query);
  const upstreamType = responseContentType.startsWith("audio/") ? responseContentType : "";
  const contentType = upstreamType || AUDIO_CONTENT_TYPE[requestedFormat] || "audio/wav";
  return {
    bytes: responseBytes,
    contentType,
    extension: extensionFromContentType(contentType) || requestedFormat,
  };
}

/** Shared byte-preserving executor for synchronous TTS in production and adapter certification. */
export async function executeSynchronousAudioOperation(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  operation: HttpOperation;
  signal?: AbortSignal;
}): Promise<SynchronousAudioOperationResult> {
  const built = buildProfileHttpRequest(input);
  const response = await requestBinary(
    input.vendor,
    input.apiKey,
    built.method,
    built.url,
    built.headers,
    built.query,
    built.body,
    input.signal,
    { maxResponseBytes: MAX_SYNCHRONOUS_AUDIO_BYTES },
  );
  return {
    ...decodeAudioBody(response.bytes, response.contentType, input.operation, built.body, built.query),
    request: built.preview,
  };
}
