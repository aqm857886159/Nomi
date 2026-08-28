import path from "node:path";
import { lstat, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";

const MANIFEST = ".cleanup-manifest.json";
const timers = new Map<string, ReturnType<typeof setInterval>>();

type CleanupManifest = { version: 1; entries: string[] };

function manifestPath(root: string): string {
  return path.join(root, MANIFEST);
}

function safeEntry(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error("Unsafe certification cleanup target");
  }
  return relative;
}

async function readManifest(root: string): Promise<CleanupManifest> {
  try {
    const parsed = JSON.parse(await readFile(manifestPath(root), "utf8")) as Partial<CleanupManifest>;
    return {
      version: 1,
      entries: Array.isArray(parsed.entries)
        ? [...new Set(parsed.entries.filter((entry): entry is string => typeof entry === "string" && /^run-[A-Za-z0-9_-]+$/.test(entry)))]
        : [],
    };
  } catch {
    return { version: 1, entries: [] };
  }
}

async function writeManifest(root: string, manifest: CleanupManifest): Promise<void> {
  if (!manifest.entries.length) {
    await unlink(manifestPath(root)).catch(() => undefined);
    return;
  }
  const temporary = path.join(root, `.cleanup-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temporary, JSON.stringify(manifest), { flag: "wx", mode: 0o600 });
  await rename(temporary, manifestPath(root));
}

export async function recordCertificationCleanupFailure(root: string, target: string): Promise<void> {
  const entry = safeEntry(root, target);
  const manifest = await readManifest(root);
  if (!manifest.entries.includes(entry)) manifest.entries.push(entry);
  await writeManifest(root, manifest);
  scheduleCertificationCleanupRecovery(root);
}

export async function retryCertificationCleanup(
  root: string,
  cleanup: (target: string) => Promise<void> = (target) => rm(target, { recursive: true, force: true }),
): Promise<number> {
  const manifest = await readManifest(root);
  const pending: string[] = [];
  for (const entry of manifest.entries) {
    const target = path.join(root, entry);
    try {
      const info = await lstat(target).catch(() => null);
      if (info?.isSymbolicLink()) throw new Error("Unsafe cleanup target");
      await cleanup(target);
    } catch {
      pending.push(entry);
    }
  }
  await writeManifest(root, { version: 1, entries: pending });
  if (!pending.length) {
    const timer = timers.get(root);
    if (timer) clearInterval(timer);
    timers.delete(root);
  }
  return pending.length;
}

export function scheduleCertificationCleanupRecovery(root: string): void {
  if (timers.has(root)) return;
  const timer = setInterval(() => void retryCertificationCleanup(root).catch(() => undefined), 60_000);
  timer.unref?.();
  timers.set(root, timer);
}
