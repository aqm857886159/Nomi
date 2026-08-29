import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  handle: vi.fn(),
  assertTrustedSender: vi.fn(),
  importPackage: vi.fn(),
  inspectZip: vi.fn(),
  parseZip: vi.fn(),
}));

vi.mock("electron", () => ({ ipcMain: { handle: state.handle } }));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: state.assertTrustedSender }));
vi.mock("./skillCapability", () => ({ deriveSkillNeeds: vi.fn(() => ({ providers: [] })) }));
vi.mock("./skillStore", () => ({ readSkillRecords: vi.fn(() => []) }));
vi.mock("./skillPackage", () => ({
  deleteUserSkill: vi.fn(),
  exportSkillPackageByName: vi.fn(),
  importSkillPackageToUserDir: state.importPackage,
}));
vi.mock("./skillZipImport", () => ({
  inspectSkillZipImportPayload: state.inspectZip,
  parseSkillZipPackage: state.parseZip,
}));

import { registerSkillIpc } from "./skillIpc";

beforeEach(() => {
  vi.clearAllMocks();
  state.inspectZip.mockReturnValue({ kind: "not_zip" });
  state.importPackage.mockReturnValue({ ok: true, dirName: "skill", skillName: "skill", manifest: null });
});

describe("Skill import IPC authority", () => {
  it("uses asynchronous IPC and checks the sender before reading the payload", async () => {
    const syncChannels = new Map<string, (...args: unknown[]) => unknown>();
    registerSkillIpc((channel, handler) => syncChannels.set(channel, handler));

    expect(syncChannels.has("nomi:skill:import")).toBe(false);
    expect(state.handle).toHaveBeenCalledWith("nomi:skill:import", expect.any(Function));
    const handler = state.handle.mock.calls[0]?.[1] as (event: unknown, payload: unknown) => Promise<unknown>;
    const event = { sender: "main-window" };
    await expect(handler(event, { dirName: "skill", files: { "SKILL.md": "body" } })).resolves
      .toMatchObject({ ok: true });
    expect(state.assertTrustedSender).toHaveBeenCalledWith(event);
    expect(state.inspectZip).toHaveBeenCalledTimes(1);
  });

  it("does not inspect or import an untrusted renderer payload", async () => {
    state.assertTrustedSender.mockImplementationOnce(() => {
      throw new Error("untrusted");
    });
    registerSkillIpc(() => undefined);
    const handler = state.handle.mock.calls[0]?.[1] as (event: unknown, payload: unknown) => Promise<unknown>;
    await expect(handler({ sender: "foreign" }, { kind: "zip" })).rejects.toThrow("untrusted");
    expect(state.inspectZip).not.toHaveBeenCalled();
    expect(state.importPackage).not.toHaveBeenCalled();
  });
});
