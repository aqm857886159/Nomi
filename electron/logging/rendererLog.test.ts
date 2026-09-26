// 渲染层失败证据：从渲染层 owner 一路走到**盘上那个文件**。
//
// 钉的是 2026-09-24 那次诊断缺口本身：用户看到「项目保存失败」，诊断包的日志里却一个字都没有。
// 所以这里不 mock 日志层——渲染层 owner → （结构化克隆，模拟 IPC）→ 主进程记录器 → 真的按天日志文件，
// 然后读文件断言：恰好一行、带真因，且提示词 / 本机路径 / 密钥一个字都不在。
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { CRASH_LOG_FILE_NAME, dailyLogFileName } from "./logFiles";
import {
  RENDERER_LOG_CHANNEL,
  createRendererLogRecorder,
  parseRendererLogEntry,
  registerRendererLogIpc,
} from "./rendererLog";
import {
  installRendererErrorCapture,
  logRendererCrash,
  logRendererError,
  logRendererWarn,
} from "../../src/desktop/rendererLog";

function readFile(name: string): string {
  const file = path.join(app.getPath("logs"), name);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function logLines(marker: string | RegExp): string[] {
  const hit = (line: string) => (typeof marker === "string" ? line.includes(marker) : marker.test(line));
  return readFile(dailyLogFileName(new Date())).split("\n").filter(hit);
}

/** 只看 `run` 期间新增的行：同一 worker 里别的测试文件也往同一份桩日志里写。 */
function linesWrittenBy(marker: string | RegExp, run: () => void): string[] {
  const before = logLines(marker).length;
  run();
  return logLines(marker).slice(before);
}

/** 把渲染层 owner 接到一个真的主进程记录器上；报文先过结构化克隆，和真 IPC 一样丢掉原型。 */
function wireRendererToMain(record = createRendererLogRecorder()): void {
  vi.stubGlobal("window", { nomiDesktop: { log: { report: (entry: unknown) => record(structuredClone(entry)) } } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("渲染层失败 → 主进程日志（端到端）", () => {
  it("一次保存失败 → 当天日志恰好一行 ERROR renderer project-save-failed，带错误名与码，不带路径 / 提示词 / 密钥", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    wireRendererToMain();
    // 用户那天的真因；IPC 抛回渲染层的错误原文里常带项目目录（默认根 `Nomi Projects` 带空格）。
    const error = Object.assign(
      new Error(
        String.raw`Workspace manifest is being changed by another process: 'C:\Users\alice\Documents\Nomi Projects\猫咪短片\.nomi' (Bearer sk-live-0123456789abcdef)`,
      ),
      { name: "WorkspaceManifestLockBusyError", code: "workspace_manifest_busy" },
    );
    error.stack = [
      `WorkspaceManifestLockBusyError: ${error.message}`,
      "    at persistProject (file:///C:/Users/alice/AppData/Local/Programs/Nomi/resources/app.asar/dist/assets/index-3f9a.js:12:34)",
    ].join("\n");

    const lines = linesWrittenBy("project-save-failed", () =>
      logRendererError("project-save-failed", error, { trigger: "autosave", prompt: "一只猫在下雨的东京街头回头" }),
    );
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line).toMatch(/ERROR renderer\s+project-save-failed /);
    expect(line).toContain("trigger=autosave");
    expect(line).toContain("<omitted:prompt>");
    expect(line).toContain("WorkspaceManifestLockBusyError: Workspace manifest is being changed by another process");
    expect(line).toContain("code=workspace_manifest_busy");
    expect(line).toContain("index-3f9a.js:12:34");
    for (const leaked of ["alice", "猫咪短片", "Nomi Projects", "东京", "sk-live", "app.asar"]) {
      expect(line).not.toContain(leaked);
    }
  });

  it("warn 级带字段与错误进同一份日志；没有桥（纯浏览器 / 单测）时只打 DevTools、不抛", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    wireRendererToMain();
    logRendererWarn("timeline-append-probe-failed-probe", { attempt: 2 }, new Error("probe timeout"));
    const [line] = logLines("timeline-append-probe-failed-probe");
    expect(line).toMatch(/WARN\s+renderer\s+timeline-append-probe-failed-probe attempt=2 Error: probe timeout/);

    vi.unstubAllGlobals();
    expect(() => logRendererError("no-bridge-probe", new Error("x"))).not.toThrow();
    expect(logLines("no-bridge-probe")).toHaveLength(0);
  });

  it("崩溃边界：进崩溃文件 + 通用日志，组件栈只留组件名", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    wireRendererToMain();
    const componentStack = "\n    at CanvasNode (http://localhost:5173/src/a.tsx:1:1)\n    at Workspace (x)\n    at App (y)";
    logRendererCrash("root-boundary-probe", new TypeError("cannot read x"), componentStack);
    expect(readFile(CRASH_LOG_FILE_NAME)).toContain("[renderer:root-boundary-probe] TypeError: cannot read x");
    const [line] = logLines("renderer:root-boundary-probe");
    expect(line).toContain("components=CanvasNode < Workspace < App");
    expect(line).not.toContain("localhost:5173/src");
  });

  it("没人接住的异常与 Promise 拒绝也走同一个出口（第二扇门）", () => {
    wireRendererToMain();
    const listeners = new Map<string, (event: Event) => void>();
    installRendererErrorCapture({ addEventListener: (type, listener) => listeners.set(type, listener) });

    listeners.get("unhandledrejection")!({ reason: new RangeError("uncaught-probe-rejection") } as unknown as Event);
    listeners.get("error")!({ error: new Error("uncaught-probe-throw"), message: "uncaught-probe-throw" } as unknown as Event);
    // ResizeObserver 回路通知不是失败：不进日志。
    listeners.get("error")!({ error: null, message: "ResizeObserver loop completed with undelivered notifications." } as unknown as Event);

    expect(logLines("uncaught-probe-rejection")[0]).toMatch(/ERROR renderer\s+unhandled-rejection RangeError: uncaught-probe-rejection/);
    expect(logLines("uncaught-probe-throw")[0]).toMatch(/ERROR renderer\s+uncaught-error Error: uncaught-probe-throw/);
    expect(logLines("ResizeObserver")).toHaveLength(0);
  });
});

describe("报文形状（渲染层不可信，整条拒收并留痕）", () => {
  it.each([
    ["非对象", "boom"],
    ["等级不在枚举里", { level: "info", event: "x" }],
    ["事件名是一句话", { level: "error", event: "project save failed because /Users/alice/x" }],
    ["字段值不是标量", { level: "error", event: "x", fields: { detail: { nested: true } } }],
    ["字段名不合形状", { level: "error", event: "x", fields: { "a b": 1 } }],
    ["错误体缺 message", { level: "error", event: "x", error: { name: "Error" } }],
    ["超长文本", { level: "error", event: "x", error: { name: "Error", message: "x".repeat(5000) } }],
  ])("%s → 拒收", (_label, raw) => {
    expect(parseRendererLogEntry(raw).ok).toBe(false);
  });

  it("拒收也写一行 renderer-log-rejected（不然「为什么这条没进来」又查不到）", () => {
    const record = createRendererLogRecorder();
    record({ level: "error", event: "Reject Probe Sentence" });
    expect(logLines("renderer-log-rejected reason=bad-event").length).toBeGreaterThan(0);
    expect(logLines("Reject Probe Sentence")).toHaveLength(0);
  });
});

describe("限流（IPC 是信任边界，每一行都是主进程一次同步写盘）", () => {
  it("同一事件每分钟最多 20 行，超出只记一行 suppressed；下一分钟恢复", () => {
    let now = 1_000_000;
    const record = createRendererLogRecorder(() => now);
    for (let i = 0; i < 50; i += 1) record({ level: "warn", event: "flood-probe", fields: { i } });
    expect(logLines(/WARN\s+renderer\s+flood-probe i=/)).toHaveLength(20);
    expect(logLines("renderer-log-suppressed event=flood-probe limit=20")).toHaveLength(1);

    now += 60_000;
    record({ level: "warn", event: "flood-probe", fields: { i: 999 } });
    expect(logLines("flood-probe i=999")).toHaveLength(1);
  });

  it("按事件分开计数：一个事件刷屏挤不掉同一分钟里别的失败（坏图刷屏时那一行保存失败必须还在）", () => {
    const record = createRendererLogRecorder(() => 5_000_000);
    for (let i = 0; i < 300; i += 1) record({ level: "warn", event: "image-flood-probe", fields: { i } });
    const saved = linesWrittenBy("save-after-flood-probe", () =>
      record({ level: "error", event: "save-after-flood-probe", error: { name: "Error", message: "disk" } }),
    );
    expect(saved).toHaveLength(1);
    expect(logLines(/renderer\s+image-flood-probe i=/)).toHaveLength(20);
  });
});

describe("IPC 注册", () => {
  it("每条报文先过 sender 守卫；守卫拒绝时异常上抛、不落盘", () => {
    type FakeIpcEvent = { sender: { id: number } };
    const handlers = new Map<string, (event: FakeIpcEvent, message: unknown) => void>();
    const record = vi.fn();
    const assertTrusted = vi.fn((event: FakeIpcEvent) => {
      if (event.sender.id !== 1) throw new Error("untrusted sender");
    });
    registerRendererLogIpc<FakeIpcEvent>({ onMessage: (channel, handler) => handlers.set(channel, handler), assertTrusted }, record);

    const handler = handlers.get(RENDERER_LOG_CHANNEL)!;
    expect(RENDERER_LOG_CHANNEL).toBe("nomi:log:renderer");
    handler({ sender: { id: 1 } }, { level: "error", event: "x" });
    expect(record).toHaveBeenCalledTimes(1);
    expect(() => handler({ sender: { id: 9 } }, { level: "error", event: "x" })).toThrow("untrusted sender");
    expect(record).toHaveBeenCalledTimes(1);
  });
});
