import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDurabilityMode, setDurabilityMode } from "../durability";
import { createWorkspaceProject, saveWorkspaceProject } from "./workspaceRepository";
import { workspaceProjectRecordSchema } from "./workspaceTypes";
import { isDeepStrictEqual } from "node:util";
import { workspaceProjectFile } from "./workspacePaths";

const ERRNOS = ["EBUSY", "EPERM", "EACCES", "ENOSPC", "EEXIST"] as const;
const OPERATIONS = ["open", "write", "fsync", "rename", "remove", "mkdir", "read"] as const;
type Operation = (typeof OPERATIONS)[number];
type Scope = "project" | "settings";
type Fault = { operation: Operation; scope: Scope; nth: number; code: string; persistent: boolean };
const roots: string[] = [];
const previousDurability = getDurabilityMode();
const native = {
  openSync: fs.openSync.bind(fs), writeFileSync: fs.writeFileSync.bind(fs),
  fsyncSync: fs.fsyncSync.bind(fs), renameSync: fs.renameSync.bind(fs),
  rmSync: fs.rmSync.bind(fs), rmdirSync: fs.rmdirSync.bind(fs),
  mkdirSync: fs.mkdirSync.bind(fs), readFileSync: fs.readFileSync.bind(fs),
  closeSync: fs.closeSync.bind(fs),
};

// These are requested sleep milliseconds, not elapsed time or a renderer long task.
const SAVE_DEBT_JSON = String.raw`{
  "sleep": {
    "electron/jsonFile.ts": { "maxMs": 5200, "source": "2026-10-30 full save: project/read persistent sharing violation; 13 x 400ms retries. Isolated rename is 400ms requested sleep." },
    "electron/workspace/workspaceRegistry.ts": { "maxMs": 3010, "source": "2026-10-30 full save: settings/mkdir EEXIST persistent; 10ms spin with strict > 3000ms deadline." }
  },
  "largeJson": { "stringify": 12, "parse": 14 }
}`;
const KNOWN_DEBT = JSON.parse(SAVE_DEBT_JSON) as {
  sleep: Record<string, { maxMs: number; source: string }>;
  largeJson: { stringify: number; parse: number };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setDurabilityMode(previousDurability);
  for (const root of roots.splice(0)) native.rmSync(root, { recursive: true, force: true });
});

function leftovers(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (/\.tmp$|\.lock$|^manifest-transaction\.(?:candidate|release|quarantine)-/.test(entry.name)) out.push(path.relative(root, file).replace(/(manifest-transaction\.(?:candidate|release|quarantine)-)[a-f0-9]+/, "$1<nonce>"));
      if (entry.isDirectory()) walk(file);
    }
  };
  walk(root);
  return out.sort();
}

async function save(fault?: Fault, large = false) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T00:00:00Z"));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-save-fault-")));
  roots.push(root);
  const deps = { settingsRoot: path.join(root, "settings"), defaultProjectsRoot: path.join(root, "projects") };
  fs.mkdirSync(deps.settingsRoot);
  const projectRoot = path.join(deps.defaultProjectsRoot, "project");
  const payload = { text: large ? "x".repeat(1024 * 1024) : "before" };
  const created = createWorkspaceProject({ rootPath: projectRoot, record: { name: "Save sweep", payload } }, deps);
  const manifest = workspaceProjectFile(projectRoot);
  const before = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const counts: Record<string, number> = {};
  const sleeps: Record<string, number> = {};
  const json = { stringify: 0, parse: 0 };
  const descriptors = new Map<number, string>();
  let injected = 0;
  let matched = 0;
  const injectedAt: string[] = [];
  let active = true;
  const scopeOf = (file: string): Scope | undefined => {
    if (file.startsWith(projectRoot + path.sep)) return "project";
    if (file.startsWith(deps.settingsRoot + path.sep)) return "settings";
    return undefined;
  };
  const hit = (operation: Operation, input: unknown): void => {
    if (!active) return;
    // fd calls are ALL counted in the save window; their owning open supplies the
    // path prefix. Never test a numeric fd against a string prefix and skip it.
    const file = typeof input === "number" ? descriptors.get(input) : String(input);
    if (typeof input === "number" && !file) throw new Error(`Unattributed ${operation} fd`);
    const scope = file ? scopeOf(file) : undefined;
    if (!scope) return;
    const key = `${scope}:${operation}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (fault?.operation !== operation || fault.scope !== scope) return;
    matched += 1;
    if (matched === fault.nth || (fault.persistent && matched > fault.nth)) {
      injected += 1;
      injectedAt.push(`${key} #${matched} ${path.relative(root, file as string)}`);
      throw Object.assign(new Error(`injected ${fault.code} ${key} #${matched}`), { code: fault.code });
    }
  };
  vi.spyOn(Atomics, "wait").mockImplementation((_array, _index, _value, timeout) => {
    const ms = Number(timeout);
    if (!Number.isFinite(ms) || ms <= 0) throw new Error("Unbounded synchronous sleep");
    const source = [...(new Error().stack ?? "").matchAll(/\/(electron\/[^:\n)]+):\d+/g)].map((match) => match[1]).find((file) => !file.endsWith(".test.ts")) ?? "unknown";
    sleeps[source] = (sleeps[source] ?? 0) + ms;
    vi.setSystemTime(Date.now() + ms);
    return "timed-out";
  });
  vi.spyOn(fs, "openSync").mockImplementation((...args: Parameters<typeof fs.openSync>) => {
    hit("open", args[0]);
    const fd = native.openSync(...args);
    descriptors.set(fd, String(args[0]));
    return fd;
  });
  vi.spyOn(fs, "closeSync").mockImplementation((fd) => { descriptors.delete(fd); return native.closeSync(fd); });
  vi.spyOn(fs, "writeFileSync").mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => { hit("write", args[0]); return native.writeFileSync(...args); });
  // Exercise the durable branch, but do not flush the host disk in a unit test.
  vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => { hit("fsync", fd); });
  vi.spyOn(fs, "renameSync").mockImplementation((...args: Parameters<typeof fs.renameSync>) => { hit("rename", args[0]); return native.renameSync(...args); });
  vi.spyOn(fs, "rmSync").mockImplementation((...args: Parameters<typeof fs.rmSync>) => { hit("remove", args[0]); return native.rmSync(...args); });
  vi.spyOn(fs, "rmdirSync").mockImplementation((...args: Parameters<typeof fs.rmdirSync>) => { hit("remove", args[0]); return native.rmdirSync(...args); });
  vi.spyOn(fs, "mkdirSync").mockImplementation(((...args: Parameters<typeof fs.mkdirSync>) => { hit("mkdir", args[0]); return native.mkdirSync(...args); }) as typeof fs.mkdirSync);
  vi.spyOn(fs, "readFileSync").mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => { hit("read", args[0]); return native.readFileSync(...args); }) as typeof fs.readFileSync);
  const stringify = JSON.stringify.bind(JSON);
  const parse = JSON.parse.bind(JSON);
  vi.spyOn(JSON, "stringify").mockImplementation(((...args: Parameters<typeof JSON.stringify>) => {
    const result = stringify(...args);
    if (active && result && Buffer.byteLength(result) >= 1_000_000) json.stringify += 1;
    return result;
  }) as typeof JSON.stringify);
  vi.spyOn(JSON, "parse").mockImplementation((...args: Parameters<typeof JSON.parse>) => {
    if (active && Buffer.byteLength(args[0]) >= 1_000_000) json.parse += 1;
    return parse(...args);
  });
  setDurabilityMode("durable");
  let error: unknown;
  let saved: Awaited<ReturnType<typeof saveWorkspaceProject>> | undefined;
  try {
    const pending = saveWorkspaceProject(created.id, { payload: { text: large ? payload.text + "after" : "after" } }, deps)
      .then((value) => { saved = value; }, (reason: unknown) => { error = reason; });
    await vi.runAllTimersAsync();
    await pending;
  } finally {
    active = false;
    vi.restoreAllMocks();
    vi.useRealTimers();
    setDurabilityMode(previousDurability);
    for (const fd of descriptors.keys()) native.closeSync(fd);
  }
  const after = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const residual = leftovers(root);
  const nextExpected = { ...before, lastKnownRootPath: projectRoot, revision: before.revision + 1, updatedAt: after.updatedAt, savedAt: after.savedAt, payload: { text: large ? payload.text + "after" : "after" } };
  delete nextExpected.draft;
  const manifestIntact = workspaceProjectRecordSchema.safeParse(after).success &&
    (isDeepStrictEqual(before, after) || isDeepStrictEqual(nextExpected, after));
  const result = { counts, sleeps, json, injected, matched, error, saved, before, after, residual, injectedAt, manifestIntact };
  native.rmSync(root, { recursive: true, force: true });
  roots.splice(roots.indexOf(root), 1);
  return result;
}

const cases = OPERATIONS.flatMap((operation) => (["project", "settings"] as const).flatMap((scope) =>
  ERRNOS.flatMap((code) => [false, true].map((persistent) => ({ operation, scope, code, persistent })))));

describe("saveWorkspaceProject deterministic I/O fault sweep", () => {
  it("no-fault control exercises every operation and keeps synchronous sleep at zero", async () => {
    const result = await save();
    expect(result.error).toBeUndefined();
    expect(result.saved).toBeDefined();
    expect(result.sleeps).toEqual({});
    expect(result.residual).toEqual([]);
    for (const operation of OPERATIONS) expect(Object.entries(result.counts).filter(([key]) => key.endsWith(`:${operation}`)).reduce((sum, [, count]) => sum + count, 0), operation).toBeGreaterThan(0);
    process.stdout.write("SAVE_CONTROL " + JSON.stringify({ counts: result.counts, json: result.json }) + "\n");
  });

  it.each(cases)("$scope $operation $code persistent=$persistent", async (spec) => {
    const failures: string[] = [];
    const maxima: Record<string, number> = {};
    let injectedRounds = 0;
    let terminal = false;
    // Hard count safety net, never an elapsed-time budget.
    for (let nth = 1; nth <= 256; nth += 1) {
      const result = await save({ ...spec, nth });
      if (result.injected === 0) {
        expect(result.error, `terminal ${nth}`).toBeUndefined();
        expect(result.saved).toBeDefined();
        terminal = true;
        break;
      }
      expect(result.matched, "in-window matched I/O count").toBeGreaterThan(0);
      expect(result.injected, "in-window injected fault count").toBeGreaterThan(0);
      injectedRounds += 1;
      for (const [source, ms] of Object.entries(result.sleeps)) {
        maxima[source] = Math.max(maxima[source] ?? 0, ms);
        const debt = KNOWN_DEBT.sleep[source];
        if (!debt || ms > debt.maxMs) failures.push(`N=${nth} sleep ${source}=${ms}`);
      }
      if (result.residual.length) failures.push(`N=${nth} leftovers=${result.residual.join(",")}`);
      if (result.error && !(result.error instanceof Error && ("code" in result.error || result.error.name !== "Error"))) failures.push(`N=${nth} unclassified=${String(result.error)}`);
      if (!result.error && !result.saved) failures.push(`N=${nth} missing outcome`);
      if (!result.manifestIntact) failures.push(`N=${nth} incomplete manifest`);
    }
    expect(terminal, "sweep must reach an uninjected successful terminal save").toBe(true);
    expect(injectedRounds, "in-window injected rounds >0").toBeGreaterThan(0);
    process.stdout.write("SAVE_SWEEP " + JSON.stringify({ ...spec, injectedRounds, maxima, failures: failures.slice(0, 8) }) + "\n");
    expect(failures).toEqual([]);
  });

  it("known sleep allowances equal the measured full-save maxima (raising alone is red)", async () => {
    const retry = await save({ operation: "read", scope: "project", nth: 1, code: "EBUSY", persistent: true });
    const registry = await save({ operation: "mkdir", scope: "settings", nth: 1, code: "EEXIST", persistent: true });
    const measured = { ...retry.sleeps, ...registry.sleeps };
    expect(measured).toEqual(Object.fromEntries(Object.entries(KNOWN_DEBT.sleep).map(([file, debt]) => [file, debt.maxMs])));
    process.stdout.write("SAVE_KNOWN_SLEEP " + JSON.stringify(measured) + "\n");
  });

  it("known debt cannot increase against the trusted remote merge base", () => {
    const relative = "electron/workspace/saveFaultSweep.test.ts";
    const git = (...args: string[]) => execFileSync("git", args, { cwd: path.resolve(import.meta.dirname, "../.."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const base = git("merge-base", "HEAD", "origin/main");
    // The first addition has no old table; the measured equality checks above
    // still reject raising an allowance alone. Later changes compare trusted base.
    if (!git("ls-tree", "--name-only", base, "--", relative)) return;
    const source = git("show", `${base}:${relative}`);
    const frozenText = source.match(/const SAVE_DEBT_JSON = String.raw`([^`]+)`/);
    expect(frozenText, "trusted base must contain its debt table").not.toBeNull();
    const frozen = JSON.parse(frozenText![1]) as typeof KNOWN_DEBT;
    for (const [file, debt] of Object.entries(KNOWN_DEBT.sleep)) {
      expect(frozen.sleep[file], file).toBeDefined();
      expect(debt.maxMs, file).toBeLessThanOrEqual(frozen.sleep[file].maxMs);
    }
    expect(KNOWN_DEBT.largeJson.stringify).toBeLessThanOrEqual(frozen.largeJson.stringify);
    expect(KNOWN_DEBT.largeJson.parse).toBeLessThanOrEqual(frozen.largeJson.parse);
  });

  it("single ENOSPC at the third project open leaves no manifest lock", async () => {
    const result = await save({ operation: "open", scope: "project", nth: 3, code: "ENOSPC", persistent: false });
    process.stdout.write("SAVE_MINIMAL_REPRO " + JSON.stringify({ injectedAt: result.injectedAt, error: String(result.error), residual: result.residual, oldJsonIntact: JSON.stringify(result.before) === JSON.stringify(result.after) }) + "\n");
    expect(result.residual).toEqual([]);
  });

  it("counts >=1MiB JSON work only inside a real save", async () => {
    const result = await save(undefined, true);
    process.stdout.write("SAVE_LARGE_JSON " + JSON.stringify(result.json) + "\n");
    expect(result.error).toBeUndefined();
    expect(result.json).toEqual(KNOWN_DEBT.largeJson);
  });
});
