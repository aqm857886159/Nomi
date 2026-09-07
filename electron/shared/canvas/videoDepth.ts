/**
 * Depth video process node — cross-process contract.
 *
 * Pure, serializable schema + parser shared by renderer (node settings UI /
 * orchestration) and Electron main (job execution). No Electron, React,
 * filesystem, i18n or provider imports, mirroring electron/shared/canvas/
 * conventions (see generationNodeStatus.ts).
 *
 * Scope discipline (2026-09-06 product decision, Stage 1+2):
 * - modes: depth | depth_skeleton | original_skeleton. `skeleton_black` is
 *   explicitly OUT of v1 and therefore absent from the schema (fail-closed).
 * - depthStyle: only 'grayscale'. inferno/viridis are visualization-only and
 *   carry no value for downstream video_ref models; absent from schema.
 * - poseModel: only 'full'. lite/heavy are OUT of v1; absent from schema.
 * - skeleton styling is fixed internally (lineWidth 3 / jointRadius 5 /
 *   confidence 0.35 / glow false) and not exposed in UI; unknown inputs are
 *   coerced to these defaults rather than rejected so legacy snapshots that
 *   carried tuned values keep loading.
 */
import { z } from "zod";

export const VIDEO_DEPTH_MODES = ["depth", "depth_skeleton", "original_skeleton"] as const;
export const VIDEO_DEPTH_MODEL_SIZES = ["small", "base"] as const;
export const VIDEO_DEPTH_RESOLUTIONS = [512, 768, 1024, "original"] as const;
export const VIDEO_DEPTH_FPS = [8, 12, 15, 24, 30, 60] as const;

const videoDepthFpsSchema = z.union([
  z.literal(8),
  z.literal(12),
  z.literal(15),
  z.literal(24),
  z.literal(30),
  z.literal(60),
]);
export const VIDEO_DEPTH_DEPTH_DIRECTIONS = ["nearWhite", "nearBlack"] as const;
export const VIDEO_DEPTH_SOURCE_KINDS = ["canvas-video-node", "local-mp4", "url"] as const;

export const videoDepthSourceReferenceSchema = z
  .object({
    sourceNodeId: z.string().optional(),
    sourceAssetRef: z.string().optional(),
    sourceUrl: z.string().min(1),
    title: z.string().min(1),
    durationSeconds: z.number().nonnegative().optional(),
    sourceKind: z.enum(VIDEO_DEPTH_SOURCE_KINDS),
  })
  .strict();

/** Skeleton styling is fixed in v1 (not exposed in UI). Inputs are tolerated for snapshot
 *  compatibility but the parse output is always this constant. */
export const VIDEO_DEPTH_FIXED_SKELETON = {
  lineWidth: 3,
  jointRadius: 5,
  confidence: 0.35,
  glow: false,
} as const;

export type VideoDepthSkeletonStyle = typeof VIDEO_DEPTH_FIXED_SKELETON;

/** Loose input shape: legacy snapshots may carry tuned values; they are discarded on parse. */
export const videoDepthSkeletonInputSchema = z
  .object({
    lineWidth: z.number().optional(),
    jointRadius: z.number().optional(),
    confidence: z.number().optional(),
    glow: z.boolean().optional(),
  })
  .default({});

export const videoDepthSettingsSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    sourceVideoRef: videoDepthSourceReferenceSchema.optional(),
    trimStartSeconds: z.number().nonnegative().default(0),
    trimEndSeconds: z.number().nonnegative().default(0),
    mode: z.enum(VIDEO_DEPTH_MODES).default("depth"),
    depthModel: z.enum(VIDEO_DEPTH_MODEL_SIZES).default("small"),
    poseModel: z.enum(["full"]).default("full"),
    maxPeople: z.number().int().min(1).max(4).default(1),
    maxResolution: z.union([z.literal(512), z.literal(768), z.literal(1024), z.literal("original")]).default(768),
    processingFps: videoDepthFpsSchema.default(30),
    depthStyle: z.enum(["grayscale"]).default("grayscale"),
    depthDirection: z.enum(VIDEO_DEPTH_DEPTH_DIRECTIONS).default("nearWhite"),
    temporalSmoothing: z.number().min(0).max(1).default(0.35),
    skeleton: videoDepthSkeletonInputSchema,
    exportPoseJson: z.boolean().default(false),
    updatedAt: z.string().optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.trimEndSeconds !== 0 && s.trimEndSeconds < s.trimStartSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "trimEndSeconds must be 0 (source end) or >= trimStartSeconds",
        path: ["trimEndSeconds"],
      });
    }
  });

export type VideoDepthMode = (typeof VIDEO_DEPTH_MODES)[number];
export type VideoDepthModelSize = (typeof VIDEO_DEPTH_MODEL_SIZES)[number];
export type VideoDepthResolution = (typeof VIDEO_DEPTH_RESOLUTIONS)[number];
export type VideoDepthFps = (typeof VIDEO_DEPTH_FPS)[number];
export type VideoDepthDepthDirection = (typeof VIDEO_DEPTH_DEPTH_DIRECTIONS)[number];
export type VideoDepthSourceReference = z.infer<typeof videoDepthSourceReferenceSchema>;
type VideoDepthSettingsInput = z.infer<typeof videoDepthSettingsSchema>;

/** Canonical settings with skeleton always pinned to the fixed v1 style. */
export type VideoDepthSettings = Omit<VideoDepthSettingsInput, "skeleton"> & {
  skeleton: VideoDepthSkeletonStyle;
};

/** Parse + normalize unknown input into valid settings. Unknown keys / out-of-scope values fail (undefined). */
export function parseVideoDepthSettings(input: unknown): VideoDepthSettings | undefined {
  const parsed = videoDepthSettingsSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const { skeleton: _discarded, ...rest } = parsed.data;
  return { ...rest, skeleton: VIDEO_DEPTH_FIXED_SKELETON };
}

/** Source facts known at planning time (from ffprobe or the canvas video node). */
export type VideoDepthSourceFacts = {
  width?: number;
  height?: number;
  durationSeconds?: number;
};

/** Concrete extraction plan derived from settings + source facts (used by main-process job & progress UI). */
export type VideoDepthProcessingPlan = {
  outWidth: number;
  outHeight: number;
  startSeconds: number;
  endSeconds: number; // 0 stays 0 only when source duration is unknown; otherwise resolved
  totalFramesEstimate: number | null;
  resolutionTag: Exclude<VideoDepthResolution, "original"> | "original";
};

/** Longest-edge scaling to an even size (yuv420p needs even dimensions). */
function scaleToLongestEdge(width: number, height: number, limit: number): { w: number; h: number } {
  const longest = Math.max(width, height);
  if (longest <= limit) return { w: even(width), h: even(height) };
  const k = limit / longest;
  return { w: even(Math.round(width * k)), h: even(Math.round(height * k)) };
}

function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

/**
 * Resolve trim window + output size + frame-count estimate.
 * trimEndSeconds === 0 means "end of source"; if source duration is unknown the
 * caller must supply it later (job re-resolves after ffprobe) — plan then
 * reports totalFramesEstimate = null.
 */
export function deriveProcessingPlan(
  settings: VideoDepthSettings,
  source: VideoDepthSourceFacts,
): VideoDepthProcessingPlan {
  const startSeconds = settings.trimStartSeconds;
  let endSeconds = settings.trimEndSeconds;
  if (endSeconds === 0) {
    endSeconds = source.durationSeconds ?? 0;
  }

  const srcW = source.width ?? 1280;
  const srcH = source.height ?? 720;
  let outWidth: number;
  let outHeight: number;
  if (settings.maxResolution === "original") {
    outWidth = even(srcW);
    outHeight = even(srcH);
  } else {
    ({ w: outWidth, h: outHeight } = scaleToLongestEdge(srcW, srcH, settings.maxResolution));
  }

  let totalFramesEstimate: number | null = null;
  if (endSeconds > startSeconds) {
    totalFramesEstimate = Math.round((endSeconds - startSeconds) * settings.processingFps);
  }

  return {
    outWidth,
    outHeight,
    startSeconds,
    endSeconds,
    totalFramesEstimate,
    resolutionTag: settings.maxResolution,
  };
}

/** Convenience: does this mode need the depth model (Depth Anything V2)? */
export function modeNeedsDepth(mode: VideoDepthMode): boolean {
  return mode === "depth" || mode === "depth_skeleton";
}

/** Convenience: does this mode need the pose model (MediaPipe)? */
export function modeNeedsPose(mode: VideoDepthMode): boolean {
  return mode === "depth_skeleton" || mode === "original_skeleton";
}
