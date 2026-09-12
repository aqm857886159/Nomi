// `asset.read` / `export.read` / `export.write` 的动词声明。素材五个读两个 profile 共用（对外
// `nomi_media_query` 从同一份声明派生）；导出四个今天只投内部面（对外走手写 `nomi_export_job` 适配器）。
import {
  ASSET_READ_ALIASES,
  assetReadPiInputSchemaForAlias,
} from "../assetRead";
import {
  EXPORT_READ_ALIASES,
  EXPORT_WRITE_ALIASES,
  exportReadPiInputSchemaForAlias,
  exportWritePiInputSchemaForAlias,
} from "../exportCapabilities";
import { modelArgumentTolerance } from "../modelArgumentTolerance";
import type { VerbDeclaration, VerbDescription } from "../verbDeclaration";

const ASSET_GUIDELINES = Object.freeze([
  "Media is addressed by stable asset id, never by a file path: the id is what search_media returns and what every other media tool takes.",
  "These tools report bounded technical facts (duration, codec, frame ranges, waveform buckets). They never claim to have watched or listened to the media.",
]);

const EXPORT_GUIDELINES = Object.freeze([
  "Exports run against one exact timeline revision: read the timeline first and pass its revision; follow the returned jobId with inspect_export_job.",
]);

const ASSET_ID_PARAM = "assetId is the stable asset id from search_media results or a canvas or timeline read — not a filename and not a path.";

const ASSET_DESCRIBE: Readonly<Record<string, VerbDescription>> = {
  [ASSET_READ_ALIASES.get]: {
    does: "Read one media asset's stored project record by its stable asset id.",
    useWhen: "Use it when you already have an asset id and need its id, kind, display name, duration and the project-relative reference the canvas and timeline use.",
    notWhen: "Do not use it to look an asset up by name (search_media) or for container-level technical facts such as codec, resolution or sample rate (inspect_media) — this tool does not return them.",
    params: `${ASSET_ID_PARAM} Returns the stored record only; no file path, no URL and no media bytes ever cross this boundary.`,
  },
  [ASSET_READ_ALIASES.inspect]: {
    does: "Read one media asset's container facts: codec, resolution, frame rate, sample rate, channels, bit depth.",
    useWhen: "Use it when a timeline or generation decision depends on what the file declares about itself.",
    notWhen: "Do not use it for the project record (display name, canvas reference) — that is get_media — and never to describe what is visible or audible; it does not decode frames.",
    params: `${ASSET_ID_PARAM} Use search_media first when you only have a name.`,
  },
  [ASSET_READ_ALIASES.search]: {
    does: "Search the project's media library and return bounded, path-free asset records.",
    useWhen: "Use it when the user asks whether a kind of footage exists, or when you need an asset id for a reference or a timeline edit.",
    notWhen: "Do not page blindly — narrow with query and kinds instead. Do not use it to read one known asset (get_media) or its technical facts (inspect_media).",
    params: "query is free text; kinds narrows to image, video or audio; limit is enforced server-side with a default and a maximum.",
  },
  [ASSET_READ_ALIASES.inspectRange]: {
    does: "Validate one source-frame range of an asset and list where the timeline uses it.",
    useWhen: "Use it before trimming or splitting a clip to confirm the source frames exist and to see which clips depend on them.",
    notWhen: "Do not use it for timeline positions (read_timeline works in timeline frames) or for whole-asset facts (inspect_media).",
    params: `${ASSET_ID_PARAM} startFrame and endFrame are integer source-frame numbers at the asset's own frame rate, which is not necessarily the project frame rate.`,
  },
  [ASSET_READ_ALIASES.waveform]: {
    does: "Read bounded peak and RMS waveform buckets for one audio range of an asset.",
    useWhen: "Use it to find loud or silent stretches when placing cuts, captions or music.",
    notWhen: "Do not use it to hear or transcribe speech — it returns amplitude buckets only. For the asset's format facts use inspect_media.",
    params: `${ASSET_ID_PARAM} startSeconds and endSeconds are measured from the start of the asset; buckets caps how many samples come back, so ask for the resolution you actually need.`,
  },
};

const EXPORT_DESCRIBE: Readonly<Record<string, VerbDescription>> = {
  [EXPORT_READ_ALIASES.inspect]: {
    does: "Inspect one export job: status, progress and whether it can still be cancelled (path-free receipt).",
    useWhen: "Use it after export_timeline to follow the job, and when the user asks whether the export is done.",
    notWhen: "Do not use it to check the rendered file (verify_render) or to start an export (export_timeline).",
    params: "jobId is the id returned by export_timeline.",
  },
  [EXPORT_READ_ALIASES.verify]: {
    does: "Verify one non-empty export receipt (persisted receipt and output size) without decoding media.",
    useWhen: "Use it once inspect_export_job reports completion and the user wants confirmation the file landed.",
    notWhen: "Do not use it to watch progress (inspect_export_job). It does not inspect frames or confirm visual quality.",
    params: "jobId is the id returned by export_timeline.",
  },
  [EXPORT_WRITE_ALIASES.start]: {
    does: "Start an approved export of the timeline at one exact revision.",
    useWhen: "Use it when the user asks to export, render out or save the video.",
    notWhen: "Do not use it before reading the current timeline (read_timeline); stale revisions and empty timelines are rejected. Not for cancelling (cancel_export_job).",
    params: "expectedRevision is the revision from read_timeline; outputName, aspectRatio, resolution and quality are optional. Follow the returned jobId with inspect_export_job.",
  },
  [EXPORT_WRITE_ALIASES.cancel]: {
    does: "Cancel one active-project export job after explicit approval.",
    useWhen: "Use it when the user asks to stop an export that is still running.",
    notWhen: "Do not use it for drafts or generation jobs (nomi_generation_status) or to check progress (inspect_export_job). Completed or non-cancellable jobs return their current status without starting new work.",
    params: "jobId is the exact id returned by export_timeline.",
  },
};

export function mediaVerbs(): VerbDeclaration[] {
  const assets = (Object.values(ASSET_READ_ALIASES) as string[]).map((alias): VerbDeclaration => {
    const schema = assetReadPiInputSchemaForAlias(alias);
    if (!schema) throw new Error(`Unregistered asset.read alias: ${alias}`);
    return {
      name: alias,
      contractId: "asset.read",
      effect: "read",
      nextAction: "none",
      internalGroup: "media",
      describe: ASSET_DESCRIBE[alias]!,
      promptGuidelines: ASSET_GUIDELINES,
      schema,
      examples: [],
      aliasBoundInput: Object.freeze({ operation: alias }),
      prepareArguments: modelArgumentTolerance({ arrayFields: ["kinds"] }),
    };
  });
  const exportReads = (Object.values(EXPORT_READ_ALIASES) as string[]).map((alias): VerbDeclaration => {
    const schema = exportReadPiInputSchemaForAlias(alias);
    if (!schema) throw new Error(`Unregistered export.read alias: ${alias}`);
    return {
      name: alias,
      contractId: "export.read",
      effect: "read",
      nextAction: "none",
      internalGroup: "media",
      profiles: ["internal"],
      profileReason: "mcpHandwrittenTransport",
      describe: EXPORT_DESCRIBE[alias]!,
      promptGuidelines: EXPORT_GUIDELINES,
      schema,
      examples: [],
      prepareArguments: modelArgumentTolerance({}),
    };
  });
  const exportWrites = (Object.values(EXPORT_WRITE_ALIASES) as string[]).map((alias): VerbDeclaration => {
    const schema = exportWritePiInputSchemaForAlias(alias);
    if (!schema) throw new Error(`Unregistered export.write alias: ${alias}`);
    return {
      name: alias,
      contractId: "export.write",
      effect: "irreversible",
      nextAction: alias === EXPORT_WRITE_ALIASES.start ? "job_running" : "user_sees_confirm_card",
      internalGroup: "media",
      profiles: ["internal"],
      profileReason: "mcpHandwrittenTransport",
      describe: EXPORT_DESCRIBE[alias]!,
      promptGuidelines: EXPORT_GUIDELINES,
      schema,
      examples: [],
      prepareArguments: modelArgumentTolerance({}),
    };
  });
  return [...assets, ...exportReads, ...exportWrites];
}
