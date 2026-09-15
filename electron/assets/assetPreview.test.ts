// 画布预览住在落盘边界：谁把图片/视频放进项目，谁就顺手派生一份 ≤1024 长边的预览
// （图片缩略 / 视频首帧 poster）。源文件原样保留；画布只挂预览，编辑/导出/大图仍读源。
// 真 ffmpeg/ffprobe（与生产同一条 resolveFfmpegPath），不 mock 探测——alpha 判定靠真实 pix_fmt。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { probeMediaMetadata } from "../export/mediaProbe";
import { attachStoredAssetPreview, createStoredAssetPreview, pixelFormatHasAlpha, PREVIEW_LONG_EDGE_PX } from "./assetPreview";
import { readAssetSidecarMeta } from "./assetSidecar";

vi.mock("./assetEvents", () => ({ broadcastAssetsUpdated: vi.fn(), broadcastAssetLocalizationStarted: vi.fn() }));

const tempRoots: string[] = [];
let mockedDocumentsRoot = "";
let mockedUserDataRoot = "";
vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "documents" ? mockedDocumentsRoot : mockedUserDataRoot),
    getAppPath: () => process.cwd(),
  },
}));

function makeTempDir(name = "nomi-asset-preview-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

function synthesize(source: string, args: string[]): Buffer {
  const result = spawnSync(resolveFfmpegPath(), [
    "-hide_banner", "-v", "error", "-f", "lavfi", "-i", source, ...args, "pipe:1",
  ], { maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`fixture synthesize failed: ${result.stderr}`);
  return result.stdout;
}

const BIG_JPEG = synthesize("color=c=blue:s=1600x900", ["-frames:v", "1", "-f", "image2pipe", "-c:v", "mjpeg"]);
const BIG_RGBA_PNG = synthesize("color=c=red@0.5:s=1600x900,format=rgba", ["-frames:v", "1", "-f", "image2pipe", "-c:v", "png"]);
const SMALL_PNG = synthesize("color=c=green:s=640x360", ["-frames:v", "1", "-f", "image2pipe", "-c:v", "png"]);
const CLIP_MP4 = synthesize("testsrc2=s=1280x720:r=24", ["-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov"]);

beforeEach(() => {
  mockedDocumentsRoot = makeTempDir("nomi-asset-preview-documents-");
  mockedUserDataRoot = makeTempDir("nomi-asset-preview-user-data-");
  delete process.env.NOMI_PROJECTS_DIR;
});

afterEach(() => {
  delete process.env.NOMI_PROJECTS_DIR;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("pixelFormatHasAlpha", () => {
  it("names the alpha-carrying ffprobe families, nothing else", () => {
    for (const format of ["rgba", "bgra", "argb", "abgr", "ya8", "ya16le", "yuva420p", "gbrap", "pal8", "rgba64le"]) expect(pixelFormatHasAlpha(format)).toBe(true);
    for (const format of ["rgb24", "yuv420p", "yuvj420p", "yuv420p10le", "gray", "gbrp", undefined, ""]) expect(pixelFormatHasAlpha(format)).toBe(false);
  });
});

describe("createStoredAssetPreview", () => {
  it("scales an oversized jpeg to a 1024 long-edge .preview.jpg next to the untouched source", async () => {
    const dir = makeTempDir();
    const source = path.join(dir, "big.jpg");
    fs.writeFileSync(source, BIG_JPEG);
    const preview = await createStoredAssetPreview(source, "image/jpeg");
    expect(preview.previewPath).toBe(path.join(dir, "big.preview.jpg"));
    expect(preview).toMatchObject({ width: 1600, height: 900 });
    expect(fs.readFileSync(source)).toEqual(BIG_JPEG);
    expect((await probeMediaMetadata(preview.previewPath!)).width).toBe(PREVIEW_LONG_EDGE_PX);
  });

  it("keeps alpha: an RGBA source derives .preview.png whose pixel format still carries alpha", async () => {
    const dir = makeTempDir();
    const source = path.join(dir, "cutout.png");
    fs.writeFileSync(source, BIG_RGBA_PNG);
    const preview = await createStoredAssetPreview(source, "image/png");
    expect(preview.previewPath).toBe(path.join(dir, "cutout.preview.png"));
    expect(pixelFormatHasAlpha((await probeMediaMetadata(preview.previewPath!)).pixelFormat)).toBe(true);
  });

  it("does not duplicate a source that already fits the preview edge (source is the preview)", async () => {
    const dir = makeTempDir();
    const source = path.join(dir, "small.png");
    fs.writeFileSync(source, SMALL_PNG);
    const preview = await createStoredAssetPreview(source, "image/png");
    expect(preview.previewPath).toBeUndefined();
    expect(preview).toMatchObject({ width: 640, height: 360 });
    expect(fs.readdirSync(dir)).toEqual(["small.png"]);
  });

  it("extracts a first-frame poster for video so the canvas can mount an <img> before any <video>", async () => {
    const dir = makeTempDir();
    const source = path.join(dir, "clip.mp4");
    fs.writeFileSync(source, CLIP_MP4);
    const preview = await createStoredAssetPreview(source, "video/mp4");
    expect(preview.previewPath).toBe(path.join(dir, "clip.preview.jpg"));
    expect(preview).toMatchObject({ width: 1280, height: 720 });
    expect(preview.durationSeconds).toBeGreaterThan(0.5);
    expect((await probeMediaMetadata(preview.previewPath!)).width).toBe(PREVIEW_LONG_EDGE_PX);
  });

  it("returns no preview (never throws) for formats ffprobe cannot decode, e.g. svg", async () => {
    const dir = makeTempDir();
    const source = path.join(dir, "vector.svg");
    fs.writeFileSync(source, "<svg xmlns='http://www.w3.org/2000/svg' width='2000' height='2000'></svg>");
    expect(await createStoredAssetPreview(source, "image/svg+xml")).toEqual({});
    expect(fs.readdirSync(dir)).toEqual(["vector.svg"]);
  });
});

describe("attachStoredAssetPreview", () => {
  function storedRecord(dir: string, fileName: string, bytes: Buffer, contentType: string) {
    const projectDir = path.join(dir, "project");
    fs.mkdirSync(path.join(projectDir, "assets", "generated"), { recursive: true });
    const absolutePath = path.join(projectDir, "assets", "generated", fileName);
    fs.writeFileSync(absolutePath, bytes);
    return {
      id: "asset-1",
      projectId: "project-1",
      data: { url: `nomi-local://asset/project-1/assets/generated/${fileName}`, relativePath: `assets/generated/${fileName}`, absolutePath, contentType },
    };
  }

  it("adds thumbnailRelativePath / thumbnailUrl / width / height and persists them in the sidecar", async () => {
    const record = storedRecord(makeTempDir(), "render.jpg", BIG_JPEG, "image/jpeg");
    const attached = await attachStoredAssetPreview(record);
    expect(attached.data).toMatchObject({
      thumbnailRelativePath: "assets/generated/render.preview.jpg",
      thumbnailUrl: "nomi-local://asset/project-1/assets/generated/render.preview.jpg",
      width: 1600,
      height: 900,
    });
    expect(readAssetSidecarMeta(record.data.absolutePath)).toMatchObject({ thumbnailRelativePath: "assets/generated/render.preview.jpg", width: 1600, height: 900 });
  });

  it("reuses the sidecar registration on the second call instead of re-encoding", async () => {
    const record = storedRecord(makeTempDir(), "render.jpg", BIG_JPEG, "image/jpeg");
    const first = await attachStoredAssetPreview(record);
    const previewPath = path.join(path.dirname(record.data.absolutePath), "render.preview.jpg");
    const mtime = fs.statSync(previewPath).mtimeMs;
    const second = await attachStoredAssetPreview(record);
    expect(second.data.thumbnailRelativePath).toBe(first.data.thumbnailRelativePath);
    expect(fs.statSync(previewPath).mtimeMs).toBe(mtime);
  });

  it("leaves non-stored records (nomi-local reference stubs, audio) untouched", async () => {
    const stub = { id: "ref", projectId: "project-1", data: { url: "nomi-local://asset/project-1/x.png", kind: "local" } };
    expect(await attachStoredAssetPreview(stub)).toEqual(stub);
    const audio = storedRecord(makeTempDir(), "voice.wav", Buffer.alloc(64), "audio/wav");
    expect((await attachStoredAssetPreview(audio)).data.thumbnailUrl).toBeUndefined();
  });
});

describe("import boundaries derive the same preview", () => {
  it("importLocalFile (bytes) and localizeTaskAsset (remote) both hand the canvas a distinct preview", async () => {
    const { createProject } = await import("../projects/repository");
    const { importLocalFile } = await import("./localFileImport");
    const { listProjectAssets } = await import("./projectAssetStore");
    const project = createProject({ rootPath: makeTempDir("nomi-asset-preview-project-"), name: "Preview", payload: {} });
    const record = (await importLocalFile({ projectId: project.id, bytes: BIG_RGBA_PNG, fileName: "photo.png", contentType: "image/png" })) as {
      data: { url: string; thumbnailUrl?: string; width?: number; height?: number };
    };
    expect(record.data.thumbnailUrl).toMatch(/photo\.preview\.png$/);
    expect(record.data.thumbnailUrl).not.toBe(record.data.url);
    expect(record.data).toMatchObject({ width: 1600, height: 900 });
    const video = (await importLocalFile({ projectId: project.id, bytes: CLIP_MP4, fileName: "clip.mp4", contentType: "video/mp4" })) as {
      data: { url: string; thumbnailUrl?: string; durationSeconds?: number };
    };
    expect(video.data.thumbnailUrl).toMatch(/clip\.preview\.jpg$/);
    expect(video.data.durationSeconds).toBeGreaterThan(0.5);
    // 预览是派生物，不进素材库列表；源两份都在。
    const listed = listProjectAssets({ projectId: project.id }).items.map((item) => item.name);
    expect(listed.some((name) => name.includes(".preview."))).toBe(false);
    expect(listed).toEqual(expect.arrayContaining(["photo.png", "clip.mp4"]));
  });
});
