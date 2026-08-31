import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
  },
}));

import { registerVideoAnalysisSettingsIpc } from "./videoAnalysisSettingsIpc";

describe("video analysis settings IPC", () => {
  beforeEach(() => handlers.clear());

  it("registers renderer-safe read and write handlers", async () => {
    const stored = {
      schemaVersion: 1 as const,
      engineOrigin: "http://127.0.0.1:8931",
      hasApiToken: true,
      externalInference: false,
      engineSourceRetention: "delete_after_analysis" as const,
    };
    const store = { read: vi.fn(() => stored), write: vi.fn(() => stored) };
    registerVideoAnalysisSettingsIpc(store);

    expect([...handlers.keys()]).toEqual([
      "nomi:settings:video-analysis-get",
      "nomi:settings:video-analysis-set",
    ]);
    expect(await handlers.get("nomi:settings:video-analysis-get")?.({})).toEqual(stored);
    expect(await handlers.get("nomi:settings:video-analysis-set")?.({}, { apiToken: "secret" })).toEqual(stored);
    expect(JSON.stringify(await handlers.get("nomi:settings:video-analysis-get")?.({}))).not.toContain("secret");
  });
});
