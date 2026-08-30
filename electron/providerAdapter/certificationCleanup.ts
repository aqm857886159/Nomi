import path from "node:path";
import { lstat, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";

const MANIFEST = ".cleanup-manifest.json";
const DEFAULT_ACTIVE_LEASE_STALE_MS = 5 * 60_000;
const timers = new Map<string, ReturnType<typeof setInterval>>();
const rootMutations = new Map<string, Promise<void>>();

type CleanupEntry = { id: string; active: boolean; createdAt: number };
type CleanupManifest = { version: 2; entries: CleanupEntry[] };

function manifestPath(root: string): string { return path.join(root, MANIFEST); }

function safeEntry(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)
    || !/^run-[A-Za-z0-9_-]+$/.test(relative)) throw new Error("Unsafe certification cleanup target");
  return relative;
}

async function readManifest(root: string): Promise<CleanupManifest> {
  try {
    const parsed = JSON.parse(await readFile(manifestPath(root), "utf8")) as Partial<CleanupManifest>;
    const safe = new Map<string, CleanupEntry>();
    for (const raw of Array.isArray(parsed.entries) ? parsed.entries : []) {
      if (typeof raw === "string" && /^run-[A-Za-z0-9_-]+$/.test(raw)) {
        safe.set(raw, { id: raw, active: false, createdAt: 0 });
        continue;
      }
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as Partial<CleanupEntry> & { state?: unknown };
      if (!entry.id || !/^run-[A-Za-z0-9_-]+$/.test(entry.id)) continue;
      const active = typeof entry.active === "boolean" ? entry.active : entry.state === "active";
      if (typeof entry.createdAt !== "number" || !Number.isFinite(entry.createdAt) || entry.createdAt < 0) continue;
      safe.set(entry.id, { id: entry.id, active, createdAt: entry.createdAt });
    }
    return { version: 2, entries: [...safe.values()] };
  } catch { return { version: 2, entries: [] }; }
}

async function writeManifest(root: string, manifest: CleanupManifest): Promise<void> {
  if (!manifest.entries.length) {
    await unlink(manifestPath(root)).catch(() => undefined);
    return;
  }
  const temporary = path.join(root, `.cleanup-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(manifest), { flag: "wx", mode: 0o600 });
    await rename(temporary, manifestPath(root));
  } finally { await unlink(temporary).catch(() => undefined); }
}

async function withRootMutation<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = rootMutations.get(root) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => undefined).then(() => gate);
  rootMutations.set(root, queued);
  await previous.catch(() => undefined);
  try { return await operation(); }
  finally {
    release();
    if (rootMutations.get(root) === queued) rootMutations.delete(root);
  }
}

async function mutateManifest(root: string, update: (manifest: CleanupManifest) => CleanupManifest | Promise<CleanupManifest>): Promise<void> {
  await withRootMutation(root, async () => writeManifest(root, await update(await readManifest(root))));
}

/** Register before any provider-controlled bytes are written into the run directory. */
export async function registerCertificationCleanupLease(root: string, target: string, nowMs = Date.now()): Promise<void> {
  const id = safeEntry(root, target);
  await mutateManifest(root, (manifest) => ({
    version: 2,
    entries: [...manifest.entries.filter((entry) => entry.id !== id), { id, active: true, createdAt: nowMs }],
  }));
}

/** Remove a lease only after the corresponding run directory has actually been removed. */
export async function completeCertificationCleanupLease(root: string, target: string): Promise<void> {
  const id = safeEntry(root, target);
  await mutateManifest(root, (manifest) => ({ version: 2, entries: manifest.entries.filter((entry) => entry.id !== id) }));
}

export async function recordCertificationCleanupFailure(root: string, target: string): Promise<void> {
  const id = safeEntry(root, target);
  await mutateManifest(root, (manifest) => {
    const existing = manifest.entries.find((entry) => entry.id === id);
    return {
      version: 2,
      entries: [...manifest.entries.filter((entry) => entry.id !== id), {
        id, active: false, createdAt: existing?.createdAt ?? Date.now(),
      }],
    };
  });
  scheduleCertificationCleanupRecovery(root);
}

export async function retryCertificationCleanup(
  root: string,
  cleanup: (target: string) => Promise<void> = (target) => rm(target, { recursive: true, force: true }),
  options: { nowMs?: number; activeLeaseStaleMs?: number } = {},
): Promise<number> {
  return withRootMutation(root, async () => {
    const manifest = await readManifest(root);
    const nowMs = options.nowMs ?? Date.now();
    const staleMs = options.activeLeaseStaleMs ?? DEFAULT_ACTIVE_LEASE_STALE_MS;
    const remaining: CleanupEntry[] = [];
    for (const entry of manifest.entries) {
      if (entry.active && nowMs - entry.createdAt < staleMs) {
        remaining.push(entry);
        continue;
      }
      const target = path.join(root, entry.id);
      try {
        const info = await lstat(target).catch(() => null);
        if (info?.isSymbolicLink()) throw new Error("Unsafe cleanup target");
        await cleanup(target);
      } catch { remaining.push({ ...entry, active: false }); }
    }
    await writeManifest(root, { version: 2, entries: remaining });
    if (!remaining.length) {
      const timer = timers.get(root);
      if (timer) clearInterval(timer);
      timers.delete(root);
    } else scheduleCertificationCleanupRecovery(root);
    return remaining.length;
  });
}

export function scheduleCertificationCleanupRecovery(root: string): void {
  if (timers.has(root)) return;
  const timer = setInterval(() => retryCertificationCleanup(root).catch(() => undefined), 60_000);
  timer.unref?.();
  timers.set(root, timer);
}
