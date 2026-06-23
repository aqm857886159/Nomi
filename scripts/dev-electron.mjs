import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildTailwindScript = path.join(repoRoot, "scripts", "build-tailwind.mjs");

/**
 * Make the onboarding agent work in `pnpm dev` without manual `export`s.
 *
 * The onboarding agent LLM (dm-fox gpt-5.5) is configured via NOMI_ONBOARDING_AGENT_*
 * env vars. Before this, a plain restart that forgot the exports left the wizard
 * showing "还没有配置用来阅读文档的 AI" even though the key file was sitting right
 * there. We auto-load `.secrets/agent.key` and apply the documented dm-fox defaults.
 * An already-exported env var always wins, so manual overrides still work.
 */
function loadOnboardingAgentEnv() {
  const out = {};
  const keyPath = path.join(repoRoot, ".secrets", "agent.key");
  let key = process.env.NOMI_ONBOARDING_AGENT_KEY || "";
  if (!key && fs.existsSync(keyPath)) {
    try { key = fs.readFileSync(keyPath, "utf8").trim(); } catch { /* ignore */ }
  }
  if (!key) {
    console.warn("⚠  No onboarding agent key (.secrets/agent.key missing and NOMI_ONBOARDING_AGENT_KEY unset). Model onboarding will be disabled.");
    return out;
  }
  out.NOMI_ONBOARDING_AGENT_KEY = key;
  out.NOMI_ONBOARDING_AGENT_BASE_URL = process.env.NOMI_ONBOARDING_AGENT_BASE_URL || "https://dm-fox.rjj.cc/codex/v1";
  out.NOMI_ONBOARDING_AGENT_MODEL = process.env.NOMI_ONBOARDING_AGENT_MODEL || "gpt-5.5";
  out.NOMI_ONBOARDING_AGENT_PROVIDER = process.env.NOMI_ONBOARDING_AGENT_PROVIDER || "openai-compatible";
  console.log(`▶  Onboarding agent: ${out.NOMI_ONBOARDING_AGENT_MODEL} via ${out.NOMI_ONBOARDING_AGENT_BASE_URL}`);
  return out;
}
const electron = require("electron");
const vitePackagePath = require.resolve("vite/package.json");
const vitePackageDir = path.dirname(vitePackagePath);
const viteBin = path.join(vitePackageDir, "bin", "vite.js");
const tscPackagePath = require.resolve("typescript/package.json");
const tscBin = path.join(path.dirname(tscPackagePath), "bin", "tsc");
function electronEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function compileElectronMain() {
  const result = spawnSync(process.execPath, [tscBin, "-p", "electron/tsconfig.json"], {
    stdio: "inherit",
    env: electronEnv(),
  });
  if (result.signal) process.kill(process.pid, result.signal);
  if (typeof result.status === "number" && result.status !== 0) process.exit(result.status);
}

function compileTailwindStyles() {
  const result = spawnSync(process.execPath, [buildTailwindScript], {
    stdio: "inherit",
    env: electronEnv(),
  });
  if (result.signal) process.kill(process.pid, result.signal);
  if (typeof result.status === "number" && result.status !== 0) process.exit(result.status);
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else if (typeof code === "number" && code !== 0) process.exit(code);
  });
  return child;
}

function startElectron(options = {}) {
  return start(electron, ["."], options);
}

function startTailwindWatcher() {
  return start(process.execPath, [buildTailwindScript, "--watch"], {
    env: electronEnv(),
  });
}

async function waitForRenderer(
  url,
  timeoutMs = readPositiveIntegerEnv("NOMI_RENDERER_READY_TIMEOUT_MS", 180000),
) {
  const { hostname, port } = new URL(url);
  const numericPort = Number(port || 80);
  const startedAt = Date.now();
  let nextProgressLogMs = 15000;
  while (Date.now() - startedAt < timeoutMs) {
    if (await canConnect(hostname, numericPort)) return;
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= nextProgressLogMs) {
      console.log(`▶  Waiting for renderer (${Math.round(elapsedMs / 1000)}s): ${url}`);
      nextProgressLogMs += 15000;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Renderer did not become ready within ${timeoutMs}ms: ${url}`);
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function readPositiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function fetchRendererResource(url, timeoutMs = 8000) {
  const startedAt = Date.now();
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetch(url, {
      headers: { "cache-control": "no-cache" },
      signal: controller.signal,
    });
    await response.arrayBuffer();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return { status: response.status, durationMs: Date.now() - startedAt };
  })();
  try {
    return await Promise.race([request, timeout]);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const isAbort = error && typeof error === "object" && error.name === "AbortError";
    const message = isAbort
      ? `timeout after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error);
    throw new Error(`Renderer resource did not become ready in ${durationMs}ms: ${url} (${message})`);
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}

async function measureRendererResource(label, url, timeoutMs = 15000) {
  const startedAt = Date.now();
  try {
    const result = await fetchRendererResource(url, timeoutMs);
    console.log(`▶  Vite ${label} ${result.status} in ${result.durationMs}ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠  Vite ${label} probe failed in ${Date.now() - startedAt}ms: ${message}`);
  }
}

async function measureRendererBootResources(baseUrl) {
  if (process.env.NOMI_MEASURE_RENDERER_BOOT !== "1") return;
  const resources = [
    ["index", "/index.html"],
    ["vite-client", "/@vite/client"],
    ["react", "/.tmp/vite/deps/react.js"],
    ["react-dom-client", "/.tmp/vite/deps/react-dom_client.js"],
    ["react-router-dom", "/.tmp/vite/deps/react-router-dom.js"],
    ["main", "/src/main.tsx"],
    ["tailwind", "/tailwind.generated.css"],
    ["router", "/src/NomiRouterApp.tsx"],
  ];
  for (const [label, file] of resources) {
    await measureRendererResource(label, new URL(file, baseUrl).toString(), 5000);
  }
}

async function warmRendererShell(baseUrl) {
  const startedAt = Date.now();
  const resources = [
    ["index", "/index.html"],
  ];
  for (const [label, file] of resources) {
    await measureRendererResource(label, new URL(file, baseUrl).toString());
  }
  console.log(`▶  Vite shell warmed in ${Date.now() - startedAt}ms`);
}

function readOptimizedDependencyWarmups() {
  const metadataPath = path.join(repoRoot, ".tmp", "vite", "deps", "_metadata.json");
  const criticalDeps = new Map([
    ["react", { label: "react", fallbackFile: "react.js" }],
    ["react-dom/client", { label: "react-dom-client", fallbackFile: "react-dom_client.js" }],
    ["react-router-dom", { label: "react-router-dom", fallbackFile: "react-router-dom.js" }],
  ]);
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const optimized = metadata.optimized && typeof metadata.optimized === "object" ? metadata.optimized : {};
    const warmups = [];
    for (const [depId, info] of criticalDeps) {
      const dep = optimized[depId];
      if (dep && typeof dep === "object" && typeof dep.file === "string") {
        warmups.push([`dep:${info.label}`, `/.tmp/vite/deps/${dep.file}`]);
      }
    }
    return warmups.length > 0 ? warmups : Array.from(criticalDeps.values()).map((info) => [
      info.label,
      `/.tmp/vite/deps/${info.fallbackFile}`,
    ]);
  } catch {
    return [
      ["react", "/.tmp/vite/deps/react.js"],
      ["react-dom-client", "/.tmp/vite/deps/react-dom_client.js"],
      ["react-router-dom", "/.tmp/vite/deps/react-router-dom.js"],
    ];
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function warmRendererSourceModules(vite, files, timeoutMs) {
  const startedAt = Date.now();
  const results = await Promise.allSettled(
    files.map((file) => withTimeout(vite.warmupRequest(file), timeoutMs, `Vite source warmup ${file}`)),
  );
  const failed = results.filter((result) => result.status === "rejected").length;
  const suffix = failed > 0 ? ` (${failed} skipped)` : "";
  console.log(`▶  Vite source modules warmed in ${Date.now() - startedAt}ms${suffix}`);
  if (failed > 0 && process.env.NOMI_VERBOSE_WARMUP === "1") {
    results.forEach((result, index) => {
      if (result.status !== "rejected") return;
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.warn(`⚠  Vite source warm failed: ${files[index]} (${message})`);
    });
  }
}

async function warmRendererHttpModules(baseUrl, files, timeoutMs) {
  const startedAt = Date.now();
  const results = await Promise.allSettled(
    files.map((file) => fetchRendererResource(new URL(file, baseUrl).toString(), timeoutMs)),
  );
  const failed = results.filter((result) => result.status === "rejected").length;
  const slowest = results
    .map((result, index) => ({ result, file: files[index] }))
    .filter((entry) => entry.result.status === "fulfilled")
    .sort((left, right) => right.result.value.durationMs - left.result.value.durationMs)
    .slice(0, 3)
    .map((entry) => `${entry.file} ${entry.result.value.durationMs}ms`)
    .join(", ");
  const slowestText = slowest ? `; slowest: ${slowest}` : "";
  const suffix = failed > 0 ? ` (${failed} skipped)` : "";
  console.log(`▶  Vite source HTTP warmed in ${Date.now() - startedAt}ms${suffix}${slowestText}`);
  if (failed > 0 && process.env.NOMI_VERBOSE_WARMUP === "1") {
    results.forEach((result, index) => {
      if (result.status !== "rejected") return;
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.warn(`⚠  Vite source HTTP warm failed: ${files[index]} (${message})`);
    });
  }
}

function uniqueWarmups(warmups) {
  const seen = new Set();
  return warmups.filter(([, file]) => {
    if (seen.has(file)) return false;
    seen.add(file);
    return true;
  });
}

async function warmCriticalRendererResources(vite, baseUrl) {
  if (process.env.NOMI_SKIP_RENDERER_WARMUP === "1") return;
  const startedAt = Date.now();
  const timeoutMs = readPositiveIntegerEnv("NOMI_RENDERER_WARMUP_TIMEOUT_MS", 5000);
  const sourceModules = [
    "/src/main.tsx",
    "/src/utils/startupDiagnostics.ts",
    "/src/NomiRouterApp.tsx",
    "/src/desktop/bridge.ts",
    "/src/ui/toast.tsx",
    "/src/workbench/library/ProjectLibraryStandaloneRoute.tsx",
    "/src/workbench/library/ProjectLibraryRoute.tsx",
    "/src/workbench/library/ProjectLibraryPage.tsx",
    "/src/workbench/library/localProjectStore.ts",
    "/src/workbench/project/projectSummaryRepository.ts",
  ];

  if (vite && typeof vite.warmupRequest === "function") {
    await warmRendererSourceModules(vite, sourceModules, timeoutMs);
  }
  await warmRendererHttpModules(baseUrl, sourceModules, timeoutMs);

  if (process.env.NOMI_WARM_OPTIMIZED_DEPS !== "1") {
    console.log(`▶  Vite critical renderer warmed in ${Date.now() - startedAt}ms`);
    return;
  }

  const depWarmups = uniqueWarmups(readOptimizedDependencyWarmups());
  const results = [];
  for (const [label, file] of depWarmups) {
    try {
      const result = await fetchRendererResource(new URL(file, baseUrl).toString(), timeoutMs);
      results.push({ label, status: "fulfilled", durationMs: result.durationMs });
    } catch (error) {
      results.push({ label, status: "rejected", reason: error });
      break;
    }
  }

  const failed = results.filter((result) => result.status === "rejected").length;
  const slowest = results
    .filter((result) => result.status === "fulfilled")
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 3)
    .map((result) => `${result.label} ${result.durationMs}ms`)
    .join(", ");
  const slowestText = slowest ? `; slowest: ${slowest}` : "";
  const suffix = failed > 0 ? ` (${failed} skipped)` : "";
  console.log(`▶  Vite critical renderer warmed in ${Date.now() - startedAt}ms${suffix}${slowestText}`);

  if (failed > 0) {
    const failure = results.find((result) => result.status === "rejected");
    const message = failure.reason instanceof Error ? failure.reason.message : String(failure.reason);
    console.warn(`⚠  Vite dep warm failed: ${failure.label} (${message})`);
  }
}

async function warmRendererEntrypoints(baseUrl) {
  const files = [
    "/src/main.tsx",
    "/src/NomiRouterApp.tsx",
    "/src/workbench/NomiStudioApp.tsx",
    "/src/workbench/WorkbenchShell.tsx",
    "/src/workbench/generation/GenerationWorkspace.tsx",
    "/src/workbench/generationCanvasV2/components/GenerationCanvas.tsx",
    "/src/workbench/project/projectPersistenceService.ts",
    "/src/workbench/project/projectRepository.ts",
    "/src/workbench/project/workbenchProjectSession.ts",
    "/src/workbench/generationCanvasV2/store/generationCanvasStore.ts",
  ];
  const startedAt = Date.now();
  const results = await Promise.allSettled(
    files.map((file) => fetchRendererResource(new URL(file, baseUrl).toString())),
  );
  const failed = results.filter((result) => result.status === "rejected").length;
  const suffix = failed > 0 ? ` (${failed} skipped)` : "";
  console.log(`▶  Vite renderer warmed in ${Date.now() - startedAt}ms${suffix}`);
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findRendererPort(preferredPort) {
  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available renderer port found from ${preferredPort}`);
}

function startRendererServer(port) {
  return start(process.execPath, [
    viteBin,
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
    "--clearScreen",
    "false",
  ], {
    env: electronEnv(),
  });
}

const rendererPort = await findRendererPort(readPositiveIntegerEnv("NOMI_RENDERER_PORT", 5273));
const rendererUrl = `http://127.0.0.1:${rendererPort}`;
const electronRendererUrl =
  process.env.NOMI_RENDERER_URL || `${rendererUrl}/index.html#/studio`;
compileTailwindStyles();
compileElectronMain();
const vite = startRendererServer(rendererPort);
let tailwind = null;

const shutdown = () => {
  tailwind?.kill();
  vite.kill();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", shutdown);

await waitForRenderer(rendererUrl);
if (process.env.NOMI_BLOCKING_RENDERER_WARMUP === "1") {
  await warmRendererShell(rendererUrl);
  await warmCriticalRendererResources(vite, rendererUrl);
  await measureRendererBootResources(rendererUrl);
}

const app = startElectron({
  env: electronEnv({
    NOMI_DESKTOP_DEV: "1",
    NOMI_ELECTRON_USER_DATA_DIR: path.join(repoRoot, ".tmp", "electron-user-data", `dev-${rendererPort}`),
    VITE_DEV_SERVER_URL: electronRendererUrl,
    NOMI_RENDERER_URL: electronRendererUrl,
    ...loadOnboardingAgentEnv(),
  }),
});

if (process.env.NOMI_TAILWIND_WATCH === "1") {
  setTimeout(() => {
    if (!tailwind) tailwind = startTailwindWatcher();
  }, 5000);
}

if (process.env.NOMI_WARM_RENDERER === "1") {
  setTimeout(() => {
    void warmRendererEntrypoints(rendererUrl).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠  Vite renderer warm skipped: ${message}`);
    });
  }, 3000);
}

app.on("exit", () => {
  tailwind?.kill();
  vite.kill();
});
