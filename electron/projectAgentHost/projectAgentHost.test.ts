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
import { PROJECT_AGENT_RECENT_COMMAND_LIMIT } from "../shared/projectAgentContracts";
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

  it("keeps a same-entity snapshot bounded without steady-state ledger rescans", async () => {
    // The sibling "acknowledged-byte fsync" test flips durability to "durable".
    // afterEach restores it, but pin it here so a regression there cannot quietly
    // turn this test into a per-command fsync storm.
    setDurabilityMode("ephemeral");
    const durableRepository = repository();
    const paths = durableRepository.pathsFor(binding);
    const host = createOfflineProjectAgentHost({ repository: durableRepository });

    // A ledger rescan is exactly one thing: readRegular() opening the ledger
    // read-only and parsing it whole. Spying on fs.readFileSync cannot see that
    // — readRegular passes a numeric fd, so a `String(arg) === paths.ledger`
    // filter never matches anything. The previous version of this test asserted
    // exactly that, which made its headline claim vacuous: re-run with the
    // ledger cache force-disabled, it observed 597 real rescans and still
    // asserted zero. Watch open() instead, which is the actual mechanism.
    const ACCESS_MODE = fs.constants.O_RDONLY | fs.constants.O_WRONLY | fs.constants.O_RDWR;
    const openSpy = vi.spyOn(fs, "openSync");
    const partitionOpens = (): number =>
      openSpy.mock.calls.filter(([target]) => String(target).startsWith(paths.dir)).length;
    const ledgerRescans = (): number =>
      openSpy.mock.calls.filter(
        ([target, flags]) =>
          String(target) === paths.ledger &&
          typeof flags === "number" &&
          (flags & ACCESS_MODE) === fs.constants.O_RDONLY,
      ).length;

    const windowLimit = PROJECT_AGENT_RECENT_COMMAND_LIMIT;
    const sample = Math.floor(windowLimit / 2);
    let revision = 0;
    async function runCommands(count: number): Promise<void> {
      for (let index = 0; index < count; index += 1) {
        // Fixed-width ids keep per-command snapshot bytes comparable across samples.
        const commandId = `bounded-command-${String(revision + 1).padStart(4, "0")}`;
        await host.dispatch(threadMutation(commandId, revision, "thread-a"));
        revision += 1;
      }
    }
    function measure() {
      return {
        opens: partitionOpens(),
        rescans: ledgerRescans(),
        snapshot: fs.statSync(paths.snapshot).size,
        ledger: fs.statSync(paths.ledger).size,
      };
    }

    // Warm-up fills the recent-command window; everything after it is steady state.
    await runCommands(windowLimit);
    const warm = measure();
    await runCommands(sample);
    const first = measure();
    await runCommands(sample);
    const second = measure();

    const snapshot = host.getSnapshot(binding);
    expect(snapshot).toMatchObject({ hostRevision: revision, commandLedgerHighWater: revision });
    // Derived from the declared limit rather than a copied 64.
    expect(snapshot.recentAppliedCommands).toHaveLength(windowLimit);

    // No steady-state rescans. A one-time warm-up scan would be legitimate, so
    // this is scoped to the two post-warm-up samples, not to the whole run.
    expect(second.rescans - warm.rescans).toBe(0);

    // Per-command work is constant: two disjoint equal-size samples open exactly
    // the same number of files. This is the inductive step that makes a small
    // command count sufficient — work per command that is flat across two
    // windows after warm-up stays flat, so dispatching 1,000 only samples the
    // same line further out. The 1,000-command version cost 14s-37s of wall
    // clock depending on machine load (measured on the same commit) against a
    // 30s testTimeout, and proved nothing this does not.
    expect(second.opens - first.opens).toBe(first.opens - warm.opens);

    // The snapshot stays bounded while the append-only ledger genuinely grows.
    // Ledger growth is the positive control: it proves the samples did real
    // durable work, so "zero rescans" cannot pass by doing nothing at all.
    // A snapshot that accumulated history instead of a bounded window would grow
    // by roughly the ledger delta (one receipt per command); a bounded one grows
    // only by a few dozen bytes of revision counters.
    const ledgerGrowth = second.ledger - first.ledger;
    const snapshotGrowth = second.snapshot - first.snapshot;
    expect(ledgerGrowth).toBeGreaterThan(0);
    expect(snapshotGrowth * 10).toBeLessThan(ledgerGrowth);
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
