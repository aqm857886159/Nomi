import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";

const canonicalIdSchema = z.string().trim().min(1);
export const CANVAS_WRITE_MAX_PROMPT_CHARS = 262_144;
const nonBlankPromptSchema = z
  .string()
  .max(CANVAS_WRITE_MAX_PROMPT_CHARS)
  .refine((value) => value.trim().length > 0, {
    message: "Prompt must contain non-whitespace content",
  });

export const canvasNodeKindSchema = z.enum([
  "text",
  "character",
  "scene",
  "image",
  "keyframe",
  "video",
  "shot",
  "output",
  "panorama",
]);

export const plannedNodeSchema = z
  .object({
    clientId: z.string().trim().min(1),
    kind: canvasNodeKindSchema,
    title: z.string().trim().min(1),
    prompt: z
      .string()
      .max(CANVAS_WRITE_MAX_PROMPT_CHARS)
      .describe(
        "High-quality generation prompt, in the SAME language as the user (Chinese user → Chinese prompt). Write it as a STRUCTURED skeleton, not a run-on sentence:\n" +
          "- character/scene reference card: stable appearance/environment description + unified style keywords (neutral full-body pose for a character, empty wide establishing shot for a scene; no plot action).\n" +
          "- image / keyframe shot: scene·time·light → subject·action·expression → shot language (wide / close-up / low-angle…) → style keywords.\n" +
          "- video shot: camera move (push / pull / pan / track…) → on-screen action progression → rhythm & duration feel; do NOT restate the static keyframe description.\n" +
          "Keep the same subject's appearance description consistent across shots.",
      ),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
    categoryId: z.string().trim().min(1).optional(),
    modelKey: z.string().trim().min(1).optional(),
    vendor: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Catalog vendor key paired with modelKey. Keep it only when it comes from the available-models list."),
    // Kept as a wire-compatible alias for older proposals. The renderer and
    // execution path normalize both names to the same canonical node meta;
    // callers must not provide conflicting values.
    modelVendor: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Legacy alias of vendor; if both are present they must identify the same catalog vendor."),
    modeId: z.string().trim().min(1).optional(),
    variantId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional model-archetype variant (for example standard, fast, or mini), paired with modelKey."),
    params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    referenceSheet: z.boolean().optional(),
    storyboardKeyframe: z.boolean().optional(),
    staticFeatures: z.string().optional(),
    dynamicFeatures: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict()
  .superRefine((node, context) => {
    if (node.vendor && node.modelVendor && node.vendor !== node.modelVendor) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modelVendor"],
        message: "vendor and modelVendor must match when both are provided",
      });
    }
  });

export const plannedEdgeSchema = z
  .object({
    sourceClientId: z.string().trim().min(1),
    targetClientId: z.string().trim().min(1),
    mode: z
      .enum(["reference", "first_frame", "last_frame", "style_ref", "character_ref", "composition_ref"])
      .optional()
      .describe(
        "Reference-slot semantics: character_ref (cast sheet feeds keyframe), style_ref (scene/style feeds keyframe), composition_ref, first_frame (keyframe image feeds the video's first frame; when the source is a VIDEO node this means last-frame relay and must be opted-in by the user), last_frame, reference (generic). Omit for a generic reference edge. Only connect a reference the TARGET model actually supports — see each model's per-mode reference slots in the available-models list; text/shot/output nodes cannot be a reference source. Unsupported edges are skipped and reported back in skippedEdges.",
      ),
  })
  .strict();

const createCanvasNodesInputSchema = z
  .object({
    operation: z.literal("create_canvas_nodes"),
    summary: z
      .string()
      .trim()
      .min(1)
      .describe("One-sentence summary of the plan, shown to the user before confirmation."),
    nodes: z.array(plannedNodeSchema).min(1).max(24),
    edges: z
      .array(plannedEdgeSchema)
      .max(48)
      .optional()
      .describe(
        "Reference edges between this plan's nodes (use their clientId) and/or existing real node ids. Submit together with nodes in this same call.",
      ),
    anchorCount: z.number().int().nonnegative().max(24).optional(),
    groupCategoryId: z.string().trim().min(1).optional(),
  })
  .strict();

const connectCanvasEdgesInputSchema = z
  .object({
    operation: z.literal("connect_canvas_edges"),
    edges: z.array(plannedEdgeSchema).min(1).max(48),
  })
  .strict();

const tidyCanvasInputSchema = z
  .object({
    operation: z.literal("tidy_canvas"),
    categoryId: z.string().trim().min(1).optional(),
  })
  .strict();

// Storyboard-side canvas actions already have renderer/domain owners (the
// creation store, timeline adoption bridge, and scene3d builders).  Keep
// their model-facing envelopes in the same canonical capability so a visible
// tool cannot fall through to an unverified generic approval.  The nested
// domain records are validated again by the renderer's authoritative parser;
// the main-process boundary still enforces required top-level shape and
// rejects unknown top-level fields.
const storyboardPlanActionInputSchema = z
  .object({
    operation: z.literal("propose_storyboard_plan"),
    title: z.string().trim().min(1),
    anchors: z.array(z.record(z.unknown())).max(24),
    shots: z.array(z.record(z.unknown())).min(1).max(24),
  })
  .strict();

/**
 * 改已有分镜表的**逐项修改**（区别于 propose_storyboard_plan 的「从无到有整份产出」）。
 *
 * 设计要点（每条都对应一个真实的失败模式，别顺手改）：
 *
 * 1. **patch 里结构上没有 shots / anchors 数组** —— 模型改不到没点名的字段。
 *    此前「只改用户点名要改的部分，其余原样保留」是写在提示词里**求**它的（软约束），
 *    它每次仍有权重写整份方案。这里把它变成 schema 硬约束。
 *
 * 2. **镜号是 1-based**，与用户说的「第 3 镜」和 UI 上显示的 01/02/03 一致。
 *    内部若用 0-based，模型会 off-by-one 而用户看不出来——对齐用户词汇，不对齐数组下标。
 *
 * 3. **promptAppend 与 prompt 分开**：「所有镜头加雨天」的正确语义是**追加**。
 *    只给 prompt 的话，模型得先逐镜读原文再拼接——多一轮读、容易丢内容。
 *    让最高频的批量意图成为一次无损调用。
 *
 * 4. **modelKey 与 modelVendor 成对**：模型身份的唯一键是 (vendor, modelKey)，
 *    schema 层就该体现（2026-09-03 因为漏 vendor 发生过三次真实故障）。
 *
 * 5. **选择器只有 all / indexes 两种，刻意不做「按生成状态选」**：
 *    模型已能用 nomi_canvas_read 读状态再自己给出镜号——两步但不耦合，
 *    而且用户在确认卡上看得见它到底选了哪几镜。确定性归我们，情境性归模型。
 */
const storyboardPatchShotsInputSchema = z
  .object({
    operation: z.literal("patch_shots"),
    select: z.union([
      z.object({ kind: z.literal("all") }).strict(),
      z.object({ kind: z.literal("indexes"), indexes: z.array(z.number().int().min(1).max(24)).min(1).max(24) }).strict(),
    ]),
    patch: z
      .object({
        prompt: z.string().trim().min(1).optional(),
        promptAppend: z.string().trim().min(1).optional(),
        shotKind: z.enum(["image", "video"]).optional(),
        durationSec: z.number().int().min(1).max(60).optional(),
        aspectRatio: z.string().trim().min(1).optional(),
        modelKey: z.string().trim().min(1).optional(),
        modelVendor: z.string().trim().min(1).optional(),
      })
      .strict()
      // 空补丁 = 一次无效调用，早报错好过静默无操作（静默无操作正是这轮一直在修的那类）。
      .refine((patch) => Object.keys(patch).length > 0, { message: "patch 至少要点名一个字段" })
      // prompt 是整句替换、promptAppend 是追加，同时给等于意图矛盾——不猜，直接拒。
      .refine((patch) => !(patch.prompt && patch.promptAppend), { message: "prompt 与 promptAppend 只能给一个" }),
  })
  .strict();

const arrangeStoryboardActionInputSchema = z
  .object({
    operation: z.literal("arrange_storyboard_to_timeline"),
    nodeIds: z.array(canonicalIdSchema).min(1).max(48),
  })
  .strict();

const stagingReferenceActionInputSchema = z
  .object({
    operation: z.literal("create_staging_reference"),
    shotClientId: canonicalIdSchema.optional(),
    characters: z.array(z.record(z.unknown())).max(6).optional(),
    layout: z.string().trim().min(1).optional(),
    camera: z.record(z.unknown()).optional(),
    environment: z.string().trim().min(1).optional(),
    crowd: z.record(z.unknown()).optional(),
    sceneTemplate: z.string().trim().min(1).optional(),
    props: z.array(z.record(z.unknown())).max(12).optional(),
    customBlocking: z.string().trim().min(1).optional(),
  })
  .strict();

const cameraMoveActionInputSchema = z
  .object({
    operation: z.literal("create_camera_move"),
    shotClientId: canonicalIdSchema,
    move: z.string().trim().min(1).optional(),
    customMove: z.string().trim().min(1).optional(),
    speed: z.string().trim().min(1).optional(),
    shot: z.string().trim().min(1).optional(),
    subjectPose: z.string().trim().min(1).optional(),
    sceneTemplate: z.string().trim().min(1).optional(),
    props: z.array(z.record(z.unknown())).max(12).optional(),
  })
  .strict();

const canvasWriteSemanticInputUnion = z.discriminatedUnion("operation", [
  z
    .object({ operation: z.literal("set_node_prompt"), nodeId: canonicalIdSchema, prompt: nonBlankPromptSchema })
    .strict(),
  createCanvasNodesInputSchema,
  connectCanvasEdgesInputSchema,
  tidyCanvasInputSchema,
  storyboardPlanActionInputSchema,
  storyboardPatchShotsInputSchema,
  arrangeStoryboardActionInputSchema,
  stagingReferenceActionInputSchema,
  cameraMoveActionInputSchema,
]);

export const canvasWriteSemanticInputSchema = canvasWriteSemanticInputUnion.superRefine((value, context) => {
  if (value.operation === "create_staging_reference" && (value.characters?.length ?? 0) === 0 && !value.customBlocking) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "characters or customBlocking is required" });
  }
  if (value.operation === "create_camera_move" && !value.move && !value.customMove) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "move or customMove is required" });
  }
});

/** Pi derives the operation from the Registry alias; callers provide only semantic arguments. */
export const canvasWritePiInputSchema = z
  .object({
    nodeId: canonicalIdSchema,
    prompt: nonBlankPromptSchema,
  })
  .strict();
const createCanvasNodesPiInputSchema = createCanvasNodesInputSchema.omit({ operation: true });
const connectCanvasEdgesPiInputSchema = connectCanvasEdgesInputSchema.omit({ operation: true });
const tidyCanvasPiInputSchema = tidyCanvasInputSchema.omit({ operation: true });
const storyboardPlanActionPiInputSchema = storyboardPlanActionInputSchema.omit({ operation: true });
const storyboardPatchShotsPiInputSchema = storyboardPatchShotsInputSchema.omit({ operation: true });
const arrangeStoryboardActionPiInputSchema = arrangeStoryboardActionInputSchema.omit({ operation: true });
const stagingReferenceActionPiInputSchema = stagingReferenceActionInputSchema
  .omit({ operation: true })
  .superRefine((value, context) => {
    if ((value.characters?.length ?? 0) === 0 && !value.customBlocking) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "characters or customBlocking is required" });
    }
  });
const cameraMoveActionPiInputSchema = cameraMoveActionInputSchema
  .omit({ operation: true })
  .superRefine((value, context) => {
    if (!value.move && !value.customMove) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "move or customMove is required" });
    }
  });

export type CanvasWriteInput = z.infer<typeof canvasWriteSemanticInputSchema>;
export type CanvasWriteOperation = CanvasWriteInput["operation"];

export function canvasWritePiInputSchemaForAlias(alias: string): z.ZodTypeAny | undefined {
  switch (alias) {
    case "set_node_prompt":
      return canvasWritePiInputSchema;
    case "create_canvas_nodes":
      return createCanvasNodesPiInputSchema;
    case "connect_canvas_edges":
      return connectCanvasEdgesPiInputSchema;
    case "tidy_canvas":
      return tidyCanvasPiInputSchema;
    case "propose_storyboard_plan":
      return storyboardPlanActionPiInputSchema;
    case "patch_shots":
      return storyboardPatchShotsPiInputSchema;
    case "arrange_storyboard_to_timeline":
      return arrangeStoryboardActionPiInputSchema;
    case "create_staging_reference":
      return stagingReferenceActionPiInputSchema;
    case "create_camera_move":
      return cameraMoveActionPiInputSchema;
    default:
      return undefined;
  }
}

export function canvasWritePiDescriptionForAlias(alias: string): string | undefined {
  switch (alias) {
    case "set_node_prompt":
      return "Propose an exact, reversible prompt update to one generation canvas node.";
    case "create_canvas_nodes":
      return "Propose a reversible batch of canvas nodes and their reference edges in one call.";
    case "connect_canvas_edges":
      return "Propose reversible reference edges between existing canvas nodes.";
    case "tidy_canvas":
      return "Propose an undoable layout cleanup for one canvas category.";
    case "propose_storyboard_plan":
      return "Save a structured storyboard plan for review in the creation area.";
    case "arrange_storyboard_to_timeline":
      return "Arrange the selected storyboard shots into the timeline in story order.";
    case "create_staging_reference":
      return "Create a staging reference and attach it to the selected shot.";
    case "create_camera_move":
      return "Create a camera-move reference and attach it to the selected video shot.";
    default:
      return undefined;
  }
}

const reconciliationSchema = z.object({ ok: z.boolean(), deviationCount: z.number().int().nonnegative() }).strict();
const skippedEdgeSchema = z
  .object({ source: canonicalIdSchema, target: canonicalIdSchema, reason: z.string().trim().min(1) })
  .strict();

export const canvasWriteResultSchema = z.union([
  z
    .object({
      cancelled: z.literal(true),
      reason: z.literal("declined"),
      operation: z.literal("create_canvas_nodes"),
      ids: z.array(canonicalIdSchema).max(24),
    })
    .strict(),
  z
    .object({
      applied: z.literal(true),
      proposalId: canonicalIdSchema,
      operation: z.literal("set_node_prompt"),
      affectedNodeIds: z.array(canonicalIdSchema).length(1),
      reconciliation: reconciliationSchema,
    })
    .strict(),
  z
    .object({
      applied: z.literal(true),
      proposalId: canonicalIdSchema,
      operation: z.literal("create_canvas_nodes"),
      affectedNodeIds: z.array(canonicalIdSchema).min(1).max(24),
      affectedEdgeIds: z.array(canonicalIdSchema),
      clientIdToNodeId: z.record(canonicalIdSchema),
      connectedCount: z.number().int().nonnegative(),
      skippedEdges: z.array(skippedEdgeSchema),
      reconciliation: reconciliationSchema,
    })
    .strict(),
  z
    .object({
      applied: z.literal(true),
      proposalId: canonicalIdSchema,
      operation: z.literal("connect_canvas_edges"),
      affectedNodeIds: z.array(canonicalIdSchema),
      affectedEdgeIds: z.array(canonicalIdSchema),
      connectedCount: z.number().int().nonnegative(),
      skippedEdges: z.array(skippedEdgeSchema),
      reconciliation: reconciliationSchema,
    })
    .strict(),
  z
    .object({
      applied: z.literal(true),
      proposalId: canonicalIdSchema,
      operation: z.literal("tidy_canvas"),
      affectedNodeIds: z.array(canonicalIdSchema),
      categoryId: canonicalIdSchema,
      nodeCount: z.number().int().nonnegative(),
      reconciliation: reconciliationSchema,
    })
    .strict(),
  z
    .object({
      applied: z.literal(true),
      proposalId: canonicalIdSchema,
      operation: z.literal("propose_storyboard_plan"),
      result: z.unknown(),
      reconciliation: reconciliationSchema,
    })
    .strict(),
  z
    .object({
      applied: z.literal(true),
      proposalId: canonicalIdSchema,
      operation: z.literal("patch_shots"),
      // 结果要让模型能直接决定下一步：改了哪几镜（1-based 镜号）、改了哪些字段。
      // 只回 {applied:true} 会逼它重读整份方案（浪费 token）或直接假设成功（出错时无法自我修正）。
      changedShotIndexes: z.array(z.number().int().min(1)).max(24),
      changedFields: z.array(z.string()).max(8),
      result: z.unknown(),
      reconciliation: reconciliationSchema,
    })
    .strict(),
  z
    .object({
      applied: z.literal(true),
      proposalId: canonicalIdSchema,
      operation: z.literal("arrange_storyboard_to_timeline"),
      result: z.unknown(),
      reconciliation: reconciliationSchema,
    })
    .strict(),
  z
    .object({
      applied: z.literal(true),
      proposalId: canonicalIdSchema,
      operation: z.literal("create_staging_reference"),
      result: z.unknown(),
      reconciliation: reconciliationSchema,
    })
    .strict(),
  z
    .object({
      applied: z.literal(true),
      proposalId: canonicalIdSchema,
      operation: z.literal("create_camera_move"),
      result: z.unknown(),
      reconciliation: reconciliationSchema,
    })
    .strict(),
]);

export type CanvasWriteResult = z.infer<typeof canvasWriteResultSchema>;

export const CANVAS_WRITE_ALIASES = Object.freeze({
  setNodePrompt: "set_node_prompt",
});

export const CANVAS_WRITE_OPERATION_ALIASES = Object.freeze({
  createCanvasNodes: "create_canvas_nodes",
  connectCanvasEdges: "connect_canvas_edges",
  tidyCanvas: "tidy_canvas",
  proposeStoryboardPlan: "propose_storyboard_plan",
  patchShots: "patch_shots",
  arrangeStoryboardToTimeline: "arrange_storyboard_to_timeline",
  createStagingReference: "create_staging_reference",
  createCameraMove: "create_camera_move",
});

export function canvasWriteOperationForAlias(alias: string): CanvasWriteOperation | undefined {
  if (alias === CANVAS_WRITE_ALIASES.setNodePrompt) return "set_node_prompt";
  if (alias === CANVAS_WRITE_OPERATION_ALIASES.createCanvasNodes) return "create_canvas_nodes";
  if (alias === CANVAS_WRITE_OPERATION_ALIASES.connectCanvasEdges) return "connect_canvas_edges";
  if (alias === CANVAS_WRITE_OPERATION_ALIASES.tidyCanvas) return "tidy_canvas";
  if (alias === CANVAS_WRITE_OPERATION_ALIASES.proposeStoryboardPlan) return "propose_storyboard_plan";
  if (alias === CANVAS_WRITE_OPERATION_ALIASES.patchShots) return "patch_shots";
  if (alias === CANVAS_WRITE_OPERATION_ALIASES.arrangeStoryboardToTimeline) return "arrange_storyboard_to_timeline";
  if (alias === CANVAS_WRITE_OPERATION_ALIASES.createStagingReference) return "create_staging_reference";
  if (alias === CANVAS_WRITE_OPERATION_ALIASES.createCameraMove) return "create_camera_move";
  return undefined;
}

export const CANVAS_WRITE_CAPABILITY = {
  id: "canvas.write",
  version: 1,
  aliases: {
    pi: CANVAS_WRITE_ALIASES.setNodePrompt,
    mcp: "nomi_canvas_edit",
  },
  additionalAliases: {
    pi: Object.freeze(Object.values(CANVAS_WRITE_OPERATION_ALIASES)),
  },
  inputSchema: canvasWriteSemanticInputSchema,
  outputSchema: canvasWriteResultSchema,
  effect: "reversible_write",
  execution: {
    port: "canvas",
    availability: "renderer_required",
  },
  exposure: "mcp_safe",
  requiredScope: "canvas:write",
  targetKind: "canvas",
  approval: "proposal",
  projections: {
    pi: {
      description: "Propose an exact, reversible prompt update to one generation canvas node.",
    },
    mcp: {
      description: "Read the current canvas intent and propose a validated, reversible canvas edit.",
    },
  },
} as const satisfies CapabilityContract<CanvasWriteInput, CanvasWriteResult>;
