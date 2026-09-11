import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";
import { jsonTolerantArray } from "./jsonArgTolerance";

const canonicalIdSchema = z.string().trim().min(1);
export const CANVAS_WRITE_MAX_PROMPT_CHARS = 262_144;
const nonBlankPromptSchema = z
  .string()
  .max(CANVAS_WRITE_MAX_PROMPT_CHARS)
  .refine((value) => value.trim().length > 0, {
    message: "Prompt must contain non-whitespace content",
  });

/** 画布节点上开放键名字段（`params` / `metadata`）的值：标量，不是「随便什么」。 */
const canvasNodeMetaValueSchema = z.union([z.string(), z.number(), z.boolean()]);

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
  "agent-artifact",
]);

export const plannedNodeSchema = z
  .object({
    clientId: z.string().trim().min(1),
    kind: canvasNodeKindSchema,
    title: z.string().trim().min(1),
    prompt: z
      .string()
      .max(CANVAS_WRITE_MAX_PROMPT_CHARS)
      .describe("Generation prompt in the user's language; empty for agent-artifact."),
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
    params: z.record(canvasNodeMetaValueSchema).optional(),
    referenceSheet: z.boolean().optional(),
    storyboardKeyframe: z.boolean().optional(),
    staticFeatures: z.string().optional(),
    dynamicFeatures: z.string().optional(),
    // 值有类型，键名开放。`z.record(z.unknown())` 发布出去是 `{"additionalProperties":{}}`
    // ——「随便你」，而执行侧只认标量：模型据此塞进来的嵌套对象会一路走到落盘才炸。
    metadata: z.record(canvasNodeMetaValueSchema).optional(),
    // agent-artifact（AI 手艺产物）专用：Agent 直接把文件内容交给画布，不调模型生成。
    // 渲染层负责把 content 落盘为项目资产并回填 meta.artifact.url。仅 kind=agent-artifact 可用
    //（superRefine 强制）；fileType 限定文本类（glb 二进制不走文本通道）。
    artifact: z
      .object({
        fileType: z.enum(["svg", "html", "markdown", "table", "text"]),
        content: z.string().max(CANVAS_WRITE_MAX_PROMPT_CHARS),
      })
      .strict()
      .optional(),
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
    if (node.kind === "agent-artifact" && (!node.artifact || !node.artifact.content.trim())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifact"],
        message: "agent-artifact nodes must carry artifact.content (the file body the agent hand-wrote)",
      });
    }
    if (node.kind !== "agent-artifact" && node.artifact) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifact"],
        message: "artifact content is only valid for agent-artifact nodes",
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

/**
 * `edges` 在 `create_canvas_nodes` 与 `connect_canvas_edges` 两支上曾经是**两个形状**
 * （前者可省、后者至少一条）。模型可见 schema 扁平化时这会成为一个真冲突：同一个字段名
 * 只能发布一种形状，替作者挑一个就等于悄悄放宽或收紧了另一支。
 *
 * 所以两支共用**更松的那个**声明，「connect 至少要一条边」下沉进本文件末尾那个
 * `superRefine`——它照样会拒绝，而且拒绝的理由能说清是哪个 operation 要求的
 * （对照今天的病：9 个分支一起吐 8 行互不标记的诉求，其中只有 1 行是真的，#547 §2.2③）。
 */
const plannedEdgesField = jsonTolerantArray(
  z.array(plannedEdgeSchema).max(48),
  "Reference edges between this plan's nodes (use their clientId) and/or existing real node ids. Submit together with nodes in this same call.",
);

const createCanvasNodesInputSchema = z
  .object({
    operation: z.literal("create_canvas_nodes"),
    summary: z
      .string()
      .trim()
      .min(1)
      .describe("One-sentence summary of the plan, shown to the user before confirmation."),
    nodes: jsonTolerantArray(z.array(plannedNodeSchema).min(1).max(24)),
    edges: plannedEdgesField.optional(),
    anchorCount: z.number().int().nonnegative().max(24).optional(),
    groupCategoryId: z.string().trim().min(1).optional(),
  })
  .strict();

const connectCanvasEdgesInputSchema = z
  .object({
    operation: z.literal("connect_canvas_edges"),
    edges: plannedEdgesField,
  })
  .strict();

const tidyCanvasInputSchema = z
  .object({
    operation: z.literal("tidy_canvas"),
    categoryId: z.string().trim().min(1).optional(),
  })
  .strict();

// Storyboard-side canvas actions already have renderer/domain owners (the
// creation store, timeline adoption bridge, and director builders).  Keep
// their model-facing envelopes in the same canonical capability so a visible
// tool cannot fall through to an unverified generic approval.  The nested
// domain records are validated again by the renderer's authoritative parser;
// the main-process boundary still enforces required top-level shape and
// rejects unknown top-level fields.
export const storyboardPlanActionInputSchema = z
  .object({
    operation: z.literal("propose_storyboard_plan"),
    title: z.string().trim().min(1),
    anchors: jsonTolerantArray(z.array(z.record(z.unknown())).max(24)),
    shots: jsonTolerantArray(z.array(z.record(z.unknown())).min(1).max(24)),
  })
  .strict();

/**
 * Patch an existing storyboard through the canonical `nomi_canvas_plan` tool.
 * The selector and patch are deliberately narrow: a model can name the rows
 * and fields it intends to change, but it cannot replace the whole plan or
 * silently rewrite unselected fields.
 */
const storyboardPatchShotsInputSchema = z
  .object({
    operation: z.literal("patch_shots"),
    // 曾经是一个嵌套 `z.union([{kind:'all'}, {kind:'indexes', indexes}])`。两个毛病叠在一起：
    // ① 嵌套 `anyOf`——Google 的 legacy `parameters` 路径（OpenAPI 3.03）压根不支持；
    // ② `z.literal` 生成 `{"const":"all"}`——同一条路径也不认 `const`（G-05，上游的处方是
    //    `StringEnum()`，落到 JSON Schema 就是 `{"type":"string","enum":[…]}`）。
    // 改成扁平对象 + `z.enum` 判别字段，组合约束下沉进 `superRefine`：接受/拒绝的输入集合
    // 一个字没变，但模型在那两条供应商路径上第一次真的看得见它。
    select: z
      .object({
        // 这两个字段刻意**不带 `.describe()`**：它们会随共享契约广播到对外 MCP 的
        // `tools/list`，而 `check:mcp-payload` 是 shrink-only 棘轮、main 恰好卡在上限
        // （实测 28047 / max 28047，零余量）。散文写在 lane 的工具 description 与示例里
        // ——那两处只进内部模型面，对 MCP 载荷是 0 字节。这不是省略，是把话说在
        // 不会顶穿别人预算的那一层。
        kind: z.enum(["all", "indexes"]),
        indexes: jsonTolerantArray(z.array(z.number().int().min(1).max(24)).min(1).max(24)).optional(),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.kind === "indexes" && value.indexes === undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["indexes"],
            message: 'select.kind "indexes" needs an indexes array',
          });
        }
        if (value.kind === "all" && value.indexes !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["indexes"],
            message: 'select.kind "all" already covers every shot; drop indexes',
          });
        }
      }),
    patch: z
      .object({
        prompt: nonBlankPromptSchema.optional(),
        promptAppend: nonBlankPromptSchema.optional(),
        shotKind: z.enum(["image", "video"]).optional(),
        durationSec: z.number().int().min(1).max(60).optional(),
        aspectRatio: z.string().trim().min(1).optional(),
        modelKey: z.string().trim().min(1).optional(),
        modelVendor: z.string().trim().min(1).optional(),
      })
      .strict()
      .refine((patch) => Object.keys(patch).length > 0, {
        message: "patch must name at least one field",
      })
      .refine((patch) => !(patch.prompt && patch.promptAppend), {
        message: "give either prompt or promptAppend, not both",
      })
      .refine((patch) => !(patch.modelKey || patch.modelVendor) || Boolean(patch.modelKey && patch.modelVendor), {
        message: "modelKey and modelVendor must be given together",
      }),
  })
  .strict();

const arrangeStoryboardActionInputSchema = z
  .object({
    operation: z.literal("arrange_storyboard_to_timeline"),
    nodeIds: jsonTolerantArray(z.array(canonicalIdSchema).min(1).max(48)),
  })
  .strict();

export const stagingReferenceActionInputSchema = z
  .object({
    operation: z.literal("create_staging_reference"),
    shotClientId: canonicalIdSchema.optional(),
    characters: jsonTolerantArray(z.array(z.record(z.unknown())).max(6)).optional(),
    layout: z.string().trim().min(1).optional(),
    camera: z.record(z.unknown()).optional(),
    environment: z.string().trim().min(1).optional(),
    crowd: z.record(z.unknown()).optional(),
    sceneTemplate: z.string().trim().min(1).optional(),
    props: jsonTolerantArray(z.array(z.record(z.unknown())).max(12)).optional(),
    customBlocking: z.string().trim().min(1).optional(),
  })
  .strict();

export const cameraMoveActionInputSchema = z
  .object({
    operation: z.literal("create_camera_move"),
    shotClientId: canonicalIdSchema,
    move: z.string().trim().min(1).optional(),
    customMove: z.string().trim().min(1).optional(),
    speed: z.string().trim().min(1).optional(),
    shot: z.string().trim().min(1).optional(),
    subjectPose: z.string().trim().min(1).optional(),
    sceneTemplate: z.string().trim().min(1).optional(),
    props: jsonTolerantArray(z.array(z.record(z.unknown())).max(12)).optional(),
  })
  .strict();

const setNodePromptInputSchema = z
  .object({ operation: z.literal("set_node_prompt"), nodeId: canonicalIdSchema, prompt: nonBlankPromptSchema })
  .strict();

/**
 * ── 三个语义分组（方案 §3.5 的「拆分」那一行）──
 *
 * `canvas.write` 今天是**一个** 9 分支的工具，真实成功率 0/18。#547 的数据说，出问题的
 * 从来不是「工具多」，是「一个工具里塞 9 个分支」——所有单分支扁平 schema 的工具都是 100%。
 *
 * 但分组本身不是解药：拆成 3 个工具后每个仍然是根级 `anyOf`，而 Anthropic 的适配器会把
 * 根级 `anyOf` 静默丢掉、Google 的 legacy 路径不支持它（G-01）。所以两刀要一起下：
 *   ① 这里按**语义**分成三组（模型选工具时的那一次判断变简单，且每组 ≤4 支）；
 *   ② `flatModelInput.ts` 把每一组**扁平化**成一个根是 object 的 schema（模型真的看得见）。
 * 少任何一刀，0/18 都还在。
 *
 * 分组依据是「用户在做哪件事」，不是「代码住在哪」：改画布上的节点和连线 / 排一份分镜 /
 * 给某一镜挂一张站位或运镜参考。三件事在产品里是三个不同的时刻。
 *
 * 全量 union 由三组拼出来，**不另抄一份名单**——加一个 operation 只需要放进它属于的那一组，
 * `CANVAS_WRITE_OPERATIONS` 与模型可见工具面会同时跟上。
 */
export const canvasNodeWriteInputUnion = z.discriminatedUnion("operation", [
  setNodePromptInputSchema,
  createCanvasNodesInputSchema,
  connectCanvasEdgesInputSchema,
  tidyCanvasInputSchema,
]);

export const storyboardWriteInputUnion = z.discriminatedUnion("operation", [
  storyboardPlanActionInputSchema,
  storyboardPatchShotsInputSchema,
  arrangeStoryboardActionInputSchema,
]);

export const shotReferenceWriteInputUnion = z.discriminatedUnion("operation", [
  stagingReferenceActionInputSchema,
  cameraMoveActionInputSchema,
]);

const canvasWriteSemanticInputUnion = z.discriminatedUnion("operation", [
  ...canvasNodeWriteInputUnion.options,
  ...storyboardWriteInputUnion.options,
  ...shotReferenceWriteInputUnion.options,
]);

/**
 * 跨字段约束的**唯一 owner**。它挂在全量 union 上，也挂在三个语义分组上——因为 lane 发布给
 * 模型的是分组（`laneCanvasTools.ts`），而分组是从 `.options` 拼出来的裸 union，**不会继承**
 * 外层的 `superRefine`。2026-09-07 合并评审实核：`nomi_canvas_write` 对
 * `{operation:"connect_canvas_edges", edges:[]}` 一路绿到领域端口，就是这条没跟上去。
 * 一份函数三处挂，加一条约束只改这里。
 */
export function canvasWriteCrossFieldRefine(
  // 形状故意松：lane 侧重建的分组是 `as OperationBranch` 拼出来的，输出类型只剩
  // `{ operation?: unknown }`。约束按值判，不按类型判——三处挂点收到的都是已过形状校验的对象。
  value: { operation?: unknown; edges?: unknown; characters?: unknown; customBlocking?: unknown; move?: unknown; customMove?: unknown },
  context: z.RefinementCtx,
): void {
  // 从 `connectCanvasEdgesInputSchema` 下沉到这里，好让 `edges` 在两支上是同一个形状
  // （模型可见 schema 才扁平得起来）。语义一个字没变：connect 仍然至少要一条边。
  if (value.operation === "connect_canvas_edges" && (!Array.isArray(value.edges) || value.edges.length === 0)) {
    context.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: 1,
      type: "array",
      inclusive: true,
      path: ["edges"],
      message: "connect_canvas_edges needs at least one edge",
    });
  }
  if (
    value.operation === "create_staging_reference"
    && (!Array.isArray(value.characters) || value.characters.length === 0)
    && !value.customBlocking
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "characters or customBlocking is required" });
  }
  if (value.operation === "create_camera_move" && !value.move && !value.customMove) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "move or customMove is required" });
  }
}

export const canvasWriteSemanticInputSchema = canvasWriteSemanticInputUnion.superRefine(canvasWriteCrossFieldRefine);

/** 三个语义分组，**带**跨字段约束的版本。lane 扁平化的是这三份，不是裸 union。 */
export const canvasNodeWriteInputSchema = canvasNodeWriteInputUnion.superRefine(canvasWriteCrossFieldRefine);
export const storyboardWriteInputSchema = storyboardWriteInputUnion.superRefine(canvasWriteCrossFieldRefine);
export const shotReferenceWriteInputSchema = shotReferenceWriteInputUnion.superRefine(canvasWriteCrossFieldRefine);

/** Pi derives the operation from the Registry alias; callers provide only semantic arguments. */
export const canvasWritePiInputSchema = z
  .object({
    nodeId: canonicalIdSchema,
    prompt: nonBlankPromptSchema,
  })
  .strict();
const createCanvasNodesPiInputSchema = createCanvasNodesInputSchema.omit({ operation: true });
const connectCanvasEdgesPiInputSchema = connectCanvasEdgesInputSchema
  .omit({ operation: true })
  .superRefine((value, context) => {
    if (value.edges.length > 0) return;
    context.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: 1,
      type: "array",
      inclusive: true,
      path: ["edges"],
      message: "connect_canvas_edges needs at least one edge",
    });
  });
const tidyCanvasPiInputSchema = tidyCanvasInputSchema.omit({ operation: true });
const storyboardPlanActionPiInputSchema = storyboardPlanActionInputSchema.omit({ operation: true });
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

/**
 * 全部合法 canvas.write operation —— **派生自上面这个 union 的分支**，不另抄一份名单。
 * 用途：给调用方在拒绝时列出「合法动作有哪些」（MCP 规范要求模型能自纠），以及让传输层
 * 按「主进程能落账 / 需要创作区」分档。手抄一份名单就是第二个真相源，新增 operation 时必漂移。
 */
export const CANVAS_WRITE_OPERATIONS: readonly CanvasWriteOperation[] = Object.freeze(
  canvasWriteSemanticInputUnion.options.map((option) => option.shape.operation.value as CanvasWriteOperation),
);

/**
 * Storyboard writes are semantically canvas capabilities but their durable
 * owner is the renderer's creation/storyboard store.  Keep this predicate at
 * the capability boundary so Host proposal registration and turn execution
 * agree on the same canonical operation set.
 */
export function isRendererOwnedStoryboardProposal(toolName: string, args: unknown): boolean {
  const operation = canvasWriteOperationForAlias(toolName)
    ?? (toolName === "nomi_canvas_plan" && args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>).operation : undefined);
  return typeof operation === "string" && Object.prototype.hasOwnProperty.call(CANVAS_WRITE_CAPABILITY.operationPlanReview, operation);
}

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
      changedShotIndexes: z.array(z.number().int().min(1)).max(24),
      changedFields: z.array(z.string().trim().min(1)).max(8),
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
  if (alias === CANVAS_WRITE_OPERATION_ALIASES.arrangeStoryboardToTimeline) return "arrange_storyboard_to_timeline";
  if (alias === CANVAS_WRITE_OPERATION_ALIASES.createStagingReference) return "create_staging_reference";
  if (alias === CANVAS_WRITE_OPERATION_ALIASES.createCameraMove) return "create_camera_move";
  return undefined;
}

export const CANVAS_WRITE_CAPABILITY = {
  id: "canvas.write",
  version: 1,
  // `pi` surface 上只放模型可见的三个动词（`verbs/canvasVerbs.ts`）；operation 值不是别名，
  // 它们是 schema 里的枚举（`CANVAS_WRITE_OPERATIONS`）。
  aliases: {
    pi: "nomi_canvas_write",
    mcp: "nomi_canvas_edit",
    ui: "nomi_canvas_plan",
  },
  additionalAliases: {
    pi: Object.freeze(["nomi_storyboard_write", "nomi_shot_reference_write"]),
  },
  inputSchema: canvasWriteSemanticInputSchema,
  outputSchema: canvasWriteResultSchema,
  effect: "reversible_write",
  effectClass: "reversible_local",
  operationEffectClasses: Object.freeze({
    create_canvas_nodes: "reversible_local",
    connect_canvas_edges: "reversible_local",
    tidy_canvas: "reversible_local",
    propose_storyboard_plan: "reversible_local",
    patch_shots: "reversible_local",
    arrange_storyboard_to_timeline: "reversible_local",
    create_staging_reference: "reversible_local",
    create_camera_move: "reversible_local",
    set_node_prompt: "reversible_local",
  }),
  operationPlanReview: Object.freeze({
    propose_storyboard_plan: Object.freeze({ allowReuse: false }),
    patch_shots: Object.freeze({ allowReuse: false }),
  }),
  execution: {
    port: "canvas",
    availability: "renderer_required",
  },
  exposure: "mcp_safe",
  requiredScope: "canvas:write",
  targetKind: "canvas",
} as const satisfies CapabilityContract<CanvasWriteInput, CanvasWriteResult>;

/** Node-authoring workflow, published once per active tool instead of in every node field. */
export const CANVAS_NODE_PROMPT_GUIDELINES = Object.freeze(["High-quality generation prompt, in the SAME language as the user (Chinese user → Chinese prompt). Write it as a STRUCTURED skeleton, not a run-on sentence:\n- character/scene reference card: stable appearance/environment description + unified style keywords (neutral full-body pose for a character, empty wide establishing shot for a scene; no plot action).\n- image / keyframe shot: scene·time·light → subject·action·expression → shot language (wide / close-up / low-angle…) → style keywords.\n- video shot: camera move (push / pull / pan / track…) → on-screen action progression → rhythm & duration feel; do NOT restate the static keyframe description.\nKeep the same subject's appearance description consistent across shots. agent-artifact nodes carry no prompt: send an empty string."]);
