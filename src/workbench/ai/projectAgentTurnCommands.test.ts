import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectAgentHostState } from "../../../electron/shared/projectAgentContracts";
import { createInitialProjectAgentState } from "../../../electron/projectAgentHost/projectAgentState";

const deps = vi.hoisted(() => ({
  command: vi.fn(),
  onEvent: vi.fn(() => () => undefined),
  state: null as null | { subscriptionId: string; snapshot: ProjectAgentHostState },
  applySnapshot: vi.fn(),
  install: vi.fn(),
}));

vi.mock("./projectAgentClient", () => ({
  projectAgentClient: {
    command: deps.command,
    onEvent: deps.onEvent,
  },
}));
vi.mock("./projectAgentProjectionStore", () => ({
  projectAgentProjectionStore: {
    getState: () => deps.state,
    applySnapshot: deps.applySnapshot,
  },
}));
vi.mock("./projectAgentUiProjection", () => ({ installProjectAgentSnapshotToUi: deps.install }));

import {
  decideProjectAgentTool,
  enqueueProjectAgentTurn,
  stopProjectAgentTurn,
  subscribeProjectAgentEvents,
} from "./projectAgentTurnCommands";

const binding = {
  projectId: "turn-command-project",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
} as const;

beforeEach(() => {
  deps.command.mockReset();
  deps.onEvent.mockClear();
  deps.applySnapshot.mockReset();
  deps.install.mockReset();
  const snapshot = createInitialProjectAgentState(binding);
  deps.state = { subscriptionId: "subscription-a", snapshot };
  deps.command.mockImplementation(async (command: { type: string }) => ({
    state: { ...snapshot, hostRevision: snapshot.hostRevision + 1 },
    patch: null,
    replayed: false,
    command,
  }));
});

describe("ProjectAgent turn commands", () => {
  it("enqueues a canonical turn with an explicit target and ephemeral model history", async () => {
    const result = await enqueueProjectAgentTurn({
      turnId: "turn-from-caller",
      request: {
        prompt: "rewrite this",
        capability: "creation-editor",
        history: { kind: "ephemeral" },
        projectId: binding.projectId,
        skillKey: "workbench.creation.general",
      },
      displayPrompt: "rewrite this",
      target: { kind: "document", documentId: "document-1", anchor: { kind: "whole-document" } },
      originSurface: { surfaceId: "creation-ai-panel", kind: "document" },
    });

    const command = deps.command.mock.calls[0][0];
    expect(command.type).toBe("turn.enqueue");
    expect(command.payload.request.history).toEqual({ kind: "ephemeral" });
    expect(command.payload.thread.provenance).toEqual({ kind: "canonical" });
    expect(command.payload.queueItem.target).toEqual({
      kind: "document",
      documentId: "document-1",
      anchor: { kind: "whole-document" },
    });
    expect(result.turnId).toBe("turn-from-caller");
    expect(command.payload.turn.turnId).toBe("turn-from-caller");
    expect(deps.applySnapshot).toHaveBeenCalledTimes(1);
    expect(deps.install).toHaveBeenCalledTimes(1);
  });

  it("routes tool decisions and stop through semantic Host mutations", async () => {
    await decideProjectAgentTool({ turnId: "turn-a", toolCallId: "call-a", decision: { ok: false, message: "no" } });
    await stopProjectAgentTurn("turn-a");
    expect(deps.command.mock.calls.map(([command]) => command.type)).toEqual(["tool.decision", "turn.transition"]);
    expect(deps.command.mock.calls[1][0].payload).toMatchObject({ turnId: "turn-a", status: "stopped" });
  });

  it("forwards live execution events without creating a second state owner", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProjectAgentEvents(listener);
    expect(deps.onEvent).toHaveBeenCalledWith(listener);
    unsubscribe();
  });
});
