import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  playableMp4FileName,
  maxTranscodeThreads,
  playableMp4Plan,
  remuxArgsForPlayableMp4,
  transcodeArgsForPlayableMp4,
  transcodeFileToPlayableMp4IfNeeded,
  transcodeTimeoutMs,
  videoNeedsPlayabilityTranscode,
} from "./videoImportNormalize";
import { probeMediaMetadata, runBoundedProcess, type BoundedProcessOptions, type MediaProbeMetadata } from "../export/mediaProbe";

// 进程那一层换成可控的假实现（真 ffmpeg 的全链路在 videoImportNormalize.integration.test.ts）；纯函数照用真的。
vi.mock("../export/mediaProbe", async (importOriginal) => ({
  ...await importOriginal<typeof import("../export/mediaProbe")>(),
  probeMediaMetadata: vi.fn(),
  runBoundedProcess: vi.fn(),
}));

function probe(overrides: Partial<MediaProbeMetadata>): MediaProbeMetadata {
  return { kind: "video", hasAudio: false, ...overrides };
}

describe("videoNeedsPlayabilityTranscode — Chromium 可播判定（导入归一化 + 懒自愈共用）", () => {
  it("h264 mp4（手机/供应商主流产物）→ 可播，不转", () => {
    expect(videoNeedsPlayabilityTranscode("clip.mp4", probe({ videoCodec: "h264" }))).toBeNull()
    expect(
      videoNeedsPlayabilityTranscode("clip.mov", probe({ videoCodec: "h264", hasAudio: true, audioCodec: "aac" })),
    ).toBeNull()
  })

  it("vp9 webm / av1 mp4 → 可播，不转", () => {
    expect(videoNeedsPlayabilityTranscode("clip.webm", probe({ videoCodec: "vp9", hasAudio: true, audioCodec: "opus" }))).toBeNull()
    expect(videoNeedsPlayabilityTranscode("clip.mp4", probe({ videoCodec: "av1" }))).toBeNull()
  })

  it("HEVC（iPhone 默认录制）→ 要转（群反馈根因：Windows Chromium 解不了，节点灰壳 0:00）", () => {
    expect(videoNeedsPlayabilityTranscode("IMG_0001.mov", probe({ videoCodec: "hevc" }))).toBe("codec:hevc")
    expect(videoNeedsPlayabilityTranscode("clip.mp4", probe({ videoCodec: "hevc" }))).toBe("codec:hevc")
  })

  it("AVI/MKV 等容器 → 要转（<video> 不认这些容器，哪怕内层是 h264）", () => {
    expect(videoNeedsPlayabilityTranscode("old.avi", probe({ videoCodec: "h264" }))).toBe("container:avi")
    expect(videoNeedsPlayabilityTranscode("rip.mkv", probe({ videoCodec: "h264" }))).toBe("container:mkv")
  })

  it("音轨编码不受支持（如 ac3）→ 要转（画面能播但没声，同样是静默残缺）", () => {
    expect(
      videoNeedsPlayabilityTranscode("tv.mp4", probe({ videoCodec: "h264", hasAudio: true, audioCodec: "ac3" })),
    ).toBe("audio:ac3")
  })

  it("无音轨不因音频误伤；未知视频编码按不可播处理", () => {
    expect(videoNeedsPlayabilityTranscode("clip.mp4", probe({ videoCodec: "h264", hasAudio: false }))).toBeNull()
    expect(videoNeedsPlayabilityTranscode("clip.mp4", probe({}))).toBe("codec:unknown")
  })
})

describe("playableMp4Plan — 只换「换得进 MP4、换完放得了」的", () => {
  const playable = new Set(["h264", "hevc", "vp8", "vp9", "av1"])
  const plan = (fileName: string, overrides: Partial<MediaProbeMetadata>, codecs: ReadonlySet<string> = playable) => {
    const media = probe(overrides)
    return playableMp4Plan(videoNeedsPlayabilityTranscode(fileName, media, codecs)!, media, codecs)
  }

  it("H.264 / HEVC / VP9 / AV1 + AAC / MP3：视频音频都原样拷", () => {
    expect(plan("a.mkv", { videoCodec: "h264", hasAudio: true, audioCodec: "aac" })).toEqual({ video: "copy", audio: "copy" })
    expect(plan("a.mkv", { videoCodec: "hevc", hasAudio: true, audioCodec: "mp3" })).toEqual({ video: "copy", audio: "copy" })
    expect(plan("a.mkv", { videoCodec: "vp9" })).toEqual({ video: "copy", audio: "copy" })
    expect(plan("a.flv", { videoCodec: "av1", hasAudio: true, audioCodec: "aac" })).toEqual({ video: "copy", audio: "copy" })
  })

  it("FLAC / Vorbis / Opus / AC-3 音轨：视频照拷，音频转 AAC（FLAC、4.1 包里的 Opus 都要 -strict -2；Vorbis 换进去 Chromium 不保证认）", () => {
    for (const audioCodec of ["flac", "vorbis", "opus", "ac3", "pcm_s16le"]) {
      expect(plan("a.mkv", { videoCodec: "h264", hasAudio: true, audioCodec }), audioCodec).toEqual({ video: "copy", audio: "aac" })
    }
    // 容器能放、只是音轨不行（MOV + LPCM）：同样只转音频
    expect(plan("a.mov", { videoCodec: "h264", hasAudio: true, audioCodec: "pcm_s16le" })).toEqual({ video: "copy", audio: "aac" })
  })

  it("VP8 进不了 MP4 → 整段重编码（哪怕本机能放 VP8）", () => {
    expect(plan("a.mkv", { videoCodec: "vp8", hasAudio: true, audioCodec: "vorbis" })).toEqual({ video: "encode", audio: "aac" })
  })

  it("本机放不了的 codec、探测失败 → 整段重编码", () => {
    expect(plan("a.mkv", { videoCodec: "hevc" }, new Set(["h264"]))).toEqual({ video: "encode", audio: "aac" })
    expect(playableMp4Plan("probe_failed", probe({}), playable)).toEqual({ video: "encode", audio: "aac" })
    expect(plan("a.avi", { videoCodec: "mpeg4" })).toEqual({ video: "encode", audio: "aac" })
  })
})

describe("transcodeTimeoutMs — 超时按片长算", () => {
  it("9 分钟的片：90 分钟（慢机器 0.2–0.3 倍速软编 4K 也够）", () => {
    expect(transcodeTimeoutMs(9 * 60)).toBe(90 * 60 * 1000)
  })

  it("短片不低于 30 分钟；探不到片长给 2 小时", () => {
    expect(transcodeTimeoutMs(10)).toBe(30 * 60 * 1000)
    expect(transcodeTimeoutMs(undefined)).toBe(2 * 60 * 60 * 1000)
    expect(transcodeTimeoutMs(0)).toBe(2 * 60 * 60 * 1000)
    expect(transcodeTimeoutMs(Number.NaN)).toBe(2 * 60 * 60 * 1000)
  })
})

describe("transcodeArgsForPlayableMp4 — 转码参数", () => {
  it("H.264+AAC、faststart、偶数边夹取、覆盖输出", () => {
    const args = transcodeArgsForPlayableMp4("/tmp/in.mov", "/tmp/out.mp4")
    expect(args[0]).toBe("-y")
    expect(args).toContain("libx264")
    expect(args).toContain("aac")
    expect(args).toContain("+faststart")
    expect(args.join(" ")).toContain("scale=trunc(iw/2)*2:trunc(ih/2)*2")
    expect(args[args.length - 1]).toBe("/tmp/out.mp4")
    expect(Number(args[args.indexOf("-threads") + 1])).toBeGreaterThanOrEqual(1)
  })
})

describe("remuxArgsForPlayableMp4 — 可播 codec 只换容器", () => {
  it("视频流 copy，音频可播时也 copy，不出现 libx264", () => {
    const args = remuxArgsForPlayableMp4("/tmp/in.mkv", "/tmp/out.mp4", true)
    expect(args).toContain("copy")
    expect(args).not.toContain("libx264")
    expect(args[args.indexOf("-c:a") + 1]).toBe("copy")
  })

  it("只有音频不可播时转 AAC，视频仍 copy", () => {
    const args = remuxArgsForPlayableMp4("/tmp/in.mkv", "/tmp/out.mp4", false)
    expect(args[args.indexOf("-c:v") + 1]).toBe("copy")
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac")
    expect(args).not.toContain("libx264")
  })

  it("只取第一条音轨：判据只看了它，多条音轨各拷各的会把进不了 MP4 的那条也拷进去", () => {
    const args = remuxArgsForPlayableMp4("/tmp/in.mkv", "/tmp/out.mp4", true)
    expect(args.join(" ")).toContain("-map 0:v:0 -map 0:a:0?")
  })
})

it("给系统留两个核，至少保留一个线程", () => {
  expect(maxTranscodeThreads(8)).toBe(6)
  expect(maxTranscodeThreads(1)).toBe(1)
})

describe("playableMp4FileName", () => {
  it("换扩展名为 .mp4，空名兜底", () => {
    expect(playableMp4FileName("IMG_0001.MOV")).toBe("IMG_0001.mp4")
    expect(playableMp4FileName("")).toBe("video.mp4")
  })
})

describe("transcodeFileToPlayableMp4IfNeeded — 交给有界运行器的那一次调用", () => {
  let dir = "";
  let input = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-normalize-unit-"));
    input = path.join(dir, "clip.avi");
    fs.writeFileSync(input, "source");
  });
  afterEach(() => {
    vi.mocked(probeMediaMetadata).mockReset();
    vi.mocked(runBoundedProcess).mockReset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** 假 ffmpeg：按给定的 out_time（毫秒）报进度、写出产物、按给定退出码结束。 */
  function fakeFfmpeg(outTimesMs: number[], code = 0, stderr = "") {
    vi.mocked(runBoundedProcess).mockImplementation(async (_command, args, options?: BoundedProcessOptions) => {
      for (const outTimeMs of outTimesMs) options?.onProgress?.({ outTimeMs, stage: "continue" });
      if (code === 0) fs.writeFileSync(args[args.length - 1]!, "mp4");
      return { code, stdout: "", stderr };
    });
  }

  it("tail 模式、-loglevel error、超时按片长：长转码不会被自己的进度输出或写死的 30 分钟杀掉", async () => {
    vi.mocked(probeMediaMetadata).mockResolvedValue(probe({ videoCodec: "mpeg4", durationSeconds: 9 * 60 }));
    fakeFfmpeg([]);
    await transcodeFileToPlayableMp4IfNeeded(input, "clip.avi", dir);
    const [, args, options] = vi.mocked(runBoundedProcess).mock.calls[0]!;
    expect(options).toMatchObject({ stderrMode: "tail", timeoutMs: 90 * 60 * 1000, lowPriority: true });
    expect(args.slice(0, args.indexOf("-y"))).toEqual(["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:2"]);
  });

  it("知道片长：比例单调涨到 1", async () => {
    vi.mocked(probeMediaMetadata).mockResolvedValue(probe({ videoCodec: "mpeg4", durationSeconds: 10 }));
    fakeFfmpeg([2_500, 5_000, 10_000]);
    const ratios: number[] = [];
    await transcodeFileToPlayableMp4IfNeeded(input, "clip.avi", dir, { onProgress: (ratio) => ratios.push(ratio) });
    expect(ratios).toEqual([0, 0.25, 0.5, 1, 1]);
  });

  it("片长未知：只报开头的 0，不编比例，也不在结尾跳一个 100%", async () => {
    vi.mocked(probeMediaMetadata).mockRejectedValue(new Error("moov atom not found"));
    fakeFfmpeg([2_500, 5_000, 10_000]);
    const ratios: number[] = [];
    const result = await transcodeFileToPlayableMp4IfNeeded(input, "clip.avi", dir, { onProgress: (ratio) => ratios.push(ratio) });
    expect(result?.reason).toBe("probe_failed");
    expect(ratios).toEqual([0]);
    expect(vi.mocked(runBoundedProcess).mock.calls[0]![2]).toMatchObject({ timeoutMs: 2 * 60 * 60 * 1000 });
  });

  it("失败时的错误信息挑真正的错误行，不拿进度记录凑数；半成品删掉", async () => {
    vi.mocked(probeMediaMetadata).mockResolvedValue(probe({ videoCodec: "mpeg4", durationSeconds: 10 }));
    vi.mocked(runBoundedProcess).mockImplementation(async (_command, args) => {
      fs.writeFileSync(args[args.length - 1]!, "half");
      return { code: 1, stdout: "", stderr: "Error while decoding stream #0:0: Invalid data found when processing input\nframe=10\nout_time_ms=1000\nspeed=   1x\nprogress=end\n" };
    });
    await expect(transcodeFileToPlayableMp4IfNeeded(input, "clip.avi", dir)).rejects.toThrow("Error while decoding stream #0:0: Invalid data found when processing input");
    expect(fs.existsSync(path.join(dir, "clip-playable.mp4"))).toBe(false);
  });

  it("探测被同一个信号截断 → 以取消结束，不当探测失败去转码", async () => {
    const controller = new AbortController();
    vi.mocked(probeMediaMetadata).mockImplementation(async () => {
      controller.abort();
      throw new Error("ffprobe process cancelled");
    });
    await expect(transcodeFileToPlayableMp4IfNeeded(input, "clip.avi", dir, { signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
    expect(runBoundedProcess).not.toHaveBeenCalled();
  });
});
