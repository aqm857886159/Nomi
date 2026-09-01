import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "../jsonFile";
import { resolveWorkspaceRelativePath, workspaceNomiDir, workspaceProjectBackupFile, workspaceProjectFile } from "./workspacePaths";
import type { WorkspaceSyncInspection } from "../shared/workspaceSyncContracts";
export type { WorkspaceSyncInspection, WorkspaceSyncStatus } from "../shared/workspaceSyncContracts";

export type WorkspaceSyncState = {
  schemaVersion: 1;
  workspaceId: string;
  revision: number;
  contentHash: string;
  writerId: string;
  writtenAt: string;
};

const LOCAL_ASSET_RE = /nomi-local:\/\/asset\/[^/]+\/([^"'\s]+)/g;

function syncStatePath(rootPath: string): string {
  return path.join(workspaceNomiDir(rootPath), "sync-state.json");
}

function contentHash(filePath: string): string | null {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

function referencedAssetPaths(rootPath: string): string[] {
  const manifestPath = workspaceProjectFile(rootPath);
  if (!fs.existsSync(manifestPath)) return [];
  const raw = fs.readFileSync(manifestPath, "utf8");
  const paths = new Set<string>();
  for (const match of raw.matchAll(LOCAL_ASSET_RE)) {
    try {
      paths.add(decodeURIComponent(match[1]));
    } catch {
      paths.add(match[1]);
    }
  }
  return [...paths];
}

export function writeWorkspaceSyncState(rootPath: string, state: WorkspaceSyncState): void {
  writeJsonFileAtomic(syncStatePath(rootPath), state);
}

export function readWorkspaceSyncState(rootPath: string): WorkspaceSyncState | null {
  try {
    const raw = readJsonFile(syncStatePath(rootPath)) as Partial<WorkspaceSyncState>;
    if (raw.schemaVersion !== 1 || typeof raw.workspaceId !== "string" || typeof raw.writerId !== "string") return null;
    if (!Number.isInteger(raw.revision) || typeof raw.contentHash !== "string" || typeof raw.writtenAt !== "string") return null;
    return raw as WorkspaceSyncState;
  } catch {
    return null;
  }
}

export function inspectWorkspaceSync(
  rootPath: string,
  expected?: { revision: number; contentHash: string },
): WorkspaceSyncInspection {
  const manifestPath = workspaceProjectFile(rootPath);
  const manifestExists = fs.existsSync(manifestPath);
  const backupExists = fs.existsSync(workspaceProjectBackupFile(rootPath));
  if (!manifestExists) {
    return {
      status: "corrupt-manifest",
      manifestExists,
      backupExists,
      referencedAssetCount: 0,
      missingAssetCount: 0,
      observedRevision: null,
      lastWriterId: null,
      contentHash: null,
    };
  }

  const observedRevision = (() => {
    try {
      const raw = readJsonFile(manifestPath) as { revision?: unknown };
      return typeof raw.revision === "number" ? raw.revision : 0;
    } catch {
      return null;
    }
  })();
  if (observedRevision === null) {
    return {
      status: "corrupt-manifest",
      manifestExists,
      backupExists,
      referencedAssetCount: 0,
      missingAssetCount: 0,
      observedRevision: null,
      lastWriterId: null,
      contentHash: null,
    };
  }

  const hash = contentHash(manifestPath);
  const references = referencedAssetPaths(rootPath);
  const missingAssetCount = references.filter((relativePath) => {
    try {
      return !fs.existsSync(resolveWorkspaceRelativePath(rootPath, relativePath));
    } catch {
      return true;
    }
  }).length;
  const state = readWorkspaceSyncState(rootPath);
  const changed = Boolean(expected && (expected.revision !== observedRevision || expected.contentHash !== hash));
  return {
    status: changed ? "external-change" : missingAssetCount > 0 ? "missing-assets" : "ready",
    manifestExists,
    backupExists,
    referencedAssetCount: references.length,
    missingAssetCount,
    observedRevision,
    lastWriterId: state?.writerId ?? null,
    contentHash: hash,
  };
}

export function quarantineWorkspaceConflict(rootPath: string, source: "local" | "remote"): string {
  const dir = path.join(workspaceNomiDir(rootPath), "conflicts");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `project-${source}-${Date.now()}.json`);
  fs.copyFileSync(workspaceProjectFile(rootPath), filePath);
  return filePath;
}
