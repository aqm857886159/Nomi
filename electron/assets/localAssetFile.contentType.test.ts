import { describe, expect, it, vi, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 真实生产路径的回归（2026-08-20 用户报「素材上传失败(HTTP 413)」，那还是段 2 秒的视频）：
// readNomiLocalAsset 读出来的 contentType 决定 localizeAssetsForVendor 走图片通道还是视频通道。
// 原来它只按**扩展名**判，扩展名认不出（.bin 落盘兜底 / .mkv / 没扩展名）就得到 octet-stream，
// 而 mediaKindFromContentType 的兜底是「一律当图片」→ 视频被 base64 塞进 JSON body 发给
// 图片端点 → 反代 413。文件多小都没用，是路走错了。
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-ct-"));
vi.mock("../projects/repository", () => ({
  resolveProjectRelativePath: (_projectId: string, relativePath: string) => path.join(tempRoot, relativePath),
}));

const { readNomiLocalAsset } = await import("./localAssetFile");
const { mediaKindFromContentType } = await import("../catalog/assetLocalization");

afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

/** 一个最小的合法 mp4 ftyp box：size + type + major brand + minor version。 */
function mp4Bytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0x10]),
    Buffer.from("ftypisom", "ascii"),
    Buffer.alloc(4),
  ]);
}

function writeFixture(fileName: string, bytes: Buffer): string {
  fs.writeFileSync(path.join(tempRoot, fileName), bytes);
  return `nomi-local://asset/proj/${encodeURIComponent(fileName)}`;
}

describe("readNomiLocalAsset — 素材真实类型判定", () => {
  it("rejects oversized local inputs before loading bytes when a caller sets a budget", () => {
    expect(readNomiLocalAsset(writeFixture("large.png", Buffer.alloc(1024)), { maxBytes: 16 })).toBeNull();
    expect(readNomiLocalAsset(writeFixture("small.png", Buffer.from("small")), { maxBytes: 16 })?.bytes.toString()).toBe("small");
  });
  it.each([["clip.mp4"], ["clip.bin"], ["clip.mkv"], ["clip"]])(
    "%s 里装的是 mp4 → 判成 video，不再走图片通道",
    (fileName) => {
      const asset = readNomiLocalAsset(writeFixture(fileName, mp4Bytes()));
      expect(asset, `${fileName} 没读出来`).not.toBeNull();
      expect(mediaKindFromContentType(asset!.contentType)).toBe("video");
    },
  );

  it("图片照旧判成 image（没把快路改坏）", () => {
    const png = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n\x1a\n", "binary"), Buffer.alloc(16)]);
    const asset = readNomiLocalAsset(writeFixture("a.png", png));
    expect(mediaKindFromContentType(asset!.contentType)).toBe("image");
  });
});
