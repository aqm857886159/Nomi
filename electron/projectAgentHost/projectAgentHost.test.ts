import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ProjectAgentAssistantItem,
  ProjectAgentAsyncResultEnvelope,
  ProjectAgentItem,
  ProjectAgentMutation,
  ProjectAgentQueueItem,
  ProjectAgentThread,
  ProjectAgentTurn,
  ProjectBinding,
} from "../shared/projectAgentContracts";
import { createOfflineProjectAgentHost } from "./projectAgentHost";
import { reduceProjectAgentMutation } from "./projectAgentReducer";
import { createProjectAgentRepository } from "./projectAgentRepository";
import { createInitialProjectAgentState } from "./projectAgentState";
import { getDurabilityMode, setDurabilityMode } from "../durability";

let root = "";
let previousDurability = getDurabilityMode();

beforeEach(() => {
  previousDurability = getDurabilityMode();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-offline-project-agent-host-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  setDurabilityMode(previousDurability);
  fs.rmSync(root, { recursive: true, force: true });
});

const now = "2026-08-28T00:00:00.000Z";
const binding = {
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 3,
} as const;
const replacementBinding = {
  projectId: binding.projectId,
  immutableProjectUuid: "22222222-2222-4222-8222-222222222222",
  projectGeneration: 4,
} as const;
const target = { kind: "canvas", nodeIds: ["node-a"] } as const;
const preconditions = {
  nodes: [{ nodeId: "node-a", revision: 2, contentHash: "node-hash" }],
} as const;

function repository() {
  return createProjectAgentRepository({ rootDir: root });
}

function thread(threadId = "thread-a"): ProjectAgentThread {
  return { threadId, createdAt: now, updatedAt: now };
}

function threadMutation(
  commandId: string,
  expectedRevision: number,
  threadId: string,
  project: ProjectBinding = binding,
): Extract<ProjectAgentMutation, { type: "thread.put" }> {
  return {
    commandId,
    expectedRevision,
    binding: project,
    sender: { kind: "renderer", senderId: "renderer-a" },
    type: "thread.put",
    payload: { thread: thread(threadId), makeActive: true },
  };
}

function turn(): ProjectAgentTurn {
  return {
    turnId: "turn-a",
    threadId: "thread-a",
    status: "queued",
    retryable: false,
    deviated: false,
    executionToken: "token-turn-a",
    model: { id: "model-a", version: "2026-08" },
    skillVersions: [{ id: "skill-a", version: 2 }],
    capabilityVersions: [{ id: "canvas.read", version: 1 }],
    contextRef: {
      binding: {
        project: binding,
        threadId: "thread-a",
        sessionKey: `nomi:project-agent:${binding.immutableProjectUuid}:g${binding.projectGeneration}`,
      },
      recordId: "context-a",
      contextRevision: 7,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function userItem(): Extract<ProjectAgentItem, { kind: "user" }> {
  return {
    kind: "user",
    itemId: "user-turn-a",
    threadId: "thread-a",
    turnId: "turn-a",
    status: "done",
    retryable: false,
    deviated: false,
    text: "read the selected node",
    createdAt: now,
    updatedAt: now,
  };
}

function assistantItem(): ProjectAgentAssistantItem {
  return {
    kind: "assistant",
    itemId: "assistant-turn-a",
    threadId: "thread-a",
    turnId: "turn-a",
    status: "running",
    retryable: false,
    deviated: false,
    text: "",
    textRevision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function queueItem(): ProjectAgentQueueItem {
  return {
    queueItemId: "queue-turn-a",
    threadId: "thread-a",
    turnId: "turn-a",
    status: "queued",
    retryable: false,
    deviated: false,
    binding,
    target,
    preconditions,
    contextRef: turn().contextRef,
    model: { id: "model-a", version: "2026-08" },
    skillVersions: [{ id: "skill-a", version: 2 }],
    capabilityVersions: [{ id: "canvas.read", version: 1 }],
    policyRevision: 5,
    attachmentRefs: [{ assetId: "asset-a", contentHash: "asset-hash" }],
    originSurface: { surfaceId: "surface-a", kind: "canvas" },
    enqueuedAt: now,
    updatedAt: now,
  };
}

function enqueueMutation(): ProjectAgentMutation {
  return {
    commandId: "command-enqueue",
    expectedRevision: 0,
    binding,
    sender: { kind: "renderer", senderId: "renderer-a" },
    type: "turn.enqueue",
    payload: {
      thread: thread(),
      turn: turn(),
      userItem: userItem(),
      queueItem: queueItem(),
    },
  };
}

describe("offline ProjectAgentHost orchestration", () => {
  it("persists command idempotency and replays the original receipt after restart", async () => {
    const firstHost = createOfflineProjectAgentHost({ repository: repository() });
    const mutation = threadMutation("command-thread-a", 0, "thread-a");
    const first = await firstHost.dispatch(mutation);

    const restarted = createOfflineProjectAgentHost({ repository: repository() });
    const replay = await restarted.dispatch(mutation);

    expect(first.state.hostRevision).toBe(1);
    expect(replay).toMatchObject({ replayed: true, receipt: first.receipt, patch: first.patch });
    expect(restarted.getSnapshot(binding)).toMatchObject({
      hostRevision: 1,
      activeThreadId: "thread-a",
    });
    expect(restarted.getSnapshot(binding).recentAppliedCommands).toHaveLength(1);
  });

  it("replays an old compact ledger receipt after restart and rejects a hash conflict without reducing", async () => {
    const first = createOfflineProjectAgentHost({ repository: repository() });
    const original = threadMutation("command-old", 0, "thread-a");
    await first.dispatch(original);
    for (let revision = 1; revision < 70; revision += 1) {
      await first.dispatch(threadMutation(`command-${revision + 1}`, revision, "thread-a"));
    }
    expect(first.getSnapshot(binding).recentAppliedCommands).toHaveLength(64);
    expect(first.getSnapshot(binding).recentAppliedCommands.some(({ commandId }) => commandId === "command-old")).toBe(
      false,
    );

    const reduce = vi.fn(reduceProjectAgentMutation);
    const restarted = createOfflineProjectAgentHost({ repository: repository(), reduce });
    const replay = await restarted.dispatch(original);

    expect(replay).toMatchObject({
      replayed: true,
      snapshotRequired: true,
      patch: null,
      receipt: {
        commandId: "command-old",
        appliedRevision: 1,
      },
      state: { hostRevision: 70 },
    });
    expect(reduce).not.toHaveBeenCalled();

    await expect(
      restarted.dispatch({
        ...original,
        payload: { ...original.payload, thread: { ...original.payload.thread, title: "conflict" } },
      }),
    ).rejects.toMatchObject({ code: "command_id_conflict" });
    expect(reduce).not.toHaveBeenCalled();
    expect(restarted.getSnapshot(binding).hostRevision).toBe(70);
  });

  it("converges an acknowledged-byte fsync error through exact command replay", async () => {
    const durableRepository = repository();
    durableRepository.initialize(createInitialProjectAgentState(binding));
    const paths = durableRepository.pathsFor(binding);
    const realOpen = fs.openSync.bind(fs);
    const realFsync = fs.fsyncSync.bind(fs);
    const realClose = fs.closeSync.bind(fs);
    const realRename = fs.renameSync.bind(fs);
    const directoryFds = new Set<number>();
    let mainPublished = false;
    setDurabilityMode("durable");
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      const fd = realOpen(filePath, flags, mode);
      if (String(filePath) === paths.dir && flags === "r") directoryFds.add(fd);
      return fd;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (directoryFds.has(fd) && mainPublished) {
        const error = new Error("simulated post-publish fsync EIO") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return realFsync(fd);
    });
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      const result = realRename(from, to);
      if (String(to) === paths.snapshot) mainPublished = true;
      return result;
    });
    vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
      directoryFds.delete(fd);
      return realClose(fd);
    });
    const host = createOfflineProjectAgentHost({ repository: durableRepository });
    const mutation = threadMutation("command-fsync-convergence", 0, "thread-a");

    let firstError: unknown;
    try {
      await host.dispatch(mutation);
    } catch (caught) {
      firstError = caught;
    }
    expect(firstError).toMatchObject({
      committed: true,
      retryable: false,
      committedRevision: 1,
    });

    const replay = await host.dispatch(mutation);
    expect(replay).toMatchObject({ replayed: true });
    expect(replay.state.hostRevision).toBe(1);
    expect(replay.state.recentAppliedCommands).toHaveLength(1);
    expect(host.getSnapshot(binding)).toEqual(replay.state);
  });

  it("serializes concurrent same-project commands in FIFO order before durable CAS", async () => {
    const host = createOfflineProjectAgentHost({ repository: repository() });
    const first = host.dispatch(threadMutation("command-thread-a", 0, "thread-a"));
    const second = host.dispatch(threadMutation("command-thread-b", 1, "thread-b"));

    const results = await Promise.all([first, second]);

    expect(results.map((result) => result.state.hostRevision)).toEqual([1, 2]);
    expect(host.getSnapshot(binding)).toMatchObject({
      hostRevision: 2,
      activeThreadId: "thread-b",
    });
  });

  it("keeps serialization per partition so a deferred project does not block another", async () => {
    let releaseProjectA!: () => void;
    const projectAReleased = new Promise<void>((resolve) => {
      releaseProjectA = resolve;
    });
    let markProjectAEntered!: () => void;
    const projectAEntered = new Promise<void>((resolve) => {
      markProjectAEntered = resolve;
    });
    const host = createOfflineProjectAgentHost({
      repository: repository(),
      reduce: async (current, mutation) => {
        if (mutation.binding.immutableProjectUuid === binding.immutableProjectUuid) {
          markProjectAEntered();
          await projectAReleased;
        }
        return reduceProjectAgentMutation(current, mutation);
      },
    });

    const projectA = host.dispatch(threadMutation("command-a", 0, "thread-a", binding));
    await projectAEntered;
    const projectB = host.dispatch(threadMutation("command-b", 0, "thread-b", replacementBinding));
    let projectBSettled = false;
    void projectB.finally(() => {
      projectBSettled = true;
    });

    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(projectBSettled).toBe(true);
      expect((await projectB).state.hostRevision).toBe(1);
    } finally {
      releaseProjectA();
    }
    expect((await projectA).state.hostRevision).toBe(1);
  });

  it("isolates a replacement UUID and generation even when projectId and commandId match", async () => {
    const host = createOfflineProjectAgentHost({ repository: repository() });
    const commandId = "same-command-id";

    const original = await host.dispatch(threadMutation(commandId, 0, "thread-old", binding));
    const replacement = await host.dispatch(threadMutation(commandId, 0, "thread-new", replacementBinding));

    expect(original.replayed).toBe(false);
    expect(replacement.replayed).toBe(false);
    expect(host.getSnapshot(binding)).toMatchObject({
      binding,
      activeThreadId: "thread-old",
      hostRevision: 1,
    });
    expect(host.getSnapshot(replacementBinding)).toMatchObject({
      binding: replacementBinding,
      activeThreadId: "thread-new",
      hostRevision: 1,
    });
  });

  it("keeps a 1,000-command same-entity snapshot bounded without steady-state ledger rescans", async () => {
    setDurabilityMode("ephemeral");
    const durableRepository = repository();
    const paths = durableRepository.pathsFor(binding);
    const ledgerReadSpy = vi.spyOn(fs, "readFileSync");
    const host = createOfflineProjectAgentHost({ repository: durableRepository });
    let sizeAtWindowLimit = 0;

    for (let revision = 0; revision < 1_000; revision += 1) {
      await host.dispatch(threadMutation(`bounded-command-${revision + 1}`, revision, "thread-a"));
      if (revision === 63) sizeAtWindowLimit = fs.statSync(paths.snapshot).size;
    }

    const snapshot = host.getSnapshot(binding);
    const finalSize = fs.statSync(paths.snapshot).size;
    const ledgerReads = ledgerReadSpy.mock.calls.filter(([filePath]) => String(filePath) === paths.ledger);
    expect(snapshot).toMatchObject({
      hostRevision: 1_000,
      commandLedgerHighWater: 1_000,
    });
    expect(snapshot.recentAppliedCommands).toHaveLength(64);
    expect(finalSize).toBeLessThan(sizeAtWindowLimit + 10_000);
    expect(ledgerReads).toHaveLength(0);
  });

  it("round-trips an enqueued and running turn through the durable repository", async () => {
    const host = createOfflineProjectAgentHost({ repository: repository() });

    const enqueued = await host.dispatch(enqueueMutation());
    expect(enqueued.state.hostRevision).toBe(1);
    const running = await host.dispatch({
      commandId: "command-start",
      expectedRevision: 1,
      binding,
      sender: { kind: "internal", senderId: "scheduler" },
      type: "turn.start",
      payload: {
        turnId: "turn-a",
        queueItemId: "queue-turn-a",
        assistantItem: assistantItem(),
        occurredAt: now,
      },
    });

    expect(running.state.hostRevision).toBe(2);
    expect(host.getSnapshot(binding)).toEqual(running.state);
  });

  it("commits async results only after token, binding, target, preconditions and CAS revalidation", async () => {
    const host = createOfflineProjectAgentHost({ repository: repository() });
    await host.dispatch(enqueueMutation());
    await host.dispatch({
      commandId: "command-start",
      expectedRevision: 1,
      binding,
      sender: { kind: "internal", senderId: "scheduler" },
      type: "turn.start",
      payload: {
        turnId: "turn-a",
        queueItemId: "queue-turn-a",
        assistantItem: assistantItem(),
        occurredAt: now,
      },
    });
    const toolItem: ProjectAgentItem = {
      kind: "tool",
      itemId: "tool-a",
      threadId: "thread-a",
      turnId: "turn-a",
      status: "done",
      retryable: false,
      deviated: false,
      toolCallId: "tool-call-a",
      invocationId: "invocation-a",
      capability: { id: "canvas.read", version: 1 },
      resultRef: "result-a",
      createdAt: now,
      updatedAt: now,
    };
    const envelope: ProjectAgentAsyncResultEnvelope = {
      asyncToken: "token-turn-a",
      binding,
      threadId: "thread-a",
      turnId: "turn-a",
      queueItemId: "queue-turn-a",
      target,
      preconditions,
      expectedRevision: 2,
      items: [toolItem],
      turnStatus: "done",
      assistantFinal: {
        itemId: "assistant-turn-a",
        executionToken: "token-turn-a",
        expectedTextRevision: 0,
        text: "Read the selected node.",
      },
      receivedAt: now,
    };

    await expect(
      host.commitAsyncResult({
        commandId: "command-stale-async",
        sender: { kind: "internal", senderId: "executor" },
        envelope: { ...envelope, asyncToken: "late-token" },
      }),
    ).rejects.toMatchObject({ code: "async_result_stale" });
    expect(host.getSnapshot(binding).hostRevision).toBe(2);

    const applied = await host.commitAsyncResult({
      commandId: "command-valid-async",
      sender: { kind: "internal", senderId: "executor" },
      envelope,
    });

    expect(applied.state).toMatchObject({ hostRevision: 3 });
    expect(applied.state.items).toContainEqual(expect.objectContaining({ itemId: "tool-a" }));
    expect(createOfflineProjectAgentHost({ repository: repository() }).getSnapshot(binding)).toMatchObject({
      hostRevision: 3,
      turns: [expect.objectContaining({ turnId: "turn-a", status: "done" })],
      queue: [expect.objectContaining({ queueItemId: "queue-turn-a", status: "done" })],
    });
  });

  it("rejects a repeated tool result when a new item and command reuse its semantic invocation identity", async () => {
    const host = createOfflineProjectAgentHost({ repository: repository() });
    await host.dispatch(enqueueMutation());
    await host.dispatch({
      commandId: "command-start-tool-dedupe",
      expectedRevision: 1,
      binding,
      sender: { kind: "internal", senderId: "scheduler" },
      type: "turn.start",
      payload: {
        turnId: "turn-a",
        queueItemId: "queue-turn-a",
        assistantItem: assistantItem(),
        occurredAt: now,
      },
    });

    const toolResult = (itemId: string): ProjectAgentItem => ({
      kind: "tool",
      itemId,
      threadId: "thread-a",
      turnId: "turn-a",
      status: "done",
      retryable: false,
      deviated: false,
      toolCallId: "tool-call-dedupe",
      invocationId: "invocation-dedupe",
      capability: { id: "canvas.read", version: 1 },
      resultRef: "result-dedupe",
      createdAt: now,
      updatedAt: now,
    });
    const envelope = (itemId: string, expectedRevision: number): ProjectAgentAsyncResultEnvelope => ({
      asyncToken: "token-turn-a",
      binding,
      threadId: "thread-a",
      turnId: "turn-a",
      queueItemId: "queue-turn-a",
      target,
      preconditions,
      expectedRevision,
      items: [toolResult(itemId)],
      turnStatus: "running",
      receivedAt: now,
    });

    await host.commitAsyncResult({
      commandId: "command-tool-result-first",
      sender: { kind: "internal", senderId: "executor" },
      envelope: envelope("tool-result-first", 2),
    });

    await expect(
      host.commitAsyncResult({
        commandId: "command-tool-result-duplicate",
        sender: { kind: "internal", senderId: "executor" },
        envelope: envelope("tool-result-duplicate", 3),
      }),
    ).rejects.toMatchObject({ code: "record_exists" });
    expect(host.getSnapshot(binding).items.filter((item) => item.kind === "tool")).toHaveLength(1);
  });
});
