// 七个读动词（设计正本 §5.1）：模型看到的世界 = 用户看到的世界。执行那一半住 `electron/agentLane/laneVerbExecutors.ts`。
import { z } from "zod";

import { LANE_MODEL_OUTPUT_MAX_BYTES, LANE_MODEL_OUTPUT_MAX_LINES } from "../../agentLane/laneContracts";
import { modelArgumentTolerance, noArgumentTolerance } from "../modelArgumentTolerance";
import { NO_ARGUMENTS_SCHEMA } from "../verbDeclaration";
import type { VerbDeclaration } from "../verbDeclaration";

const OUTPUT_LIMIT = `Long text is truncated to the first ${LANE_MODEL_OUTPUT_MAX_LINES} lines or ${LANE_MODEL_OUTPUT_MAX_BYTES / 1024}KB; the result says so when that happens.`;

export const READ_GUIDELINES = Object.freeze([
  "Read before you write: every id you pass to a write verb comes from a read in this conversation, never from memory or guesswork.",
]);

const assetId = z.string().trim().min(1).max(512).describe("Stable asset id from a look_at_media search, a canvas read or a timeline read — never a filename or path.");

export function readVerbs(): VerbDeclaration[] {
  const lookAtCanvas: VerbDeclaration = {
    name: "look_at_canvas", contractId: "canvas.read", effect: "read", nextAction: "none",
    describe: {
      does: "Read everything on the generation canvas: every node (id, kind, title, prompt, model, status), the reference links and groups, and the selection.",
      useWhen: "Before any change to shots, links or groups, and whenever the user asks what is on the canvas or what is still waiting on them.",
      notWhen: "Do not use it to read the script (read_script), the timeline (read_timeline) or the media library (look_at_media). It never changes anything.",
      params: "Takes no arguments. Every id you pass to a write verb comes from here; inventing an id is the most common way an edit fails.",
    },
    promptGuidelines: READ_GUIDELINES, schema: NO_ARGUMENTS_SCHEMA,
    examples: [{ when: "Always call it with no arguments:", arguments: {} }], prepareArguments: noArgumentTolerance,
  };
  const readScript: VerbDeclaration = {
    name: "read_script", contractId: "document.read", effect: "read", nextAction: "none",
    describe: {
      does: "Read the creation document as plain text: the whole document, or only the text the user has selected.",
      useWhen: `Before editing the script, when splitting it into shots, and whenever the user says "this" or "here" (use scope selection — it is the only way to resolve those words).`,
      notWhen: "Not for shots or canvas content (look_at_canvas). An empty selection means ask, not guess.",
      params: `scope is full (default) or selection. ${OUTPUT_LIMIT}`,
    },
    promptGuidelines: READ_GUIDELINES,
    schema: z.object({ scope: z.enum(["full", "selection"]).optional().describe("full (default) reads the whole document; selection reads only what the user selected.") }).strict(),
    examples: [{ when: "Read the whole document:", arguments: {} }, { when: "Resolve \"this part\":", arguments: { scope: "selection" } }],
    prepareArguments: modelArgumentTolerance({}),
  };
  const readTimeline: VerbDeclaration = {
    name: "read_timeline", contractId: "timeline.read", effect: "read", nextAction: "none",
    describe: {
      does: "Read the project timeline: fps, duration, playhead, every track, clip, text overlay and transition, plus the revision every edit must carry.",
      useWhen: `Before edit_timeline, and when the user talks about a moment ("the part around 0:30" — pass startFrame and endFrame to read only that range).`,
      notWhen: "Not for canvas shots that are not on the timeline yet (look_at_canvas). Frames, not seconds: convert with the fps this verb returns.",
      params: "startFrame and endFrame are optional integer frames at the project fps; give both to read one range, neither to read the whole timeline (which is the only call that returns the revision).",
    },
    promptGuidelines: READ_GUIDELINES,
    schema: z.object({
      startFrame: z.number().int().min(0).optional().describe("First frame of the range, at the project fps."),
      endFrame: z.number().int().min(1).optional().describe("Last frame of the range (exclusive), greater than startFrame."),
    }).strict(),
    examples: [{ when: "Read the whole timeline and its revision:", arguments: {} }, { when: "Look at the fourth to sixth second at 30fps:", arguments: { startFrame: 120, endFrame: 180 } }],
    prepareArguments: modelArgumentTolerance({}),
  };
  const lookAtMedia: VerbDeclaration = {
    name: "look_at_media", contractId: "asset.read", effect: "read", nextAction: "none",
    describe: {
      does: "Search the project's media library, or read bounded technical facts (record, codec, frame-range usage, waveform buckets) about one asset.",
      useWhen: "The user asks whether a kind of footage exists, or you need an asset id for a reference or a timeline edit.",
      notWhen: "It reports container facts only and never describes what is visible or audible. Not for canvas nodes (look_at_canvas) or timeline clips (read_timeline).",
      params: "Give query, kinds and limit to search; give assetId alone to read one asset's record and facts; add startFrame and endFrame to validate a source-frame range; add waveform to read amplitude buckets for a seconds range.",
    },
    promptGuidelines: READ_GUIDELINES,
    schema: z.object({
      query: z.string().trim().max(200).optional().describe("Free-text search over the media library."),
      kinds: z.array(z.enum(["image", "video", "audio"])).max(3).optional().describe("Narrow a search to these media kinds."),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum search results; the host enforces a default and a cap."),
      assetId: assetId.optional(),
      startFrame: z.number().int().min(0).optional().describe("With assetId: first source frame of the range to validate (asset frame rate, not project fps)."),
      endFrame: z.number().int().min(1).optional().describe("With assetId: last source frame (exclusive), greater than startFrame."),
      waveform: z.object({
        startSeconds: z.number().min(0).optional().describe("Start of the audio range, seconds from the asset start."),
        endSeconds: z.number().positive().optional().describe("End of the audio range, seconds; greater than startSeconds."),
        buckets: z.number().int().min(1).max(256).optional().describe("How many amplitude buckets to return."),
      }).strict().optional().describe("With assetId: read peak and RMS amplitude buckets for one audio range."),
    }).strict(),
    examples: [
      { when: "Find rainy footage:", arguments: { query: "雨天", kinds: ["video"] } },
      { when: "Read one asset's record and container facts:", arguments: { assetId: "asset-1" } },
      { when: "Validate source frames 0-120 of a clip:", arguments: { assetId: "asset-1", startFrame: 0, endFrame: 120 } },
    ],
    prepareArguments: modelArgumentTolerance({ arrayFields: ["kinds"], objectFields: ["waveform"] }),
  };
  const listModels: VerbDeclaration = {
    name: "list_models", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "generation.context.read", effect: "read", nextAction: "none",
    describe: {
      does: "Read the models the user has connected: each model's modes, parameters with allowed values, and reference slots.",
      useWhen: "Before choosing a modelKey or any parameter in draft_shots, and when the user asks which models can do something.",
      notWhen: "It cannot connect a model or take an API key (start_model_setup). Never invent a modelKey — use the exact strings returned here.",
      params: "kind (image, video or audio) narrows the catalog; modelKey returns one model in full.",
    },
    promptGuidelines: READ_GUIDELINES,
    schema: z.object({
      kind: z.enum(["image", "video", "audio"]).optional().describe("Only models that produce this kind of media."),
      modelKey: z.string().trim().min(1).optional().describe("Catalog key of one model to read in full."),
    }).strict(),
    examples: [{ when: "Which models can make video:", arguments: { kind: "video" } }],
    prepareArguments: modelArgumentTolerance({}),
  };
  const checkJob: VerbDeclaration = {
    name: "check_job", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "generation.run.read", alsoCovers: ["export.read"], effect: "read", nextAction: "none",
    effectGroups: ["job-status-cancel"],
    describe: {
      does: "Read one generation or export job: its stage, progress, result reference and what it has cost so far.",
      useWhen: "The user asks whether something is done, what is still running, or what it cost; before cancel_job.",
      notWhen: "It never starts, retries or reconciles provider work. Not for stopping a job (cancel_job). If a job id is unknown, say so — do not resubmit.",
      params: "jobId comes from the result of generate or export_video, or from look_at_canvas.",
    },
    promptGuidelines: READ_GUIDELINES,
    schema: z.object({ jobId: z.string().trim().min(1).max(160).describe("The job id returned by generate or export_video, or shown on a canvas node.") }).strict(),
    examples: [{ when: "Check a running job:", arguments: { jobId: "op-1" } }],
    prepareArguments: modelArgumentTolerance({}),
  };
  const readSkill: VerbDeclaration = {
    name: "read_skill", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "skill.read", effect: "read", nextAction: "none", internalGroup: "skills",
    describe: {
      does: "Read one installed skill's body so you can follow its method.",
      useWhen: "The user names a skill, or the skills index in this prompt matches the task.",
      notWhen: "Loading a skill grants no tool permission and runs nothing; to store a new one use save_skill.",
      params: "name is the skill name from the skills index.",
    },
    schema: z.object({ name: z.string().trim().min(1).max(240).describe("Skill name exactly as listed in the skills index.") }).strict(),
    examples: [{ when: "Load the UGC ad skill:", arguments: { name: "ugc-ad" } }],
    prepareArguments: modelArgumentTolerance({}),
  };
  return [lookAtCanvas, readScript, readTimeline, lookAtMedia, listModels, checkJob, readSkill];
}
