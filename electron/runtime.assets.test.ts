import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, importRemoteAsset, listProjectAssets, localizeTaskAsset, localizedTaskAssetFileName } from "./runtime";
import { importLocalFile } from "./assets/localFileImport";
import { resolveFfmpegPath } from "./export/ffmpegRunner";

vi.mock("./export/mediaProbe", () => ({
  MEDIA_DECODER_PROTOCOL_WHITELIST: "file,pipe,data",
  probeMediaMetadata: vi.fn(async () => ({ kind: "video", hasAudio: false, durationSeconds: 3.0625 })),
}));

vi.mock("./review/reviewTrace", () => ({
  scheduleTechnicalReview: vi.fn(),
}));

const hardenedFetchMock = vi.hoisted(() => vi.fn());
vi.mock("./hardenedFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hardenedFetch")>()),
  hardenedFetch: hardenedFetchMock,
}));

const MEDIA_FIXTURES = path.join(__dirname, "providerAdapter", "__fixtures__", "certification-media");
const mediaFixture = (name: string) => fs.readFileSync(path.join(MEDIA_FIXTURES, name));
const JPEG_BYTES = mediaFixture("valid.jpg");
const PNG_BYTES = mediaFixture("valid.png");
const MP4_BYTES = mediaFixture("valid.mp4");
const WAV_BYTES = mediaFixture("valid.wav");

function transcode(bytes: Buffer, args: string[]): Buffer {
  const result = spawnSync(resolveFfmpegPath(), [
    "-hide_banner", "-v", "error", "-i", "pipe:0", ...args, "pipe:1",
  ], { input: bytes, maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("fixture transcode failed");
  return result.stdout;
}
const WEBM_BYTES = transcode(MP4_BYTES, ["-c:v", "libvpx", "-f", "webm"]);
const M4A_BYTES = transcode(WAV_BYTES, ["-c:a", "aac", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov"]);

function respondWith(bytes: Buffer, contentType: string): void {
  hardenedFetchMock.mockResolvedValue({ bytes, contentType, status: 200, finalUrl: "https://cdn.example.com/x", truncated: false });
}

type AssetRecord = {
  data: {
    relativePath: string;
    absolutePath: string;
    url: string;
    contentType: string;
  };
};

const tempRoots: string[] = [];
let mockedDocumentsRoot = "";
let mockedUserDataRoot = "";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "documents") return mockedDocumentsRoot;
      if (name === "userData") return mockedUserDataRoot;
      return mockedUserDataRoot;
    },
    getAppPath: () => process.cwd(),
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-31T12:00:00Z"));
  mockedDocumentsRoot = makeTempDir("nomi-runtime-assets-documents-");
  mockedUserDataRoot = makeTempDir("nomi-runtime-assets-user-data-");
  delete process.env.NOMI_PROJECTS_DIR;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.NOMI_PROJECTS_DIR;
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(name = "nomi-runtime-assets-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

function createWorkspace(): { id: string; rootPath: string } {
  const rootPath = makeTempDir();
  const project = createProject({ rootPath, name: "Asset Workspace", payload: {} });
  return { id: project.id, rootPath };
}

describe("runtime workspace asset storage", () => {
  it("keeps provider video filename extensions when localizing task assets", () => {
    expect(
      localizedTaskAssetFileName(
        "video",
        "http://127.0.0.1:8188/view?filename=ComfyUI_00123_.webm&subfolder=&type=output",
        123,
      ),
    ).toBe("video-123.webm");
    expect(localizedTaskAssetFileName("video", "https://cdn.example.com/result.mov", 123)).toBe("video-123.mov");
    expect(localizedTaskAssetFileName("video", "https://cdn.example.com/result", 123)).toBe("video-123.mp4");
  });

  // 产物扩展名必须跟着**真实内容**走，不跟着 URL 猜测或厂商声明走。
  // 2026-08-26 火山方舟 Seedream 5.0 lite 改图走查：JPEG 字节被落成 `.png`。
  describe("artifact extension follows the actual content", () => {
    // 火山方舟 TOS 产物链：长签名 query 在后，扩展名在 path 里。
    const ARK_SIGNED_URL =
      "https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/doubao-seedream-5-0/0217563.jpeg" +
      "?X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-Credential=AKLT%2F20260826%2Fcn-beijing%2Ftos%2Frequest" +
      "&X-Tos-Date=20260826T061500Z&X-Tos-Expires=86400&X-Tos-Signature=deadbeef&X-Tos-SignedHeaders=host";

    it("keeps .jpeg through a signed query string (query must not eat the extension)", async () => {
      const workspace = createWorkspace();
      respondWith(JPEG_BYTES, "image/jpeg");

      const asset = await localizeTaskAsset(workspace.id, ARK_SIGNED_URL, "image", "node-1");

      expect(asset.url).toMatch(/\.jpeg$/);
      expect(asset.url).not.toMatch(/\.png$/);
    });

    it("uses the Content-Type when the URL carries no extension (was: always .png)", async () => {
      const workspace = createWorkspace();
      respondWith(JPEG_BYTES, "image/jpeg");

      // 无扩展名 → localizedTaskAssetFileName 只能按 kind 猜，猜的就是 "png"。
      const asset = await localizeTaskAsset(workspace.id, "https://cdn.example.com/gen/abc123", "image", "node-1");

      expect(asset.url).toMatch(/\.jpg$/);
      expect(asset.url).not.toMatch(/\.png$/);
    });

    it("believes the bytes when Content-Type and URL disagree with them", async () => {
      const workspace = createWorkspace();
      // URL 说 .png、header 也说 image/png —— 但字节是 JPEG。两个都在撒谎，字节说了算。
      respondWith(JPEG_BYTES, "image/png");

      const asset = await localizeTaskAsset(workspace.id, "https://cdn.example.com/gen/out.png", "image", "node-1");

      expect(asset.url).toMatch(/\.jpg$/);
    });

    it("fails closed when only Content-Type claims media but bytes are unknown", async () => {
      const workspace = createWorkspace();
      respondWith(Buffer.alloc(32), "image/webp");
      await expect(localizeTaskAsset(workspace.id, "https://cdn.example.com/gen/out.png", "image", "node-1"))
        .rejects.toThrow("unknown_bytes");
    });

    it("does not rewrite an extension that already agrees with the bytes", async () => {
      const workspace = createWorkspace();
      respondWith(PNG_BYTES, "image/png");

      const asset = await localizeTaskAsset(workspace.id, "https://cdn.example.com/gen/out.png", "image", "node-1");

      expect(asset.url).toMatch(/\.png$/);
    });

    // 同一条派生路径服务 image/video/audio —— 修的是这一类，不是图片那一个。
    it("applies to video artifacts too (extensionless URL was always .mp4)", async () => {
      const workspace = createWorkspace();
      respondWith(WEBM_BYTES, "video/webm");

      const asset = await localizeTaskAsset(workspace.id, "https://cdn.example.com/gen/clip", "video", "node-1");

      expect(asset.url).toMatch(/\.webm$/);
      expect(asset.url).not.toMatch(/\.mp4$/);
    });

    it("applies to audio artifacts too (extensionless URL was always .mp3)", async () => {
      const workspace = createWorkspace();
      respondWith(WAV_BYTES, "audio/wav");

      const asset = await localizeTaskAsset(workspace.id, "https://cdn.example.com/gen/voice", "audio", "node-1");

      expect(asset.url).toMatch(/\.wav$/);
      expect(asset.url).not.toMatch(/\.mp3$/);
    });

    // 跨族护栏：m4a 音频与 mp4 视频共用 ISO-BMFF 魔数。按字节盲目改写会把音频改成视频，
    // 那比原 bug 更糟（kind 都错了）。只在同族内纠正子类型。
    it("never reclassifies audio as video on shared ISO-BMFF magic bytes", async () => {
      const workspace = createWorkspace();
      respondWith(M4A_BYTES, "audio/mp4");

      const asset = await localizeTaskAsset(workspace.id, "https://cdn.example.com/gen/voice.m4a", "audio", "node-1");

      expect(asset.url).toMatch(/\.m4a$/);
      expect(asset.url).not.toMatch(/\.mp4$/);
    });
  });

  it("includes probed video duration when localizing task assets", async () => {
    const workspace = createWorkspace();

    const asset = await localizeTaskAsset(
      workspace.id,
      `data:video/mp4;base64,${MP4_BYTES.toString("base64")}`,
      "video",
      "node-1",
    );

    expect(asset.url).toContain("nomi-local://asset/");
    expect(asset.durationSeconds).toBe(3.0625);
  });

  it("writes generated remote assets under assets/generated/YYYY-MM-DD", async () => {
    const workspace = createWorkspace();

    const asset = (await importRemoteAsset({
      projectId: workspace.id,
      url: `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
      fileName: "render.png",
      kind: "generated",
    })) as AssetRecord;

    expect(asset.data.relativePath).toBe("assets/generated/2026-05-31/render.png");
    expect(asset.data.absolutePath).toBe(path.join(workspace.rootPath, "assets", "generated", "2026-05-31", "render.png"));
    expect(fs.readFileSync(asset.data.absolutePath)).toEqual(PNG_BYTES);
    expect(asset.data.url).toBe(`nomi-local://asset/${encodeURIComponent(workspace.id)}/assets/generated/2026-05-31/render.png`);
  });

  it("writes imported user files under assets/imported/YYYY-MM-DD", async () => {
    const workspace = createWorkspace();

    const asset = (await importLocalFile({
      projectId: workspace.id,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      fileName: "photo.png",
    })) as AssetRecord;

    expect(asset.data.relativePath).toBe("assets/imported/2026-05-31/photo.png");
    expect(asset.data.absolutePath).toBe(path.join(workspace.rootPath, "assets", "imported", "2026-05-31", "photo.png"));
    expect([...fs.readFileSync(asset.data.absolutePath)]).toEqual([1, 2, 3]);
  });

  it("sniffs an extensionless octet-stream video before importing", async () => {
    const workspace = createWorkspace();
    const bytes = Buffer.concat([Buffer.from([0, 0, 0, 0x10]), Buffer.from("ftypisom", "ascii"), Buffer.alloc(4)]);
    const asset = (await importLocalFile({
      projectId: workspace.id,
      bytes,
      contentType: "application/octet-stream",
      fileName: "clip",
    })) as AssetRecord;

    expect(asset.data.relativePath).toMatch(/assets\/imported\/2026-05-31\/clip\.mp4$/);
    expect(asset.data.contentType).toBe("video/mp4");
  });

  it("imports a native file path without copying the full file through renderer IPC", async () => {
    const workspace = createWorkspace();
    const sourceDir = makeTempDir("nomi-native-import-source-");
    const sourcePath = path.join(sourceDir, "large-image.png");
    fs.writeFileSync(sourcePath, Buffer.from([4, 5, 6, 7]));

    const readFileSync = vi.spyOn(fs, "readFileSync");
    const asset = (await importLocalFile({
      projectId: workspace.id,
      sourcePath,
      contentType: "image/png",
      fileName: "large-image.png",
    }, { allowSourcePath: true })) as AssetRecord;

    expect(asset.data.relativePath).toBe("assets/imported/2026-05-31/large-image.png");
    expect([...fs.readFileSync(asset.data.absolutePath)]).toEqual([4, 5, 6, 7]);
    expect(readFileSync).not.toHaveBeenCalledWith(sourcePath);
    readFileSync.mockRestore();
  });

  it("restores imported asset metadata when listing project assets", async () => {
    const workspace = createWorkspace();

    await importLocalFile({
      projectId: workspace.id,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      fileName: "photo.png",
      kind: "upload",
    });
    await importRemoteAsset({
      projectId: workspace.id,
      url: "data:image/png;base64,aGVsbG8=",
      fileName: "capture.png",
      kind: "browser-capture",
    });
    await importLocalFile({
      projectId: workspace.id,
      bytes: new Uint8Array([4, 5, 6]),
      contentType: "image/png",
      fileName: "box.png",
      kind: "browser-upload",
    });

    const listed = listProjectAssets({ projectId: workspace.id, limit: 20 });

    expect(listed.items.map((item) => item.name).sort()).toEqual(["box.png", "capture.png", "photo.png"]);
    expect(listed.items.find((item) => item.name === "photo.png")?.data.kind).toBe("upload");
    expect(listed.items.find((item) => item.name === "capture.png")?.data.kind).toBe("browser-capture");
    expect(listed.items.find((item) => item.name === "box.png")?.data.kind).toBe("browser-upload");
    expect(listed.items.every((item) => !item.name.endsWith(".meta"))).toBe(true);
  });

  it("dedupes colliding generated asset filenames", async () => {
    const workspace = createWorkspace();

    const pngUrl = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
    await importRemoteAsset({ projectId: workspace.id, url: pngUrl, fileName: "render.png" });
    const second = (await importRemoteAsset({ projectId: workspace.id, url: pngUrl, fileName: "render.png" })) as AssetRecord;

    expect(second.data.relativePath).toBe("assets/generated/2026-05-31/render-2.png");
    expect(fs.readFileSync(second.data.absolutePath)).toEqual(PNG_BYTES);
  });
});
