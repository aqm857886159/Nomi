import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { CapabilityContract } from "../shared/agentCapabilities/capabilityContract";
import { CANVAS_READ_CAPABILITY } from "../shared/agentCapabilities/canvasRead";
import { findUnsupportedSchemaFeatures, type SchemaLike } from "./mcpArgValidation";
import { buildCanonicalMcpToolResult, type CanonicalMcpToolResult } from "./mcpCanonicalToolResult";

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
  readonly requiredScope: typeof CANVAS_READ_CAPABILITY.requiredScope;
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
  // module-owned adapter identity is the unforgeable registration brand.
  return (
    adapter === CANVAS_READ_MCP_ADAPTER &&
    Object.isFrozen(adapter) &&
    adapter.contract === CANVAS_READ_CAPABILITY &&
    adapter.contract.exposure === "mcp_safe" &&
    adapter.authority.kind === "project_session" &&
    adapter.authority.requiredScope === CANVAS_READ_CAPABILITY.requiredScope
  );
}

function readOnlyAnnotations(adapter: McpCapabilityAdapter): McpCapabilityTool["annotations"] {
  return adapter === CANVAS_READ_MCP_ADAPTER &&
    adapter.contract === CANVAS_READ_CAPABILITY &&
    adapter.contract.effect === "read" &&
    adapter.port.access === "read" &&
    adapter.port.kind === adapter.contract.execution.port
    ? Object.freeze({ readOnlyHint: true as const })
    : undefined;
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
      const outputSchema = adapter.contract.outputSchema;
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
  return Object.freeze({
    list: () => tools,
    resolve: (alias) => byAlias.get(alias),
  });
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

// Deliberately explicit: do not map CAPABILITY_CONTRACTS, Skills, manifests, or plugin metadata.
export const MCP_CAPABILITY_RESOLVER = createMcpCapabilityResolver([CANVAS_READ_MCP_ADAPTER]);
