// 真 ffmpeg/ffprobe 集成：导入归一化 + 懒自愈全链路（不 mock mediaProbe——就是要证明
// 打包随附的二进制真能探测/真能转码，libx264 缺失这类打包事故在这里当场爆）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createProject } from "../runtime";
import { ensurePlayableAsset, importLocalFile } from "./localFileImport";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { transcodeFileToPlayableMp4IfNeeded } from "./videoImportNormalize";
import { probeMediaMetadata } from "../export/mediaProbe";

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

function makeTempDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

type AssetRecord = { data: { url: string; absolutePath: string; contentType: string; playbackNormalizedFrom?: string } };

const require = createRequire(import.meta.url);
let workspaceId = "";
let aviBytes: Buffer;
let mp4Bytes: Buffer;
let mkvBytes: Buffer;

beforeAll(() => {
  mockedDocumentsRoot = makeTempDir("nomi-video-norm-documents-");
  mockedUserDataRoot = makeTempDir("nomi-video-norm-user-data-");
  const rootPath = makeTempDir("nomi-video-norm-project-");
  workspaceId = (createProject({ rootPath, name: "Video Normalize", payload: {} }) as { id: string }).id;

  // 夹具：mpeg4-in-AVI（Chromium 铁定播不了）+ h264 MP4（可播对照）。testsrc 1 秒极小片。
  const ffmpegPath = (require("@ffmpeg-installer/ffmpeg") as { path: string }).path;
  const fixtureDir = makeTempDir("nomi-video-norm-fixtures-");
  const aviPath = path.join(fixtureDir, "legacy.avi");
  const mp4Path = path.join(fixtureDir, "modern.mp4");
  const mkvPath = path.join(fixtureDir, "real-shot.mkv");
  const base = ["-f", "lavfi", "-i", "testsrc=duration=1:size=192x108:rate=12", "-y"];
  const encodeAvi = spawnSync(ffmpegPath, [...base, "-c:v", "mpeg4", aviPath], { timeout: 60_000 });
  const encodeMp4 = spawnSync(ffmpegPath, [...base, "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4Path], { timeout: 60_000 });
  const realFixture = path.resolve("tests/ux/fixtures/real-shot-640x360.mp4");
  const deriveMkv = spawnSync(resolveFfmpegPath(), ["-y", "-i", realFixture, "-c", "copy", mkvPath], { timeout: 60_000 });
  if (encodeAvi.status !== 0 || encodeMp4.status !== 0 || deriveMkv.status !== 0) {
    throw new Error(`fixture encode failed: avi=${encodeAvi.status} mp4=${encodeMp4.status} mkv=${deriveMkv.status}`);
  }
  aviBytes = fs.readFileSync(aviPath);
  mp4Bytes = fs.readFileSync(mp4Path);
  mkvBytes = fs.readFileSync(mkvPath);
}, 120_000);

afterAll(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

// 登记的真实素材（tests/ux/real-media-fixtures.json）：
const REAL_SHOT = "tests/ux/fixtures/real-shot-640x360.mp4"; // video-ai-shot-640x360：H.264，无音轨
const REAL_SHOT_WITH_AUDIO = "tests/ux/fixtures/canvas-follow-hand-1080p15.mp4"; // video-canvas-follow-hand-1080p15：H.264 + AAC

/** 用打包的 ffmpeg 从登记素材派生一份夹具，只落测试 tmp。 */
function deriveFromRegistered(registeredPath: string, fileName: string, args: string[]): Buffer {
  const outputPath = path.join(makeTempDir("nomi-video-norm-derived-"), fileName);
  const derive = spawnSync(resolveFfmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", "-i", path.resolve(registeredPath), ...args, outputPath], { encoding: "utf8", timeout: 120_000 });
  if (derive.status !== 0) throw new Error(`derive ${fileName} failed: ${derive.stderr}`);
  return fs.readFileSync(outputPath);
}

/** 第一条视频流所有压缩包的 MD5：相等 = 视频没被重编码，只是换了容器。 */
function videoPacketMd5(filePath: string): string {
  const hash = spawnSync(resolveFfmpegPath(), ["-hide_banner", "-loglevel", "error", "-i", path.resolve(filePath), "-map", "0:v:0", "-c", "copy", "-f", "md5", "-"], { encoding: "utf8", timeout: 60_000 });
  if (hash.status !== 0) throw new Error(`packet md5 failed: ${hash.stderr}`);
  return hash.stdout.trim();
}

describe("导入归一化（importLocalFile）", () => {
  it("mpeg4 AVI 导入 → 落盘即 h264 MP4，可播（群反馈根治主路径）", async () => {
    const asset = (await importLocalFile({
      projectId: workspaceId,
      bytes: aviBytes,
      contentType: "video/x-msvideo",
      fileName: "clip.avi",
    })) as AssetRecord;
    expect(asset.data.absolutePath.endsWith("clip.mp4")).toBe(true);
    expect(asset.data.contentType).toBe("video/mp4");
    expect(asset.data.playbackNormalizedFrom).toBe("codec:mpeg4");
    const probe = await probeMediaMetadata(asset.data.absolutePath);
    expect(probe.videoCodec).toBe("h264");
  }, 60_000);

  it("h264 MP4 导入 → 原样直落，不白转", async () => {
    const asset = (await importLocalFile({
      projectId: workspaceId,
      bytes: mp4Bytes,
      contentType: "video/mp4",
      fileName: "modern.mp4",
    })) as AssetRecord;
    expect(asset.data.playbackNormalizedFrom).toBeUndefined();
    expect(fs.readFileSync(asset.data.absolutePath).length).toBe(mp4Bytes.length);
  }, 60_000);

  it("登记的真实 H.264 镜头派生 MKV → 只换容器，视频包逐字节没动", async () => {
    const asset = (await importLocalFile({
      projectId: workspaceId,
      bytes: mkvBytes,
      contentType: "video/x-matroska",
      fileName: "real-shot.mkv",
    })) as AssetRecord;
    expect(asset.data.playbackNormalizedFrom).toBe("container:mkv");
    expect((await probeMediaMetadata(asset.data.absolutePath)).videoCodec).toBe("h264");
    expect(videoPacketMd5(asset.data.absolutePath)).toBe(videoPacketMd5(REAL_SHOT));
  }, 60_000);

  // 换容器只换「换得进 MP4、换完放得了」的；用打包的 ffmpeg 真换一遍，换不进去就会退回放不了的原片。
  it("H.264 + FLAC 的 MKV → 只换容器、音轨转 AAC（FLAC 进 MP4 要 -strict -2，原样拷就失败）", async () => {
    const bytes = deriveFromRegistered(REAL_SHOT_WITH_AUDIO, "flac-audio.mkv", ["-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-c:a", "flac"]);
    const asset = (await importLocalFile({ projectId: workspaceId, bytes, contentType: "video/x-matroska", fileName: "flac-audio.mkv" })) as AssetRecord;
    expect(asset.data.playbackNormalizedFrom).toBe("container:mkv");
    const probe = await probeMediaMetadata(asset.data.absolutePath);
    expect([probe.videoCodec, probe.audioCodec]).toEqual(["h264", "aac"]);
    // 视频包和登记素材逐字节相同 = 没走整段重编码（不拿墙钟判快慢，见 check:test-waits）。
    expect(videoPacketMd5(asset.data.absolutePath)).toBe(videoPacketMd5(REAL_SHOT_WITH_AUDIO));
  }, 120_000);

  it("H.264 + Opus 的 MKV → 只换容器、Opus 也转 AAC（Windows / Linux / Intel Mac 打包的 ffmpeg 4.1 不收 MP4 里的 Opus）", async () => {
    const bytes = deriveFromRegistered(REAL_SHOT_WITH_AUDIO, "opus-audio.mkv", ["-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-c:a", "libopus", "-b:a", "96k"]);
    const asset = (await importLocalFile({ projectId: workspaceId, bytes, contentType: "video/x-matroska", fileName: "opus-audio.mkv" })) as AssetRecord;
    expect(asset.data.playbackNormalizedFrom).toBe("container:mkv");
    const probe = await probeMediaMetadata(asset.data.absolutePath);
    expect([probe.videoCodec, probe.audioCodec]).toEqual(["h264", "aac"]);
    expect(videoPacketMd5(asset.data.absolutePath)).toBe(videoPacketMd5(REAL_SHOT_WITH_AUDIO));
  }, 120_000);

  it("VP8 的 MKV → MP4 不收 VP8，走整段重编码成 H.264", async () => {
    const bytes = deriveFromRegistered(REAL_SHOT, "vp8.mkv", ["-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "400k"]);
    const asset = (await importLocalFile({ projectId: workspaceId, bytes, contentType: "video/x-matroska", fileName: "vp8.mkv" })) as AssetRecord;
    expect(asset.data.playbackNormalizedFrom).toBe("container:mkv");
    expect((await probeMediaMetadata(asset.data.absolutePath)).videoCodec).toBe("h264");
  }, 120_000);

  it("损坏字节标视频导入 → 回退原样不挡导入（渲染侧守卫兜底报错）", async () => {
    const garbage = Buffer.from("not a real video at all — corrupted payload");
    const asset = (await importLocalFile({
      projectId: workspaceId,
      bytes: garbage,
      contentType: "video/mp4",
      fileName: "broken.mp4",
    })) as AssetRecord;
    expect(asset.data.playbackNormalizedFrom).toBeUndefined();
    expect(fs.readFileSync(asset.data.absolutePath).equals(garbage)).toBe(true);
  }, 60_000);
});

describe("懒自愈（ensurePlayableAsset）", () => {
  it("存量播不了的资产 → 转码出新 MP4 资产；已可播 → null（一次收敛）", async () => {
    // 用 octet-stream 绕过导入归一化，模拟「归一化上线前落盘的 HEVC/AVI 存量」。
    const planted = (await importLocalFile({
      projectId: workspaceId,
      bytes: aviBytes,
      contentType: "application/octet-stream",
      fileName: "stale.avi",
    })) as AssetRecord;
    expect(planted.data.absolutePath.endsWith("stale.avi")).toBe(true);

    const healed = (await ensurePlayableAsset({ url: planted.data.url })) as AssetRecord | null;
    expect(healed).not.toBeNull();
    expect(healed!.data.absolutePath.endsWith(".mp4")).toBe(true);
    expect(healed!.data.playbackNormalizedFrom).toBe("codec:mpeg4");
    const probe = await probeMediaMetadata(healed!.data.absolutePath);
    expect(probe.videoCodec).toBe("h264");
    // 原文件保留（导出/上游引用不受影响）
    expect(fs.existsSync(planted.data.absolutePath)).toBe(true);

    // 新资产已可播 → 再自愈返回 null（渲染侧一次性防环之外的第二道收敛保证）
    expect(await ensurePlayableAsset({ url: healed!.data.url })).toBeNull();
  }, 60_000)

  it("注入不可播放 codec → 整段重编码并发出单调进度", async () => {
    const fixtureDir = makeTempDir("nomi-video-norm-progress-");
    const inputPath = path.join(fixtureDir, "source.mp4");
    fs.writeFileSync(inputPath, mp4Bytes);
    const progress: number[] = [];
    const result = await transcodeFileToPlayableMp4IfNeeded(inputPath, "source.mp4", fixtureDir, {
      playableCodecs: new Set(),
      onProgress: (ratio) => progress.push(ratio),
    });
    expect(result?.reason).toBe("codec:h264");
    expect(progress.length).toBeGreaterThan(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect((await probeMediaMetadata(result!.outputPath)).videoCodec).toBe("h264");
  }, 60_000)

  // 转码进行中的取消 / 退出（按 PID 查进程、查临时目录）在 importTranscodeLifecycle.integration.test.ts。

  it("同一份坏资产被多个播放面各触发一次 → 复用同一份转码产物，不重复转码也不堆副本", async () => {
    // 守卫已从画布节点提到各播放面共用（时间轴/大图/预览…），同一份坏资产会被反复触发自愈。
    const planted = (await importLocalFile({
      projectId: workspaceId,
      bytes: aviBytes,
      contentType: "application/octet-stream",
      fileName: "shared-across-surfaces.avi",
    })) as AssetRecord;

    const first = (await ensurePlayableAsset({ url: planted.data.url })) as AssetRecord;
    const second = (await ensurePlayableAsset({ url: planted.data.url })) as AssetRecord;
    const third = (await ensurePlayableAsset({ url: planted.data.url })) as AssetRecord;
    expect(second.data.url).toBe(first.data.url);
    expect(third.data.url).toBe(first.data.url);

    // 内容身份目录里只落一份 MP4；原名可能来自先前导入的相同内容。
    const producedDir = path.dirname(first.data.absolutePath);
    const copies = fs
      .readdirSync(producedDir)
      .filter((name) => name.endsWith(".mp4"));
    expect(copies).toHaveLength(1);

    // 产物被删（用户清理/同步冲突）→ 标记失效，下次自愈重新转出来，不能死在缓存上。
    fs.rmSync(first.data.absolutePath, { force: true });
    const reheal = (await ensurePlayableAsset({ url: planted.data.url })) as AssetRecord | null;
    expect(reheal).not.toBeNull();
    expect(fs.existsSync(reheal!.data.absolutePath)).toBe(true);
  }, 60_000)

  it("非 nomi-local / 不存在的 URL → null", async () => {
    expect(await ensurePlayableAsset({ url: "https://cdn.example.com/x.mp4" })).toBeNull();
    expect(await ensurePlayableAsset({ url: "nomi-local://asset/no-such-project/assets/x.mp4" })).toBeNull();
  });
});
