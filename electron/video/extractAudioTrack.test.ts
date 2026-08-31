import { describe, expect, it } from "vitest";
import {
  AUDIO_TRACK_BITRATE,
  AUDIO_TRACK_CHANNELS,
  AUDIO_TRACK_MAX_SECONDS,
  AUDIO_TRACK_SAMPLE_RATE,
  buildAudioTrackArgs,
} from "./extractAudioTrack";

describe("buildAudioTrackArgs", () => {
  it("丢掉视频流、单声道、16k、64kbps —— whisper 就吃这个规格", () => {
    const args = buildAudioTrackArgs("/in.mp4", "/out.mp3");
    expect(args).toEqual([
      "-y",
      "-i", "/in.mp4",
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-b:a", "64k",
      "/out.mp3",
    ]);
  });

  it("-vn 必须在，否则会连视频一起编码（体积爆炸且 whisper 收不了）", () => {
    expect(buildAudioTrackArgs("/a.mov", "/b.mp3")).toContain("-vn");
  });

  it("-i 紧跟输入路径，输出在末尾（ffmpeg 位置参数语义）", () => {
    const args = buildAudioTrackArgs("/x y/影片 01.mp4", "/tmp/o.mp3");
    expect(args[args.indexOf("-i") + 1]).toBe("/x y/影片 01.mp4");
    expect(args[args.length - 1]).toBe("/tmp/o.mp3");
  });
});

describe("音频规格常量", () => {
  it("参数钉死：给更高的没用——whisper 内部就重采样到 16k 单声道", () => {
    expect(AUDIO_TRACK_SAMPLE_RATE).toBe(16_000);
    expect(AUDIO_TRACK_CHANNELS).toBe(1);
    expect(AUDIO_TRACK_BITRATE).toBe("64k");
  });

  it("时长上限留在 whisper 的 25MB 之内（64kbps ≈ 8KB/s）", () => {
    const estimatedBytes = (AUDIO_TRACK_MAX_SECONDS * 64_000) / 8;
    expect(estimatedBytes).toBeLessThan(25 * 1024 * 1024);
  });
});
