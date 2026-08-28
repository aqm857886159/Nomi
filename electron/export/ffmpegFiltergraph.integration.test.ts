import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { buildWebmToMp4Args } from "./ffmpegCommandBuilder";
import { compileFfmpegFiltergraph } from "./ffmpegFiltergraph";
import type { NomiRenderManifestV1 } from "./exportManifest";

const ffmpegPath = ffmpegInstaller.path;
const ffprobePath = ffprobeInstaller.path;
const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";

describe("FFmpeg clip audio integration", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-clip-audio-"));
  const sourcePath = path.join(root, "source.wav");
  const outputPath = path.join(root, "rendered.mp4");

  beforeAll(() => {
    const generated = spawnSync(ffmpegPath, [
      "-y",
      "-hide_banner",
      "-loglevel", "error",
      "-f", "lavfi",
      "-i", "sine=frequency=1000:sample_rate=48000:duration=2",
      "-c:a", "pcm_s16le",
      sourcePath,
    ], { encoding: "utf8" });
    expect(generated.status, generated.stderr).toBe(0);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("renders gain and fades to a playable AAC MP4", () => {
    const manifest: NomiRenderManifestV1 = {
      version: 1,
      projectId: "audio-integration",
      createdAt: "2026-08-28T00:00:00.000Z",
      timeline: {
        fps: 30,
        durationFrames: 60,
        range: { startFrame: 0, endFrame: 60 },
        tracks: [{
          id: "audio",
          kind: "audio",
          clips: [{
            id: "tone",
            assetId: "tone",
            startFrame: 0,
            endFrame: 60,
            sourceStartFrame: 0,
            sourceEndFrame: 60,
            audio: { gainDb: -6, muted: false, fadeInFrames: 15, fadeOutFrames: 15 },
          }],
        }],
      },
      profile: {
        preset: "publish",
        container: "mp4",
        videoCodec: "h264",
        audioCodec: "aac",
        audioMode: "mixdown",
        audioBitrateKbps: 128,
        width: 64,
        height: 64,
        fps: 30,
        pixelFormat: "yuv420p",
        quality: "small",
      },
      assets: {
        tone: { id: "tone", kind: "audio", absolutePath: sourcePath, durationSeconds: 2 },
      },
    };
    const filtergraph = compileFfmpegFiltergraph({ manifest });
    const args = buildWebmToMp4Args({
      inputPath: "",
      outputPath,
      profile: manifest.profile,
      noAudio: false,
      filtergraph,
    });

    const rendered = spawnSync(ffmpegPath, args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    expect(rendered.status, rendered.stderr).toBe(0);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);

    const probed = spawnSync(ffprobePath, [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_name",
      "-of", "json",
      outputPath,
    ], { encoding: "utf8" });
    expect(probed.status, probed.stderr).toBe(0);
    expect(JSON.parse(probed.stdout)).toMatchObject({ streams: [{ codec_name: "aac" }] });

    const meanVolume = (mediaPath: string): number => {
      const measured = spawnSync(ffmpegPath, [
        "-hide_banner",
        "-i", mediaPath,
        "-vn",
        "-af", "atrim=start=0.75:end=1.25,volumedetect",
        "-f", "null",
        nullDevice,
      ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
      expect(measured.status, measured.stderr).toBe(0);
      const match = measured.stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/);
      expect(match, measured.stderr).not.toBeNull();
      return Number(match?.[1]);
    };

    const attenuation = meanVolume(outputPath) - meanVolume(sourcePath);
    expect(attenuation).toBeGreaterThan(-7);
    expect(attenuation).toBeLessThan(-5);
  }, 30_000);
});
