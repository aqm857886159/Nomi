import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
}));

import {
  isStableAbsolutePath,
  readProjectLocationSettings,
  writeProjectsRoot,
} from "./projectLocationSettings";

let settingsRoot = "";
const previousSettingsRoot = process.env.NOMI_SETTINGS_DIR;

beforeEach(() => {
  settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-location-settings-"));
  vi.stubEnv("NOMI_SETTINGS_DIR", settingsRoot);
});

afterEach(() => {
  fs.rmSync(settingsRoot, { recursive: true, force: true });
  if (previousSettingsRoot === undefined) vi.stubEnv("NOMI_SETTINGS_DIR", undefined);
  else vi.stubEnv("NOMI_SETTINGS_DIR", previousSettingsRoot);
});

describe("project location settings", () => {
  it("falls back to the default for missing, malformed, and relative values", () => {
    expect(readProjectLocationSettings()).toEqual({ projectsRoot: null });

    fs.writeFileSync(path.join(settingsRoot, "project-location.json"), "{not-json", "utf8");
    expect(readProjectLocationSettings()).toEqual({ projectsRoot: null });

    fs.writeFileSync(
      path.join(settingsRoot, "project-location.json"),
      JSON.stringify({ projectsRoot: "relative/projects" }),
      "utf8",
    );
    expect(readProjectLocationSettings()).toEqual({ projectsRoot: null });
  });

  it("atomically saves an absolute root and clears it back to the default", () => {
    const projectsRoot = path.join(settingsRoot, "Nomi Projects");

    expect(writeProjectsRoot(projectsRoot)).toEqual({ projectsRoot });
    expect(readProjectLocationSettings()).toEqual({ projectsRoot });

    expect(writeProjectsRoot(null)).toEqual({ projectsRoot: null });
    expect(readProjectLocationSettings()).toEqual({ projectsRoot: null });
  });

  it("rejects attempts to persist a relative root", () => {
    expect(() => writeProjectsRoot("relative/projects")).toThrow("absolute");
    expect(readProjectLocationSettings()).toEqual({ projectsRoot: null });
  });

  it("preserves legal leading and trailing spaces in a selected POSIX directory", () => {
    const selectedRoot = path.join(settingsRoot, " Nomi Projects ");

    writeProjectsRoot(selectedRoot);

    expect(readProjectLocationSettings()).toEqual({ projectsRoot: selectedRoot });
  });

  it("rejects Windows current-drive-root paths while accepting stable drive and UNC roots", () => {
    expect(isStableAbsolutePath("\\Nomi Projects", "win32")).toBe(false);
    expect(isStableAbsolutePath("C:\\Nomi Projects", "win32")).toBe(true);
    expect(isStableAbsolutePath("\\\\server\\share\\Nomi Projects", "win32")).toBe(true);
  });
});
