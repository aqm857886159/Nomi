// 诊断包的清单与边界。
//
// 最重要的一条不是「包里有什么」，而是「包里**没有**什么」——密钥、提示词产物、
// 未被声明的东西。所以这里每一条断言都成对：该在的在、不该在的一个字都找不到。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { buildDiagnosticsBundle, diagnosticsBundleFileName, DIAGNOSTICS_BUNDLE_MAX_BYTES } from "./diagnosticsBundle";
import { createStallTimeline, createStallTimelineAppend, readStallTimeline, STALL_TIMELINE_FILE } from "./stallTimeline";
import { redactLogValue } from "../logging/redact";
import { parseStallRow } from "../shared/contracts/stallTimeline";
import type { DiagnosticsExportManifest, DiagnosticsHardware } from "../shared/contracts/diagnostics";

let root = "";
let logsDir = "";
let settingsRoot = "";
let projectDir = "";
let ledgerPath = "";

const APP = { version: "0.21.0", electron: "31.7.7", node: "20.18.1", chrome: "126.0.0.0" };
const SYSTEM = { platform: "darwin", arch: "arm64", osRelease: "25.5.0", locale: "zh-CN", timeZone: "Asia/Shanghai" };

const HARDWARE: DiagnosticsHardware = {
  gpu: {
    available: true,
    featureStatus: { gpu_compositing: "enabled", webgl: "enabled" },
    devices: [{ active: true, vendorId: 4203, deviceId: 0 }],
    aux: { skiaBackendType: "Graphite", inProcessGpu: false },
    machineModel: { name: "Mac", version: "17.2" },
  },
  displays: [{ width: 1512, height: 982, scaleFactor: 2, refreshRate: 120, primary: true }],
  window: { width: 1440, height: 900, maximized: false, fullscreen: false, devicePixelRatio: 2 },
};
const NO_TIMELINE = { monitor: { running: true, rowsThisSession: 0 }, read: { rows: [], droppedLines: 0, file: "absent" as const } };

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function build(overrides: Partial<Parameters<typeof buildDiagnosticsBundle>[0]> = {}) {
  const bundle = buildDiagnosticsBundle({
    logsDir,
    settingsRoot,
    projectId: "proj-1",
    projectDir,
    agentLedgerPath: ledgerPath,
    stallTimeline: NO_TIMELINE,
    hardware: HARDWARE,
    projectSize: { available: true, projectJsonBytes: 1234, nodeCount: 7, eventLogBytes: 99 },
    now: new Date(2026, 8, 6, 12, 0, 0),
    app: APP,
    system: SYSTEM,
    ...overrides,
  });
  const files = unzipSync(bundle.zip);
  const manifest = JSON.parse(strFromU8(files["manifest.json"])) as DiagnosticsExportManifest;
  return { bundle, files, manifest, text: Object.values(files).map((bytes) => strFromU8(bytes)).join("\n") };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-bundle-"));
  logsDir = path.join(root, "logs");
  settingsRoot = path.join(root, "settings");
  projectDir = path.join(root, "project");
  ledgerPath = path.join(settingsRoot, "project-agent-host", "project-agent.uuid.g1", "commands-v1.jsonl");

  write(path.join(logsDir, "nomi-2026-09-06.log"), "[ts] INFO  main   session-start\n");
  write(path.join(logsDir, "nomi-2026-09-05.log"), "[ts] WARN  vendor call status=502\n");
  write(path.join(logsDir, "nomi-crash.log"), "[ts] [crash] boom\n");
  write(
    path.join(settingsRoot, "model-catalog.json"),
    JSON.stringify({
      version: 12,
      vendors: [{ key: "apimart", baseUrl: "https://api.apimart.ai/v1" }],
      apiKeysByVendor: { apimart: { vendorKey: "apimart", apiKey: "TOTALLY-SECRET-KEY-MATERIAL", enc: "safeStorage", enabled: true } },
    }),
  );
  write(ledgerPath, '{"kind":"command","prompt":"一只猫"}\n');
  write(path.join(projectDir, ".nomi", "runs", "run-2", "run.json"), '{"runId":"run-2","status":"failed"}');
  write(path.join(projectDir, ".nomi", "runs", "run-2", "brief-v1.json"), '{"brief":"提示词产物不该进包"}');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("诊断包内容", () => {
  it("收齐日志、脱敏目录、Agent 账本与制作收据", () => {
    const { files, manifest } = build();
    expect(Object.keys(files).sort()).toEqual([
      "logs/nomi-2026-09-05.log",
      "logs/nomi-2026-09-06.log",
      "logs/nomi-crash.log",
      "manifest.json",
      "model-catalog.json",
      "project/commands-v1.jsonl",
      "project/runs/run-2/run.json",
    ]);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.projectId).toBe("proj-1");
    expect(manifest.app).toEqual(APP);
    expect(manifest.system).toEqual(SYSTEM);
    // 清单如实描述已进包的条目——它是收到 zip 的人唯一的目录。
    expect(manifest.entries.map((entry) => entry.path).sort()).toEqual(
      Object.keys(files).filter((name) => name !== "manifest.json").sort(),
    );
    expect(manifest.entries.every((entry) => entry.bytes > 0 && entry.what.length > 0)).toBe(true);
  });

  it("密钥材料一个字都不在包里", () => {
    const { text } = build();
    expect(text).not.toContain("TOTALLY-SECRET-KEY-MATERIAL");
    expect(text).toContain("<redacted>");
    // 抹的是材料不是结构：base URL 仍然在，否则包就变哑了。
    expect(text).toContain("https://api.apimart.ai/v1");
  });

  it("提示词产物（brief/script/storyboard）不进包，且清单里写明为什么", () => {
    const { files, manifest } = build();
    expect(Object.keys(files).some((name) => name.includes("brief"))).toBe(false);
    expect(manifest.excluded).toContainEqual({
      what: "project/runs/*/{brief,script,storyboard,direction}-v*.json",
      why: "creative-content-by-design",
    });
    expect(manifest.excluded).toContainEqual({
      what: "api-keys / prompts / asset paths",
      why: "never-collected-by-design",
    });
  });

  it("Agent 账本含创作内容——进包，但清单里明着标出来（用户点导出前界面上也写了）", () => {
    const { files, manifest } = build();
    expect(strFromU8(files["project/commands-v1.jsonl"])).toContain("一只猫");
    const entry = manifest.entries.find((item) => item.path === "project/commands-v1.jsonl");
    expect(entry?.what).toContain("含创作内容");
  });

  it("没有打开项目时如实记原因，而不是静静少一项", () => {
    const { files, manifest } = build({ projectId: null, projectDir: null, agentLedgerPath: null });
    expect(files["project/commands-v1.jsonl"]).toBeUndefined();
    expect(manifest.projectId).toBeNull();
    expect(manifest.excluded).toContainEqual({ what: "project/commands-v1.jsonl", why: "no-active-project" });
  });

  it("目录解析不了就整份不收——一份坏 JSON 没法保证抹干净", () => {
    write(path.join(settingsRoot, "model-catalog.json"), "{ this is not json");
    const { files, manifest } = build();
    expect(files["model-catalog.json"]).toBeUndefined();
    expect(manifest.excluded).toContainEqual({
      what: "model-catalog.json",
      why: "unparseable-json-cannot-guarantee-redaction",
    });
  });

  it("总量上限内，且清单里的字节数与实际一致", () => {
    const { manifest } = build();
    expect(manifest.totalBytes).toBeLessThanOrEqual(DIAGNOSTICS_BUNDLE_MAX_BYTES);
    expect(manifest.totalBytes).toBe(manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0));
  });

  it("超总量上限时先丢最旧的日志，并在清单里记明（不静默截断）", () => {
    // 两天各写 1MB，上限之外的那一天必须被记成 excluded 而不是消失。
    write(path.join(logsDir, "nomi-2026-09-06.log"), "a".repeat(20 * 1024 * 1024));
    write(path.join(logsDir, "nomi-2026-09-05.log"), "b".repeat(20 * 1024 * 1024));
    const { files, manifest } = build();
    expect(files["logs/nomi-2026-09-06.log"]).toBeDefined();
    expect(files["logs/nomi-2026-09-05.log"]).toBeUndefined();
    expect(manifest.excluded).toContainEqual({ what: "logs/nomi-2026-09-05.log", why: "bundle-size-limit" });
  });
});

describe("默认文件名", () => {
  it("带时间戳，导出多份不会互相覆盖", () => {
    expect(diagnosticsBundleFileName(new Date(Date.UTC(2026, 8, 6, 4, 21)))).toBe(
      "nomi-diagnostics-2026-09-06-04-21.zip",
    );
  });
});


const SCENE = { page: "generation", nodes: "21-100", generating: true } as const;
const ROWS = [
  parseStallRow({ t: "2026-10-31T10:00:00.000Z", kind: "main-stall", ms: 1203, frozen: true, ...SCENE }),
  parseStallRow({ t: "2026-10-31T10:00:30.000Z", kind: "renderer-long-frame", ms: 340, ...SCENE }),
].filter((row): row is NonNullable<typeof row> => row !== null);

describe("卡顿时间线的三态（清单要明着说）", () => {
  it("有记录：行进包（重新序列化过的合格行），清单写行数和本次启动几行", () => {
    const { files, manifest } = build({ stallTimeline: { monitor: { running: true, rowsThisSession: 2 }, read: { rows: ROWS, droppedLines: 0, file: "present" } } });
    expect(manifest.stallTimeline).toMatchObject({ state: "recorded", file: "present", rows: 2, rowsThisSession: 2, droppedLines: 0 });
    expect(manifest.entries.find((entry) => entry.path === "stall-timeline.jsonl")?.what).toContain("卡顿时间线");
    const lines = strFromU8(files["stall-timeline.jsonl"]).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: "main-stall", frozen: true });
  });

  it("重启后导出：本次 0 行、上次的行仍在 → 仍是「有记录」，清单说明重启前的也在", () => {
    const { manifest } = build({ stallTimeline: { monitor: { running: true, rowsThisSession: 0 }, read: { rows: ROWS, droppedLines: 0, file: "present" } } });
    expect(manifest.stallTimeline).toMatchObject({ state: "recorded", rows: 2, rowsThisSession: 0 });
    expect(manifest.stallTimeline.note).toContain("重启前的记录也在");
  });

  it("本次没记到：监视器在跑、文件在但没有可用行 → 清单写这句；excluded 写明原因", () => {
    const { files, manifest } = build({ stallTimeline: { monitor: { running: true, rowsThisSession: 0 }, read: { rows: [], droppedLines: 0, file: "present" } } });
    expect(manifest.stallTimeline).toMatchObject({ state: "none-this-session", file: "present", rows: 0 });
    expect(manifest.stallTimeline.note).toContain("本次没记到");
    expect(manifest.stallTimeline.note).toContain("文件在");
    expect(files["stall-timeline.jsonl"]).toBeUndefined();
    expect(manifest.excluded).toContainEqual({ what: "stall-timeline.jsonl", why: "none-this-session" });
  });

  it("本次没记到且还没有文件（新装 / 旧版升级上来）：同样不崩，写「还没有时间线文件」", () => {
    const { manifest } = build();
    expect(manifest.stallTimeline).toMatchObject({ state: "none-this-session", file: "absent" });
    expect(manifest.stallTimeline.note).toContain("还没有时间线文件");
  });

  it("监视器没运行：写「停顿监视器未运行」和原因码；盘上以前的行照常带上", () => {
    const off = build({ stallTimeline: { monitor: { running: false, reason: "install-failed", rowsThisSession: 0 }, read: { rows: [], droppedLines: 0, file: "absent" } } });
    expect(off.manifest.stallTimeline).toMatchObject({ state: "monitor-not-running", reason: "install-failed" });
    expect(off.manifest.stallTimeline.note).toContain("停顿监视器未运行");
    const withOld = build({ stallTimeline: { monitor: { running: false, reason: "not-installed", rowsThisSession: 0 }, read: { rows: ROWS, droppedLines: 0, file: "present" } } });
    expect(withOld.manifest.stallTimeline).toMatchObject({ state: "monitor-not-running", rows: 2 });
    expect(withOld.files["stall-timeline.jsonl"]).toBeDefined();
  });

  it("坏数据：文件写坏 / 半行 / 空文件都不崩，清单照实说丢了几行", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-stall-bad-"));
    try {
      const file = path.join(dir, STALL_TIMELINE_FILE);
      for (const content of ["", "{\"t\":\"2026-10", "\u0000\u0001\u0002 not json\n{}\n[1,2]\n", JSON.stringify(ROWS[0]) + "\n{\"t\":\"half"]) {
        fs.writeFileSync(file, content);
        const { manifest } = build({ stallTimeline: { monitor: { running: true, rowsThisSession: 0 }, read: readStallTimeline(dir) } });
        expect(manifest.stallTimeline.file).toBe("present");
        expect(manifest.stallTimeline.rows + manifest.stallTimeline.droppedLines).toBeGreaterThanOrEqual(content ? 1 : 0);
        expect(["recorded", "none-this-session"]).toContain(manifest.stallTimeline.state);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("隐私：真实写出的时间线文件和显卡信息整个过敏感信息扫描，一个字不改；包里没有路径", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-stall-scan-"));
    try {
      let clock = Date.parse("2026-10-31T10:00:00.000Z");
      const timeline = createStallTimeline({ append: createStallTimelineAppend(() => dir), now: () => clock });
      for (const row of ROWS) { clock += 20_000; timeline.record(row); }
      timeline.record({ t: "2026-10-31T10:01:00.000Z", kind: "window-unresponsive", ...SCENE });
      timeline.record({ t: "2026-10-31T10:01:05.000Z", kind: "window-responsive", ms: 5000, ...SCENE });
      const read = readStallTimeline(dir);
      const { files, manifest, text } = build({ stallTimeline: { monitor: { running: true, rowsThisSession: 4 }, read } });
      for (const line of strFromU8(files["stall-timeline.jsonl"]).split("\n").filter(Boolean)) expect(redactLogValue(line)).toBe(line);
      const leaves: string[] = [];
      const walk = (value: unknown): void => {
        if (typeof value === "string") leaves.push(value);
        else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => { leaves.push(key); walk(item); });
      };
      walk(manifest.hardware);
      walk(manifest.projectSize);
      walk(manifest.stallTimeline);
      for (const leaf of leaves) expect(redactLogValue(leaf)).toBe(leaf);
      expect(text).not.toContain(dir);
      expect(text).not.toContain(os.homedir());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("显卡 / 屏幕 / 工程体量进清单", () => {
  it("原样进清单（IPC 层收集、这里只搬运）；没开项目时体量数字写原因", () => {
    const withProject = build();
    expect(withProject.manifest.hardware).toEqual(HARDWARE);
    expect(withProject.manifest.projectSize).toEqual({ available: true, projectJsonBytes: 1234, nodeCount: 7, eventLogBytes: 99 });
    const none = build({ projectId: null, projectDir: null, agentLedgerPath: null, projectSize: { available: false, reason: "no-active-project" } });
    expect(none.manifest.projectSize).toEqual({ available: false, reason: "no-active-project" });
  });
});
