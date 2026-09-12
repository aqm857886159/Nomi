// `timeline.read` / `timeline.write` 的动词声明（两个 profile 共用；执行那一半住
// `electron/agentLane/laneTimelineTools.ts` 与 `laneExtendedTools.ts`）。
import {
  TIMELINE_READ_ALIASES,
  timelineEditPlanModelSchema,
  timelineReadPiInputSchemaForAlias,
} from "../timelineRead";
import { TIMELINE_WRITE_ALIASES, timelineWritePiInputSchemaForAlias } from "../timelineWrite";
import { modelArgumentTolerance, noArgumentTolerance } from "../modelArgumentTolerance";
import type { VerbDeclaration } from "../verbDeclaration";

/** 通道③ · 时间轴这一族共享的纪律。第二条是这一族唯一真会咬人的地方：`revision` 是乐观锁。 */
const TIMELINE_GUIDELINES = Object.freeze([
  "Frames, not seconds: every timeline position and duration in these tools is an integer frame count at the project fps returned by read_timeline.",
  "Always plan against a fresh revision: read the timeline, build the plan from what you just read, and pass that same revision back. If a plan is rejected for a stale revision, read again before retrying — resending the old number cannot succeed.",
]);

const PLAN_OPERATION_KINDS = "Valid operation kinds: move, remove, split, trim, source-window, ripple, transition, text, audio.";

const examplePlan = {
  planId: "plan-1", baseRevision: "revision-1", summary: "Move the opening clip",
  operations: [{ kind: "move", clipId: "clip-1", startFrame: 0 }],
};

function schemaFor(alias: string, lookup: (alias: string) => VerbDeclaration["schema"] | undefined): VerbDeclaration["schema"] {
  const schema = lookup(alias);
  if (!schema) throw new Error(`Unregistered timeline alias: ${alias}`);
  return schema;
}

export function timelineVerbs(): VerbDeclaration[] {
  const readTimeline: VerbDeclaration = {
    name: TIMELINE_READ_ALIASES.read,
    contractId: "timeline.read",
    effect: "read",
    nextAction: "none",
    describe: {
      does: "Read the whole project timeline: fps, duration, playhead, tracks, clips, overlays and transitions.",
      useWhen: "Call it first, before any timeline edit — the revision it returns is the optimistic lock every edit plan has to carry, and clip ids come from here.",
      notWhen: "Do not use it when the user is talking about one moment and the whole timeline would be far more than you need (inspect_timeline_range). Not for canvas shots that are not on the timeline yet (nomi_canvas_read).",
      params: "Takes no arguments. The snapshot is path-free: it names clips and source assets by id, never by a file path on disk.",
    },
    promptGuidelines: TIMELINE_GUIDELINES,
    schema: schemaFor(TIMELINE_READ_ALIASES.read, timelineReadPiInputSchemaForAlias),
    examples: [{ when: "Always call it with no arguments:", arguments: {} }],
    aliasBoundInput: Object.freeze({ operation: TIMELINE_READ_ALIASES.read }),
    prepareArguments: noArgumentTolerance,
  };

  const inspectRange: VerbDeclaration = {
    name: TIMELINE_READ_ALIASES.inspectRange,
    contractId: "timeline.read",
    effect: "read",
    nextAction: "none",
    internalGroup: "timeline",
    describe: {
      does: "Inspect only the clips and text overlays that intersect one frame range of the timeline.",
      useWhen: `Use it instead of read_timeline when the user is talking about a specific moment ("the part around 0:30").`,
      notWhen: "Do not use it when you need the revision or the full track layout to build an edit plan (read_timeline).",
      params: "startFrame and endFrame are integer frame numbers at the project fps; convert from seconds yourself using the fps from read_timeline.",
    },
    promptGuidelines: TIMELINE_GUIDELINES,
    schema: schemaFor(TIMELINE_READ_ALIASES.inspectRange, timelineReadPiInputSchemaForAlias),
    examples: [{ when: "Look at the fourth to sixth second at 30fps:", arguments: { startFrame: 120, endFrame: 180 } }],
    aliasBoundInput: Object.freeze({ operation: TIMELINE_READ_ALIASES.inspectRange }),
    prepareArguments: modelArgumentTolerance({}),
  };

  const proposePlan: VerbDeclaration = {
    name: TIMELINE_READ_ALIASES.proposePlan,
    contractId: "timeline.read",
    effect: "read",
    nextAction: "none",
    internalGroup: "timeline",
    profiles: ["internal"],
    profileReason: "mcpHandwrittenTransport",
    describe: {
      does: "Validate and preview an atomic timeline edit plan without changing the project.",
      useWhen: "Use it to check a plan against the current revision before you commit to it, or when the user wants to see what would change.",
      notWhen: "Do not use it to apply the plan — that is apply_edit_plan; and do not use it in place of read_timeline to fetch the revision.",
      params: `The plan carries planId, baseRevision (from read_timeline), a summary and one to 128 operations in frames. ${PLAN_OPERATION_KINDS}`,
    },
    promptGuidelines: TIMELINE_GUIDELINES,
    schema: timelineEditPlanModelSchema,
    examples: [{ when: "Preview before applying:", arguments: examplePlan }],
    prepareArguments: modelArgumentTolerance({ arrayFields: ["operations"] }),
  };

  const applyPlan: VerbDeclaration = {
    name: TIMELINE_WRITE_ALIASES.applyPlan,
    contractId: "timeline.write",
    effect: "reversible_local",
    nextAction: "user_sees_review_card",
    internalGroup: "timeline",
    profiles: ["internal"],
    profileReason: "mcpHandwrittenTransport",
    describe: {
      does: "Apply one compare-and-swap guarded timeline edit plan after the user reviews it.",
      useWhen: "Use it when the user asks to cut, trim, reorder, split, or add captions and transitions on the timeline.",
      notWhen: "Do not use it without a fresh read_timeline — a stale revision is rejected and resending it cannot succeed. Do not use it to preview only (propose_edit_plan) or to revert (undo_timeline_edit). Not for shot content on the canvas (nomi_generation_plan).",
      params: `The plan carries planId, baseRevision (the revision from read_timeline), a summary and one to 128 operations in frames. ${PLAN_OPERATION_KINDS}`,
    },
    promptGuidelines: TIMELINE_GUIDELINES,
    schema: timelineEditPlanModelSchema,
    examples: [{ when: "Apply the reviewed plan:", arguments: examplePlan }],
    prepareArguments: modelArgumentTolerance({ arrayFields: ["operations"] }),
  };

  const undo: VerbDeclaration = {
    name: TIMELINE_WRITE_ALIASES.undo,
    contractId: "timeline.write",
    effect: "reversible_local",
    nextAction: "none",
    internalGroup: "timeline",
    profiles: ["internal"],
    profileReason: "mcpHandwrittenTransport",
    describe: {
      does: "Undo the exact most recent Agent timeline edit after user approval.",
      useWhen: "Use it when the user says undo, go back, or that the last timeline change was wrong.",
      notWhen: "Do not use it for changes that were never applied (a previewed plan from propose_edit_plan has nothing to undo) or for canvas edits (nomi_canvas_write).",
      params: "undoToken comes from the apply_edit_plan result; expectedRevision is the current revision from read_timeline. Stale or superseded edits are rejected.",
    },
    promptGuidelines: TIMELINE_GUIDELINES,
    schema: schemaFor(TIMELINE_WRITE_ALIASES.undo, timelineWritePiInputSchemaForAlias),
    examples: [{ when: "Revert the last applied plan:", arguments: { undoToken: "undo-1", expectedRevision: "revision-2" } }],
    prepareArguments: modelArgumentTolerance({}),
  };

  return [readTimeline, inspectRange, proposePlan, applyPlan, undo];
}
