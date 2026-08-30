import { describe, expect, it, vi } from "vitest";

const SENTINEL = "sk-sentinel-must-never-leak";
const mocks = vi.hoisted(() => ({
  available: false,
  encryptString: vi.fn<(plain: string) => Buffer>(() => Buffer.from("encrypted")),
}));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => mocks.available,
    encryptString: mocks.encryptString,
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { makeApiKeyRecordFromPlain } from "./secrets";

describe("secure API credential writer", () => {
  it("fails closed when safeStorage is unavailable without returning or echoing plaintext", () => {
    mocks.available = false;
    mocks.encryptString.mockClear();
    let error: unknown;
    try {
      makeApiKeyRecordFromPlain(SENTINEL, "vendor", true, "created", "updated");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(SENTINEL);
    expect(mocks.encryptString).not.toHaveBeenCalled();
  });

  it("redacts the submitted secret when safeStorage encryption throws", () => {
    mocks.available = true;
    mocks.encryptString.mockImplementationOnce((plain) => {
      throw new Error(`encryption failed for ${plain}`);
    });

    let error: unknown;
    try {
      makeApiKeyRecordFromPlain(SENTINEL, "vendor", true, "created", "updated");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(SENTINEL);
  });
});
