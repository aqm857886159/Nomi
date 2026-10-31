/* global File, FormData, Request */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler, { cleanup } from "../../workers/nomi-asset-relay/src/index.mjs";
import { createFakeR2, R2_BATCH_LIMIT } from "./fakeR2.mjs";

const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

function env(bucketOptions) { return { RELAY_TOKEN: "secret", PUBLIC_BASE_URL: "https://assets.example", ASSETS: createFakeR2(bucketOptions) }; }

test("rejects unauthenticated or unsupported uploads before R2", async () => {
  const e = env();
  const form = new FormData();
  form.append("file", new File(["x"], "x.exe", { type: "application/x-msdownload" }));
  const response = await handler.fetch(new Request("https://assets.example/v1/assets", { method: "POST", body: form }), e);
  assert.equal(response.status, 401);
  const authorized = await handler.fetch(new Request("https://assets.example/v1/assets", { method: "POST", headers: { Authorization: "Bearer secret" }, body: form }), e);
  assert.equal(authorized.status, 415);
  assert.equal(e.ASSETS.values.size, 0);
});

test("allows the desktop fallback without exposing the private relay token when public mode is enabled", async () => {
  const e = env();
  e.PUBLIC_UPLOAD_ENABLED = "true";
  const form = new FormData();
  form.append("file", new File(["hello"], "hello.wav", { type: "audio/wav" }));
  const response = await handler.fetch(new Request("https://assets.example/v1/assets", { method: "POST", body: form }), e);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).channel, "public");
});

test("fails closed when the public rate limiter is unavailable", async () => {
  const e = env();
  e.PUBLIC_UPLOAD_ENABLED = "true";
  e.PUBLIC_UPLOAD_LIMITER = { limit: async () => { throw new Error("rate limiter unavailable"); } };
  const form = new FormData();
  form.append("file", new File(["hello"], "hello.wav", { type: "audio/wav" }));
  const response = await handler.fetch(new Request("https://assets.example/v1/assets", { method: "POST", body: form }), e);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "public_upload_unavailable");
  assert.equal(e.ASSETS.values.size, 0);
});

test("stores an allowed file and serves it until its lifecycle expiry", async () => {
  const e = env();
  const form = new FormData();
  form.append("file", new File(["hello"], "hello.wav", { type: "audio/wav" }));
  const upload = await handler.fetch(new Request("https://assets.example/v1/assets", { method: "POST", headers: { Authorization: "Bearer secret" }, body: form }), e);
  assert.equal(upload.status, 201);
  const payload = await upload.json();
  assert.match(payload.url, /^https:\/\/assets\.example\/v1\/assets\/assets%2F/);
  const fetched = await handler.fetch(new Request(payload.url), e);
  assert.equal(fetched.status, 200);
  assert.equal(await fetched.text(), "hello");
  assert.equal(fetched.headers.get("Content-Type"), "audio/wav");
  const usage = await handler.fetch(new Request("https://assets.example/v1/usage", { headers: { Authorization: "Bearer secret" } }), e);
  assert.equal(usage.status, 200);
  const usagePayload = await usage.json();
  assert.equal(usagePayload.objectCount, 1);
  assert.equal(usagePayload.storageBytes, 5);
  assert.equal(usagePayload.estimatedMonthlyStorageUsd, 0);
});

test("HEAD mirrors GET metadata without returning a body", async () => {
  const e = env();
  const form = new FormData();
  form.append("file", new File(["hello"], "hello.wav", { type: "audio/wav" }));
  const upload = await handler.fetch(new Request("https://assets.example/v1/assets", { method: "POST", headers: { Authorization: "Bearer secret" }, body: form }), e);
  const payload = await upload.json();
  const get = await handler.fetch(new Request(payload.url), e);
  const head = await handler.fetch(new Request(payload.url, { method: "HEAD" }), e);
  assert.equal(head.status, get.status);
  assert.equal(head.headers.get("Content-Type"), get.headers.get("Content-Type"));
  assert.equal(head.headers.get("Content-Length"), get.headers.get("Content-Length"));
  assert.equal(head.headers.get("Cache-Control"), get.headers.get("Cache-Control"));
  assert.equal(await head.text(), "");
});

test("HEAD uses the same expired and missing-object statuses as GET", async () => {
  const e = env();
  e.ASSETS.seed("assets/expired", { expiresAt: PAST });
  const expired = await handler.fetch(new Request("https://assets.example/v1/assets/assets%2Fexpired", { method: "HEAD" }), e);
  const missing = await handler.fetch(new Request("https://assets.example/v1/assets/assets%2Fmissing", { method: "HEAD" }), e);
  assert.equal(expired.status, 404);
  assert.equal(missing.status, 404);
});

test("blocks an upload that would exceed the configured storage guard", async () => {
  const e = env();
  e.MAX_STORAGE_BYTES = "4";
  const form = new FormData();
  form.append("file", new File(["hello"], "hello.wav", { type: "audio/wav" }));
  const response = await handler.fetch(new Request("https://assets.example/v1/assets", { method: "POST", headers: { Authorization: "Bearer secret" }, body: form }), e);
  assert.equal(response.status, 507);
  assert.equal((await response.json()).error, "storage_limit_reached");
  assert.equal(e.ASSETS.values.size, 0);
});


async function uploadStatus(e, content = "hello") {
  const form = new FormData();
  form.append("file", new File([content], "hello.wav", { type: "audio/wav" }));
  return (await handler.fetch(new Request("https://assets.example/v1/assets", { method: "POST", headers: { Authorization: "Bearer secret" }, body: form }), e)).status;
}

async function usageOf(e) {
  const response = await handler.fetch(new Request("https://assets.example/v1/usage", { headers: { Authorization: "Bearer secret" } }), e);
  assert.equal(response.status, 200);
  return response.json();
}

test("the fake bucket hides metadata from list() unless it is requested, like R2 does", async () => {
  const bucket = createFakeR2();
  bucket.seed("assets/a", { size: 3, expiresAt: FUTURE });
  const bare = await bucket.list({ prefix: "assets/" });
  assert.equal(bare.objects[0].customMetadata, undefined);
  assert.equal(bare.objects[0].size, 3);
  const included = await bucket.list({ prefix: "assets/", include: ["customMetadata"] });
  assert.equal(included.objects[0].customMetadata.expiresAt, FUTURE);
  await assert.rejects(() => bucket.list({ limit: R2_BATCH_LIMIT + 1 }));
  await assert.rejects(() => bucket.delete(Array.from({ length: R2_BATCH_LIMIT + 1 }, (_, i) => `assets/${i}`)));
});

test("cleanup removes expired objects and leaves live objects", async () => {
  const e = env();
  e.ASSETS.seed("assets/expired", { size: 7, expiresAt: PAST });
  e.ASSETS.seed("assets/live", { size: 1, expiresAt: FUTURE });
  assert.deepEqual(await cleanup(e), { deleted: 1, deletedBytes: 7, untrackedObjectCount: 0 });
  assert.equal(e.ASSETS.values.has("assets/expired"), false);
  assert.equal(e.ASSETS.values.has("assets/live"), true);
});

test("cleanup never deletes objects that carry no usable expiry, and reports how many there are", async () => {
  const e = env();
  e.ASSETS.seed("assets/legacy-no-metadata", { size: 5 });
  e.ASSETS.seed("assets/legacy-other-metadata", { size: 5, customMetadata: { originalName: "a.png" } });
  e.ASSETS.seed("assets/garbled", { size: 5, expiresAt: "not-a-date" });
  e.ASSETS.seed("assets/expired", { size: 5, expiresAt: PAST });
  const result = await cleanup(e);
  assert.equal(result.deleted, 1);
  assert.equal(result.untrackedObjectCount, 3);
  assert.deepEqual([...e.ASSETS.values.keys()].sort(), ["assets/garbled", "assets/legacy-no-metadata", "assets/legacy-other-metadata"]);
  assert.equal((await usageOf(e)).untrackedObjectCount, 3);
});

test("cleanup only touches the assets/ prefix", async () => {
  const e = env();
  e.ASSETS.seed("other/expired", { expiresAt: PAST });
  e.ASSETS.seed("assets/expired", { expiresAt: PAST });
  await cleanup(e);
  assert.deepEqual([...e.ASSETS.values.keys()], ["other/expired"]);
});

test("cleanup walks every page and deletes expired objects while paging", async () => {
  const e = env({ pageCap: 3 });
  for (let i = 0; i < 20; i += 1) e.ASSETS.seed(`assets/${String(i).padStart(3, "0")}`, { size: 2, expiresAt: i % 2 === 0 ? PAST : FUTURE });
  const result = await cleanup(e);
  assert.equal(result.deleted, 10);
  assert.equal(result.deletedBytes, 20);
  assert.deepEqual([...e.ASSETS.values.keys()].sort(), Array.from({ length: 10 }, (_, i) => `assets/${String(i * 2 + 1).padStart(3, "0")}`));
  assert.ok(e.ASSETS.calls.list.length >= 7, "20 objects at 3 per page need 7 list calls");
});

test("cleanup deletes in batches of at most 1000 keys, not one call per object", async () => {
  // 2 700 objects: 2 100 expired, 600 live. Real R2 pages hold 1000; the budget below is what a Worker
  // on the free plan may spend per invocation (50), which a per-object delete loop blows through at once.
  const e = env({ maxOperations: 50 });
  for (let i = 0; i < 2700; i += 1) e.ASSETS.seed(`assets/${String(i).padStart(5, "0")}`, { expiresAt: i % 9 < 7 ? PAST : FUTURE });
  const result = await cleanup(e);
  assert.equal(result.deleted, 2100);
  assert.equal(e.ASSETS.values.size, 600);
  assert.equal(e.ASSETS.calls.list.length, 3);
  assert.ok(e.ASSETS.calls.delete.every((count) => count <= R2_BATCH_LIMIT));
  assert.equal(e.ASSETS.calls.delete.reduce((sum, count) => sum + count, 0), 2100);
  assert.ok(e.ASSETS.operations <= 6);
});

test("usage and the storage cap count every byte still in the bucket, expired or not", async () => {
  const e = env();
  e.MAX_STORAGE_BYTES = "120";
  e.ASSETS.seed("assets/expired", { size: 100, expiresAt: PAST });
  e.ASSETS.seed("assets/live", { size: 10, expiresAt: FUTURE });
  const usage = await usageOf(e);
  assert.equal(usage.storageBytes, 110);
  assert.equal(usage.objectCount, 2);
  assert.equal(usage.expiredObjectCount, 1);
  assert.equal(usage.expiredStorageBytes, 100);
  assert.equal(usage.storageHeadroomBytes, 10);
  assert.equal(await uploadStatus(e, "x".repeat(20)), 507, "expired-but-undeleted bytes still fill the bucket");
  assert.equal(await uploadStatus(e, "x".repeat(10)), 201);
});

test("an upload is accepted again once cleanup has removed the expired bytes", async () => {
  const e = env();
  e.MAX_STORAGE_BYTES = "120";
  e.ASSETS.seed("assets/expired", { size: 115, expiresAt: PAST });
  assert.equal(await uploadStatus(e, "x".repeat(10)), 507);
  await cleanup(e);
  assert.equal(await uploadStatus(e, "x".repeat(10)), 201);
});

test("the hourly cron runs the cleanup", async () => {
  const e = env();
  e.ASSETS.seed("assets/expired", { expiresAt: PAST });
  e.ASSETS.seed("assets/live", { expiresAt: FUTURE });
  await handler.scheduled({}, e);
  assert.deepEqual([...e.ASSETS.values.keys()], ["assets/live"]);
});

test("every bucket listing the worker issues asks for customMetadata under the assets/ prefix", async () => {
  const e = env({ pageCap: 2 });
  for (let i = 0; i < 5; i += 1) e.ASSETS.seed(`assets/${i}`, { expiresAt: i % 2 === 0 ? PAST : FUTURE });
  await uploadStatus(e);
  await usageOf(e);
  await handler.scheduled({}, e);
  assert.ok(e.ASSETS.calls.list.length > 0);
  for (const call of e.ASSETS.calls.list) {
    assert.equal(call.prefix, "assets/");
    assert.ok(call.include.includes("customMetadata"), "a list without include never sees expiresAt");
  }
});

// Class-level matrix: whatever mix of objects the bucket holds and however R2 happens to page it,
// cleanup removes exactly the objects whose expiresAt has passed and the usage numbers agree with what is left.
const POPULATIONS = [
  { name: "all expired", objects: [["expired", 4], ["expired", 4], ["expired", 4]] },
  { name: "all live", objects: [["live", 4], ["live", 4], ["live", 4]] },
  { name: "mixed", objects: [["expired", 1], ["live", 2], ["expired", 3], ["live", 4], ["expired", 5], ["live", 6], ["expired", 7]] },
  { name: "no expiry metadata and garbage", objects: [["none", 8], ["garbled", 8], ["expired", 8], ["live", 8]] },
  { name: "empty", objects: [] },
];
const EXPIRES_AT = { expired: PAST, live: FUTURE, garbled: "not-a-date", none: undefined };

for (const pageCap of [1, 2, 3, R2_BATCH_LIMIT]) {
  for (const population of POPULATIONS) {
    test(`matrix: ${population.name}, R2 pages of ${pageCap}: cleanup removes exactly the expired objects and usage matches the bucket`, async () => {
      const e = env({ pageCap });
      population.objects.forEach(([state, size], index) => e.ASSETS.seed(`assets/${String(index).padStart(3, "0")}`, { size, expiresAt: EXPIRES_AT[state] }));
      const totalBytes = population.objects.reduce((sum, [, size]) => sum + size, 0);
      const expired = population.objects.filter(([state]) => state === "expired");
      const before = await usageOf(e);
      assert.equal(before.storageBytes, totalBytes);
      assert.equal(before.objectCount, population.objects.length);
      assert.equal(before.expiredObjectCount, expired.length);
      const result = await cleanup(e);
      assert.equal(result.deleted, expired.length);
      assert.equal(result.deletedBytes, expired.reduce((sum, [, size]) => sum + size, 0));
      assert.equal(e.ASSETS.values.size, population.objects.length - expired.length);
      const after = await usageOf(e);
      assert.equal(after.storageBytes, totalBytes - result.deletedBytes);
      assert.equal(after.expiredObjectCount, 0);
      assert.equal(after.untrackedObjectCount, before.untrackedObjectCount);
    });
  }
}

// Source census: every R2 binding listing in a worker source names the metadata it needs, and the relay has one listing boundary.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKER_SOURCE_ROOTS = ["workers", "infra"];

function workerSources(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...workerSources(full));
    else if (/\.(?:mjs|js|ts)$/.test(entry.name) && !/\.(?:test|node-test)\./.test(entry.name) && !full.includes(`${path.sep}test${path.sep}`)) found.push(full);
  }
  return found;
}

test("census: every worker source that lists an R2 bucket passes include, and the relay lists its bucket in one place", () => {
  const sources = WORKER_SOURCE_ROOTS.flatMap((root) => workerSources(path.join(repoRoot, root)));
  assert.ok(sources.some((file) => file.endsWith(path.join("nomi-asset-relay", "src", "index.mjs"))), "the census must actually see the relay source");
  let relayListCalls = 0;
  for (const file of sources) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/\b(?:ASSETS|BUCKET|bucket|INTAKE|FEEDBACK)\w*\.list\(([^)]*)\)/g)) {
      assert.match(match[1], /include\s*:\s*\[[^\]]*customMetadata/, `${path.relative(repoRoot, file)} lists a bucket without include: ["customMetadata"]: ${match[0]}`);
      if (file.includes("nomi-asset-relay")) relayListCalls += 1;
    }
  }
  assert.equal(relayListCalls, 1, "usage and cleanup must share assetPages() instead of listing the bucket themselves");
});
