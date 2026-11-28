import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from "vitest";
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
const realSetImmediate = globalThis.setImmediate.bind(globalThis);
const native = {
  open: fs.open.bind(fs), close: fs.close.bind(fs),
  write: fs.write.bind(fs), writeFile: fs.writeFile.bind(fs),
  fsync: fs.fsync.bind(fs), rename: fs.rename.bind(fs),
  unlink: fs.unlink.bind(fs), rm: fs.rm.bind(fs), rmdir: fs.rmdir.bind(fs),
  mkdir: fs.mkdir.bind(fs), readFile: fs.readFile.bind(fs),
  openSync: fs.openSync.bind(fs), writeFileSync: fs.writeFileSync.bind(fs),
  fsyncSync: fs.fsyncSync.bind(fs), renameSync: fs.renameSync.bind(fs),
  rmSync: fs.rmSync.bind(fs), rmdirSync: fs.rmdirSync.bind(fs),
  mkdirSync: fs.mkdirSync.bind(fs), readFileSync: fs.readFileSync.bind(fs),
  closeSync: fs.closeSync.bind(fs),
};
const nativePromises = {
  writeFile: fs.promises.writeFile.bind(fs.promises),
  rename: fs.promises.rename.bind(fs.promises),
  rm: fs.promises.rm.bind(fs.promises),
  rmdir: fs.promises.rmdir.bind(fs.promises),
  unlink: fs.promises.unlink.bind(fs.promises),
  mkdir: fs.promises.mkdir.bind(fs.promises),
  readFile: fs.promises.readFile.bind(fs.promises),
};

// These are requested sleep milliseconds, not elapsed time or a renderer long task.
const SAVE_DEBT_JSON = String.raw`{
  "sleep": {},
  "largeJson": { "stringify": 12, "parse": 14 }
}`;
const KNOWN_DEBT = JSON.parse(SAVE_DEBT_JSON) as {
  sleep: Record<string, { maxMs: number; source: string }>;
  largeJson: { stringify: number; parse: number };
};

const cleanRoots = () => {
  for (const root of roots.splice(0)) native.rmSync(root, { recursive: true, force: true });
};
afterAll(cleanRoots);
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setDurabilityMode(previousDurability);
  cleanRoots();
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

function workspaceScope(file: string, prefixes: Record<Scope, string>): Scope | undefined {
  for (const scope of ["project", "settings"] as const) {
    const prefix = prefixes[scope];
    if (file === prefix || file.startsWith(prefix + path.sep)) return scope;
  }
  return undefined;
}

function restartSave(root: string, id: string, mode: string, nowMs: number) {
  const fixture = path.resolve(import.meta.dirname, "../../tests/fixtures/save-fault-restart.mjs");
  const child = spawnSync(process.execPath, ["--import", "tsx", fixture, JSON.stringify({ root, id, mode, nowMs })], {
    encoding: "utf8", timeout: 30_000,
    env: { ...process.env, VITEST: undefined, VITEST_WORKER_ID: undefined },
  });
  let response: { pid?: number; error?: { name: string; code?: string; message: string }; saved?: unknown; persisted?: unknown; ownerLeft?: boolean };
  try { response = JSON.parse(child.stdout.trim()); }
  catch { throw new Error(`Cold-process fixture protocol failed: ${child.error ?? child.stderr}`); }
  if (!Number.isInteger(response.pid) || response.pid !== child.pid || response.pid === process.pid) throw new Error("Restart must use a real new pid");
  return { ...response, exit: child.status, residual: leftovers(root) };
}

async function save(fault?: Fault, large = false, coldOwnerControl = false) {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-30T00:00:00Z"));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-save-fault-")));
  roots.push(root);
  const deps = { settingsRoot: path.join(root, "settings"), defaultProjectsRoot: path.join(root, "projects") };
  fs.mkdirSync(deps.settingsRoot);
  const projectRoot = path.join(deps.defaultProjectsRoot, "project");
  const payload = { text: large ? "x".repeat(1024 * 1024) : "before" };
  const created = createWorkspaceProject({ rootPath: projectRoot, record: { name: "Save sweep", payload } }, deps);
  fs.writeFileSync(path.join(root, ".save-fault-fixture.json"), JSON.stringify({ id: created.id }));
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
  let injecting = true;
  const hit = (operation: Operation, input: unknown): void => {
    if (!active) return;
    // fd calls are ALL counted in the save window; their owning open supplies the
    // path prefix. Never test a numeric fd against a string prefix and skip it.
    const file = typeof input === "number" ? descriptors.get(input) : String(input);
    if (typeof input === "number" && !file) throw new Error(`Unattributed ${operation} fd`);
    const scope = file ? workspaceScope(file, { project: projectRoot, settings: deps.settingsRoot }) : undefined;
    if (!scope) return;
    const key = `${scope}:${operation}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (!injecting || fault?.operation !== operation || fault.scope !== scope) return;
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
    if (active) sleeps[source] = (sleeps[source] ?? 0) + ms;
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

  const failCallback = (cb: unknown, error: unknown): void => {
    process.nextTick(() => (cb as (err: unknown) => void)(error));
  };
  vi.spyOn(fs, "open").mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: NodeJS.ErrnoException | null, fd?: number) => void;
    try {
      hit("open", args[0]);
    } catch (error) {
      failCallback(cb, error);
      return;
    }
    const wrapped = (err: NodeJS.ErrnoException | null, fd?: number): void => {
      if (!err && typeof fd === "number") descriptors.set(fd, String(args[0]));
      cb(err, fd);
    };
    return (native.open as (...inner: unknown[]) => unknown)(...args.slice(0, -1), wrapped);
  }) as typeof fs.open);
  vi.spyOn(fs, "close").mockImplementation(((fd: number, cb?: (err: NodeJS.ErrnoException | null) => void) => {
    descriptors.delete(fd);
    return native.close(fd, cb ?? (() => undefined));
  }) as typeof fs.close);
  vi.spyOn(fs, "write").mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1];
    try { hit("write", args[0]); } catch (error) { failCallback(cb, error); return; }
    return (native.write as (...inner: unknown[]) => unknown)(...args);
  }) as typeof fs.write);
  vi.spyOn(fs, "writeFile").mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1];
    try { hit("write", args[0]); } catch (error) { failCallback(cb, error); return; }
    return (native.writeFile as (...inner: unknown[]) => unknown)(...args);
  }) as typeof fs.writeFile);
  vi.spyOn(fs, "fsync").mockImplementation(((fd: number, cb: (err: NodeJS.ErrnoException | null) => void) => {
    try { hit("fsync", fd); } catch (error) { failCallback(cb, error); return; }
    process.nextTick(() => cb(null));
  }) as typeof fs.fsync);
  vi.spyOn(fs, "rename").mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1];
    try { hit("rename", args[0]); } catch (error) { failCallback(cb, error); return; }
    return (native.rename as (...inner: unknown[]) => unknown)(...args);
  }) as typeof fs.rename);
  vi.spyOn(fs, "unlink").mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1];
    try { hit("remove", args[0]); } catch (error) { failCallback(cb, error); return; }
    return (native.unlink as (...inner: unknown[]) => unknown)(...args);
  }) as typeof fs.unlink);
  vi.spyOn(fs, "rm").mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1];
    try { hit("remove", args[0]); } catch (error) { failCallback(cb, error); return; }
    return (native.rm as (...inner: unknown[]) => unknown)(...args);
  }) as typeof fs.rm);
  vi.spyOn(fs, "rmdir").mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1];
    try { hit("remove", args[0]); } catch (error) { failCallback(cb, error); return; }
    return (native.rmdir as (...inner: unknown[]) => unknown)(...args);
  }) as typeof fs.rmdir);
  vi.spyOn(fs, "mkdir").mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1];
    try { hit("mkdir", args[0]); } catch (error) { failCallback(cb, error); return; }
    return (native.mkdir as (...inner: unknown[]) => unknown)(...args);
  }) as typeof fs.mkdir);
  vi.spyOn(fs, "readFile").mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1];
    try { hit("read", args[0]); } catch (error) { failCallback(cb, error); return; }
    return (native.readFile as (...inner: unknown[]) => unknown)(...args);
  }) as typeof fs.readFile);

  vi.spyOn(fs.promises, "writeFile").mockImplementation((async (...args: Parameters<typeof fs.promises.writeFile>) => {
    hit("write", args[0]);
    return nativePromises.writeFile(...args);
  }) as typeof fs.promises.writeFile);
  vi.spyOn(fs.promises, "rename").mockImplementation((async (...args: Parameters<typeof fs.promises.rename>) => {
    hit("rename", args[0]);
    return nativePromises.rename(...args);
  }) as typeof fs.promises.rename);
  vi.spyOn(fs.promises, "rm").mockImplementation((async (...args: Parameters<typeof fs.promises.rm>) => {
    hit("remove", args[0]);
    return nativePromises.rm(...args);
  }) as typeof fs.promises.rm);
  vi.spyOn(fs.promises, "rmdir").mockImplementation((async (...args: Parameters<typeof fs.promises.rmdir>) => {
    hit("remove", args[0]);
    return nativePromises.rmdir(...args);
  }) as typeof fs.promises.rmdir);
  vi.spyOn(fs.promises, "unlink").mockImplementation((async (...args: Parameters<typeof fs.promises.unlink>) => {
    hit("remove", args[0]);
    return nativePromises.unlink(...args);
  }) as typeof fs.promises.unlink);
  vi.spyOn(fs.promises, "mkdir").mockImplementation((async (...args: Parameters<typeof fs.promises.mkdir>) => {
    hit("mkdir", args[0]);
    return nativePromises.mkdir(...args);
  }) as typeof fs.promises.mkdir);
  vi.spyOn(fs.promises, "readFile").mockImplementation((async (...args: Parameters<typeof fs.promises.readFile>) => {
    hit("read", args[0]);
    return nativePromises.readFile(...args);
  }) as typeof fs.promises.readFile);
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
  let activeAttemptTimers: Set<ReturnType<typeof setTimeout>> | null = null;
  let onFakeTimerScheduled: (() => void) | null = null;
  const fakeSetTimeout = globalThis.setTimeout.bind(globalThis);
  const fakeClearTimeout = globalThis.clearTimeout.bind(globalThis);
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    const trackedSet = activeAttemptTimers;
    const holder: { handle?: ReturnType<typeof setTimeout> } = {};
    const wrapped = (...cbArgs: unknown[]): unknown => {
      if (holder.handle !== undefined) trackedSet?.delete(holder.handle);
      return typeof callback === "function" ? (callback as (...inner: unknown[]) => unknown)(...cbArgs) : undefined;
    };
    const handle = fakeSetTimeout(wrapped, delay, ...args);
    holder.handle = handle;
    if (trackedSet) {
      trackedSet.add(handle);
      onFakeTimerScheduled?.();
    }
    return handle;
  }) as unknown as typeof setTimeout);
  vi.spyOn(globalThis, "clearTimeout").mockImplementation(((handle?: ReturnType<typeof setTimeout>) => {
    if (handle !== undefined) activeAttemptTimers?.delete(handle);
    return fakeClearTimeout(handle);
  }) as unknown as typeof clearTimeout);
  const attempt = async (text: string) => {
    let error: unknown;
    let saved: Awaited<ReturnType<typeof saveWorkspaceProject>> | undefined;
    let settled = false;
    let pumpScheduled = false;
    let pumping = false;
    let fakeTicks = 0;
    const attemptTimers = new Set<ReturnType<typeof setTimeout>>();
    let rejectTurnBound: ((reason: Error) => void) | undefined;
    const turnBoundExceeded = new Promise<never>((_resolve, reject) => {
      rejectTurnBound = reject;
    });
    const schedulePump = (): void => {
      if (settled || pumpScheduled || pumping || attemptTimers.size === 0) return;
      pumpScheduled = true;
      realSetImmediate(() => {
        pumpScheduled = false;
        if (settled || pumping || attemptTimers.size === 0 || vi.getTimerCount() === 0) return;
        fakeTicks += 1;
        if (fakeTicks > 16384) {
          settled = true;
          rejectTurnBound?.(new Error("save attempt exceeded fake-clock turn bound"));
          return;
        }
        pumping = true;
        void vi.advanceTimersToNextTimerAsync().then(
          () => {
            pumping = false;
            if (!settled && attemptTimers.size > 0) schedulePump();
          },
          (pumpErr: unknown) => {
            pumping = false;
            settled = true;
            rejectTurnBound?.(pumpErr instanceof Error ? pumpErr : new Error(String(pumpErr)));
          },
        );
      });
    };
    activeAttemptTimers = attemptTimers;
    onFakeTimerScheduled = schedulePump;
    try {
      const pending = saveWorkspaceProject(created.id, { payload: { text } }, deps)
        .then((value) => { saved = value; settled = true; }, (reason: unknown) => { error = reason; settled = true; });
      await Promise.race([pending, turnBoundExceeded]);
    } finally {
      settled = true;
      activeAttemptTimers = null;
      onFakeTimerScheduled = null;
    }
    return { error, saved };
  };
  let result;
  try {
    const first = await attempt(large ? payload.text + "after" : "after");
    active = false;
    injecting = false;
    const after = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const immediateResidual = leftovers(root);
    const nextExpected = { ...before, lastKnownRootPath: projectRoot, revision: before.revision + 1, updatedAt: after.updatedAt, savedAt: after.savedAt, payload: { text: large ? payload.text + "after" : "after" } };
    delete nextExpected.draft;
    const manifestIntact = workspaceProjectRecordSchema.safeParse(after).success &&
      (isDeepStrictEqual(before, after) || isDeepStrictEqual(nextExpected, after));
    const truthful = !first.saved || (isDeepStrictEqual(after, nextExpected) && isDeepStrictEqual(after, JSON.parse(JSON.stringify(first.saved))));
    let recovery;
    if (fault && injected > 0) {
      const outcome = await attempt("recovered");
      const persisted = JSON.parse(fs.readFileSync(manifest, "utf8"));
      recovery = { ...outcome, residual: leftovers(root), truthful: Boolean(outcome.saved) && persisted.revision === after.revision + 1 && persisted.payload?.text === "recovered" && isDeepStrictEqual(persisted, JSON.parse(JSON.stringify(outcome.saved))) };
    }
    result = { clockMs: Date.now(), counts, sleeps, json, injected, matched, ...first, before, after, immediateResidual, residual: leftovers(root), injectedAt, manifestIntact, truthful, recovery };
  } finally {
    active = false;
    vi.restoreAllMocks();
    vi.useRealTimers();
    setDurabilityMode(previousDurability);
    for (const fd of descriptors.keys()) native.closeSync(fd);
  }
  try {
    let deadOwner;
    if (coldOwnerControl) deadOwner = restartSave(root, created.id, "leave-owner", result.clockMs);
    const restart = (fault && injected > 0) || coldOwnerControl ? restartSave(root, created.id, fault ? "after-fault" : "save", result.clockMs) : undefined;
    return { ...result, restart, deadOwner };
  } finally {
    native.rmSync(root, { recursive: true, force: true });
    roots.splice(roots.indexOf(root), 1);
  }
}

const cases = OPERATIONS.flatMap((operation) => (["project", "settings"] as const).flatMap((scope) =>
  ERRNOS.flatMap((code) => [false, true].map((persistent) => ({ operation, scope, code, persistent })))));

describe("saveWorkspaceProject deterministic I/O fault sweep", () => {
  beforeAll(async () => {
    const control = await save(undefined, false, true);
    expect(control.deadOwner?.exit, JSON.stringify(control.deadOwner)).toBe(0);
    expect(control.deadOwner?.ownerLeft).toBe(true);
    expect(control.deadOwner?.residual).toContain("projects/project/.nomi/manifest-transaction.lock");
    expect(control.restart?.exit, JSON.stringify(control.restart)).toBe(0);
    expect(control.restart?.residual).toEqual([]);
    expect(control.restart?.pid).not.toBe(control.deadOwner?.pid);
    process.stdout.write("RESTART_PIDS " + JSON.stringify({ parent: process.pid, deadOwner: control.deadOwner?.pid, freshSaver: control.restart?.pid }) + "\n");
  });
  it("scope prefixes include the root itself and children, excluding sibling lookalikes", () => {
    const base = path.resolve(os.tmpdir(), "save-scope-proof");
    const prefixes = { project: path.join(base, "project"), settings: path.join(base, "settings") };
    for (const scope of ["project", "settings"] as const) {
      expect(workspaceScope(prefixes[scope], prefixes)).toBe(scope);
      expect(workspaceScope(path.join(prefixes[scope], "data.json"), prefixes)).toBe(scope);
      expect(workspaceScope(path.join(prefixes[scope] + "-outside", "data.json"), prefixes)).toBeUndefined();
    }
    expect(workspaceScope(base, prefixes)).toBeUndefined();
  });

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
    let sameProcessRecoveries = 0;
    let freshProcessSaves = 0;
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
      if (!result.truthful) failures.push(`N=${nth} false-success`);
      if (result.recovery?.saved && result.recovery.truthful && !result.recovery.error && result.recovery.residual.length === 0) sameProcessRecoveries += 1;
      if (result.restart?.exit === 0 && result.restart.saved && result.restart.residual.length === 0) freshProcessSaves += 1;
      if (result.recovery?.error || !result.recovery?.saved || !result.recovery.truthful) failures.push(`N=${nth} same-process-save=${String(result.recovery?.error ?? "false-success")}`);
      if (result.recovery?.residual.length) failures.push(`N=${nth} same-process-leftovers=${result.recovery.residual.join(",")}`);
      if (result.restart?.exit !== 0 || result.restart?.error || !result.restart?.saved) failures.push(`N=${nth} fresh-process-save=${JSON.stringify(result.restart?.error)}`);
      if (result.restart?.saved && !isDeepStrictEqual(result.restart.saved, result.restart.persisted)) failures.push(`N=${nth} fresh-process-false-success`);
      if (result.restart?.residual.length) failures.push(`N=${nth} fresh-process-leftovers=${result.restart.residual.join(",")}`);
      if (result.error && !(result.error instanceof Error && ("code" in result.error || result.error.name !== "Error"))) failures.push(`N=${nth} unclassified=${String(result.error)}`);
      if (!result.error && !result.saved) failures.push(`N=${nth} missing outcome`);
      if (!result.manifestIntact) failures.push(`N=${nth} incomplete manifest`);
    }
    expect(terminal, "sweep must reach an uninjected successful terminal save").toBe(true);
    expect(injectedRounds, "in-window injected rounds >0").toBeGreaterThan(0);
    process.stdout.write("SAVE_SWEEP " + JSON.stringify({ ...spec, injectedRounds, sameProcessRecoveries, freshProcessSaves, maxima, failures: failures.slice(0, 8) }) + "\n");
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

  it("single ENOSPC at the third project open recovers in the same and a fresh process", async () => {
    const result = await save({ operation: "open", scope: "project", nth: 3, code: "ENOSPC", persistent: false });
    process.stdout.write("SAVE_MINIMAL_REPRO " + JSON.stringify({ injectedAt: result.injectedAt, error: String(result.error), immediateResidual: result.immediateResidual, recoveryResidual: result.recovery?.residual, freshResidual: result.restart?.residual, freshPidIsNew: result.restart?.pid !== process.pid, freshError: result.restart?.error, oldJsonIntact: JSON.stringify(result.before) === JSON.stringify(result.after) }) + "\n");
    expect(result.error).toMatchObject({ code: "ENOSPC" });
    expect(result.recovery?.error).toBeUndefined();
    expect(result.recovery?.residual).toEqual([]);
    expect(result.restart?.exit).toBe(0);
    expect(result.restart?.residual).toEqual([]);
  });

  it("counts >=1MiB JSON work only inside a real save", async () => {
    const result = await save(undefined, true);
    process.stdout.write("SAVE_LARGE_JSON " + JSON.stringify(result.json) + "\n");
    expect(result.error).toBeUndefined();
    expect(result.json).toEqual(KNOWN_DEBT.largeJson);
  });
});
