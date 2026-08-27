import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BoundedProcessError,
  MediaProbeError,
  parseFfprobeJson,
  probeMediaMetadata,
  runBoundedProcess,
  type RunProbeProcess,
} from "./mediaProbe";

const videoProbeJson = JSON.stringify({
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1920,
      height: 1080,
      avg_frame_rate: "30000/1001",
      r_frame_rate: "30/1",
    },
    {
      codec_type: "audio",
      codec_name: "aac",
      sample_rate: "48000",
      channels: 2,
      streamCount: 2,
    },
  ],
  format: { duration: "12.345" },
});

function expectMediaProbeError(error: unknown, code: MediaProbeError["code"]): void {
  expect(error).toBeInstanceOf(MediaProbeError);
  expect((error as MediaProbeError).code).toBe(code);
}

describe("parseFfprobeJson", () => {
  it("parses video metadata including dimensions, duration, rational fps, codecs, and audio details", () => {
    expect(parseFfprobeJson(videoProbeJson)).toEqual({
      kind: "video",
      durationSeconds: 12.345,
      width: 1920,
      height: 1080,
      fps: 30000 / 1001,
      videoCodec: "h264",
      audioCodec: "aac",
      hasAudio: true,
      sampleRate: 48000,
      channels: 2,
      streamCount: 2,
    });
  });

  it("parses audio-only metadata", () => {
    const metadata = parseFfprobeJson(JSON.stringify({
      streams: [
        {
          codec_type: "audio",
          codec_name: "mp3",
          sample_rate: 44100,
          channels: 1,
        },
      ],
      format: { duration: 5.25 },
    }));

    expect(metadata).toEqual({
      kind: "audio",
      durationSeconds: 5.25,
      audioCodec: "mp3",
      hasAudio: true,
      sampleRate: 44100,
      channels: 1,
      streamCount: 1,
    });
  });

  it("parses image/still metadata from image-like video streams without duration", () => {
    const metadata = parseFfprobeJson(JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "png",
          width: 800,
          height: 600,
          nb_frames: "1",
          avg_frame_rate: "0/0",
        },
      ],
      format: {},
    }));

    expect(metadata).toEqual({
      kind: "image",
      width: 800,
      height: 600,
      videoCodec: "png",
      hasAudio: false,
      streamCount: 1,
    });
  });

  it("throws a classified invalid_probe_output error for invalid probe output", () => {
    expect(() => parseFfprobeJson("not json")).toThrow(MediaProbeError);

    try {
      parseFfprobeJson(JSON.stringify({ format: {} }));
      throw new Error("expected parse to fail");
    } catch (error) {
      expectMediaProbeError(error, "invalid_probe_output");
    }
  });
});

describe("probeMediaMetadata", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  });

  function createTempFile(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-media-probe-test-"));
    tempDirs.push(dir);
    const inputPath = path.join(dir, "input.mp4");
    fs.writeFileSync(inputPath, "not a real media file; runProcess is injected");
    return inputPath;
  }

  it("classifies a missing file as missing_file and does not call runProcess", async () => {
    const runProcess = vi.fn<RunProbeProcess>();

    await expect(probeMediaMetadata(path.join(os.tmpdir(), "missing-nomi-media.mp4"), { ffprobePath: "ffprobe", runProcess }))
      .rejects.toMatchObject({ code: "missing_file" });
    expect(runProcess).not.toHaveBeenCalled();
  });

  it("uses ffprobe with a spawn args array and parses stdout", async () => {
    const inputPath = createTempFile();
    const runProcess = vi.fn<RunProbeProcess>().mockResolvedValue({ code: 0, stdout: videoProbeJson, stderr: "" });

    const metadata = await probeMediaMetadata(inputPath, { ffprobePath: "/usr/local/bin/ffprobe", runProcess });

    expect(runProcess).toHaveBeenCalledTimes(1);
    expect(runProcess).toHaveBeenCalledWith("/usr/local/bin/ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      inputPath,
    ]);
    expect(metadata.kind).toBe("video");
    expect(metadata.audioCodec).toBe("aac");
  });

  it("classifies invalid spawned probe output", async () => {
    const inputPath = createTempFile();
    const runProcess = vi.fn<RunProbeProcess>().mockResolvedValue({ code: 0, stdout: "not json", stderr: "" });

    await expect(probeMediaMetadata(inputPath, { ffprobePath: "ffprobe", runProcess }))
      .rejects.toMatchObject({ code: "invalid_probe_output" });
  });

  it("passes explicit timeout, output limits, and cancellation to the process runner", async () => {
    const inputPath = createTempFile();
    const controller = new AbortController();
    const runProcess = vi.fn<RunProbeProcess>().mockResolvedValue({ code: 0, stdout: videoProbeJson, stderr: "" });

    await probeMediaMetadata(inputPath, {
      ffprobePath: "/usr/local/bin/ffprobe",
      runProcess,
      signal: controller.signal,
      timeoutMs: 1_234,
      maxStdoutBytes: 4_096,
      maxStderrBytes: 2_048,
    });

    expect(runProcess).toHaveBeenCalledWith(
      "/usr/local/bin/ffprobe",
      expect.any(Array),
      {
        signal: controller.signal,
        timeoutMs: 1_234,
        maxStdoutBytes: 4_096,
        maxStderrBytes: 2_048,
      },
    );
  });
});

describe("runBoundedProcess", () => {
  it("kills a subprocess that exceeds its wall-clock limit", async () => {
    const error = await runBoundedProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { timeoutMs: 30, maxStdoutBytes: 1_024, maxStderrBytes: 1_024 },
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(BoundedProcessError);
    expect(error).toMatchObject({ code: "timeout" });
  });

  it.each([
    ["stdout", "process.stdout.write('x'.repeat(4096))"],
    ["stderr", "process.stderr.write('x'.repeat(4096))"],
  ])("kills a subprocess whose %s exceeds the configured limit", async (_stream, source) => {
    const error = await runBoundedProcess(
      process.execPath,
      ["-e", source],
      { timeoutMs: 1_000, maxStdoutBytes: 128, maxStderrBytes: 128 },
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(BoundedProcessError);
    expect(error).toMatchObject({ code: "output_limit" });
  });

  it("kills a subprocess when the caller cancels", async () => {
    const controller = new AbortController();
    const pending = runBoundedProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { signal: controller.signal, timeoutMs: 1_000, maxStdoutBytes: 1_024, maxStderrBytes: 1_024 },
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
});
