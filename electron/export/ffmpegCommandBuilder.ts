import type { ExportProfile, ExportQuality } from "./exportTypes";
import type { FfmpegFiltergraphPlan } from "./ffmpegFiltergraph";

export type FfmpegTranscodePlan = {
  inputPath: string;
  outputPath: string;
  profile: ExportProfile;
  noAudio: boolean;
  filtergraph?: FfmpegFiltergraphPlan;
  reportProgress?: boolean;
};

const QUALITY_CRF: Record<ExportQuality, string> = {
  small: "28",
  standard: "23",
  high: "18",
};

function assertPositiveFiniteInteger(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0 || Math.floor(value) !== value) {
    throw new Error(`Invalid FFmpeg ${name}: ${value}`);
  }
}

function assertPositiveFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid FFmpeg ${name}: ${value}`);
  }
}

export function buildWebmToMp4Args(plan: FfmpegTranscodePlan): string[] {
  const { inputPath, outputPath, profile } = plan;
  if (!inputPath && plan.filtergraph === undefined) throw new Error("Invalid FFmpeg inputPath");
  if (!outputPath) throw new Error("Invalid FFmpeg outputPath");
  if (profile.container !== "mp4") throw new Error(`Unsupported FFmpeg container: ${profile.container}`);
  if (profile.videoCodec !== "h264") throw new Error(`Unsupported FFmpeg video codec: ${profile.videoCodec}`);
  if (profile.pixelFormat !== "yuv420p") throw new Error(`Unsupported FFmpeg pixel format: ${profile.pixelFormat}`);
  assertPositiveFiniteInteger(profile.width, "width");
  assertPositiveFiniteInteger(profile.height, "height");
  assertPositiveFiniteNumber(profile.fps, "fps");

  const vf = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:color=black,format=${profile.pixelFormat}`;
  const args = ["-y"];

  if (plan.reportProgress === true) {
    args.push("-progress", "pipe:2", "-nostats");
  }

  if (plan.filtergraph !== undefined) {
    for (const input of plan.filtergraph.inputs) {
      args.push(...input.inputArgs, "-i", input.path);
    }

    args.push("-filter_complex", plan.filtergraph.filterComplex, "-map", plan.filtergraph.videoOutputLabel);
    if (plan.filtergraph.audioOutputLabel !== undefined && profile.audioCodec !== "none" && !plan.noAudio) {
      args.push("-map", plan.filtergraph.audioOutputLabel);
    } else {
      args.push("-an");
    }

    args.push(
      "-r", String(profile.fps),
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", QUALITY_CRF[profile.quality],
      "-movflags", "+faststart",
      outputPath,
    );

    return args;
  }

  args.push("-i", inputPath);

  if (profile.audioCodec === "none" || plan.noAudio) {
    args.push("-an");
  }

  args.push(
    "-vf", vf,
    "-r", String(profile.fps),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", QUALITY_CRF[profile.quality],
    "-movflags", "+faststart",
    outputPath,
  );

  return args;
}
