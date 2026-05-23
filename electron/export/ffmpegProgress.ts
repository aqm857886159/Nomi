export type FfmpegProgress = {
  frame?: number;
  fps?: number;
  outTimeMs?: number;
  speed?: number;
  progress?: "continue" | "end" | string;
};

function finiteNumber(value: string): number | undefined {
  if (value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseFfmpegProgressChunk(chunk: string): Partial<FfmpegProgress> {
  const parsed: Partial<FfmpegProgress> = {};

  for (const rawLine of chunk.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1).trim();

    switch (key) {
      case "frame": {
        const frame = finiteNumber(value);
        if (frame !== undefined) parsed.frame = frame;
        break;
      }
      case "fps": {
        const fps = finiteNumber(value);
        if (fps !== undefined) parsed.fps = fps;
        break;
      }
      case "out_time_ms": {
        const outTimeMs = finiteNumber(value);
        if (outTimeMs !== undefined) parsed.outTimeMs = outTimeMs;
        break;
      }
      case "speed": {
        const normalizedSpeed = value.endsWith("x") ? value.slice(0, -1) : value;
        const speed = finiteNumber(normalizedSpeed);
        if (speed !== undefined) parsed.speed = speed;
        break;
      }
      case "progress":
        parsed.progress = value;
        break;
      default:
        break;
    }
  }

  return parsed;
}

export function progressFromOutTime(outTimeMs: number, durationMs: number): number {
  if (!Number.isFinite(outTimeMs) || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, outTimeMs / durationMs));
}
