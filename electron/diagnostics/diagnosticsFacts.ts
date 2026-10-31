// 诊断包要问 Electron / 工程文件才知道的两类事实：显卡与屏幕、工程体量数字。
// 组包（`diagnosticsBundle.ts`）保持纯函数，这里负责收集；两边之间只传下面这些白名单标量。
//
// 隐私靠白名单键 + 值再过一遍 `redactLogValue`：
//   · `app.getGPUInfo("basic")` 实测（macOS，Electron 43）只有设备 id / 厂商 id / 后端名 / 机型类别，没有路径；
//     仍然只挑下面列出的键，别的键（含将来版本新增的）不进包。
//   · 显示器只取分辨率 / 缩放 / 刷新率，不取 label 和 id（label 可能是显示器的型号串）。
//   · 工程体量只有字节数和节点数，不读内容进包。
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { app, screen, type BrowserWindow } from "electron";
import { redactLogValue } from "../logging/redact";
import type { DiagnosticsHardware, DiagnosticsProjectSize } from "../shared/contracts/diagnostics";

type FactValue = string | number | boolean;
const GPU_DEVICE_KEYS = ["active", "vendorId", "deviceId", "driverVendor", "driverVersion", "gpuPreference"] as const;
const GPU_AUX_KEYS = ["glImplementationParts", "skiaBackendType", "inProcessGpu", "amdSwitchable", "optimus", "sandboxed"] as const;
const SAFE_CODE = /^[a-z0-9_]{1,64}$/;

function pickFacts(source: unknown, keys: readonly string[]): Record<string, FactValue> {
  const out: Record<string, FactValue> = {};
  if (!source || typeof source !== "object") return out;
  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === "string") out[key] = redactLogValue(value).slice(0, 80);
    else if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) out[key] = value;
  }
  return out;
}

export async function collectHardwareFacts(mainWindow: BrowserWindow | null): Promise<DiagnosticsHardware> {
  let gpu: DiagnosticsHardware["gpu"];
  try {
    const featureStatus: Record<string, string> = {};
    for (const [key, value] of Object.entries(app.getGPUFeatureStatus() as unknown as Record<string, unknown>)) {
      if (SAFE_CODE.test(key) && typeof value === "string" && SAFE_CODE.test(value)) featureStatus[key] = value;
    }
    const info = (await app.getGPUInfo("basic")) as unknown as Record<string, unknown>;
    const devices = Array.isArray(info.gpuDevice) ? info.gpuDevice.slice(0, 4).map((device) => pickFacts(device, GPU_DEVICE_KEYS)) : [];
    gpu = {
      available: true,
      featureStatus,
      devices,
      aux: pickFacts(info.auxAttributes, GPU_AUX_KEYS),
      machineModel: {
        name: redactLogValue(String(info.machineModelName ?? "")).slice(0, 40),
        version: redactLogValue(String(info.machineModelVersion ?? "")).slice(0, 20),
      },
    };
  } catch (error) {
    gpu = { available: false, reason: `gpu-info-failed: ${error instanceof Error ? error.name : "unknown"}` };
  }

  let displays: DiagnosticsHardware["displays"] = [];
  let window: DiagnosticsHardware["window"] = null;
  try {
    const primaryId = screen.getPrimaryDisplay().id;
    displays = screen.getAllDisplays().map((display) => ({
      width: display.size.width,
      height: display.size.height,
      scaleFactor: display.scaleFactor,
      refreshRate: Number.isFinite(display.displayFrequency) && display.displayFrequency > 0 ? Math.round(display.displayFrequency) : null,
      primary: display.id === primaryId,
    }));
    if (mainWindow && !mainWindow.isDestroyed()) {
      const devicePixelRatio = screen.getDisplayMatching(mainWindow.getBounds()).scaleFactor;
      const [width, height] = mainWindow.getContentSize();
      window = { width, height, maximized: mainWindow.isMaximized(), fullscreen: mainWindow.isFullScreen(), devicePixelRatio };
    }
  } catch {
    /* 屏幕信息取不到就留空：不拖垮导出 */
  }
  return { gpu, displays, window };
}

// ── 工程体量 ─────────────────────────────────────────────────────────────────────────────────
const NODE_COUNT_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
try {
  const nodes = JSON.parse(fs.readFileSync(workerData.file, "utf8"))?.payload?.generationCanvas?.nodes;
  parentPort.postMessage({ nodeCount: Array.isArray(nodes) ? nodes.length : null });
} catch { parentPort.postMessage({ nodeCount: null }); }
`;
const NODE_COUNT_TIMEOUT_MS = 15_000;

/** 在 worker 线程里数节点：几十 MB 的工程 `JSON.parse` 要几百毫秒，放主线程里导出诊断包自己就成了一次卡顿。 */
export function countProjectNodes(projectJsonPath: string, timeoutMs: number = NODE_COUNT_TIMEOUT_MS): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker | null = null;
    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker?.terminate().catch(() => undefined);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      worker = new Worker(NODE_COUNT_WORKER, { eval: true, workerData: { file: projectJsonPath } });
      worker.once("message", (message: { nodeCount: number | null }) => finish(typeof message?.nodeCount === "number" ? message.nodeCount : null));
      worker.once("error", () => finish(null));
    } catch {
      finish(null);
    }
  });
}

function sumEventLogBytes(projectDir: string): number {
  const dir = path.join(projectDir, ".nomi", "events");
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !/^log-.*\.jsonl$/.test(entry.name)) continue;
      try { total += fs.statSync(path.join(dir, entry.name)).size; } catch { /* 读不到的那份不计 */ }
    }
  } catch { /* 没有事件日志目录 = 0 字节 */ }
  return total;
}

export async function collectProjectSize(projectDir: string | null, unavailableReason = "no-active-project"): Promise<DiagnosticsProjectSize> {
  if (!projectDir) return { available: false, reason: unavailableReason };
  const projectJson = path.join(projectDir, ".nomi", "project.json");
  let projectJsonBytes: number;
  try {
    projectJsonBytes = fs.statSync(projectJson).size;
  } catch {
    return { available: false, reason: "project-file-not-found" };
  }
  return { available: true, projectJsonBytes, nodeCount: await countProjectNodes(projectJson), eventLogBytes: sumEventLogBytes(projectDir) };
}
