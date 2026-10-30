import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BoundedProcessError,
  decodeMediaBytes,
  decodeMediaFile,
  isFfmpegProgressLine,
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
      "-protocol_whitelist",
      "file,pipe,data",
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

  // 「ffprobe 起不来」与「这个文件读不出」下一步不同（重装 vs 换文件），码必须分开；调用方不许去解析 message。
  it.each([
    [new BoundedProcessError("spawn_failed"), "probe_unavailable"],
    [new Error("runner exploded before starting"), "probe_unavailable"],
    [new BoundedProcessError("timeout"), "probe_failed"],
    [new BoundedProcessError("output_limit"), "probe_failed"],
    [new BoundedProcessError("cancelled"), "probe_failed"],
    [new BoundedProcessError("process_cleanup_failed"), "probe_failed"],
  ] as const)("classifies a runner failure %s as %s for file and byte probes alike", async (failure, code) => {
    const inputPath = createTempFile();
    const runProcess = vi.fn<RunProbeProcess>().mockRejectedValue(failure);

    expectMediaProbeError(await probeMediaMetadata(inputPath, { ffprobePath: "ffprobe", runProcess }).catch((error) => error), code);
    expectMediaProbeError(await probeMediaBytes(Buffer.from("x"), { ffprobePath: "ffprobe", runProcess }).catch((error) => error), code);
  });

  it("reports a nonzero ffprobe exit as this file failing, not as ffprobe being unavailable", async () => {
    const inputPath = createTempFile();
    const runProcess = vi.fn<RunProbeProcess>().mockResolvedValue({ code: 1, stdout: "", stderr: "moov atom not found" });

    expectMediaProbeError(await probeMediaMetadata(inputPath, { ffprobePath: "ffprobe", runProcess }).catch((error) => error), "probe_failed");
  });

  it("reports an ffprobe that cannot be spawned as unavailable (real spawn, no injected runner)", async () => {
    const inputPath = createTempFile();
    const missingBinary = path.join(path.dirname(inputPath), "no-such-dir", process.platform === "win32" ? "ffprobe.exe" : "ffprobe");

    expectMediaProbeError(await probeMediaMetadata(inputPath, { ffprobePath: missingBinary }).catch((error) => error), "probe_unavailable");
  });

  it("reports a file the bundled ffprobe cannot read as probe_failed (real ffprobe)", async () => {
    const inputPath = createTempFile();
    expectMediaProbeError(await probeMediaMetadata(inputPath, { ffprobePath: ffprobeInstaller.path }).catch((error) => error), "probe_failed");
  });
});

describe("bounded media decode", () => {
  it("probes bytes over stdin so certification and probing observe the same immutable bytes", async () => {
    const bytes = Buffer.from("same controlled bytes");
    const runProcess = vi.fn<RunProbeProcess>().mockResolvedValue({ code: 0, stdout: videoProbeJson, stderr: "" });

    await expect(probeMediaBytes(bytes, { ffprobePath: "ffprobe", runProcess })).resolves.toMatchObject({ kind: "video" });
    expect(runProcess).toHaveBeenCalledWith("ffprobe", expect.arrayContaining(["pipe:0"]), expect.objectContaining({ input: bytes }));
    expect(runProcess.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["-protocol_whitelist", "file,pipe,data"]));
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
    expect(args).toEqual(expect.arrayContaining(["-protocol_whitelist", "file,pipe,data"]));
    if (frames) expect(args).toEqual(expect.arrayContaining(["-frames:v", frames]));
    else expect(args).toEqual(expect.arrayContaining(["-t", "1"]));
    expect(options).toMatchObject({ input: bytes, timeoutMs: 3210 });
  });

  it("decodes seek-required containers from a controlled file path, not a non-seekable pipe", async () => {
    const inputDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-seek-required-"));
    const inputPath = path.join(inputDir, "input.mp4");
    fs.writeFileSync(inputPath, Buffer.from("controlled media file"));
    const runProcess = vi.fn<RunProbeProcess>().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    try {
      await decodeMediaFile(inputPath, "video", { ffmpegPath: "ffmpeg", runProcess, timeoutMs: 3210 });
      const [, args, options] = runProcess.mock.calls[0]!;
      expect(args).toEqual(expect.arrayContaining(["-i", inputPath, "-map", "0:v:0", "-frames:v", "1"]));
      expect(args).not.toContain("pipe:0");
      expect(options).not.toHaveProperty("input");
    } finally { fs.rmSync(inputDir, { recursive: true, force: true }); }
  });

  it("fails with a stable decode error when the file path is missing or not regular", async () => {
    const runProcess = vi.fn<RunProbeProcess>().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await expect(decodeMediaFile(path.join(os.tmpdir(), "nomi-media-does-not-exist.mp4"), "video", {
      ffmpegPath: "ffmpeg",
      runProcess,
    })).rejects.toMatchObject({ code: "decode_failed" });
    expect(runProcess).not.toHaveBeenCalled();
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

  it("does not let a hostile playlist make ffprobe or ffmpeg open HTTP", async () => {
    let requests = 0;
    const server = http.createServer((_request, response) => {
      requests += 1;
      response.writeHead(200, { "Content-Type": "video/mp2t" });
      response.end(Buffer.alloc(188));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    const playlist = Buffer.from(`#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:${address.port}/segment.ts\n#EXT-X-ENDLIST\n`);
    try {
      await probeMediaBytes(playlist, { timeoutMs: 2_000 }).catch(() => undefined);
      await decodeMediaBytes(playlist, "video", { timeoutMs: 2_000 }).catch(() => undefined);
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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

  it("observes teardown rejection on the real stop path without an unhandled promise", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const error = await runBoundedProcess(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { timeoutMs: 20, maxStdoutBytes: 1_024, maxStderrBytes: 1_024 },
        {
          terminateTree: async (child) => {
            child.kill("SIGKILL");
            throw new Error("taskkill failed after fallback");
          },
          cleanupDeadlineMs: 1_000,
        },
      ).catch((caught) => caught);
      expect(error).toMatchObject({ code: "process_cleanup_failed" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.removeListener("unhandledRejection", unhandled);
    }
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

  describe("stderr tail mode (long-running progress streams)", () => {
    // 假 ffmpeg：持续往 stderr 刷 -progress 记录，中间夹警告行（手机片的时间戳警告就是这样刷屏的），
    // 一共远超 1 MB，最后一条 progress=end 收尾、正常退出。
    const RECORDS = 9_000;
    const floodingProgress = `
      let i = 0;
      const step = () => {
        let chunk = "";
        for (let k = 0; k < 100 && i < ${RECORDS}; k += 1, i += 1) {
          chunk += "[mov,mp4 @ 0x1] Timestamps are unset in a packet for stream 0, frame " + i + ". This is deprecated and will stop working\\n";
          chunk += "frame=" + i + "\\nfps=30.00\\nout_time_ms=" + (i * 1000) + "\\nspeed=   1x\\nprogress=continue\\n";
        }
        const last = i >= ${RECORDS};
        if (last) chunk += "progress=end\\n";
        process.stderr.write(chunk, () => { if (!last) step(); });
      };
      step();
    `;
    const MAX_STDERR = 16 * 1024;

    it("keeps only the last maxStderrBytes, never kills for output volume, and keeps feeding progress", async () => {
      const outTimes: number[] = [];
      const stages: string[] = [];
      const result = await runBoundedProcess(
        process.execPath,
        ["-e", floodingProgress],
        {
          timeoutMs: 60_000,
          maxStdoutBytes: 1_024,
          maxStderrBytes: MAX_STDERR,
          stderrMode: "tail",
          onProgress: (progress) => {
            if (progress.outTimeMs !== undefined) outTimes.push(progress.outTimeMs);
            if (progress.stage) stages.push(progress.stage);
          },
        },
      );

      expect(result.code).toBe(0);
      // 每条记录都送到了解析器，一直送到最后一条（out_time_ms 是微秒，解析成毫秒）。
      expect(outTimes).toHaveLength(RECORDS);
      expect(outTimes.at(-1)).toBe(RECORDS - 1);
      expect(stages.at(-1)).toBe("end");
      // 只留尾巴做错误信息：不超过上限，而且是真的尾巴。
      expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThanOrEqual(MAX_STDERR);
      expect(result.stderr.endsWith("progress=end\n")).toBe(true);
    });

    it("counter-example: the default mode still stops the same flood as output_limit", async () => {
      const error = await runBoundedProcess(
        process.execPath,
        ["-e", floodingProgress],
        { timeoutMs: 60_000, maxStdoutBytes: 1_024, maxStderrBytes: MAX_STDERR, onProgress: () => undefined },
      ).catch((caught) => caught);
      expect(error).toBeInstanceOf(BoundedProcessError);
      expect(error).toMatchObject({ code: "output_limit" });
    });

    it("a throwing progress listener neither crashes the host nor stops the process", async () => {
      const result = await runBoundedProcess(
        process.execPath,
        ["-e", "process.stderr.write('out_time_ms=1000\\nprogress=continue\\nout_time_ms=2000\\nprogress=end\\n')"],
        {
          timeoutMs: 10_000,
          maxStdoutBytes: 1_024,
          maxStderrBytes: 1_024,
          stderrMode: "tail",
          onProgress: () => { throw new Error("listener bug"); },
        },
      );
      expect(result.code).toBe(0);
    });
  });

  it("recognizes ffmpeg -progress record lines, including padded values, and nothing else", () => {
    for (const line of ["frame=50", "fps=0.00", "stream_0_0_q=-1.0", "bitrate=  61.4kbits/s", "bitrate=N/A", "out_time=00:00:01.880078", "speed=   0x", "speed=85.7x", "progress=end"]) {
      expect(isFfmpegProgressLine(line), line).toBe(true);
    }
    for (const line of ["Conversion failed!", "Error while opening encoder for output stream #0:0 - maybe incorrect parameters such as bit_rate, rate, width or height", "[mp4 @ 0x1] Could not find tag for codec vp8 in stream #0, codec not currently supported in container", ""]) {
      expect(isFfmpegProgressLine(line), line).toBe(false);
    }
  });

  it("optionally lowers child priority before the bounded process runs", async () => {
    const setPriority = vi.fn();
    await runBoundedProcess(
      process.execPath,
      ["-e", "process.stdout.write('ok')"],
      { lowPriority: true, timeoutMs: 1_000, maxStdoutBytes: 1_024, maxStderrBytes: 1_024 },
      { setPriority },
    );
    expect(setPriority).toHaveBeenCalledWith(expect.any(Number));
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

  it("falls back to the direct Windows child when taskkill spawn/timeout/nonzero rejects", async () => {
    const child = { pid: 988, killed: false, kill: vi.fn(() => true) };
    await terminateProcessTree(child, true, {
      platform: "win32",
      killGroup: vi.fn(),
      runTaskkill: vi.fn(async () => { throw new Error("taskkill nonzero"); }),
    });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("reports a stable cleanup error when neither Windows taskkill nor direct-child kill succeeds", async () => {
    const child = { pid: 989, killed: false, kill: vi.fn(() => false) };
    await expect(terminateProcessTree(child, true, {
      platform: "win32",
      killGroup: vi.fn(),
      runTaskkill: vi.fn(async () => { throw new Error("taskkill timeout"); }),
    })).rejects.toMatchObject({ code: "process_cleanup_failed" });
  });
});

describe('serialized cleanup ownership',()=>{
 it('does not start force teardown while its earlier asynchronous teardown is pending',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  let release!:()=>void; const gate=new Promise<void>(r=>{release=r});
  const terminateTree=vi.fn(async(child:{kill:(signal:NodeJS.Signals)=>boolean})=>{await gate;child.kill('SIGKILL')});
  const controller=new AbortController();
  const pending=runBoundedProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal,timeoutMs:10000,maxStdoutBytes:1024,maxStderrBytes:1024},{terminateTree,cleanupGraceMs:0}).catch(error=>error);
  controller.abort();
  try {await vi.advanceTimersByTimeAsync(1);expect(terminateTree).toHaveBeenCalledTimes(1)}finally{release();await pending;vi.useRealTimers()}
 });
 it.each([{exitCode:0,signalCode:null},{exitCode:null,signalCode:'SIGKILL' as const}])('does not kill a positively observed exited child after a late taskkill rejection',async(exit)=>{
  const child={pid:999999,killed:false,kill:vi.fn(()=>false),...exit};
  await expect(terminateProcessTree(child,true,{platform:'win32',runTaskkill:async()=>{throw Error('already exited')}})).resolves.toBeUndefined();
  expect(child.kill).not.toHaveBeenCalled();
 });
})

it('serializes force escalation after delayed graceful cleanup settles with a live child',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r});
 let owned: {kill:(signal:NodeJS.Signals)=>boolean}|undefined;
 const terminateTree=vi.fn(async(child:{kill:(signal:NodeJS.Signals)=>boolean},force:boolean)=>{owned=child;if(force){child.kill('SIGKILL');return}await gate});
 const controller=new AbortController();
 const pending=runBoundedProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal,timeoutMs:10000,maxStdoutBytes:1024,maxStderrBytes:1024},{terminateTree,cleanupGraceMs:0}).catch(error=>error);
 controller.abort();
 try{await vi.advanceTimersByTimeAsync(1);expect(terminateTree).toHaveBeenCalledTimes(1);release();await vi.advanceTimersByTimeAsync(0);expect(terminateTree.mock.calls.map(call=>call[1])).toEqual([false,true]);await expect(pending).resolves.toMatchObject({code:'cancelled'})}finally{release();owned?.kill('SIGKILL');await pending;vi.useRealTimers()}
})

it('never launches new force cleanup after its final deadline even when earlier cleanup settles late',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r});
 let owned: {kill:(signal:NodeJS.Signals)=>boolean}|undefined;
 const terminateTree=vi.fn(async(child:{kill:(signal:NodeJS.Signals)=>boolean},force:boolean)=>{owned=child;if(force){child.kill('SIGKILL');return}await gate});
 const controller=new AbortController();
 const pending=runBoundedProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal,timeoutMs:10000,maxStdoutBytes:1024,maxStderrBytes:1024},{terminateTree,cleanupGraceMs:0,cleanupDeadlineMs:2}).catch(error=>error);
 controller.abort();
 try {await vi.advanceTimersByTimeAsync(2);await expect(pending).resolves.toMatchObject({code:'process_cleanup_failed'});owned?.kill('SIGKILL');release();await vi.advanceTimersByTimeAsync(0);expect(terminateTree.mock.calls.map(call=>call[1])).toEqual([false])}finally{release();owned?.kill('SIGKILL');await pending;vi.useRealTimers()}
})
