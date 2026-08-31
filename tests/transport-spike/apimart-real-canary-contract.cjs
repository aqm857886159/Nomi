"use strict";

/**
 * Pure safety/normalisation contracts for the one-shot APIMart canary.
 *
 * This file deliberately has no Electron, network, or filesystem imports.  It
 * is the part that can be exercised in CI without a credential.  The launcher
 * (`apimart-real-canary.cjs`) is the only file allowed to decrypt the local
 * Settings credential or dispatch a provider request.
 */

const CONFIRMATION = "ONE_PAID_JOB";
const PRICE_SNAPSHOT_DATE = "2026-08-31";
const PRICE_SOURCE_URL = "https://apimart.ai/pricing";
const SEEDANCE_PRICE_SOURCE_URL = "https://apimart.ai/model/doubao-seedance-2-0";

/**
 * Test-only price snapshot.  These values are not production defaults and do
 * not alter the model catalog.  A canary must acknowledge the dated snapshot
 * explicitly before it can submit anything.  The image row is the cheapest
 * currently published APIMart image tier; the video row is the shortest,
 * lowest-resolution Seedance Mini text-to-video tier.
 */
const TEST_PRICE_SNAPSHOT = Object.freeze({
  image: Object.freeze({
    "gpt-image-2": Object.freeze({
      variantId: "default",
      spec: "1K",
      estimatedCostUsd: 0.0085,
      unit: "image",
      sourceUrl: PRICE_SOURCE_URL,
      // The semantic catalog uses `aspect_ratio`; APIMart's GPT Image mapping
      // translates that canonical value to the wire `size` field. Keeping the
      // canary input canonical is important: passing `size` here would be
      // treated as an unsupported/absent canonical value and the provider
      // would silently fall back to its default size (`auto`).
      parameters: Object.freeze({ aspect_ratio: "1:1", resolution: "1K" }),
    }),
    "z-image-turbo": Object.freeze({
      variantId: "default",
      spec: "default",
      estimatedCostUsd: 0.01,
      unit: "image",
      sourceUrl: PRICE_SOURCE_URL,
      parameters: Object.freeze({ size: "1:1", resolution: "1K" }),
    }),
  }),
  video: Object.freeze({
    "doubao-seedance-2.0": Object.freeze({
      variantId: "mini",
      transportModelId: "doubao-seedance-2.0-mini",
      spec: "480p / 4s / audio off",
      pricePerSecondUsd: 0.01056,
      estimatedCostUsd: 0.04224,
      unit: "second",
      sourceUrl: SEEDANCE_PRICE_SOURCE_URL,
      parameters: Object.freeze({
        model: "doubao-seedance-2.0-mini",
        size: "16:9",
        resolution: "480p",
        duration: 4,
        generate_audio: false,
      }),
    }),
  }),
});

const TASK_KIND_BY_MEDIA = Object.freeze({ image: "text_to_image", video: "text_to_video" });
const MODE_BY_MEDIA = Object.freeze({ image: "text_to_image", video: "text_to_video" });
const PROMPT_BY_MEDIA = Object.freeze({
  image: "a small orange tabby cat avatar, clean single subject, soft studio light, centered, simple background",
  video: "a small orange tabby cat looks at the camera and slowly blinks, gentle camera push-in, soft studio light",
});

class CanaryContractError extends Error {
  constructor(message, code = "canary_contract_invalid") {
    super(message);
    this.name = "CanaryContractError";
    this.code = code;
  }
}

function finitePositive(value, label) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new CanaryContractError(`${label} must be a positive finite number`);
  }
  return number;
}

function boundedInteger(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new CanaryContractError(`${label} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function normaliseProxy(raw) {
  const value = String(raw || "").trim();
  if (!value) return undefined;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new CanaryContractError("NOMI_APIMART_CANARY_PROXY is not a valid URL");
  }
  if (!["http:", "https:", "socks4:", "socks5:", "socks:"].includes(parsed.protocol)) {
    throw new CanaryContractError("NOMI_APIMART_CANARY_PROXY must use http(s) or socks4/5");
  }
  if (!parsed.hostname || !parsed.port) {
    throw new CanaryContractError("NOMI_APIMART_CANARY_PROXY must include a host and port");
  }
  return value;
}

/**
 * Parse the paid-run gate.  Disabled is a first-class result so ordinary test
 * invocations can exit successfully without touching Electron or the network.
 */
function parseCanaryConfig(env = process.env) {
  if (String(env.NOMI_APIMART_REAL_CANARY || "") !== "1") {
    return Object.freeze({ enabled: false, reason: "NOMI_APIMART_REAL_CANARY is not 1" });
  }
  if (String(env.NOMI_APIMART_REAL_CANARY_CONFIRM || "") !== CONFIRMATION) {
    throw new CanaryContractError(
      `paid canary requires NOMI_APIMART_REAL_CANARY_CONFIRM=${CONFIRMATION}`,
      "canary_confirmation_required",
    );
  }
  const kind = String(env.NOMI_APIMART_CANARY_KIND || "image").trim().toLowerCase();
  if (kind !== "image" && kind !== "video") {
    throw new CanaryContractError("NOMI_APIMART_CANARY_KIND must be image or video");
  }
  if (String(env.NOMI_APIMART_CANARY_PRICE_ACK || "") !== PRICE_SNAPSHOT_DATE) {
    throw new CanaryContractError(
      `paid canary requires the dated price acknowledgement ${PRICE_SNAPSHOT_DATE}`,
      "canary_price_ack_required",
    );
  }
  const maxSpendUsd = finitePositive(env.NOMI_APIMART_CANARY_MAX_USD, "NOMI_APIMART_CANARY_MAX_USD");
  const pollIntervalMs = boundedInteger(env.NOMI_APIMART_CANARY_POLL_MS || 5000, "poll interval", 1000, 60000);
  const maxPolls = boundedInteger(env.NOMI_APIMART_CANARY_MAX_POLLS || 96, "max polls", 1, 720);
  const requestTimeoutMs = boundedInteger(env.NOMI_APIMART_CANARY_REQUEST_TIMEOUT_MS || 60000, "request timeout", 5000, 300000);
  const outputRoot = String(env.NOMI_APIMART_CANARY_OUTPUT_DIR || "").trim() || undefined;
  const ledgerPath = String(env.NOMI_APIMART_CANARY_LEDGER || "").trim() || undefined;
  const runId = String(env.NOMI_APIMART_CANARY_RUN_ID || "").trim() || undefined;
  return Object.freeze({
    enabled: true,
    kind,
    maxSpendUsd,
    priceAck: PRICE_SNAPSHOT_DATE,
    priceSourceUrl: PRICE_SOURCE_URL,
    proxy: normaliseProxy(env.NOMI_APIMART_CANARY_PROXY),
    pollIntervalMs,
    maxPolls,
    requestTimeoutMs,
    outputRoot,
    ledgerPath,
    runId,
  });
}

function readRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CanaryContractError(`${label} is invalid`);
  }
  return value;
}

function mappingFor(catalog, modelKey, taskKind) {
  const mappings = Array.isArray(catalog.mappings) ? catalog.mappings : [];
  return mappings.find((mapping) => mapping
    && mapping.vendorKey === "apimart"
    && mapping.modelKey === modelKey
    && mapping.taskKind === taskKind
    && mapping.enabled !== false);
}

/**
 * Select only a model whose exact catalog row and mapping are enabled.  The
 * selector never guesses a model from its label or default setting.  A
 * missing price snapshot is a hard stop, not permission to spend blindly.
 */
function selectCheapestCanaryModel(catalog, kind) {
  readRecord(catalog, "catalog");
  if (kind !== "image" && kind !== "video") throw new CanaryContractError("unsupported canary kind");
  const vendor = (Array.isArray(catalog.vendors) ? catalog.vendors : [])
    .find((candidate) => candidate && candidate.key === "apimart" && candidate.enabled === true);
  if (!vendor) throw new CanaryContractError("APIMart vendor is disabled or missing", "canary_provider_unavailable");
  const snapshot = TEST_PRICE_SNAPSHOT[kind];
  const taskKind = TASK_KIND_BY_MEDIA[kind];
  const models = (Array.isArray(catalog.models) ? catalog.models : [])
    .filter((model) => model
      && model.vendorKey === "apimart"
      && model.kind === kind
      && model.enabled === true
      && model.published !== false
      && Object.prototype.hasOwnProperty.call(snapshot, model.modelKey))
    .map((model) => {
      const price = snapshot[model.modelKey];
      const mapping = mappingFor(catalog, model.modelKey, taskKind);
      if (!mapping) return undefined;
      // If a catalog price exists, it must agree with the acknowledged test
      // snapshot.  A drift is safer as a stop than as a silent over-spend.
      const catalogCost = model.pricing && model.pricing.enabled === true && Number.isFinite(model.pricing.cost)
        ? Number(model.pricing.cost)
        : undefined;
      if (catalogCost !== undefined && Math.abs(catalogCost - price.estimatedCostUsd) > 1e-9) {
        throw new CanaryContractError(`catalog price for ${model.modelKey} differs from the acknowledged snapshot`, "canary_price_drift");
      }
      return {
        vendorKey: "apimart",
        modelKey: model.modelKey,
        label: typeof model.labelZh === "string" ? model.labelZh : model.modelKey,
        kind,
        taskKind,
        mode: MODE_BY_MEDIA[kind],
        variantId: price.variantId,
        ...(price.transportModelId ? { transportModelId: price.transportModelId } : {}),
        estimatedCostUsd: price.estimatedCostUsd,
        pricePerSecondUsd: price.pricePerSecondUsd,
        unit: price.unit,
        spec: price.spec,
        sourceUrl: price.sourceUrl,
        parameters: { ...price.parameters },
        mappingId: mapping.id,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.estimatedCostUsd - right.estimatedCostUsd || left.modelKey.localeCompare(right.modelKey));
  if (models.length === 0) {
    throw new CanaryContractError(
      `no enabled, published, priced APIMart ${kind} canary model is available`,
      "canary_model_unpriced_or_unavailable",
    );
  }
  return Object.freeze(models[0]);
}

function assertSpendWithinCap(selection, maxSpendUsd) {
  const cap = finitePositive(maxSpendUsd, "max spend");
  if (selection.estimatedCostUsd > cap + 1e-9) {
    throw new CanaryContractError(
      `estimated spend $${selection.estimatedCostUsd.toFixed(6)} exceeds the explicit cap $${cap.toFixed(6)}`,
      "canary_spend_cap_exceeded",
    );
  }
  return cap;
}

function stableJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanaryContractError("non-finite value in canary payload");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  throw new CanaryContractError("unsupported value in canary payload");
}

function extractTaskId(payload) {
  const value = payload && typeof payload === "object" ? payload : undefined;
  const candidates = [
    value?.data?.[0]?.task_id,
    value?.data?.[0]?.taskId,
    value?.data?.task_id,
    value?.data?.taskId,
    value?.task_id,
    value?.taskId,
    value?.id,
  ];
  return candidates.find((candidate) => typeof candidate === "string" && candidate.trim())?.trim();
}

function extractStatus(payload) {
  const value = payload && typeof payload === "object" ? payload : undefined;
  const status = value?.data?.status ?? value?.status ?? value?.data?.[0]?.status;
  return typeof status === "string" ? status.trim() : "";
}

function extractOutputUrls(payload, kind) {
  const value = payload && typeof payload === "object" ? payload : undefined;
  const result = value?.data?.result ?? value?.result;
  const collection = kind === "video" ? result?.videos : result?.images;
  if (!Array.isArray(collection)) return [];
  const urls = [];
  for (const item of collection) {
    const candidates = Array.isArray(item) ? item : [item?.url, item];
    for (const candidate of candidates.flat(Infinity)) {
      if (typeof candidate === "string" && /^https?:\/\//i.test(candidate.trim())) urls.push(candidate.trim());
    }
  }
  return Array.from(new Set(urls));
}

function normaliseTerminalStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (["completed", "complete", "succeeded", "success", "done"].includes(value)) return "succeeded";
  if (["failed", "fail", "failure", "error", "cancelled", "canceled", "rejected", "expired"].includes(value)) return "failed";
  if (["submitted", "queued", "pending", "processing", "running", "generating", "created", "starting"].includes(value)) return "pending";
  return "unknown";
}

function redactText(value) {
  return String(value || "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/(Bearer\s+)[^\s,;)}]+/gi, "$1***")
    .replace(/([?&](?:key|token|secret|api_key|apikey)=)[^&\s]+/gi, "$1***")
    .slice(0, 400);
}

function receiptSummary(payload) {
  readRecord(payload, "provider receipt");
  const taskId = extractTaskId(payload);
  const status = extractStatus(payload);
  return Object.freeze({
    taskId: taskId || null,
    status: status || null,
    code: typeof payload.code === "number" || typeof payload.code === "string" ? payload.code : null,
    hasResult: Boolean(payload.data && typeof payload.data === "object" && payload.data.result),
    redactedMessage: redactText(payload.message || payload.msg || payload.error?.message || ""),
    receiptHash: require("node:crypto").createHash("sha256").update(stableJson(payload)).digest("hex"),
  });
}

function summariseProxy(raw) {
  if (!raw) return "system/default";
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
  } catch {
    return "invalid";
  }
}

/**
 * Assert the small, model-specific projection that the paid canary relies on.
 * This runs after the real provider's buildRequest but before the one POST is
 * reserved, so a catalog/paramMap drift cannot spend money with the wrong
 * aspect ratio or resolution. It is intentionally conservative and only
 * checks fields whose semantics are frozen by TEST_PRICE_SNAPSHOT.
 */
function assertCanaryWireProjection(selection, body, prompt) {
  readRecord(selection, "canary selection");
  readRecord(body, "canary wire body");
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new CanaryContractError("canary prompt is required");
  }
  const expectedModel = selection.transportModelId || selection.modelKey;
  if (body.model !== expectedModel) {
    throw new CanaryContractError(`canary wire model drifted: expected ${expectedModel}`);
  }
  if (body.prompt !== prompt) {
    throw new CanaryContractError("canary wire prompt drifted");
  }
  if (selection.kind === "image") {
    const canonicalRatio = selection.modelKey === "gpt-image-2"
      ? selection.parameters?.aspect_ratio
      : selection.parameters?.size;
    if (canonicalRatio && body.size !== canonicalRatio) {
      throw new CanaryContractError("canary wire size/aspect-ratio projection drifted");
    }
    const resolution = selection.parameters?.resolution;
    if (resolution && body.resolution !== String(resolution).toLowerCase()) {
      throw new CanaryContractError("canary wire resolution projection drifted");
    }
  }
  if (selection.kind === "video") {
    for (const key of ["size", "resolution", "duration", "generate_audio"]) {
      if (selection.parameters?.[key] !== undefined && body[key] !== selection.parameters[key]) {
        throw new CanaryContractError(`canary wire ${key} projection drifted`);
      }
    }
  }
  return true;
}

module.exports = {
  CanaryContractError,
  CONFIRMATION,
  PRICE_SNAPSHOT_DATE,
  PRICE_SOURCE_URL,
  SEEDANCE_PRICE_SOURCE_URL,
  TEST_PRICE_SNAPSHOT,
  PROMPT_BY_MEDIA,
  TASK_KIND_BY_MEDIA,
  parseCanaryConfig,
  selectCheapestCanaryModel,
  assertSpendWithinCap,
  stableJson,
  extractTaskId,
  extractStatus,
  extractOutputUrls,
  normaliseTerminalStatus,
  redactText,
  receiptSummary,
  assertCanaryWireProjection,
  normaliseProxy,
  summariseProxy,
};
