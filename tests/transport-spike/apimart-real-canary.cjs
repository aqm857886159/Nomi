"use strict";

/**
 * One-shot, opt-in APIMart media canary.
 *
 * The normal test suite must never spend money.  This launcher exits before
 * Electron/network initialisation unless all paid-run confirmations are set.
 * When enabled it uses the shipped catalog + encrypted Settings credential +
 * APIMart provider adapter, dispatches exactly one POST, observes that same
 * task, downloads the provider output, and proves it with ffprobe.  A POST
 * error is deliberately recorded as submission_unknown; this script never
 * retries a paid request.
 *
 * Examples (do not put a key in the command line):
 *   pnpm build
 *   NOMI_APIMART_REAL_CANARY=1 \
 *   NOMI_APIMART_REAL_CANARY_CONFIRM=ONE_PAID_JOB \
 *   NOMI_APIMART_CANARY_PRICE_ACK=2026-08-31 \
 *   NOMI_APIMART_CANARY_KIND=image \
 *   NOMI_APIMART_CANARY_MAX_USD=0.0085 \
 *   NOMI_APIMART_CANARY_PROXY=http://127.0.0.1:7897 \
 *   ./node_modules/.bin/electron tests/transport-spike/apimart-real-canary.cjs
 *
 * Read-only continuation after a process interruption (never POSTs):
 *   NOMI_APIMART_CANARY_MANIFEST=/tmp/.../canary-....json \
 *   ./node_modules/.bin/electron tests/transport-spike/apimart-real-canary.cjs --poll-only
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const contract = require("./apimart-real-canary-contract.cjs");

const argv = process.argv.slice(2);
const pollOnly = argv.includes("--poll-only");

// The gate is evaluated before touching Electron.  `node script` and normal
// Vitest/Playwright discovery therefore remain zero-cost by construction.
let config;
if (!pollOnly) {
  try {
    config = contract.parseCanaryConfig(process.env);
  } catch (error) {
    console.error(`CANARY BLOCKED: ${contract.redactText(error?.message || error)}`);
    process.exit(2);
  }
  if (!config.enabled) {
    console.log(`SKIP apimart-real-canary: ${config.reason}`);
    process.exit(0);
  }
} else {
  const manifestPath = String(process.env.NOMI_APIMART_CANARY_MANIFEST || "").trim();
  if (!manifestPath) {
    console.error("POLL BLOCKED: set NOMI_APIMART_CANARY_MANIFEST to an existing canary manifest");
    process.exit(2);
  }
  config = Object.freeze({
    enabled: true,
    pollOnly: true,
    manifestPath,
    pollIntervalMs: boundedEnvInteger(process.env.NOMI_APIMART_CANARY_POLL_MS, 5000, 1000, 60000),
    maxPolls: boundedEnvInteger(process.env.NOMI_APIMART_CANARY_MAX_POLLS, 96, 1, 720),
    requestTimeoutMs: boundedEnvInteger(process.env.NOMI_APIMART_CANARY_REQUEST_TIMEOUT_MS, 60000, 5000, 300000),
    proxy: contract.normaliseProxy(process.env.NOMI_APIMART_CANARY_PROXY),
  });
}

function boundedEnvInteger(value, fallback, min, max) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`value must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function safeRunId(value) {
  const runId = String(value || "").trim();
  if (runId && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(runId)) {
    throw new Error("NOMI_APIMART_CANARY_RUN_ID contains unsupported characters");
  }
  return runId || `canary-${Date.now()}-${process.pid}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw new Error(`cannot read JSON ${path.basename(filePath)}`);
  }
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function acquireLock(lockPath) {
  ensureDir(path.dirname(lockPath));
  let fd;
  try {
    fd = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    if (error && error.code === "EEXIST") {
      throw new Error(`canary lock exists (${path.basename(lockPath)}); inspect the prior manifest and reconcile before retrying`);
    }
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { fs.closeSync(fd); } catch { /* already closed */ }
    try { fs.unlinkSync(lockPath); } catch { /* best effort; ledger still blocks POST */ }
  };
}

function catalogCandidates(app) {
  const candidates = [];
  const settingsRoot = String(process.env.NOMI_SETTINGS_DIR || "").trim();
  if (settingsRoot) candidates.push(path.join(settingsRoot, "model-catalog.json"));
  try { candidates.push(path.join(app.getPath("userData"), "model-catalog.json")); } catch { /* app not ready */ }
  try {
    const appData = app.getPath("appData");
    candidates.push(path.join(appData, "nomi", "model-catalog.json"));
    candidates.push(path.join(appData, "Nomi", "model-catalog.json"));
  } catch { /* app not ready */ }
  return Array.from(new Set(candidates.map((item) => path.resolve(item))));
}

/**
 * Read the same encrypted APIMart record the desktop app uses.  Plaintext or
 * environment credentials are intentionally rejected: this canary is meant
 * to prove the Settings → provider path, not create a second credential path.
 */
function loadCatalogAndKey(app, safeStorage) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("OS secure storage is unavailable; no paid canary was dispatched");
  for (const catalogPath of catalogCandidates(app)) {
    const catalog = readJson(catalogPath);
    if (!catalog || !Array.isArray(catalog.vendors) || !Array.isArray(catalog.models)) continue;
    const record = catalog.apiKeysByVendor && catalog.apiKeysByVendor.apimart;
    if (!record || record.enc !== "safeStorage" || typeof record.apiKey !== "string" || !record.apiKey.trim()) continue;
    let key = "";
    try { key = safeStorage.decryptString(Buffer.from(record.apiKey, "base64")).trim(); } catch { continue; }
    if (!/^sk-[A-Za-z0-9_-]+$/.test(key)) continue;
    return Object.freeze({ catalog, key, catalogPath });
  }
  throw new Error("no decryptable APIMart Settings credential was found; save the key in Settings first");
}

function makeTimedFetch(appFetch, timeoutMs) {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let removeExternal;
    if (init.signal) {
      const abortExternal = () => controller.abort(init.signal.reason);
      if (init.signal.aborted) controller.abort(init.signal.reason);
      else {
        init.signal.addEventListener("abort", abortExternal, { once: true });
        removeExternal = () => init.signal.removeEventListener("abort", abortExternal);
      }
    }
    try {
      return await appFetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      removeExternal?.();
    }
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : contract.stableJson(value)).digest("hex");
}

function publicProxySummary(resolution, requested) {
  if (requested) return contract.summariseProxy(requested);
  if (!resolution || resolution.kind === "none") return "direct/system";
  return contract.summariseProxy(resolution.url);
}

function providerFor({ catalog, key, appFetch, timeoutMs }) {
  const { createGenerationProviderBootstrap } = require("../../dist-electron/capabilityCore/generationProviderBootstrap.js");
  const timedFetch = makeTimedFetch(appFetch, timeoutMs);
  const bootstrap = createGenerationProviderBootstrap(catalog, {
    catalogReader: () => catalog,
    connectionResolver: (vendorKey) => vendorKey === "apimart" ? { apiKey: key, baseUrl: "https://api.apimart.ai" } : null,
    fetchImpl: timedFetch,
  });
  const provider = bootstrap.providers.find((candidate) => candidate.providerId === "apimart");
  if (!provider) {
    const readiness = bootstrap.readinessByProvider.apimart;
    const missing = readiness?.missingForSubmit?.join(", ") || "credential/catalog/provider contract";
    throw new Error(`APIMart provider is not ready (${missing})`);
  }
  return Object.freeze({ provider, timedFetch });
}

function initialManifest({ runId, config, selection, prompt, catalogPath, outputDir, ledgerPath }) {
  return {
    schemaVersion: 1,
    runId,
    state: "prepared",
    postCount: 0,
    executionOwner: "apimart-provider-canary",
    productionRun: { used: false, note: "network canary only; Host/ProductionRun lineage is verified by the UI journey" },
    provider: "apimart",
    kind: selection.kind,
    taskKind: selection.taskKind,
    mode: selection.mode,
    model: selection.modelKey,
    variant: selection.variantId,
    ...(selection.transportModelId ? { transportModelId: selection.transportModelId } : {}),
    mappingId: selection.mappingId,
    parameters: selection.parameters,
    prompt,
    estimatedCostUsd: selection.estimatedCostUsd,
    currency: "USD",
    price: {
      spec: selection.spec,
      unit: selection.unit,
      ...(selection.pricePerSecondUsd ? { pricePerSecondUsd: selection.pricePerSecondUsd } : {}),
      checkedAt: contract.PRICE_SNAPSHOT_DATE,
      sourceUrl: selection.sourceUrl,
    },
    catalogPath,
    outputDir,
    ledgerPath,
    createdAt: new Date().toISOString(),
    poll: [],
  };
}

function updateLedger(ledgerPath, entry) {
  const current = readJson(ledgerPath) || { schemaVersion: 1, entries: [] };
  if (!Array.isArray(current.entries)) throw new Error("canary ledger is invalid; manual reconciliation required");
  const without = current.entries.filter((candidate) => candidate.runId !== entry.runId);
  without.push(entry);
  writeJsonAtomic(ledgerPath, { schemaVersion: 1, entries: without });
}

function assertNoPreviousPaidAttempt(ledgerPath) {
  const ledger = readJson(ledgerPath);
  if (!ledger) return;
  if (!Array.isArray(ledger.entries)) throw new Error("canary ledger is invalid; manual reconciliation required");
  const previous = ledger.entries.find((entry) => Number(entry.postCount) > 0 || entry.state === "dispatching");
  if (previous) {
    throw new Error(`a prior canary already reserved a paid POST (${previous.runId}); poll/reconcile its manifest instead of submitting another`);
  }
}

function responseError(response, text) {
  const short = contract.redactText(String(text || "").replace(/\s+/g, " "));
  return new Error(`APIMart HTTP ${response.status}${short ? `: ${short}` : ""}`);
}

async function downloadAndProbe({ fetchImpl, url, kind, outputDir, runId }) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("provider output URL is invalid"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("provider output URL is not a safe HTTP(S) URL");
  }
  const response = await fetchImpl(url, { method: "GET" });
  if (!response.ok) throw responseError(response, await response.text().catch(() => ""));
  const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("provider output is empty");
  if (bytes.length > 100 * 1024 * 1024) throw new Error("provider output exceeds the 100MB canary safety limit");
  const expectedPrefix = kind === "image" ? ["image/"] : ["video/"];
  const magicOk = kind === "image"
    ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      || bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      || bytes.subarray(0, 4).toString("ascii") === "RIFF"
      || bytes.subarray(0, 4).toString("ascii") === "GIF8"
    : bytes.subarray(4, 8).toString("ascii") === "ftyp" || bytes.subarray(0, 4).toString("ascii") === "RIFF";
  if (!expectedPrefix.some((prefix) => contentType.startsWith(prefix)) && !magicOk) {
    throw new Error(`downloaded output is not a ${kind} (content-type=${contentType || "unknown"})`);
  }
  const extension = kind === "video"
    ? (contentType.includes("webm") ? "webm" : "mp4")
    : (contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : contentType.includes("webp") ? "webp" : "png");
  ensureDir(outputDir);
  const filePath = path.join(outputDir, `${runId}.${extension}`);
  fs.writeFileSync(filePath, bytes, { mode: 0o600 });
  const ffprobePath = require("@ffprobe-installer/ffprobe").path;
  const probe = await promisify(execFile)(ffprobePath, ["-v", "error", "-show_entries", "format=format_name,duration,size", "-show_streams", "-of", "json", filePath], { maxBuffer: 2 * 1024 * 1024 });
  let ffprobe;
  try { ffprobe = JSON.parse(probe.stdout); } catch { throw new Error("ffprobe returned invalid JSON"); }
  const streams = Array.isArray(ffprobe.streams) ? ffprobe.streams : [];
  if (kind === "video" && !streams.some((stream) => stream && stream.codec_type === "video")) {
    throw new Error("ffprobe found no video stream");
  }
  if (kind === "image" && !ffprobe.format?.format_name) throw new Error("ffprobe found no image format");
  const duration = Number(ffprobe.format?.duration);
  if (kind === "video" && (!Number.isFinite(duration) || duration <= 0)) throw new Error("ffprobe found no positive video duration");
  return {
    localPath: filePath,
    contentType: contentType || null,
    bytes: bytes.length,
    sha256: sha256(bytes),
    urlHost: parsed.host,
    ffprobe: {
      formatName: ffprobe.format?.format_name || null,
      ...(Number.isFinite(duration) ? { durationSeconds: duration } : {}),
      streams: streams.map((stream) => ({ codecType: stream.codec_type, codecName: stream.codec_name || null })),
    },
  };
}

async function waitForTerminal({ provider, taskId, kind, manifest, config, save }) {
  let lastRaw;
  for (let attempt = 0; attempt < config.maxPolls; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    const observed = await provider.query(taskId);
    lastRaw = observed.raw;
    const status = String(observed.status || "").trim();
    const normalized = contract.normaliseTerminalStatus(status);
    manifest.poll.push({ at: new Date().toISOString(), attempt: attempt + 1, status: status || null, normalized });
    save();
    console.log(`  poll ${attempt + 1}/${config.maxPolls}: ${status || "(empty)"}`);
    if (normalized === "unknown") throw Object.assign(new Error(`provider returned unknown status: ${status || "(empty)"}`), { code: "observation_unknown" });
    if (normalized === "failed") throw Object.assign(new Error(`provider task ended with ${status}`), { code: "provider_task_failed" });
    if (normalized === "succeeded") {
      const urls = contract.extractOutputUrls(lastRaw, kind);
      if (urls.length === 0) throw Object.assign(new Error("provider completed without a materializable output URL"), { code: "materialization_missing" });
      return { raw: lastRaw, url: urls[0], status };
    }
  }
  throw Object.assign(new Error("provider task did not reach a terminal state within the poll budget"), { code: "observation_timeout" });
}

async function runPaidCanary() {
  const { app, safeStorage, session } = require("electron");
  app.setName("nomi");
  await app.whenReady();
  const { applySystemProxy } = require("../../dist-electron/systemProxy.js");
  const { appFetch } = require("../../dist-electron/appFetch.js");
  let resolution;
  try {
    resolution = await applySystemProxy(session.defaultSession, config.proxy ? { mode: "custom", customUrl: config.proxy } : undefined);
  } catch (error) {
    throw new Error(`proxy setup failed: ${contract.redactText(error?.message || error)}`);
  }
  console.log(`proxy: ${publicProxySummary(resolution, config.proxy)}`);

  const loaded = loadCatalogAndKey(app, safeStorage);
  const selection = contract.selectCheapestCanaryModel(loaded.catalog, config.kind);
  contract.assertSpendWithinCap(selection, config.maxSpendUsd);
  const prompt = contract.PROMPT_BY_MEDIA[config.kind];
  const runId = safeRunId(config.runId);
  const outputDir = config.outputRoot || path.join(os.tmpdir(), "nomi-apimart-real-canary", runId);
  const ledgerPath = config.ledgerPath || path.join(os.tmpdir(), "nomi-apimart-real-canary", "ledger.json");
  const manifestPath = path.join(outputDir, "manifest.json");
  const lockRelease = acquireLock(`${ledgerPath}.lock`);
  let manifest;
  let postReserved = false;
  try {
    assertNoPreviousPaidAttempt(ledgerPath);
    if (fs.existsSync(manifestPath)) throw new Error(`manifest already exists for ${runId}; choose a new run id and reconcile before retrying`);
    ensureDir(outputDir);
    manifest = initialManifest({ runId, config, selection, prompt, catalogPath: loaded.catalogPath, outputDir, ledgerPath });
    const provider = providerFor({ catalog: loaded.catalog, key: loaded.key, appFetch, timeoutMs: config.requestTimeoutMs });
    const input = {
      moduleId: "generation",
      providerId: "apimart",
      modelId: selection.modelKey,
      variantId: selection.variantId,
      ...(selection.transportModelId ? { transportModelId: selection.transportModelId } : {}),
      mode: selection.mode,
      prompt,
      parameters: { ...selection.parameters },
      references: [],
      contractHash: sha256({ runId, selection: { model: selection.modelKey, variant: selection.variantId, parameters: selection.parameters }, prompt }),
      idempotencyKey: `apimart-canary:${runId}`,
    };
    const body = provider.provider.buildRequest(input);
    // Validate the canonical→wire projection before reserving the single paid
    // POST. A wrong paramMap must stop here, while the operation is still
    // zero-cost and has no ledger entry.
    contract.assertCanaryWireProjection(selection, body, prompt);
    manifest.requestHash = sha256(body);
    manifest.state = "dispatching";
    manifest.postCount = 1;
    manifest.dispatchStartedAt = new Date().toISOString();
    writeJsonAtomic(manifestPath, manifest);
    updateLedger(ledgerPath, { runId, manifestPath, provider: "apimart", kind: selection.kind, model: selection.modelKey, estimatedCostUsd: selection.estimatedCostUsd, postCount: 1, state: "dispatching", updatedAt: new Date().toISOString() });
    postReserved = true;
    console.log(`one POST reserved: provider=apimart model=${selection.modelKey} variant=${selection.variantId} estimated=$${selection.estimatedCostUsd.toFixed(6)}`);

    let submitted;
    try {
      // This is the only paid dispatch site in the file.  Never put it in a
      // retry loop; a thrown error is an ambiguous receipt until reconciled.
      submitted = await provider.provider.submit(body, input.idempotencyKey);
    } catch (error) {
      manifest.state = "submission_unknown";
      manifest.error = { code: "submission_unknown", message: contract.redactText(error?.message || error) };
      manifest.updatedAt = new Date().toISOString();
      writeJsonAtomic(manifestPath, manifest);
      updateLedger(ledgerPath, { runId, manifestPath, provider: "apimart", kind: selection.kind, model: selection.modelKey, estimatedCostUsd: selection.estimatedCostUsd, postCount: 1, state: "submission_unknown", updatedAt: manifest.updatedAt });
      throw Object.assign(new Error(`POST receipt is unknown; do not retry: ${manifest.error.message}`), { code: "submission_unknown" });
    }
    const taskId = String(submitted?.providerTaskId || "").trim();
    if (!taskId) {
      manifest.state = "submission_unknown";
      manifest.error = { code: "submission_unknown", message: "APIMart returned no task id" };
      manifest.receipt = contract.receiptSummary(submitted?.raw || {});
      writeJsonAtomic(manifestPath, manifest);
      updateLedger(ledgerPath, { runId, manifestPath, provider: "apimart", kind: selection.kind, model: selection.modelKey, estimatedCostUsd: selection.estimatedCostUsd, postCount: 1, state: "submission_unknown", updatedAt: new Date().toISOString() });
      throw Object.assign(new Error("APIMart accepted an ambiguous receipt without a task id; reconcile manually"), { code: "submission_unknown" });
    }
    manifest.providerTaskId = taskId;
    manifest.receipt = contract.receiptSummary(submitted.raw || { data: [{ task_id: taskId }] });
    manifest.state = "provider_accepted";
    manifest.acceptedAt = new Date().toISOString();
    writeJsonAtomic(manifestPath, manifest);
    updateLedger(ledgerPath, { runId, manifestPath, provider: "apimart", kind: selection.kind, model: selection.modelKey, estimatedCostUsd: selection.estimatedCostUsd, postCount: 1, state: "provider_accepted", providerTaskId: taskId, updatedAt: manifest.acceptedAt });
    console.log(`provider receipt: taskId=${taskId} (hash=${manifest.receipt.receiptHash.slice(0, 12)}…)`);

    const observed = await waitForTerminal({
      provider: provider.provider,
      taskId,
      kind: selection.kind,
      manifest,
      config,
      save: () => writeJsonAtomic(manifestPath, manifest),
    });
    manifest.state = "materializing";
    manifest.terminalStatus = observed.status;
    writeJsonAtomic(manifestPath, manifest);
    const materialized = await provider.provider.materialize({ providerTaskId: taskId, raw: observed.raw });
    const output = materialized?.outputs?.[0];
    if (!output || output.kind !== selection.kind || typeof output.url !== "string" || !output.url.trim()) {
      throw Object.assign(new Error("provider materialization did not return the expected media kind/URL"), { code: "materialization_missing" });
    }
    manifest.outputUrlHost = new URL(output.url).host;
    const artifact = await downloadAndProbe({ fetchImpl: provider.timedFetch, url: output.url, kind: selection.kind, outputDir, runId });
    manifest.output = artifact;
    manifest.state = "completed";
    manifest.completedAt = new Date().toISOString();
    writeJsonAtomic(manifestPath, manifest);
    updateLedger(ledgerPath, { runId, manifestPath, provider: "apimart", kind: selection.kind, model: selection.modelKey, estimatedCostUsd: selection.estimatedCostUsd, postCount: 1, state: "completed", providerTaskId: taskId, outputSha256: artifact.sha256, updatedAt: manifest.completedAt });
    console.log(`REAL APIMART CANARY PASS: ${selection.kind} ${selection.modelKey} task=${taskId} bytes=${artifact.bytes} sha256=${artifact.sha256}`);
    console.log(`manifest: ${manifestPath}`);
    return 0;
  } catch (error) {
    if (manifest && postReserved && manifest.state !== "completed" && manifest.state !== "submission_unknown") {
      manifest.state = error?.code === "provider_task_failed" ? "provider_failed"
        : error?.code === "observation_unknown" || error?.code === "observation_timeout" ? "observation_unknown"
          : error?.code === "materialization_missing" ? "materialization_failed" : "canary_failed";
      manifest.error = { code: error?.code || "canary_failed", message: contract.redactText(error?.message || error) };
      manifest.updatedAt = new Date().toISOString();
      writeJsonAtomic(manifestPath, manifest);
      updateLedger(ledgerPath, { runId, manifestPath, provider: "apimart", kind: selection.kind, model: selection.modelKey, estimatedCostUsd: selection.estimatedCostUsd, postCount: 1, state: manifest.state, providerTaskId: manifest.providerTaskId, updatedAt: manifest.updatedAt });
    }
    throw error;
  } finally {
    lockRelease();
  }
}

async function pollExistingManifest() {
  const manifestPath = config.manifestPath;
  const manifest = readJson(manifestPath);
  if (!manifest || manifest.provider !== "apimart") throw new Error("manifest is missing or not an APIMart canary");
  const taskId = String(manifest.providerTaskId || "").trim();
  if (!taskId) throw new Error("manifest has no task id; submission remains unknown and cannot be auto-retried");
  if (!["provider_accepted", "observing", "materializing", "observation_unknown", "provider_failed"].includes(manifest.state)) {
    if (manifest.state === "completed") {
      console.log(`POLL PASS: manifest already completed (${manifestPath})`);
      return 0;
    }
    throw new Error(`manifest state ${manifest.state} is not pollable`);
  }
  const { app, safeStorage, session } = require("electron");
  app.setName("nomi");
  await app.whenReady();
  const { applySystemProxy } = require("../../dist-electron/systemProxy.js");
  const { appFetch } = require("../../dist-electron/appFetch.js");
  const resolution = await applySystemProxy(session.defaultSession, config.proxy ? { mode: "custom", customUrl: config.proxy } : undefined);
  console.log(`proxy: ${publicProxySummary(resolution, config.proxy)}`);
  const loaded = loadCatalogAndKey(app, safeStorage);
  const provider = providerFor({ catalog: loaded.catalog, key: loaded.key, appFetch, timeoutMs: config.requestTimeoutMs });
  manifest.state = "observing";
  writeJsonAtomic(manifestPath, manifest);
  const observed = await waitForTerminal({ provider: provider.provider, taskId, kind: manifest.kind, manifest, config, save: () => writeJsonAtomic(manifestPath, manifest) });
  const materialized = await provider.provider.materialize({ providerTaskId: taskId, raw: observed.raw });
  const output = materialized?.outputs?.[0];
  if (!output || output.kind !== manifest.kind || typeof output.url !== "string") throw new Error("poll result has no safe media URL");
  const artifact = await downloadAndProbe({ fetchImpl: provider.timedFetch, url: output.url, kind: manifest.kind, outputDir: manifest.outputDir, runId: manifest.runId });
  manifest.output = artifact;
  manifest.state = "completed";
  manifest.completedAt = new Date().toISOString();
  writeJsonAtomic(manifestPath, manifest);
  console.log(`POLL PASS: task=${taskId} bytes=${artifact.bytes} sha256=${artifact.sha256}`);
  return 0;
}

(pollOnly ? pollExistingManifest() : runPaidCanary())
  .then((code) => {
    try { require("electron").app.quit(); } catch { /* node --check / early exit */ }
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`APIMART CANARY ${pollOnly ? "POLL" : "FAIL"}: ${contract.redactText(error?.message || error)}`);
    try { require("electron").app.quit(); } catch { /* ignore */ }
    process.exitCode = error?.code === "submission_unknown" ? 3 : 1;
  });
