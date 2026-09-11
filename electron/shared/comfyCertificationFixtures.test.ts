import { describe, expect, it } from "vitest";
import { buildComfyCertificationFixtureParams } from "./comfyCertificationFixtures";

function decodeDataUrl(value: unknown): Buffer {
  expect(typeof value).toBe("string");
  const match = String(value).match(/^data:([^;]+);base64,(.+)$/);
  expect(match).not.toBeNull();
  return Buffer.from(match![2], "base64");
}

describe("ComfyUI certification fixtures", () => {
  it("creates distinct decodable PNGs for explicit image slots", () => {
    const result = buildComfyCertificationFixtureParams({
      vendorKey: "comfyui-local-a",
      modelKey: "workflow-a",
      slots: [
        { paramKey: "comfy_image_1", label: "A", mediaKind: "image" },
        { paramKey: "comfy_image_2", label: "B", mediaKind: "image" },
      ],
    });

    const first = decodeDataUrl(result.comfy_image_1);
    const second = decodeDataUrl(result.comfy_image_2);
    expect(first.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(second.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(first.equals(second)).toBe(false);
    expect(result.modelVendor).toBe("comfyui-local-a");
    expect(result.referenceImages).toEqual([result.comfy_image_1, result.comfy_image_2]);
  });

  it("uses a complete MP4 fixture and preserves exact slot declarations", () => {
    const result = buildComfyCertificationFixtureParams({
      vendorKey: "comfyui-local-a",
      modelKey: "workflow-a",
      slots: [{ paramKey: "comfy_video_1", label: "Source", mediaKind: "video" }],
    });

    const bytes = decodeDataUrl(result.comfy_video_1);
    expect(bytes.length).toBeGreaterThan(1_000);
    expect(bytes.subarray(4, 8).toString("ascii")).toBe("ftyp");
    expect(result.referenceVideoUrls).toEqual([result.comfy_video_1]);
    expect(result.parameterReferenceSlots).toEqual({
      vendorKey: "comfyui-local-a",
      modelKey: "workflow-a",
      slots: [{ key: "comfy_video_1", label: "Source", mediaKind: "video", group: "reference" }],
    });
  });

  it("uses a complete WAV fixture for a declared audio slot (LoadAudio 也要能真跑通「运行测试」)", () => {
    // 用户报的根因之一「ComfyUI 音频输入用不了」——半吊子实现最容易在这类"最后一米"复发：
    // 光把 LoadAudio 识别对了，若这里的付费测试链路没跟上，音频槽照样在真提交那一步落空。
    const result = buildComfyCertificationFixtureParams({
      vendorKey: "comfyui-local-a",
      modelKey: "workflow-a",
      slots: [{ paramKey: "comfy_audio_1", label: "Voice", mediaKind: "audio" }],
    });

    const bytes = decodeDataUrl(result.comfy_audio_1);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(result.referenceAudioUrls).toEqual([result.comfy_audio_1]);
    expect(result.parameterReferenceSlots).toEqual({
      vendorKey: "comfyui-local-a",
      modelKey: "workflow-a",
      slots: [{ key: "comfy_audio_1", label: "Voice", mediaKind: "audio", group: "reference" }],
    });
  });

  it("keeps image, video and audio fixtures independent when a workflow declares all three", () => {
    const result = buildComfyCertificationFixtureParams({
      vendorKey: "comfyui-local-a",
      modelKey: "workflow-a",
      slots: [
        { paramKey: "comfy_image_1", label: "Ref image", mediaKind: "image" },
        { paramKey: "comfy_video_1", label: "Source video", mediaKind: "video" },
        { paramKey: "comfy_audio_1", label: "Voice", mediaKind: "audio" },
      ],
    });
    expect(result.referenceImages).toEqual([result.comfy_image_1]);
    expect(result.referenceVideoUrls).toEqual([result.comfy_video_1]);
    expect(result.referenceAudioUrls).toEqual([result.comfy_audio_1]);
  });

  it("fails closed when a workflow declares more media slots than fixtures", () => {
    const slots = Array.from({ length: 9 }, (_, index) => ({
      paramKey: `comfy_image_${index + 1}`,
      label: `Image ${index + 1}`,
      mediaKind: "image" as const,
    }));
    expect(() => buildComfyCertificationFixtureParams({ vendorKey: "v", modelKey: "m", slots })).toThrow(
      "comfy_certification_fixture_capacity:8",
    );
  });
});
