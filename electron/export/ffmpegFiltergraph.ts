import type { NomiRenderAsset, NomiRenderClip, NomiRenderManifestV1, NomiRenderTrack } from "./exportManifest";

/** 字幕/标题卡叠加：已渲染成全画幅透明 PNG 的临时文件 + 可见区间。 */
export type FfmpegTextOverlayInput = {
  path: string;
  startFrame: number;
  endFrame: number;
};

export type FfmpegFiltergraphInput = {
  manifest: NomiRenderManifestV1;
  textOverlays?: FfmpegTextOverlayInput[];
};

export type FfmpegFiltergraphPlanInput = {
  assetId: string;
  path: string;
  kind: "image" | "video" | "audio";
  inputArgs: string[];
};

export type FfmpegFiltergraphPlan = {
  inputs: FfmpegFiltergraphPlanInput[];
  filterComplex: string;
  videoOutputLabel: string;
  audioOutputLabel?: string;
  warnings: string[];
};

export type FfmpegFiltergraphErrorCode =
  | "missing_asset"
  | "unsupported_audio"
  | "unsupported_clip"
  | "invalid_manifest";

export class FfmpegFiltergraphError extends Error {
  readonly code: FfmpegFiltergraphErrorCode;

  constructor(code: FfmpegFiltergraphErrorCode, message: string) {
    super(message);
    this.name = "FfmpegFiltergraphError";
    this.code = code;
  }
}

type ResolvedClip = {
  track: NomiRenderTrack;
  trackIndex: number;
  clip: NomiRenderClip;
  asset: NomiRenderAsset;
  inputIndex: number;
};

function secondsFromFrames(frames: number, fps: number): number {
  return frames / fps;
}

function formatSeconds(seconds: number): string {
  if (Number.isInteger(seconds)) return String(seconds);
  return Number(seconds.toFixed(6)).toString();
}

function labelForClip(clipId: string, suffix: string): string {
  const safeId = clipId.replace(/[^a-zA-Z0-9_]/g, "_");
  return `clip_${safeId}_${suffix}`;
}

function isAudioTrack(track: NomiRenderTrack): boolean {
  return track.kind === "audio" || track.type === "audio";
}

function isVisualTrack(track: NomiRenderTrack): boolean {
  return track.kind === "visual" || track.kind === "video" || track.type === "visual" || track.type === "video";
}

function collectReferencedClips(manifest: NomiRenderManifestV1): ResolvedClip[] {
  const inputIndexByAssetId = new Map<string, number>();
  const resolved: ResolvedClip[] = [];

  manifest.timeline.tracks.forEach((track, trackIndex) => {
    track.clips.forEach((clip) => {
      if (!clip.assetId) {
        throw new FfmpegFiltergraphError("unsupported_clip", `Clip ${clip.id} has no assetId`);
      }

      const asset = manifest.assets[clip.assetId];
      if (!asset) {
        throw new FfmpegFiltergraphError("missing_asset", `Clip ${clip.id} references missing asset ${clip.assetId}`);
      }

      let inputIndex = inputIndexByAssetId.get(asset.id);
      if (inputIndex === undefined) {
        inputIndex = inputIndexByAssetId.size;
        inputIndexByAssetId.set(asset.id, inputIndex);
      }

      resolved.push({ track, trackIndex, clip, asset, inputIndex });
    });
  });

  return resolved;
}

function buildInputs(resolvedClips: ResolvedClip[], fps: number): FfmpegFiltergraphPlanInput[] {
  const byAsset = new Map<string, ResolvedClip[]>();
  for (const resolvedClip of resolvedClips) {
    byAsset.set(resolvedClip.asset.id, [...(byAsset.get(resolvedClip.asset.id) ?? []), resolvedClip]);
  }

  return [...byAsset.values()].map((clips) => {
    const { asset } = clips[0];
    const maxDurationSeconds = Math.max(...clips.map(({ clip }) => secondsFromFrames(clip.endFrame - clip.startFrame, fps)));

    return {
      assetId: asset.id,
      path: asset.absolutePath,
      kind: asset.kind,
      inputArgs: asset.kind === "image" ? ["-loop", "1", "-t", formatSeconds(maxDurationSeconds)] : [],
    };
  });
}

/**
 * 构建音频滤镜。音频源 = 独立音频轨 clip + 自带音轨的 video clip（asset.hasAudio）。
 * 每个源：按源内区间 atrim → asetpts 归零 → adelay 平移到时间轴位置。
 * 多源用 amix 合并；normalize=0 避免默认按输入数 1/N 衰减（顺序不重叠的 clip 应保持原音量）。
 * 返回滤镜行数组（空 = 无音频，输出无 [aout]）。
 */
function buildAudioGraph(
  resolvedClips: ResolvedClip[],
  profileAudioCodec: NomiRenderManifestV1["profile"]["audioCodec"],
  fps: number,
): string[] {
  if (profileAudioCodec === "none") return [];

  const audioSources = resolvedClips.filter(
    ({ track, asset }) =>
      isAudioTrack(track) || asset.kind === "audio" || (asset.kind === "video" && asset.hasAudio === true),
  );
  if (audioSources.length === 0) return [];

  const filters: string[] = [];
  const sourceLabels: string[] = [];
  audioSources.forEach(({ clip, inputIndex }, index) => {
    const outLabel = audioSources.length === 1 ? "aout" : labelForClip(clip.id, `audio${index}`);
    const startMs = Math.round(secondsFromFrames(clip.startFrame, fps) * 1000);
    const clipDurationFrames = clip.endFrame - clip.startFrame;
    const sourceStart = secondsFromFrames(clip.sourceStartFrame ?? 0, fps);
    const sourceEnd = secondsFromFrames(clip.sourceEndFrame ?? (clip.sourceStartFrame ?? 0) + clipDurationFrames, fps);
    filters.push(
      `[${inputIndex}:a]atrim=start=${formatSeconds(sourceStart)}:end=${formatSeconds(sourceEnd)},` +
        `asetpts=PTS-STARTPTS,adelay=${startMs}|${startMs}[${outLabel}]`,
    );
    sourceLabels.push(`[${outLabel}]`);
  });

  if (sourceLabels.length > 1) {
    filters.push(
      `${sourceLabels.join("")}amix=inputs=${sourceLabels.length}:duration=longest:dropout_transition=0:normalize=0[aout]`,
    );
  }

  return filters;
}

function buildVisualGraph(manifest: NomiRenderManifestV1, visualClips: ResolvedClip[]): string[] {
  const { profile } = manifest;
  const fps = manifest.timeline.fps;
  const durationSeconds = secondsFromFrames(manifest.timeline.durationFrames, fps);
  const filters = [`color=black:size=${profile.width}x${profile.height}:rate=${fps}:duration=${formatSeconds(durationSeconds)}[base]`];

  const orderedVisualClips = [...visualClips].sort((left, right) => {
    return (
      left.trackIndex - right.trackIndex ||
      left.clip.startFrame - right.clip.startFrame ||
      left.clip.id.localeCompare(right.clip.id)
    );
  });

  orderedVisualClips.forEach(({ clip, asset, inputIndex }) => {
    const segmentLabel = labelForClip(clip.id, "segment");
    const fittedLabel = labelForClip(clip.id, "fitted");
    const start = secondsFromFrames(clip.startFrame, fps);
    const duration = secondsFromFrames(clip.endFrame - clip.startFrame, fps);
    const timelineSetpts = `PTS-STARTPTS+${formatSeconds(start)}/TB`;

    if (asset.kind === "image") {
      filters.push(
        `[${inputIndex}:v]trim=duration=${formatSeconds(duration)},setpts=${timelineSetpts}[${segmentLabel}]`,
      );
    } else if (asset.kind === "video") {
      const sourceStart = secondsFromFrames(clip.sourceStartFrame ?? 0, fps);
      const sourceEnd = secondsFromFrames(clip.sourceEndFrame ?? (clip.sourceStartFrame ?? 0) + (clip.endFrame - clip.startFrame), fps);
      filters.push(
        `[${inputIndex}:v]trim=start=${formatSeconds(sourceStart)}:end=${formatSeconds(sourceEnd)},setpts=${timelineSetpts}[${segmentLabel}]`,
      );
    } else {
      throw new FfmpegFiltergraphError("unsupported_clip", `Asset ${asset.id} is not visual`);
    }

    filters.push(
      `[${segmentLabel}]scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,` +
        `pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:color=black,format=${profile.pixelFormat}[${fittedLabel}]`,
    );
  });

  let baseLabel = "base";
  orderedVisualClips.forEach(({ clip }, index) => {
    const fittedLabel = labelForClip(clip.id, "fitted");
    const outputLabel = index === orderedVisualClips.length - 1 ? "vout" : `vstack${index}`;
    const start = secondsFromFrames(clip.startFrame, fps);
    const end = secondsFromFrames(clip.endFrame, fps);
    filters.push(
      `[${baseLabel}][${fittedLabel}]overlay=shortest=0:eof_action=pass:enable='gte(t,${formatSeconds(start)})*lt(t,${formatSeconds(end)})'[${outputLabel}]`,
    );
    baseLabel = outputLabel;
  });

  if (orderedVisualClips.length === 0) {
    filters.push("[base]format=yuv420p[vout]");
  }

  return filters;
}

/**
 * 文字叠加链：每条 overlay PNG 作为新输入（-loop 1 -t 全长），在 [start,end] 区间 overlay 到视频上。
 * PNG 是全画幅透明 → overlay=0:0 对齐。接在视觉链尾（最上层）。返回新增滤镜行 + 输入 + 最终视频 label。
 */
function buildTextOverlayGraph(
  textOverlays: FfmpegTextOverlayInput[],
  assetInputCount: number,
  baseVideoLabel: string,
  fps: number,
  durationSeconds: number,
  pixelFormat: string,
): { filters: string[]; inputs: FfmpegFiltergraphPlanInput[]; videoLabel: string } {
  const filters: string[] = [];
  const inputs: FfmpegFiltergraphPlanInput[] = [];
  let label = baseVideoLabel;
  textOverlays.forEach((overlay, index) => {
    const inputIndex = assetInputCount + index;
    inputs.push({
      assetId: `text_overlay_${index}`,
      path: overlay.path,
      kind: "image",
      inputArgs: ["-loop", "1", "-t", formatSeconds(durationSeconds)],
    });
    const start = secondsFromFrames(overlay.startFrame, fps);
    const end = secondsFromFrames(overlay.endFrame, fps);
    const isLast = index === textOverlays.length - 1;
    const out = isLast ? "voutfinal" : `vtxt${index}`;
    const formatSuffix = isLast ? `,format=${pixelFormat}` : "";
    filters.push(
      `[${label}][${inputIndex}:v]overlay=0:0:eof_action=pass:enable='between(t,${formatSeconds(start)},${formatSeconds(end)})'${formatSuffix}[${out}]`,
    );
    label = out;
  });
  return { filters, inputs, videoLabel: `[${label}]` };
}

export function compileFfmpegFiltergraph(input: FfmpegFiltergraphInput): FfmpegFiltergraphPlan {
  const { manifest } = input;
  const textOverlays = input.textOverlays ?? [];
  const fps = manifest.timeline.fps;
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new FfmpegFiltergraphError("invalid_manifest", `Invalid timeline fps: ${fps}`);
  }

  const resolvedClips = collectReferencedClips(manifest);
  const visualClips = resolvedClips.filter(({ track, asset }) => isVisualTrack(track) || asset.kind === "image" || asset.kind === "video");

  const audioFilters = buildAudioGraph(resolvedClips, manifest.profile.audioCodec, fps);
  const filters = buildVisualGraph(manifest, visualClips);

  const inputs = buildInputs(resolvedClips, fps);
  let videoOutputLabel = "[vout]";
  if (textOverlays.length > 0) {
    const durationSeconds = secondsFromFrames(manifest.timeline.durationFrames, fps);
    const overlayGraph = buildTextOverlayGraph(
      textOverlays,
      inputs.length,
      "vout",
      fps,
      durationSeconds,
      manifest.profile.pixelFormat,
    );
    filters.push(...overlayGraph.filters);
    inputs.push(...overlayGraph.inputs);
    videoOutputLabel = overlayGraph.videoLabel;
  }

  filters.push(...audioFilters);

  return {
    inputs,
    filterComplex: filters.join(";"),
    videoOutputLabel,
    audioOutputLabel: audioFilters.length > 0 ? "[aout]" : undefined,
    warnings: [],
  };
}
