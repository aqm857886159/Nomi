import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/unused" },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`encrypted:${plain}`, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
  },
}));

import {
  DEFAULT_VIDEO_ANALYSIS_SETTINGS,
  readVideoAnalysisEngineConfig,
  readVideoAnalysisSettings,
  videoAnalysisSettingsPath,
  writeVideoAnalysisSettings,
} from "./videoAnalysisSettings";

let root = "";
const previousSettingsRoot = process.env.NOMI_SETTINGS_DIR;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-video-analysis-settings-"));
  process.env.NOMI_SETTINGS_DIR = root;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  if (previousSettingsRoot === undefined) delete process.env.NOMI_SETTINGS_DIR;
  else process.env.NOMI_SETTINGS_DIR = previousSettingsRoot;
});

describe("video analysis settings", () => {
  it("defaults to loopback, local-only inference, and temporary source cleanup", () => {
    expect(readVideoAnalysisSettings()).toEqual(DEFAULT_VIDEO_ANALYSIS_SETTINGS);
    expect(readVideoAnalysisEngineConfig().token).toBe("");
  });

  it("encrypts the API token and never returns it to the renderer-facing settings", () => {
    const publicSettings = writeVideoAnalysisSettings({
      engineOrigin: "http://localhost:8931/",
      apiToken: "private-local-token",
      externalInference: true,
      engineSourceRetention: "keep",
    });
    const persisted = fs.readFileSync(videoAnalysisSettingsPath(), "utf8");

    expect(publicSettings).toEqual({
      schemaVersion: 1,
      engineOrigin: "http://localhost:8931",
      hasApiToken: true,
      externalInference: true,
      engineSourceRetention: "keep",
    });
    expect(persisted).not.toContain("private-local-token");
    expect(readVideoAnalysisEngineConfig().token).toBe("private-local-token");
  });

  it("rejects public origins and clears the token only when explicitly requested", () => {
    writeVideoAnalysisSettings({ apiToken: "keep-me" });
    expect(() => writeVideoAnalysisSettings({ engineOrigin: "http://example.com:8931" })).toThrow(/loopback/i);
    expect(readVideoAnalysisEngineConfig().token).toBe("keep-me");

    expect(writeVideoAnalysisSettings({ clearApiToken: true }).hasApiToken).toBe(false);
    expect(readVideoAnalysisEngineConfig().token).toBe("");
  });
});
