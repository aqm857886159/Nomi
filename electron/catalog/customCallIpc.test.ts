import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  ipcMain: { handle: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

import {
  buildCustomCallAiInstruction,
  CUSTOM_CALL_RETURN_CONTRACT,
  CUSTOM_CALL_TEMPLATES,
  CUSTOM_CALL_VARIABLES,
} from "./customCallContract";
import { registerCustomCallIpc } from "./customCallIpc";

describe("custom-call contract IPC", () => {
  it("AI 题面禁止引用角色提升，也禁止在材料不足时猜接口", () => {
    const instruction = buildCustomCallAiInstruction({
      modelKey: "kling-3.0-omni",
      kind: "video",
      baseUrl: "https://relay.example",
      material: "",
    });
    expect(instruction).toMatch(/Never promote .*images\[0\].*firstFrame/i);
    expect(instruction).toMatch(/Never invent endpoints/i);
    expect(instruction).not.toMatch(/best guess/i);
    expect(instruction).not.toMatch(/fall back to the most common/i);
  });

  it("exposes the same variables, return contract, and templates used by the runner and AI prompt", () => {
    const syncHandlers = new Map<string, (...args: never[]) => unknown>();
    registerCustomCallIpc((channel, handler) => syncHandlers.set(channel, handler));

    const handler = syncHandlers.get("nomi:model-catalog:custom-call:contract");
    expect(handler).toBeTypeOf("function");
    expect(handler?.()).toEqual({
      variables: CUSTOM_CALL_VARIABLES.map(({ name, type }) => ({ name, type })),
      returnContract: CUSTOM_CALL_RETURN_CONTRACT,
      templates: CUSTOM_CALL_TEMPLATES,
    });
  });
});
