import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
  },
}));

import { registerVideoAnalysisIpc } from "./ipc";

describe("video analysis IPC", () => {
  beforeEach(() => handlers.clear());

  it("accepts only a main-resolved project asset and exposes no result writer", async () => {
    const service = {
      start: vi.fn(() => ({ analysisId: "analysis-1", status: "queued" })),
      resumeProject: vi.fn(() => []),
      cancel: vi.fn(),
      cleanup: vi.fn(async () => ({ attempted: 0, removed: 0, failed: 0 })),
    };
    const repository = {
      list: vi.fn(() => []),
      read: vi.fn(() => null),
      readResult: vi.fn(() => null),
      readEvidence: vi.fn(() => null),
    };
    registerVideoAnalysisIpc({
      service: service as never,
      repository: repository as never,
      resolveAssetSource: (projectId, assetUrl) => {
        if (projectId !== "project-a" || assetUrl !== "nomi-local://asset/project-a/assets/reference.mp4") {
          throw new Error("invalid project asset");
        }
        return { kind: "project_asset", relativePath: "assets/reference.mp4" };
      },
      probeHealth: vi.fn(async () => ({ configured: true, reachable: true, engine: "eccut-local", version: "v2", error: null })),
      resolveActiveProjectId: () => "project-a",
    });

    const start = handlers.get("nomi:video-analysis:start");
    await expect(start?.({}, {
      projectId: "project-a",
      assetUrl: "nomi-local://asset/project-a/assets/reference.mp4",
      sourceNodeId: "video-node-1",
    })).resolves.toMatchObject({ status: "queued" });
    expect(service.start).toHaveBeenCalledWith({
      projectId: "project-a",
      source: { kind: "project_asset", relativePath: "assets/reference.mp4" },
      sourceNodeId: "video-node-1",
    });
    await expect(start?.({}, { projectId: "project-a", assetUrl: "/Users/me/private.mp4" })).rejects.toThrow(/asset/i);
    expect([...handlers.keys()]).toEqual([
      "nomi:video-analysis:start",
      "nomi:video-analysis:list",
      "nomi:video-analysis:read",
      "nomi:video-analysis:cancel",
      "nomi:video-analysis:cleanup",
      "nomi:video-analysis:health",
    ]);
    expect([...handlers.keys()].some((channel) => channel.includes("write") || channel.includes("complete"))).toBe(false);
  });
});
