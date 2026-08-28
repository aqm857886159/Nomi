import crypto from "node:crypto";
import fs from "node:fs";

import { withWorkspaceManifestMutation } from "./workspaceManifest";
import type { WorkspaceManifestLockOptions } from "./workspaceManifestLock";
import { WorkspaceProjectIdentityUnavailableError, type WorkspaceProjectRecordV2 } from "./workspaceTypes";

export { WorkspaceProjectIdentityUnavailableError } from "./workspaceTypes";

type IdentityCompleteWorkspaceRecord = WorkspaceProjectRecordV2 & {
  immutableProjectUuid: string;
  projectGeneration: number;
};

export type WorkspaceProjectIdentity = {
  projectId: string;
  immutableProjectUuid: string;
  projectGeneration: number;
  canonicalRootPath: string;
  canonicalRootDigest: string;
};

export type EnsureWorkspaceProjectIdentityOptions = {
  randomUuid?: () => string;
  lockOptions?: WorkspaceManifestLockOptions;
};

function identityUnavailable(message: string, cause?: unknown): WorkspaceProjectIdentityUnavailableError {
  return new WorkspaceProjectIdentityUnavailableError(message, cause === undefined ? undefined : { cause });
}

function digestCanonicalRoot(canonicalRootPath: string): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalRootPath)).digest("hex");
}

export function deriveCanonicalWorkspaceRootIdentity(actualRootPath: string): {
  canonicalRootPath: string;
  canonicalRootDigest: string;
} {
  try {
    const canonicalRootPath = fs.realpathSync(actualRootPath);
    if (!fs.statSync(canonicalRootPath).isDirectory()) {
      throw new Error("Workspace root is not a directory");
    }
    return {
      canonicalRootPath,
      canonicalRootDigest: digestCanonicalRoot(canonicalRootPath),
    };
  } catch (error) {
    throw identityUnavailable("Workspace project root identity is unavailable", error);
  }
}

function requireCompleteOrLegacy(record: WorkspaceProjectRecordV2): IdentityCompleteWorkspaceRecord | null {
  const hasUuid = typeof record.immutableProjectUuid === "string" && record.immutableProjectUuid.length > 0;
  const hasGeneration = Number.isSafeInteger(record.projectGeneration) && (record.projectGeneration ?? 0) > 0;
  if (hasUuid !== hasGeneration) {
    throw identityUnavailable("Workspace project identity is only partially present");
  }
  return hasUuid && hasGeneration ? (record as IdentityCompleteWorkspaceRecord) : null;
}

function projectIdentity(record: IdentityCompleteWorkspaceRecord, canonicalRootPath: string): WorkspaceProjectIdentity {
  return {
    projectId: record.id,
    immutableProjectUuid: record.immutableProjectUuid,
    projectGeneration: record.projectGeneration,
    canonicalRootPath,
    canonicalRootDigest: digestCanonicalRoot(canonicalRootPath),
  };
}

export async function ensureWorkspaceProjectIdentity(
  actualRootPath: string,
  options: EnsureWorkspaceProjectIdentityOptions = {},
): Promise<WorkspaceProjectIdentity> {
  try {
    return await withWorkspaceManifestMutation(
      actualRootPath,
      (context) => {
        if (!context.current || !context.currentRaw) {
          throw identityUnavailable("Workspace project manifest is unavailable");
        }

        const mainIdentity = requireCompleteOrLegacy(context.current);
        const backupIdentity = context.currentBackup ? requireCompleteOrLegacy(context.currentBackup) : null;

        if (mainIdentity) {
          if (!backupIdentity) {
            context.replaceBackup({
              ...(context.currentBackupRaw ?? context.currentRaw),
              immutableProjectUuid: mainIdentity.immutableProjectUuid,
              projectGeneration: mainIdentity.projectGeneration,
            });
          }
          return projectIdentity(mainIdentity, context.canonicalRootPath);
        }

        const selectedIdentity = backupIdentity ?? {
          ...context.current,
          immutableProjectUuid: (options.randomUuid ?? (() => crypto.randomUUID()))(),
          projectGeneration: 1,
        };
        if (!backupIdentity) {
          context.replaceBackup({
            ...(context.currentBackupRaw ?? context.currentRaw),
            immutableProjectUuid: selectedIdentity.immutableProjectUuid,
            projectGeneration: selectedIdentity.projectGeneration,
          });
        }
        const persisted = context.replace({
          ...context.currentRaw,
          immutableProjectUuid: selectedIdentity.immutableProjectUuid,
          projectGeneration: selectedIdentity.projectGeneration,
        });
        const persistedComplete = requireCompleteOrLegacy(persisted);
        if (
          !persistedComplete ||
          persistedComplete.immutableProjectUuid !== selectedIdentity.immutableProjectUuid ||
          persistedComplete.projectGeneration !== selectedIdentity.projectGeneration
        ) {
          throw identityUnavailable("Workspace project identity did not persist atomically");
        }
        return projectIdentity(persistedComplete, context.canonicalRootPath);
      },
      options.lockOptions,
      { localizeEmbeddedMedia: false },
    );
  } catch (error) {
    if (error instanceof WorkspaceProjectIdentityUnavailableError) throw error;
    throw identityUnavailable("Workspace project identity could not be completed", error);
  }
}
