import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const importLocalFile = vi.fn();
vi.mock("./localFileImport", async () => {
  const actual = await vi.importActual<typeof import("./localFileImport")>("./localFileImport");
  return { ...actual, importLocalFile: (...args: unknown[]) => importLocalFile(...args) };
});

const { importLocalFilePaths } = await import("./localFileCopy");
const { MediaImportRejectedError } = await import("./localFileImport");

let base = "";

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-local-file-copy-"));
  importLocalFile.mockReset();
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function fixture(name: string): string {
  const file = path.join(base, name);
  fs.writeFileSync(file, Buffer.alloc(16));
  return file;
}

describe("importLocalFilePaths", () => {
  // 这是用户报的那件事：Finder 拖入 / 粘贴素材库此前只收图片。
  it("图 / 视频 / 音频 / 3D 一视同仁地交给唯一的落盘路，不在这一层拦任何类型", async () => {
    importLocalFile.mockImplementation(async (payload: { fileName: string }) => ({ id: payload.fileName }));
    const paths = ["a.png", "b.mov", "c.mp3", "d.glb", "e.mkv"].map(fixture);

    const result = await importLocalFilePaths("project-1", paths);

    expect(result.created).toHaveLength(5);
    expect(result.rejected).toHaveLength(0);
    expect(result.failedCount).toBe(0);
    expect(importLocalFile).toHaveBeenCalledTimes(5);
  });

  it("每个文件都带上真实 contentType 和 allowSourcePath（字节不穿过这一层）", async () => {
    importLocalFile.mockResolvedValue({ id: "asset" });
    await importLocalFilePaths("project-1", [fixture("clip.mov")]);

    expect(importLocalFile).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1", fileName: "clip.mov", contentType: "video/quicktime", surface: "asset-library" }),
      { allowSourcePath: true },
    );
  });

  it("准入闸拒收 → 原样把带数字的 rejection 交回调用方（不压成计数）", async () => {
    const rejection = { reason: "no-disk-space", fileBytes: 900, freeBytes: 100, neededBytes: 1900 } as const;
    importLocalFile.mockRejectedValueOnce(new MediaImportRejectedError(rejection, "big.mov"));
    importLocalFile.mockResolvedValueOnce({ id: "ok" });

    const result = await importLocalFilePaths("project-1", [fixture("big.mov"), fixture("ok.png")]);

    expect(result.created).toHaveLength(1);
    expect(result.rejected).toEqual([{ fileName: "big.mov", rejection }]);
    expect(result.failedCount).toBe(0);
  });

  it("真实故障（读不到文件等）计入 failedCount，不冒充准入拒绝", async () => {
    importLocalFile.mockRejectedValue(new Error("EACCES"));
    const result = await importLocalFilePaths("project-1", [fixture("a.png")]);
    expect(result.failedCount).toBe(1);
    expect(result.rejected).toHaveLength(0);
  });
});
