import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
  },
}));

import { registerProductionRunIpc } from "./productionRunIpc";

function fakeRun(projectId = "project-1") {
  return {
    runId: "run-1",
    projectId,
    revision: 2,
    status: "running",
    snapshotCursor: 3,
  };
}

function repository() {
  return {
    list: vi.fn(() => [fakeRun()]),
    read: vi.fn((_projectId: string, _runId: string) => fakeRun()),
    create: vi.fn(() => fakeRun()),
    execute: vi.fn(() => ({ run: fakeRun(), events: [] })),
    readEvents: vi.fn(() => []),
  };
}

describe("production run IPC", () => {
  beforeEach(() => handlers.clear());

  it("registers the narrow list/read/create/command/events bridge", () => {
    registerProductionRunIpc(repository() as never);
    expect([...handlers.keys()]).toEqual([
      "nomi:production-runs:list",
      "nomi:production-runs:read",
      "nomi:production-runs:create-draft",
      "nomi:production-runs:command",
      "nomi:production-runs:events",
    ]);
  });

  it("normalizes create-draft input without accepting live authority", async () => {
    const repo = repository();
    registerProductionRunIpc(repo as never);

    await handlers.get("nomi:production-runs:create-draft")?.({}, {
      projectId: "project-1",
      playbook: { name: "brand.promo", version: "1.0.0" },
      origin: { host: "codex" },
      approval: { approved: true },
      maxSpend: 999,
    });

    expect(repo.create).toHaveBeenCalledWith({
      projectId: "project-1",
      playbook: { name: "brand.promo", version: "1.0.0" },
      origin: { host: "codex" },
    });
  });

  it("rejects malformed IDs and unknown renderer commands", async () => {
    registerProductionRunIpc(repository() as never);
    await expect(handlers.get("nomi:production-runs:read")?.({}, { projectId: "../escape", runId: "run-1" }))
      .rejects.toThrow("Invalid project id");
    await expect(handlers.get("nomi:production-runs:command")?.({}, {
      projectId: "project-1",
      runId: "run-1",
      command: {
        commandId: "cmd-1",
        expectedRevision: 2,
        type: "budget.entry",
        payload: {},
        issuedAt: "2026-08-08T08:00:00.000Z",
      },
    })).rejects.toThrow("Production command is not available to the renderer");
  });

  it("rejects a project/run mismatch before executing a command", async () => {
    const repo = repository();
    repo.read.mockReturnValue(fakeRun("project-other"));
    registerProductionRunIpc(repo as never);

    await expect(handlers.get("nomi:production-runs:command")?.({}, {
      projectId: "project-1",
      runId: "run-1",
      command: {
        commandId: "cmd-1",
        expectedRevision: 2,
        type: "run.status",
        payload: { status: "pausing" },
        issuedAt: "2026-08-08T08:00:00.000Z",
      },
    })).rejects.toThrow("Production run project mismatch");
    expect(repo.execute).not.toHaveBeenCalled();
  });

  it("passes a validated revision and monotonic cursor to the repository", async () => {
    const repo = repository();
    registerProductionRunIpc(repo as never);
    const command = {
      commandId: "cmd-1",
      expectedRevision: 2,
      type: "run.status",
      payload: { status: "pausing" },
      issuedAt: "2026-08-08T08:00:00.000Z",
    };

    await handlers.get("nomi:production-runs:command")?.({}, { projectId: "project-1", runId: "run-1", command });
    await handlers.get("nomi:production-runs:events")?.({}, { projectId: "project-1", runId: "run-1", afterCursor: 3 });

    expect(repo.execute).toHaveBeenCalledWith("project-1", "run-1", command);
    expect(repo.readEvents).toHaveBeenCalledWith("project-1", "run-1", 3);
  });

  it("reduces a gate decision to its decision fields before crossing into the repository", async () => {
    const repo = repository();
    registerProductionRunIpc(repo as never);

    await handlers.get("nomi:production-runs:command")?.({}, {
      projectId: "project-1",
      runId: "run-1",
      command: {
        commandId: "cmd-gate",
        expectedRevision: 2,
        type: "gate.decide",
        payload: {
          gateId: "gate-contract",
          status: "approved",
          approval: { maxSpend: 999999, allowedProviders: ["attacker"] },
        },
        issuedAt: "2026-08-08T08:00:00.000Z",
      },
    });

    expect(repo.execute).toHaveBeenCalledWith("project-1", "run-1", {
      commandId: "cmd-gate",
      expectedRevision: 2,
      type: "gate.decide",
      payload: { gateId: "gate-contract", status: "approved" },
      issuedAt: "2026-08-08T08:00:00.000Z",
    });
  });

  it("preserves only validated storyboard bindings when crossing into the service", async () => {
    const service = {
      listFull: vi.fn(() => [fakeRun()]),
      readFull: vi.fn(() => fakeRun()),
      createDraft: vi.fn(() => fakeRun()),
      command: vi.fn(async () => ({ run: fakeRun(), events: [] })),
      readEvents: vi.fn(async () => ({ events: [], nextCursor: 3 })),
    };
    registerProductionRunIpc(service as never);

    await handlers.get("nomi:production-runs:command")?.({}, {
      projectId: "project-1",
      runId: "run-1",
      command: {
        commandId: "cmd-attach",
        expectedRevision: 2,
        type: "plan.attach",
        payload: {
          artifactId: "artifact-storyboard-v1",
          bindings: [{ nodeId: "shot-1", provider: "kie", model: "bytedance/seedance-2", stageId: "generate", secret: "drop-me" }],
          jobs: [{ provider: "attacker" }],
          gate: { status: "approved" },
        },
        issuedAt: "2026-08-08T08:00:00.000Z",
      },
    });

    expect(service.command).toHaveBeenCalledWith("project-1", "run-1", {
      commandId: "cmd-attach",
      expectedRevision: 2,
      type: "plan.attach",
      payload: {
        artifactId: "artifact-storyboard-v1",
        bindings: [{ nodeId: "shot-1", provider: "kie", model: "bytedance/seedance-2", stageId: "generate" }],
      },
      issuedAt: "2026-08-08T08:00:00.000Z",
    });
  });
});
