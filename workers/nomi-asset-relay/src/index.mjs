const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
/* global Headers, Response, URL, File, crypto, console */

const ASSET_PREFIX = "assets/";
// R2 caps both a list() page and a delete([keys]) call at 1000.
const R2_BATCH_LIMIT = 1000;
// R2 calls are subrequests to an internal service: at most 1,000 per invocation on Workers Free and 10,000 by
// default on Paid (https://developers.cloudflare.com/workers/platform/limits/#subrequests). One scan or cleanup
// spends at most this many, under the Free limit with room for the put/get around it, so a long bucket ends the
// run on our terms instead of the runtime killing it half-way with "Too many subrequests".
const R2_CALL_BUDGET = 900;
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;
const DEFAULT_MAX_STORAGE_BYTES = 8_000_000_000;
const DEFAULT_MAX_MONTHLY_BUDGET_USD = 0;
const FREE_STORAGE_BYTES = 10_000_000_000;
const STORAGE_USD_PER_GB_MONTH = 0.015;
const ALLOWED_MEDIA = new Set(["image", "video", "audio"]);

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
  return { limit: R2_CALL_BUDGET, used: 0, exhausted: false };
}

// The only place that lists the bucket. R2 returns customMetadata from list() only when it is asked for
// with `include` (compatibility_date >= 2022-08-04); without it every object looks like it never expires,
// which is how cleanup silently deleted nothing. Every scan goes through here so the option cannot be forgotten.
// It also owns the per-invocation call budget: a page is only listed while the budget still covers the list
// plus `callsPerPage` follow-up calls the caller makes for that page; otherwise it stops and marks the budget
// exhausted, so callers can tell a finished scan from a cut-short one.
async function* assetPages(env, budget, callsPerPage = 0) {
  let cursor;
  do {
    if (budget.limit - budget.used < 1 + callsPerPage) {
      budget.exhausted = true;
      return;
    }
    budget.used += 1;
    const page = await env.ASSETS.list({ prefix: ASSET_PREFIX, cursor, limit: R2_BATCH_LIMIT, include: ["customMetadata"] });
    yield page.objects || [];
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

// Epoch ms the object expires at, or null when it carries no usable expiresAt (never delete those).
function assetExpiryMs(object) {
  const parsed = Date.parse(object.customMetadata?.expiresAt || "");
  return Number.isNaN(parsed) ? null : parsed;
}

// storageBytes is everything still in the bucket, expired or not: R2 bills what is stored, so the hard cap
// has to see the same bytes the bill does. A scan cut short by the call budget cannot vouch for the total, so
// it throws and the upload / usage callers answer usage_unavailable (fail closed) instead of guessing low.
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
  if (budget.exhausted) throw new Error(`usage scan stopped at the ${budget.limit}-call R2 budget`);
  return {
    objectCount,
    storageBytes,
    expiredObjectCount,
    expiredStorageBytes,
    untrackedObjectCount,
    estimatedMonthlyStorageUsd: storageEstimateUsd(storageBytes),
  };
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
  const snapshot = await usageSnapshot(env);
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
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const key = assetKey(file.name);
  await env.ASSETS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream", cacheControl: "private, max-age=300" },
    customMetadata: { expiresAt, originalName: safeFileName(file.name) },
  });
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
    return json({ error: "expired" }, 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("X-Nomi-Asset-Expires-At", object.customMetadata?.expiresAt || "");
  if (Number.isFinite(object.size)) headers.set("Content-Length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

// Deletes objects whose expiresAt has passed, one batched delete per listed page (a page holds at most
// R2_BATCH_LIMIT keys, so it is always one call). Objects without a usable expiresAt are left alone and only
// counted. A backlog longer than one run's call budget ends the run with complete: false; keys start with the
// upload time (assetKey), so the listing goes oldest first, a cut-short run has removed the oldest expired
// objects, and the next hourly run carries on from there. Objects that stay (live, or without expiresAt) are
// listed again by every run; that only stalls cleanup once they fill the whole budget (~900 pages, about
// 900k objects at R2's usual 1000 per page).
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
