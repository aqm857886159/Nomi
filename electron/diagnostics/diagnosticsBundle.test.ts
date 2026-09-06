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
import type { DiagnosticsBundleManifest } from "../shared/contracts/diagnostics";

let root = "";
let logsDir = "";
let settingsRoot = "";
let projectDir = "";
let ledgerPath = "";

const APP = { version: "0.21.0", electron: "31.7.7", node: "20.18.1", chrome: "126.0.0.0" };
const SYSTEM = { platform: "darwin", arch: "arm64", osRelease: "25.5.0", locale: "zh-CN", timeZone: "Asia/Shanghai" };

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
    now: new Date(2026, 8, 6, 12, 0, 0),
    app: APP,
    system: SYSTEM,
    ...overrides,
  });
  const files = unzipSync(bundle.zip);
  const manifest = JSON.parse(strFromU8(files["manifest.json"])) as DiagnosticsBundleManifest;
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
