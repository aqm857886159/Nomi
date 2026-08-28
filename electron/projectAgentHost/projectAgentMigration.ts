import crypto from "node:crypto";

import type {
  ProjectAgentHostState,
  ProjectAgentItem,
  ProjectAgentQueueItem,
  ProjectAgentThread,
  ProjectAgentTurn,
  ProjectBinding,
} from "../shared/projectAgentContracts";
import { createProjectAgentContextBinding } from "./projectAgentContextBinding";
import { legacyContextRecordKey, stageProjectAgentLegacyContext } from "./projectAgentContextAdapter";
import {
  assertCutoverMatches,
  assertCutoverPreparationMatches,
  hashCutoverProposal,
  readOrCreateProjectAgentCutoverPreparation,
  readProjectAgentCutoverManifest,
  type ProjectAgentCutoverManifest,
  withProjectAgentCutoverLock,
  writeProjectAgentCutoverManifest,
} from "./projectAgentCutoverManifest";
import { findUniqueLegacyContextSession, readProjectAgentLegacyContext } from "./projectAgentLegacyContextReader";
import {
  readProjectAgentLegacyConversations,
  type ProjectAgentLegacyArea,
  type ProjectAgentLegacyConversationSource,
  type ProjectAgentLegacyMessage,
  type ProjectAgentLegacyThread,
} from "./projectAgentLegacyConversationReader";
import { createProjectAgentProposalReceiptStore } from "./projectAgentProposalReceiptStore";
import type { ProjectAgentRepositoryRouter } from "./projectAgentRepositoryRouter";
import { projectAgentPartitionKey } from "./projectAgentIdentity";
import { createInitialProjectAgentState, snapshotProjectAgentHostState } from "./projectAgentState";

export type ProjectAgentMigrationResult = Readonly<{
  migrated: boolean;
  creationThreads: number;
  generationThreads: number;
  messageCount: number;
  manifest: ProjectAgentCutoverManifest;
}>;

export class ProjectAgentMigrationError extends Error {
  readonly code = "project_agent_migration_failed" as const;
}

function digestId(...parts: readonly string[]): string {
  return crypto.createHash("sha256").update(parts.join("\0")).digest("hex");
}

function isoTimestamp(value: number, fallback: number): string {
  const date = new Date(Number.isFinite(value) ? value : fallback);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(fallback).toISOString();
}

function threadTimestampPair(
  thread: ProjectAgentLegacyThread,
  fallback: number,
): { createdAt: string; updatedAt: string } {
  const createdAt = isoTimestamp(thread.createdAt, fallback);
  const createdMs = new Date(createdAt).getTime();
  const updated = isoTimestamp(thread.updatedAt, fallback);
  const updatedAt = new Date(updated).getTime() < createdMs ? createdAt : updated;
  return { createdAt, updatedAt };
}

function sourceSessionKey(
  projectId: string,
  area: ProjectAgentLegacyArea,
  context: ReturnType<typeof readProjectAgentLegacyContext>,
  legacyThreadId: string,
): string {
  return (
    findUniqueLegacyContextSession(context, projectId, area, legacyThreadId)?.sessionKey ??
    `nomi:workbench:${projectId}:${area}`
  );
}

function sourceContextSnapshot(
  projectId: string,
  area: ProjectAgentLegacyArea,
  context: ReturnType<typeof readProjectAgentLegacyContext>,
  legacyThreadId: string,
): unknown | null {
  return findUniqueLegacyContextSession(context, projectId, area, legacyThreadId)?.snapshot ?? null;
}

function makeThread(
  binding: ProjectBinding,
  area: ProjectAgentLegacyArea,
  source: ProjectAgentLegacyConversationSource,
  legacy: ProjectAgentLegacyThread,
  now: number,
  context: ReturnType<typeof readProjectAgentLegacyContext>,
): ProjectAgentThread {
  const identity = digestId(binding.immutableProjectUuid, String(binding.projectGeneration), area, legacy.id);
  const timestamps = threadTimestampPair(legacy, now);
  const title = legacy.title.trim();
  return Object.freeze({
    threadId: `legacy-${identity}`,
    ...(title ? { title } : {}),
    ...timestamps,
    provenance: Object.freeze({
      kind: "legacy" as const,
      readOnly: true as const,
      source: Object.freeze({
        legacyArea: area,
        legacySessionKey: sourceSessionKey(binding.projectId, area, context, legacy.id),
        legacyThreadId: legacy.id,
        sourceHash: source.sourceHash,
      }),
    }),
  });
}

function messageTimestamp(thread: ProjectAgentLegacyThread, index: number, now: number): string {
  const span = Math.max(0, thread.updatedAt - thread.createdAt);
  return isoTimestamp(
    thread.createdAt + (thread.messages.length > 1 ? (span * index) / (thread.messages.length - 1) : 0),
    now,
  );
}

function messageItem(
  binding: ProjectBinding,
  thread: ProjectAgentThread,
  turn: ProjectAgentTurn,
  message: ProjectAgentLegacyMessage,
  timestamp: string,
  index: number,
): ProjectAgentItem {
  const id = `legacy-item-${digestId(thread.threadId, message.id, String(index))}`;
  const base = {
    itemId: id,
    threadId: thread.threadId,
    turnId: turn.turnId,
    status: "done" as const,
    retryable: false,
    deviated: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (message.role === "user") {
    return Object.freeze({ ...base, kind: "user" as const, text: message.content || " " });
  }
  if (message.role === "assistant") {
    return Object.freeze({ ...base, kind: "assistant" as const, text: message.content, textRevision: 1 });
  }
  return Object.freeze({
    ...base,
    kind: "tool" as const,
    toolCallId: `legacy-tool-${digestId(thread.threadId, message.id)}`,
    invocationId: `legacy-invocation-${digestId(binding.immutableProjectUuid, message.id)}`,
    text: message.content,
    capability: { id: "legacy.transcript", version: 1 },
    resultRef: `legacy-result-${digestId(message.content)}`,
  });
}

function buildState(
  binding: ProjectBinding,
  source: ProjectAgentLegacyConversationSource,
  context: ReturnType<typeof readProjectAgentLegacyContext>,
  stagedContextRecordIds: ReadonlyMap<string, string>,
  now: number,
): { state: ProjectAgentHostState; creationThreads: number; generationThreads: number; messageCount: number } {
  const threads: ProjectAgentThread[] = [];
  const turns: ProjectAgentTurn[] = [];
  const items: ProjectAgentItem[] = [];
  const queue: ProjectAgentQueueItem[] = [];
  const activeCandidates: Array<{ area: ProjectAgentLegacyArea; id: string; preferred: boolean }> = [];
  const validActiveCandidates: string[] = [];
  const areas: Array<[ProjectAgentLegacyArea, readonly ProjectAgentLegacyThread[]]> = [
    ["creation", source.creation],
    ["generation", source.generation],
  ];
  let messageCount = 0;
  for (const [area, legacyThreads] of areas) {
    for (const legacy of legacyThreads) {
      const thread = makeThread(binding, area, source, legacy, now, context);
      threads.push(thread);
      const legacySnapshot = sourceContextSnapshot(binding.projectId, area, context, legacy.id);
      const contextRef = Object.freeze({
        binding: createProjectAgentContextBinding(binding, thread.threadId),
        contextRevision: 0,
        recordId:
          stagedContextRecordIds.get(legacyContextRecordKey(area, legacy.id)) ??
          `canonical-context-${digestId(thread.threadId, binding.immutableProjectUuid, String(binding.projectGeneration))}`,
      });
      if (legacy.messages.length === 0) continue;
      for (const [index, message] of legacy.messages.entries()) {
        const timestamp = messageTimestamp(legacy, index, now);
        const turnId = `legacy-turn-${digestId(thread.threadId, message.id, String(index))}`;
        const executionToken = `legacy-execution-${digestId(binding.immutableProjectUuid, turnId)}`;
        const turn: ProjectAgentTurn = Object.freeze({
          turnId,
          threadId: thread.threadId,
          status: "done",
          retryable: false,
          deviated: false,
          executionToken,
          model: { id: "legacy.transcript", version: 1 },
          skillVersions: [],
          capabilityVersions: [],
          contextRef,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        turns.push(turn);
        const item = messageItem(binding, thread, turn, message, timestamp, index);
        items.push(item);
        const target =
          area === "generation"
            ? { kind: "canvas" as const, nodeIds: [] as readonly string[] }
            : {
                kind: "document" as const,
                documentId: `legacy-${thread.threadId}`,
                anchor: { kind: "whole-document" as const },
              };
        queue.push(
          Object.freeze({
            queueItemId: `legacy-queue-${digestId(thread.threadId, turnId)}`,
            threadId: thread.threadId,
            turnId,
            status: "done" as const,
            retryable: false,
            deviated: false,
            binding,
            target,
            preconditions: {},
            contextRef,
            model: turn.model,
            skillVersions: [],
            capabilityVersions: [],
            policyRevision: 0,
            attachmentRefs: [],
            originSurface: {
              surfaceId: `legacy-${area}`,
              kind: area === "generation" ? ("canvas" as const) : ("document" as const),
            },
            enqueuedAt: timestamp,
            updatedAt: timestamp,
          }),
        );
        messageCount += 1;
      }
      // Active selection is resolved later, after both areas have been read.
      const preferred =
        (area === "creation" && source.creationActiveId === legacy.id) ||
        (area === "generation" && source.generationActiveId === legacy.id);
      activeCandidates.push({
        area,
        id: thread.threadId,
        preferred,
      });
      if (preferred && legacySnapshot !== null) validActiveCandidates.push(thread.threadId);
    }
  }
  // An active legacy thread is safe only when exactly one source area points to
  // a validated context snapshot. Missing, stale, or parallel candidates fall
  // back to a clean canonical thread rather than guessing an old area identity.
  let activeThreadId: string | null = validActiveCandidates.length === 1 ? validActiveCandidates[0]! : null;
  if (!activeThreadId) {
    const canonicalId = `thread-${digestId(binding.immutableProjectUuid, String(binding.projectGeneration), "main")}`;
    const canonicalTimestamp = new Date(now).toISOString();
    threads.unshift(
      Object.freeze({
        threadId: canonicalId,
        createdAt: canonicalTimestamp,
        updatedAt: canonicalTimestamp,
        provenance: Object.freeze({ kind: "canonical" as const }),
      }),
    );
    activeThreadId = canonicalId;
  }
  return {
    state: snapshotProjectAgentHostState({
      ...createInitialProjectAgentState(binding),
      activeThreadId,
      threads,
      turns,
      items,
      queue,
      proposalApprovals: [],
      recentAppliedCommands: [],
    }),
    creationThreads: source.creation.length,
    generationThreads: source.generation.length,
    messageCount,
  };
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
    let source = readProjectAgentLegacyConversations(input.projectRoot, now);
    let context = readProjectAgentLegacyContext(input.projectRoot);
    let hashes = {
      conversationsHash: source.sourceHash,
      contextHash: context.sourceHash,
      proposalHash: hashCutoverProposal(source.committedProposal),
    } as const;
    const existing = readProjectAgentCutoverManifest(input.projectRoot);
    if (existing) {
      assertCutoverMatches(existing, input.binding, hashes);
      const repository = input.router.repositoryFor(input.binding);
      if (!repository.load(input.binding))
        throw new ProjectAgentMigrationError("Cutover manifest exists without Host state");
      return Object.freeze({
        migrated: false,
        creationThreads: existing.imported.creationThreads,
        generationThreads: existing.imported.generationThreads,
        messageCount: existing.imported.messageCount,
        manifest: existing,
      });
    }

    const preparation = readOrCreateProjectAgentCutoverPreparation(
      input.projectRoot,
      input.binding,
      hashes,
      new Date(now).toISOString(),
    );
    const migrationNow = Date.parse(preparation.startedAt);
    // Read again after the preparation is durable. This both closes the source
    // hash race and makes every crash retry rebuild byte-identical Host state.
    source = readProjectAgentLegacyConversations(input.projectRoot, migrationNow);
    context = readProjectAgentLegacyContext(input.projectRoot);
    hashes = {
      conversationsHash: source.sourceHash,
      contextHash: context.sourceHash,
      proposalHash: hashCutoverProposal(source.committedProposal),
    } as const;
    assertCutoverPreparationMatches(preparation, input.binding, hashes);

    const stagedContext = stageProjectAgentLegacyContext({
      projectRoot: input.projectRoot,
      binding: input.binding,
      source: context,
      candidates: [
        ...(["creation", "generation"] as const).flatMap((area) => {
          const threads = area === "creation" ? source.creation : source.generation;
          return threads.map((legacy) => ({
            area,
            legacyThreadId: legacy.id,
            threadId: `legacy-${digestId(input.binding.immutableProjectUuid, String(input.binding.projectGeneration), area, legacy.id)}`,
            conversationSourceHash: source.sourceHash,
          }));
        }),
      ],
    });
    const built = buildState(input.binding, source, context, stagedContext.recordIds, migrationNow);
    const repository = input.router.repositoryFor(input.binding);
    repository.initializeMigrated(built.state);
    const receiptStore = createProjectAgentProposalReceiptStore(input.projectRoot);
    if (source.committedProposal && typeof source.committedProposal === "object") {
      receiptStore.write({
        binding: input.binding,
        proposal: source.committedProposal,
        sourceHash: hashes.proposalHash,
        updatedAt: preparation.startedAt,
      });
    } else {
      receiptStore.clear();
    }
    const manifest: ProjectAgentCutoverManifest = Object.freeze({
      schemaVersion: 1,
      binding: Object.freeze({ ...input.binding }),
      sources: Object.freeze(hashes),
      imported: Object.freeze({
        creationThreads: built.creationThreads,
        generationThreads: built.generationThreads,
        messageCount: built.messageCount,
      }),
      completedAt: preparation.startedAt,
    });
    writeProjectAgentCutoverManifest(input.projectRoot, manifest);
    return Object.freeze({
      migrated: true,
      creationThreads: built.creationThreads,
      generationThreads: built.generationThreads,
      messageCount: built.messageCount,
      manifest,
    });
  });
}

export function projectAgentMigrationPartition(binding: ProjectBinding): string {
  return projectAgentPartitionKey(binding);
}
