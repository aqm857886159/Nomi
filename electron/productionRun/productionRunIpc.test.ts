import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

// 已加固通道（assertTrustedSender）只认「当前登记的主窗口主帧」，
// 所以测试要先立一个假主窗口，再用 trustedEvent 当事件传进 handler。
const harness = vi.hoisted(() => {
  const MAIN_FRAME_ROUTING_ID = 7;
  const APP_ENTRY_URL = "file:///app/index.html";
  const byContents = new Map<object, object>();
  class FakeBrowserWindow {
    readonly webContents: { mainFrame: { routingId: number }; isDestroyed(): boolean; getURL(): string };
    constructor() {
      this.webContents = {
        mainFrame: { routingId: MAIN_FRAME_ROUTING_ID },
        isDestroyed: () => false,
        getURL: () => APP_ENTRY_URL,
      };
      byContents.set(this.webContents, this);
    }
    isDestroyed(): boolean {
      return false;
    }
    static fromWebContents(contents: object): object | null {
      return byContents.get(contents) ?? null;
    }
  }
  return { FakeBrowserWindow, MAIN_FRAME_ROUTING_ID, APP_ENTRY_URL };
});

vi.mock("electron", () => ({
  BrowserWindow: harness.FakeBrowserWindow,
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
  },
}));

import { registerProductionRunIpc } from "./productionRunIpc";
import { setMainWindow } from "../mainWindowRegistry";

/** 立一个假主窗口并返回它发来的合法事件（未登记主窗口时守卫一律拒绝）。 */
function trustedEvent(): { sender: unknown; senderFrame: unknown } {
  const win = new harness.FakeBrowserWindow();
  setMainWindow(win as never);
  return {
    sender: win.webContents,
    senderFrame: { routingId: harness.MAIN_FRAME_ROUTING_ID, url: harness.APP_ENTRY_URL },
  };
}

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
      "nomi:production-runs:materialize-storyboard",
      "nomi:production-runs:events",
    ]);
  });

  it("normalizes create-draft input without accepting live authority", async () => {
    const repo = repository();
    registerProductionRunIpc(repo as never);

    await handlers.get("nomi:production-runs:create-draft")?.(trustedEvent(), {
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
    await expect(handlers.get("nomi:production-runs:read")?.(trustedEvent(), { projectId: "../escape", runId: "run-1" }))
      .rejects.toThrow("Invalid project id");
    await expect(handlers.get("nomi:production-runs:command")?.(trustedEvent(), {
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

  // 2026-08-18 走查逮到：run.control 在白名单里，payload 构造器却没有它的分支，于是掉进
  // 末尾那句 artifact.adopt 的兜底 return —— 用户在 Nomi 里点「取消制作」只会看到
  // 「Invalid artifact id」。暂停/继续/取消从渲染端就没通过。根因是「默认分支替别人猜形状」，
  // 所以既补 run.control，也把兜底改成响亮报错。
  it("carries a renderer pause/resume/cancel through instead of mistaking it for an artifact command", async () => {
    const repo = repository();
    registerProductionRunIpc(repo as never);
    const command = {
      commandId: "cmd-cancel",
      expectedRevision: 2,
      type: "run.control",
      payload: { action: "cancel" },
      issuedAt: "2026-08-08T08:00:00.000Z",
    };

    await handlers.get("nomi:production-runs:command")?.(trustedEvent(), { projectId: "project-1", runId: "run-1", command });

    expect(repo.execute).toHaveBeenCalledWith("project-1", "run-1", expect.objectContaining({
      type: "run.control",
      payload: { action: "cancel" },
    }));
    await expect(handlers.get("nomi:production-runs:command")?.(trustedEvent(), {
      projectId: "project-1",
      runId: "run-1",
      command: { ...command, commandId: "cmd-bogus", payload: { action: "explode" } },
    })).rejects.toThrow("Invalid production control action");
  });

  it("rejects a project/run mismatch before executing a command", async () => {
    const repo = repository();
    repo.read.mockReturnValue(fakeRun("project-other"));
    registerProductionRunIpc(repo as never);

    await expect(handlers.get("nomi:production-runs:command")?.(trustedEvent(), {
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

    await handlers.get("nomi:production-runs:command")?.(trustedEvent(), { projectId: "project-1", runId: "run-1", command });
    await handlers.get("nomi:production-runs:events")?.(trustedEvent(), { projectId: "project-1", runId: "run-1", afterCursor: 3 });

    expect(repo.execute).toHaveBeenCalledWith("project-1", "run-1", command);
    expect(repo.readEvents).toHaveBeenCalledWith("project-1", "run-1", 3);
  });

  it("reduces a gate decision to its decision fields before crossing into the repository", async () => {
    const repo = repository();
    registerProductionRunIpc(repo as never);

    await handlers.get("nomi:production-runs:command")?.(trustedEvent(), {
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

    await handlers.get("nomi:production-runs:command")?.(trustedEvent(), {
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
