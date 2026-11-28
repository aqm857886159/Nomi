const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
/* global Headers, Response, URL, File, crypto, console */

const ASSET_PREFIX = "assets/";
// R2 caps both a list() page and a delete([keys]) call at 1000.
const R2_BATCH_LIMIT = 1000;
// Workers Free enforces both a 1,000-subrequest limit AND a hard 10ms CPU budget per invocation
// (https://developers.cloudflare.com/workers/platform/limits/#cpu-time). Bounding each scan/cleanup
// to at most 32 R2 subrequests and 10,000 objects keeps worst-case JS CPU around ~1ms while still
// covering up to 10,000 objects per invocation; keys start with the upload epoch ms (assetKey), so
// oldest expired objects are always drained first and later hourly cron runs continue cleanly.
const R2_CALL_BUDGET = 32;
const R2_OBJECT_BUDGET = 10_000;
const USAGE_CACHE_TTL_MS = 60_000;
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;
const DEFAULT_MAX_STORAGE_BYTES = 8_000_000_000;
const DEFAULT_MAX_MONTHLY_BUDGET_USD = 0;
const FREE_STORAGE_BYTES = 10_000_000_000;
const STORAGE_USD_PER_GB_MONTH = 0.015;
const ALLOWED_MEDIA = new Set(["image", "video", "audio"]);

const usageCacheByBucketObject = new WeakMap();
const usageCacheByOriginKey = new Map();

function readUsageCacheEntry(env, now = Date.now()) {
  const bucket = env?.ASSETS;
  if (!bucket || typeof bucket !== "object") return null;
  const entry = bucket.constructor?.name === "R2Bucket"
    ? usageCacheByOriginKey.get(String(env.PUBLIC_BASE_URL || "default"))
    : usageCacheByBucketObject.get(bucket);
  if (!entry || now - entry.cachedAtMs > USAGE_CACHE_TTL_MS) return null;
  return entry;
}

function readUsageCache(env, now = Date.now()) {
  return readUsageCacheEntry(env, now)?.snapshot ?? null;
}

function writeUsageCache(env, snapshot, cachedAtMs = Date.now()) {
  const bucket = env?.ASSETS;
  if (!bucket || typeof bucket !== "object") return;
  const entry = { snapshot: { ...snapshot }, cachedAtMs };
  if (bucket.constructor?.name === "R2Bucket") {
    usageCacheByOriginKey.set(String(env.PUBLIC_BASE_URL || "default"), entry);
  } else {
    usageCacheByBucketObject.set(bucket, entry);
  }
}

function invalidateUsageCache(env) {
  const bucket = env?.ASSETS;
  if (!bucket || typeof bucket !== "object") return;
  if (bucket.constructor?.name === "R2Bucket") {
    usageCacheByOriginKey.delete(String(env.PUBLIC_BASE_URL || "default"));
  } else {
    usageCacheByBucketObject.delete(bucket);
  }
}

function recordUploadedAssetInCache(env, sizeBytes, now = Date.now()) {
  const entry = readUsageCacheEntry(env, now);
  if (!entry) return;
  const storageBytes = entry.snapshot.storageBytes + sizeBytes;
  writeUsageCache(
    env,
    {
      ...entry.snapshot,
      objectCount: entry.snapshot.objectCount + 1,
      storageBytes,
      estimatedMonthlyStorageUsd: storageEstimateUsd(storageBytes),
    },
    entry.cachedAtMs,
  );
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function bearer(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function authorized(request, env) {
  return Boolean(env.RELAY_TOKEN) && bearer(request) === env.RELAY_TOKEN;
}

async function canUpload(request, env) {
  if (authorized(request, env)) return { ok: true, mode: "private" };
  if (String(env.PUBLIC_UPLOAD_ENABLED || "").toLowerCase() !== "true") return { ok: false, mode: "disabled" };
  if (env.PUBLIC_UPLOAD_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    try {
      const result = await env.PUBLIC_UPLOAD_LIMITER.limit({ key: `public-upload:${ip}` });
      if (!result.success) return { ok: false, mode: "rate-limited" };
    } catch {
      return { ok: false, mode: "limiter-unavailable" };
    }
  }
  return { ok: true, mode: "public" };
}

function maxUploadBytes(env) {
  const value = Number(env.MAX_UPLOAD_BYTES || DEFAULT_MAX_BYTES);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MAX_BYTES;
}

function maxStorageBytes(env) {
  const value = Number(env.MAX_STORAGE_BYTES || DEFAULT_MAX_STORAGE_BYTES);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MAX_STORAGE_BYTES;
}

function monthlyBudgetUsd(env) {
  const value = Number(env.MAX_MONTHLY_BUDGET_USD ?? DEFAULT_MAX_MONTHLY_BUDGET_USD);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_MAX_MONTHLY_BUDGET_USD;
}

function roundMoney(value) {
  return Math.round(value * 10000) / 10000;
}

function storageEstimateUsd(storageBytes) {
  const billableBytes = Math.max(0, storageBytes - FREE_STORAGE_BYTES);
  return roundMoney((billableBytes / 1_000_000_000) * STORAGE_USD_PER_GB_MONTH);
}

function publicBaseUrl(request, env) {
  return String(env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/+$/, "");
}

function safeFileName(name) {
  const value = String(name || "asset").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return value.slice(-120) || "asset";
}

function assetKey(fileName) {
  return `assets/${Date.now()}-${crypto.randomUUID()}-${safeFileName(fileName)}`;
}

function assetPath(request) {
  const url = new URL(request.url);
  const prefix = "/v1/assets/";
  if (!url.pathname.startsWith(prefix)) return null;
  const key = decodeURIComponent(url.pathname.slice(prefix.length));
  return key.startsWith("assets/") ? key : null;
}

function r2CallBudget() {
  return { limit: R2_CALL_BUDGET, used: 0, objectLimit: R2_OBJECT_BUDGET, objects: 0, exhausted: false };
}

// The only place that lists the bucket. R2 returns customMetadata from list() only when it is asked for
// with `include` (compatibility_date >= 2022-08-04); without it every object looks like it never expires,
// which is how cleanup silently deleted nothing. Every scan goes through here so the option cannot be forgotten.
// It also owns both per-invocation budgets (R2 calls and scanned objects): a page is only listed while both
// budgets still have room; otherwise it stops and marks the budget exhausted.
async function* assetPages(env, budget, callsPerPage = 0) {
  let cursor;
  do {
    if (budget.limit - budget.used < 1 + callsPerPage || budget.objects >= budget.objectLimit) {
      budget.exhausted = true;
      return;
    }
    const pageLimit = Math.min(R2_BATCH_LIMIT, budget.objectLimit - budget.objects);
    budget.used += 1;
    const page = await env.ASSETS.list({ prefix: ASSET_PREFIX, cursor, limit: pageLimit, include: ["customMetadata"] });
    const objects = page.objects || [];
    budget.objects += objects.length;
    yield objects;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

// Epoch ms the object expires at, or null when it carries no usable expiry (never delete those).
// Prefers numeric `expiresAtMs` in O(1) to avoid Date.parse overhead; falls back to legacy ISO `expiresAt`.
function assetExpiryMs(object) {
  const meta = object.customMetadata;
  if (!meta) return null;
  const rawMs = meta.expiresAtMs;
  if (rawMs !== undefined && rawMs !== "") {
    const numeric = Number(rawMs);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  const rawIso = meta.expiresAt;
  if (!rawIso) return null;
  const parsed = Date.parse(rawIso);
  return Number.isNaN(parsed) ? null : parsed;
}

// storageBytes is everything still in the bucket, expired or not: R2 bills what is stored, so the hard cap
// has to see the same bytes the bill does. A scan cut short by the call/object budget cannot vouch for the
// total, so it throws and the upload / usage callers answer usage_unavailable (fail closed) instead of guessing low.
async function usageSnapshot(env) {
  const now = Date.now();
  const budget = r2CallBudget();
  let storageBytes = 0;
  let objectCount = 0;
  let expiredObjectCount = 0;
  let expiredStorageBytes = 0;
  let untrackedObjectCount = 0;
  for await (const objects of assetPages(env, budget)) {
    for (const object of objects) {
      const size = Number(object.size || 0);
      const expiresAtMs = assetExpiryMs(object);
      objectCount += 1;
      storageBytes += size;
      if (expiresAtMs === null) untrackedObjectCount += 1;
      else if (expiresAtMs <= now) {
        expiredObjectCount += 1;
        expiredStorageBytes += size;
      }
    }
  }
  if (budget.exhausted) throw new Error(`usage scan stopped at the ${budget.limit}-call / ${budget.objectLimit}-object R2 budget`);
  const snapshot = {
    objectCount,
    storageBytes,
    expiredObjectCount,
    expiredStorageBytes,
    untrackedObjectCount,
    estimatedMonthlyStorageUsd: storageEstimateUsd(storageBytes),
  };
  writeUsageCache(env, snapshot, now);
  return snapshot;
}

async function cachedUsageSnapshot(env) {
  return readUsageCache(env) ?? usageSnapshot(env);
}

function usagePayload(request, env, snapshot) {
  const budgetUsd = monthlyBudgetUsd(env);
  const storageLimitBytes = maxStorageBytes(env);
  return {
    ...snapshot,
    storageGb: roundMoney(snapshot.storageBytes / 1_000_000_000),
    freeStorageGb: FREE_STORAGE_BYTES / 1_000_000_000,
    storageLimitBytes,
    storageHeadroomBytes: Math.max(0, storageLimitBytes - snapshot.storageBytes),
    configuredMonthlyBudgetUsd: budgetUsd,
    estimatedMonthlyHeadroomUsd: roundMoney(Math.max(0, budgetUsd - snapshot.estimatedMonthlyStorageUsd)),
    accounting: "storage_estimate_only",
    accountingNote: "Cloudflare R2 dashboard is the source of truth for Class A/Class B operations and the current bill.",
    r2DashboardUrl: String(env.R2_DASHBOARD_URL || "https://dash.cloudflare.com/"),
    generatedAt: new Date().toISOString(),
    ...(request ? { endpoint: `${publicBaseUrl(request, env)}/v1/usage` } : {}),
  };
}

function usageResponse(request, env, snapshot) {
  return json(usagePayload(request, env, snapshot));
}

async function enforceStorageBudget(env, incomingBytes) {
  const snapshot = await cachedUsageSnapshot(env);
  const projectedStorageBytes = snapshot.storageBytes + incomingBytes;
  if (projectedStorageBytes > maxStorageBytes(env)) {
    return { snapshot, error: json({ error: "storage_limit_reached", ...usagePayload(null, env, snapshot) }, 507) };
  }
  const projectedCost = storageEstimateUsd(projectedStorageBytes);
  if (projectedCost > monthlyBudgetUsd(env)) {
    return { snapshot, error: json({ error: "monthly_budget_reached", ...usagePayload(null, env, snapshot), projectedMonthlyStorageUsd: projectedCost }, 507) };
  }
  return { snapshot, error: null };
}

async function upload(request, env) {
  const access = await canUpload(request, env);
  if (!access.ok) {
    if (access.mode === "rate-limited") return json({ error: "rate_limited" }, 429);
    if (access.mode === "limiter-unavailable") return json({ error: "public_upload_unavailable" }, 503);
    return json({ error: "unauthorized" }, 401);
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > maxUploadBytes(env)) return json({ error: "file_too_large" }, 413);
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "multipart_required" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "file_required" }, 400);
  if (!ALLOWED_MEDIA.has(String(file.type || "").split("/", 1)[0])) return json({ error: "media_type_not_allowed" }, 415);
  if (file.size <= 0 || file.size > maxUploadBytes(env)) return json({ error: "file_too_large" }, 413);
  let budget;
  try {
    budget = await enforceStorageBudget(env, file.size);
  } catch {
    return json({ error: "usage_unavailable", message: "无法确认当前 R2 用量，已停止上传以避免产生不可控费用。" }, 503);
  }
  if (budget.error) return budget.error;
  const ttlSeconds = Math.max(15 * 60, Number(env.ASSET_TTL_SECONDS || DEFAULT_TTL_SECONDS));
  const expiresAtMs = Date.now() + ttlSeconds * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const key = assetKey(file.name);
  await env.ASSETS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream", cacheControl: "private, max-age=300" },
    customMetadata: { expiresAt, expiresAtMs: String(expiresAtMs), originalName: safeFileName(file.name) },
  });
  recordUploadedAssetInCache(env, file.size);
  return json({ url: `${publicBaseUrl(request, env)}/v1/assets/${encodeURIComponent(key)}`, expiresAt, channel: access.mode }, 201);
}

async function readAsset(request, env) {
  const key = assetPath(request);
  if (!key) return json({ error: "not_found" }, 404);
  const object = await env.ASSETS.get(key);
  if (!object) return json({ error: "not_found" }, 404);
  const expiresAtMs = assetExpiryMs(object);
  if (expiresAtMs !== null && expiresAtMs <= Date.now()) {
    await env.ASSETS.delete(key);
    invalidateUsageCache(env);
    return json({ error: "expired" }, 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=300");
  headers.set(
    "X-Nomi-Asset-Expires-At",
    object.customMetadata?.expiresAt || (expiresAtMs !== null ? new Date(expiresAtMs).toISOString() : ""),
  );
  if (Number.isFinite(object.size)) headers.set("Content-Length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

// Deletes objects whose expiry has passed, one batched delete per listed page (a page holds at most
// R2_BATCH_LIMIT keys, so it is always one call). Objects without a usable expiry are left alone and only
// counted. A backlog longer than one run's 10ms-CPU-safe call/object budget ends the run with complete: false;
// keys start with the upload time (assetKey), so the listing goes oldest first, a cut-short run has removed
// the oldest expired objects, and the next hourly run carries on from there.
export async function cleanup(env) {
  const now = Date.now();
  const budget = r2CallBudget();
  let deleted = 0;
  let deletedBytes = 0;
  let untrackedObjectCount = 0;
  for await (const objects of assetPages(env, budget, 1)) {
    const expired = [];
    for (const object of objects) {
      const expiresAtMs = assetExpiryMs(object);
      if (expiresAtMs === null) untrackedObjectCount += 1;
      else if (expiresAtMs <= now) expired.push(object);
    }
    if (expired.length === 0) continue;
    budget.used += 1;
    await env.ASSETS.delete(expired.map((object) => object.key));
    deleted += expired.length;
    deletedBytes += expired.reduce((sum, object) => sum + Number(object.size || 0), 0);
  }
  invalidateUsageCache(env);
  return { deleted, deletedBytes, untrackedObjectCount, r2Calls: budget.used, complete: !budget.exhausted };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/v1/assets") return upload(request, env);
    if (request.method === "GET" && url.pathname === "/v1/usage") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      try {
        return usageResponse(request, env, await usageSnapshot(env));
      } catch {
        return json({ error: "usage_unavailable" }, 503);
      }
    }
    if (["GET", "HEAD"].includes(request.method) && url.pathname.startsWith("/v1/assets/")) return readAsset(request, env);
    return json({ error: "not_found" }, 404);
  },
  async scheduled(_event, env) {
    console.log(JSON.stringify({ event: "asset_cleanup", ...(await cleanup(env)) }));
  },
};
