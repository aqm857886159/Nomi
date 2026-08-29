import fs from "node:fs";
import path from "node:path";

import { isDurable } from "../durability";
import { writeJsonFileAtomic } from "../jsonFile";
import type { ProjectBinding } from "../shared/projectBinding";
import { assertProjectAgentBinding } from "./projectAgentIdentity";

export const PROJECT_AGENT_CUTOVER_SCHEMA_VERSION = 1 as const;
export const PROJECT_AGENT_CUTOVER_MANIFEST_FILE = "project-agent-cutover.json" as const;
export const PROJECT_AGENT_CUTOVER_PREPARATION_FILE = "project-agent-cutover-preparation.json" as const;
export const PROJECT_AGENT_CUTOVER_LOCK_FILE = "project-agent-cutover.lock" as const;
export const PROJECT_AGENT_CUTOVER_LOCK_STALE_MS = 5 * 60 * 1000;

export type ProjectAgentCutoverSources = Readonly<{
  conversationsHash: string;
  contextHash: string;
  proposalReceiptHash: string;
}>;

export type ProjectAgentCutoverManifest = Readonly<{
  schemaVersion: typeof PROJECT_AGENT_CUTOVER_SCHEMA_VERSION;
  mode: "archive-only";
  binding: ProjectBinding;
  sources: ProjectAgentCutoverSources;
  completedAt: string;
}>;

export type ProjectAgentCutoverPreparation = Readonly<{
  schemaVersion: typeof PROJECT_AGENT_CUTOVER_SCHEMA_VERSION;
  mode: "archive-only";
  binding: ProjectBinding;
  sources: ProjectAgentCutoverSources;
  startedAt: string;
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

export function projectAgentCutoverPreparationPath(projectRoot: string): string {
  return path.join(nomiDir(projectRoot), PROJECT_AGENT_CUTOVER_PREPARATION_FILE);
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
  if (
    raw.schemaVersion !== PROJECT_AGENT_CUTOVER_SCHEMA_VERSION ||
    raw.mode !== "archive-only" ||
    !sources ||
    typeof sources !== "object" ||
    !validHash((sources as Record<string, unknown>).conversationsHash) ||
    !validHash((sources as Record<string, unknown>).contextHash) ||
    !validHash((sources as Record<string, unknown>).proposalReceiptHash) ||
    typeof raw.completedAt !== "string"
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: PROJECT_AGENT_CUTOVER_SCHEMA_VERSION,
    mode: "archive-only",
    binding: Object.freeze({ ...binding }),
    sources: Object.freeze({ ...(sources as ProjectAgentCutoverManifest["sources"]) }),
    completedAt: raw.completedAt,
  });
}

function parsePreparation(value: unknown): ProjectAgentCutoverPreparation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const binding = raw.binding as ProjectBinding;
  try {
    assertProjectAgentBinding(binding);
  } catch {
    return null;
  }
  const sources = raw.sources;
  if (
    raw.schemaVersion !== PROJECT_AGENT_CUTOVER_SCHEMA_VERSION ||
    raw.mode !== "archive-only" ||
    !sources ||
    typeof sources !== "object" ||
    !validHash((sources as Record<string, unknown>).conversationsHash) ||
    !validHash((sources as Record<string, unknown>).contextHash) ||
    !validHash((sources as Record<string, unknown>).proposalReceiptHash) ||
    typeof raw.startedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.startedAt))
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: PROJECT_AGENT_CUTOVER_SCHEMA_VERSION,
    mode: "archive-only",
    binding: Object.freeze({ ...binding }),
    sources: Object.freeze({ ...(sources as ProjectAgentCutoverSources) }),
    startedAt: raw.startedAt,
  });
}

function fsyncNomiDirectory(projectRoot: string): void {
  if (!isDurable()) return;
  let fd: number | undefined;
  try {
    fd = fs.openSync(nomiDir(projectRoot), fs.constants.O_RDONLY);
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function assertSourcesMatch(left: ProjectAgentCutoverSources, right: ProjectAgentCutoverSources): void {
  if (
    left.conversationsHash !== right.conversationsHash ||
    left.contextHash !== right.contextHash ||
    left.proposalReceiptHash !== right.proposalReceiptHash
  ) {
    throw new ProjectAgentCutoverError("Legacy source bytes changed during Project Agent cutover");
  }
}

export function readProjectAgentCutoverManifest(projectRoot: string): ProjectAgentCutoverManifest | null {
  const filePath = projectAgentCutoverManifestPath(projectRoot);
  try {
    const manifest = parseManifest(JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown);
    if (!manifest) throw new ProjectAgentCutoverError(`Project Agent cutover manifest is invalid: ${filePath}`);
    return manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof ProjectAgentCutoverError) throw error;
    throw new ProjectAgentCutoverError(`Project Agent cutover manifest is unreadable: ${filePath}`, { cause: error });
  }
}

export function assertCutoverMatches(manifest: ProjectAgentCutoverManifest, binding: ProjectBinding): void {
  if (!sameBinding(manifest.binding, binding))
    throw new ProjectAgentCutoverError("Project Agent cutover binding changed");
}

export function assertCutoverPreparationMatches(
  preparation: ProjectAgentCutoverPreparation,
  binding: ProjectBinding,
  sources: ProjectAgentCutoverSources,
): void {
  if (!sameBinding(preparation.binding, binding)) {
    throw new ProjectAgentCutoverError("Project Agent cutover preparation binding changed");
  }
  assertSourcesMatch(preparation.sources, sources);
}

export function readOrCreateProjectAgentCutoverPreparation(
  projectRoot: string,
  binding: ProjectBinding,
  sources: ProjectAgentCutoverSources,
  startedAt: string,
): ProjectAgentCutoverPreparation {
  const filePath = projectAgentCutoverPreparationPath(projectRoot);
  let existing: ProjectAgentCutoverPreparation | null = null;
  try {
    if (fs.existsSync(filePath)) {
      existing = parsePreparation(JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown);
      if (!existing) throw new ProjectAgentCutoverError(`Project Agent cutover preparation is invalid: ${filePath}`);
    }
  } catch (error) {
    if (error instanceof ProjectAgentCutoverError) throw error;
    throw new ProjectAgentCutoverError(`Project Agent cutover preparation is unreadable: ${filePath}`, {
      cause: error,
    });
  }
  if (existing) {
    assertCutoverPreparationMatches(existing, binding, sources);
    return existing;
  }

  const preparation = parsePreparation({
    schemaVersion: PROJECT_AGENT_CUTOVER_SCHEMA_VERSION,
    mode: "archive-only",
    binding,
    sources,
    startedAt,
  });
  if (!preparation) throw new ProjectAgentCutoverError("Project Agent cutover preparation is invalid");
  writeJsonFileAtomic(filePath, preparation, { mode: 0o600 });
  fsyncNomiDirectory(projectRoot);
  return preparation;
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
      if (pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (probeError) {
          stale = (probeError as NodeJS.ErrnoException).code === "ESRCH";
        }
      } else if (age >= PROJECT_AGENT_CUTOVER_LOCK_STALE_MS) {
        stale = true;
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
  fsyncNomiDirectory(projectRoot);
}
