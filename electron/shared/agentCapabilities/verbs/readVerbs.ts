// 七个读动词（设计正本 §5.1）：模型看到的世界 = 用户看到的世界。执行那一半住 `electron/agentLane/`
// （`laneCanvasTools.ts` / `laneDocumentTools.ts` / `laneTimelineTools.ts` / `laneModelRead.mts` / `laneExtendedDesktopPorts.ts`）。
import { z } from "zod";
import { agentModelEntrySchema } from "../availableModelsSchema";

import { LANE_MODEL_OUTPUT_MAX_BYTES, LANE_MODEL_OUTPUT_MAX_LINES } from "../../agentLane/laneContracts";
import type { DocumentReadInput } from "../documentRead";
import { modelArgumentTolerance, noArgumentTolerance } from "../modelArgumentTolerance";
import { NO_ARGUMENTS_SCHEMA } from "../verbDeclaration";
import type { VerbDeclaration } from "../verbDeclaration";
import { checkJobModelSchema, readScriptModelSchema, readSkillModelSchema, READ_SCRIPT_SCOPE_DEFAULT } from "./verbProjections";
import { assetReadInputOf, timelineReadInputOf } from "./verbSemanticInput";

const OUTPUT_LIMIT = `Long text is truncated to the first ${LANE_MODEL_OUTPUT_MAX_LINES} lines or ${LANE_MODEL_OUTPUT_MAX_BYTES / 1024}KB; the result says so when that happens.`;

export const READ_GUIDELINES = Object.freeze([
  "Read before you write: every id you pass to a write verb comes from a read in this conversation, never from memory or guesswork.",
]);

/** 「哪一份文稿」只有外部宿主需要说；Agent lane 永远写用户此刻正看着的那份（传输字段，不进语义输入）。 */
export const DOCUMENT_ID_TRANSPORT_FIELD = Object.freeze({
  documentId: Object.freeze({
    type: "string" as const,
    minLength: 1,
    description: "Which document to act on. Omit to use the project's active creation document.",
  }),
});

const assetId = z.string().trim().min(1).max(512).describe("Stable asset id from a look_at_media search, a canvas read or a timeline read — never a filename or path.");

/**
 * 一个范围的两条跨字段约束：**要么都给要么都不给**、且末端大于起点。
 *
 * 为什么它必须在动词这一层（2026-09-18 扫描 · R17「防线建在最早能拦住的那层」）：宿主的
 * `inspect_source_range` / `read_waveform` 两条都强制这两条约束，而动词把两端各自声明成可选。
 * 模型只给 `startFrame` 时，翻译层过去会替它补一个 `endFrame: 0`，于是宿主回的是
 * 「Number must be greater than 0」——一个模型没写过的字段、一个它看不懂的数字。约束搬到动词上
 * 之后，pi 的校验器在**调用发出之前**就用动词自己的字段名说清哪儿不对，翻译层也不必再编造缺省值。
 */
function rangeRefinement(startField: string, endField: string) {
  return (value: Record<string, unknown>, context: z.RefinementCtx): void => {
    const start = value[startField] as number | undefined;
    const end = value[endField] as number | undefined;
    if (start === undefined && end === undefined) return;
    if (start === undefined || end === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom, path: [start === undefined ? startField : endField],
        message: `give both ${startField} and ${endField}, or neither`,
      });
      return;
    }
    if (end <= start) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [endField], message: `${endField} must be greater than ${startField}` });
    }
  };
}

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
      useWhen: `Before editing the script, when splitting it into shots, and when the user is on the creation page and says "this" or "here" about the script (use scope selection — selection exists only there; on other pages those words mean what is selected on that page).`,
      notWhen: "Not for shots or canvas content (look_at_canvas). An empty selection means ask, not guess.",
      params: `scope is full (default) or selection. ${OUTPUT_LIMIT}`,
    },
    promptGuidelines: READ_GUIDELINES,
    // 模型面从宿主契约 schema 派生（`verbProjections.ts`）：宿主的 `scope` 必填，模型面让它可选，
    // 缺省由宿主补（下面的 `semanticInputOf`）。宿主改字段名或改枚举，这里是 tsc 红。
    schema: readScriptModelSchema,
    examples: [{ when: "Read the whole document:", arguments: {} }, { when: "Resolve \"this part\":", arguments: { scope: "selection" } }],
    mcpTransportFields: DOCUMENT_ID_TRANSPORT_FIELD,
    prepareArguments: modelArgumentTolerance({ knownFields: ["scope"] }),
    // 「缺省 full」是**声明**的一部分，所以它住在翻译层（两个 profile 共用），不住在某个执行器里。
    // 2026-09-18 扫描：`document.read` 契约的 `scope` 是必填，而动词说它可选、示例就是 `{}`。
    // 内部 lane 靠 `laneDocumentTools` 里一句手写的 `?? "full"` 兜住，对外 MCP 面没有那句，
    // 于是 `nomi_document_read` 只带租约调用时当场 `capability_input_invalid`——同一个默认值，
    // 一边有一边没有，就是漂移。补在这里之后那句手写兜底已删（P1）。
    semanticInputOf: (args) => ({ scope: (args as { scope?: DocumentReadInput["scope"] }).scope ?? READ_SCRIPT_SCOPE_DEFAULT }),
  };
  const readTimeline: VerbDeclaration = {
    // 常驻（设计正本 §5.1 / PR A 的常驻 10 个）：读时间轴不需要先请求 timeline 组；执行绑在 laneTimelineTools。
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
    }).strict().superRefine(rangeRefinement("startFrame", "endFrame")),
    examples: [{ when: "Read the whole timeline and its revision:", arguments: {} }, { when: "Look at the fourth to sixth second at 30fps:", arguments: { startFrame: 120, endFrame: 180 } }],
    prepareArguments: modelArgumentTolerance({}),
    semanticInputOf: (args) => timelineReadInputOf(args) as unknown as Record<string, unknown>,
  };
  // 素材读按组延迟披露（与 export_video / cancel_job 同组），执行走 `laneVerbTransport` → phase4 读适配器。
  const lookAtMedia: VerbDeclaration = {
    name: "look_at_media", contractId: "asset.read", effect: "read", nextAction: "none", internalGroup: "media",
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
      }).strict().superRefine(rangeRefinement("startSeconds", "endSeconds")).optional().describe("With assetId: read peak and RMS amplitude buckets for one audio range."),
    }).strict().superRefine((value, context) => {
      rangeRefinement("startFrame", "endFrame")(value as Record<string, unknown>, context);
      // 五合一读**按参数形状**派生方法名，所以「同时给两套参数」不是更精确，是有一套会被静默忽略。
      // 2026-09-18 扫描：`{assetId, startFrame, endFrame, waveform}` 过得了动词、翻出来只剩波形那一套，
      // 帧范围无声消失。把互斥写进声明，模型当场知道该给哪一套。
      const modes = [
        value.query !== undefined || value.kinds !== undefined || value.limit !== undefined ? "search" : undefined,
        value.startFrame !== undefined || value.endFrame !== undefined ? "frame range" : undefined,
        value.waveform !== undefined ? "waveform" : undefined,
      ].filter(Boolean);
      if (modes.length > 1) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["assetId"], message: `give only one of: search (query/kinds/limit), frame range (startFrame+endFrame), waveform — got ${modes.join(" and ")}` });
      }
      if (value.assetId === undefined && modes.length > 0 && modes[0] !== "search") {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["assetId"], message: `assetId is required to read a ${modes[0]}` });
      }
    }),
    examples: [
      { when: "Find rainy footage:", arguments: { query: "雨天", kinds: ["video"] } },
      { when: "Read one asset's record and container facts:", arguments: { assetId: "asset-1" } },
      { when: "Validate source frames 0-120 of a clip:", arguments: { assetId: "asset-1", startFrame: 0, endFrame: 120 } },
    ],
    prepareArguments: modelArgumentTolerance({ arrayFields: ["kinds"], objectFields: ["waveform"] }),
    semanticInputOf: (args) => assetReadInputOf(args) as unknown as Record<string, unknown>,
  };
  // `models` 组由原生装配层绑定执行（`laneModelRead.mts`），按组延迟披露。
  const listModels: VerbDeclaration = {
    outputSchema: z.object({ models: z.array(agentModelEntrySchema) }).strict(),
    name: "list_models", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "generation.context.read", effect: "read", nextAction: "none", internalGroup: "models",
    describe: {
      does: "Read the models the user has connected: each model's modes, parameters with allowed values, and reference slots.",
      useWhen: "Before choosing a modelId or any parameter in draft_shots, and when the user asks which models can do something.",
      notWhen: "It cannot connect a model or take an API key (start_model_setup). Never invent a modelId — use the exact strings returned here.",
      params: "kind (image, video or audio) narrows the catalog; modelId returns one model in full; vendor picks which provider when two of them carry the same modelId.",
    },
    promptGuidelines: READ_GUIDELINES,
    schema: z.object({
      kind: z.enum(["image", "video", "audio"]).optional().describe("Only models that produce this kind of media."),
      modelId: z.string().trim().min(1).optional().describe("Catalog id of one model to read in full — the same modelId this verb returns and draft_shots takes."),
      vendor: z.string().trim().min(1).optional().describe("Provider of that model. Required when the thin list shows the same modelId under two providers — they are two different models with different modes and parameters."),
    }).strict(),
    examples: [{ when: "Which models can make video:", arguments: { kind: "video" } }],
    prepareArguments: modelArgumentTolerance({}),
  };
  // 任务读经 `laneVerbTransport` 走生成域→导出域两跳（`laneExtendedDesktopPorts.executeRead`），与 draft_shots / generate 同组延迟披露。
  const checkJob: VerbDeclaration = {
    name: "check_job", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "generation.run.read", alsoCovers: ["export.read"], effect: "read", nextAction: "none", internalGroup: "generation",
    effectGroups: ["job-status-cancel"],
    describe: {
      does: "Read one generation or export job: its stage, progress, result reference and what it has cost so far.",
      useWhen: "The user asks whether something is done, what is still running, or what it cost; before cancel_job.",
      notWhen: "It never starts, retries or reconciles provider work. Not for stopping a job (cancel_job). If a job id is unknown, say so — do not resubmit.",
      params: "Copy domain and jobId from taskRef returned by generate, export_video or look_at_canvas. A node ID is never a task ID. A draft has not executed; do not treat it as a failed execution.",
    },
    promptGuidelines: READ_GUIDELINES,
    // **双域动词**：模型面投在导出域上（`export.read` 的 `inspect_export_job` 分支减掉 `operation`，
    // 零 rename 的真投影）；生成域那一半的改名在 `verbDualDomain.ts`，理由是两个域各有一份持久化。
    schema: checkJobModelSchema,
    examples: [{ when: "Check a running job:", arguments: { domain: 'generation', jobId: "op-1" } }],
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
    // 模型面从 `skill.read` 契约派生：藏掉 `operation`（传输方法词表）与 `expectedContentHash`
    // （只有宿主拿得到的内容哈希）。见 `verbProjections.ts`。
    schema: readSkillModelSchema,
    examples: [{ when: "Load the UGC ad skill:", arguments: { name: "ugc-ad" } }],
    prepareArguments: modelArgumentTolerance({}),
  };
  return [lookAtCanvas, readScript, readTimeline, lookAtMedia, listModels, checkJob, readSkill];
}
