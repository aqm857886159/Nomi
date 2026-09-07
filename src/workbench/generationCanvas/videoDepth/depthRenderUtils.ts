/**
 * Depth video node — depth post-processing utils (pure, no DOM/Electron).
 *
 * Depth Anything V2 outputs a Float32 per-pixel relative depth where a LARGER
 * value means CLOSER. All rendering decisions for the depth channel live here
 * so the worker and its tests stay deterministic:
 *  - grayscale mapping (near-white / near-black),
 *  - exponential moving-average temporal smoothing (single-frame buffer,
 *    depth.cards-style; larger alpha = smoother / slower to update).
 */

export type VideoDepthDepthDirection = "nearWhite" | "nearBlack";

/** Map raw depth to 0..255 grayscale. Flat input maps to 0 (nearWhite) / 255 (nearBlack). */
export function depthToGray(depth: Float32Array, direction: VideoDepthDepthDirection): Uint8Array {
  const n = depth.length;
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = depth[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const range = mx - mn;
  const out = new Uint8Array(n);
  if (range <= 0) {
    if (direction === "nearWhite") return out;
    out.fill(255);
    return out;
  }
  if (direction === "nearWhite") {
    for (let i = 0; i < n; i++) out[i] = Math.round(((depth[i] - mn) / range) * 255);
  } else {
    for (let i = 0; i < n; i++) out[i] = Math.round(255 - ((depth[i] - mn) / range) * 255);
  }
  return out;
}

/**
 * Single-frame EMA smoother for per-pixel depth.
 *
 * out = alpha * prev + (1 - alpha) * frame, first frame passes through.
 * alpha 0 => no smoothing (frame passthrough); alpha 1 => frozen at first frame.
 * Each push returns a fresh Float32Array; the caller owns it.
 */
export class DepthTemporalSmoother {
  private readonly alpha: number;
  private prev: Float32Array | null = null;

  constructor(alpha: number) {
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new RangeError(`DepthTemporalSmoother alpha must be within [0,1], got ${alpha}`);
    }
    this.alpha = alpha;
  }

  push(frame: Float32Array): Float32Array {
    if (this.prev === null || this.alpha === 0 || this.prev.length !== frame.length) {
      this.prev = new Float32Array(frame);
      return new Float32Array(this.prev);
    }
    const out = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      out[i] = this.alpha * this.prev[i] + (1 - this.alpha) * frame[i];
    }
    this.prev = out;
    return new Float32Array(out);
  }

  reset(): void {
    this.prev = null;
  }
}

/** Build a smoother from the settings-level temporalSmoothing value. */
export function createDepthSmoother(temporalSmoothing: number): DepthTemporalSmoother {
  return new DepthTemporalSmoother(temporalSmoothing);
}
