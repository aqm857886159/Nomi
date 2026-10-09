import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd(), getName: () => "Nomi" },
}));

import { defaultProjectsFolderName, getProjectLocationState, getProjectsRoot, readJson, readText } from "./runtimePaths";
import { writeProjectsRoot } from "./settings/projectLocationSettings";

const tempRoots: string[] = [];
const previousProjectsRoot = process.env.NOMI_PROJECTS_DIR;
const previousSettingsRoot = process.env.NOMI_SETTINGS_DIR;
afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  if (previousProjectsRoot === undefined) vi.stubEnv("NOMI_PROJECTS_DIR", undefined);
  else vi.stubEnv("NOMI_PROJECTS_DIR", previousProjectsRoot);
  if (previousSettingsRoot === undefined) vi.stubEnv("NOMI_SETTINGS_DIR", undefined);
  else vi.stubEnv("NOMI_SETTINGS_DIR", previousSettingsRoot);
});
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-runtime-paths-test-"));
  tempRoots.push(dir);
  return dir;
}

describe("readJson", () => {
  it("parses valid JSON files", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "x.json");
    fs.writeFileSync(file, JSON.stringify({ a: 1 }));
    expect(readJson(file, { a: 0 })).toEqual({ a: 1 });
  });
  it("returns the fallback for missing or malformed files", () => {
    const dir = makeTempDir();
    expect(readJson(path.join(dir, "missing.json"), { def: true })).toEqual({ def: true });
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, "{not json");
    expect(readJson(bad, null)).toBeNull();
  });
});

describe("readText", () => {
  it("reads file contents, '' when missing", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "x.txt");
    fs.writeFileSync(file, "hello");
    expect(readText(file)).toBe("hello");
    expect(readText(path.join(dir, "missing.txt"))).toBe("");
  });
});

describe("getProjectsRoot", () => {
  it("resolves environment override before the saved preference before the documents default", () => {
    const settingsRoot = makeTempDir();
    vi.stubEnv("NOMI_SETTINGS_DIR", settingsRoot);
    const customRoot = path.join(settingsRoot, "custom-projects");
    const environmentRoot = path.join(settingsRoot, "environment-projects");
    writeProjectsRoot(customRoot);

    vi.stubEnv("NOMI_PROJECTS_DIR", environmentRoot);
    expect(getProjectLocationState()).toEqual({ path: environmentRoot, source: "environment" });
    expect(getProjectsRoot()).toBe(environmentRoot);

    vi.stubEnv("NOMI_PROJECTS_DIR", undefined);
    expect(getProjectLocationState()).toEqual({ path: customRoot, source: "custom" });
    expect(getProjectsRoot()).toBe(customRoot);

    writeProjectsRoot(null);
    const defaultRoot = path.join(os.tmpdir(), "Nomi Projects");
    expect(getProjectLocationState()).toEqual({ path: defaultRoot, source: "default" });
    expect(getProjectsRoot()).toBe(defaultRoot);
  });
});

describe("defaultProjectsFolderName", () => {
  it("keeps the stable folder and isolates side-by-side preview builds", () => {
    expect(defaultProjectsFolderName("Nomi")).toBe("Nomi Projects");
    expect(defaultProjectsFolderName("nomi")).toBe("Nomi Projects");
    expect(defaultProjectsFolderName("Nomi Preview")).toBe("Nomi Preview Projects");
  });
});
