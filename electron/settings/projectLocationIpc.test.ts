import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  showOpenDialog: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
  ipcMain: { handle: electronMocks.handle },
  dialog: { showOpenDialog: electronMocks.showOpenDialog },
  shell: { openPath: electronMocks.openPath },
}));

import {
  checkProjectLocation,
  getProjectLocationResponse,
  pickProjectLocation,
  registerProjectLocationIpc,
  resetProjectLocation,
  revealProjectLocation,
  validateProjectLocationRoot,
} from "./projectLocationIpc";
import { readProjectLocationSettings, writeProjectsRoot } from "./projectLocationSettings";
import { findRecentWorkspace, rememberWorkspace } from "../workspace/workspaceRegistry";
import type { WorkspaceProjectRecordV2 } from "../workspace/workspaceTypes";

let settingsRoot = "";
const previousSettingsRoot = process.env.NOMI_SETTINGS_DIR;
const previousProjectsRoot = process.env.NOMI_PROJECTS_DIR;

beforeEach(() => {
  settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-location-ipc-"));
  process.env.NOMI_SETTINGS_DIR = settingsRoot;
  delete process.env.NOMI_PROJECTS_DIR;
  electronMocks.handle.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(settingsRoot, { recursive: true, force: true });
  if (previousSettingsRoot === undefined) delete process.env.NOMI_SETTINGS_DIR;
  else process.env.NOMI_SETTINGS_DIR = previousSettingsRoot;
  if (previousProjectsRoot === undefined) delete process.env.NOMI_PROJECTS_DIR;
  else process.env.NOMI_PROJECTS_DIR = previousProjectsRoot;
});

describe("project location IPC", () => {
  it("registers one handler for each project-location operation", () => {
    registerProjectLocationIpc();

    expect(electronMocks.handle.mock.calls.map(([channel]) => channel)).toEqual([
      "nomi:settings:project-location-get",
      "nomi:settings:project-location-check",
      "nomi:settings:project-location-pick",
      "nomi:settings:project-location-reset",
      "nomi:settings:project-location-reveal",
    ]);
  });

  it("returns the current location without mutating it", () => {
    const customRoot = path.join(settingsRoot, "custom");
    writeProjectsRoot(customRoot);

    expect(getProjectLocationResponse()).toEqual({
      ok: true,
      location: { path: customRoot, source: "custom" },
    });
  });

  it("checks that the current location is a usable directory", () => {
    const currentRoot = path.join(settingsRoot, "current");
    writeProjectsRoot(currentRoot);

    expect(checkProjectLocation()).toEqual({
      ok: true,
      location: { path: currentRoot, source: "custom" },
    });
    expect(fs.statSync(currentRoot).isDirectory()).toBe(true);
  });

  it("leaves the setting unchanged when the native picker is canceled", async () => {
    const existingRoot = path.join(settingsRoot, "existing");
    writeProjectsRoot(existingRoot);

    const result = await pickProjectLocation({
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    });

    expect(result).toEqual({
      ok: true,
      canceled: true,
      location: { path: existingRoot, source: "custom" },
    });
    expect(readProjectLocationSettings().projectsRoot).toBe(existingRoot);
  });

  it("rejects a selected file and preserves the previous setting", async () => {
    const existingRoot = path.join(settingsRoot, "existing");
    const selectedFile = path.join(settingsRoot, "not-a-directory.txt");
    fs.writeFileSync(selectedFile, "x", "utf8");
    writeProjectsRoot(existingRoot);

    const result = await pickProjectLocation({
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [selectedFile] })),
    });

    expect(result).toEqual({ ok: false, error: "not-directory" });
    expect(readProjectLocationSettings().projectsRoot).toBe(existingRoot);
  });

  it("rejects an unwritable selection and preserves the previous setting", async () => {
    const existingRoot = path.join(settingsRoot, "existing");
    const selectedRoot = path.join(settingsRoot, "unwritable");
    writeProjectsRoot(existingRoot);

    const result = await pickProjectLocation({
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [selectedRoot] })),
      validateRoot: () => "not-writable",
    });

    expect(result).toEqual({ ok: false, error: "not-writable" });
    expect(readProjectLocationSettings().projectsRoot).toBe(existingRoot);
  });

  it("saves a valid selected directory", async () => {
    const selectedRoot = path.join(settingsRoot, "selected");

    const result = await pickProjectLocation({
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [selectedRoot] })),
    });

    expect(result).toEqual({
      ok: true,
      location: { path: selectedRoot, source: "custom" },
    });
    expect(fs.statSync(selectedRoot).isDirectory()).toBe(true);
    expect(readProjectLocationSettings().projectsRoot).toBe(selectedRoot);
  });

  it("uses an actual create-and-delete probe to verify write access", () => {
    const selectedRoot = path.join(settingsRoot, "probe-target");
    const openSpy = vi.spyOn(fs, "openSync");
    const unlinkSpy = vi.spyOn(fs, "unlinkSync");

    expect(validateProjectLocationRoot(selectedRoot)).toBeNull();

    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining(".nomi-write-probe-"), "wx");
    expect(unlinkSpy).toHaveBeenCalledWith(expect.stringContaining(".nomi-write-probe-"));
    expect(fs.readdirSync(selectedRoot)).toEqual([]);
    openSpy.mockRestore();
    unlinkSpy.mockRestore();
  });

  it("rejects the directory when the real write probe cannot be created", () => {
    const selectedRoot = path.join(settingsRoot, "acl-blocked-target");
    const originalOpenSync = fs.openSync.bind(fs);
    vi.spyOn(fs, "openSync").mockImplementation(((filePath, flags, ...args) => {
      if (String(filePath).includes(".nomi-write-probe-")) {
        const error = new Error("permission denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return originalOpenSync(filePath, flags, ...args);
    }) as typeof fs.openSync);

    expect(validateProjectLocationRoot(selectedRoot)).toBe("not-writable");
  });

  it("freezes legacy project origins before changing the default location", async () => {
    const oldRoot = path.join(settingsRoot, "old-default");
    const oldProjectRoot = path.join(oldRoot, "old-project");
    const newRoot = path.join(settingsRoot, "new-default");
    fs.mkdirSync(oldProjectRoot, { recursive: true });
    writeProjectsRoot(oldRoot);
    const legacyRecord: WorkspaceProjectRecordV2 = {
      id: "old-project",
      name: "Old project",
      version: 2,
      createdAt: 1,
      updatedAt: 1,
      savedAt: 1,
      revision: 0,
      lastKnownRootPath: oldProjectRoot,
    };
    rememberWorkspace(settingsRoot, legacyRecord);

    await pickProjectLocation({
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [newRoot] })),
    });

    expect(findRecentWorkspace(settingsRoot, legacyRecord.id)).toMatchObject({
      source: "native",
      nativeRootPath: path.resolve(oldRoot),
    });
  });

  it("restores the documents default without touching any project folders", () => {
    const customRoot = path.join(settingsRoot, "custom");
    fs.mkdirSync(customRoot);
    writeProjectsRoot(customRoot);

    expect(resetProjectLocation()).toEqual({
      ok: true,
      location: { path: path.join(os.tmpdir(), "Nomi Projects"), source: "default" },
    });
    expect(readProjectLocationSettings().projectsRoot).toBeNull();
    expect(fs.existsSync(customRoot)).toBe(true);
  });

  it("creates and reveals the effective root", async () => {
    const customRoot = path.join(settingsRoot, "new-root");
    writeProjectsRoot(customRoot);
    const openPath = vi.fn(async () => "");

    const result = await revealProjectLocation({ openPath });

    expect(result).toEqual({ ok: true, location: { path: customRoot, source: "custom" } });
    expect(fs.statSync(customRoot).isDirectory()).toBe(true);
    expect(openPath).toHaveBeenCalledWith(customRoot);
  });

  it("reveals an existing read-only location without running the write probe", async () => {
    const customRoot = path.join(settingsRoot, "read-only-root");
    fs.mkdirSync(customRoot);
    writeProjectsRoot(customRoot);
    const openPath = vi.fn(async () => "");
    const openSpy = vi.spyOn(fs, "openSync");

    const result = await revealProjectLocation({ openPath });

    expect(result).toEqual({ ok: true, location: { path: customRoot, source: "custom" } });
    expect(openPath).toHaveBeenCalledWith(customRoot);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("does not pretend a saved choice can override the environment", async () => {
    const environmentRoot = path.join(settingsRoot, "environment");
    process.env.NOMI_PROJECTS_DIR = environmentRoot;
    const showOpenDialog = vi.fn();

    expect(getProjectLocationResponse()).toEqual({
      ok: true,
      location: { path: environmentRoot, source: "environment" },
    });
    await expect(pickProjectLocation({ showOpenDialog })).resolves.toEqual({
      ok: false,
      error: "managed-by-environment",
    });
    expect(resetProjectLocation()).toEqual({ ok: false, error: "managed-by-environment" });
    expect(showOpenDialog).not.toHaveBeenCalled();
  });
});
