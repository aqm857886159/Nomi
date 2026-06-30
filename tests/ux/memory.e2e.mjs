// Electron process-tree memory probe for the heavy project fixture.
//
// On Windows, `taskManagerMemoryMB` is the closest automated equivalent of the
// Task Manager grouped "Electron (N)" Memory column: total process-tree working
// set, including browser, renderer, GPU, and utility processes.
//
// Usage:
//   pnpm run build
//   node tests/ux/memory.e2e.mjs after
//
// Writes tests/ux/perf-results/memory-<label>.json.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { WebSocket } from "undici";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const label = process.argv[2] || "run";
const outDir = path.join(repoRoot, "tests/ux/perf-results");
fs.mkdirSync(outDir, { recursive: true });
const defaultFixturePath = process.env.NOMI_MEMORY_FIXTURE_PATH
  ? path.resolve(repoRoot, process.env.NOMI_MEMORY_FIXTURE_PATH)
  : path.join(repoRoot, "tests/ux/fixtures/perf-heavy.project.json");

function mb(bytes) {
  return Math.round((Number(bytes) || 0) / 1024 / 1024);
}

function readProcessTreeWorkingSet(rootPid) {
  if (!rootPid || process.platform !== "win32") return null;
  try {
    const raw = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const rows = JSON.parse(raw || "[]");
    const list = Array.isArray(rows) ? rows : [rows];
    const byParent = new Map();
    for (const row of list) {
      const parent = Number(row.ParentProcessId);
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(row);
    }
    const wanted = new Set([Number(rootPid)]);
    const stack = [Number(rootPid)];
    while (stack.length) {
      const pid = stack.pop();
      for (const child of byParent.get(pid) || []) {
        const childPid = Number(child.ProcessId);
        if (wanted.has(childPid)) continue;
        wanted.add(childPid);
        stack.push(childPid);
      }
    }
    const processes = list
      .filter((row) => wanted.has(Number(row.ProcessId)))
      .map((row) => {
        const commandLine = String(row.CommandLine || "");
        const typeMatch = commandLine.match(/--type=([^\s]+)/);
        const utilitySubtypeMatch = commandLine.match(/--utility-sub-type=([^\s]+)/);
        return {
          pid: Number(row.ProcessId),
          parentPid: Number(row.ParentProcessId),
          name: row.Name,
          type: typeMatch?.[1] || "browser",
          ...(utilitySubtypeMatch ? { utilitySubtype: utilitySubtypeMatch[1] } : {}),
          workingSetMB: mb(row.WorkingSetSize),
          privateMB: mb(row.PrivatePageCount),
        };
      })
      .sort((left, right) => right.workingSetMB - left.workingSetMB);
    return {
      totalWorkingSetMB: processes.reduce((sum, item) => sum + item.workingSetMB, 0),
      totalPrivateMB: processes.reduce((sum, item) => sum + item.privateMB, 0),
      processes,
    };
  } catch {
    return null;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCdp(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/json/version`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Electron CDP endpoint did not open on ${url}`);
}

async function waitForPageTarget(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/json/list`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl)
          || targets.find((target) => target.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {
      // keep waiting
    }
    await sleep(250);
  }
  throw new Error(`Electron page CDP target did not open on ${url}`);
}

function parseWsData(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  return Buffer.from(data).toString("utf8");
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect(timeoutMs = 30000) {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const timer = setTimeout(() => {
        reject(new Error(`Timed out connecting page CDP websocket: ${this.wsUrl}`));
        try { ws.close(); } catch {}
      }, timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      ws.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(event.error || new Error("CDP websocket failed to open"));
      }, { once: true });
      ws.addEventListener("message", (event) => {
        const message = JSON.parse(parseWsData(event.data));
        if (!message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${message.error.message || "CDP error"} (${message.error.code})`));
        else pending.resolve(message.result);
      });
      ws.addEventListener("close", () => {
        for (const pending of this.pending.values()) pending.reject(new Error("CDP websocket closed"));
        this.pending.clear();
      });
    });
  }

  send(method, params = {}) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("CDP websocket is not open");
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      ws.send(payload);
    });
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || "Runtime.evaluate failed";
    throw new Error(text);
  }
  return result.result?.value;
}

async function waitForDocumentReady(cdp, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const readyState = await evaluate(cdp, "document.readyState").catch(() => "");
    if (readyState === "interactive" || readyState === "complete") return;
    await sleep(250);
  }
  throw new Error("Renderer document did not become ready");
}

async function clickWhenReady(cdp, expression, description, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await evaluate(cdp, expression).catch(() => false);
    if (clicked) return;
    await sleep(250);
  }
  throw new Error(`Could not click ${description}`);
}

async function connectPageSession(port) {
  const session = new CdpSession(await waitForPageTarget(port));
  await session.connect(30000);
  await session.send("Runtime.enable").catch(() => {});
  await session.send("Performance.enable").catch(() => {});
  await waitForDocumentReady(session);
  return session;
}

function killProcessTree(rootPid) {
  if (!rootPid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/PID", String(rootPid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(rootPid, "SIGTERM");
    }
  } catch {
    // process may already be gone
  }
}

function prepareFixtureEnvironment() {
  if (process.env.NOMI_MEMORY_EXTERNAL === "1") {
    return {
      env: { ...process.env },
      projectName: process.env.NOMI_MEMORY_PROJECT_NAME || "ZZ 性能基准",
      userDataDir: process.env.NOMI_ELECTRON_USER_DATA_DIR || process.env.NOMI_MEMORY_USER_DATA || "",
    };
  }
  if (!fs.existsSync(defaultFixturePath)) {
    throw new Error(`缺少 heavy fixture 快照：${defaultFixturePath}`);
  }
  const root = path.join(repoRoot, ".tmp", "memory-harness", label.replace(/[^a-z0-9_-]/gi, "_"));
  const settingsDir = path.join(root, "userData");
  const projectsDir = path.join(root, "projects");
  const projectRoot = path.join(projectsDir, "ZZ-perf-fixture-project-perf-fixture-0001");
  const resolvedRoot = path.resolve(root);
  const tmpRoot = path.resolve(repoRoot, ".tmp", "memory-harness");
  if (!resolvedRoot.startsWith(`${tmpRoot}${path.sep}`)) throw new Error("refusing to clear memory harness outside .tmp");
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(projectRoot, ".nomi"), { recursive: true });
  fs.mkdirSync(settingsDir, { recursive: true });
  const record = JSON.parse(fs.readFileSync(defaultFixturePath, "utf8"));
  const now = Date.now();
  const materialized = {
    ...record,
    updatedAt: now,
    savedAt: now,
    lastKnownRootPath: path.resolve(projectRoot),
  };
  fs.writeFileSync(path.join(projectRoot, ".nomi", "project.json"), JSON.stringify(materialized, null, 1));
  fs.writeFileSync(
    path.join(settingsDir, "recent-workspaces.json"),
    JSON.stringify(
      [
        {
          id: materialized.id,
          name: materialized.name,
          rootPath: path.resolve(projectRoot),
          lastOpenedAt: now,
          missing: false,
        },
      ],
      null,
      2,
    ),
  );
  return {
    env: {
      ...process.env,
      NOMI_ELECTRON_USER_DATA_DIR: settingsDir,
      NOMI_SETTINGS_DIR: settingsDir,
      NOMI_PROJECTS_DIR: projectsDir,
      NOMI_E2E_ALLOW_MULTI_INSTANCE: "1",
    },
    projectName: materialized.name,
    userDataDir: settingsDir,
  };
}

const prepared = prepareFixtureEnvironment();
const debugPort = Number(process.env.NOMI_MEMORY_DEBUG_PORT || 9333);
const childEnv = {
  ...prepared.env,
  NOMI_DESKTOP_REMOTE_DEBUGGING_PORT: String(debugPort),
};
delete childEnv.ELECTRON_RUN_AS_NODE;
const electronProcess = spawn(require("electron"), ["."], {
  cwd: repoRoot,
  env: childEnv,
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
electronProcess.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

const rootPid = electronProcess.pid;
let cdp = null;

async function collect(labelName) {
  await cdp?.send("HeapProfiler.collectGarbage").catch(() => {});
  await sleep(800);
  const metrics = await cdp?.send("Performance.getMetrics").catch(() => null);
  const metricMap = new Map((metrics?.metrics || []).map((item) => [item.name, item.value]));
  const renderer = await evaluate(cdp, `(() => {
    const memory = performance.memory || null;
    const canvasNodes = document.querySelectorAll(".generation-canvas-v2-node");
    const lightweightNodes = document.querySelectorAll('.generation-canvas-v2-node[data-render-mode="lightweight"]');
    const assetResources = performance.getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/assets/"))
      .map((entry) => ({
        name: entry.name.split("/").pop(),
        type: entry.initiatorType || "",
        transferKB: Math.round((entry.transferSize || 0) / 1024),
        encodedKB: Math.round((entry.encodedBodySize || 0) / 1024),
        decodedKB: Math.round((entry.decodedBodySize || 0) / 1024),
      }))
      .sort((a, b) => b.decodedKB - a.decodedKB)
      .slice(0, 40);
    const loadedAssets = [
      ...[...document.scripts].map((element) => ({ tag: "script", name: element.src.split("/").pop() || "" })),
      ...[...document.querySelectorAll('link[rel="modulepreload"], link[rel="stylesheet"]')]
        .map((element) => ({ tag: element.getAttribute("rel") || "link", name: element.href.split("/").pop() || "" })),
    ].filter((entry) => entry.name);
    return {
      hash: location.hash,
      domNodes: document.querySelectorAll("*").length,
      projectCards: document.querySelectorAll("[data-project-card]").length,
      canvasNodes: canvasNodes.length,
      lightweightCanvasNodes: lightweightNodes.length,
      fullCanvasNodes: canvasNodes.length - lightweightNodes.length,
      images: document.images.length,
      videos: document.querySelectorAll("video").length,
      jsHeapUsedMB: memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : null,
      jsHeapTotalMB: memory ? Math.round(memory.totalJSHeapSize / 1024 / 1024) : null,
      assetResources,
      loadedAssets,
    };
  })()`);
  const processTree = readProcessTreeWorkingSet(rootPid);
  return {
    label: labelName,
    taskManagerMemoryMB: processTree?.totalWorkingSetMB ?? null,
    renderer,
    cdp: {
      jsHeapUsedMB: metricMap.has("JSHeapUsedSize") ? mb(metricMap.get("JSHeapUsedSize")) : null,
      jsHeapTotalMB: metricMap.has("JSHeapTotalSize") ? mb(metricMap.get("JSHeapTotalSize")) : null,
    },
    processTree,
  };
}

const results = {
  label,
  fixture: prepared.projectName,
  samples: [],
};

try {
  await waitForCdp(debugPort);
  cdp = await connectPageSession(debugPort);
  await sleep(3000);
  results.samples.push(await collect("library-initial"));

  const projectNameJson = JSON.stringify(prepared.projectName);
  await clickWhenReady(cdp, `(() => {
    const card = [...document.querySelectorAll("[data-project-card]")]
      .find((element) => element.textContent && element.textContent.includes(${projectNameJson}));
    if (!card) return false;
    card.click();
    return true;
  })()`, `project card ${prepared.projectName}`);
  await sleep(1200);
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll("button")]
      .find((element) => element.textContent && element.textContent.includes("继续创作"));
    if (!button) return false;
    button.click();
    return true;
  })()`).catch(() => false);
  await sleep(5000);
  results.samples.push(await collect("project-open"));

  if (process.env.NOMI_MEMORY_CLEAR_DOM_AFTER_PROJECT_OPEN === "1") {
    await evaluate(cdp, `(() => {
      document.body.replaceChildren();
      return true;
    })()`);
    await sleep(1500);
    results.samples.push(await collect("project-open-dom-cleared"));
    const outPath = path.join(outDir, `memory-${label}.json`);
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
    console.log(`\n结果写入 ${outPath}`);
    process.exitCode = 0;
    throw new Error("__NOMI_MEMORY_DONE__");
  }

  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll("button")]
      .find((element) => {
        const label = [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")]
          .filter(Boolean)
          .join(" ");
        return label.includes("生成");
      });
    if (!button) return false;
    button.click();
    return true;
  })()`).catch(() => false);
  await sleep(3500);
  results.samples.push(await collect("canvas-open"));

  if (process.env.NOMI_MEMORY_RELOAD_ON_CANVAS === "1") {
    await evaluate(cdp, "window.location.reload()");
    cdp?.close();
    cdp = await connectPageSession(debugPort);
    await sleep(6000);
    results.samples.push(await collect("canvas-after-reload"));
  }

  if (process.env.NOMI_MEMORY_HARD_RELOAD_ON_CANVAS === "1") {
    await evaluate(cdp, "window.nomiDesktop?.app?.hardReloadWindow?.()");
    cdp?.close();
    cdp = await connectPageSession(debugPort);
    await sleep(8000);
    results.samples.push(await collect("canvas-after-hard-reload"));
  }

  await clickWhenReady(cdp, `(() => {
    const button = [...document.querySelectorAll("button")]
      .find((element) => {
        const label = [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")]
          .filter(Boolean)
          .join(" ");
        return label.includes("返回项目库");
      });
    if (!button) return false;
    button.click();
    return true;
  })()`, "返回项目库");
  await sleep(3500);
  cdp?.close();
  cdp = await connectPageSession(debugPort);
  await sleep(1000);
  results.samples.push(await collect("library-after-back"));

  if (process.env.NOMI_MEMORY_RELOAD_AFTER_BACK === "1") {
    await evaluate(cdp, "window.location.reload()");
    await waitForDocumentReady(cdp);
    await sleep(4000);
    results.samples.push(await collect("library-after-reload"));
  }

  const outPath = path.join(outDir, `memory-${label}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  console.log(`\n结果写入 ${outPath}`);
} catch (error) {
  if (String(error?.message || error) === "__NOMI_MEMORY_DONE__") {
    // Diagnostic early-exit path above already wrote results.
  } else {
  results.error = String(error?.message || error);
  if (stderr.trim()) results.stderr = stderr.trim().slice(-4000);
  fs.writeFileSync(path.join(outDir, `memory-${label}.json`), JSON.stringify(results, null, 2));
  console.error(results.error);
  process.exitCode = 1;
  }
} finally {
  cdp?.close();
  killProcessTree(rootPid);
}
