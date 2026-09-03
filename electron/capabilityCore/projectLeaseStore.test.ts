import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProjectLeaseStoreIntegrityError,
  createProjectLeaseStore,
  type StoredProjectLease,
  type StoredProjectLeaseRecord,
} from "./projectLeaseStore";

const tempDirs: string[] = [];
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");

function tokenHash(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function lease(index: number, overrides: Partial<StoredProjectLease> = {}): StoredProjectLease {
  return {
    tokenHash: tokenHash(index),
    projectId: "project-1",
    immutableProjectUuid: "uuid-1",
    projectGeneration: 1,
    issuedAt: "2026-08-23T00:00:00.000Z",
    expiresAt: "2026-08-23T00:05:00.000Z",
    ...overrides,
  };
}

function makeRoot(prefix = "nomi-project-lease-store-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return path.join(dir, "project-leases-v2");
}

function makeStore(rootPath: string, options: Partial<Parameters<typeof createProjectLeaseStore>[0]> = {}) {
  return createProjectLeaseStore({
    filePath: rootPath,
    macKey: "lease-store-key",
    keyId: "lease-store-v2",
    now: () => "2026-08-23T00:00:00.000Z",
    ...options,
  });
}

function tokenDir(rootPath: string, hash: string): string {
  return path.join(rootPath, "issued", hash);
}

function candidateName(createdAtMs: number, index: number): string {
  return `.candidate-${createdAtMs}-${index.toString(16).padStart(20, "0")}`;
}

type WorkerAction =
  | { kind: "issue-many"; worker: number; count: number }
  | { kind: "issue"; lease: StoredProjectLease }
  | { kind: "revoke"; tokenHash: string; revokedAt: string };

function writeProcessWorker(rootPath: string): string {
  const workerPath = path.join(path.dirname(rootPath), "project-lease-worker.ts");
  const storeModule = pathToFileURL(
    path.join(process.cwd(), "electron", "capabilityCore", "projectLeaseStore.ts"),
  ).href;
  fs.writeFileSync(
    workerPath,
    `
import fs from "node:fs";
import { createProjectLeaseStore } from ${JSON.stringify(storeModule)};

const action = JSON.parse(process.env.NOMI_LEASE_WORKER_ACTION || "{}") as
  | { kind: "issue-many"; worker: number; count: number }
  | { kind: "issue"; lease: Record<string, unknown> }
  | { kind: "revoke"; tokenHash: string; revokedAt: string };
const store = createProjectLeaseStore({
  filePath: process.env.NOMI_LEASE_WORKER_ROOT || "",
  macKey: "lease-store-key",
  keyId: "lease-store-v2",
  now: () => "2026-08-23T00:00:00.000Z",
  maxRecords: 1_000,
  maxRecordsPerProject: 1_000,
});
// 汇合点：原来用「父进程猜 Date.now() + 1000ms」当起跑线是错的——机器一忙，
// node 启动 + 模块加载就超过这个窗口，worker 到场时闸门早已过期：既没真正同时起跑
// （竞态覆盖被悄悄削弱），又把总耗时拖过 20s 超时。改成真握手：worker 备妥后写 ready
// 标记，然后阻塞等父进程的 release 标记；父进程集齐全部 ready 才放行，与机器快慢无关。
fs.writeFileSync(process.env.NOMI_LEASE_WORKER_READY_PATH || "", "1");
const releasePath = process.env.NOMI_LEASE_WORKER_RELEASE_PATH || "";
const idle = new Int32Array(new SharedArrayBuffer(4));
// 仅作死锁兜底，不承担协调职责：正常路径永远是 release 标记先到。
let waited = 0;
while (!fs.existsSync(releasePath)) {
  Atomics.wait(idle, 0, 0, 5);
  waited += 1;
  if (waited > 12_000) throw new Error("lease worker release barrier timed out");
}
try {
  let result: unknown;
  if (action.kind === "issue-many") {
    for (let index = 0; index < action.count; index += 1) {
      const number = action.worker * action.count + index + 1;
      store.recordIssued({
        tokenHash: number.toString(16).padStart(64, "0"),
        projectId: "project-1",
        immutableProjectUuid: "uuid-1",
        projectGeneration: 1,
        issuedAt: "2026-08-23T00:00:00.000Z",
        expiresAt: "2026-08-23T01:00:00.000Z",
      });
    }
    result = { issued: action.count };
  } else if (action.kind === "issue") {
    result = store.recordIssued(action.lease as never);
  } else if (action.kind === "revoke") {
    result = store.revoke(action.tokenHash, action.revokedAt);
  } else {
    throw new Error("Unknown lease worker action");
  }
  process.stdout.write(JSON.stringify({ ok: true, result }) + "\\n");
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  }) + "\\n");
}
`,
    "utf8",
  );
  return workerPath;
}

// 起跑线由「集齐 ready」定义，而不是墙钟时刻：谁都不会因为启动慢而错过闸门。
async function raceWorkers(
  workerPath: string,
  rootPath: string,
  actions: WorkerAction[],
): Promise<{ ok: boolean; result?: unknown; name?: string; message?: string }[]> {
  const barrierDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-lease-barrier-"));
  tempDirs.push(barrierDir);
  const releasePath = path.join(barrierDir, "release");
  const readyPaths = actions.map((_, index) => path.join(barrierDir, `ready-${index}`));
  const pending = actions.map((action, index) =>
    runWorker(workerPath, rootPath, { readyPath: readyPaths[index], releasePath }, action),
  );

  // 兜底上限只防死锁（worker 崩了就永远集不齐 ready），正常路径靠 ready 到齐驱动。
  const deadline = setTimeout(() => {
    fs.writeFileSync(releasePath, "1");
  }, 60_000);
  try {
    while (!readyPaths.every((readyPath) => fs.existsSync(readyPath))) {
      if (fs.existsSync(releasePath)) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (!fs.existsSync(releasePath)) fs.writeFileSync(releasePath, "1");
    return await Promise.all(pending);
  } finally {
    clearTimeout(deadline);
  }
}

function runWorker(
  workerPath: string,
  rootPath: string,
  barrier: { readyPath: string; releasePath: string },
  action: WorkerAction,
): Promise<{ ok: boolean; result?: unknown; name?: string; message?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, workerPath], {
      env: {
        ...process.env,
        NOMI_LEASE_WORKER_ROOT: rootPath,
        NOMI_LEASE_WORKER_READY_PATH: barrier.readyPath,
        NOMI_LEASE_WORKER_RELEASE_PATH: barrier.releasePath,
        NOMI_LEASE_WORKER_ACTION: JSON.stringify(action),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code !== 0) {
        reject(new Error(`lease worker exited code=${code} signal=${signal}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error(`lease worker returned invalid JSON: ${stdout}\n${stderr}`));
      }
    });
  });
}

type SyntheticFsErrorCode = "EPERM" | "EACCES" | "EBUSY" | "ENOENT";

function syntheticFsError(code: SyntheticFsErrorCode): NodeJS.ErrnoException {
  return Object.assign(new Error(`synthetic ${code}`), { code });
}

function publishCandidateThenFail(code: "EPERM" | "EACCES" | "EBUSY", replaceRecord?: (targetPath: string) => void) {
  const realRename = fs.renameSync.bind(fs);
  return vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    const fromPath = String(from);
    const targetPath = String(to);
    if (path.basename(fromPath).startsWith(".candidate-")) {
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
        const recordName = fs.readdirSync(fromPath)[0];
        fs.copyFileSync(path.join(fromPath, recordName), path.join(targetPath, recordName));
        replaceRecord?.(targetPath);
      }
      throw syntheticFsError(code);
    }
    return realRename(from, to);
  });
}

function failLstatOn(targetPath: string, occurrence: number, code: "ENOENT" | "EACCES" = "ENOENT", andAfter = false) {
  const realLstat = fs.lstatSync.bind(fs);
  let seen = 0;
  return vi.spyOn(fs, "lstatSync").mockImplementation(((value: fs.PathLike, options?: unknown) => {
    if (String(value) === targetPath) {
      seen += 1;
      if (seen === occurrence || (andAfter && seen > occurrence)) throw syntheticFsError(code);
    }
    return options === undefined ? realLstat(value) : realLstat(value, options as never);
  }) as typeof fs.lstatSync);
}

function failReaddirOn(targetPath: string, code: "ENOENT" | "EACCES") {
  const realReaddir = fs.readdirSync.bind(fs);
  let failed = false;
  return vi.spyOn(fs, "readdirSync").mockImplementation(((value: fs.PathLike, options?: unknown) => {
    if (!failed && String(value) === targetPath) {
      failed = true;
      throw syntheticFsError(code);
    }
    return options === undefined ? realReaddir(value) : realReaddir(value, options as never);
  }) as typeof fs.readdirSync);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("ProjectLeaseStore immutable per-token records", () => {
  it("publishes all unique leases across four real processes without treating a renamed candidate as corruption", async () => {
    const rootPath = makeRoot("nomi-project-lease-cross-process-");
    const workerPath = writeProcessWorker(rootPath);

    const results = await raceWorkers(
      workerPath,
      rootPath,
      Array.from({ length: 4 }, (_, worker) => ({ kind: "issue-many" as const, worker, count: 40 })),
    );

    expect(results).toEqual(Array.from({ length: 4 }, () => ({ ok: true, result: { issued: 40 } })));
    expect(makeStore(rootPath, { maxRecords: 1_000, maxRecordsPerProject: 1_000 } as never).list()).toHaveLength(160);
  }, 20_000);

  it("treats only ENOENT as a legitimate formal-token disappearance during concurrent expiry pruning", () => {
    const rootPath = makeRoot("nomi-project-lease-formal-expiry-race-");
    const store = makeStore(rootPath);
    const issued = lease(602);
    store.recordIssued(issued);
    const targetPath = tokenDir(rootPath, issued.tokenHash);
    failLstatOn(targetPath, 1, "ENOENT");

    expect(store.list()).toEqual([]);

    vi.restoreAllMocks();
    failLstatOn(targetPath, 1, "EACCES");
    expect(() => store.list()).toThrow(expect.objectContaining({ code: "EACCES" }));
  });

  it("treats ENOENT inside readInternal as a concurrent expiry removal without hiding other failures", () => {
    const rootPath = makeRoot("nomi-project-lease-read-expiry-race-");
    const store = makeStore(rootPath);
    const issued = lease(603);
    store.recordIssued(issued);
    const targetPath = tokenDir(rootPath, issued.tokenHash);
    // formalTokenNames observes the directory; the next lstat is readInternal.
    failLstatOn(targetPath, 2, "ENOENT", true);

    expect(store.list()).toEqual([]);

    vi.restoreAllMocks();
    failLstatOn(targetPath, 2, "EACCES");
    expect(() => store.list()).toThrow(expect.objectContaining({ code: "EACCES" }));
  });

  it("treats only ENOENT as a token directory disappearing during candidate cleanup", () => {
    const rootPath = makeRoot("nomi-project-lease-candidate-cleanup-race-");
    const store = makeStore(rootPath);
    const issued = lease(604);
    store.recordIssued(issued);
    const targetPath = tokenDir(rootPath, issued.tokenHash);
    failReaddirOn(targetPath, "ENOENT");

    expect(store.recordIssued(lease(605))).toEqual(lease(605));

    vi.restoreAllMocks();
    failReaddirOn(targetPath, "EACCES");
    expect(() => store.recordIssued(lease(606))).toThrow(expect.objectContaining({ code: "EACCES" }));
  });

  it("never revives a successful revoke when issue and revoke cross in separate processes", async () => {
    const rootPath = makeRoot("nomi-project-lease-issue-revoke-");
    const workerPath = writeProcessWorker(rootPath);
    const issued = lease(600);
    makeStore(rootPath).recordIssued(issued);

    const [issueResult, revokeResult] = await raceWorkers(workerPath, rootPath, [
      { kind: "issue", lease: issued },
      {
        kind: "revoke",
        tokenHash: issued.tokenHash,
        revokedAt: "2026-08-23T00:01:00.000Z",
      },
    ]);

    expect(revokeResult).toMatchObject({ ok: true });
    expect(issueResult.ok || issueResult.message?.includes("already revoked")).toBe(true);
    const restarted = makeStore(rootPath);
    expect(restarted.read(issued.tokenHash)).toMatchObject({ revokedAt: "2026-08-23T00:01:00.000Z" });
    expect(() => restarted.recordIssued(issued)).toThrow(/already revoked/);
  }, 20_000);

  it("makes concurrent revocations first-writer-wins across separate processes", async () => {
    const rootPath = makeRoot("nomi-project-lease-double-revoke-");
    const workerPath = writeProcessWorker(rootPath);
    const issued = lease(601);
    makeStore(rootPath).recordIssued(issued);
    const revokedAt = ["2026-08-23T00:01:00.000Z", "2026-08-23T00:02:00.000Z"];

    const results = await raceWorkers(
      workerPath,
      rootPath,
      revokedAt.map((value) => ({ kind: "revoke" as const, tokenHash: issued.tokenHash, revokedAt: value })),
    );
    const final = makeStore(rootPath).read(issued.tokenHash);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(revokedAt).toContain(final?.revokedAt);
    expect(results.map((result) => (result.result as StoredProjectLeaseRecord).revokedAt)).toEqual([
      final?.revokedAt,
      final?.revokedAt,
    ]);
  }, 20_000);

  it.each(["EPERM", "EACCES", "EBUSY"] as const)(
    "accepts a Windows %s target-exists race only after the complete issued record verifies",
    (code) => {
      const rootPath = makeRoot(`nomi-project-lease-${code.toLowerCase()}-`);
      const issued = lease(code === "EPERM" ? 610 : code === "EACCES" ? 611 : 612);
      publishCandidateThenFail(code);

      expect(makeStore(rootPath).recordIssued(issued)).toEqual(issued);
      expect(makeStore(rootPath).read(issued.tokenHash)).toEqual({ lease: issued, revokedAt: undefined });
    },
  );

  it("rejects EPERM when the target issued record has an invalid MAC", () => {
    const rootPath = makeRoot("nomi-project-lease-eperm-invalid-");
    const issued = lease(613);
    publishCandidateThenFail("EPERM", (targetPath) => {
      const recordPath = path.join(targetPath, "issued.json");
      const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
      record.mac = "tampered-mac";
      fs.writeFileSync(recordPath, JSON.stringify(record));
    });

    expect(() => makeStore(rootPath).recordIssued(issued)).toThrow(ProjectLeaseStoreIntegrityError);
  });

  it("rejects EACCES when a MAC-valid revoke marker belongs to another issued record", () => {
    const rootPath = makeRoot("nomi-project-lease-eacces-revoke-binding-");
    const store = makeStore(rootPath);
    const first = lease(614);
    const other = lease(615);
    store.recordIssued(first);
    store.recordIssued(other);
    store.revoke(other.tokenHash, "2026-08-23T00:01:00.000Z");
    const otherMarker = path.join(tokenDir(rootPath, other.tokenHash), "revoked", "record.json");
    publishCandidateThenFail("EACCES", (targetPath) => {
      fs.copyFileSync(otherMarker, path.join(targetPath, "record.json"));
    });

    expect(() => store.revoke(first.tokenHash, "2026-08-23T00:02:00.000Z")).toThrow(ProjectLeaseStoreIntegrityError);
  });

  it("persists independent issued records and an immutable revoke marker across stores", () => {
    const rootPath = makeRoot();
    const first = makeStore(rootPath);
    const second = makeStore(rootPath);
    const leaseA = lease(1);
    const leaseB = lease(2, { projectId: "project-2", immutableProjectUuid: "uuid-2" });

    expect(first.recordIssued(leaseA)).toEqual(leaseA);
    expect(second.recordIssued(leaseB)).toEqual(leaseB);
    expect(first.revoke(leaseA.tokenHash, "2026-08-23T00:01:00.000Z")).toMatchObject({
      lease: leaseA,
      revokedAt: "2026-08-23T00:01:00.000Z",
    });

    const restarted = makeStore(rootPath);
    expect(restarted.list()).toEqual([
      { lease: leaseA, revokedAt: "2026-08-23T00:01:00.000Z" },
      { lease: leaseB, revokedAt: undefined },
    ]);
    expect(fs.statSync(tokenDir(rootPath, leaseA.tokenHash)).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(tokenDir(rootPath, leaseA.tokenHash), "revoked")).isDirectory()).toBe(true);
  });

  it("is idempotent for the same token, rejects conflicts, and never revives a revoked token", () => {
    const rootPath = makeRoot();
    const store = makeStore(rootPath);
    const issued = lease(3);

    expect(store.recordIssued(issued)).toEqual(issued);
    expect(store.recordIssued(issued)).toEqual(issued);
    expect(() => store.recordIssued({ ...issued, projectId: "project-2" })).toThrow(/lease record conflict/);
    store.revoke(issued.tokenHash, "2026-08-23T00:01:00.000Z");
    expect(() => store.recordIssued(issued)).toThrow(/already revoked/);
  });

  it("prunes expired issued and revoked records before every mutation", () => {
    const rootPath = makeRoot();
    let nowMs = Date.parse("2026-08-23T00:00:00.000Z");
    const store = makeStore(rootPath, {
      now: () => new Date(nowMs).toISOString(),
      maxRecords: 1_000,
      maxRecordsPerProject: 1_000,
    } as never);
    const short = lease(4, { expiresAt: "2026-08-23T00:00:00.001Z" });
    store.recordIssued(short);
    store.revoke(short.tokenHash, "2026-08-23T00:00:00.000Z");
    nowMs += 2;
    const active = lease(5, { issuedAt: new Date(nowMs).toISOString(), expiresAt: "2026-08-23T00:05:00.000Z" });

    store.recordIssued(active);

    expect(store.list()).toEqual([{ lease: active, revokedAt: undefined }]);
    expect(fs.existsSync(tokenDir(rootPath, short.tokenHash))).toBe(false);
  });

  it("keeps a 500-open short-TTL churn bounded instead of rewriting an ever-growing ledger", () => {
    const rootPath = makeRoot();
    let nowMs = Date.parse("2026-08-23T00:00:00.000Z");
    const store = makeStore(rootPath, {
      now: () => new Date(nowMs).toISOString(),
      maxRecords: 1_000,
      maxRecordsPerProject: 1_000,
    } as never);

    for (let index = 1; index <= 500; index += 1) {
      store.recordIssued(
        lease(index, {
          issuedAt: new Date(nowMs).toISOString(),
          expiresAt: new Date(nowMs + 1).toISOString(),
        }),
      );
      nowMs += 2;
    }

    const active = lease(501, {
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 60_000).toISOString(),
    });
    store.recordIssued(active);

    expect(store.list()).toEqual([{ lease: active, revokedAt: undefined }]);
    expect(fs.readdirSync(path.join(rootPath, "issued")).filter((name) => /^[a-f0-9]{64}$/.test(name))).toHaveLength(1);
  });

  it("removes repeated crash candidates after a short grace on startup", () => {
    const rootPath = makeRoot("nomi-project-lease-stale-candidates-");
    const issuedRoot = path.join(rootPath, "issued");
    fs.mkdirSync(issuedRoot, { recursive: true });
    const nowMs = Date.parse("2026-08-23T00:00:00.000Z");
    for (let index = 0; index < 50; index += 1) {
      fs.mkdirSync(path.join(issuedRoot, candidateName(nowMs - 60_000, index)));
    }

    makeStore(rootPath, { candidateGraceMs: 1_000, maxCandidates: 4 } as never);

    expect(fs.readdirSync(issuedRoot).filter((name) => name.startsWith(".candidate-"))).toEqual([]);
  });

  it("rejects publication when fresh crash candidates reach their independent hard cap", () => {
    const rootPath = makeRoot("nomi-project-lease-fresh-candidates-");
    const nowMs = Date.parse("2026-08-23T00:00:00.000Z");
    const store = makeStore(rootPath, { candidateGraceMs: 60_000, maxCandidates: 2 } as never);
    const issuedRoot = path.join(rootPath, "issued");
    for (let index = 0; index < 2; index += 1) {
      fs.mkdirSync(path.join(issuedRoot, candidateName(nowMs, index)));
    }

    expect(() => store.recordIssued(lease(502))).toThrow(
      expect.objectContaining({
        code: "project_session_unavailable",
        message: "Project session capacity is unavailable",
      }),
    );
    expect(fs.readdirSync(issuedRoot).filter((name) => name.startsWith(".candidate-"))).toHaveLength(2);
    expect(store.list()).toEqual([]);
  });

  it("rejects new unexpired records at the global and per-project capacity with a fixed typed error", () => {
    const perProjectRoot = makeRoot("nomi-project-lease-cap-project-");
    const perProject = makeStore(perProjectRoot, { maxRecords: 3, maxRecordsPerProject: 2 } as never);
    perProject.recordIssued(lease(10));
    perProject.recordIssued(lease(11));
    expect(() => perProject.recordIssued(lease(12))).toThrow(
      expect.objectContaining({
        code: "project_session_unavailable",
        message: "Project session capacity is unavailable",
      }),
    );

    const globalRoot = makeRoot("nomi-project-lease-cap-global-");
    const global = makeStore(globalRoot, { maxRecords: 2, maxRecordsPerProject: 2 } as never);
    global.recordIssued(lease(20));
    global.recordIssued(lease(21, { projectId: "project-2", immutableProjectUuid: "uuid-2" }));
    expect(() => global.recordIssued(lease(22, { projectId: "project-3", immutableProjectUuid: "uuid-3" }))).toThrow(
      expect.objectContaining({
        code: "project_session_unavailable",
        message: "Project session capacity is unavailable",
      }),
    );
    expect(global.list()).toHaveLength(2);
  });

  it("fails closed for tampered revocation binding and unknown formal entries", () => {
    const rootPath = makeRoot();
    const store = makeStore(rootPath);
    const issued = lease(30);
    store.recordIssued(issued);
    store.revoke(issued.tokenHash, "2026-08-23T00:01:00.000Z");

    const revokePath = path.join(tokenDir(rootPath, issued.tokenHash), "revoked", "record.json");
    const revoked = JSON.parse(fs.readFileSync(revokePath, "utf8"));
    revoked.payload.issuedChecksum = "tampered-issued-checksum";
    fs.writeFileSync(revokePath, JSON.stringify(revoked));
    expect(() => store.read(issued.tokenHash)).toThrow(ProjectLeaseStoreIntegrityError);

    const otherRoot = makeRoot("nomi-project-lease-unknown-");
    const other = makeStore(otherRoot);
    other.list();
    fs.mkdirSync(path.join(otherRoot, "issued", "not-a-token"));
    expect(() => other.list()).toThrow(ProjectLeaseStoreIntegrityError);
  });

  it("ignores candidates as non-authoritative but rejects symlinked token paths", () => {
    const rootPath = makeRoot();
    const store = makeStore(rootPath);
    store.list();
    fs.mkdirSync(path.join(rootPath, "issued", candidateName(Date.parse("2026-08-23T00:00:00.000Z"), 999)));
    expect(store.list()).toEqual([]);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-lease-outside-"));
    tempDirs.push(outside);
    fs.symlinkSync(outside, tokenDir(rootPath, tokenHash(40)), "dir");
    expect(() => store.list()).toThrow(ProjectLeaseStoreIntegrityError);
  });

  it("uses private permissions and verifies records signed by previous keys", () => {
    const rootPath = makeRoot();
    const issued = lease(50);
    makeStore(rootPath, { macKey: "old-key", keyId: "old-key-id" }).recordIssued(issued);
    const restarted = makeStore(rootPath, {
      macKey: "new-key",
      keyId: "new-key-id",
      previousKeys: { "old-key-id": "old-key" },
    });

    expect(restarted.read(issued.tokenHash)).toEqual({ lease: issued, revokedAt: undefined });
    if (process.platform !== "win32") {
      expect(fs.statSync(rootPath).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(tokenDir(rootPath, issued.tokenHash), "issued.json")).mode & 0o777).toBe(0o600);
    }
  });

  it("retires the legacy central JSON once and never reads or writes it again", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-lease-legacy-"));
    tempDirs.push(dir);
    const rootPath = path.join(dir, "project-leases-v2");
    const legacyFilePath = path.join(dir, "project-leases.json");
    fs.writeFileSync(legacyFilePath, JSON.stringify({ schemaVersion: 1, records: { secret: "old-session" } }));
    const first = makeStore(rootPath, { legacyFilePath } as never);
    const second = makeStore(rootPath, { legacyFilePath } as never);

    expect(first.list()).toEqual([]);
    expect(second.list()).toEqual([]);
    expect(fs.existsSync(legacyFilePath)).toBe(false);
    expect(fs.statSync(rootPath).isDirectory()).toBe(true);
  });
});
