import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { CapabilityContract } from "../shared/agentCapabilities/capabilityContract";
import { CANVAS_READ_CAPABILITY } from "../shared/agentCapabilities/canvasRead";
import { CANVAS_WRITE_CAPABILITY, canvasWriteSemanticInputSchema, canvasWriteResultSchema } from "../shared/agentCapabilities/canvasWrite";
import { CANVAS_DELETE_CAPABILITY, canvasDeleteSemanticInputSchema, canvasDeleteResultSchema } from "../shared/agentCapabilities/canvasDelete";
import { DOCUMENT_READ_CAPABILITY, documentReadSemanticInputSchema, documentReadResultSchema } from "../shared/agentCapabilities/documentRead";
import { DOCUMENT_WRITE_CAPABILITY, documentWriteSemanticInputSchema, documentWriteResultSchema } from "../shared/agentCapabilities/documentWrite";
import { ASSET_READ_CAPABILITY } from "../shared/agentCapabilities/assetRead";
import { EXPORT_READ_CAPABILITY } from "../shared/agentCapabilities/exportCapabilities";
import { TIMELINE_READ_CAPABILITY, timelineEditPlanSchema } from "../shared/agentCapabilities/timelineRead";
import { TIMELINE_WRITE_CAPABILITY } from "../shared/agentCapabilities/timelineWrite";
import { LAYOUT_READ_CAPABILITY, LAYOUT_WRITE_CAPABILITY, layoutReadInputSchema, layoutWriteInputSchema, layoutWriteTransportInputSchema, layoutResultSchema } from "../shared/agentCapabilities/layout";
import { findUnsupportedSchemaFeatures, type SchemaLike } from "./mcpArgValidation";
import { transportSchemaFromZod } from "./mcpTransportSchemaFromZod";
import { buildCanonicalMcpToolResult, type CanonicalMcpToolResult } from "./mcpCanonicalToolResult";
import { emitMcpToolCatalogChanged } from "./mcpToolCatalogChanges";

type AnyCapabilityContract = CapabilityContract<unknown, unknown>;
const convertZodToJsonSchema = zodToJsonSchema as unknown as (
  schema: unknown,
  options: {
    $refStrategy: "none";
    target: "openApi3";
    effectStrategy: "input";
    removeAdditionalStrategy: "strict";
  },
) => unknown;

export type McpCapabilityAuthority = {
  readonly kind: "project_session";
  readonly requiredScope: string;
};

export type McpCapabilityPortBinding = {
  readonly kind: AnyCapabilityContract["execution"]["port"];
  readonly access: "read" | "write" | "paid";
};

export type McpCapabilityCall = {
  readonly semanticInput: unknown;
  readonly transport: Record<string, unknown>;
};

/**
 * Explicit adapter registration. Contracts never become MCP tools merely by appearing in the
 * shared contract registry: the transport must bind a concrete authority mode, port access,
 * wire schema, and call projection here. The resolver owns safe-result presentation and derives
 * it only from the canonical contract output schema.
 */
export type McpCapabilityAdapter = {
  readonly contract: AnyCapabilityContract;
  readonly authority: McpCapabilityAuthority;
  readonly port: McpCapabilityPortBinding;
  readonly semanticInputJsonSchema: SchemaLike;
  readonly transportInputSchema: SchemaLike;
  readonly parseCall: (args: Record<string, unknown>) => McpCapabilityCall;
  /** Composite semantic tools can return a read/approval projection rather than one legacy output union. */
  readonly outputSchema?: ZodTypeAny;
  /** A capability may have one semantic MCP intent per safe operation. */
  readonly mcpName?: string;
};

export type McpCapabilityTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: SchemaLike;
  readonly method: string;
  readonly build: (args: Record<string, unknown>) => Record<string, unknown>;
  readonly presentResult: (result: unknown) => CanonicalMcpToolResult;
  readonly annotations?: { readonly readOnlyHint?: true; readonly destructiveHint?: true };
};

export type McpCapabilityResolver = {
  readonly list: () => readonly McpCapabilityTool[];
  readonly resolve: (alias: string) => McpCapabilityTool | undefined;
};

function jsonSchemaFromCanonicalInput(contract: AnyCapabilityContract): SchemaLike {
  const schema = JSON.parse(
    JSON.stringify(
      convertZodToJsonSchema(contract.inputSchema, {
        $refStrategy: "none",
        target: "openApi3",
        effectStrategy: "input",
        removeAdditionalStrategy: "strict",
      }),
    ),
  ) as SchemaLike;
  const unsupported = findUnsupportedSchemaFeatures(schema);
  if (unsupported.length) {
    throw new Error(`Unsupported canonical MCP input schema for ${contract.id}: ${unsupported.join("; ")}`);
  }
  return schema;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

/** Clone transport JSON before freezing so registration callers cannot mutate the resolver later. */
export function immutableSchemaSnapshot(schema: SchemaLike): SchemaLike {
  return deepFreeze(JSON.parse(JSON.stringify(schema)) as SchemaLike);
}

function isMcpExposable(adapter: McpCapabilityAdapter): boolean {
  if (!adapter.contract.aliases.mcp || !adapter.contract.projections.mcp) return false;
  if (adapter.contract.exposure === "internal_only") return false;
  // Generic self-asserted mcp_safe registrations remain hidden. The exact
  // module-owned adapter identity is the registration brand.
  return Object.isFrozen(adapter) && MCP_SAFE_ADAPTERS.has(adapter);
}

function readOnlyAnnotations(adapter: McpCapabilityAdapter): McpCapabilityTool["annotations"] {
  if (adapter.contract.effect === "destructive") return Object.freeze({ destructiveHint: true as const });
  return MCP_READ_ONLY_ADAPTERS.has(adapter) &&
    adapter.contract.effect === "read" &&
    adapter.port.access === "read" &&
    adapter.port.kind === adapter.contract.execution.port
    ? Object.freeze({ readOnlyHint: true as const })
    : undefined;
}

const leaseField = { leaseHandle: z.string().trim().min(1), projectId: z.string().trim().min(1).optional() };
const timelineReadMcpInput = z.discriminatedUnion("operation", [
  z.object({ ...leaseField, operation: z.literal("read") }).strict(),
  z.object({ ...leaseField, operation: z.literal("range"), startFrame: z.number().int().safe().nonnegative(), endFrame: z.number().int().safe().positive() }).strict(),
]).refine((v) => v.operation !== "range" || v.endFrame > v.startFrame, "endFrame must be greater than startFrame");
// plan 直接用 timelineEditPlanSchema（不是 `z.object({}).passthrough()` 再在 parseCall 里二次 parse）：
// 二次 parse 让 Zod 的错误路径相对于 plan（报 `planId` 而不是 `plan.planId`），宿主看不出该往哪儿填；
// 而传输层把 plan 广播成一个不透明对象，planId/baseRevision/summary/operations 四个必填在 tools/list 上
// 一个字都看不见 —— preview/apply 因此结构性不可构造（check:mcp-operation-constructible 现在会红）。
const timelineEditMcpInput = z.discriminatedUnion("operation", [
  z.object({ ...leaseField, operation: z.literal("preview"), plan: timelineEditPlanSchema }).strict(),
  z.object({ ...leaseField, operation: z.literal("apply"), plan: timelineEditPlanSchema }).strict(),
  z.object({ ...leaseField, operation: z.literal("undo"), undoToken: z.string().trim().min(1), expectedRevision: z.string().trim().min(1), reason: z.string().trim().max(300).optional() }).strict(),
]);
const exportJobMcpInput = z.object({ ...leaseField, operation: z.enum(["status", "verify"]), jobId: z.string().trim().min(1) }).strict();
const mediaQueryMcpInput = z.object({
  ...leaseField,
  operation: z.enum(["list", "get", "inspect", "search", "source_range", "waveform"]),
  assetId: z.string().trim().min(1).optional(), query: z.string().trim().max(200).optional(),
  kinds: z.array(z.enum(["image", "video", "audio"])).max(3).optional(), limit: z.number().int().min(1).max(100).optional(),
  startFrame: z.number().int().safe().nonnegative().optional(), endFrame: z.number().int().safe().positive().optional(),
  startSeconds: z.number().finite().nonnegative().optional(), endSeconds: z.number().finite().positive().optional(), buckets: z.number().int().min(1).max(256).optional(),
}).strict();

// Keep the broadcast schema in the small validator subset. The Zod schemas
// above remain the execution boundary; this projection intentionally avoids
// anyOf/exclusiveMinimum, which the shared MCP validator does not implement.
const timelineReadTransportSchema = immutableSchemaSnapshot({
  type: "object", properties: { leaseHandle: { type: "string", minLength: 1 }, projectId: { type: "string", minLength: 1 }, operation: { type: "string", enum: ["read", "range"] }, startFrame: { type: "integer", minimum: 0 }, endFrame: { type: "integer", minimum: 1 } },
  required: ["leaseHandle", "operation"], additionalProperties: false,
});
// Keep the broadcast schema compact while the Zod schema above remains the
// strict execution boundary. This makes all valid operation kinds discoverable
// without repeating every branch's conditional requirements in tools/list.
const timelineEditTransportSchema = immutableSchemaSnapshot({
  type: "object",
  properties: {
    leaseHandle: { type: "string" }, projectId: { type: "string" },
    operation: { type: "string", enum: ["preview", "apply", "undo"] },
    plan: {
      type: "object", additionalProperties: false,
      properties: {
        planId: { type: "string" }, baseRevision: { type: "string" }, summary: { type: "string" },
        operations: { type: "array", minItems: 1, maxItems: 128, items: {
          type: "object", additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["move", "remove", "split", "trim", "source-window", "ripple", "transition", "text", "clip-audio"] },
            action: { type: "string", enum: ["set", "remove", "add", "edit", "style", "time"] },
            clipId: { type: "string" }, clipIds: { type: "array", items: { type: "string" } },
            fromClipId: { type: "string" }, toClipId: { type: "string" }, targetTrackId: { type: "string" }, trackId: { type: "string" },
            startFrame: { type: "integer", minimum: 0 }, endFrame: { type: "integer", minimum: 0 }, atFrame: { type: "integer", minimum: 0 }, deltaFrame: { type: "integer" },
            sourceStartFrame: { type: "integer", minimum: 0 }, sourceEndFrame: { type: "integer", minimum: 0 }, rightClipId: { type: "string", minLength: 1 },
            type: { type: "string", enum: ["cut", "dissolve", "fade", "match_cut", "whip_pan"] }, durationFrames: { type: "integer", minimum: 1 },
            id: { type: "string" }, sourceNodeId: { type: "string" }, text: { type: "string" }, style: { type: "string", enum: ["caption", "title"] },
            audio: { type: "object", additionalProperties: false, properties: { gainDb: { type: "number" }, muted: { type: "boolean" }, fadeInFrames: { type: "integer", minimum: 0 }, fadeOutFrames: { type: "integer", minimum: 0 } } },
            ripple: { type: "boolean" }, includeText: { type: "boolean" },
          },
        } },
      },
      required: ["planId", "baseRevision", "summary", "operations"],
    },
    undoToken: { type: "string" }, expectedRevision: { type: "string" }, reason: { type: "string" },
  },
  required: ["leaseHandle", "operation"], additionalProperties: false,
});
const exportJobTransportSchema = immutableSchemaSnapshot({
  type: "object", properties: { leaseHandle: { type: "string", minLength: 1 }, projectId: { type: "string", minLength: 1 }, operation: { type: "string", enum: ["status", "verify"] }, jobId: { type: "string", minLength: 1 } },
  required: ["leaseHandle", "operation", "jobId"], additionalProperties: false,
});
const mediaQueryTransportSchema = immutableSchemaSnapshot({
  type: "object", properties: { leaseHandle: { type: "string", minLength: 1 }, projectId: { type: "string", minLength: 1 }, operation: { type: "string", enum: ["list", "get", "inspect", "search", "source_range", "waveform"] }, assetId: { type: "string", minLength: 1 }, query: { type: "string", maxLength: 200 }, kinds: { type: "array", maxItems: 3, items: { type: "string", enum: ["image", "video", "audio"] } }, limit: { type: "integer", minimum: 1, maximum: 100 }, startFrame: { type: "integer", minimum: 0 }, endFrame: { type: "integer", minimum: 1 }, startSeconds: { type: "number", minimum: 0 }, endSeconds: { type: "number", minimum: 0 }, buckets: { type: "integer", minimum: 1, maximum: 256 } },
  required: ["leaseHandle", "operation"], additionalProperties: false,
});

export const TIMELINE_READ_MCP_ADAPTER: McpCapabilityAdapter = Object.freeze({
  contract: TIMELINE_READ_CAPABILITY,
  authority: Object.freeze({ kind: "project_session", requiredScope: "timeline:read" }),
  port: Object.freeze({ kind: "timeline", access: "read" }),
  semanticInputJsonSchema: timelineReadTransportSchema,
  transportInputSchema: timelineReadTransportSchema,
  outputSchema: z.unknown(),
  parseCall(args) {
    const input = timelineReadMcpInput.parse(args);
    return { semanticInput: input.operation === "read" ? { operation: "read_timeline" } : { operation: "inspect_timeline_range", startFrame: input.startFrame, endFrame: input.endFrame }, transport: input };
  },
});

export const TIMELINE_EDIT_MCP_ADAPTER: McpCapabilityAdapter = Object.freeze({
  contract: TIMELINE_WRITE_CAPABILITY,
  authority: Object.freeze({ kind: "project_session", requiredScope: "timeline:write" }),
  port: Object.freeze({ kind: "timeline", access: "write" }),
  semanticInputJsonSchema: timelineEditTransportSchema,
  transportInputSchema: timelineEditTransportSchema,
  outputSchema: z.unknown(),
  parseCall(args) {
    const input = timelineEditMcpInput.parse(args);
    const { leaseHandle, projectId, operation } = input;
    if (operation === "preview" || operation === "apply") {
      const plan = input.plan;
      return {
        semanticInput: { operation: operation === "preview" ? "propose_edit_plan" : "apply_edit_plan", ...plan },
        transport: { leaseHandle, ...(projectId ? { projectId } : {}), operation, plan },
      };
    }
    return {
      semanticInput: { operation: "undo_timeline_edit", undoToken: input.undoToken, expectedRevision: input.expectedRevision, ...(input.reason ? { reason: input.reason } : {}) },
      transport: input,
    };
  },
});

export const EXPORT_JOB_MCP_ADAPTER: McpCapabilityAdapter = Object.freeze({
  contract: EXPORT_READ_CAPABILITY,
  authority: Object.freeze({ kind: "project_session", requiredScope: "export:read" }),
  port: Object.freeze({ kind: "export", access: "read" }),
  semanticInputJsonSchema: exportJobTransportSchema,
  transportInputSchema: exportJobTransportSchema,
  outputSchema: z.unknown(),
  parseCall(args) {
    const input = exportJobMcpInput.parse(args);
    return { semanticInput: { operation: input.operation === "status" ? "inspect_export_job" : "verify_render", jobId: input.jobId }, transport: input };
  },
});

export const MEDIA_QUERY_MCP_ADAPTER: McpCapabilityAdapter = Object.freeze({
  contract: ASSET_READ_CAPABILITY,
  authority: Object.freeze({ kind: "project_session", requiredScope: "asset:read" }),
  port: Object.freeze({ kind: "asset", access: "read" }),
  semanticInputJsonSchema: mediaQueryTransportSchema,
  transportInputSchema: mediaQueryTransportSchema,
  outputSchema: z.unknown(),
  parseCall(args) {
    const input = mediaQueryMcpInput.parse(args);
    const { leaseHandle, projectId, operation, ...rest } = input;
    const semanticOperation = operation === "list" ? "search_media" : operation === "get" ? "get_media" : operation === "inspect" ? "inspect_media" : operation === "source_range" ? "inspect_source_range" : operation === "waveform" ? "read_waveform" : "search_media";
    const semanticInput = { operation: semanticOperation, ...rest, ...(operation === "list" && !rest.query ? { query: "" } : {}) };
    return { semanticInput, transport: { leaseHandle, ...(projectId ? { projectId } : {}), operation, ...rest } };
  },
});

const layoutReadTransportSchema = immutableSchemaSnapshot({ type: "object", properties: { leaseHandle: { type: "string", minLength: 1 }, projectId: { type: "string", minLength: 1 }, operation: { type: "string", enum: ["read"] } }, required: ["leaseHandle", "operation"], additionalProperties: false });
const layoutWriteTransportSchema = immutableSchemaSnapshot(transportSchemaFromZod(layoutWriteTransportInputSchema, {
  label: "layout.write",
  extraProperties: {
    leaseHandle: { type: "string", minLength: 1 },
    projectId: { type: "string", minLength: 1 },
  },
  required: ["leaseHandle", "operation", "layout"],
}));
export const LAYOUT_READ_MCP_ADAPTER: McpCapabilityAdapter = Object.freeze({
  contract: LAYOUT_READ_CAPABILITY, authority: Object.freeze({ kind: "project_session", requiredScope: "layout:read" }), port: Object.freeze({ kind: "document", access: "read" }), semanticInputJsonSchema: layoutReadTransportSchema, transportInputSchema: layoutReadTransportSchema, outputSchema: layoutResultSchema,
  parseCall(args) { const input = z.object({ ...leaseField, operation: z.literal("read") }).strict().parse(args); return { semanticInput: layoutReadInputSchema.parse({ operation: "read_layout" }), transport: input }; },
});
export const LAYOUT_WRITE_MCP_ADAPTER: McpCapabilityAdapter = Object.freeze({
  contract: LAYOUT_WRITE_CAPABILITY, authority: Object.freeze({ kind: "project_session", requiredScope: "layout:write" }), port: Object.freeze({ kind: "document", access: "write" }), semanticInputJsonSchema: layoutWriteTransportSchema, transportInputSchema: layoutWriteTransportSchema, outputSchema: layoutResultSchema,
  parseCall(args) { const input = z.object({ ...leaseField, ...layoutWriteTransportInputSchema.shape }).strict().parse(args); const semantic = layoutWriteInputSchema.parse({ operation: "write_layout", layout: input.layout }); return { semanticInput: semantic, transport: input }; },
});

export const MCP_EDITING_METHODS = Object.freeze(new Set([
  TIMELINE_READ_CAPABILITY.id,
  TIMELINE_WRITE_CAPABILITY.id,
  DOCUMENT_WRITE_CAPABILITY.id,
  EXPORT_READ_CAPABILITY.id,
  ASSET_READ_CAPABILITY.id,
  LAYOUT_READ_CAPABILITY.id,
  LAYOUT_WRITE_CAPABILITY.id,
]));

export function isMcpEditingMethod(method: string): boolean {
  return MCP_EDITING_METHODS.has(method as typeof TIMELINE_READ_CAPABILITY.id);
}

export function createMcpCapabilityResolver(registrations: readonly McpCapabilityAdapter[]): McpCapabilityResolver {
  const tools = Object.freeze(
    registrations.filter(isMcpExposable).map((adapter): McpCapabilityTool => {
      const name = adapter.mcpName ?? adapter.contract.aliases.mcp;
      const description = adapter.contract.projections.mcp?.description;
      if (!name || !description) throw new Error(`Missing MCP projection metadata for ${adapter.contract.id}`);
      const annotations = readOnlyAnnotations(adapter);
      const inputSchema = immutableSchemaSnapshot(adapter.transportInputSchema);
      const method = adapter.contract.id;
      const parseCall = adapter.parseCall;
      const outputSchema = adapter.outputSchema ?? adapter.contract.outputSchema;
      return Object.freeze({
        name,
        description,
        inputSchema,
        method,
        build: (args) => parseCall(args).transport,
        presentResult: (result) => buildCanonicalMcpToolResult(outputSchema, result),
        ...(annotations ? { annotations } : {}),
      });
    }),
  );
  const byAlias = new Map<string, McpCapabilityTool>();
  for (const tool of tools) {
    if (byAlias.has(tool.name)) throw new Error(`Duplicate explicit MCP capability alias: ${tool.name}`);
    byAlias.set(tool.name, tool);
  }
  const resolver = Object.freeze({
    list: () => tools,
    resolve: (alias: string) => byAlias.get(alias),
  });
  emitMcpToolCatalogChanged();
  return resolver;
}

const canvasReadSemanticInputJsonSchema = immutableSchemaSnapshot(jsonSchemaFromCanonicalInput(CANVAS_READ_CAPABILITY));
const canvasReadTransportInputSchema = z
  .object({
    leaseHandle: z.string(),
    projectId: z.string().optional(),
  })
  .strict();
const canvasReadTransportJsonSchema = immutableSchemaSnapshot({
  ...canvasReadSemanticInputJsonSchema,
  properties: {
    ...((canvasReadSemanticInputJsonSchema.properties as Record<string, unknown> | undefined) ?? {}),
    leaseHandle: { type: "string" },
    projectId: { type: "string" },
  },
  required: [
    ...(Array.isArray(canvasReadSemanticInputJsonSchema.required)
      ? canvasReadSemanticInputJsonSchema.required.filter((value): value is string => typeof value === "string")
      : []),
    "leaseHandle",
  ],
  additionalProperties: false,
});

const unsupportedCanvasReadTransportSchema = findUnsupportedSchemaFeatures(canvasReadTransportJsonSchema);
if (unsupportedCanvasReadTransportSchema.length) {
  throw new Error(`Unsupported canvas.read MCP transport schema: ${unsupportedCanvasReadTransportSchema.join("; ")}`);
}

export const CANVAS_READ_MCP_ADAPTER: McpCapabilityAdapter = Object.freeze({
  contract: CANVAS_READ_CAPABILITY,
  authority: Object.freeze({
    kind: "project_session",
    requiredScope: CANVAS_READ_CAPABILITY.requiredScope,
  }),
  port: Object.freeze({ kind: "canvas", access: "read" }),
  semanticInputJsonSchema: canvasReadSemanticInputJsonSchema,
  transportInputSchema: canvasReadTransportJsonSchema,
  parseCall(args) {
    const transport = canvasReadTransportInputSchema.parse(args);
    return {
      semanticInput: CANVAS_READ_CAPABILITY.inputSchema.parse({}),
      transport,
    };
  },
});

// canvas.write 的传输 schema **派生自** canvasWrite.ts 的 Zod union（单一真相源，见
// mcpTransportSchemaFromZod.ts 的根因说明）。此前这里是一份手抄的扁平超集，属性表缺了
// propose_storyboard_plan / create_camera_move / create_staging_reference 的必填字段，
// `additionalProperties:false` 把它们在到达 Zod 前就打掉 —— 9 个 operation 里 7 个构造不出来。
// 派生之后，Zod 里的 prompt 撰写指南与参考槽语义也一并到了 tools/list 上。
const canvasMutationTransportSchema = immutableSchemaSnapshot(
  transportSchemaFromZod(canvasWriteSemanticInputSchema, {
    label: "canvas.write",
    extraProperties: {
      leaseHandle: { type: "string", minLength: 1, description: "nomi_session_open 返回的项目租约句柄。" },
      projectId: { type: "string", minLength: 1 },
    },
    required: ["leaseHandle", "operation"],
  }),
);
const canvasMaintenanceTransportSchema = immutableSchemaSnapshot({
  type: "object",
  properties: {
    leaseHandle: { type: "string", minLength: 1 }, projectId: { type: "string", minLength: 1 },
    operation: { type: "string", enum: ["delete_canvas_nodes", "undo_canvas_delete"] },
    nodeIds: { type: "array", maxItems: 24, items: { type: "string", minLength: 1 } },
    reason: { type: "string", maxLength: 300 }, confirmation: { type: "boolean" }, undoToken: { type: "string", minLength: 1 },
  },
  required: ["leaseHandle", "operation"], additionalProperties: false,
});
const documentReadTransportSchema = immutableSchemaSnapshot({
  type: "object", properties: {
    leaseHandle: { type: "string", minLength: 1 }, projectId: { type: "string", minLength: 1 },
    documentId: { type: "string", minLength: 1 }, scope: { type: "string", enum: ["full", "selection"] },
  }, required: ["leaseHandle", "scope"], additionalProperties: false,
});
const documentWriteTransportSchema = immutableSchemaSnapshot({
  type: "object", properties: {
    leaseHandle: { type: "string", minLength: 1 }, projectId: { type: "string", minLength: 1 },
    documentId: { type: "string", minLength: 1 }, operation: { type: "string", enum: ["insert", "replace", "append"] },
    content: { type: "string", minLength: 1 },
  }, required: ["leaseHandle", "operation", "content"], additionalProperties: false,
});

// 传输层只负责剥掉租约字段；operation 分支的必填/互斥判定**只有一个边界**，就是下面的
// canvasWriteSemanticInputSchema（`.strict()` discriminated union）。此前这里还有一份手写的
// 扁平 z.object().strict()，属性表与传输 schema 各抄一遍，正是第三份真相源。
const canvasLeaseEnvelope = z.object({ ...leaseField }).passthrough();
function canvasAdapter(name: string): McpCapabilityAdapter {
  return Object.freeze({
    contract: CANVAS_WRITE_CAPABILITY,
    mcpName: name,
    authority: Object.freeze({ kind: "project_session", requiredScope: CANVAS_WRITE_CAPABILITY.requiredScope }),
    port: Object.freeze({ kind: "canvas", access: "write" }),
    semanticInputJsonSchema: canvasMutationTransportSchema,
    transportInputSchema: canvasMutationTransportSchema,
    outputSchema: canvasWriteResultSchema,
    parseCall(args) {
      const { leaseHandle, projectId, ...semantic } = canvasLeaseEnvelope.parse(args);
      const parsed = canvasWriteSemanticInputSchema.parse(semantic);
      return { semanticInput: parsed, transport: { leaseHandle, ...(projectId ? { projectId } : {}), ...semantic } };
    },
  });
}

// 画布语义写在 MCP 上**只有一个名字**：CANVAS_WRITE_CAPABILITY.aliases.mcp。
// 曾经并列的 nomi_canvas_plan 与 nomi_canvas_edit 在 tools/list 里 description / inputSchema /
// method 字节级完全相同，只有名字不同 —— 宿主没有任何依据选哪个，正是 P1 说的并行版发生在公开面上。
// 两者真正的差别（各自 allowed 一半 operation）从不对外可见，只在调用失败时以一句
// "operation is not valid for this semantic tool" 现身。合成一个之后，operation 枚举就是全部合法动作。
export const CANVAS_EDIT_MCP_ADAPTER = canvasAdapter(CANVAS_WRITE_CAPABILITY.aliases.mcp);
export const CANVAS_MAINTENANCE_MCP_ADAPTER: McpCapabilityAdapter = Object.freeze({
  contract: CANVAS_DELETE_CAPABILITY,
  authority: Object.freeze({ kind: "project_session", requiredScope: CANVAS_DELETE_CAPABILITY.requiredScope }),
  port: Object.freeze({ kind: "canvas", access: "write" }),
  semanticInputJsonSchema: canvasMaintenanceTransportSchema,
  transportInputSchema: canvasMaintenanceTransportSchema,
  outputSchema: canvasDeleteResultSchema,
  parseCall(args) {
    const input = z.object({ ...leaseField, operation: z.enum(["delete_canvas_nodes", "undo_canvas_delete"]), nodeIds: z.array(z.string().trim().min(1)).min(1).max(24).optional(), reason: z.string().trim().max(300).optional(), confirmation: z.boolean().optional(), undoToken: z.string().trim().min(1).optional() }).strict().parse(args);
    const { leaseHandle, projectId, ...transport } = input;
    const semantic = input.operation === "delete_canvas_nodes"
      ? canvasDeleteSemanticInputSchema.parse({ operation: input.operation, nodeIds: input.nodeIds, ...(input.reason ? { reason: input.reason } : {}) })
      : { operation: input.operation, undoToken: input.undoToken };
    return { semanticInput: semantic, transport: { leaseHandle, ...(projectId ? { projectId } : {}), ...transport } };
  },
});
export const DOCUMENT_READ_MCP_ADAPTER: McpCapabilityAdapter = Object.freeze({
  contract: DOCUMENT_READ_CAPABILITY,
  authority: Object.freeze({ kind: "project_session", requiredScope: DOCUMENT_READ_CAPABILITY.requiredScope }),
  port: Object.freeze({ kind: "document", access: "read" }),
  semanticInputJsonSchema: immutableSchemaSnapshot({ type: "object", properties: { scope: { type: "string", enum: ["full", "selection"] } }, required: ["scope"], additionalProperties: false }),
  transportInputSchema: documentReadTransportSchema,
  outputSchema: documentReadResultSchema,
  parseCall(args) {
    const input = z.object({ ...leaseField, documentId: z.string().trim().min(1).optional(), scope: z.enum(["full", "selection"]) }).strict().parse(args);
    const { leaseHandle, projectId, documentId, scope } = input;
    return { semanticInput: documentReadSemanticInputSchema.parse({ scope }), transport: { leaseHandle, ...(projectId ? { projectId } : {}), ...(documentId ? { documentId } : {}), scope } };
  },
});
export const DOCUMENT_EDIT_MCP_ADAPTER: McpCapabilityAdapter = Object.freeze({
  contract: DOCUMENT_WRITE_CAPABILITY,
  authority: Object.freeze({ kind: "project_session", requiredScope: DOCUMENT_WRITE_CAPABILITY.requiredScope }),
  port: Object.freeze({ kind: "document", access: "write" }),
  semanticInputJsonSchema: immutableSchemaSnapshot({ type: "object", properties: { operation: { type: "string", enum: ["insert", "replace", "append"] }, content: { type: "string", minLength: 1 } }, required: ["operation", "content"], additionalProperties: false }),
  transportInputSchema: documentWriteTransportSchema,
  outputSchema: documentWriteResultSchema,
  parseCall(args) {
    const input = z.object({ ...leaseField, documentId: z.string().trim().min(1).optional(), operation: z.enum(["insert", "replace", "append"]), content: z.string().min(1) }).strict().parse(args);
    const { leaseHandle, projectId, documentId, operation, content } = input;
    return { semanticInput: documentWriteSemanticInputSchema.parse({ operation, content }), transport: { leaseHandle, ...(projectId ? { projectId } : {}), ...(documentId ? { documentId } : {}), operation, content } };
  },
});

const MCP_SAFE_ADAPTERS = new Set<McpCapabilityAdapter>([
  CANVAS_READ_MCP_ADAPTER, CANVAS_EDIT_MCP_ADAPTER, CANVAS_MAINTENANCE_MCP_ADAPTER,
  DOCUMENT_READ_MCP_ADAPTER, DOCUMENT_EDIT_MCP_ADAPTER, TIMELINE_READ_MCP_ADAPTER, TIMELINE_EDIT_MCP_ADAPTER, EXPORT_JOB_MCP_ADAPTER, MEDIA_QUERY_MCP_ADAPTER,
  LAYOUT_READ_MCP_ADAPTER, LAYOUT_WRITE_MCP_ADAPTER,
]);
const MCP_READ_ONLY_ADAPTERS = new Set<McpCapabilityAdapter>([
  CANVAS_READ_MCP_ADAPTER, TIMELINE_READ_MCP_ADAPTER, EXPORT_JOB_MCP_ADAPTER, MEDIA_QUERY_MCP_ADAPTER,
]);

// Deliberately explicit: do not map CAPABILITY_CONTRACTS, Skills, manifests, or plugin metadata.
export const MCP_CAPABILITY_RESOLVER = createMcpCapabilityResolver([
  CANVAS_READ_MCP_ADAPTER,
  CANVAS_EDIT_MCP_ADAPTER,
  CANVAS_MAINTENANCE_MCP_ADAPTER,
  DOCUMENT_READ_MCP_ADAPTER,
  DOCUMENT_EDIT_MCP_ADAPTER,
  TIMELINE_READ_MCP_ADAPTER,
  TIMELINE_EDIT_MCP_ADAPTER,
  EXPORT_JOB_MCP_ADAPTER,
  MEDIA_QUERY_MCP_ADAPTER,
  LAYOUT_READ_MCP_ADAPTER,
  LAYOUT_WRITE_MCP_ADAPTER,
]);
