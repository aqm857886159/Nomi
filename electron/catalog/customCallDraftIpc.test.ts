import { beforeEach, describe, expect, it, vi } from "vitest";

const syncHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

import { registerCustomCallDraftIpc } from "./customCallDraftIpc";

describe("direct custom-call draft IPC security projection", () => {
  beforeEach(() => syncHandlers.clear());

  it("whitelists current form fields and returns only a public identity", () => {
    const actions = {
      create: vi.fn(() => ({
        vendorKey: "custom-script-1",
        modelKey: "m1",
        label: "M1",
        kind: "image" as const,
        apiKey: "main-process-secret-must-not-leak",
        baseUrl: "https://private.example",
      })),
      finalize: vi.fn(),
    };
    registerCustomCallDraftIpc((channel, handler) => syncHandlers.set(channel, handler as unknown as (...args: unknown[]) => unknown), actions);

    const result = syncHandlers.get("nomi:model-catalog:custom-call:draft-create")?.({
      vendorName: " New provider ",
      baseUrl: " https://api.example/v1 ",
      apiKey: " sk-current ",
      authType: "bearer",
      modelKey: " model-a ",
      kind: "image",
      vendorKey: "renderer-cannot-choose-storage-identity",
      enabled: true,
      customCall: { script: "renderer-cannot-skip-the-editor" },
    });

    expect(actions.create).toHaveBeenCalledWith({
      vendorName: "New provider",
      baseUrl: "https://api.example/v1",
      apiKey: "sk-current",
      authType: "bearer",
      modelKey: "model-a",
      kind: "image",
    });
    expect(result).toEqual({
      ok: true,
      identity: { vendorKey: "custom-script-1", modelKey: "m1", label: "M1", kind: "image" },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("private.example");
  });

  it("finalizes by saved identity and script only", () => {
    const actions = {
      create: vi.fn(),
      finalize: vi.fn(() => ({ vendorKey: "custom-script-1", modelKey: "m1", label: "M1", kind: "text" as const })),
    };
    registerCustomCallDraftIpc((channel, handler) => syncHandlers.set(channel, handler as unknown as (...args: unknown[]) => unknown), actions);

    const result = syncHandlers.get("nomi:model-catalog:custom-call:draft-finalize")?.({
      vendorKey: " custom-script-1 ",
      modelKey: " m1 ",
      script: " return { text: 'ok' } ",
      apiKey: "renderer-must-not-update-a-saved-key",
      enabled: false,
    });

    expect(actions.finalize).toHaveBeenCalledWith({
      vendorKey: "custom-script-1",
      modelKey: "m1",
      script: "return { text: 'ok' }",
    });
    expect(result).toEqual({
      ok: true,
      identity: { vendorKey: "custom-script-1", modelKey: "m1", label: "M1", kind: "text" },
    });
  });
});
