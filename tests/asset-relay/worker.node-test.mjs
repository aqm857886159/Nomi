/* global File, FormData, Request, Response */

import test from "node:test";
import assert from "node:assert/strict";
import handler, { cleanup } from "../../workers/nomi-asset-relay/src/index.mjs";

function bucket() {
  const values = new Map();
  return {
    values,
    async put(key, body, options) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      values.set(key, { bytes, options, customMetadata: options.customMetadata, httpMetadata: options.httpMetadata });
    },
    async get(key) {
      const item = values.get(key);
      if (!item) return null;
      return { body: new Response(item.bytes).body, customMetadata: item.customMetadata, writeHttpMetadata(headers) { headers.set("Content-Type", item.httpMetadata.contentType); } };
    },
    async delete(key) { values.delete(key); },
    async list() { return { truncated: false, objects: [...values.entries()].map(([key, value]) => ({ key, size: value.bytes.length, customMetadata: value.customMetadata })) }; },
  };
}

function env() { return { RELAY_TOKEN: "secret", PUBLIC_BASE_URL: "https://assets.example", ASSETS: bucket() }; }

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

test("cleanup removes expired objects and leaves live objects", async () => {
  const e = env();
  e.ASSETS.values.set("assets/expired", { bytes: new Uint8Array([1]), customMetadata: { expiresAt: "2020-01-01T00:00:00.000Z" }, httpMetadata: { contentType: "image/png" } });
  e.ASSETS.values.set("assets/live", { bytes: new Uint8Array([1]), customMetadata: { expiresAt: "2999-01-01T00:00:00.000Z" }, httpMetadata: { contentType: "image/png" } });
  assert.equal(await cleanup(e), 1);
  assert.equal(e.ASSETS.values.has("assets/expired"), false);
  assert.equal(e.ASSETS.values.has("assets/live"), true);
});
