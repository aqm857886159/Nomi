// 十三个写动词（设计正本 §5.2）：一个动词一种状态一种效果。执行那一半住 `electron/agentLane/laneVerbExecutors.ts`。
//
// 只有 `draft_shots` 能在画布上造出生成类节点；`arrange_canvas` / `make_artifact` / `stage_shot` 收到生成类 kind
// 一律 `wrong_verb` 拒绝并点名 `draft_shots`（判据 `electron/shared/canvas/nodeExecutionKinds.ts`，不手写名单）。
// 只有 `generate` 会把报价卡摆到用户面前；它的返回值是 GitHub MCP `issue_write` 的形状：isError + 明文「不要再调工具」。
import { z } from "zod";

import {
  cameraMoveParamsObjectSchema, CAMERA_MOVE_MODEL_GUIDELINES, STAGING_MODEL_GUIDELINES, stagingReferenceParamsSchema,
} from "../canvasModelShapes";
import { canvasDeletePiInputSchema } from "../canvasDelete";
import { CANVAS_NODE_PROMPT_GUIDELINES, plannedEdgeSchema } from "../canvasWrite";
import { timelineEditPlanModelSchema } from "../timelineRead";
import { modelArgumentTolerance } from "../modelArgumentTolerance";
import { isGeneratingNodeKind } from "../../canvas/nodeExecutionKinds";
import { LaneDomainFailure, wrongVerbFailure } from "../../agentLane/laneToolContract";
import type { VerbDeclaration } from "../verbDeclaration";
import { READ_GUIDELINES } from "./readVerbs";

const shotId = z.string().trim().min(1).max(160);
const generationParameters = z.record(z.union([z.string(), z.number(), z.boolean()]));

/** 一镜草稿：模型填的是**语义**（提示词/模型/参数/参考），候选身份由宿主按目录合成，与单镜路径同一个解析器。 */
export const draftShotSchema = z.object({
  shotId: shotId.optional().describe("Pass an existing shot id to update that draft; omit to create a new shot."),
  title: z.string().trim().min(1).max(120).optional().describe("Short shot title shown on the canvas node."),
  prompt: z.string().trim().min(1).max(8_000).describe("Generation prompt in the user's language (Chinese user → Chinese prompt)."),
  taskKind: z.enum(["text_to_image", "image_edit", "text_to_video", "image_to_video"]).optional().describe("What to produce; omit to infer from prompt, references and durationSec."),
  role: z.enum(["anchor", "shot"]).optional().describe("anchor = a character/scene/style reference card reused by other shots; shot (default) = a numbered shot."),
  durationSec: z.number().positive().max(600).optional().describe("Video clip length in seconds; omit for stills."),
  modelKey: z.string().trim().min(1).optional().describe("Catalog model key from list_models; omit for the user's default."),
  modeId: z.string().trim().min(1).optional().describe("Mode id of that model from list_models."),
  parameters: generationParameters.optional().describe("Parameter values the model's profile declares; the host clamps them to real limits and reports every clamp."),
  references: z.array(z.string().trim().min(1)).max(30).optional().describe("Asset ids (from look_at_media) or shot ids (from look_at_canvas or this call) used as references."),
}).strict();

/**
 * 三个画布写动词的共同前置：模型想借它们造生成类节点 → `wrong_verb` 拒绝并点名 `draft_shots`。
 * 判据是中立层词表 `isGeneratingNodeKind`，不手写名单；跑在 pi 的 ajv 之前（`prepareArguments`），
 * 所以拒绝的是**意图**（`nodes[]` / `kind` 里出现生成类种类），而不是等 schema 报一个「未知字段」。
 */
function rejectGeneratingNodes(attempted: string, tolerate: (args: unknown) => Record<string, unknown>) {
  return (args: unknown): Record<string, unknown> => {
    const record = tolerate(args);
    const kinds: string[] = [];
    if (typeof record.kind === "string") kinds.push(record.kind);
    for (const node of Array.isArray(record.nodes) ? record.nodes : []) {
      if (node && typeof node === "object" && typeof (node as { kind?: unknown }).kind === "string") kinds.push((node as { kind: string }).kind);
    }
    const generating = kinds.filter(isGeneratingNodeKind);
    if (generating.length > 0) {
      throw new LaneDomainFailure(wrongVerbFailure({
        attempted, useInstead: "draft_shots",
        because: `${attempted} cannot create ${[...new Set(generating)].join("/")} nodes; only draft_shots creates shots that generate media.`,
      }));
    }
    return record;
  };
}

const CANVAS_WRITE_GUIDELINES = Object.freeze([
  "Every canvas write is a reversible local edit: describe what changed in your reply using the returned userSees line rather than claiming more.",
]);

export function writeVerbs(): VerbDeclaration[] {
  const writeScript: VerbDeclaration = {
    name: "write_script", contractId: "document.write", effect: "reversible_local", nextAction: "none",
    describe: {
      does: "Write finished prose into the creation document — at the cursor, in place of the selection, or at the end.",
      useWhen: "The user asks you to write, rewrite, tighten or extend script text.",
      notWhen: "Never write a diff, a summary of the change, or a plan to write later. Not for shot prompts (draft_shots). Read the selection first (read_script) unless the user told you exactly what to replace.",
      params: "content is the exact text; where is cursor, selection or end.",
    },
    promptGuidelines: ["Write finished prose into the document, never a diff, a summary of your change, or a plan to write it later."],
    schema: z.object({
      content: z.string().min(1).describe("The exact text to write. Plain prose or Markdown, never a diff or a summary of the change."),
      where: z.enum(["cursor", "selection", "end"]).describe("cursor inserts at the user's cursor; selection replaces the selected text; end appends to the document."),
    }).strict(),
    examples: [{ when: "Append a closing line:", arguments: { content: "The rain had not stopped for three days.", where: "end" } }],
    prepareArguments: modelArgumentTolerance({ fieldAliases: { content: ["text", "body"] } }),
  };

  const draftShots: VerbDeclaration = {
    name: "draft_shots", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "generation.plan", effect: "reversible_local", nextAction: "none", internalGroup: "generation",
    effectGroups: ["canvas-node-creation"],
    describe: {
      does: "Create or update draft shots on the canvas. This is the only verb that creates image, video, audio or 3D shots.",
      useWhen: "Whenever the user asks to make, draw, render, regenerate, restyle or re-time any media — including a single image — or to split text into shots, or to change a shot's prompt, model, parameters or references. Pass shotId to update an existing draft; omit it to create.",
      notWhen: "It does not start generation and shows the user no card — call generate for that, unless the user said not to generate yet. Not for links, groups or layout (arrange_canvas), not for hand-made artifacts (make_artifact), not for staging or camera references (stage_shot).",
      params: "shots[] each with prompt, optional title, taskKind, durationSec, modelKey, modeId, parameters, references, role. Model and parameter values come from list_models; ids from look_at_canvas. Pass draftId to revise a draft you already created; the host clamps values to the model's real limits and reports every clamp.",
    },
    promptGuidelines: [...READ_GUIDELINES, ...CANVAS_NODE_PROMPT_GUIDELINES],
    schema: z.object({
      draftId: z.string().trim().min(1).max(160).optional().describe("The draft id returned by an earlier draft_shots call, when updating its shots."),
      shots: z.array(draftShotSchema).min(1).max(40).describe("The shots to create or update."),
    }).strict(),
    examples: [
      { when: "One opening still:", arguments: { shots: [{ title: "开场", prompt: "清晨日出下的海面，广角，暖光", taskKind: "text_to_image" }] } },
      { when: "Change one existing shot's prompt:", arguments: { draftId: "op-1", shots: [{ shotId: "shot-3", prompt: "夜景，霓虹灯下的街道" }] } },
    ],
    prepareArguments: modelArgumentTolerance({ arrayFields: ["shots"] }),
  };

  const generate: VerbDeclaration = {
    name: "generate", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "generation.plan", effect: "reversible_local", nextAction: "user_sees_spend_card", internalGroup: "generation",
    describe: {
      does: "Put the named draft shots in front of the user as one priced confirmation card. Generation starts only when the user approves the card in Nomi.",
      useWhen: `Right after draft_shots, when the user asked to generate; or when they ask to generate existing drafts ("run all six").`,
      notWhen: `Never to get a price — look_at_canvas already carries unit prices. Never when the user said "don't generate yet". It cannot approve, start, or spend anything itself; to change a shot first use draft_shots.`,
      params: "draftId is the id returned by draft_shots; shotIds optionally limits the card to some of its shots.",
    },
    schema: z.object({
      draftId: z.string().trim().min(1).max(160).describe("The draft id returned by draft_shots."),
      shotIds: z.array(shotId).max(40).optional().describe("Only these shots of the draft; omit for all."),
    }).strict(),
    examples: [{ when: "Show the card for a draft:", arguments: { draftId: "op-1" } }],
    prepareArguments: modelArgumentTolerance({ arrayFields: ["shotIds"] }),
  };

  const arrangeCanvas: VerbDeclaration = {
    name: "arrange_canvas", contractId: "canvas.write", effect: "reversible_local", nextAction: "none",
    effectGroups: ["canvas-node-creation"],
    describe: {
      does: "Change how existing nodes relate and sit on the canvas: connect reference links or tidy the layout.",
      useWhen: "The user asks to connect, link or tidy.",
      notWhen: "It cannot create shots or any generating node — such a request is rejected and draft_shots is named instead. Not for hand-authored artifacts (make_artifact) or staging and camera references (stage_shot).",
      params: "links[] (fromId, toId, role) connect existing nodes; tidy true re-lays out the canvas (optionally one categoryId). All ids from look_at_canvas.",
    },
    promptGuidelines: [...READ_GUIDELINES, ...CANVAS_WRITE_GUIDELINES],
    schema: z.object({
      links: z.array(z.object({
        fromId: z.string().trim().min(1).describe("Source node id."),
        toId: z.string().trim().min(1).describe("Target node id."),
        role: plannedEdgeSchema.shape.mode,
      }).strict()).max(48).optional().describe("Reference links to add between existing nodes."),
      tidy: z.boolean().optional().describe("Re-lay out the canvas."),
      categoryId: z.string().trim().min(1).optional().describe("With tidy: only this canvas category."),
    }).strict(),
    examples: [{ when: "Use the character sheet as a reference for a shot:", arguments: { links: [{ fromId: "node-char", toId: "node-shot-2", role: "character_ref" }] } }],
    prepareArguments: rejectGeneratingNodes("arrange_canvas", modelArgumentTolerance({ arrayFields: ["links"] })),
  };

  const makeArtifact: VerbDeclaration = {
    name: "make_artifact", contractId: "canvas.write", effect: "reversible_local", nextAction: "none",
    effectGroups: ["canvas-node-creation"],
    describe: {
      does: "Put a hand-authored artifact on the canvas — SVG, HTML, Markdown, a table or plain text you wrote yourself.",
      useWhen: "The user wants a chart, table, mood board, comparison sheet or diagram that you can author directly without a generation model.",
      notWhen: "Not for images or video that need a model (draft_shots), not for links or layout (arrange_canvas), not for staging references (stage_shot).",
      params: "fileType, title and content; the content is the whole file.",
    },
    promptGuidelines: CANVAS_WRITE_GUIDELINES,
    schema: z.object({
      fileType: z.enum(["svg", "html", "markdown", "table", "text"]).describe("Which kind of file the content is."),
      title: z.string().trim().min(1).max(120).describe("Node title in the user's language."),
      content: z.string().min(1).describe("The whole artifact content."),
    }).strict(),
    examples: [{ when: "A shot comparison table:", arguments: { fileType: "table", title: "分镜对照表", content: "| 镜 | 内容 |\n|---|---|\n| 1 | 开场 |" } }],
    prepareArguments: rejectGeneratingNodes("make_artifact", modelArgumentTolerance({ fieldAliases: { content: ["text", "body"] } })),
  };

  const stageShot: VerbDeclaration = {
    name: "stage_shot", contractId: "canvas.write", effect: "reversible_local", nextAction: "none",
    effectGroups: ["canvas-node-creation"],
    describe: {
      does: "Attach a staging (blocking) or camera-move reference to one shot; Nomi renders a gray 3D reference for it.",
      useWhen: `The user asks for a push-in, a two-shot, a specific blocking, or "show me the camera move".`,
      notWhen: "It does not generate the shot itself and it is not a prompt edit (draft_shots). Not for links (arrange_canvas) or hand-made artifacts (make_artifact).",
      params: "shotId from look_at_canvas or draft_shots; exactly one of staging (characters, layout, camera, environment, customBlocking) or cameraMove (move, customMove, speed, subjectPose).",
    },
    promptGuidelines: [...STAGING_MODEL_GUIDELINES, ...CAMERA_MOVE_MODEL_GUIDELINES],
    schema: z.object({
      shotId: shotId.describe("The shot to attach the reference to."),
      staging: z.object({
        characters: stagingReferenceParamsSchema.shape.characters,
        layout: stagingReferenceParamsSchema.shape.layout,
        camera: stagingReferenceParamsSchema.shape.camera,
        environment: stagingReferenceParamsSchema.shape.environment,
        crowd: stagingReferenceParamsSchema.shape.crowd,
        sceneTemplate: stagingReferenceParamsSchema.shape.sceneTemplate,
        props: stagingReferenceParamsSchema.shape.props,
        customBlocking: stagingReferenceParamsSchema.shape.customBlocking,
      }).strict().optional().describe("Blocking reference: characters or customBlocking is required."),
      cameraMove: z.object({
        move: cameraMoveParamsObjectSchema.shape.move,
        customMove: cameraMoveParamsObjectSchema.shape.customMove,
        speed: cameraMoveParamsObjectSchema.shape.speed,
        shot: cameraMoveParamsObjectSchema.shape.shot,
        subjectPose: cameraMoveParamsObjectSchema.shape.subjectPose,
        sceneTemplate: stagingReferenceParamsSchema.shape.sceneTemplate,
        props: stagingReferenceParamsSchema.shape.props,
      }).strict().optional().describe("Camera-motion reference: move or customMove is required."),
    }).strict().superRefine((value, context) => {
      if ((value.staging === undefined) === (value.cameraMove === undefined)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["staging"], message: "give exactly one of staging or cameraMove" });
      }
    }),
    examples: [{ when: "Push in on a shot:", arguments: { shotId: "shot-4", cameraMove: { move: "push_in" } } }],
    prepareArguments: rejectGeneratingNodes("stage_shot", modelArgumentTolerance({ objectFields: ["staging", "cameraMove"] })),
  };

  const editTimeline: VerbDeclaration = {
    name: "edit_timeline", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "timeline.write", effect: "reversible_local", nextAction: "user_sees_review_card", internalGroup: "timeline",
    describe: {
      does: "Apply one transaction of timeline operations (move, trim, split, ripple, transition, text, audio) against the revision you read.",
      useWhen: "The user asks to cut, trim, reorder, or add captions or transitions on the timeline.",
      notWhen: "Not without a fresh read_timeline — a stale revision is rejected and resending it cannot succeed. Not for shot content (draft_shots). To revert use undo.",
      params: "revision from read_timeline, a one-line summary, and 1-128 operations in frames. Valid operation kinds: move, remove, split, trim, source-window, ripple, transition, text, audio.",
    },
    promptGuidelines: [
      "Frames, not seconds: every timeline position and duration is an integer frame count at the fps read_timeline returns.",
      "Always plan against a fresh revision: read the timeline, build the plan from what you just read, and pass that same revision back.",
    ],
    schema: timelineEditPlanModelSchema.omit({ planId: true, baseRevision: true }).extend({
      revision: z.string().trim().min(1).max(64).describe("The revision returned by read_timeline; the edit applies only if it is still current."),
    }),
    examples: [{ when: "Move the opening clip to the start:", arguments: { revision: "revision-1", summary: "Move the opening clip", operations: [{ kind: "move", clipId: "clip-1", startFrame: 0 }] } }],
    prepareArguments: modelArgumentTolerance({ arrayFields: ["operations"] }),
  };

  const undo: VerbDeclaration = {
    name: "undo", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "timeline.write", effect: "reversible_local", nextAction: "none", internalGroup: "timeline",
    describe: {
      does: "Revert one timeline change you made, by the changeId its result returned.",
      useWhen: "The user says undo, go back, or that the last change was wrong.",
      notWhen: "It cannot un-spend money or un-export; those are not undoable and check_job or cancel_job are the verbs there. Canvas nodes are undone by the user (Cmd+Z), not here.",
      params: "changeId from the result of edit_timeline; expectedRevision is the current revision from read_timeline.",
    },
    schema: z.object({
      changeId: z.string().trim().min(1).max(160).describe("The changeId returned by the write you are reverting."),
      expectedRevision: z.string().trim().min(1).max(64).describe("Current timeline revision from read_timeline."),
    }).strict(),
    examples: [{ when: "Revert the last plan:", arguments: { changeId: "undo-1", expectedRevision: "revision-2" } }],
    prepareArguments: modelArgumentTolerance({}),
  };

  const deleteFromCanvas: VerbDeclaration = {
    name: "delete_from_canvas", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "canvas.delete", effect: "irreversible", nextAction: "user_sees_confirm_card", internalGroup: "maintenance",
    describe: {
      does: "Delete exact nodes (shots, artifacts, director references) from the canvas.",
      useWhen: "The user names what to delete.",
      notWhen: "Never to clean up on your own initiative (arrange_canvas tidies without removing); never for nodes you did not read in look_at_canvas.",
      params: "nodeIds are exact current ids from look_at_canvas; locked nodes and stale ids are rejected.",
    },
    schema: canvasDeletePiInputSchema,
    examples: [{ when: "Delete two nodes the user pointed at:", arguments: { nodeIds: ["node-a", "node-b"] } }],
    prepareArguments: modelArgumentTolerance({ arrayFields: ["nodeIds"] }),
  };

  const exportVideo: VerbDeclaration = {
    name: "export_video", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "export.write", effect: "irreversible", nextAction: "job_running", internalGroup: "media",
    describe: {
      does: "Start exporting the timeline to an MP4 file at one exact revision.",
      useWhen: "The user asks to export, render out or save the video.",
      notWhen: "Not before reading the current timeline (read_timeline); stale revisions and empty timelines are rejected. To stop a running export use cancel_job; to follow it use check_job.",
      params: "expectedRevision from read_timeline; outputName, aspectRatio, resolution and quality are optional.",
    },
    schema: z.object({
      expectedRevision: z.string().trim().min(1).max(64).describe("The timeline revision from read_timeline."),
      outputName: z.string().trim().min(1).max(120).optional().describe("File name without extension."),
      aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:5", "3:4", "4:3", "21:9"]).optional().describe("Output aspect ratio."),
      resolution: z.enum(["720p", "1080p"]).optional().describe("Output resolution."),
      quality: z.enum(["small", "standard", "high"]).optional().describe("Encoding quality preset."),
    }).strict(),
    examples: [{ when: "Export at 1080p:", arguments: { expectedRevision: "revision-3", resolution: "1080p" } }],
    prepareArguments: modelArgumentTolerance({}),
  };

  const cancelJob: VerbDeclaration = {
    name: "cancel_job", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "export.write", alsoCovers: ["generation.control"], effect: "irreversible", nextAction: "user_sees_confirm_card", internalGroup: "media",
    effectGroups: ["job-status-cancel"],
    describe: {
      does: "Cancel one running generation or export job.",
      useWhen: "The user asks to stop it.",
      notWhen: "Not for drafts (delete_from_canvas) and not for cards (the user closes them). Read it first with check_job; credit already spent is not refunded.",
      params: "jobId from generate, export_video, check_job or look_at_canvas.",
    },
    schema: z.object({ jobId: z.string().trim().min(1).max(160).describe("The job to cancel.") }).strict(),
    examples: [{ when: "Stop a running export:", arguments: { jobId: "export-1" } }],
    prepareArguments: modelArgumentTolerance({}),
  };

  const saveSkill: VerbDeclaration = {
    name: "save_skill", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "skill.write", effect: "reversible_local", nextAction: "none", internalGroup: "skills",
    describe: {
      does: "Save a validated skill package to the user's library.",
      useWhen: "The user asks to save this way of working as a skill.",
      notWhen: "Not for one-off instructions; to follow an existing skill use read_skill.",
      params: "dirName is an ASCII slug; skillMarkdown is the whole SKILL.md (frontmatter plus body).",
    },
    schema: z.object({
      dirName: z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).describe("Directory slug for the skill (ASCII letters, digits, . _ -)."),
      skillMarkdown: z.string().trim().min(1).max(1024 * 1024).describe("The complete SKILL.md content, frontmatter included."),
    }).strict(),
    examples: [{ when: "Save a skill:", arguments: { dirName: "talking-head-cut", skillMarkdown: "---\nname: talking-head-cut\ndescription: Cut a talking head.\n---\n1. Read the transcript." } }],
    prepareArguments: modelArgumentTolerance({}),
  };

  const startModelSetup: VerbDeclaration = {
    name: "start_model_setup", profiles: ["internal"], profileReason: "headlessHost", contractId: "model.setup.open", effect: "reversible_local", nextAction: "user_sees_panel",
    describe: {
      does: "Open Nomi's model settings for one provider so the user can connect it.",
      useWhen: "The user asks to connect, add or set up a model or provider.",
      notWhen: "It never accepts, asks for, or stores an API key; keys are typed by the user in that panel only. To see what is already connected use list_models.",
      params: "provider is an optional hint (free text is fine).",
    },
    schema: z.object({ provider: z.string().trim().min(1).max(80).optional().describe("Provider name hint, e.g. DeepSeek or Anthropic.") }).strict(),
    examples: [{ when: "Connect DeepSeek:", arguments: { provider: "DeepSeek" } }],
    prepareArguments: modelArgumentTolerance({}),
  };

  return [writeScript, draftShots, generate, arrangeCanvas, makeArtifact, stageShot, editTimeline, undo, deleteFromCanvas, exportVideo, cancelJob, saveSkill, startModelSetup, ...legacyCanvasFaces];
}
