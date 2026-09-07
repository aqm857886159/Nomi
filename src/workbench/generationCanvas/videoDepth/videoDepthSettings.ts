/**
 * Renderer-side helpers for the video depth node settings.
 *
 * Kept dependency-light on purpose: canonical schema/types live in
 * electron/shared/canvas/videoDepth.ts (neutral contract layer — the single
 * owner). This module only owns renderer defaults and small pure helpers used
 * by the node body / client; UI copy stays in i18n.
 */
import {
  parseVideoDepthSettings,
  VIDEO_DEPTH_FIXED_SKELETON,
  type VideoDepthMode,
  type VideoDepthSettings,
} from "../../../../electron/shared/canvas/videoDepth";

/** Immutable defaults (skeleton pinned to the fixed v1 style). */
export const DEFAULT_VIDEO_DEPTH_SETTINGS: VideoDepthSettings = {
  schemaVersion: 1,
  trimStartSeconds: 0,
  trimEndSeconds: 0,
  mode: "depth",
  depthModel: "small",
  poseModel: "full",
  maxPeople: 1,
  maxResolution: 768,
  processingFps: 30,
  depthStyle: "grayscale",
  depthDirection: "nearWhite",
  temporalSmoothing: 0.35,
  skeleton: VIDEO_DEPTH_FIXED_SKELETON,
  exportPoseJson: false,
};

/** Fresh default settings; callers own the returned object (no shared refs). */
export function createDefaultVideoDepthSettings(): VideoDepthSettings {
  return {
    ...DEFAULT_VIDEO_DEPTH_SETTINGS,
    skeleton: { ...VIDEO_DEPTH_FIXED_SKELETON },
  };
}

/** All modes offered in the v1 node body (order = UI order). */
export const VIDEO_DEPTH_UI_MODES: ReadonlyArray<VideoDepthMode> = [
  "depth",
  "depth_skeleton",
  "original_skeleton",
];

/** Parse + fallback: settings loaded from a node snapshot must never crash the node. */
export function coerceVideoDepthSettings(input: unknown): VideoDepthSettings {
  return parseVideoDepthSettings(input) ?? createDefaultVideoDepthSettings();
}

/** True when a skeleton-capable mode is selected (node body can hide pose-irrelevant controls). */
export function videoDepthUsesPose(mode: VideoDepthMode): boolean {
  return mode === "depth_skeleton" || mode === "original_skeleton";
}
