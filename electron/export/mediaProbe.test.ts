import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BoundedProcessError,
  decodeMediaBytes,
  MediaProbeError,
  parseFfprobeJson,
  probeMediaBytes,
  probeMediaMetadata,
  runBoundedProcess,
  terminateProcessTree,
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

  it("ignores attached cover art when classifying an audio file but counts every stream", () => {
    const metadata = parseFfprobeJson(JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "mjpeg",
          width: 600,
          height: 600,
          disposition: { attached_pic: 1 },
        },
        {
          codec_type: "audio",
          codec_name: "mp3",
          sample_rate: "44100",
          channels: 2,
        },
      ],
      format: { duration: "3.5" },
    }));

    expect(metadata).toMatchObject({
      kind: "audio",
      audioCodec: "mp3",
      hasAudio: true,
      streamCount: 2,
    });
    expect(metadata.videoCodec).toBeUndefined();
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

describe("bounded media decode", () => {
  it("probes bytes over stdin so certification and probing observe the same immutable bytes", async () => {
    const bytes = Buffer.from("same controlled bytes");
    const runProcess = vi.fn<RunProbeProcess>().mockResolvedValue({ code: 0, stdout: videoProbeJson, stderr: "" });

    await expect(probeMediaBytes(bytes, { ffprobePath: "ffprobe", runProcess })).resolves.toMatchObject({ kind: "video" });
    expect(runProcess).toHaveBeenCalledWith("ffprobe", expect.arrayContaining(["pipe:0"]), expect.objectContaining({ input: bytes }));
  });

  it.each([
    ["video" as const, "0:v:0", "1"],
    ["audio" as const, "0:a:0", undefined],
  ])("performs a real bounded %s decode to the null muxer", async (kind, map, frames) => {
    const runProcess = vi.fn<RunProbeProcess>().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const bytes = Buffer.from("controlled media bytes");

    await decodeMediaBytes(bytes, kind, { ffmpegPath: "ffmpeg", runProcess, timeoutMs: 3210 });

    const [, args, options] = runProcess.mock.calls[0]!;
    expect(args).toEqual(expect.arrayContaining(["-xerror", "-err_detect", "explode", "-i", "pipe:0", "-map", map, "-f", "null", "-"]));
    if (frames) expect(args).toEqual(expect.arrayContaining(["-frames:v", frames]));
    else expect(args).toEqual(expect.arrayContaining(["-t", "1"]));
    expect(options).toMatchObject({ input: bytes, timeoutMs: 3210 });
  });

  it("rejects a media payload that probes successfully but cannot decode a representative frame", async () => {
    const bytes = Buffer.from("truncated video whose container still probes");
    const runProcess = vi.fn<RunProbeProcess>()
      .mockResolvedValueOnce({ code: 0, stdout: videoProbeJson, stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "decode failed" });

    await expect(probeMediaBytes(bytes, { ffprobePath: "ffprobe", runProcess })).resolves.toMatchObject({ kind: "video" });
    await expect(decodeMediaBytes(bytes, "video", { ffmpegPath: "ffmpeg", runProcess }))
      .rejects.toMatchObject({ code: "decode_failed" });
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

  it("uses a detached POSIX process group and escalates from TERM to KILL", async () => {
    const killGroup = vi.fn();
    const killChild = vi.fn().mockReturnValue(true);
    const child = { pid: 4321, killed: false, kill: killChild };

    await terminateProcessTree(child, false, { platform: "darwin", killGroup, runTaskkill: vi.fn() });
    await terminateProcessTree(child, true, { platform: "darwin", killGroup, runTaskkill: vi.fn() });

    expect(killGroup).toHaveBeenNthCalledWith(1, -4321, "SIGTERM");
    expect(killGroup).toHaveBeenNthCalledWith(2, -4321, "SIGKILL");
    expect(killChild).not.toHaveBeenCalled();
  });

  it("waits for Windows taskkill /T /F completion before falling back to the direct child", async () => {
    const order: string[] = [];
    const runTaskkill = vi.fn(async (pid: number) => {
      order.push(`taskkill:${pid}`);
    });
    const child = { pid: 987, killed: false, kill: vi.fn(() => { order.push("child.kill"); return true; }) };

    await terminateProcessTree(child, true, { platform: "win32", killGroup: vi.fn(), runTaskkill });

    expect(runTaskkill).toHaveBeenCalledWith(987);
    expect(order).toEqual(["taskkill:987"]);
  });
});
