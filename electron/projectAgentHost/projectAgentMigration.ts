import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { fsyncIfDurable, isDurable } from "../durability";
import { renameSyncWithRetry } from "../jsonFile";
import type { ProjectBinding } from "../shared/projectBinding";
import {
  assertCutoverMatches,
  assertCutoverPreparationMatches,
  readOrCreateProjectAgentCutoverPreparation,
  readProjectAgentCutoverManifest,
  type ProjectAgentCutoverManifest,
  type ProjectAgentCutoverSources,
  withProjectAgentCutoverLock,
  writeProjectAgentCutoverManifest,
} from "./projectAgentCutoverManifest";
import { projectAgentProposalReceiptPath } from "./projectAgentProposalReceiptStore";
import type { ProjectAgentRepositoryRouter } from "./projectAgentRepositoryRouter";
import { createInitialProjectAgentState } from "./projectAgentState";

const LEGACY_ARCHIVE_DIRECTORY = "project-agent-legacy-archive-v1";
const LEGACY_CONVERSATIONS_FILE = "conversations.json";
const LEGACY_CONTEXT_FILE = "agent-session.json";

type LegacySource = Readonly<{
  fileName: string;
  bytes: Buffer;
  hash: string;
  exists: boolean;
}>;

export type ProjectAgentMigrationResult = Readonly<{
  migrated: boolean;
  manifest: ProjectAgentCutoverManifest;
}>;

export class ProjectAgentMigrationError extends Error {
  readonly code = "project_agent_migration_failed" as const;
}

function hashBytes(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readPrivateSource(filePath: string): Readonly<{ bytes: Buffer; exists: boolean }> {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
      throw new ProjectAgentMigrationError(`Legacy Agent source is not a private regular file: ${filePath}`);
    }
    return Object.freeze({ bytes: fs.readFileSync(filePath), exists: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return Object.freeze({ bytes: Buffer.alloc(0), exists: false });
    }
    throw error;
  }
}

function legacySources(projectRoot: string): readonly LegacySource[] {
  const nomiDir = path.join(path.resolve(projectRoot), ".nomi");
  const paths = [
    path.join(nomiDir, LEGACY_CONVERSATIONS_FILE),
    path.join(nomiDir, LEGACY_CONTEXT_FILE),
    projectAgentProposalReceiptPath(projectRoot),
  ];
  return Object.freeze(
    paths.map((filePath) => {
      const source = readPrivateSource(filePath);
      return Object.freeze({
        fileName: path.basename(filePath),
        bytes: source.bytes,
        hash: hashBytes(source.bytes),
        exists: source.exists,
      });
    }),
  );
}

function sourceHashes(sources: readonly LegacySource[]): ProjectAgentCutoverSources {
  return Object.freeze({
    conversationsHash: sources[0]!.hash,
    contextHash: sources[1]!.hash,
    proposalReceiptHash: sources[2]!.hash,
  });
}

function archiveDirectory(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".nomi", LEGACY_ARCHIVE_DIRECTORY);
}

function archivePath(projectRoot: string, startedAt: string, fileName: string): string {
  const stamp = startedAt.replace(/[^0-9A-Za-z]/g, "_");
  return path.join(archiveDirectory(projectRoot), `${stamp}-${fileName}`);
}

function fsyncDirectory(directoryPath: string): void {
  if (!isDurable()) return;
  const fd = fs.openSync(directoryPath, fs.constants.O_RDONLY);
  try {
    fsyncIfDurable(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeArchiveFile(target: string, bytes: Buffer): void {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o400);
    fs.fchmodSync(fd, 0o400);
    fs.writeFileSync(fd, bytes);
    fsyncIfDurable(fd);
    fs.closeSync(fd);
    fd = undefined;
    renameSyncWithRetry(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function assertArchiveFile(target: string, expectedHash: string): void {
  const archived = readPrivateSource(target);
  if (hashBytes(archived.bytes) !== expectedHash) {
    throw new ProjectAgentMigrationError(`Legacy Agent archive does not match its cutover evidence: ${target}`);
  }
}

function archiveLegacySources(projectRoot: string, startedAt: string, sources: readonly LegacySource[]): void {
  const directory = archiveDirectory(projectRoot);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  for (const source of sources) {
    const target = archivePath(projectRoot, startedAt, source.fileName);
    if (!fs.existsSync(target) && source.exists) writeArchiveFile(target, source.bytes);
    assertArchiveFile(target, source.hash);
  }
  fsyncDirectory(directory);
}

function assertArchivedCutover(projectRoot: string, manifest: ProjectAgentCutoverManifest): void {
  const expected = [
    [LEGACY_CONVERSATIONS_FILE, manifest.sources.conversationsHash],
    [LEGACY_CONTEXT_FILE, manifest.sources.contextHash],
    [path.basename(projectAgentProposalReceiptPath(projectRoot)), manifest.sources.proposalReceiptHash],
  ] as const;
  for (const [fileName, hash] of expected) {
    assertArchiveFile(archivePath(projectRoot, manifest.completedAt, fileName), hash);
  }
}

function removeLegacyReceiptIfUnchanged(projectRoot: string, legacyHash: string): void {
  const receiptPath = projectAgentProposalReceiptPath(projectRoot);
  const receipt = readPrivateSource(receiptPath);
  if (hashBytes(receipt.bytes) !== legacyHash) return;
  fs.rmSync(receiptPath, { force: true });
}

function removeLegacyAgentSourceIfArchived(filePath: string, archivedHash: string): boolean {
  const source = readPrivateSource(filePath);
  if (!source.exists) return false;
  if (hashBytes(source.bytes) !== archivedHash) {
    throw new ProjectAgentMigrationError(
      `Legacy Agent source changed after archive publication; refusing to delete it: ${filePath}`,
    );
  }
  fs.rmSync(filePath);
  return true;
}

function removeArchivedLegacyAgentSources(
  projectRoot: string,
  sources: Pick<ProjectAgentCutoverSources, "conversationsHash" | "contextHash">,
): void {
  const nomiDir = path.join(path.resolve(projectRoot), ".nomi");
  const removed = [
    removeLegacyAgentSourceIfArchived(
      path.join(nomiDir, LEGACY_CONVERSATIONS_FILE),
      sources.conversationsHash,
    ),
    removeLegacyAgentSourceIfArchived(
      path.join(nomiDir, LEGACY_CONTEXT_FILE),
      sources.contextHash,
    ),
  ].some(Boolean);
  if (removed) fsyncDirectory(nomiDir);
}

export function migrateProjectAgentLegacy(
  input: Readonly<{
    projectRoot: string;
    binding: ProjectBinding;
    router: ProjectAgentRepositoryRouter;
    now?: number;
  }>,
): ProjectAgentMigrationResult {
  const now = input.now ?? Date.now();
  return withProjectAgentCutoverLock(input.projectRoot, () => {
    const existing = readProjectAgentCutoverManifest(input.projectRoot);
    const repository = input.router.repositoryFor(input.binding);
    if (existing) {
      assertCutoverMatches(existing, input.binding);
      assertArchivedCutover(input.projectRoot, existing);
      if (!repository.load(input.binding))
        throw new ProjectAgentMigrationError("Cutover manifest exists without Host state");
      removeArchivedLegacyAgentSources(input.projectRoot, existing.sources);
      removeLegacyReceiptIfUnchanged(input.projectRoot, existing.sources.proposalReceiptHash);
      return Object.freeze({ migrated: false, manifest: existing });
    }

    let sources = legacySources(input.projectRoot);
    const hashes = sourceHashes(sources);
    const preparation = readOrCreateProjectAgentCutoverPreparation(
      input.projectRoot,
      input.binding,
      hashes,
      new Date(now).toISOString(),
    );
    sources = legacySources(input.projectRoot);
    assertCutoverPreparationMatches(preparation, input.binding, sourceHashes(sources));
    archiveLegacySources(input.projectRoot, preparation.startedAt, sources);

    repository.initialize(createInitialProjectAgentState(input.binding));
    const manifest: ProjectAgentCutoverManifest = Object.freeze({
      schemaVersion: 1,
      mode: "archive-only",
      binding: Object.freeze({ ...input.binding }),
      sources: Object.freeze(hashes),
      completedAt: preparation.startedAt,
    });
    writeProjectAgentCutoverManifest(input.projectRoot, manifest);
    removeArchivedLegacyAgentSources(input.projectRoot, hashes);
    removeLegacyReceiptIfUnchanged(input.projectRoot, hashes.proposalReceiptHash);
    return Object.freeze({ migrated: true, manifest });
  });
}
