import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { extensionFromMime, localAssetUrl } from "../assets/assetPaths";
import { parseDataUrl } from "../assets/assetBytes";
import { readJsonFile } from "../jsonFile";
import {
  withWorkspaceManifestTransaction,
  withWorkspaceManifestTransactionSync,
  type WorkspaceManifestTransaction,
} from "./workspaceManifestTransaction";
import { WorkspaceManifestLockBusyError, type WorkspaceManifestLockOptions } from "./workspaceManifestLock";
import {
  workspaceAssetsGeneratedDir,
  workspaceAssetsImportedDir,
  workspaceExportsDir,
  workspaceNomiDir,
  workspaceProjectBackupFile,
  workspaceProjectFile,
  workspaceProjectQuarantineFile,
} from "./workspacePaths";
import {
  normalizeWorkspaceProjectRecord,
  workspaceProjectRecordSchema,
  WorkspaceProjectIdentityUnavailableError,
  type WorkspaceProjectRecordV2,
} from "./workspaceTypes";
import { logWarn } from "../logging/logger";

function workspaceId(): string {
  return `workspace-${crypto.randomUUID()}`;
}

type TopLevelFieldsOptions = {
  keys: string[];
  stopBeforeKeys?: string[];
};

type ManifestState = {
  raw: Record<string, unknown>;
  record: WorkspaceProjectRecordV2;
};

type ManifestIdentity =
  | { state: "none" }
  | { state: "partial" }
  | { state: "complete"; immutableProjectUuid: string; projectGeneration: number };

export type WorkspaceManifestMutationContext = {
  canonicalRootPath: string;
  current: WorkspaceProjectRecordV2 | null;
  currentRaw: Readonly<Record<string, unknown>> | null;
  currentBackup: WorkspaceProjectRecordV2 | null;
  currentBackupRaw: Readonly<Record<string, unknown>> | null;
  readProjectJsonWithEmbeddedMediaSlimming: (filePath: string) => unknown | null;
  replaceBackup: (record: WorkspaceProjectRecordV2 | Record<string, unknown>) => WorkspaceProjectRecordV2;
  replace: (next: WorkspaceProjectRecordV2 | Record<string, unknown>) => WorkspaceProjectRecordV2;
};

export type WorkspaceManifestMutationOptions = {
  localizeEmbeddedMedia?: boolean;
};

function isDataMediaUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:(image|video|audio)\//i.test(value);
}

function toProjectRecordObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isWorkspaceBoundaryError(error: unknown): boolean {
  return error instanceof Error && /inside the selected workspace/i.test(error.message);
}

function uniqueEmbeddedAssetPath(
  rootPath: string,
  fileName: string,
  transaction: WorkspaceManifestTransaction,
): { absolutePath: string; relativePath: string } {
  const assetDir = workspaceAssetsGeneratedDir(rootPath);
  const parsed = path.parse(fileName);
  const base = parsed.name || "embedded";
  const ext = parsed.ext || ".bin";
  let absolutePath = path.join(assetDir, `${base}${ext}`);
  for (let index = 2; transaction.exists(absolutePath); index += 1) {
    absolutePath = path.join(assetDir, `${base}-${index}${ext}`);
  }
  return {
    absolutePath,
    relativePath: path.relative(rootPath, absolutePath).replace(/\\/g, "/"),
  };
}

function localizeEmbeddedDataUrl(
  rootPath: string,
  projectId: string,
  dataUrl: string,
  index: number,
  transaction: WorkspaceManifestTransaction,
): string {
  const parsed = parseDataUrl(dataUrl);
  const ext = extensionFromMime(parsed.contentType, "bin");
  const { absolutePath, relativePath } = uniqueEmbeddedAssetPath(
    rootPath,
    `embedded-${Date.now()}-${index}.${ext}`,
    transaction,
  );
  transaction.writeFile(absolutePath, parsed.bytes);
  return localAssetUrl(projectId, relativePath);
}

function localizeEmbeddedMediaUrls<T>(
  rootPath: string,
  input: T,
  transaction: WorkspaceManifestTransaction,
): { value: T; changed: boolean } {
  const rootRecord = toProjectRecordObject(input);
  const projectId = typeof rootRecord?.id === "string" && rootRecord.id.trim() ? rootRecord.id.trim() : "";
  if (!projectId) return { value: input, changed: false };

  let changed = false;
  let localizedCount = 0;
  const localizedByDataUrl = new Map<string, string>();

  const visit = (value: unknown): unknown => {
    if (isDataMediaUrl(value)) {
      const cached = localizedByDataUrl.get(value);
      if (cached) {
        changed = true;
        return cached;
      }
      localizedCount += 1;
      const localized = localizeEmbeddedDataUrl(rootPath, projectId, value, localizedCount, transaction);
      localizedByDataUrl.set(value, localized);
      changed = true;
      return localized;
    }
    if (Array.isArray(value)) {
      let next: unknown[] | null = null;
      for (let index = 0; index < value.length; index += 1) {
        const current = value[index];
        const localized = visit(current);
        if (localized !== current) {
          if (!next) next = [...value];
          next[index] = localized;
        }
      }
      return next ?? value;
    }
    const record = toProjectRecordObject(value);
    if (!record) return value;

    let next: Record<string, unknown> | null = null;
    for (const [key, current] of Object.entries(record)) {
      const localized = visit(current);
      if (localized !== current) {
        if (!next) next = { ...record };
        next[key] = localized;
      }
    }
    return next ?? value;
  };

  return { value: visit(input) as T, changed };
}

function manifestIdentity(record: Record<string, unknown> | null): ManifestIdentity {
  if (!record) return { state: "none" };
  const hasUuid = record.immutableProjectUuid !== undefined;
  const hasGeneration = record.projectGeneration !== undefined;
  if (!hasUuid && !hasGeneration) return { state: "none" };
  if (!hasUuid || !hasGeneration) return { state: "partial" };
  const parsed = workspaceProjectRecordSchema
    .pick({ immutableProjectUuid: true, projectGeneration: true })
    .required()
    .safeParse(record);
  if (!parsed.success) return { state: "partial" };
  return {
    state: "complete",
    immutableProjectUuid: parsed.data.immutableProjectUuid,
    projectGeneration: parsed.data.projectGeneration,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneJsonPreservingUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonPreservingUndefined(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonPreservingUndefined(item)]),
    ) as T;
  }
  return value;
}

function deepFreezeJson<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeJson(child);
  }
  return Object.freeze(value);
}

function frozenJsonClone<T>(value: T): T {
  return deepFreezeJson(cloneJson(value));
}

function sameCompleteIdentity(
  left: Extract<ManifestIdentity, { state: "complete" }>,
  right: Extract<ManifestIdentity, { state: "complete" }>,
): boolean {
  return left.immutableProjectUuid === right.immutableProjectUuid && left.projectGeneration === right.projectGeneration;
}

function assertManifestBackupPair(main: ManifestState | null, backup: ManifestState | null): ManifestIdentity {
  const mainIdentity = manifestIdentity(main?.raw ?? null);
  const backupIdentity = manifestIdentity(backup?.raw ?? null);
  if (mainIdentity.state === "partial" || backupIdentity.state === "partial") {
    throw new WorkspaceProjectIdentityUnavailableError(
      "Workspace project or backup identity is only partially present",
    );
  }
  if (main && backup && main.record.id !== backup.record.id) {
    throw new WorkspaceProjectIdentityUnavailableError("Workspace project backup belongs to a different project");
  }
  if (
    mainIdentity.state === "complete" &&
    backupIdentity.state === "complete" &&
    !sameCompleteIdentity(mainIdentity, backupIdentity)
  ) {
    throw new WorkspaceProjectIdentityUnavailableError("Workspace project and backup identities do not match");
  }
  return mainIdentity.state === "complete" ? mainIdentity : backupIdentity;
}

function assertCandidateIdentity(
  candidate: Record<string, unknown>,
  authoritativeIdentity: ManifestIdentity,
  resource: "manifest" | "backup",
): ManifestIdentity {
  const candidateIdentity = manifestIdentity(candidate);
  if (candidateIdentity.state === "partial") {
    throw new WorkspaceProjectIdentityUnavailableError(
      `Workspace project ${resource} identity is only partially present`,
    );
  }
  if (
    authoritativeIdentity.state === "complete" &&
    (candidateIdentity.state !== "complete" || !sameCompleteIdentity(authoritativeIdentity, candidateIdentity))
  ) {
    throw new WorkspaceProjectIdentityUnavailableError(
      `Workspace project ${resource} identity cannot be removed or changed`,
    );
  }
  return candidateIdentity;
}

function identityState(record: WorkspaceProjectRecordV2 | null): ManifestIdentity["state"] {
  return manifestIdentity(record as Record<string, unknown> | null).state;
}

function readProjectJsonInTransaction(transaction: WorkspaceManifestTransaction, filePath: string): unknown | null {
  const raw = transaction.readJson(filePath);
  if (raw === null) return null;
  const localized = localizeEmbeddedMediaUrls(transaction.canonicalRootPath, raw, transaction);
  return localized.changed ? transaction.replaceJson(filePath, localized.value) : raw;
}

function readManifestState(transaction: WorkspaceManifestTransaction): ManifestState | null {
  const raw = transaction.readJson(transaction.manifestPath);
  if (raw === null) return null;
  const rawRecord = toProjectRecordObject(raw);
  if (!rawRecord) throw new Error("Workspace manifest must be an object");
  const record = normalizeWorkspaceProjectRecord(rawRecord);
  if (identityState(record) === "partial") {
    throw new WorkspaceProjectIdentityUnavailableError("Workspace project identity is only partially present");
  }
  return { raw: rawRecord, record };
}

function localizeManifestState(
  transaction: WorkspaceManifestTransaction,
  state: ManifestState | null,
  options: WorkspaceManifestMutationOptions,
): ManifestState | null {
  if (!state || options.localizeEmbeddedMedia === false) return state;
  const localized = localizeEmbeddedMediaUrls(transaction.canonicalRootPath, state.raw, transaction);
  if (!localized.changed) return state;
  const localizedRaw = toProjectRecordObject(localized.value);
  if (!localizedRaw) throw new Error("Localized workspace manifest must be an object");
  const beforeIdentity = manifestIdentity(state.raw);
  const afterIdentity = manifestIdentity(localizedRaw);
  if (
    beforeIdentity.state !== afterIdentity.state ||
    (beforeIdentity.state === "complete" &&
      afterIdentity.state === "complete" &&
      !sameCompleteIdentity(beforeIdentity, afterIdentity))
  ) {
    throw new WorkspaceProjectIdentityUnavailableError(
      "Embedded-media slimming cannot change workspace project identity",
    );
  }
  const persisted = transaction.replaceJson(transaction.manifestPath, localized.value);
  const persistedRaw = toProjectRecordObject(persisted);
  if (!persistedRaw) throw new Error("Persisted workspace manifest must be an object");
  return { raw: persistedRaw, record: normalizeWorkspaceProjectRecord(persistedRaw) };
}

function readBackupState(transaction: WorkspaceManifestTransaction): ManifestState | null {
  const raw = transaction.readJson(workspaceProjectBackupFile(transaction.canonicalRootPath));
  if (raw === null) return null;
  const rawRecord = toProjectRecordObject(raw);
  if (!rawRecord) throw new Error("Workspace project backup must be an object");
  const record = normalizeWorkspaceProjectRecord(rawRecord);
  if (identityState(record) === "partial") {
    throw new WorkspaceProjectIdentityUnavailableError("Workspace project backup identity is only partially present");
  }
  return { raw: rawRecord, record };
}

function mentionsIdentity(record: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(record, "immutableProjectUuid") ||
    Object.prototype.hasOwnProperty.call(record, "projectGeneration")
  );
}

function createMutationContext(
  transaction: WorkspaceManifestTransaction,
  options: WorkspaceManifestMutationOptions,
): WorkspaceManifestMutationContext {
  const rawMainBaseline = readManifestState(transaction);
  const backupBaseline = readBackupState(transaction);
  const baselineIdentity = assertManifestBackupPair(rawMainBaseline, backupBaseline);
  const mainBaseline = localizeManifestState(transaction, rawMainBaseline, options);
  const mainRawBaseline = mainBaseline ? cloneJson(mainBaseline.raw) : null;
  const backupRawBaseline = backupBaseline ? cloneJson(backupBaseline.raw) : null;
  const expectedProjectId = mainBaseline?.record.id ?? backupBaseline?.record.id ?? null;
  let stagedBackupIdentity: ManifestIdentity | null = null;
  let manifestReplaced = false;
  let backupReplaced = false;

  const effectiveIdentity = (): ManifestIdentity =>
    stagedBackupIdentity?.state === "complete" ? stagedBackupIdentity : baselineIdentity;

  const assertProjectId = (record: WorkspaceProjectRecordV2, resource: "manifest" | "backup"): void => {
    if (expectedProjectId && record.id !== expectedProjectId) {
      throw new WorkspaceProjectIdentityUnavailableError(
        `Workspace project ${resource} belongs to a different project`,
      );
    }
  };

  return {
    canonicalRootPath: transaction.canonicalRootPath,
    current: mainBaseline ? frozenJsonClone(mainBaseline.record) : null,
    currentRaw: mainRawBaseline ? frozenJsonClone(mainRawBaseline) : null,
    currentBackup: backupBaseline ? frozenJsonClone(backupBaseline.record) : null,
    currentBackupRaw: backupRawBaseline ? frozenJsonClone(backupRawBaseline) : null,
    readProjectJsonWithEmbeddedMediaSlimming(filePath) {
      return readProjectJsonInTransaction(transaction, filePath);
    },
    replaceBackup(record) {
      if (backupReplaced) {
        throw new Error("Workspace manifest transaction may replace the backup only once");
      }
      const inputRecord = toProjectRecordObject(record);
      if (!inputRecord) throw new Error("Workspace project backup must be an object");
      const rawRecord = cloneJsonPreservingUndefined(inputRecord);
      const normalized = normalizeWorkspaceProjectRecord(rawRecord);
      assertProjectId(normalized, "backup");
      assertCandidateIdentity(rawRecord, effectiveIdentity(), "backup");
      const persisted = transaction.replaceJson(workspaceProjectBackupFile(transaction.canonicalRootPath), rawRecord);
      const persistedRaw = toProjectRecordObject(persisted);
      if (!persistedRaw) throw new Error("Persisted workspace project backup must be an object");
      const persistedRecord = normalizeWorkspaceProjectRecord(persistedRaw);
      assertProjectId(persistedRecord, "backup");
      stagedBackupIdentity = assertCandidateIdentity(persistedRaw, effectiveIdentity(), "backup");
      backupReplaced = true;
      return persistedRecord;
    },
    replace(next) {
      if (manifestReplaced) {
        throw new Error("Workspace manifest transaction may replace the manifest only once");
      }
      const nextRaw = toProjectRecordObject(next);
      if (!nextRaw) throw new Error("Workspace manifest must be an object");
      let merged = {
        ...(mainRawBaseline ?? {}),
        ...cloneJsonPreservingUndefined(nextRaw),
      };
      const authoritativeIdentity = effectiveIdentity();
      if (
        authoritativeIdentity.state === "complete" &&
        manifestIdentity(merged).state === "none" &&
        !mentionsIdentity(nextRaw)
      ) {
        merged = {
          ...merged,
          immutableProjectUuid: authoritativeIdentity.immutableProjectUuid,
          projectGeneration: authoritativeIdentity.projectGeneration,
        };
      }
      const normalized = normalizeWorkspaceProjectRecord(merged);
      assertProjectId(normalized, "manifest");
      assertCandidateIdentity(merged, authoritativeIdentity, "manifest");
      const persistedValue =
        options.localizeEmbeddedMedia === false
          ? merged
          : localizeEmbeddedMediaUrls(transaction.canonicalRootPath, merged, transaction).value;
      const persisted = transaction.replaceJson(transaction.manifestPath, persistedValue);
      const persistedRecord = toProjectRecordObject(persisted);
      if (!persistedRecord) throw new Error("Persisted workspace manifest must be an object");
      const record = normalizeWorkspaceProjectRecord(persistedRecord);
      assertProjectId(record, "manifest");
      assertCandidateIdentity(persistedRecord, authoritativeIdentity, "manifest");
      manifestReplaced = true;
      return record;
    },
  };
}

export function withWorkspaceManifestMutationSync<T>(
  rootPath: string,
  callback: (context: WorkspaceManifestMutationContext) => T extends PromiseLike<unknown> ? never : T,
  lockOptions: WorkspaceManifestLockOptions = {},
  mutationOptions: WorkspaceManifestMutationOptions = {},
): T {
  return withWorkspaceManifestTransactionSync<T>(
    rootPath,
    (transaction) => callback(createMutationContext(transaction, mutationOptions)),
    lockOptions,
  );
}

export function withWorkspaceManifestMutation<T>(
  rootPath: string,
  callback: (context: WorkspaceManifestMutationContext) => T | Promise<T>,
  lockOptions: WorkspaceManifestLockOptions = {},
  mutationOptions: WorkspaceManifestMutationOptions = {},
): Promise<T> {
  return withWorkspaceManifestTransaction(
    rootPath,
    (transaction) => callback(createMutationContext(transaction, mutationOptions)),
    lockOptions,
  );
}

export function hasWorkspaceManifest(rootPath: string): boolean {
  let canonicalRootPath: string;
  try {
    canonicalRootPath = fs.realpathSync(rootPath);
  } catch {
    return false;
  }
  return fs.existsSync(workspaceProjectFile(canonicalRootPath));
}

export function readProjectJsonFileWithEmbeddedMediaSlimming(rootPath: string, filePath: string): unknown {
  return withWorkspaceManifestTransactionSync(rootPath, (transaction) => {
    const value = readProjectJsonInTransaction(transaction, filePath);
    if (value === null) throw new Error(`Project JSON file does not exist: ${filePath}`);
    return value;
  });
}

export function readProjectJsonTopLevelFields(
  filePath: string,
  options: TopLevelFieldsOptions,
): Record<string, unknown> | null {
  const raw = readJsonFile(filePath);
  const record = toProjectRecordObject(raw);
  if (!record) return null;

  const out: Record<string, unknown> = {};
  for (const key of options.keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
  }
  if (options.stopBeforeKeys?.length) {
    for (const stopKey of options.stopBeforeKeys) {
      if (Object.prototype.hasOwnProperty.call(record, stopKey)) break;
    }
  }
  return out;
}

export function readWorkspaceManifest(rootPath: string): WorkspaceProjectRecordV2 | null {
  try {
    return withWorkspaceManifestMutationSync(rootPath, (context) => context.current);
  } catch (error) {
    if (
      isWorkspaceBoundaryError(error) ||
      error instanceof WorkspaceManifestLockBusyError ||
      error instanceof WorkspaceProjectIdentityUnavailableError
    ) {
      throw error;
    }
    logWarn("workspace", "manifest-read-failed", undefined, error);
    return null;
  }
}

/**
 * Read a stable manifest snapshot without acquiring the write transaction lock.
 *
 * Project-root resolution and task-center polling are read-only hot paths. They
 * used to call `readWorkspaceManifest`, which deliberately acquires the
 * manifest transaction lock because it may localize embedded media. When the
 * GUI and an MCP/Agent process touched the same project at the same time, a
 * harmless poll could therefore block a real review/write and surface
 * "manifest is being changed" to the user. This fast path is only used for a
 * fully valid, already-localized manifest; callers fall back to the transactional
 * reader when migration/slimming or identity repair is required.
 */
export function readWorkspaceManifestSnapshot(rootPath: string): WorkspaceProjectRecordV2 | null {
  try {
    const canonicalRootPath = fs.realpathSync(rootPath);
    const raw = readJsonFile(workspaceProjectFile(canonicalRootPath));
    const rawRecord = toProjectRecordObject(raw);
    if (!rawRecord) return null;
    const parsed = workspaceProjectRecordSchema.safeParse(rawRecord);
    if (!parsed.success || manifestIdentity(rawRecord).state === "partial") return null;

    // A backup with a conflicting complete identity must still go through the
    // locked reader so it can raise the canonical identity error instead of
    // silently returning a potentially unsafe projection.
    const backupPath = workspaceProjectBackupFile(canonicalRootPath);
    if (fs.existsSync(backupPath)) {
      const backupRaw = toProjectRecordObject(readJsonFile(backupPath));
      if (!backupRaw) return null;
      const backupIdentity = manifestIdentity(backupRaw);
      if (backupIdentity.state === "partial") return null;
      const mainIdentity = manifestIdentity(rawRecord);
      if (
        mainIdentity.state === "complete" &&
        backupIdentity.state === "complete" &&
        !sameCompleteIdentity(mainIdentity, backupIdentity)
      ) return null;
    }

    // Embedded data URLs need the transactional reader's slimming side effect.
    // Keep this check conservative: any data URL sends the caller to the safe
    // locked path rather than returning a snapshot that would never be
    // localized.
    if (JSON.stringify(rawRecord).includes('"data:')) return null;
    return normalizeWorkspaceProjectRecord(rawRecord);
  } catch (error) {
    if (error instanceof WorkspaceProjectIdentityUnavailableError) throw error;
    return null;
  }
}

export function readWorkspaceManifestSummary(rootPath: string): Omit<WorkspaceProjectRecordV2, "payload"> | null {
  const manifest = readWorkspaceManifest(rootPath);
  if (!manifest) return null;
  const { payload: _payload, ...summary } = manifest;
  return summary;
}

export function writeWorkspaceManifest(rootPath: string, record: WorkspaceProjectRecordV2): WorkspaceProjectRecordV2 {
  return withWorkspaceManifestMutationSync(rootPath, (context) => context.replace(record));
}

export function recoverWorkspaceManifest(
  rootPath: string,
  projectId: string,
  quarantineTimestamp: number,
): WorkspaceProjectRecordV2 {
  return withWorkspaceManifestTransactionSync(rootPath, (transaction) => {
    const backup = transaction.readJson(workspaceProjectBackupFile(transaction.canonicalRootPath));
    const backupRaw = toProjectRecordObject(backup);
    const backupIdentity = manifestIdentity(backupRaw);
    if (backupIdentity.state === "partial") {
      throw new WorkspaceProjectIdentityUnavailableError("Workspace project backup identity is only partially present");
    }
    const parsedBackup = workspaceProjectRecordSchema.safeParse(backupRaw);
    if (!parsedBackup.success || parsedBackup.data.id !== projectId) {
      throw new Error(`Workspace project backup is unavailable: ${projectId}`);
    }

    let currentRaw: Record<string, unknown> | null = null;
    try {
      currentRaw = toProjectRecordObject(transaction.readJson(transaction.manifestPath));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      // A syntactically corrupt manifest cannot provide trustworthy structure;
      // recovery therefore relies on the last verified backup below.
    }
    const parsedCurrent = workspaceProjectRecordSchema.safeParse(currentRaw);
    if (parsedCurrent.success && parsedCurrent.data.id === projectId) {
      return normalizeWorkspaceProjectRecord(parsedCurrent.data);
    }
    const currentIdentity = manifestIdentity(currentRaw);
    if (currentIdentity.state === "partial") {
      throw new WorkspaceProjectIdentityUnavailableError("Workspace project identity is only partially present");
    }

    let recoveredRaw: Record<string, unknown> = {
      ...backupRaw,
      lastKnownRootPath: path.resolve(rootPath),
    };
    if (currentIdentity.state === "complete" && backupIdentity.state === "none") {
      recoveredRaw = {
        ...recoveredRaw,
        immutableProjectUuid: currentIdentity.immutableProjectUuid,
        projectGeneration: currentIdentity.projectGeneration,
      };
    } else if (
      currentIdentity.state === "complete" &&
      backupIdentity.state === "complete" &&
      (currentIdentity.immutableProjectUuid !== backupIdentity.immutableProjectUuid ||
        currentIdentity.projectGeneration !== backupIdentity.projectGeneration)
    ) {
      throw new WorkspaceProjectIdentityUnavailableError(
        "Workspace project backup identity does not match the current manifest",
      );
    }
    if (fs.existsSync(transaction.manifestPath)) {
      transaction.copyFile(
        transaction.manifestPath,
        workspaceProjectQuarantineFile(transaction.canonicalRootPath, quarantineTimestamp),
      );
    }
    const normalized = normalizeWorkspaceProjectRecord(recoveredRaw);
    if (identityState(normalized) === "partial") {
      throw new WorkspaceProjectIdentityUnavailableError(
        "Recovered workspace project identity is only partially present",
      );
    }
    const localized = localizeEmbeddedMediaUrls(transaction.canonicalRootPath, recoveredRaw, transaction).value;
    const persisted = transaction.replaceJson(transaction.manifestPath, localized);
    return normalizeWorkspaceProjectRecord(persisted);
  });
}

export function ensureWorkspaceFolders(rootPath: string): void {
  const resolvedRootPath = path.resolve(rootPath);
  fs.mkdirSync(resolvedRootPath, { recursive: true });
  const canonicalRootPath = fs.realpathSync(resolvedRootPath);
  fs.mkdirSync(workspaceNomiDir(canonicalRootPath), { recursive: true });
  fs.mkdirSync(workspaceAssetsGeneratedDir(canonicalRootPath), { recursive: true });
  fs.mkdirSync(workspaceAssetsImportedDir(canonicalRootPath), { recursive: true });
  fs.mkdirSync(workspaceExportsDir(canonicalRootPath), { recursive: true });
}

export function initializeWorkspace(
  rootPath: string,
  input: {
    id?: string;
    name?: string;
    seedKey?: string;
    draft?: boolean;
    payload?: unknown;
  } = {},
): WorkspaceProjectRecordV2 {
  ensureWorkspaceFolders(rootPath);
  return withWorkspaceManifestMutationSync(rootPath, (context) => {
    if (context.current && context.currentRaw) {
      const mainIdentity = manifestIdentity(context.currentRaw as Record<string, unknown>);
      const backupIdentity = manifestIdentity(context.currentBackupRaw as Record<string, unknown> | null);
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
      const backupIdentity = manifestIdentity(context.currentBackupRaw as Record<string, unknown>);
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
  });
}
