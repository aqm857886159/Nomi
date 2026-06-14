import { describe, expect, it } from "vitest";
import type { NomiRenderManifestV1 } from "./exportManifest";
import type { ExportProfile } from "./exportTypes";
import { compileFfmpegFiltergraph, FfmpegFiltergraphError } from "./ffmpegFiltergraph";

const profile: ExportProfile = {
  preset: "publish",
  container: "mp4",
  videoCodec: "h264",
  audioCodec: "none",
  audioMode: "mute",
  width: 1920,
  height: 1080,
  fps: 30,
  pixelFormat: "yuv420p",
  quality: "standard",
};

function manifest(overrides: Partial<NomiRenderManifestV1> = {}): NomiRenderManifestV1 {
  return {
    version: 1,
    projectId: "project-1",
    createdAt: "2026-05-24T00:00:00.000Z",
    timeline: {
      fps: 30,
      durationFrames: 150,
      range: { startFrame: 0, endFrame: 150 },
      tracks: [],
    },
    profile,
    assets: {},
    ...overrides,
  };
}

describe("compileFfmpegFiltergraph", () => {
  it("builds filtergraph for one image clip with 5s duration", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        assets: {
          image1: { id: "image1", kind: "image", absolutePath: "/media/still.png", width: 1000, height: 800 },
        },
        timeline: {
          fps: 30,
          durationFrames: 150,
          range: { startFrame: 0, endFrame: 150 },
          tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "image1", startFrame: 0, endFrame: 150 }] }],
        },
      }),
    });

    expect(plan.inputs).toEqual([{ assetId: "image1", path: "/media/still.png", kind: "image", inputArgs: ["-loop", "1", "-t", "5"] }]);
    // 白底（WYSIWYG，与预览舞台一致）
    expect(plan.filterComplex).toContain("color=white:size=1920x1080:rate=30:duration=5[base]");
    expect(plan.filterComplex).toContain("[0:v]trim=duration=5,setpts=PTS-STARTPTS");
    // 默认取景 contain×1：参数化 scale（min 取小、不补边），逗号转义 \,
    expect(plan.filterComplex).toContain("[clip_clip_1_segment]scale=w='min(1920/iw\\,1080/ih)*1*iw':h='min(1920/iw\\,1080/ih)*1*ih'[clip_clip_1_fitted]");
    // 居中 overlay（offset 0），定型 format 收口链尾一次
    expect(plan.filterComplex).toContain("[base][clip_clip_1_fitted]overlay=x='(main_w-overlay_w)/2+(0)*main_w':y='(main_h-overlay_h)/2+(0)*main_h':shortest=0:eof_action=pass:enable='gte(t,0)*lt(t,5)'[vcomposite]");
    expect(plan.filterComplex).toContain("[vcomposite]format=yuv420p[vout]");
    expect(plan.filterComplex).not.toContain("force_original_aspect_ratio");
    expect(plan.filterComplex).not.toContain("color=black");
    expect(plan.videoOutputLabel).toBe("[vout]");
  });

  it("cover 取景 → max 缩放铺满；非零 offset 进 overlay 位置", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        assets: { image1: { id: "image1", kind: "image", absolutePath: "/media/still.png" } },
        timeline: {
          fps: 30,
          durationFrames: 150,
          range: { startFrame: 0, endFrame: 150 },
          tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "image1", startFrame: 0, endFrame: 150, transform: { fit: "cover", scale: 1.5, offsetX: 0.2, offsetY: -0.1 } }] }],
        },
      }),
    });
    expect(plan.filterComplex).toContain("scale=w='max(1920/iw\\,1080/ih)*1.5*iw':h='max(1920/iw\\,1080/ih)*1.5*ih'");
    expect(plan.filterComplex).toContain("overlay=x='(main_w-overlay_w)/2+(0.2)*main_w':y='(main_h-overlay_h)/2+(-0.1)*main_h'");
  });

  it("builds trim/scale graph for one video clip honoring source frames", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        assets: {
          video1: { id: "video1", kind: "video", absolutePath: "/media/source.mov", durationSeconds: 30, width: 3840, height: 2160, fps: 30 },
        },
        timeline: {
          fps: 30,
          durationFrames: 60,
          range: { startFrame: 0, endFrame: 60 },
          tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "video1", startFrame: 0, endFrame: 60, sourceStartFrame: 30, sourceEndFrame: 90 }] }],
        },
      }),
    });

    expect(plan.inputs).toEqual([{ assetId: "video1", path: "/media/source.mov", kind: "video", inputArgs: [] }]);
    expect(plan.filterComplex).toContain("[0:v]trim=start=1:end=3,setpts=PTS-STARTPTS");
    expect(plan.filterComplex).toContain("[clip_clip_1_segment]scale=w='min(1920/iw\\,1080/ih)*1*iw':h='min(1920/iw\\,1080/ih)*1*ih'[clip_clip_1_fitted]");
    expect(plan.filterComplex).toContain("overlay=x='(main_w-overlay_w)/2+(0)*main_w':y='(main_h-overlay_h)/2+(0)*main_h':shortest=0:eof_action=pass:enable='gte(t,0)*lt(t,2)'[vcomposite]");
  });

  it("preserves deterministic bottom-to-top layer order for overlapping visual clips", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        assets: {
          bottom: { id: "bottom", kind: "image", absolutePath: "/media/bottom.png" },
          top: { id: "top", kind: "image", absolutePath: "/media/top.png" },
        },
        timeline: {
          fps: 30,
          durationFrames: 60,
          range: { startFrame: 0, endFrame: 60 },
          tracks: [
            { id: "bottom-track", kind: "visual", clips: [{ id: "clip-bottom", assetId: "bottom", startFrame: 0, endFrame: 60 }] },
            { id: "top-track", kind: "visual", clips: [{ id: "clip-top", assetId: "top", startFrame: 0, endFrame: 60 }] },
          ],
        },
      }),
    });

    expect(plan.filterComplex.indexOf("[clip_clip_bottom_fitted]")).toBeLessThan(plan.filterComplex.indexOf("[clip_clip_top_fitted]"));
    expect(plan.filterComplex).toContain("[base][clip_clip_bottom_fitted]overlay");
    expect(plan.filterComplex).toContain("[vstack0][clip_clip_top_fitted]overlay");
  });

  it("emits white background and shifts non-zero-start visual clips into timeline PTS", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        assets: {
          image1: { id: "image1", kind: "image", absolutePath: "/media/still.png" },
        },
        timeline: {
          fps: 30,
          durationFrames: 150,
          range: { startFrame: 0, endFrame: 150 },
          tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "image1", startFrame: 60, endFrame: 90 }] }],
        },
      }),
    });

    expect(plan.filterComplex).toContain("color=white:size=1920x1080:rate=30:duration=5[base]");
    expect(plan.filterComplex).toContain("[0:v]trim=duration=1,setpts=PTS-STARTPTS+2/TB[clip_clip_1_segment]");
    expect(plan.filterComplex).toContain("shortest=0:eof_action=pass:enable='gte(t,2)*lt(t,3)'[vcomposite]");
    expect(plan.filterComplex).toContain("[vcomposite]format=yuv420p[vout]");
  });

  it("classifies missing asset before FFmpeg spawn", () => {
    expect(() => compileFfmpegFiltergraph({
      manifest: manifest({
        timeline: {
          fps: 30,
          durationFrames: 30,
          range: { startFrame: 0, endFrame: 30 },
          tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "missing", startFrame: 0, endFrame: 30 }] }],
        },
        assets: {},
      }),
    })).toThrow(FfmpegFiltergraphError);

    try {
      compileFfmpegFiltergraph({
        manifest: manifest({
          timeline: {
            fps: 30,
            durationFrames: 30,
            range: { startFrame: 0, endFrame: 30 },
            tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "missing", startFrame: 0, endFrame: 30 }] }],
          },
          assets: {},
        }),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(FfmpegFiltergraphError);
      expect((error as FfmpegFiltergraphError).code).toBe("missing_asset");
    }
  });

  it("audioCodec none → 不产出音频输出", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        assets: { a1: { id: "a1", kind: "audio", absolutePath: "/media/a1.wav", durationSeconds: 10 } },
        timeline: {
          fps: 30, durationFrames: 150, range: { startFrame: 0, endFrame: 150 },
          tracks: [{ id: "audio-1", kind: "audio", clips: [{ id: "a-clip-1", assetId: "a1", startFrame: 0, endFrame: 150 }] }],
        },
      }),
    });
    expect(plan.audioOutputLabel).toBeUndefined();
    expect(plan.filterComplex).not.toContain("[aout]");
  });

  it("单个音频源 → atrim+asetpts+adelay 直出 [aout]，不用 amix", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        profile: { ...profile, audioCodec: "aac", audioMode: "mixdown" },
        assets: { a1: { id: "a1", kind: "audio", absolutePath: "/media/a1.wav", durationSeconds: 10 } },
        timeline: {
          fps: 30, durationFrames: 300, range: { startFrame: 0, endFrame: 300 },
          tracks: [{ id: "audio-1", kind: "audio", clips: [{ id: "a-clip-1", assetId: "a1", startFrame: 30, endFrame: 180 }] }],
        },
      }),
    });
    expect(plan.audioOutputLabel).toBe("[aout]");
    expect(plan.filterComplex).toContain("[0:a]atrim=start=0:end=5,asetpts=PTS-STARTPTS,adelay=1000|1000[aout]");
    expect(plan.filterComplex).not.toContain("amix");
  });

  it("多个音频源 → amix（normalize=0 防 1/N 衰减）", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        profile: { ...profile, audioCodec: "aac", audioMode: "mixdown" },
        assets: {
          a1: { id: "a1", kind: "audio", absolutePath: "/media/a1.wav", durationSeconds: 10 },
          a2: { id: "a2", kind: "audio", absolutePath: "/media/a2.wav", durationSeconds: 10 },
        },
        timeline: {
          fps: 30, durationFrames: 300, range: { startFrame: 0, endFrame: 300 },
          tracks: [
            { id: "audio-1", kind: "audio", clips: [{ id: "a-clip-1", assetId: "a1", startFrame: 0, endFrame: 150 }] },
            { id: "audio-2", kind: "audio", clips: [{ id: "a-clip-2", assetId: "a2", startFrame: 30, endFrame: 180 }] },
          ],
        },
      }),
    });
    expect(plan.audioOutputLabel).toBe("[aout]");
    expect(plan.filterComplex).toContain("amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aout]");
  });

  it("从自带音轨的 video clip 提取源音轨（hasAudio）", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        profile: { ...profile, audioCodec: "aac", audioMode: "mixdown" },
        assets: {
          video1: { id: "video1", kind: "video", absolutePath: "/media/clip.mp4", durationSeconds: 30, hasAudio: true },
        },
        timeline: {
          fps: 30, durationFrames: 60, range: { startFrame: 0, endFrame: 60 },
          tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "video1", startFrame: 0, endFrame: 60, sourceStartFrame: 30, sourceEndFrame: 90 }] }],
        },
      }),
    });
    // 视频帧仍参与画面
    expect(plan.filterComplex).toContain("[0:v]trim=start=1:end=3");
    // 同一输入的音轨被提取到 [aout]
    expect(plan.audioOutputLabel).toBe("[aout]");
    expect(plan.filterComplex).toContain("[0:a]atrim=start=1:end=3,asetpts=PTS-STARTPTS,adelay=0|0[aout]");
  });

  it("video clip 无音轨（hasAudio 未设）→ 不产出音频", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        profile: { ...profile, audioCodec: "aac", audioMode: "mixdown" },
        assets: { video1: { id: "video1", kind: "video", absolutePath: "/media/silent.mp4", durationSeconds: 30 } },
        timeline: {
          fps: 30, durationFrames: 60, range: { startFrame: 0, endFrame: 60 },
          tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "video1", startFrame: 0, endFrame: 60 }] }],
        },
      }),
    });
    expect(plan.audioOutputLabel).toBeUndefined();
  });

  it("appends text overlay chain after the visual graph", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        assets: {
          image1: { id: "image1", kind: "image", absolutePath: "/media/still.png", width: 1000, height: 800 },
        },
        timeline: {
          fps: 30,
          durationFrames: 150,
          range: { startFrame: 0, endFrame: 150 },
          tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "image1", startFrame: 0, endFrame: 150 }] }],
        },
      }),
      textOverlays: [
        { path: "/tmp/job/text-overlay-0.png", startFrame: 0, endFrame: 90 },
        { path: "/tmp/job/text-overlay-1.png", startFrame: 30, endFrame: 150 },
      ],
    });

    // 两条 overlay PNG 作为新输入接在素材输入之后（index 1、2），-loop 1 -t 全长 5s
    expect(plan.inputs[1]).toEqual({ assetId: "text_overlay_0", path: "/tmp/job/text-overlay-0.png", kind: "image", inputArgs: ["-loop", "1", "-t", "5"] });
    expect(plan.inputs[2]).toEqual({ assetId: "text_overlay_1", path: "/tmp/job/text-overlay-1.png", kind: "image", inputArgs: ["-loop", "1", "-t", "5"] });
    // 第一条 overlay：base=vcomposite（视觉链尾，未定型），输入 index 1，区间 0~3s
    expect(plan.filterComplex).toContain("[vcomposite][1:v]overlay=0:0:eof_action=pass:enable='between(t,0,3)'[vtxt0]");
    // 第二条 overlay：base=vtxt0，输入 index 2，区间 1~5s，末条补 format=yuv420p，输出 voutfinal
    expect(plan.filterComplex).toContain("[vtxt0][2:v]overlay=0:0:eof_action=pass:enable='between(t,1,5)',format=yuv420p[voutfinal]");
    expect(plan.videoOutputLabel).toBe("[voutfinal]");
  });

  it("leaves the graph untouched when there are no text overlays", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        assets: { image1: { id: "image1", kind: "image", absolutePath: "/media/still.png" } },
        timeline: {
          fps: 30,
          durationFrames: 150,
          range: { startFrame: 0, endFrame: 150 },
          tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "image1", startFrame: 0, endFrame: 150 }] }],
        },
      }),
      textOverlays: [],
    });
    expect(plan.videoOutputLabel).toBe("[vout]");
    expect(plan.filterComplex).not.toContain("text_overlay");
    expect(plan.inputs).toHaveLength(1);
  });
});
