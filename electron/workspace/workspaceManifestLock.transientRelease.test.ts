// 2026-09-24 Windows 用户反馈：项目文件夹被同步盘 / 杀毒软件开着文件时，释放锁那一下改名失败（EPERM），
// 锁目录留在原地且记着本进程自己的 pid → 此后保存 / 导入 / 生成结果落盘全部「owner is still alive」，
// 直到退出 Nomi。这组测试钉的是整类：共享冲突既不能把锁永久留给自己，也不能把已提交的事务报成失败，
// 读不到别人的锁信息时更不能据此强拆。修复前全部为红（见 docs/fixes/2026-09-24-manifest-lock-sharing-violation.root-cause.json）。
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WorkspaceManifestLockBusyError,
  acquireWorkspaceManifestLock,
  releaseWorkspaceManifestLock,
  tryAcquireWorkspaceManifestLock,
} from "./workspaceManifestLock";
import { withWorkspaceManifestTransaction } from "./workspaceManifestTransaction";

const tempRoots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-lock-transient-"));
  tempRoots.push(root);
  return root;
}

function lockDirOf(root: string): string {
  return path.join(fs.realpathSync(root), ".nomi", "manifest-transaction.lock");
}

// Exact shape Node raises on Windows when another process holds a child file without FILE_SHARE_DELETE.
function sharingViolation(syscall: "rename" | "unlink", from: string, to?: string): NodeJS.ErrnoException {
  const code = syscall === "rename" ? "EPERM" : "EBUSY";
  const errno = syscall === "rename" ? -4048 : -4082;
  return Object.assign(new Error(`${code}: ${syscall} '${from}'${to ? ` -> '${to}'` : ""}`), { code, errno, syscall, path: from, ...(to ? { dest: to } : {}) });
}

// Real OS handle, no mocks: a PowerShell process opens lockDir/owner.json with FileShare.Read
// (what 坚果云/OneDrive/AV do) across the release, then lets go.
function holdWithShareRead(file: string, ms: number): Promise<{ exited: Promise<void> }> {
  const ps = `$fs=[System.IO.File]::Open('${file.replace(/'/g, "''")}','Open','Read','Read'); [Console]::Out.WriteLine('HELD'); [Console]::Out.Flush(); Start-Sleep -Milliseconds ${ms}; $fs.Close()`;
  const child = spawn("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: ["ignore", "pipe", "ignore"] });
  const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  return new Promise((resolve) => child.stdout.on("data", (d: Buffer) => { if (d.toString().includes("HELD")) resolve({ exited }); }));
}

describe.runIf(process.platform === "win32")("workspace manifest lock with a real foreign handle (win32)", () => {
  it("a release overlapping a FileShare.Read holder never leaves the process locked out", async () => {
    const root = makeRoot();
    const lease = tryAcquireWorkspaceManifestLock(root);
    const { exited: holderGone } = await holdWithShareRead(path.join(lease.lockDir, "owner.json"), 1_000);
    try { releaseWorkspaceManifestLock(lease); } catch { /* acceptable only if the next acquire recovers */ }
    await holderGone;
    const next = await acquireWorkspaceManifestLock(root, { waitTimeoutMs: 1_000 });
    releaseWorkspaceManifestLock(next);
    expect(fs.readdirSync(path.dirname(lease.lockDir)).filter((n) => n.startsWith("manifest-transaction."))).toEqual([]);
  });
});

describe("workspace manifest lock under transient Windows sharing violations", () => {
  it("release retries a transient EPERM on the lock-dir rename instead of orphaning the lock", () => {
    const root = makeRoot();
    const lease = tryAcquireWorkspaceManifestLock(root);
    const realRename = fs.renameSync.bind(fs);
    let failures = 2;
    vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(from) === lease.lockDir && failures > 0) { failures -= 1; throw sharingViolation("rename", String(from), String(to)); }
      return realRename(from, to);
    }) as typeof fs.renameSync);

    expect(() => releaseWorkspaceManifestLock(lease)).not.toThrow();
    expect(fs.existsSync(lockDirOf(root))).toBe(false);
  });

  it("a lock owned by this very process with no live in-process lease is reclaimable immediately", async () => {
    const root = makeRoot();
    const lease = tryAcquireWorkspaceManifestLock(root);
    const realRename = fs.renameSync.bind(fs);
    const spy = vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(from) === lease.lockDir) throw sharingViolation("rename", String(from), String(to));
      return realRename(from, to);
    }) as typeof fs.renameSync);
    try { releaseWorkspaceManifestLock(lease); } catch { /* holder outlived any retry budget */ }
    spy.mockRestore(); // the "holder" lets go

    const next = await acquireWorkspaceManifestLock(root, { waitTimeoutMs: 300 });
    releaseWorkspaceManifestLock(next);
    expect(fs.existsSync(lockDirOf(root))).toBe(false);
  });

  it("publish EPERM + candidate cleanup EBUSY (the real Windows pair) stays retriable", async () => {
    const root = makeRoot();
    const realRename = fs.renameSync.bind(fs);
    const realRm = fs.rmSync.bind(fs);
    let failPublish = true;
    let failCleanup = true;
    vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (failPublish && String(from).includes("manifest-transaction.candidate-") && String(to).endsWith("manifest-transaction.lock")) {
        failPublish = false; throw sharingViolation("rename", String(from), String(to));
      }
      return realRename(from, to);
    }) as typeof fs.renameSync);
    vi.spyOn(fs, "rmSync").mockImplementation(((target: fs.PathLike, options?: fs.RmOptions) => {
      if (failCleanup && String(target).includes("manifest-transaction.candidate-")) {
        failCleanup = false; throw sharingViolation("unlink", path.join(String(target), "owner.json"));
      }
      return realRm(target, options);
    }) as typeof fs.rmSync);

    const lease = await acquireWorkspaceManifestLock(root, { retryDelayMs: 1, waitTimeoutMs: 1_000 });
    releaseWorkspaceManifestLock(lease);
  });

  it("never quarantines another live process's lock just because its owner record is held open", () => {
    const root = makeRoot();
    const other = tryAcquireWorkspaceManifestLock(root, { host: "host-a", pid: 101, ownerId: "other", randomId: () => "other-nonce" });
    fs.utimesSync(other.lockDir, new Date(0), new Date(0));
    const ownerPath = path.join(other.lockDir, "owner.json");
    const realRead = fs.readFileSync.bind(fs);
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, options?: unknown) => {
      if (String(file) === ownerPath) throw Object.assign(new Error(`EBUSY: resource busy or locked, open '${ownerPath}'`), { code: "EBUSY" });
      return realRead(file, options as never);
    }) as typeof fs.readFileSync);

    expect(() => tryAcquireWorkspaceManifestLock(root, { host: "host-a", pid: 202, initializationGraceMs: 1, processLiveness: () => "alive" }))
      .toThrow(WorkspaceManifestLockBusyError);
    vi.restoreAllMocks();
    expect(fs.existsSync(other.lockDir)).toBe(true);
    releaseWorkspaceManifestLock(other);
  });

  it("does not report a committed transaction as failed when the lock directory cannot be moved away", async () => {
    const root = makeRoot();
    const lockDir = lockDirOf(root);
    const realRename = fs.renameSync.bind(fs);
    const spy = vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(from) === lockDir && String(to).includes("manifest-transaction.release-")) throw sharingViolation("rename", String(from), String(to));
      return realRename(from, to);
    }) as typeof fs.renameSync);

    await expect(withWorkspaceManifestTransaction(root, () => "committed")).resolves.toBe("committed");
    spy.mockRestore();
    await expect(withWorkspaceManifestTransaction(root, () => "next save", { waitTimeoutMs: 300 })).resolves.toBe("next save");
    expect(fs.existsSync(lockDir)).toBe(false);
  });
});

