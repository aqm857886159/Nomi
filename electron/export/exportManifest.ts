import path from "node:path";

import { type ExportProfile, isMp4ExportProfile } from "./exportTypes";

export type NomiRenderManifestV1 = {
  version: 1;
  projectId: string;
  createdAt: string;
  timeline: {
    fps: number;
    durationFrames: number;
    range: { startFrame: number; endFrame: number };
    tracks: NomiRenderTrack[];
  };
  /** Authored transitions between adjacent visual clips. */
  transitions?: NomiRenderTransition[];
  profile: ExportProfile;
  assets: Record<string, NomiRenderAsset>;
  diagnostics?: { warnings: string[] };
};

export type NomiRenderTransition = {
  fromClipId: string;
  toClipId: string;
  type: "cut" | "dissolve" | "fade" | "match_cut" | "whip_pan";
  durationFrames?: number;
};

export type NomiRenderAsset = {
  id: string;
  kind: "image" | "video" | "audio";
  absolutePath: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  hasAudio?: boolean;
  sampleRate?: number;
  channels?: number;
};

export type NomiRenderTrack = {
  id: string;
  kind?: string;
  type?: string;
  clips: NomiRenderClip[];
};

export type NomiRenderClip = {
  id: string;
  assetId?: string;
  startFrame: number;
  endFrame: number;
  sourceStartFrame?: number;
  sourceEndFrame?: number;
  transform?: Record<string, unknown>;
  text?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, fieldName: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
}

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

function assertIntegerInRange(value: unknown, fieldName: string, min: number, max?: number): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || (max !== undefined && value > max)) {
    const rangeDescription = max === undefined ? `>= ${min}` : `>= ${min} and <= ${max}`;
    throw new Error(`${fieldName} must be an integer ${rangeDescription}`);
  }
}

function assertOptionalPositiveNumber(value: unknown, fieldName: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
    throw new Error(`${fieldName} must be a positive finite number when present`);
  }
}

function assertOptionalPositiveInteger(value: unknown, fieldName: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0)) {
    throw new Error(`${fieldName} must be a positive finite integer when present`);
  }
}

function assertOptionalString(value: unknown, fieldName: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${fieldName} must be a string when present`);
  }
}

function assertOptionalBoolean(value: unknown, fieldName: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean when present`);
  }
}

function assertFrameRange(value: unknown, fieldName: string): asserts value is { startFrame: number; endFrame: number } {
  assertRecord(value, fieldName);
  assertIntegerInRange(value.startFrame, `${fieldName}.startFrame`, 0);
  assertIntegerInRange(value.endFrame, `${fieldName}.endFrame`, 0);

  if (value.endFrame < value.startFrame) {
    throw new Error(`${fieldName}.endFrame must be >= ${fieldName}.startFrame`);
  }
}

function assertValidProfile(value: unknown): asserts value is ExportProfile {
  if (!isMp4ExportProfile(value)) {
    throw new Error("profile must be a production MP4 export profile");
  }

  if (!Number.isInteger(value.width) || value.width <= 0 || value.width % 2 !== 0) {
    throw new Error("profile.width must be a positive even integer");
  }

  if (!Number.isInteger(value.height) || value.height <= 0 || value.height % 2 !== 0) {
    throw new Error("profile.height must be a positive even integer");
  }

  assertIntegerInRange(value.fps, "profile.fps", 1, 120);
}

function assertValidClip(value: unknown, fieldName: string): asserts value is NomiRenderClip {
  assertRecord(value, fieldName);
  assertNonEmptyString(value.id, `${fieldName}.id`);
  if (value.assetId !== undefined) {
    assertNonEmptyString(value.assetId, `${fieldName}.assetId`);
  }
  assertIntegerInRange(value.startFrame, `${fieldName}.startFrame`, 0);
  assertIntegerInRange(value.endFrame, `${fieldName}.endFrame`, 0);

  if (value.endFrame <= value.startFrame) {
    throw new Error(`${fieldName} clip endFrame must be greater than startFrame`);
  }

  if (value.sourceStartFrame !== undefined) {
    assertIntegerInRange(value.sourceStartFrame, `${fieldName}.sourceStartFrame`, 0);
  }
  if (value.sourceEndFrame !== undefined) {
    assertIntegerInRange(value.sourceEndFrame, `${fieldName}.sourceEndFrame`, 0);
  }
  if (
    value.sourceStartFrame !== undefined &&
    value.sourceEndFrame !== undefined &&
    value.sourceEndFrame <= value.sourceStartFrame
  ) {
    throw new Error(`${fieldName} sourceEndFrame must be greater than sourceStartFrame`);
  }
  if (value.transform !== undefined && !isRecord(value.transform)) {
    throw new Error(`${fieldName}.transform must be an object when present`);
  }
  if (value.text !== undefined && !isRecord(value.text)) {
    throw new Error(`${fieldName}.text must be an object when present`);
  }
}

function assertValidTransitions(value: unknown): asserts value is NomiRenderTransition[] {
  if (!Array.isArray(value)) throw new Error("transitions must be an array when present");
  value.forEach((transition, index) => {
    const fieldName = `transitions[${index}]`;
    assertRecord(transition, fieldName);
    assertNonEmptyString(transition.fromClipId, `${fieldName}.fromClipId`);
    assertNonEmptyString(transition.toClipId, `${fieldName}.toClipId`);
    if (!["cut", "dissolve", "fade", "match_cut", "whip_pan"].includes(String(transition.type))) {
      throw new Error(`${fieldName}.type must be a supported transition`);
    }
    if (transition.durationFrames !== undefined) {
      assertOptionalPositiveInteger(transition.durationFrames, `${fieldName}.durationFrames`);
    }
  });
}

function assertValidTrack(value: unknown, fieldName: string): asserts value is NomiRenderTrack {
  assertRecord(value, fieldName);
  assertNonEmptyString(value.id, `${fieldName}.id`);

  if (value.kind !== undefined) {
    assertNonEmptyString(value.kind, `${fieldName}.kind`);
  }
  if (value.type !== undefined) {
    assertNonEmptyString(value.type, `${fieldName}.type`);
  }
  if (value.kind === undefined && value.type === undefined) {
    throw new Error(`${fieldName} must include kind or type`);
  }

  if (!Array.isArray(value.clips)) {
    throw new Error(`${fieldName}.clips must be an array`);
  }
  value.clips.forEach((clip, clipIndex) => assertValidClip(clip, `${fieldName}.clips[${clipIndex}]`));
}

function assertValidAsset(value: unknown, fieldName: string): asserts value is NomiRenderAsset {
  assertRecord(value, fieldName);
  assertNonEmptyString(value.id, `${fieldName}.id`);

  if (value.kind !== "image" && value.kind !== "video" && value.kind !== "audio") {
    throw new Error(`${fieldName}.kind must be image, video, or audio`);
  }

  assertNonEmptyString(value.absolutePath, `${fieldName}.absolutePath`);
  if (!path.isAbsolute(value.absolutePath)) {
    throw new Error(`${fieldName}.absolutePath must be absolute`);
  }

  assertOptionalPositiveNumber(value.durationSeconds, `${fieldName}.durationSeconds`);
  assertOptionalPositiveInteger(value.width, `${fieldName}.width`);
  assertOptionalPositiveInteger(value.height, `${fieldName}.height`);
  assertOptionalPositiveNumber(value.fps, `${fieldName}.fps`);
  assertOptionalString(value.videoCodec, `${fieldName}.videoCodec`);
  assertOptionalString(value.audioCodec, `${fieldName}.audioCodec`);
  assertOptionalBoolean(value.hasAudio, `${fieldName}.hasAudio`);
  assertOptionalPositiveInteger(value.sampleRate, `${fieldName}.sampleRate`);
  assertOptionalPositiveInteger(value.channels, `${fieldName}.channels`);
}

function assertClipAssetReferencesExist(tracks: NomiRenderTrack[], assets: Record<string, NomiRenderAsset>): void {
  tracks.forEach((track, trackIndex) => {
    track.clips.forEach((clip, clipIndex) => {
      if (clip.assetId !== undefined && assets[clip.assetId] === undefined) {
        throw new Error(`timeline.tracks[${trackIndex}].clips[${clipIndex}].assetId ${clip.assetId} must reference an existing asset`);
      }
    });
  });
}

function assertValidDiagnostics(value: unknown): asserts value is { warnings: string[] } {
  assertRecord(value, "diagnostics");
  if (!Array.isArray(value.warnings) || value.warnings.some((warning) => typeof warning !== "string")) {
    throw new Error("diagnostics.warnings must be an array of strings");
  }
}

export function assertValidManifest(value: unknown): asserts value is NomiRenderManifestV1 {
  assertRecord(value, "manifest");

  if (value.version !== 1) {
    throw new Error("manifest.version must be 1");
  }
  assertNonEmptyString(value.projectId, "projectId");
  assertNonEmptyString(value.createdAt, "createdAt");

  assertRecord(value.timeline, "timeline");
  assertIntegerInRange(value.timeline.fps, "timeline.fps", 1, 120);
  assertIntegerInRange(value.timeline.durationFrames, "timeline.durationFrames", 0);
  assertFrameRange(value.timeline.range, "timeline.range");

  if (!Array.isArray(value.timeline.tracks)) {
    throw new Error("timeline.tracks must be an array");
  }
  value.timeline.tracks.forEach((track, index) => assertValidTrack(track, `timeline.tracks[${index}]`));

  assertValidProfile(value.profile);

  assertRecord(value.assets, "assets");
  Object.entries(value.assets).forEach(([assetId, asset]) => {
    assertValidAsset(asset, `assets.${assetId}`);
    if (asset.id !== assetId) {
      throw new Error(`assets.${assetId}.id must match asset key`);
    }
  });

  assertClipAssetReferencesExist(value.timeline.tracks as NomiRenderTrack[], value.assets as Record<string, NomiRenderAsset>);

  if (value.transitions !== undefined) {
    assertValidTransitions(value.transitions);
  }

  if (value.diagnostics !== undefined) {
    assertValidDiagnostics(value.diagnostics);
  }
}

export function serializeManifest(manifest: NomiRenderManifestV1): string {
  assertValidManifest(manifest);
  return JSON.stringify(manifest, null, 2);
}

export function parseManifestJson(json: string): NomiRenderManifestV1 {
  const value: unknown = JSON.parse(json);
  assertValidManifest(value);
  return value;
}
