import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareAntigravity } from "./antigravityConnection";
import { runAntigravityProcess } from "./antigravityProcess";
import { assertAntigravityMediaInput, prepareAntigravityMedia } from "./antigravityMedia";
import { ANTIGRAVITY_ERROR_KEYS, antigravityErrorKey } from "../shared/antigravityErrors";
import { zhAntigravity, enAntigravity } from "../../src/i18n/locales/antigravity";
import { antigravityHookCommand, antigravityHookWrapper } from "./antigravityMediaHook";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture(mode: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nomi-agy-windows-")); dirs.push(dir);
  return { dir, invocation: { command: process.execPath, args: [path.resolve("electron/ai/fixtures/antigravity.mjs"), mode, dir] } };
}
describe("Antigravity platform and protocol contract regressions", () => {
  it("reports unsupported Windows before executable lookup, including prepared invocations", async () => {
    await expect(prepareAntigravity(undefined, { platform: "win32", env: {}, invocation: { command: "/does-not-exist/agy", args: [] } }))
      .rejects.toThrow("ANTIGRAVITY_WINDOWS_UNSUPPORTED");
    await expect(runAntigravityProcess({ prompt: "do not spawn" }, { platform: "win32", preparedInvocation: {} as never }))
      .rejects.toThrow("ANTIGRAVITY_WINDOWS_UNSUPPORTED");
  });
  it.each(["1.1.21", "1.1.27", "1.2.0", "2.0.0"])("accepts media above the minimum without claiming verification: %s", version => {
    expect(() => assertAntigravityMediaInput("image", [], version)).not.toThrow();
  });
  it("uses a Windows batch wrapper instead of an inline shell assignment", () => {
    expect(antigravityHookCommand("C:\\Program Files\\Nomi.exe", "C:\\Temp\\gate.cjs", "win32"))
      .toBe('"C:\\Temp\\gate.cmd"');
  });
  it("writes named hooks in the customization root, keeping authorization markers private", async () => {
    const f = await fixture("unused");
    const media = await prepareAntigravityMedia(f.dir, "image", []);
    const hooks = JSON.parse(await readFile(path.join(f.dir, ".agents", "hooks.json"), "utf8"));
    expect(hooks["nomi-task-gate"].PreInvocation[0].command).toContain("task-gate");
    const official = JSON.parse(await readFile("tests/fixtures/standard-formats/antigravity-hooks/hooks.json", "utf8"));
    // The writer follows upstream's flat invocation handlers and grouped tool handlers.
    const generated = hooks["nomi-task-gate"];
    expect(Object.keys(generated.PreInvocation[0])).toEqual(expect.arrayContaining(Object.keys(official.reminder.PreInvocation[0])));
    expect(Object.keys(generated.PreToolUse[0]).sort()).toEqual(Object.keys(official["safety-gate"].PreToolUse[0]).sort());
    expect(Object.keys(generated.PreToolUse[0].hooks[0]).sort()).toEqual(Object.keys(official["my-linter-hook"].PostToolUse[0].hooks[0]).sort());
    expect(media.plugin).toBe(path.join(f.dir, "task-gate"));
    await expect(readFile(path.join(media.plugin, "hooks.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("distinguishes handshake mismatch from a missing hook and withholds the task", async () => {
    const f = await fixture("media-handshake-mismatch");
    await expect(runAntigravityProcess({ prompt: "PRIVATE_TASK", capability: "image", cliVersion: "1.1.21" },
      { invocation: f.invocation, platform: "linux", env: { ...process.env, HOME: f.dir } })).rejects.toThrow("ANTIGRAVITY_HANDSHAKE_MISMATCH");
    expect(await readFile(path.join(f.dir, "input"), "utf8")).not.toContain("PRIVATE_TASK");
  });
  it("allows media to drain after a result for more than two seconds", async () => {
    const f = await fixture("media-slow-drain");
    await expect(runAntigravityProcess({ prompt: "draw", capability: "image", cliVersion: "1.1.21" },
      { invocation: f.invocation, platform: "linux", env: { ...process.env, HOME: f.dir } })).resolves.toMatchObject({ artifacts: [{ mimeType: "image/png" }] });
  });
});


describe("Antigravity actionable diagnostics", () => {
  it("maps every emitted adapter error to both locales", async () => {
    const codes = new Set<string>();
    for (const dir of ["electron/ai", "electron/shared"]) {
      for (const file of await readdir(dir)) {
        if (!/^antigravity.*\.ts$/.test(file) || file.endsWith(".test.ts") || file === "antigravityErrors.ts") continue;
        const source = await readFile(path.join(dir, file), "utf8");
        for (const match of source.matchAll(/["'](ANTIGRAVITY_[A-Z_]+)["']/g)) codes.add(match[1]);
      }
    }
    expect(codes.size).toBeGreaterThan(50);
    for (const code of codes) expect(ANTIGRAVITY_ERROR_KEYS, code).toHaveProperty(code);
    for (const key of Object.values(ANTIGRAVITY_ERROR_KEYS)) {
      const leaf = key.split(".")[2];
      for (const locale of [zhAntigravity, enAntigravity]) expect(locale.errors).toHaveProperty(leaf);
    }
    expect(antigravityErrorKey("UNKNOWN")).toBe("antigravity.errors.testFailed");
  });
  it("quotes batch paths without CALL expansion and writes the Windows wrapper", async () => {
    const batch = antigravityHookWrapper("C:\\A %PATH% ! &\\Nomi.exe", "C:\\Task\\gate.cjs");
    expect(batch).toContain('setlocal DisableDelayedExpansion');
    expect(batch).toContain('"C:\\A %%PATH%% ! &\\Nomi.exe"');
    expect(batch).not.toMatch(/call /i);
    const f = await fixture("unused");
    await prepareAntigravityMedia(f.dir, "image", [], undefined, "win32");
    expect(await readFile(path.join(f.dir, "task-gate/gate.cmd"), "utf8")).toContain('set "ELECTRON_RUN_AS_NODE=1"');
    const hooks = JSON.parse(await readFile(path.join(f.dir, ".agents/hooks.json"), "utf8"));
    expect(hooks["nomi-task-gate"].PreInvocation[0].command).toBe('"..\\task-gate\\gate.cmd" init');
  });
});
