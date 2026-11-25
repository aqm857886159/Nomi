import fs from "node:fs";

import {
  createDirectoryLeaseLock,
  DIRECTORY_LEASE_SCHEMA_VERSION,
  type DirectoryLease,
  type DirectoryLeaseOptions,
  type DirectoryLeaseOwner,
} from "../shared/fileLeaseLock";
import { WORKSPACE_MANIFEST_BUSY_ERROR_NAME } from "../shared/contracts/workspaceBusy";
import { workspaceNomiDir } from "./workspacePaths";

export const WORKSPACE_MANIFEST_LOCK_SCHEMA_VERSION = DIRECTORY_LEASE_SCHEMA_VERSION;
const DEFAULT_RETRY_DELAY_MS = 10;
const DEFAULT_WAIT_TIMEOUT_MS = 5_000;

export type WorkspaceManifestLockOwner = DirectoryLeaseOwner;
export type WorkspaceManifestLockLease = DirectoryLease & { canonicalRootPath: string };
export type WorkspaceManifestLockOptions = DirectoryLeaseOptions & {
  retryDelayMs?: number;
  waitTimeoutMs?: number;
};

export class WorkspaceManifestLockBusyError extends Error {
  readonly code = "workspace_manifest_busy";

  constructor(message = "Workspace manifest is being changed by another process", options?: { cause?: unknown }) {
    super(message);
    // 名字是跨进程身份：渲染层只拿得到「名字: 信息」，据此报「项目正被别处占用」（见 shared/contracts/workspaceBusy）。
    this.name = WORKSPACE_MANIFEST_BUSY_ERROR_NAME;
    if (options) Object.defineProperty(this, "cause", { configurable: true, value: options.cause });
  }
}

export class WorkspaceManifestLockPublishError extends Error {
  readonly code = "workspace_manifest_publish_failed";

  constructor(cause: unknown) {
    super("Workspace manifest lock could not be published");
    this.name = "WorkspaceManifestLockPublishError";
    Object.defineProperty(this, "cause", { configurable: true, value: cause });
  }
}

/**
 * 取锁时项目根已经不在（被删 / 被挪走）。不可重试：等多久根也不会自己回来，而重试时建目录会凭空造出一个
 * 没清单、没登记的孤儿根（V-plibrary N1）。取锁只在「根已在」的前提下建 .nomi，结构上不再创建项目根。
 */
export class WorkspaceRootMissingError extends Error {
  readonly code = "workspace_root_missing";

  constructor(rootPath: string, options?: { cause?: unknown }) {
    super(`Workspace project folder no longer exists: ${rootPath}`);
    this.name = "WorkspaceRootMissingError";
    if (options) Object.defineProperty(this, "cause", { configurable: true, value: options.cause });
  }
}

export class WorkspaceManifestLockLostError extends Error {
  readonly code = "workspace_manifest_lock_lost";

  constructor(message = "Workspace manifest lock is no longer owned", options?: { cause?: unknown }) {
    super(message);
    this.name = "WorkspaceManifestLockLostError";
    if (options && Object.prototype.hasOwnProperty.call(options, "cause")) {
      Object.defineProperty(this, "cause", { configurable: true, value: options.cause });
    }
  }
}

const lock = createDirectoryLeaseLock({
  stem: "manifest-transaction",
  ownerPrefix: "workspace",
  label: "Workspace manifest",
  errors: {
    busy: (message, options) => new WorkspaceManifestLockBusyError(message, options),
    lost: (message, options) => new WorkspaceManifestLockLostError(message, options),
    publish: (cause) => new WorkspaceManifestLockPublishError(cause),
  },
});

function canonicalWorkspaceRoot(actualRootPath: string): string {
  const canonical = fs.realpathSync(actualRootPath);
  if (!fs.statSync(canonical).isDirectory()) {
    throw new Error("Workspace root must be a directory");
  }
  return canonical;
}

function tryAcquireCanonicalWorkspaceManifestLock(
  canonicalRootPath: string,
  options: WorkspaceManifestLockOptions,
): WorkspaceManifestLockLease {
  const nomiDir = workspaceNomiDir(canonicalRootPath);
  // 只建 .nomi、不递归：根没了就是没了（ENOENT），绝不在这里把项目根重新建出来。
  try {
    fs.mkdirSync(nomiDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") throw new WorkspaceRootMissingError(canonicalRootPath, { cause: error });
    if (code !== "EEXIST") throw error;
  }
  return { canonicalRootPath, ...lock.acquire(nomiDir, options) };
}

export function tryAcquireWorkspaceManifestLock(
  actualRootPath: string,
  options: WorkspaceManifestLockOptions = {},
): WorkspaceManifestLockLease {
  return tryAcquireCanonicalWorkspaceManifestLock(canonicalWorkspaceRoot(actualRootPath), options);
}

export async function acquireWorkspaceManifestLock(
  actualRootPath: string,
  options: WorkspaceManifestLockOptions = {},
): Promise<WorkspaceManifestLockLease> {
  const canonicalRootPath = canonicalWorkspaceRoot(actualRootPath);
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + waitTimeoutMs;
  for (;;) {
    try {
      return tryAcquireCanonicalWorkspaceManifestLock(canonicalRootPath, options);
    } catch (error) {
      if (!(error instanceof WorkspaceManifestLockBusyError || error instanceof WorkspaceManifestLockPublishError) || Date.now() >= deadline) {
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

export function assertWorkspaceManifestLockOwned(lease: WorkspaceManifestLockLease): void {
  lock.assertOwned(lease);
}

export function releaseWorkspaceManifestLock(lease: WorkspaceManifestLockLease): void {
  lock.release(lease);
}
