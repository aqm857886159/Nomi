import { describe, expect, it, vi } from "vitest";
import { getDesktopBridge } from "../../desktop/bridge";
import {
  filePathsFromDrop,
  importLocalPathsToLibrary,
  isTextEditingTarget,
} from "./assetLibraryLocalImport";

vi.mock("../../desktop/bridge", () => ({ getDesktopBridge: vi.fn() }));

const mockedGetDesktopBridge = vi.mocked(getDesktopBridge);

describe("assetLibraryLocalImport", () => {
  it("extracts unique absolute paths from dropped Electron files", () => {
    const files = [
      { path: "/tmp/a.png" },
      { path: "/tmp/a.png" },
      { path: "relative.jpg" },
      { name: "missing-path.png" },
    ] as unknown as File[];

    expect(filePathsFromDrop(files)).toEqual(["/tmp/a.png"]);
  });

  it("uses the Electron webUtils resolver when File.path is unavailable", () => {
    const file = { name: "a.png" } as unknown as File;

    expect(filePathsFromDrop([file], () => "/Users/test/a.png")).toEqual(["/Users/test/a.png"]);
  });

  it("falls back to File.path when Electron returns an empty native path", () => {
    const file = { name: "a.png", path: "/Users/test/a.png" } as unknown as File;

    expect(filePathsFromDrop([file], () => "")).toEqual(["/Users/test/a.png"]);
  });

  it("does not treat an editing target as the asset library paste surface", () => {
    expect(isTextEditingTarget({ closest: () => ({}) } as unknown as EventTarget)).toBe(true);
    expect(isTextEditingTarget({ closest: () => null } as unknown as EventTarget)).toBe(false);
    expect(isTextEditingTarget(null)).toBe(false);
  });

  it("uses the desktop copy bridge and returns its batch result", async () => {
    const rejection = { reason: "no-disk-space", fileBytes: 2, freeBytes: 1, neededBytes: 3 } as const;
    const copyFiles = vi.fn(async () => ({ created: [{ id: "asset-1" }], rejected: [{ fileName: "big.mov", rejection }], failedCount: 0 }));
    mockedGetDesktopBridge.mockReturnValue({ assets: { copyFiles } } as never);

    await expect(importLocalPathsToLibrary("project-1", ["/tmp/a.png"])).resolves.toEqual({
      created: [{ id: "asset-1" }],
      rejected: [{ fileName: "big.mov", rejection }],
      failedCount: 0,
    });
    expect(copyFiles).toHaveBeenCalledWith({ projectId: "project-1", paths: ["/tmp/a.png"] });
  });
});
