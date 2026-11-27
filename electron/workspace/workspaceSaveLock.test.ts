import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceProject, saveWorkspaceProject } from "./workspaceRepository";
import { releaseWorkspaceManifestLock, tryAcquireWorkspaceManifestLock } from "./workspaceManifestLock";
import { workspaceProjectBackupFile, workspaceProjectFile } from "./workspacePaths";
import { withWorkspaceManifestStagedTransaction } from "./workspaceManifestTransaction";

const roots: string[] = [];
beforeEach(() => vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
async function waitWithFakeTimers<T>(promise: Promise<T>, tickMs = 10): Promise<T> {
  let settled = false;
  const tracked = promise.then(
    (value) => { settled = true; return value; },
    (error: unknown) => { settled = true; throw error; },
  );
  tracked.catch(() => undefined);
  for (let turn = 0; !settled && turn < 2048; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!settled && vi.getTimerCount() > 0) {
      await vi.advanceTimersByTimeAsync(tickMs);
    }
  }
  return tracked;
}
async function pumpTimers(ms: number): Promise<void> {
  const step = 10;
  let remaining = ms;
  await new Promise<void>((resolve) => setImmediate(resolve));
  while (remaining > 0) {
    const delta = Math.min(step, remaining);
    await vi.advanceTimersByTimeAsync(delta);
    await new Promise<void>((resolve) => setImmediate(resolve));
    remaining -= delta;
  }
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-save-lock-")); roots.push(root);
  const deps = { settingsRoot: path.join(root, "settings"), defaultProjectsRoot: path.join(root, "projects") };
  const projectRoot = path.join(root, "project");
  const created = createWorkspaceProject({ rootPath: projectRoot, record: { name: "saved", payload: { version: 0 } } }, deps);
  const bytes = () => [workspaceProjectBackupFile(projectRoot), workspaceProjectFile(projectRoot)].map(file => fs.readFileSync(file, "utf8"));
  return { projectRoot, deps, created, bytes };
}
const isPublish = (from: fs.PathLike, to: fs.PathLike) => String(from).includes("manifest-transaction.candidate-") && String(to).endsWith("manifest-transaction.lock");

describe("project save ownership", () => {
  it("keeps alias requests in order, allows another root to proceed, and releases a failed queue tail", async () => {
    const f = fixture(), other = fixture();
    const held = tryAcquireWorkspaceManifestLock(f.projectRoot);
    const order: string[] = [];
    const failure = new Error("rejected staged payload");
    const first = withWorkspaceManifestStagedTransaction(f.projectRoot, () => { order.push("first"); throw failure; }).catch(error => error);
    const second = withWorkspaceManifestStagedTransaction(`${f.projectRoot}${path.sep}.`, () => { order.push("second"); return 2; });
    await expect(saveWorkspaceProject(other.created.id, { payload: { version: 9 } }, other.deps)).resolves.toMatchObject({ payload: { version: 9 } });
    expect(order).toEqual([]);
    releaseWorkspaceManifestLock(held);
    await pumpTimers(10);
    expect(await first).toBe(failure);
    expect(await second).toBe(2);
    expect(order).toEqual(["first", "second"]);
    await expect(withWorkspaceManifestStagedTransaction(f.projectRoot, () => "after")).resolves.toBe("after");
  });

  it("reads the latest revision only after acquiring ownership and rejects a mismatched project id", async () => {
    const f = fixture();
    const held = tryAcquireWorkspaceManifestLock(f.projectRoot);
    const saving = saveWorkspaceProject(f.created.id, { payload: { version: 1 } }, f.deps);
    await pumpTimers(5);
    const file = workspaceProjectFile(f.projectRoot);
    const updated = { ...JSON.parse(fs.readFileSync(file, "utf8")), revision: 41 };
    fs.writeFileSync(file, JSON.stringify(updated));
    releaseWorkspaceManifestLock(held);
    await pumpTimers(10);
    await expect(saving).resolves.toMatchObject({ revision: 42, immutableProjectUuid: f.created.immutableProjectUuid });
    fs.writeFileSync(file, JSON.stringify({ ...updated, id: "different-project" }));
    const before = f.bytes();
    await expect(saveWorkspaceProject(f.created.id, { payload: {} }, f.deps)).rejects.toThrow();
    expect(f.bytes()).toEqual(before);
  });

  it("waits for a legitimate owner before reading, backing up, and acknowledging the saved manifest", async () => {
    const f = fixture();
    const held = tryAcquireWorkspaceManifestLock(f.projectRoot);
    const before = f.bytes();
    let acknowledged = false;
    const saving = Promise.resolve().then(() => saveWorkspaceProject(f.created.id, { payload: { version: 1 } }, f.deps)).then(record => { acknowledged = true; return record; });
    await pumpTimers(20);
    expect(acknowledged).toBe(false);
    expect(f.bytes()).toEqual(before);
    releaseWorkspaceManifestLock(held);
    await pumpTimers(10);
    const saved = await saving;
    expect(saved).toMatchObject({ revision: f.created.revision + 1, immutableProjectUuid: f.created.immutableProjectUuid, projectGeneration: f.created.projectGeneration, payload: { version: 1 } });
    expect(JSON.parse(f.bytes()[0]).payload).toEqual({ version: 0 });
    expect(JSON.parse(f.bytes()[1]).payload).toEqual({ version: 1 });
    const nextOwner = tryAcquireWorkspaceManifestLock(f.projectRoot); releaseWorkspaceManifestLock(nextOwner);
  });

  it("preserves request order when newer saves arrive after an external owner releases", async () => {
    const f = fixture();
    const held = tryAcquireWorkspaceManifestLock(f.projectRoot);
    const save = (version: number) => saveWorkspaceProject(f.created.id, { payload: { version } }, f.deps);
    const first = Promise.resolve().then(() => save(1));
    const second = Promise.resolve().then(() => save(2));
    await pumpTimers(5);
    releaseWorkspaceManifestLock(held);
    const third = Promise.resolve().then(() => save(3));
    await pumpTimers(30);
    const saved = await Promise.all([first, second, third]);
    expect(saved.map(record => record.revision)).toEqual([1, 2, 3].map(delta => f.created.revision + delta));
    expect(JSON.parse(f.bytes()[1]).payload).toEqual({ version: 3 });
  });

  it("retries a transient publish failure but retains a permanent failure cause and the old files", async () => {
    const f = fixture();
    const rename = fs.promises.rename.bind(fs.promises);
    const denied = Object.assign(new Error("publish denied without competing owner"), { code: "EPERM" });
    let attempts = 0;
    const spy = vi.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
      if (isPublish(from, to) && ++attempts === 1) throw denied;
      return rename(from, to);
    });
    const saving = waitWithFakeTimers(
      Promise.resolve().then(() => saveWorkspaceProject(f.created.id, { payload: { version: 1 } }, f.deps)),
      10,
    );
    await expect(saving).resolves.toMatchObject({ payload: { version: 1 } });
    expect(attempts).toBe(2);
    const before = f.bytes();
    spy.mockImplementation(async (from, to) => { if (isPublish(from, to)) throw denied; return rename(from, to); });
    const failure = waitWithFakeTimers(
      Promise.resolve().then(() => saveWorkspaceProject(f.created.id, { payload: { version: 2 } }, f.deps)),
      5_010,
    ).catch((error: unknown) => error);
    expect(await failure).toMatchObject({ code: "workspace_manifest_publish_failed", cause: denied });
    expect(f.bytes()).toEqual(before);
  });

  it("validates all staged content before replacing either previous file", async () => {
    const f = fixture();
    const before = f.bytes();
    const cyclic: { nested?: unknown } = {}; cyclic.nested = cyclic;
    await expect(Promise.resolve().then(() => saveWorkspaceProject(f.created.id, { payload: cyclic }, f.deps))).rejects.toThrow();
    expect(f.bytes()).toEqual(before);
  });
});
