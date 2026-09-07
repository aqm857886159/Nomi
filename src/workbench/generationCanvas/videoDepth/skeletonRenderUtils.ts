/**
 * Depth video node — skeleton overlay rendering (pure, DOM-free).
 *
 * Draws MediaPipe Pose 33-landmark skeletons (1..4 people) onto a caller-owned
 * 2D canvas context using normalized landmark coordinates. v1 styling is fixed
 * (lineWidth/jointRadius/confidence come from settings; glow is out of scope).
 * The context is exposed as a minimal structural type so node-env tests can
 * drive it without a real canvas.
 */

/** MediaPipe Pose 33-point topology (official POSE_CONNECTIONS, 35 edges). */
export const POSE_CONNECTIONS_33: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20], [11, 23],
  [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [27, 29],
  [28, 30], [29, 31], [30, 32], [31, 33], [27, 31], [28, 32],
];

/** Fixed v1 skeleton color — bright, visible on both grayscale depth and black backgrounds. */
export const VIDEO_DEPTH_SKELETON_COLOR = "#d9ff8f";

export type VideoDepthPoseLandmark = { x: number; y: number; visibility?: number };
export type VideoDepthPosePerson = ReadonlyArray<VideoDepthPoseLandmark>;

export type VideoDepthSkeletonStyle = {
  lineWidth: number;
  jointRadius: number;
  confidence: number;
};

/** Minimal structural surface of the 2D canvas context this renderer needs (test-friendly). */
export type PoseCanvas2D = {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  stroke(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fill(): void;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
};

export type VideoDepthPoseOverlayOptions = {
  widthPx: number;
  heightPx: number;
  style: VideoDepthSkeletonStyle;
};

function visiblePoint(lm: VideoDepthPoseLandmark, confidence: number): boolean {
  if (!Number.isFinite(lm.x) || !Number.isFinite(lm.y)) return false;
  return (lm.visibility ?? 1) >= confidence;
}

/**
 * Draw one skeleton person.
 * landmark coordinates are normalized 0..1; they are scaled to widthPx/heightPx.
 */
function drawPerson(
  ctx: PoseCanvas2D,
  person: VideoDepthPosePerson,
  opts: VideoDepthPoseOverlayOptions,
): void {
  const { widthPx, heightPx, style } = opts;
  const visible = person.map((lm) => visiblePoint(lm, style.confidence));

  ctx.strokeStyle = VIDEO_DEPTH_SKELETON_COLOR;
  ctx.fillStyle = VIDEO_DEPTH_SKELETON_COLOR;
  ctx.lineWidth = style.lineWidth;

  for (const [a, b] of POSE_CONNECTIONS_33) {
    const pa = person[a];
    const pb = person[b];
    if (!pa || !pb || !visible[a] || !visible[b]) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x * widthPx, pa.y * heightPx);
    ctx.lineTo(pb.x * widthPx, pb.y * heightPx);
    ctx.stroke();
  }

  for (let i = 0; i < person.length; i++) {
    const lm = person[i];
    if (!lm || !visible[i]) continue;
    ctx.beginPath();
    ctx.arc(lm.x * widthPx, lm.y * heightPx, style.jointRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Draw zero or more skeleton people (multi-person supported, v1 maxPeople enforced upstream). */
export function renderPoseOverlay(
  ctx: PoseCanvas2D,
  persons: ReadonlyArray<VideoDepthPosePerson>,
  opts: VideoDepthPoseOverlayOptions,
): void {
  for (const person of persons) {
    if (person.length > 0) drawPerson(ctx, person, opts);
  }
}

/** Convert the fixed v1 skeleton style (from settings) into overlay options. */
export function poseOverlayOptionsFromSettings(
  widthPx: number,
  heightPx: number,
  fixed: { lineWidth: number; jointRadius: number; confidence: number },
): VideoDepthPoseOverlayOptions {
  return { widthPx, heightPx, style: { ...fixed } };
}
