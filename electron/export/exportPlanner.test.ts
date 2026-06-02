import { describe, expect, it } from "vitest";
import { planExport } from "./exportPlanner";
import type { NomiRenderManifestV1 } from "./exportManifest";

function baseManifest(overrides: Partial<NomiRenderManifestV1> = {}): NomiRenderManifestV1 {
  const manifest: NomiRenderManifestV1 = {
    version: 1,
    projectId: "project-1",
    createdAt: "2026-05-24T00:00:00.000Z",
    timeline: {
      fps: 30,
      durationFrames: 90,
      range: { startFrame: 0, endFrame: 90 },
      tracks: [],
    },
    profile: {
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
    },
    assets: {},
  };

  return {
    ...manifest,
    ...overrides,
    timeline: { ...manifest.timeline, ...overrides.timeline },
    profile: { ...manifest.profile, ...overrides.profile },
    assets: { ...manifest.assets, ...overrides.assets },
  };
}

const videoAsset = {
  id: "video-1",
  kind: "video" as const,
  absolutePath: "/Users/test/Videos/source.mp4",
  durationSeconds: 3,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: "h264",
};

const imageAsset = {
  id: "image-1",
  kind: "image" as const,
  absolutePath: "/Users/test/Pictures/title.png",
  width: 1920,
  height: 1080,
};

describe("export planner", () => {
  it("chooses the WebM transition backend for empty current renderer manifests", () => {
    const plan = planExport(baseManifest());

    expect(plan.backend).toBe("ffmpeg-webm-transcode");
    expect(plan.reason).toMatch(/empty|webm/i);
  });

  it("chooses Remotion when a text clip requires React rendering", () => {
    const plan = planExport(
      baseManifest({
        timeline: {
          fps: 30,
          durationFrames: 90,
          range: { startFrame: 0, endFrame: 90 },
          tracks: [
            {
              id: "text-track",
              kind: "video",
              clips: [{ id: "text-clip", startFrame: 0, endFrame: 90, text: { value: "Hello" } }],
            },
          ],
        },
      }),
    );

    expect(plan.backend).toBe("remotion-frame-render");
    expect(plan.reason).toMatch(/text|react|remotion/i);
  });

  it("chooses Remotion when a text track requires React rendering", () => {
    const plan = planExport(
      baseManifest({
        timeline: {
          fps: 30,
          durationFrames: 90,
          range: { startFrame: 0, endFrame: 90 },
          tracks: [{ id: "text-track", kind: "text", clips: [{ id: "text-clip", startFrame: 0, endFrame: 90 }] }],
        },
      }),
    );

    expect(plan.backend).toBe("remotion-frame-render");
  });

  it("chooses Remotion when clip effects are encoded as an array", () => {
    const plan = planExport(
      baseManifest({
        assets: { "video-1": videoAsset },
        timeline: {
          fps: 30,
          durationFrames: 90,
          range: { startFrame: 0, endFrame: 90 },
          tracks: [
            {
              id: "video-track",
              kind: "video",
              clips: [
                {
                  id: "clip-with-effect",
                  assetId: "video-1",
                  startFrame: 0,
                  endFrame: 90,
                  effects: [{ type: "blur" }],
                } as never,
              ],
            },
          ],
        },
      }),
    );

    expect(plan.backend).toBe("remotion-frame-render");
  });

  it("chooses the WebM transition backend for current renderer diagnostics", () => {
    const plan = planExport(
      baseManifest({
        diagnostics: {
          warnings: [
            "Renderer request omits unsupported tracks while WebM capture migration is incomplete.",
          ],
        },
      }),
    );

    expect(plan.backend).toBe("ffmpeg-webm-transcode");
  });

  it("chooses ffmpeg direct for a simple single video cut", () => {
    const plan = planExport(
      baseManifest({
        assets: { "video-1": videoAsset },
        timeline: {
          fps: 30,
          durationFrames: 90,
          range: { startFrame: 0, endFrame: 90 },
          tracks: [
            {
              id: "video-track",
              kind: "video",
              clips: [{ id: "clip-1", assetId: "video-1", startFrame: 0, endFrame: 90 }],
            },
          ],
        },
      }),
    );

    expect(plan.backend).toBe("ffmpeg-direct");
    expect(plan.reason).toMatch(/direct|video/i);
  });

  it("chooses ffmpeg filtergraph for image/video basic composition", () => {
    const plan = planExport(
      baseManifest({
        assets: { "video-1": videoAsset, "image-1": imageAsset },
        timeline: {
          fps: 30,
          durationFrames: 90,
          range: { startFrame: 0, endFrame: 90 },
          tracks: [
            {
              id: "video-track",
              kind: "video",
              clips: [{ id: "clip-1", assetId: "video-1", startFrame: 0, endFrame: 90 }],
            },
            {
              id: "image-track",
              kind: "video",
              clips: [{ id: "image-clip", assetId: "image-1", startFrame: 0, endFrame: 60 }],
            },
          ],
        },
      }),
    );

    expect(plan.backend).toBe("ffmpeg-filtergraph");
    expect(plan.reason).toMatch(/filtergraph|composition/i);
  });

  it("fails clearly for invalid manifests", () => {
    const invalidManifest = baseManifest({ projectId: "" });

    expect(() => planExport(invalidManifest)).toThrow(/projectId/i);
  });
});
