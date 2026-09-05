import type { NomiRenderAsset, NomiRenderClip, NomiRenderManifestV1, NomiRenderTrack, NomiRenderTransition } from "./exportManifest";

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

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return Number(value.toFixed(6)).toString();
}

function clipAudioProcessingFilters(clip: NomiRenderClip, fps: number): string {
  const audio = clip.audio;
  if (!audio) return "";

  const filters: string[] = [];
  if (audio.muted) {
    filters.push("volume=0");
  } else if (audio.gainDb !== 0) {
    filters.push(`volume=${formatNumber(10 ** (audio.gainDb / 20))}`);
  }
  if (audio.fadeInFrames > 0) {
    filters.push(`afade=t=in:st=0:d=${formatSeconds(secondsFromFrames(audio.fadeInFrames, fps))}`);
  }
  if (audio.fadeOutFrames > 0) {
    const fadeStartFrames = clip.endFrame - clip.startFrame - audio.fadeOutFrames;
    filters.push(
      `afade=t=out:st=${formatSeconds(secondsFromFrames(fadeStartFrames, fps))}:` +
        `d=${formatSeconds(secondsFromFrames(audio.fadeOutFrames, fps))}`,
    );
  }
  return filters.length > 0 ? `,${filters.join(",")}` : "";
}

// ── 取景（fit / 缩放 / 平移）──────────────────────────────────────────────
// 与预览 CSS / WebM canvas computeFramedRect 同一套公式，用 ffmpeg 运行期表达式实现
// （iw/ih=源尺寸，main_w/overlay_w=帧/已缩放媒体）。offsetX/Y 为帧尺寸的归一化分数。
type ClipFraming = {
  fit: "contain" | "cover";
  scale: number;
  offsetX: number;
  offsetY: number;
};

const DEFAULT_FRAMING: ClipFraming = { fit: "contain", scale: 1, offsetX: 0, offsetY: 0 };

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 从 clip.transform 读出取景（缺省补默认、清洗、缩放 clamp[0.25,4]，与 src 端 resolveClipFraming 同语义）。 */
function resolveClipFraming(transform: NomiRenderClip["transform"]): ClipFraming {
  if (!transform || typeof transform !== "object") return { ...DEFAULT_FRAMING };
  const raw = transform as Record<string, unknown>;
  const scale = finiteOr(raw.scale, DEFAULT_FRAMING.scale);
  return {
    fit: raw.fit === "cover" ? "cover" : "contain",
    scale: Math.max(0.25, Math.min(4, scale)),
    offsetX: finiteOr(raw.offsetX, DEFAULT_FRAMING.offsetX),
    offsetY: finiteOr(raw.offsetY, DEFAULT_FRAMING.offsetY),
  };
}

/**
 * 取景 → scale + overlay 表达式。
 * factor = (contain? min : max)(W/iw, H/ih) × scale；缩放后居中再加 offset(×帧尺寸)。
 * 表达式带单引号（ffmpeg 滤镜解析器识别），逗号转义 `\,`（已用真 ffmpeg 验证语法+几何）。
 */
function framingFilters(
  framing: ClipFraming,
  width: number,
  height: number,
  segmentLabel: string,
  fittedLabel: string,
): string {
  const fitFn = framing.fit === "cover" ? "max" : "min";
  const factor = `${fitFn}(${width}/iw\\,${height}/ih)*${formatNumber(framing.scale)}`;
  return `[${segmentLabel}]scale=w='${factor}*iw':h='${factor}*ih'[${fittedLabel}]`;
}

function framingOverlayPosition(framing: ClipFraming): { x: string; y: string } {
  return {
    x: `(main_w-overlay_w)/2+(${formatNumber(framing.offsetX)})*main_w`,
    y: `(main_h-overlay_h)/2+(${formatNumber(framing.offsetY)})*main_h`,
  };
}

function labelForClip(clipId: string, suffix: string): string {
  const safeId = clipId.replace(/[^a-zA-Z0-9_]/g, "_");
  return `clip_${safeId}_${suffix}`;
}

function sourceLabelForClip(clip: Pick<ResolvedClip, "clip">, stream: "video" | "audio"): string {
  return labelForClip(clip.clip.id, `${stream}_source`);
}

type VisualTransitionGroup = {
  trackIndex: number;
  clips: ResolvedClip[];
  transitions: NomiRenderTransition[];
};

type VisualUnit = {
  id: string;
  trackIndex: number;
  startFrame: number;
  endFrame: number;
  clip?: ResolvedClip;
  transitionGroup?: VisualTransitionGroup;
};

const DEFAULT_TRANSITION_FRAMES = 15;

/**
 * The pixel format both transition inputs are forced into before `blend`.
 *
 * `blend`'s expression runs **per plane of whatever format arrives**, and the
 * fade expression below encodes "0 means black". That is only true in RGB. Left
 * in YUV, `A*(1-2p)` drives U and V toward 0 instead of the 128 neutral, so a
 * "淡入淡出" rendered a bright green flash at the seam instead of dipping to
 * black (caught in the 2026-09-06 real-user export walk: the frame at the seam
 * probed rgb(0,138,0)). Declaring the format is what makes the one expression
 * below well-defined; do not drop it.
 */
const TRANSITION_BLEND_FORMAT = "gbrp";

function transitionBlendExpression(type: NomiRenderTransition["type"], offset: number, duration: number): string {
  // FFmpeg 4.x (the bundled Windows binary) has no xfade filter. `blend` is
  // available there and keeps the same frame-accurate behavior. Escape the
  // expression commas because they are filtergraph separators.
  const progress = `max(0\\,min(1\\,(T-${formatSeconds(offset)})/${formatSeconds(duration)}))`;
  if (type === "fade") {
    return `if(lt(${progress}\\,0.5)\\,A*(1-2*${progress})\\,B*(2*${progress}-1))`;
  }
  return `A*(1-${progress})+B*${progress}`;
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

/**
 * Resolve authored transitions into linear same-track groups. The persisted
 * timeline keeps clips contiguous and stores transitions as metadata, so the
 * exporter must reject ambiguous pairs instead of guessing across tracks.
 */
function collectVisualTransitionGroups(
  transitions: NomiRenderTransition[] | undefined,
  visualClips: ResolvedClip[],
  fps: number,
): { groups: VisualTransitionGroup[]; warnings: string[] } {
  if (!transitions || transitions.length === 0) return { groups: [], warnings: [] };

  const byClipId = new Map(visualClips.map((entry) => [entry.clip.id, entry]));
  const outgoing = new Map<string, { transition: NomiRenderTransition; to: ResolvedClip; durationFrames: number }>();
  const incoming = new Set<string>();
  const warnings: string[] = [];

  for (const transition of transitions) {
    if (transition.type === "cut") continue;
    const from = byClipId.get(transition.fromClipId);
    const to = byClipId.get(transition.toClipId);
    if (!from || !to) {
      warnings.push(`Transition ${transition.fromClipId}->${transition.toClipId} was ignored because both endpoints must be visual clips.`);
      continue;
    }
    if (from.trackIndex !== to.trackIndex) {
      warnings.push(`Transition ${transition.fromClipId}->${transition.toClipId} was ignored because transitions must stay on one visual track.`);
      continue;
    }
    if (from.clip.endFrame !== to.clip.startFrame) {
      warnings.push(`Transition ${transition.fromClipId}->${transition.toClipId} was ignored because clips must be contiguous.`);
      continue;
    }
    const minimumDuration = Math.min(
      from.clip.endFrame - from.clip.startFrame,
      to.clip.endFrame - to.clip.startFrame,
    );
    const durationFrames = transition.durationFrames ?? Math.min(DEFAULT_TRANSITION_FRAMES, Math.floor(minimumDuration / 2));
    if (!Number.isInteger(durationFrames) || durationFrames < 1 || durationFrames >= minimumDuration) {
      warnings.push(`Transition ${transition.fromClipId}->${transition.toClipId} was ignored because its duration must be shorter than both clips.`);
      continue;
    }
    if (outgoing.has(from.clip.id) || incoming.has(to.clip.id)) {
      warnings.push(`Transition ${transition.fromClipId}->${transition.toClipId} was ignored because a clip can only have one adjacent transition.`);
      continue;
    }
    if (transition.type !== "dissolve" && transition.type !== "fade") {
      warnings.push(`Transition ${transition.fromClipId}->${transition.toClipId} (${transition.type}) is not supported by the FFmpeg backend and remains a hard cut.`);
      continue;
    }
    outgoing.set(from.clip.id, { transition, to, durationFrames });
    incoming.add(to.clip.id);
  }

  const groups: VisualTransitionGroup[] = [];
  const consumed = new Set<string>();
  const ordered = [...visualClips].sort((left, right) =>
    left.trackIndex - right.trackIndex || left.clip.startFrame - right.clip.startFrame || left.clip.id.localeCompare(right.clip.id),
  );
  for (const first of ordered) {
    if (consumed.has(first.clip.id) || incoming.has(first.clip.id)) continue;
    const firstEdge = outgoing.get(first.clip.id);
    if (!firstEdge) continue;

    const clips = [first];
    const groupTransitions: NomiRenderTransition[] = [];
    let current = first;
    while (true) {
      const edge = outgoing.get(current.clip.id);
      if (!edge || consumed.has(edge.to.clip.id)) break;
      clips.push(edge.to);
      groupTransitions.push({ ...edge.transition, durationFrames: edge.durationFrames });
      consumed.add(current.clip.id);
      current = edge.to;
    }
    consumed.add(current.clip.id);
    if (clips.length > 1) {
      groups.push({ trackIndex: first.trackIndex, clips, transitions: groupTransitions });
    }
  }

  // Keep this argument in the helper signature so its frame/time conversion is
  // explicit at the call site; transition durations are frame-native today.
  void fps;
  return { groups, warnings };
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
 * 多源先补齐到时间轴全长，再用旧版 FFmpeg 兼容的 amix + volume 恢复未归一化音量。
 * 返回滤镜行数组（空 = 无音频，输出无 [aout]）。
 */
function buildAudioGraph(
  resolvedClips: ResolvedClip[],
  profileAudioCodec: NomiRenderManifestV1["profile"]["audioCodec"],
  fps: number,
  timelineDurationSeconds: number,
): string[] {
  if (profileAudioCodec === "none") return [];

  const audioSources = resolvedClips.filter(
    ({ track, asset }) =>
      isAudioTrack(track) || asset.kind === "audio" || (asset.kind === "video" && asset.hasAudio === true),
  );
  if (audioSources.length === 0) return [];

  const filters: string[] = [];
  const sourceUseCount = new Map<number, number>();
  audioSources.forEach(({ inputIndex }) => {
    sourceUseCount.set(inputIndex, (sourceUseCount.get(inputIndex) ?? 0) + 1);
  });
  const sourceUseIndex = new Map<number, number>();
  audioSources.forEach((source) => {
    const count = sourceUseCount.get(source.inputIndex) ?? 1;
    if (count <= 1) return;
    const index = sourceUseIndex.get(source.inputIndex) ?? 0;
    if (index === 0) {
      const labels = audioSources
        .filter(({ inputIndex }) => inputIndex === source.inputIndex)
        .map((candidate) => `[${sourceLabelForClip(candidate, "audio")}]`)
        .join("");
      filters.push(`[${source.inputIndex}:a]asplit=${count}${labels}`);
    }
    sourceUseIndex.set(source.inputIndex, index + 1);
  });
  const sourceLabels: string[] = [];
  audioSources.forEach(({ clip, inputIndex }, index) => {
    const outLabel = audioSources.length === 1 ? "aout" : labelForClip(clip.id, `audio${index}`);
    const sourceCount = sourceUseCount.get(inputIndex) ?? 1;
    const sourceLabel = sourceCount > 1
      ? `[${sourceLabelForClip({ clip }, "audio")}]`
      : `[${inputIndex}:a]`;
    const startMs = Math.round(secondsFromFrames(clip.startFrame, fps) * 1000);
    const clipDurationFrames = clip.endFrame - clip.startFrame;
    const sourceStart = secondsFromFrames(clip.sourceStartFrame ?? 0, fps);
    const sourceEnd = secondsFromFrames(clip.sourceEndFrame ?? (clip.sourceStartFrame ?? 0) + clipDurationFrames, fps);
    const clipAudioFilters = clipAudioProcessingFilters(clip, fps);
    const equalizeDuration = audioSources.length > 1
      ? `,apad,atrim=end=${formatSeconds(timelineDurationSeconds)}`
      : "";
    filters.push(
      `${sourceLabel}atrim=start=${formatSeconds(sourceStart)}:end=${formatSeconds(sourceEnd)},` +
        `asetpts=PTS-STARTPTS${clipAudioFilters},adelay=${startMs}|${startMs}${equalizeDuration}[${outLabel}]`,
    );
    sourceLabels.push(`[${outLabel}]`);
  });

  if (sourceLabels.length > 1) {
    filters.push(
      `${sourceLabels.join("")}amix=inputs=${sourceLabels.length}:duration=longest:dropout_transition=0,` +
        `volume=${sourceLabels.length}[aout]`,
    );
  }

  return filters;
}

// 视觉链：白底 base + 逐 clip 按取景 scale → 居中/偏移 overlay（所见即所得）。
// 输出未定型的视觉 label（[vcomposite] 或 [base]），format=pixelFormat 由 compile 收口到链尾一次
// （避免中间媒体奇数尺寸触发 yuv420p 报错）。返回 { filters, videoLabel }。
function buildBasicVisualGraph(manifest: NomiRenderManifestV1, visualClips: ResolvedClip[]): { filters: string[]; videoLabel: string } {
  const { profile } = manifest;
  const fps = manifest.timeline.fps;
  const durationSeconds = secondsFromFrames(manifest.timeline.durationFrames, fps);
  // 白底 = 与预览舞台一致（--nomi-paper 纯白）；contain 留白边、cover 铺满，三引擎统一。
  const filters = [`color=white:size=${profile.width}x${profile.height}:rate=${fps}:duration=${formatSeconds(durationSeconds)}[base]`];

  const orderedVisualClips = [...visualClips].sort((left, right) => {
    return (
      left.trackIndex - right.trackIndex ||
      left.clip.startFrame - right.clip.startFrame ||
      left.clip.id.localeCompare(right.clip.id)
    );
  });

  // A single FFmpeg input pad cannot safely feed multiple filter branches on
  // older Linux builds. Split repeated visual sources explicitly so a clip
  // reused later in the timeline cannot stall the export graph.
  const visualSourceGroups = new Map<number, ResolvedClip[]>();
  orderedVisualClips.forEach((resolvedClip) => {
    const group = visualSourceGroups.get(resolvedClip.inputIndex) ?? [];
    group.push(resolvedClip);
    visualSourceGroups.set(resolvedClip.inputIndex, group);
  });
  visualSourceGroups.forEach((group, inputIndex) => {
    if (group.length <= 1) return;
    const labels = group.map((resolvedClip) => `[${sourceLabelForClip(resolvedClip, "video")}]`).join("");
    filters.push(`[${inputIndex}:v]split=${group.length}${labels}`);
  });

  orderedVisualClips.forEach(({ clip, asset, inputIndex }) => {
    const segmentLabel = labelForClip(clip.id, "segment");
    const fittedLabel = labelForClip(clip.id, "fitted");
    const sourceCount = visualSourceGroups.get(inputIndex)?.length ?? 1;
    const sourceLabel = sourceCount > 1
      ? `[${sourceLabelForClip({ clip }, "video")}]`
      : `[${inputIndex}:v]`;
    const start = secondsFromFrames(clip.startFrame, fps);
    const duration = secondsFromFrames(clip.endFrame - clip.startFrame, fps);
    const timelineSetpts = `PTS-STARTPTS+${formatSeconds(start)}/TB`;

    if (asset.kind === "image") {
      filters.push(
        `${sourceLabel}trim=duration=${formatSeconds(duration)},setpts=${timelineSetpts}[${segmentLabel}]`,
      );
    } else if (asset.kind === "video") {
      const sourceStart = secondsFromFrames(clip.sourceStartFrame ?? 0, fps);
      const sourceEnd = secondsFromFrames(clip.sourceEndFrame ?? (clip.sourceStartFrame ?? 0) + (clip.endFrame - clip.startFrame), fps);
      filters.push(
        `${sourceLabel}trim=start=${formatSeconds(sourceStart)}:end=${formatSeconds(sourceEnd)},setpts=${timelineSetpts}[${segmentLabel}]`,
      );
    } else {
      throw new FfmpegFiltergraphError("unsupported_clip", `Asset ${asset.id} is not visual`);
    }

    // 取景：按 contain/cover×scale 缩放（不补边），位置由下方 overlay 居中+偏移决定。
    const framing = resolveClipFraming(clip.transform);
    filters.push(framingFilters(framing, profile.width, profile.height, segmentLabel, fittedLabel));
  });

  let baseLabel = "base";
  orderedVisualClips.forEach(({ clip }, index) => {
    const fittedLabel = labelForClip(clip.id, "fitted");
    const outputLabel = index === orderedVisualClips.length - 1 ? "vcomposite" : `vstack${index}`;
    const start = secondsFromFrames(clip.startFrame, fps);
    const end = secondsFromFrames(clip.endFrame, fps);
    const { x, y } = framingOverlayPosition(resolveClipFraming(clip.transform));
    filters.push(
      `[${baseLabel}][${fittedLabel}]overlay=x='${x}':y='${y}':shortest=0:eof_action=pass:enable='gte(t,${formatSeconds(start)})*lt(t,${formatSeconds(end)})'[${outputLabel}]`,
    );
    baseLabel = outputLabel;
  });

  return { filters, videoLabel: orderedVisualClips.length === 0 ? "base" : "vcomposite" };
}

function sourceTrimFilter(
  resolved: ResolvedClip,
  sourceLabel: string,
  segmentLabel: string,
  fps: number,
): string {
  const duration = secondsFromFrames(resolved.clip.endFrame - resolved.clip.startFrame, fps);
  if (resolved.asset.kind === "image") {
    return `${sourceLabel}trim=duration=${formatSeconds(duration)},setpts=PTS-STARTPTS[${segmentLabel}]`;
  }
  if (resolved.asset.kind === "video") {
    const sourceStart = secondsFromFrames(resolved.clip.sourceStartFrame ?? 0, fps);
    const sourceEnd = secondsFromFrames(
      resolved.clip.sourceEndFrame ?? (resolved.clip.sourceStartFrame ?? 0) + (resolved.clip.endFrame - resolved.clip.startFrame),
      fps,
    );
    return `${sourceLabel}trim=start=${formatSeconds(sourceStart)}:end=${formatSeconds(sourceEnd)},setpts=PTS-STARTPTS[${segmentLabel}]`;
  }
  throw new FfmpegFiltergraphError("unsupported_clip", `Asset ${resolved.asset.id} is not visual`);
}

function buildTransitionClipFrame(
  resolved: ResolvedClip,
  sourceLabel: string,
  filters: string[],
  profile: NomiRenderManifestV1["profile"],
  fps: number,
  index: number,
): string {
  const clipKey = `${resolved.clip.id}_transition_${index}`;
  const segmentLabel = labelForClip(clipKey, "segment");
  const fittedLabel = labelForClip(clipKey, "fitted");
  const backgroundLabel = labelForClip(clipKey, "background");
  const fullLabel = labelForClip(clipKey, "full");
  const duration = secondsFromFrames(resolved.clip.endFrame - resolved.clip.startFrame, fps);

  filters.push(sourceTrimFilter(resolved, sourceLabel, segmentLabel, fps));
  filters.push(framingFilters(resolveClipFraming(resolved.clip.transform), profile.width, profile.height, segmentLabel, fittedLabel));
  filters.push(`color=white:size=${profile.width}x${profile.height}:rate=${fps}:duration=${formatSeconds(duration)}[${backgroundLabel}]`);
  const { x, y } = framingOverlayPosition(resolveClipFraming(resolved.clip.transform));
  filters.push(
    `[${backgroundLabel}][${fittedLabel}]overlay=x='${x}':y='${y}':shortest=1:eof_action=pass,format=${profile.pixelFormat},fps=${fps},settb=AVTB[${fullLabel}]`,
  );
  return fullLabel;
}

function buildTransitionVisualGraph(
  manifest: NomiRenderManifestV1,
  visualClips: ResolvedClip[],
  transitionGroups: VisualTransitionGroup[],
): { filters: string[]; videoLabel: string } {
  const { profile } = manifest;
  const fps = manifest.timeline.fps;
  const durationSeconds = secondsFromFrames(manifest.timeline.durationFrames, fps);
  const filters = [`color=white:size=${profile.width}x${profile.height}:rate=${fps}:duration=${formatSeconds(durationSeconds)}[base]`];
  const groupByClipId = new Map<string, VisualTransitionGroup>();
  transitionGroups.forEach((group) => group.clips.forEach((clip) => groupByClipId.set(clip.clip.id, group)));

  const units: VisualUnit[] = [];
  const seenGroups = new Set<VisualTransitionGroup>();
  for (const resolved of visualClips) {
    const group = groupByClipId.get(resolved.clip.id);
    if (group) {
      if (seenGroups.has(group)) continue;
      seenGroups.add(group);
      units.push({
        id: `transition_${group.clips[0].clip.id}`,
        trackIndex: group.trackIndex,
        startFrame: group.clips[0].clip.startFrame,
        endFrame: group.clips[group.clips.length - 1].clip.endFrame,
        transitionGroup: group,
      });
    } else {
      units.push({
        id: resolved.clip.id,
        trackIndex: resolved.trackIndex,
        startFrame: resolved.clip.startFrame,
        endFrame: resolved.clip.endFrame,
        clip: resolved,
      });
    }
  }
  units.sort((left, right) => left.trackIndex - right.trackIndex || left.startFrame - right.startFrame || left.id.localeCompare(right.id));

  const sourceClips = units.flatMap((unit) => unit.transitionGroup?.clips ?? (unit.clip ? [unit.clip] : []));
  const visualSourceGroups = new Map<number, ResolvedClip[]>();
  sourceClips.forEach((resolved) => {
    const group = visualSourceGroups.get(resolved.inputIndex) ?? [];
    group.push(resolved);
    visualSourceGroups.set(resolved.inputIndex, group);
  });
  visualSourceGroups.forEach((group, inputIndex) => {
    if (group.length <= 1) return;
    const labels = group.map((resolved) => `[${sourceLabelForClip(resolved, "video")}]`).join("");
    filters.push(`[${inputIndex}:v]split=${group.length}${labels}`);
  });

  const sourceLabelForVisual = (resolved: ResolvedClip): string => {
    const repeated = visualSourceGroups.get(resolved.inputIndex)?.length ?? 1;
    return repeated > 1 ? `[${sourceLabelForClip(resolved, "video")}]` : `[${resolved.inputIndex}:v]`;
  };

  const unitVideoLabels = new Map<string, string>();
  const unitFramings = new Map<string, ClipFraming>();
  for (const unit of units) {
    if (unit.transitionGroup) {
      const group = unit.transitionGroup;
      let previousLabel = buildTransitionClipFrame(group.clips[0], sourceLabelForVisual(group.clips[0]), filters, profile, fps, 0);
      let cumulativeSeconds = secondsFromFrames(group.clips[0].clip.endFrame - group.clips[0].clip.startFrame, fps);
      for (let index = 1; index < group.clips.length; index += 1) {
        const current = group.clips[index];
        const currentLabel = buildTransitionClipFrame(current, sourceLabelForVisual(current), filters, profile, fps, index);
        const transition = group.transitions[index - 1];
        const transitionDuration = secondsFromFrames(transition.durationFrames ?? DEFAULT_TRANSITION_FRAMES, fps);
        const currentDuration = secondsFromFrames(current.clip.endFrame - current.clip.startFrame, fps);
        const paddedPrevious = labelForClip(`${group.clips[index - 1].clip.id}_transition_padded`, "video");
        const paddedCurrent = labelForClip(`${current.clip.id}_transition_padded`, "video");
        filters.push(`[${previousLabel}]tpad=stop_mode=clone:stop_duration=${formatSeconds(currentDuration)},format=${TRANSITION_BLEND_FORMAT}[${paddedPrevious}]`);
        filters.push(`[${currentLabel}]tpad=start_mode=clone:start_duration=${formatSeconds(cumulativeSeconds)},format=${TRANSITION_BLEND_FORMAT}[${paddedCurrent}]`);
        const outputLabel = labelForClip(`${group.clips[0].clip.id}_transition_blend`, String(index));
        filters.push(
          `[${paddedPrevious}][${paddedCurrent}]blend=all_expr='${transitionBlendExpression(transition.type, cumulativeSeconds, transitionDuration)}':eof_action=repeat:shortest=0[${outputLabel}]`,
        );
        previousLabel = outputLabel;
        cumulativeSeconds += secondsFromFrames(current.clip.endFrame - current.clip.startFrame, fps);
      }
      const timelineLabel = labelForClip(unit.id, "timeline");
      const start = secondsFromFrames(unit.startFrame, fps);
      filters.push(`[${previousLabel}]setpts=PTS-STARTPTS+${formatSeconds(start)}/TB[${timelineLabel}]`);
      unitVideoLabels.set(unit.id, timelineLabel);
      continue;
    }

    if (!unit.clip) continue;
    const resolved = unit.clip;
    const segmentLabel = labelForClip(resolved.clip.id, "segment");
    const fittedLabel = labelForClip(resolved.clip.id, "fitted");
    const start = secondsFromFrames(resolved.clip.startFrame, fps);
    const duration = secondsFromFrames(resolved.clip.endFrame - resolved.clip.startFrame, fps);
    filters.push(sourceTrimFilter(resolved, sourceLabelForVisual(resolved), segmentLabel, fps).replace("setpts=PTS-STARTPTS", `setpts=PTS-STARTPTS+${formatSeconds(start)}/TB`));
    filters.push(framingFilters(resolveClipFraming(resolved.clip.transform), profile.width, profile.height, segmentLabel, fittedLabel));
    unitVideoLabels.set(unit.id, fittedLabel);
    unitFramings.set(unit.id, resolveClipFraming(resolved.clip.transform));
    void duration;
  }

  let baseLabel = "base";
  units.forEach((unit, index) => {
    const outputLabel = index === units.length - 1 ? "vcomposite" : `vstack${index}`;
    const visualLabel = unitVideoLabels.get(unit.id);
    if (!visualLabel) return;
    if (unit.transitionGroup) {
      filters.push(
        `[${baseLabel}][${visualLabel}]overlay=0:0:shortest=0:eof_action=pass:enable='gte(t,${formatSeconds(secondsFromFrames(unit.startFrame, fps))})*lt(t,${formatSeconds(secondsFromFrames(unit.endFrame, fps))})'[${outputLabel}]`,
      );
    } else {
      const framing = unitFramings.get(unit.id) ?? resolveClipFraming(unit.clip?.clip.transform);
      const { x, y } = framingOverlayPosition(framing);
      filters.push(
        `[${baseLabel}][${visualLabel}]overlay=x='${x}':y='${y}':shortest=0:eof_action=pass:enable='gte(t,${formatSeconds(secondsFromFrames(unit.startFrame, fps))})*lt(t,${formatSeconds(secondsFromFrames(unit.endFrame, fps))})'[${outputLabel}]`,
      );
    }
    baseLabel = outputLabel;
  });
  return { filters, videoLabel: units.length === 0 ? "base" : "vcomposite" };
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
  const durationSeconds = secondsFromFrames(manifest.timeline.durationFrames, fps);

  const audioFilters = buildAudioGraph(resolvedClips, manifest.profile.audioCodec, fps, durationSeconds);
  const transitionResolution = collectVisualTransitionGroups(manifest.timeline.transitions, visualClips, fps);
  const visual = transitionResolution.groups.length > 0
    ? buildTransitionVisualGraph(manifest, visualClips, transitionResolution.groups)
    : buildBasicVisualGraph(manifest, visualClips);
  const filters = visual.filters;

  const inputs = buildInputs(resolvedClips, fps);
  let videoOutputLabel = "[vout]";
  if (textOverlays.length > 0) {
    // 文字层接在视觉链尾（最上层），末条 overlay 收口 format=pixelFormat → [voutfinal]。
    const overlayGraph = buildTextOverlayGraph(
      textOverlays,
      inputs.length,
      visual.videoLabel,
      fps,
      durationSeconds,
      manifest.profile.pixelFormat,
    );
    filters.push(...overlayGraph.filters);
    inputs.push(...overlayGraph.inputs);
    videoOutputLabel = overlayGraph.videoLabel;
  } else {
    // 无文字：在视觉链尾统一定型一次（中间媒体可能奇数尺寸，不能逐 clip 转 yuv420p）。
    filters.push(`[${visual.videoLabel}]format=${manifest.profile.pixelFormat}[vout]`);
  }

  filters.push(...audioFilters);

  return {
    inputs,
    filterComplex: filters.join(";"),
    videoOutputLabel,
    audioOutputLabel: audioFilters.length > 0 ? "[aout]" : undefined,
    warnings: transitionResolution.warnings,
  };
}
