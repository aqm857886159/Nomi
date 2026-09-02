import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createExportAuditManifest,
  deriveWebmExecutionManifest,
} from "./exportAuditManifest";

function sourceDigest(value: string): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function rendererManifest(): Record<string, unknown> {
  return {
    version: 1,
    projectId: "project-1",
    createdAt: "2026-08-29T00:00:00.000Z",
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
              id: "clip-1",
              assetId: "asset-1",
              startFrame: 0,
              endFrame: 90,
              sourceStartFrame: 3,
              sourceEndFrame: 93,
              audio: { gainDb: -3, muted: false, fadeInFrames: 3, fadeOutFrames: 4 },
            },
          ],
        },
      ],
      transitions: [
        { fromClipId: "clip-1", toClipId: "clip-2", type: "dissolve", durationFrames: 5 },
      ],
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
    assets: {
      "asset-1": {
        id: "asset-1",
        kind: "video",
        url: "nomi-local://asset/project-1/assets/private/interview.webm?token=secret",
        durationSeconds: 3,
        width: 1920,
        height: 1080,
        hasAudio: true,
      },
    },
    textOverlays: [
      { id: "title-1", startFrame: 2, endFrame: 20, pngBase64: "c2VjcmV0LXBpeGVscw==" },
    ],
    diagnostics: { warnings: ["Renderer WebM capture fallback is available."] },
  };
}

describe("export audit manifest", () => {
  it("freezes truthful renderer evidence while removing path, URL, and media bytes", () => {
    const raw = rendererManifest();
    const effectiveProfile = {
      ...((raw.profile as Record<string, unknown>) ?? {}),
      audioCodec: "aac",
      audioMode: "mixdown",
      audioBitrateKbps: 192,
    };

    const audit = createExportAuditManifest(raw, {
      projectId: "project-1",
      backend: "filtergraph",
      effectiveProfile,
    });

    expect(audit.timeline).toEqual(raw.timeline);
    expect(audit.profile).toEqual(effectiveProfile);
    expect(audit.execution).toEqual({ backend: "filtergraph" });
    expect(audit.assets).toEqual({
      "asset-1": {
        id: "asset-1",
        kind: "video",
        sourceDigest: sourceDigest("nomi-local://asset/project-1/assets/private/interview.webm?token=secret"),
        durationSeconds: 3,
        width: 1920,
        height: 1080,
        hasAudio: true,
      },
    });
    expect(audit.textOverlays).toEqual([
      {
        id: "title-1",
        startFrame: 2,
        endFrame: 20,
        contentDigest: sourceDigest("c2VjcmV0LXBpeGVscw=="),
      },
    ]);

    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain("nomi-local://");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("c2VjcmV0LXBpeGVscw==");
    expect(serialized).not.toContain("absolutePath");

    const rawTimeline = raw.timeline as { tracks: Array<{ clips: Array<{ endFrame: number }> }> };
    rawTimeline.tracks[0].clips[0].endFrame = 1;
    expect(audit.timeline.tracks[0].clips[0].endFrame).toBe(90);
  });

  it("derives a private WebM execution manifest without erasing canonical audit truth", () => {
    const audit = createExportAuditManifest(rendererManifest(), {
      projectId: "project-1",
      backend: "webm",
    });

    const execution = deriveWebmExecutionManifest(audit);

    expect(execution.timeline.tracks).toEqual([]);
    expect(execution.assets).toEqual({});
    expect(audit.timeline.tracks).toHaveLength(1);
    expect(Object.keys(audit.assets)).toEqual(["asset-1"]);
    expect(audit.execution.backend).toBe("webm");
  });

  it("rejects invalid clip and asset relations before creating audit evidence", () => {
    const raw = rendererManifest();
    const timeline = raw.timeline as { tracks: Array<{ clips: Array<{ assetId: string }> }> };
    timeline.tracks[0].clips[0].assetId = "missing-asset";

    expect(() => createExportAuditManifest(raw, { projectId: "project-1", backend: "webm" })).toThrow(
      /missing-asset|existing asset/i,
    );
  });
});
