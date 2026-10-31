// 诊断包的两类事实：显卡 / 屏幕（白名单键 + 值再过一遍脱敏）和工程体量数字（只有数字，没开项目写原因）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const electronMock = vi.hoisted(() => ({
  gpuStatus: { gpu_compositing: "enabled_on", webgl: "enabled", "Weird Key": "/Users/x/secret" } as Record<string, string>,
  gpuInfo: undefined as unknown,
  gpuError: null as Error | null,
}));

vi.mock("electron", () => ({
  app: {
    getGPUFeatureStatus: () => electronMock.gpuStatus,
    getGPUInfo: async () => { if (electronMock.gpuError) throw electronMock.gpuError; return electronMock.gpuInfo; },
  },
  screen: {
    getPrimaryDisplay: () => ({ id: 7 }),
    getAllDisplays: () => [
      { id: 7, label: "My Secret Monitor Model XYZ", size: { width: 1512, height: 982 }, scaleFactor: 2, displayFrequency: 120.0006, bounds: { x: 0, y: 0 } },
      { id: 9, label: "Other", size: { width: 1920, height: 1080 }, scaleFactor: 1, displayFrequency: 0 },
    ],
    getDisplayMatching: () => ({ scaleFactor: 2 }),
  },
}));

import { collectHardwareFacts, collectProjectSize, countProjectNodes } from "./diagnosticsFacts";
import { redactLogValue } from "../logging/redact";

let root = "";
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-facts-"));
  electronMock.gpuError = null;
  electronMock.gpuInfo = {
    auxAttributes: { glImplementationParts: "(gl=none,angle=none)", skiaBackendType: "Graphite", inProcessGpu: true, homeDir: "/Users/x/gpu" },
    gpuDevice: [{ active: true, vendorId: 4203, deviceId: 0, driverVersion: "/Users/x/Library/driver 1.0", serial: "ABC-123", gpuPreference: 0 }],
    machineModelName: "Mac",
    machineModelVersion: "17.2",
  };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const fakeWindow = { isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }), getContentSize: () => [1440, 900], isMaximized: () => false, isFullScreen: () => false };

describe("显卡与屏幕", () => {
  it("只取白名单键：多余键（序列号、目录）、显示器名 / id 都不在；路径形字符串被脱敏；脏的功能名整条丢", async () => {
    const facts = await collectHardwareFacts(fakeWindow as never);
    expect(facts.gpu).toMatchObject({ available: true, featureStatus: { gpu_compositing: "enabled_on", webgl: "enabled" }, machineModel: { name: "Mac", version: "17.2" } });
    const serialized = JSON.stringify(facts);
    for (const forbidden of ["serial", "ABC-123", "homeDir", "My Secret Monitor", "/Users/x", "Weird Key", '"label"', '"id"']) expect(serialized).not.toContain(forbidden);
    if (facts.gpu.available) {
      expect(facts.gpu.devices[0]).toMatchObject({ active: true, vendorId: 4203, deviceId: 0, gpuPreference: 0 });
      expect(String(facts.gpu.devices[0]!.driverVersion)).toContain("<path>"); // 路径形字符串被现有脱敏器抹掉
      expect(Object.keys(facts.gpu.devices[0]!).sort()).toEqual(["active", "deviceId", "driverVersion", "gpuPreference", "vendorId"]);
      expect(facts.gpu.aux).toEqual({ glImplementationParts: "(gl=none,angle=none)", skiaBackendType: "Graphite", inProcessGpu: true });
    }
    expect(facts.displays).toEqual([
      { width: 1512, height: 982, scaleFactor: 2, refreshRate: 120, primary: true },
      { width: 1920, height: 1080, scaleFactor: 1, refreshRate: null, primary: false },
    ]);
    expect(facts.window).toEqual({ width: 1440, height: 900, maximized: false, fullscreen: false, devicePixelRatio: 2 });
  });

  it("整份显卡 / 屏幕信息过敏感信息扫描，每个字符串值一个字不改", async () => {
    const facts = await collectHardwareFacts(fakeWindow as never);
    const walk = (value: unknown): void => {
      if (typeof value === "string") expect(redactLogValue(value)).toBe(value);
      else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => { expect(redactLogValue(key)).toBe(key); walk(item); });
    };
    walk(facts);
  });

  it("取显卡信息抛错：不崩，写明不可用与原因；没有窗口时 window 为 null", async () => {
    electronMock.gpuError = new TypeError("boom");
    const facts = await collectHardwareFacts(null);
    expect(facts.gpu).toEqual({ available: false, reason: "gpu-info-failed: TypeError" });
    expect(facts.window).toBeNull();
    expect(facts.displays).toHaveLength(2);
  });
});

function makeProject(nodes: number, extra: Record<string, unknown> = {}): string {
  const dir = path.join(root, "project");
  fs.mkdirSync(path.join(dir, ".nomi", "events"), { recursive: true });
  const record = { payload: { generationCanvas: { nodes: Array.from({ length: nodes }, (_, i) => ({ id: `n${i}`, prompt: "SECRET PROMPT 一只猫" })) } }, ...extra };
  fs.writeFileSync(path.join(dir, ".nomi", "project.json"), JSON.stringify(record));
  fs.writeFileSync(path.join(dir, ".nomi", "events", "log-0001.jsonl"), "x".repeat(300));
  fs.writeFileSync(path.join(dir, ".nomi", "events", "log-0002.jsonl"), "y".repeat(200));
  fs.writeFileSync(path.join(dir, ".nomi", "events", "notes.txt"), "z".repeat(999));
  return dir;
}

describe("工程体量数字", () => {
  it("没开项目：不崩，写原因", async () => {
    expect(await collectProjectSize(null)).toEqual({ available: false, reason: "no-active-project" });
    expect(await collectProjectSize(null, "project-dir-unresolved")).toEqual({ available: false, reason: "project-dir-unresolved" });
  });

  it("目录在但没有工程文件：写原因", async () => {
    expect(await collectProjectSize(root)).toEqual({ available: false, reason: "project-file-not-found" });
  });

  it("有项目：工程文件字节数、节点数、事件日志字节数（只算 log-*.jsonl）；结果里没有任何内容", async () => {
    const dir = makeProject(12);
    const size = await collectProjectSize(dir);
    expect(size).toEqual({ available: true, projectJsonBytes: fs.statSync(path.join(dir, ".nomi", "project.json")).size, nodeCount: 12, eventLogBytes: 500 });
    expect(JSON.stringify(size)).not.toContain("SECRET");
  });

  it("工程文件解析不了：字节数照给，节点数 null，不崩", async () => {
    const dir = makeProject(3);
    fs.writeFileSync(path.join(dir, ".nomi", "project.json"), "{ not json");
    const size = await collectProjectSize(dir);
    expect(size).toMatchObject({ available: true, projectJsonBytes: 10, nodeCount: null });
  });

  it("数节点在 worker 线程里做；超时 / 读不到文件都回 null 而不是挂住", async () => {
    expect(await countProjectNodes(path.join(root, "missing.json"))).toBeNull();
    const dir = makeProject(5);
    expect(await countProjectNodes(path.join(dir, ".nomi", "project.json"))).toBe(5);
    expect(await countProjectNodes(path.join(dir, ".nomi", "project.json"), 0)).toBeNull();
  });
});
