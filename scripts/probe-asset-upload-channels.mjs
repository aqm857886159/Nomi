// Zero-cost live probe: uploads only synthetic media, then verifies returned URLs.
// Run with: pnpm exec tsx scripts/probe-asset-upload-channels.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { ProxyAgent } from "undici";

import {
  resolveLocalAsset,
  nomiPublicAssetRelayCandidate,
} from "../electron/catalog/assetLocalization.ts";
import { resolveAssetIngestionForKind, LITTERBOX_INGESTION, TMPFILES_INGESTION } from "../electron/catalog/assetIngestionRegistry.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs", "research");
const stamp = new Date().toISOString();
const timeoutMs = 8_000;
const repetitions = 3;
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || "";

function errorText(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "超时";
  return error instanceof Error ? error.message : String(error);
}

async function request(url, init = {}, useProxy = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("超时")), timeoutMs);
  try {
    const dispatcher = useProxy && proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
    return await fetch(url, { ...init, signal: controller.signal, ...(dispatcher ? { dispatcher } : {}) });
  } finally {
    clearTimeout(timer);
  }
}

async function postMultipart(url, headers, bytes, fileName, contentType, extraFields = {}, fileField = "file") {
  const form = new FormData();
  for (const [key, value] of Object.entries(extraFields)) form.append(key, value);
  form.append(fileField, new Blob([bytes], { type: contentType }), fileName);
  const response = await request(url, { method: "POST", headers, body: form });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function postJson(url, headers, body) {
  const response = await request(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function putBinary(url, headers, bytes, contentType) {
  const response = await request(url, { method: "PUT", headers: { ...headers, "Content-Type": contentType }, body: bytes });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text;
}

function makeAssets() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-upload-probe-"));
  const png = path.join(dir, "probe-64.png");
  const jpeg = path.join(dir, "probe-large.jpg");
  const mp4 = path.join(dir, "probe-1s.mp4");
  const ffmpeg = "ffmpeg";
  const common = ["-hide_banner", "-loglevel", "error", "-y"];
  execFileSync(ffmpeg, [...common, "-f", "lavfi", "-i", "color=c=0x2f80ed:s=64x64", "-frames:v", "1", png]);
  execFileSync(ffmpeg, [...common, "-f", "lavfi", "-i", "nullsrc=s=2560x1440:d=1", "-vf", "noise=alls=80:allf=t+u", "-frames:v", "1", "-q:v", "2", jpeg]);
  execFileSync(ffmpeg, [...common, "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25", "-t", "1", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
  return {
    dir,
    assets: [
      { id: "png-64", fileName: "probe-64.png", contentType: "image/png", mediaKind: "image", bytes: fs.readFileSync(png) },
      { id: "jpeg-large", fileName: "probe-large.jpg", contentType: "image/jpeg", mediaKind: "image", bytes: fs.readFileSync(jpeg) },
      { id: "mp4-1s", fileName: "probe-1s.mp4", contentType: "video/mp4", mediaKind: "video", bytes: fs.readFileSync(mp4) },
    ],
  };
}

async function verifyUrl(url, expected) {
  const result = { url, get: null, headDirect: null, headProxy: null };
  const getStarted = performance.now();
  try {
    const response = await request(url);
    const bytes = Buffer.from(await response.arrayBuffer());
    result.get = { ok: response.ok, status: response.status, contentType: response.headers.get("content-type"), bytes: bytes.length, elapsedMs: Math.round(performance.now() - getStarted), contentTypeOk: (response.headers.get("content-type") || "").toLowerCase().split(";")[0] === expected.contentType, sizeOk: bytes.length === expected.bytes.length };
    if (!response.ok) result.get.error = `HTTP ${response.status}`;
  } catch (error) { result.get = { ok: false, elapsedMs: Math.round(performance.now() - getStarted), error: errorText(error) }; }
  const head = async (useProxy) => {
    const started = performance.now();
    try {
      const response = await request(url, { method: "HEAD" }, useProxy);
      return { ok: response.ok, status: response.status, contentType: response.headers.get("content-type"), contentLength: Number(response.headers.get("content-length") || 0) || null, elapsedMs: Math.round(performance.now() - started) };
    } catch (error) { return { ok: false, elapsedMs: Math.round(performance.now() - started), error: errorText(error) }; }
  };
  result.headDirect = await head(false);
  if (proxyUrl) result.headProxy = await head(true);
  return result;
}

function candidateFor(id, asset) {
  if (id === "litterbox") return { ingestion: LITTERBOX_INGESTION, uploadApiKey: "", vendorKey: null };
  if (id === "tmpfiles") return { ingestion: TMPFILES_INGESTION, uploadApiKey: "", vendorKey: null };
  if (id === "nomi-relay") return nomiPublicAssetRelayCandidate();
  if (id === "kie") {
    const key = process.env.KIE_API_KEY || "";
    const ingestion = resolveAssetIngestionForKind({ key: "kie" }, asset.mediaKind);
    return ingestion && key ? { ingestion, uploadApiKey: key, vendorKey: "kie" } : null;
  }
  if (id === "apimart") {
    const key = process.env.APIMART_API_KEY || "";
    const ingestion = resolveAssetIngestionForKind({ key: "apimart" }, asset.mediaKind);
    return ingestion && key ? { ingestion, uploadApiKey: key, vendorKey: "apimart" } : null;
  }
  return null;
}

const channels = ["litterbox", "tmpfiles", "nomi-relay", "kie", "apimart"];
const generated = makeAssets();
const rows = [];
try {
  for (const channel of channels) {
    for (const asset of generated.assets) {
      const candidate = candidateFor(channel, asset);
      /*
      const unavailable = !candidate ? (channel === "kie" || channel === "apimart" ? (process.env[`${channel === "kie" ? "KIE" : "APIMART"}_API_KEY"] ? "通道不接受该媒体类型" : "未测：无 key") : "通道不可用") : null;
      */
      const unavailable = !candidate
        ? (channel === "kie" || channel === "apimart"
          ? (process.env[channel === "kie" ? "KIE_API_KEY" : "APIMART_API_KEY"] ? "unsupported-media-kind" : "未测：无 key")
          : "channel-unavailable")
        : null;
      for (let attempt = 1; attempt <= repetitions; attempt += 1) {
        const row = { timestamp: new Date().toISOString(), channel, asset: asset.id, mediaKind: asset.mediaKind, bytes: asset.bytes.length, attempt, upload: null, verification: null };
        if (unavailable) { row.upload = { ok: false, skipped: unavailable }; rows.push(row); continue; }
        console.log(`probe ${channel}/${asset.id} #${attempt}`);
        const started = performance.now();
        try {
          const url = await resolveLocalAsset(`data:${asset.contentType};base64,${asset.bytes.toString("base64")}`, candidate.ingestion, candidate.uploadApiKey, (value) => value.startsWith("data:") ? { bytes: asset.bytes, contentType: asset.contentType, fileName: asset.fileName } : null, postJson, postMultipart, putBinary);
          row.upload = { ok: true, elapsedMs: Math.round(performance.now() - started), url };
          row.verification = await verifyUrl(url, asset);
        } catch (error) { row.upload = { ok: false, elapsedMs: Math.round(performance.now() - started), error: errorText(error) }; }
        rows.push(row);
      }
    }
  }
} finally { fs.rmSync(generated.dir, { recursive: true, force: true }); }

fs.mkdirSync(outDir, { recursive: true });
const rawPath = path.join(outDir, "2026-10-08-asset-upload-channel-probe.json");
fs.writeFileSync(rawPath, JSON.stringify({ generatedAt: stamp, timeoutMs, repetitions, proxyConfigured: Boolean(proxyUrl), environment: { platform: process.platform, node: process.version }, results: rows }, null, 2) + "\n");
console.log(JSON.stringify({ rawPath, count: rows.length, proxyConfigured: Boolean(proxyUrl) }, null, 2));
