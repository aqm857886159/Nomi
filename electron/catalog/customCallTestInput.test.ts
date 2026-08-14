import { describe, expect, it } from "vitest";
import { buildCustomCallTestInput } from "./customCallTestInput";

describe("custom call test input", () => {
  it("没有自定义输入时仍使用低成本默认样例", () => {
    expect(buildCustomCallTestInput("video", {})).toEqual({
      prompt: "a red apple rolling on a wooden table, soft daylight",
      params: { duration: 5, n: 1 },
    });
  });

  it("允许用真实模式参数覆盖罐头输入，覆盖首尾帧、多参考、视频和音频", () => {
    expect(buildCustomCallTestInput("video", {
      prompt: "keep the character and camera motion",
      params: {
        first_frame_url: "https://cdn/first.png",
        last_frame_url: "https://cdn/last.png",
        reference_image_urls: ["https://cdn/character.png", "https://cdn/style.png"],
        reference_video_urls: ["https://cdn/motion.mp4"],
        reference_audio_urls: ["https://cdn/voice.mp3"],
        duration: 8,
      },
    })).toEqual({
      prompt: "keep the character and camera motion",
      params: {
        n: 1,
        duration: 8,
        first_frame_url: "https://cdn/first.png",
        last_frame_url: "https://cdn/last.png",
        reference_image_urls: ["https://cdn/character.png", "https://cdn/style.png"],
        reference_video_urls: ["https://cdn/motion.mp4"],
        reference_audio_urls: ["https://cdn/voice.mp3"],
      },
    });
  });
});
