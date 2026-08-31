const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
/* global Headers, Response, URL, File, crypto */

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

async function usageSnapshot(env) {
  let cursor;
  let storageBytes = 0;
  let objectCount = 0;
  let expiredObjectCount = 0;
  do {
    const page = await env.ASSETS.list({ prefix: "assets/", cursor, include: ["customMetadata"] });
    for (const object of page.objects || []) {
      const expiresAt = object.customMetadata?.expiresAt;
      if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
        expiredObjectCount += 1;
        continue;
      }
      objectCount += 1;
      storageBytes += Number(object.size || 0);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return {
    objectCount,
    storageBytes,
    expiredObjectCount,
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

async function read(request, env) {
  const key = assetPath(request);
  if (!key) return json({ error: "not_found" }, 404);
  const object = await env.ASSETS.get(key);
  if (!object) return json({ error: "not_found" }, 404);
  const expiresAt = object.customMetadata?.expiresAt;
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    await env.ASSETS.delete(key);
    return json({ error: "expired" }, 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("X-Nomi-Asset-Expires-At", expiresAt || "");
  return new Response(object.body, { headers });
}

export async function cleanup(env) {
  let cursor;
  let deleted = 0;
  do {
    const page = await env.ASSETS.list({ prefix: "assets/", cursor });
    for (const object of page.objects || []) {
      const expiresAt = object.customMetadata?.expiresAt;
      if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
        await env.ASSETS.delete(object.key);
        deleted += 1;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
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
    if (request.method === "GET" && url.pathname.startsWith("/v1/assets/")) return read(request, env);
    return json({ error: "not_found" }, 404);
  },
  async scheduled(_event, env) {
    await cleanup(env);
  },
};
