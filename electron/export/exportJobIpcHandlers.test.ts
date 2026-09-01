import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommittedSurfaceProjectSelection } from "../capabilityCore/canvasReadSurfaceRegistry";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  return {
    handlers,
    send: vi.fn(),
    subscribe: vi.fn(),
    startExportJob: vi.fn(),
    writeExportTempInput: vi.fn(),
    finishExportTempInput: vi.fn(),
    listExportJobs: vi.fn(),
    getExportJobStatus: vi.fn(),
    cancelExportJob: vi.fn(),
    showExportInFolder: vi.fn(),
  };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) => mocks.handlers.set(channel, handler),
  },
  webContents: {
    fromId: () => ({ isDestroyed: () => false, send: mocks.send }),
  },
}));

vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: vi.fn() }));

vi.mock("./exportJobs", () => ({
  startExportJob: mocks.startExportJob,
  writeExportTempInput: mocks.writeExportTempInput,
  finishExportTempInput: mocks.finishExportTempInput,
  listExportJobs: mocks.listExportJobs,
  getExportJobStatus: mocks.getExportJobStatus,
  cancelExportJob: mocks.cancelExportJob,
  showExportInFolder: mocks.showExportInFolder,
  subscribeExportJobEvents: mocks.subscribe,
}));

const PROJECT_A: CommittedSurfaceProjectSelection = Object.freeze({
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
  canonicalRootDigest: "root-a",
});

const PROJECT_B: CommittedSurfaceProjectSelection = Object.freeze({
  projectId: "project-b",
  immutableProjectUuid: "22222222-2222-4222-8222-222222222222",
  projectGeneration: 2,
  canonicalRootDigest: "root-b",
});

function event(id = 7) {
  return {
    sender: {
      id,
      once: vi.fn(),
    },
  };
}

describe("export job IPC project authority", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.subscribe.mockReturnValue(() => undefined);
  });

  it("injects the current main-issued project selection into every ExportJob operation", async () => {
    let current: CommittedSurfaceProjectSelection | null = PROJECT_A;
    const { registerExportJobIpc } = await import("./exportJobIpc");
    registerExportJobIpc({ getActiveProjectSelection: () => current });

    const ipcEvent = event(8);
    await mocks.handlers.get("nomi:exports:start-job")!(ipcEvent, { projectId: "renderer-claim" });
    await mocks.handlers.get("nomi:exports:list")!(ipcEvent);
    await mocks.handlers.get("nomi:exports:write-temp-input")!(ipcEvent, { jobId: "job-a", chunk: [1] });
    await mocks.handlers.get("nomi:exports:finish-temp-input")!(ipcEvent, { jobId: "job-a" });
    await mocks.handlers.get("nomi:exports:status")!(ipcEvent, "job-a");
    await mocks.handlers.get("nomi:exports:cancel")!(ipcEvent, "job-a");

    expect(mocks.startExportJob).toHaveBeenCalledWith({ projectId: "renderer-claim" }, PROJECT_A);
    expect(mocks.listExportJobs).toHaveBeenCalledWith(PROJECT_A);
    expect(mocks.writeExportTempInput).toHaveBeenCalledWith(PROJECT_A, { jobId: "job-a", chunk: [1] });
    expect(mocks.finishExportTempInput).toHaveBeenCalledWith(PROJECT_A, { jobId: "job-a" });
    expect(mocks.getExportJobStatus).toHaveBeenCalledWith(PROJECT_A, "job-a");
    expect(mocks.cancelExportJob).toHaveBeenCalledWith(PROJECT_A, "job-a");

    current = null;
    await expect(mocks.handlers.get("nomi:exports:list")!(ipcEvent)).rejects.toThrow(/active project/i);
    await expect(mocks.handlers.get("nomi:exports:write-temp-input")!(ipcEvent, { jobId: "job-a", chunk: [1] })).rejects.toThrow(/active project/i);
    await expect(mocks.handlers.get("nomi:exports:finish-temp-input")!(ipcEvent, { jobId: "job-a" })).rejects.toThrow(/active project/i);
    await expect(mocks.handlers.get("nomi:exports:status")!(ipcEvent, "job-a")).rejects.toThrow(/active project/i);
    await expect(mocks.handlers.get("nomi:exports:cancel")!(ipcEvent, "job-a")).rejects.toThrow(/active project/i);
  });

  it("stops forwarding an old project's event after project rotation", async () => {
    let current: CommittedSurfaceProjectSelection | null = PROJECT_A;
    const { registerExportJobIpc } = await import("./exportJobIpc");
    registerExportJobIpc({ getActiveProjectSelection: () => current });
    const ipcEvent = event();
    await mocks.handlers.get("nomi:exports:status")!(ipcEvent, "job-a");
    const forward = mocks.subscribe.mock.calls[0][0] as (payload: unknown) => void;

    forward({ projectId: "project-a", snapshot: { projectIdentity: PROJECT_A } });
    expect(mocks.send).toHaveBeenCalledTimes(1);

    current = PROJECT_B;
    forward({ projectId: "project-a", snapshot: { projectIdentity: PROJECT_A } });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    forward({ projectId: "project-b", snapshot: { projectIdentity: PROJECT_B } });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
});
