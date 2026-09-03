import { describe, expect, it } from "vitest";

import type { ProjectAgentMutation } from "../shared/projectAgentContracts";
import * as reducerModule from "./projectAgentReducer";
import { ProjectAgentReducerError, reduceProjectAgentMutation } from "./projectAgentReducer";
import {
  __projectAgentFullValidationCountForTests,
  createInitialProjectAgentState,
  snapshotProjectAgentHostState,
} from "./projectAgentState";

const binding = {
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 3,
} as const;
const createdAt = "2026-08-28T00:00:00.000Z";

type ThreadPutMutation = Extract<ProjectAgentMutation, { type: "thread.put" }>;

function threadMutation(index: number): ThreadPutMutation {
  return {
    commandId: `thread-update-${index}`,
    expectedRevision: index,
    binding,
    sender: { kind: "renderer", senderId: "renderer-a" },
    type: "thread.put",
    payload: {
      thread: {
        threadId: "thread-a",
        title: `Title ${index}`,
        createdAt,
        updatedAt: new Date(Date.parse(createdAt) + index).toISOString(),
      },
      makeActive: true,
    },
  };
}

function enqueueMutation(index: number): ProjectAgentMutation {
  const turnId = `turn-${index}`;
  const timestamp = new Date(Date.parse(createdAt) + index).toISOString();
  const contextRef = {
    binding: {
      project: binding,
      threadId: "thread-a",
      sessionKey: `nomi:project-agent:${binding.immutableProjectUuid}:g${binding.projectGeneration}`,
    },
    recordId: "context-a",
    contextRevision: 7,
  } as const;
  return {
    commandId: `enqueue-${index}`,
    expectedRevision: index,
    binding,
    sender: { kind: "renderer", senderId: "renderer-a" },
    type: "turn.enqueue",
    payload: {
      thread: { threadId: "thread-a", createdAt, updatedAt: timestamp },
      turn: {
        turnId,
        threadId: "thread-a",
        status: "queued",
        retryable: false,
        deviated: false,
        executionToken: `token-${index}`,
        model: { id: "model-a", version: 1 },
        skillVersions: [],
        capabilityVersions: [{ id: "canvas.read", version: 1 }],
        contextRef,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      userItem: {
        kind: "user",
        itemId: `user-${index}`,
        threadId: "thread-a",
        turnId,
        status: "done",
        retryable: false,
        deviated: false,
        text: `queued request ${index}`,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      queueItem: {
        queueItemId: `queue-${index}`,
        threadId: "thread-a",
        turnId,
        status: "queued",
        retryable: false,
        deviated: false,
        binding,
        target: { kind: "canvas", nodeIds: ["node-a"] },
        preconditions: { nodes: [{ nodeId: "node-a", contentHash: "node-hash" }] },
        contextRef,
        model: { id: "model-a", version: 1 },
        skillVersions: [],
        capabilityVersions: [{ id: "canvas.read", version: 1 }],
        policyRevision: 1,
        attachmentRefs: [],
        originSurface: { surfaceId: "surface-a", kind: "canvas" },
        enqueuedAt: timestamp,
        updatedAt: timestamp,
      },
    },
  };
}

describe("ProjectAgent reducer bounded idempotency history", () => {
  it("keeps a fixed recent receipt window without revalidating the whole trusted state", () => {
    let state = createInitialProjectAgentState(binding);
    const validationCount = __projectAgentFullValidationCountForTests();
    let firstReceipt: ReturnType<typeof reduceProjectAgentMutation>["receipt"] | undefined;

    for (let index = 0; index < 1_000; index += 1) {
      const result = reduceProjectAgentMutation(state, threadMutation(index));
      if (index === 0) firstReceipt = result.receipt;
      state = result.state;
    }

    const bounded = state as typeof state & {
      commandLedgerHighWater: number;
      recentAppliedCommands: readonly { appliedRevision: number }[];
    };
    expect(bounded.commandLedgerHighWater).toBe(1_000);
    expect(bounded.recentAppliedCommands).toHaveLength(64);
    expect(bounded.recentAppliedCommands[0]?.appliedRevision).toBe(937);
    expect(bounded.recentAppliedCommands.at(-1)?.appliedRevision).toBe(1_000);
    expect(__projectAgentFullValidationCountForTests()).toBe(validationCount);
    expect(JSON.stringify(state).length).toBeLessThan(100_000);

    const recent = reduceProjectAgentMutation(state, threadMutation(999));
    expect(recent).toMatchObject({ replayed: true, snapshotRequired: false });
    if (recent.snapshotRequired) throw new Error("recent receipt unexpectedly compacted");
    expect(recent.patch).toEqual(recent.receipt.patch);

    const compactReplay = (
      reducerModule as typeof reducerModule & {
        replayProjectAgentCompactCommand: (
          snapshot: typeof state,
          mutation: ProjectAgentMutation,
          receipt: { commandId: string; mutationHash: string; appliedRevision: number },
        ) => ReturnType<typeof reduceProjectAgentMutation>;
      }
    ).replayProjectAgentCompactCommand;
    expect(compactReplay).toBeTypeOf("function");
    const compactReceipt = {
      commandId: firstReceipt!.commandId,
      mutationHash: firstReceipt!.mutationHash,
      appliedRevision: firstReceipt!.appliedRevision,
    };
    const old = compactReplay(state, threadMutation(0), compactReceipt);
    expect(old).toMatchObject({
      replayed: true,
      snapshotRequired: true,
      patch: null,
      receipt: compactReceipt,
    });
    expect(old.state).toBe(state);
    expect(() =>
      compactReplay(
        state,
        {
          ...threadMutation(0),
          payload: {
            ...threadMutation(0).payload,
            thread: { ...threadMutation(0).payload.thread, title: "changed" },
          },
        } as ProjectAgentMutation,
        compactReceipt,
      ),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "command_id_conflict" }));
  });

  // 2026-09-03：这条此前用 `performance.now() < 8_000` 当判据，是负载敏感 flake 的另一条腿
  // ——它在本轮全量 gates（1122 个测试文件并行）里实测 8145ms 红，只超 1.8%，没有任何算法改动。
  // 上一版注释已经把预算从 2s 放宽到 8s 过一次；再放宽只是把同一枚地雷往后埋。
  //
  // 换判据：这里怕的「cubic」有确切机制——assertProjectAgentHostState 内部有一段
  // `for (const approval of state.proposalApprovals)`，循环体里是 `state.queue.find` +
  // `state.turns.find`（projectAgentState.ts:660-682），即单次全量校验本身就是 O(队列×审批)。
  // 只要这个全量校验**每条命令都跑一次**，N 条命令就把它抬成 cubic。所以真正要钉的不变量是
  // 「入队热路径一次全量状态校验都不许触发」——而 fullValidationCount 正是它的直接观测点
  // （projectAgentState.ts 在 assertProjectAgentHostState 前一行自增），本文件上一条用例
  // 已经是这个写法。计数器与机器快慢无关，于是墙钟彻底退出判据。
  const QUEUE_DEPTH = 256;

  it("keeps queued-turn invariant validation out of the cubic growth path", () => {
    let state = createInitialProjectAgentState(binding);
    const validationsBefore = __projectAgentFullValidationCountForTests();

    for (let index = 0; index < QUEUE_DEPTH; index += 1) {
      state = reduceProjectAgentMutation(state, enqueueMutation(index)).state;
    }

    expect(state.turns).toHaveLength(QUEUE_DEPTH);
    expect(state.queue).toHaveLength(QUEUE_DEPTH);
    // 队列涨到 QUEUE_DEPTH 的整个过程里，全量校验必须一次都没跑。这才是 cubic 与否的分水岭；
    // 命令数只要够让队列真的变深即可，判据本身不随 N 变化，所以不必再烧 1,000 条命令的 CPU。
    expect(__projectAgentFullValidationCountForTests() - validationsBefore).toBe(0);

    // 阳性对照（内建，防止上面退化成永远为真的空断言）：把状态拷成一份「不受信」的等价对象，
    // 强制走一次真正的全量校验——它必须①能通过（证明热路径跳过校验没有藏下非法状态）
    // ②让计数器正好 +1（证明这个计数器确实是活信号）。
    const untrusted = JSON.parse(JSON.stringify(state)) as unknown;
    const revalidated = snapshotProjectAgentHostState(untrusted);
    expect(revalidated.queue).toHaveLength(QUEUE_DEPTH);
    expect(__projectAgentFullValidationCountForTests() - validationsBefore).toBe(1);
  });
});
