import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userDataRoot = "";

vi.mock("electron", () => ({
  app: { getPath: () => userDataRoot },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
  },
}));

describe("asset relay settings", () => {
  const previousSettingsRoot = process.env.NOMI_SETTINGS_DIR;

  beforeEach(() => {
    userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-asset-relay-settings-"));
    process.env.NOMI_SETTINGS_DIR = userDataRoot;
    vi.resetModules();
  });

  afterEach(() => {
    if (previousSettingsRoot === undefined) delete process.env.NOMI_SETTINGS_DIR;
    else process.env.NOMI_SETTINGS_DIR = previousSettingsRoot;
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  });

  it("stores a custom token encrypted and exposes only its presence to the renderer", async () => {
    const { readAssetRelaySettings, writeAssetRelaySettings } = await import("./assetRelaySettings");
    const { readAssetRelayRuntimeConfig } = await import("../catalog/assetRelayRuntimeConfig");

    const saved = writeAssetRelaySettings({ enabled: true, endpoint: "https://relay.example.com/v1/assets", token: "secret-token" });

    expect(saved).toEqual({ enabled: true, endpoint: "https://relay.example.com/v1/assets", hasToken: true });
    expect(readAssetRelaySettings()).toEqual(saved);
    expect(readAssetRelayRuntimeConfig()).toMatchObject({ endpoint: "https://relay.example.com/v1/assets", token: "secret-token", source: "custom" });

    const raw = fs.readFileSync(path.join(userDataRoot, "asset-relay.json"), "utf8");
    expect(raw).not.toContain("secret-token");
    expect(raw).toContain("safeStorage");
  });

  it("rejects non-HTTPS custom endpoints before enabling the relay", async () => {
    const { readAssetRelaySettings, writeAssetRelaySettings } = await import("./assetRelaySettings");

    expect(() => writeAssetRelaySettings({ enabled: true, endpoint: "http://relay.example.com/v1/assets", token: "secret-token" })).toThrow(/HTTPS/);
    expect(readAssetRelaySettings()).toEqual({ enabled: false, endpoint: "", hasToken: false });
  });
});
