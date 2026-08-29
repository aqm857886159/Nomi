import { describe, expect, it } from "vitest";
import { assertValidManifest, parseManifestJson, serializeManifest, type NomiRenderManifestV1 } from "./exportManifest";

const validManifest = (): NomiRenderManifestV1 => ({
  version: 1,
  projectId: "project-1",
  createdAt: "2026-05-24T00:00:00.000Z",
  timeline: {
    fps: 30,
    durationFrames: 90,
    range: { startFrame: 0, endFrame: 90 },
    tracks: [
      {
        id: "track-1",
        kind: "video",
        clips: [
          {
            id: "clip-1",
            assetId: "asset-1",
            startFrame: 0,
            endFrame: 90,
          },
        ],
      },
    ],
  },
  profile: {
    preset: "publish",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    audioMode: "preserve-source",
    audioBitrateKbps: 192,
    width: 1920,
    height: 1080,
    fps: 30,
    pixelFormat: "yuv420p",
    quality: "standard",
  },
  assets: {
    "asset-1": {
      id: "asset-1",
      kind: "video",
      absolutePath: "/Users/test/Videos/source.mp4",
      durationSeconds: 3,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: "h264",
      audioCodec: "aac",
    },
  },
});

describe("Nomi render manifest v1", () => {
  it("accepts valid minimal manifest", () => {
    expect(() => assertValidManifest(validManifest())).not.toThrow();
  });

  it("rejects odd width/height", () => {
    const manifest = validManifest();
    manifest.profile.width = 1919;

    expect(() => assertValidManifest(manifest)).toThrow(/width/i);

    const manifestWithOddHeight = validManifest();
    manifestWithOddHeight.profile.height = 1079;

    expect(() => assertValidManifest(manifestWithOddHeight)).toThrow(/height/i);
  });

  it("rejects empty projectId", () => {
    const manifest = validManifest();
    manifest.projectId = "";

    expect(() => assertValidManifest(manifest)).toThrow(/projectId/i);
  });

  it("rejects clip with invalid range", () => {
    const manifest = validManifest();
    manifest.timeline.tracks[0].clips[0].endFrame = 0;

    expect(() => assertValidManifest(manifest)).toThrow(/clip/i);
  });

  it("rejects relative asset path", () => {
    const manifest = validManifest();
    manifest.assets["asset-1"].absolutePath = "relative/source.mp4";

    expect(() => assertValidManifest(manifest)).toThrow(/absolutePath/i);
  });

  it("rejects clip assetId values that do not exist in assets", () => {
    const manifest = validManifest();
    manifest.timeline.tracks[0].clips[0].assetId = "missing-asset";

    expect(() => assertValidManifest(manifest)).toThrow(/missing-asset/i);
  });

  it("rejects asset map entries whose key does not match asset.id", () => {
    const manifest = validManifest();
    manifest.assets["asset-2"] = { ...manifest.assets["asset-1"] };
    delete manifest.assets["asset-1"];

    expect(() => assertValidManifest(manifest)).toThrow(/asset-2.*id/i);
  });

  it("rejects non-positive optional asset probe metadata", () => {
    const invalidMetadataCases: Array<["durationSeconds" | "width" | "height" | "fps" | "sampleRate" | "channels", number]> = [
      ["durationSeconds", 0],
      ["width", 0],
      ["height", -1],
      ["fps", 0],
      ["sampleRate", 0],
      ["channels", -1],
    ];

    invalidMetadataCases.forEach(([field, value]) => {
      const manifest = validManifest();
      manifest.assets["asset-1"][field] = value;

      expect(() => assertValidManifest(manifest), field).toThrow(new RegExp(field, "i"));
    });
  });

  it("rejects fractional dimensions in optional asset probe metadata", () => {
    const manifest = validManifest();
    manifest.assets["asset-1"].width = 1920.5;

    expect(() => assertValidManifest(manifest)).toThrow(/width/i);
  });

  it("accepts video asset with hasAudio true metadata and round-trips it through serialize/parse", () => {
    const manifest = validManifest();
    manifest.profile.audioCodec = "none";
    manifest.profile.audioMode = "mute";
    delete manifest.profile.audioBitrateKbps;
    manifest.assets["asset-1"].hasAudio = true;

    const parsed = parseManifestJson(serializeManifest(manifest));

    expect(parsed.assets["asset-1"].hasAudio).toBe(true);
    expect(parsed.profile.audioCodec).toBe("none");
    expect(parsed.profile.audioMode).toBe("mute");
  });

  it("round-trips complete clip audio processing", () => {
    const manifest = validManifest();
    manifest.timeline.tracks[0].clips[0].audio = {
      gainDb: -6,
      muted: false,
      fadeInFrames: 12,
      fadeOutFrames: 18,
    };

    const parsed = parseManifestJson(serializeManifest(manifest));

    expect(parsed.timeline.tracks[0].clips[0].audio).toEqual(manifest.timeline.tracks[0].clips[0].audio);
  });

  it("rejects malformed or out-of-range clip audio instead of dropping it", () => {
    const cases: unknown[] = [
      { gainDb: 1, muted: false, fadeInFrames: 0, fadeOutFrames: 0 },
      { gainDb: -61, muted: false, fadeInFrames: 0, fadeOutFrames: 0 },
      { gainDb: -6, muted: "yes", fadeInFrames: 0, fadeOutFrames: 0 },
      { gainDb: -6, muted: false, fadeInFrames: -1, fadeOutFrames: 0 },
      { gainDb: -6, muted: false, fadeInFrames: 0.5, fadeOutFrames: 0 },
      { muted: false, fadeInFrames: 0, fadeOutFrames: 0 },
    ];
    cases.forEach((audio) => {
      const manifest = validManifest();
      (manifest.timeline.tracks[0].clips[0] as unknown as { audio: unknown }).audio = audio;
      expect(() => assertValidManifest(manifest), JSON.stringify(audio)).toThrow(/audio/i);
    });

    const overlapping = validManifest();
    overlapping.timeline.tracks[0].clips[0].audio = {
      gainDb: 0,
      muted: false,
      fadeInFrames: 50,
      fadeOutFrames: 50,
    };
    expect(() => assertValidManifest(overlapping)).toThrow(/visible clip duration/i);
  });

  it("rejects clip audio processing on image assets", () => {
    const manifest = validManifest();
    manifest.timeline.tracks[0].kind = "image";
    manifest.assets["asset-1"].kind = "image";
    manifest.timeline.tracks[0].clips[0].audio = {
      gainDb: -6,
      muted: false,
      fadeInFrames: 0,
      fadeOutFrames: 0,
    };

    expect(() => assertValidManifest(manifest)).toThrow(/image clips/i);
  });

  it("rejects invalid profile audio fields", () => {
    const preserveWithoutAac = validManifest();
    preserveWithoutAac.profile.audioCodec = "none";
    expect(() => assertValidManifest(preserveWithoutAac)).toThrow(/profile/i);

    const invalidBitrate = validManifest();
    invalidBitrate.profile.audioBitrateKbps = -1;
    expect(() => assertValidManifest(invalidBitrate)).toThrow(/profile/i);

    const invalidMode = validManifest() as unknown as { profile: { audioMode: string } };
    invalidMode.profile.audioMode = "silent";
    expect(() => assertValidManifest(invalidMode)).toThrow(/profile/i);
  });

  it("validates authored transition endpoints and duration", () => {
    const manifest = validManifest();
    manifest.timeline.tracks[0].clips.push({
      id: "clip-2",
      assetId: "asset-1",
      startFrame: 90,
      endFrame: 120,
    });
    manifest.timeline.transitions = [{
      fromClipId: "clip-1",
      toClipId: "clip-2",
      type: "dissolve",
      durationFrames: 6,
    }];
    expect(() => assertValidManifest(manifest)).not.toThrow();

    const invalid = validManifest();
    invalid.timeline.transitions = [{ fromClipId: "clip-1", toClipId: "clip-1", type: "cut" }];
    expect(() => assertValidManifest(invalid)).toThrow(/endpoints/i);
  });
});
