import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";

import { getSettingsRoot } from "../settings/settingsRoot";
import { readSettledWorkspaceIdentity, withWorkspaceManifestMutation } from "./workspaceManifest";
import type { WorkspaceManifestLockOptions } from "./workspaceManifestLock";
import { workspaceProjectFile } from "./workspacePaths";
import { followWorkspaceSyncBaselineAfterOwnWrite } from "./workspaceSyncBaseline";
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
  /** 同步基线所在的设置根；默认 getSettingsRoot()（测试传临时目录）。 */
  settingsRoot?: string;
};

const sha256 = (bytes: Buffer): string => crypto.createHash("sha256").update(bytes).digest("hex");
const canonicalJson = (bytes: Buffer): string | null => {
  try {
    return JSON.stringify(JSON.parse(bytes.toString("utf8")));
  } catch {
    return null;
  }
};

/**
 * 补身份是这台机器自己写的项目文件，不是别处改的：写完让同步基线跟上，否则下次打开项目卡会报
 * 「另一台电脑有新版本」（2026-11-13 打开不写：老项目打开不点就关，第二次打开冒假冲突）。
 * 只在基线就是写前那份时才跟（followWorkspaceSyncBaselineAfterOwnWrite），真冲突照报。
 * 设置根拿不到（测试里没配）或读写失败就不跟——基线只是缓存，不跟 = 维持原样。
 */
async function followSyncBaselineAfterIdentityWrite(
  options: EnsureWorkspaceProjectIdentityOptions,
  manifestPath: string,
  projectId: string,
  beforeHash: string,
): Promise<void> {
  try {
    const settingsRoot = options.settingsRoot ?? getSettingsRoot();
    const after = await fsp.readFile(manifestPath);
    const raw = JSON.parse(after.toString("utf8")) as { revision?: unknown };
    followWorkspaceSyncBaselineAfterOwnWrite(settingsRoot, projectId, {
      beforeHash,
      after: { revision: typeof raw.revision === "number" ? raw.revision : 0, contentHash: sha256(after) },
    });
  } catch {
    // 身份已经落定；基线跟不上只等于今天的样子（下次打开可能提示一次，用户「重新检查」即可采纳），不让补身份失败。
  }
}

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

/**
 * 身份已经落定时的无锁读（判据在 workspaceManifest.readSettledWorkspaceIdentity，与加锁路径同一个 sameCompleteIdentity）。
 * 打开项目每次都要问两遍身份（提交画布读面、打开右侧 Agent）；以前每问一遍都走一次加锁写事务
 * （锁主人文件 + 候选目录 + 锁改名 + 释放，各一次 fsync），读路径在写盘。落定了就不拿锁、不写盘；没落定回加锁路径。
 */
function readSettledWorkspaceProjectIdentity(actualRootPath: string): WorkspaceProjectIdentity | null {
  let canonicalRootPath: string;
  try {
    canonicalRootPath = fs.realpathSync(actualRootPath);
  } catch {
    return null;
  }
  const settled = readSettledWorkspaceIdentity(canonicalRootPath);
  if (!settled) return null;
  return {
    projectId: settled.id,
    immutableProjectUuid: settled.immutableProjectUuid,
    projectGeneration: settled.projectGeneration,
    canonicalRootPath,
    canonicalRootDigest: digestCanonicalRoot(canonicalRootPath),
  };
}

export async function ensureWorkspaceProjectIdentity(
  actualRootPath: string,
  options: EnsureWorkspaceProjectIdentityOptions = {},
): Promise<WorkspaceProjectIdentity> {
  const settled = readSettledWorkspaceProjectIdentity(actualRootPath);
  if (settled) return settled;
  // 写前那份的字节（拿锁前异步读；锁里只比「锁里读到的内容就是它」，对不上就不跟基线）。
  const manifestPath = workspaceProjectFile(actualRootPath);
  const before = await fsp.readFile(manifestPath).catch(() => null);
  const beforeHash = before ? sha256(before) : null;
  const beforeJson = before ? canonicalJson(before) : null;
  const ownWrite: { projectId: string | null } = { projectId: null };
  try {
    const identity = await withWorkspaceManifestMutation(
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

        ownWrite.projectId = beforeJson !== null && JSON.stringify(context.currentRaw) === beforeJson ? context.current.id : null;
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
    if (ownWrite.projectId && beforeHash) await followSyncBaselineAfterIdentityWrite(options, manifestPath, ownWrite.projectId, beforeHash);
    return identity;
  } catch (error) {
    if (error instanceof WorkspaceProjectIdentityUnavailableError) throw error;
    throw identityUnavailable("Workspace project identity could not be completed", error);
  }
}
