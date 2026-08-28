import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { writeJsonFileAtomic } from "../jsonFile";
import type { ProjectBinding } from "../shared/projectBinding";
import { assertProjectAgentBinding } from "./projectAgentIdentity";

export const PROJECT_AGENT_CUTOVER_SCHEMA_VERSION = 1 as const;
export const PROJECT_AGENT_CUTOVER_MANIFEST_FILE = "project-agent-cutover.json" as const;
export const PROJECT_AGENT_CUTOVER_LOCK_FILE = "project-agent-cutover.lock" as const;
export const PROJECT_AGENT_CUTOVER_LOCK_STALE_MS = 5 * 60 * 1000;

export type ProjectAgentCutoverManifest = Readonly<{
  schemaVersion: typeof PROJECT_AGENT_CUTOVER_SCHEMA_VERSION;
  binding: ProjectBinding;
  sources: Readonly<{
    conversationsHash: string;
    contextHash: string;
    proposalHash: string;
  }>;
  imported: Readonly<{ creationThreads: number; generationThreads: number; messageCount: number }>;
  completedAt: string;
}>;

export class ProjectAgentCutoverError extends Error {
  readonly code = "project_agent_cutover_unavailable" as const;
}

function nomiDir(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".nomi");
}

export function projectAgentCutoverManifestPath(projectRoot: string): string {
  return path.join(nomiDir(projectRoot), PROJECT_AGENT_CUTOVER_MANIFEST_FILE);
}

export function projectAgentCutoverLockPath(projectRoot: string): string {
  return path.join(nomiDir(projectRoot), PROJECT_AGENT_CUTOVER_LOCK_FILE);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function sameBinding(left: ProjectBinding, right: ProjectBinding): boolean {
  return (
    left.projectId === right.projectId &&
    left.immutableProjectUuid === right.immutableProjectUuid &&
    left.projectGeneration === right.projectGeneration
  );
}

function parseManifest(value: unknown): ProjectAgentCutoverManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const binding = raw.binding as ProjectBinding;
  try {
    assertProjectAgentBinding(binding);
  } catch {
    return null;
  }
  const sources = raw.sources;
  const imported = raw.imported;
  if (
    raw.schemaVersion !== PROJECT_AGENT_CUTOVER_SCHEMA_VERSION ||
    !sources ||
    typeof sources !== "object" ||
    !validHash((sources as Record<string, unknown>).conversationsHash) ||
    !validHash((sources as Record<string, unknown>).contextHash) ||
    !validHash((sources as Record<string, unknown>).proposalHash) ||
    !imported ||
    typeof imported !== "object" ||
    !Number.isSafeInteger((imported as Record<string, unknown>).creationThreads) ||
    !Number.isSafeInteger((imported as Record<string, unknown>).generationThreads) ||
    !Number.isSafeInteger((imported as Record<string, unknown>).messageCount) ||
    typeof raw.completedAt !== "string"
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: PROJECT_AGENT_CUTOVER_SCHEMA_VERSION,
    binding: Object.freeze({ ...binding }),
    sources: Object.freeze({ ...(sources as ProjectAgentCutoverManifest["sources"]) }),
    imported: Object.freeze({ ...(imported as ProjectAgentCutoverManifest["imported"]) }),
    completedAt: raw.completedAt,
  });
}

export function readProjectAgentCutoverManifest(projectRoot: string): ProjectAgentCutoverManifest | null {
  const filePath = projectAgentCutoverManifestPath(projectRoot);
  try {
    return parseManifest(JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ProjectAgentCutoverError(`Project Agent cutover manifest is unreadable: ${filePath}`, { cause: error });
  }
}

export function assertCutoverMatches(
  manifest: ProjectAgentCutoverManifest,
  binding: ProjectBinding,
  sources: ProjectAgentCutoverManifest["sources"],
): void {
  if (!sameBinding(manifest.binding, binding))
    throw new ProjectAgentCutoverError("Project Agent cutover binding changed");
  if (
    manifest.sources.conversationsHash !== sources.conversationsHash ||
    manifest.sources.contextHash !== sources.contextHash ||
    manifest.sources.proposalHash !== sources.proposalHash
  ) {
    throw new ProjectAgentCutoverError("Legacy source bytes changed after Project Agent cutover");
  }
}

export function withProjectAgentCutoverLock<T>(projectRoot: string, fn: () => T): T {
  const directory = nomiDir(projectRoot);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockPath = projectAgentCutoverLockPath(projectRoot);
  let fd: number;
  try {
    fd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // A process dying while holding O_EXCL leaves the marker behind. Only a
    // demonstrably old marker whose pid is no longer alive is recoverable;
    // recent or live markers remain a hard conflict.
    let stale = false;
    try {
      const stat = fs.statSync(lockPath);
      let startedAt = stat.mtimeMs;
      let pid = 0;
      try {
        const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { pid?: unknown; startedAt?: unknown };
        pid = typeof parsed.pid === "number" && Number.isSafeInteger(parsed.pid) ? parsed.pid : 0;
        if (typeof parsed.startedAt === "number" && Number.isFinite(parsed.startedAt)) startedAt = parsed.startedAt;
      } catch {
        // A legacy/plain lock with an old mtime is also recoverable.
      }
      const age = Date.now() - startedAt;
      if (age >= PROJECT_AGENT_CUTOVER_LOCK_STALE_MS) {
        if (pid > 0) {
          try {
            process.kill(pid, 0);
          } catch (probeError) {
            stale = (probeError as NodeJS.ErrnoException).code === "ESRCH";
          }
        } else {
          stale = true;
        }
      }
    } catch (probeError) {
      if ((probeError as NodeJS.ErrnoException).code === "ENOENT") stale = true;
    }
    if (!stale) throw new ProjectAgentCutoverError("Project Agent cutover is already running", { cause: error });
    try {
      fs.rmSync(lockPath, { force: true });
      fd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    } catch (retryError) {
      if ((retryError as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ProjectAgentCutoverError("Project Agent cutover is already running", { cause: retryError });
      }
      throw retryError;
    }
  }
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), undefined, "utf8");
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lockPath, { force: true });
  }
}

export function writeProjectAgentCutoverManifest(projectRoot: string, manifest: ProjectAgentCutoverManifest): void {
  const canonical = parseManifest(manifest);
  if (!canonical) throw new ProjectAgentCutoverError("Project Agent cutover manifest is invalid");
  writeJsonFileAtomic(projectAgentCutoverManifestPath(projectRoot), canonical, { mode: 0o600 });
  let fd: number | undefined;
  try {
    fd = fs.openSync(nomiDir(projectRoot), fs.constants.O_RDONLY);
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function hashCutoverProposal(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}
