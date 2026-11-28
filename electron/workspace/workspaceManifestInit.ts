import crypto from "node:crypto";
import path from "node:path";

import type { WorkspaceManifestMutationContext } from "./workspaceManifest";
import type { WorkspaceProjectRecordV2 } from "./workspaceTypes";

export type InitializeWorkspaceInput = {
  id?: string;
  name?: string;
  seedKey?: string;
  draft?: boolean;
  payload?: unknown;
};

type ManifestIdentityView =
  | { state: "none" }
  | { state: "partial" }
  | { state: "complete"; immutableProjectUuid: string; projectGeneration: number };

function workspaceId(): string {
  return `workspace-${crypto.randomUUID()}`;
}

export function applyInitializeWorkspace(
  context: WorkspaceManifestMutationContext,
  rootPath: string,
  input: InitializeWorkspaceInput,
  readIdentity: (record: Record<string, unknown> | null) => ManifestIdentityView,
): WorkspaceProjectRecordV2 {
  if (context.current && context.currentRaw) {
    const mainIdentity = readIdentity(context.currentRaw as Record<string, unknown>);
    const backupIdentity = readIdentity(context.currentBackupRaw as Record<string, unknown> | null);
    if (mainIdentity.state === "none" && backupIdentity.state === "complete") {
      return context.replace(context.currentRaw as Record<string, unknown>);
    }
    if (!context.currentBackupRaw) {
      context.replaceBackup(context.currentRaw as Record<string, unknown>);
    } else if (mainIdentity.state === "complete" && backupIdentity.state === "none") {
      context.replaceBackup({
        ...context.currentBackupRaw,
        immutableProjectUuid: mainIdentity.immutableProjectUuid,
        projectGeneration: mainIdentity.projectGeneration,
      });
    }
    return context.current;
  }

  if (context.currentBackup && context.currentBackupRaw) {
    const requestedId = input.id?.trim();
    if (requestedId && requestedId !== context.currentBackup.id) {
      throw new Error("Staged workspace backup belongs to a different project");
    }
    const backupIdentity = readIdentity(context.currentBackupRaw as Record<string, unknown>);
    const staged: Record<string, unknown> =
      backupIdentity.state === "complete"
        ? { ...context.currentBackupRaw }
        : {
            ...context.currentBackupRaw,
            immutableProjectUuid: crypto.randomUUID(),
            projectGeneration: 1,
          };
    if (backupIdentity.state !== "complete") context.replaceBackup(staged);
    return context.replace(staged);
  }

  const now = Date.now();
  const candidate = {
    id: input.id?.trim() || workspaceId(),
    name: input.name?.trim() || path.basename(context.canonicalRootPath) || "Untitled Workspace",
    version: 2,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    revision: 0,
    immutableProjectUuid: crypto.randomUUID(),
    projectGeneration: 1,
    // This remains a user-facing locator only. Locking and identity always use
    // context.canonicalRootPath and never trust this persisted hint.
    lastKnownRootPath: path.resolve(rootPath),
    ...(input.seedKey?.trim() ? { seedKey: input.seedKey.trim() } : {}),
    ...(input.draft === true ? { draft: true } : {}),
    payload: input.payload,
  } satisfies WorkspaceProjectRecordV2;
  context.replaceBackup(candidate);
  return context.replace(candidate);
}
