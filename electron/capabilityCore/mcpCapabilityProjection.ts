import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { CapabilityContract } from "../shared/agentCapabilities/capabilityContract";
import { CANVAS_READ_CAPABILITY } from "../shared/agentCapabilities/canvasRead";
import { ASSET_READ_CAPABILITY } from "../shared/agentCapabilities/assetRead";
import { EXPORT_READ_CAPABILITY } from "../shared/agentCapabilities/exportCapabilities";
import { TIMELINE_READ_CAPABILITY, timelineEditPlanSchema } from "../shared/agentCapabilities/timelineRead";
import { TIMELINE_WRITE_CAPABILITY } from "../shared/agentCapabilities/timelineWrite";
import { findUnsupportedSchemaFeatures, type SchemaLike } from "./mcpArgValidation";
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
};

export type McpCapabilityTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: SchemaLike;
  readonly method: string;
  readonly build: (args: Record<string, unknown>) => Record<string, unknown>;
  readonly presentResult: (result: unknown) => CanonicalMcpToolResult;
  readonly annotations?: { readonly readOnlyHint: true };
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
const timelineEditMcpInput = z.discriminatedUnion("operation", [
  z.object({ ...leaseField, operation: z.literal("preview"), plan: z.object({}).passthrough() }).strict(),
  z.object({ ...leaseField, operation: z.literal("apply"), plan: z.object({}).passthrough() }).strict(),
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
const timelineEditTransportSchema = immutableSchemaSnapshot({
  type: "object", properties: { leaseHandle: { type: "string", minLength: 1 }, projectId: { type: "string", minLength: 1 }, operation: { type: "string", enum: ["preview", "apply", "undo"] }, plan: { type: "object", additionalProperties: true }, undoToken: { type: "string", minLength: 1 }, expectedRevision: { type: "string", minLength: 1 }, reason: { type: "string", maxLength: 300 } },
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
      const plan = timelineEditPlanSchema.parse(input.plan);
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

export const MCP_EDITING_METHODS = Object.freeze(new Set([
  TIMELINE_READ_CAPABILITY.id,
  TIMELINE_WRITE_CAPABILITY.id,
  EXPORT_READ_CAPABILITY.id,
  ASSET_READ_CAPABILITY.id,
]));

export function isMcpEditingMethod(method: string): boolean {
  return MCP_EDITING_METHODS.has(method as typeof TIMELINE_READ_CAPABILITY.id);
}

export function createMcpCapabilityResolver(registrations: readonly McpCapabilityAdapter[]): McpCapabilityResolver {
  const tools = Object.freeze(
    registrations.filter(isMcpExposable).map((adapter): McpCapabilityTool => {
      const name = adapter.contract.aliases.mcp;
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

const MCP_SAFE_ADAPTERS = new Set<McpCapabilityAdapter>([
  CANVAS_READ_MCP_ADAPTER, TIMELINE_READ_MCP_ADAPTER, TIMELINE_EDIT_MCP_ADAPTER, EXPORT_JOB_MCP_ADAPTER, MEDIA_QUERY_MCP_ADAPTER,
]);
const MCP_READ_ONLY_ADAPTERS = new Set<McpCapabilityAdapter>([
  CANVAS_READ_MCP_ADAPTER, TIMELINE_READ_MCP_ADAPTER, EXPORT_JOB_MCP_ADAPTER, MEDIA_QUERY_MCP_ADAPTER,
]);

// Deliberately explicit: do not map CAPABILITY_CONTRACTS, Skills, manifests, or plugin metadata.
export const MCP_CAPABILITY_RESOLVER = createMcpCapabilityResolver([
  CANVAS_READ_MCP_ADAPTER,
  TIMELINE_READ_MCP_ADAPTER,
  TIMELINE_EDIT_MCP_ADAPTER,
  EXPORT_JOB_MCP_ADAPTER,
  MEDIA_QUERY_MCP_ADAPTER,
]);
