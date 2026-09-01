// APIMart's public model IDs are not always the same as historical catalog keys.
// Keep persisted keys stable, but canonicalize the outgoing wire value at the
// shared request boundary. This module also owns the model-specific Omni
// reference-cardinality guard used both before spend and immediately before HTTP.
import { registerRequestTransform, type RequestTransformContext } from "../tasks/requestTransforms";
import { desktopT } from "../i18n";

type JsonRecord = Record<string, unknown>;

const CANONICAL_MODEL_IDS: Record<string, string> = {
  "doubao-seedream-4.5": "seedream-4.5",
  "doubao-seedream-5-0-pro": "seedream-5-0-pro",
  "doubao-seedance-2.0": "seedance-2.0",
  "doubao-seedance-2-0": "seedance-2.0",
  "doubao-seedance-2.0-fast": "seedance-2.0-fast",
  "doubao-seedance-2-0-fast": "seedance-2.0-fast",
  "doubao-seedance-2.0-mini": "seedance-2.0-mini",
  "doubao-seedance-2-0-mini": "seedance-2.0-mini",
  "doubao-seedance-2.0-face": "seedance-2.0-face",
  "doubao-seedance-2-0-face": "seedance-2.0-face",
  "doubao-seedance-2.0-fast-face": "seedance-2.0-fast-face",
  "doubao-seedance-2-0-fast-face": "seedance-2.0-fast-face",
  "doubao-seedance-2.5": "seedance-2.5",
  "doubao-seedance-2-5": "seedance-2.5",
  "grok-imagine-1.5-video-apimart": "grok-imagine-1.5-video-ext",
  "Omni-Flash-Ext": "gemini-omni-1.1-flash-ext",
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeApimartCanonicalModelId(body: unknown): unknown {
  if (!isRecord(body) || typeof body.model !== "string") return body;
  const canonical = CANONICAL_MODEL_IDS[body.model];
  return canonical ? { ...body, model: canonical } : body;
}

function imageCount(body: JsonRecord): number {
  if (body.image_urls == null) return 0;
  if (!Array.isArray(body.image_urls)) throw new Error(desktopT("vendor.apimartOmni.imageUrlsArray"));
  return body.image_urls.length;
}

export function validateOmniFlashExtBody(body: unknown, _context?: RequestTransformContext): void {
  if (!isRecord(body)) return;
  const count = imageCount(body);
  if (count !== 0 && count !== 1 && count !== 3) {
    throw new Error(desktopT("vendor.apimartOmni.imageCount"));
  }
  if (count > 0 && body.generation_type !== "reference") {
    throw new Error(desktopT("vendor.apimartOmni.generationType"));
  }
}

export function normalizeOmniFlashExtBody(body: unknown, context: RequestTransformContext): unknown {
  validateOmniFlashExtBody(body, context);
  return normalizeApimartCanonicalModelId(body);
}

registerRequestTransform("apimart-canonical-model-id", normalizeApimartCanonicalModelId);
registerRequestTransform("apimart-omni-flash-ext-contract", normalizeOmniFlashExtBody, validateOmniFlashExtBody);
