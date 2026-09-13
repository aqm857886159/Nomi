import { z, type ZodTypeAny } from "zod";
import { toPublishedJsonSchema } from "../shared/agentCapabilities/modelVisibleJsonSchema";

import type { CapabilityContract } from "../shared/agentCapabilities/capabilityContract";
import { CANVAS_READ_CAPABILITY } from "../shared/agentCapabilities/canvasRead";
import { CANVAS_WRITE_CAPABILITY, canvasWriteResultSchema, canvasWriteSemanticInputSchema } from "../shared/agentCapabilities/canvasWrite";
import { CANVAS_DELETE_CAPABILITY, canvasDeletePiInputSchema, canvasDeleteSemanticInputSchema, canvasDeleteResultSchema } from "../shared/agentCapabilities/canvasDelete";
import { DOCUMENT_READ_CAPABILITY, documentReadResultSchema } from "../shared/agentCapabilities/documentRead";
import { DOCUMENT_WRITE_CAPABILITY, documentWriteResultSchema } from "../shared/agentCapabilities/documentWrite";
import { ASSET_READ_CAPABILITY } from "../shared/agentCapabilities/assetRead";
import { EXPORT_READ_CAPABILITY, exportReadPiInputSchemaForAlias } from "../shared/agentCapabilities/exportCapabilities";
import { TIMELINE_READ_CAPABILITY, timelineEditPlanSchema, timelineEditPlanModelSchema } from "../shared/agentCapabilities/timelineRead";
import { TIMELINE_WRITE_CAPABILITY, timelineWritePiInputSchemaForAlias } from "../shared/agentCapabilities/timelineWrite";
import {
  MCP_LEASE_FIELD_NAMES,
  mcpToolDescription,
  mcpAnnotationsFor,
  prepareMcpArguments,
  resolveMcpSpec,
  toSemanticInput,
  type McpProfileTool,
} from "../shared/agentCapabilities/modelFacingTools";
import { mcpProfileToolFor, specsForCapability } from "../shared/agentCapabilities/modelFacingToolRegistry";
import { findUnsupportedSchemaFeatures, type SchemaLike } from "./mcpArgValidation";
import { transportSchemaFromZod } from "./mcpTransportSchemaFromZod";
import { buildCanonicalMcpToolResult, type CanonicalMcpToolResult } from "./mcpCanonicalToolResult";
import { emitMcpToolCatalogChanged } from "./mcpToolCatalogChanges";

type AnyCapabilityContract = CapabilityContract<unknown, unknown>;
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
  /**
   * `tools/list` 上真正广播出去的那份 JSON Schema。
   *
   * 阶段 5a 删掉了并列的 `semanticInputJsonSchema`：每个适配器都把它设成和这份**一模一样**的
   * 对象，除了两处测试没有任何消费者——它是一份不会被任何东西证伪的第二真相源（P1）。
   * 语义输入的形状由契约的 `inputSchema` 说了算，模型可见的那一半由共享描述符说了算。
   */
  readonly transportInputSchema: SchemaLike;
  readonly parseCall: (args: Record<string, unknown>) => McpCapabilityCall;
  /**
   * 描述符声明的容忍钩子，**在传输层校验之前**跑（`mcpProtocol.ts`）。
   *
   * 只有从共享描述符派生的适配器有它——手写适配器没有描述符可读，那正是它们还剩多少的度量。
   */
  readonly prepareArguments?: (args: unknown) => Record<string, unknown>;
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
  /** 见 `McpCapabilityAdapter.prepareArguments`。协议层在校验参数之前调用它。 */
  readonly prepareArguments?: (args: unknown) => Record<string, unknown>;
  readonly presentResult: (result: unknown) => CanonicalMcpToolResult;
  readonly annotations?: { readonly readOnlyHint?: true; readonly destructiveHint?: true };
};

export type McpCapabilityResolver = {
  readonly list: () => readonly McpCapabilityTool[];
  readonly resolve: (alias: string) => McpCapabilityTool | undefined;
};

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
  if (!adapter.contract.aliases.mcp) return false;
  if (adapter.contract.exposure === "internal_only") return false;
  // Generic self-asserted mcp_safe registrations remain hidden. The exact
  // module-owned adapter identity is the registration brand.
  return Object.isFrozen(adapter) && MCP_SAFE_ADAPTERS.has(adapter);
}

/**
 * 注解**全量派生**（方案 §3.1 第三行）。判据住 `mcpAnnotationsFor`，与内部 profile 同一处。
 *
 * 上一版是一张手写的 `MCP_READ_ONLY_ADAPTERS` 名单，只覆盖 4 个工具。手写名单的失败方向
 * 只有一个：**漏**——而漏掉 `readOnlyHint` 的后果是宿主把一次读当成可能改状态的调用，
 * 每次都去问用户；漏掉 `destructiveHint` 的后果严重得多（Codex 的硬闸靠它）。
 * MCP 规范说 hint 不可信除非来自受信服务器，所以我们只用它**抬高**摩擦，从不降低。
 */
function readOnlyAnnotations(adapter: McpCapabilityAdapter): McpCapabilityTool["annotations"] {
  return mcpAnnotationsFor(adapter.contract);
}

const leaseField = { leaseHandle: z.string().trim().min(1), projectId: z.string().trim().min(1).optional() };

// ── 从共享描述符派生一个对外适配器（方案 §3.1，阶段 5a） ──────────────────────
//
// 上一版这里的每个适配器都自己带三样东西：一份手抄的 JSON Schema、一份 zod 入参、
// 一段 `parseCall` 里的动作名映射（`"read"` → `read_timeline`）。三样都是第二份真相源，
// 而第三样是**最贵的那一份**：外部宿主读到的动作名，Nomi 自己的日志、收据、错误里
// 一个都搜不到；渲染层还得再写一遍反向映射才能把调用接回领域端口
// （`capabilityApplyHandler.ts` 曾有三处，同 commit 一起删）。
//
// 派生之后这三样都没有了：schema 由 `projectMcpTool` 从同一批说明书机械合并，
// 动作名**就是**内部别名，`parseCall` 只剩「剥租约 → 认领别名 → 契约 parse」三步。
function derivedAdapter(
  contract: AnyCapabilityContract,
  binding: Readonly<{
    authority: McpCapabilityAuthority;
    port: McpCapabilityPortBinding;
    outputSchema?: ZodTypeAny;
  }>,
): McpCapabilityAdapter {
  const tool = mcpProfileToolFor(contract.id);
  if (!tool) throw new Error(`No model-facing descriptor projects ${contract.id} to MCP`);
  const schema = immutableSchemaSnapshot(tool.inputSchema as SchemaLike);
  const unsupported = findUnsupportedSchemaFeatures(schema);
  if (unsupported.length) {
    throw new Error(`Unsupported derived MCP transport schema for ${contract.id}: ${unsupported.join("; ")}`);
  }
  return Object.freeze({
    contract,
    authority: Object.freeze(binding.authority),
    port: Object.freeze(binding.port),
    transportInputSchema: schema,
    ...(binding.outputSchema ? { outputSchema: binding.outputSchema } : {}),
    parseCall(args: Record<string, unknown>) {
      return parseDerivedCall(contract, tool, args);
    },
    prepareArguments(args: unknown) {
      return prepareMcpArguments(tool, args);
    },
  });
}

const derivedLeaseEnvelope = z.object({ ...leaseField }).passthrough();

function parseDerivedCall(
  contract: AnyCapabilityContract,
  tool: McpProfileTool,
  args: Record<string, unknown>,
): McpCapabilityCall {
  const { leaseHandle, projectId } = derivedLeaseEnvelope.parse(args);
  const spec = resolveMcpSpec(tool, args);
  if (!spec) {
    const allowed = Object.entries(tool.discriminators)
      .map(([field, values]) => `${field}: ${values.join(", ")}`)
      .join("; ");
    throw new Error(
      `${tool.name} received no recognised action${allowed ? ` (allowed — ${allowed})` : ""}. `
      + "Send one of the listed values; every other field is required by, or only meaningful to, one of them.",
    );
  }
  // 模型填的那一部分 = 入参剥掉三类**声明出来的**差异：租约、别名已经定死的判别字段、
  // 以及「外部才有」的传输寻址字段（`documentId`）。剩下的必须原样通过说明书自己的
  // strict schema——多一个字段就是模型编的，当场拒收，不静默丢掉。
  const declaredDifference = new Set([
    ...MCP_LEASE_FIELD_NAMES,
    ...Object.keys(tool.discriminators),
    ...tool.transportOnlyFields,
  ]);
  const modelArgs: Record<string, unknown> = {};
  const transportRest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (MCP_LEASE_FIELD_NAMES.includes(key)) continue;
    transportRest[key] = value;
    if (declaredDifference.has(key)) continue;
    modelArgs[key] = value;
  }
  const semanticInput = contract.inputSchema.parse(toSemanticInput(spec, spec.schema.parse(modelArgs) as Record<string, unknown>));
  return {
    semanticInput,
    transport: { leaseHandle, ...(projectId ? { projectId } : {}), ...transportRest },
  };
}

/** Composite MCP tools retain their published operation/lease envelope, but every
 * semantic field comes from the same descriptor consumed by laneToolCatalog.
 * Fail at assembly if an owner disappears; never silently publish a loose schema.
 */
function contractModelSchema(name: string, schema: z.ZodTypeAny | undefined): z.AnyZodObject {
  // 手写传输的对外工具按契约的**方法词表**（undo_timeline_edit / inspect_export_job …）取字段形状，
  // 不再按内部动词名取——PR B 起内部动词（`undo` / `check_job`）与传输方法不同名，外部契约照旧。
  if (!(schema instanceof z.ZodObject)) throw new Error(`Missing object model schema: ${name}`);
  return schema;
}

const timelineEditMcpInput = z.discriminatedUnion("operation", [
  z.object({ ...leaseField, operation: z.literal("preview"), plan: timelineEditPlanSchema }).strict(),
  z.object({ ...leaseField, operation: z.literal("apply"), plan: timelineEditPlanSchema }).strict(),
  contractModelSchema("undo_timeline_edit", timelineWritePiInputSchemaForAlias("undo_timeline_edit")).extend({ ...leaseField, operation: z.literal("undo") }).strict(),
]);
const exportJobMcpInput = contractModelSchema("inspect_export_job", exportReadPiInputSchemaForAlias("inspect_export_job"))
  .extend({ ...leaseField, operation: z.enum(["status", "verify"]) }).strict();
const timelineEditTransportSchema = immutableSchemaSnapshot(transportSchemaFromZod(timelineEditMcpInput, {
  label: "timelineEdit",
  // Keep JSON Schema numeric exclusive bounds (not OpenAPI boolean bounds).
  extraProperties: { plan: (() => {
    const { $schema: _dialect, ...schema } = toPublishedJsonSchema(contractModelSchema("apply_edit_plan", timelineEditPlanModelSchema));
    return schema;
  })() },
}));
const exportJobTransportSchema = immutableSchemaSnapshot(transportSchemaFromZod(exportJobMcpInput, { label: "exportJob" }));

export const TIMELINE_READ_MCP_ADAPTER: McpCapabilityAdapter = derivedAdapter(TIMELINE_READ_CAPABILITY, {
  authority: { kind: "project_session", requiredScope: "timeline:read" },
  port: { kind: "timeline", access: "read" },
  outputSchema: z.unknown(),
});

export const TIMELINE_EDIT_MCP_ADAPTER: McpCapabilityAdapter = Object.freeze({
  contract: TIMELINE_WRITE_CAPABILITY,
  authority: Object.freeze({ kind: "project_session", requiredScope: "timeline:write" }),
  port: Object.freeze({ kind: "timeline", access: "write" }),
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
    const undo = input as Record<string, unknown>;
    return {
      semanticInput: { operation: "undo_timeline_edit", undoToken: undo.undoToken, expectedRevision: undo.expectedRevision, ...(undo.reason ? { reason: undo.reason } : {}) },
      transport: input,
    };
  },
});

export const EXPORT_JOB_MCP_ADAPTER: McpCapabilityAdapter = Object.freeze({
  contract: EXPORT_READ_CAPABILITY,
  authority: Object.freeze({ kind: "project_session", requiredScope: "export:read" }),
  port: Object.freeze({ kind: "export", access: "read" }),
  transportInputSchema: exportJobTransportSchema,
  outputSchema: z.unknown(),
  parseCall(args) {
    const input = exportJobMcpInput.parse(args);
    return { semanticInput: { operation: input.operation === "status" ? "inspect_export_job" : "verify_render", jobId: input.jobId }, transport: input };
  },
});

export const MEDIA_QUERY_MCP_ADAPTER: McpCapabilityAdapter = derivedAdapter(ASSET_READ_CAPABILITY, {
  authority: { kind: "project_session", requiredScope: "asset:read" },
  port: { kind: "asset", access: "read" },
  outputSchema: z.unknown(),
});

// 布局读写不再对外发布（设计正本 §7：`layout_*` 删——42 句话术里没有一句要它）；契约留给渲染层 RPC。

export const MCP_EDITING_METHODS = Object.freeze(new Set([
  TIMELINE_READ_CAPABILITY.id,
  TIMELINE_WRITE_CAPABILITY.id,
  DOCUMENT_WRITE_CAPABILITY.id,
  EXPORT_READ_CAPABILITY.id,
  ASSET_READ_CAPABILITY.id,
]));

export function isMcpEditingMethod(method: string): boolean {
  return MCP_EDITING_METHODS.has(method as typeof TIMELINE_READ_CAPABILITY.id);
}

export function createMcpCapabilityResolver(registrations: readonly McpCapabilityAdapter[]): McpCapabilityResolver {
  const tools = Object.freeze(
    registrations.filter(isMcpExposable).map((adapter): McpCapabilityTool => {
      const name = adapter.mcpName ?? adapter.contract.aliases.mcp;
      if (!name) throw new Error(`Missing MCP alias for ${adapter.contract.id}`);
      // 描述只有一个 owner（`verbDeclarations.ts`）：传输目录还是手写的那些契约（`mcpHandwrittenTransport`）
      // 也从同一批声明派生描述，不再读契约上的第二份文案。
      const description = mcpToolDescription(adapter.contract, specsForCapability(adapter.contract.id));
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
        ...(adapter.prepareArguments ? { prepareArguments: adapter.prepareArguments } : {}),
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

export const CANVAS_READ_MCP_ADAPTER: McpCapabilityAdapter = derivedAdapter(CANVAS_READ_CAPABILITY, {
  authority: { kind: "project_session", requiredScope: CANVAS_READ_CAPABILITY.requiredScope },
  port: { kind: "canvas", access: "read" },
});

// 画布语义写在 MCP 上**只有一个名字**：CANVAS_WRITE_CAPABILITY.aliases.mcp。
// 曾经并列的 nomi_canvas_plan 与 nomi_canvas_edit 在 tools/list 里 description / inputSchema /
// method 字节级完全相同，只有名字不同 —— 宿主没有任何依据选哪个，正是 P1 说的并行版发生在公开面上。
// 合成一个之后，operation 枚举就是全部合法动作。
//
// 阶段 5a：schema 不再从 `canvasWriteSemanticInputSchema` 单独生成，而是与 Agent lane 的三个写工具
// **同源**——外部宿主因此第一次也拿到了 typed 的分镜 / 站位 / 运镜形状（以前它读到的是契约上
// 那两个 `z.record(z.unknown())`，25 个字段名一个都没有，那正是 #547 的 0/18）。
const derivedCanvasEditAdapter = derivedAdapter(CANVAS_WRITE_CAPABILITY, {
  authority: { kind: "project_session", requiredScope: CANVAS_WRITE_CAPABILITY.requiredScope },
  port: { kind: "canvas", access: "write" },
  outputSchema: canvasWriteResultSchema,
});
const canvasEditInputSchema = immutableSchemaSnapshot(mcpProfileToolFor(CANVAS_WRITE_CAPABILITY.id)?.inputSchema as SchemaLike);

// The MCP canvas surface is a composite semantic operation surface. Its
// operation field is the canonical discriminator for storyboard mutations,
// while the generated internal descriptor remains intentionally narrower for
// the lane verbs. Parse the externally published canonical input directly so
// patch_shots/propose_storyboard_plan are not rejected as unknown lane verbs.
export const CANVAS_EDIT_MCP_ADAPTER: McpCapabilityAdapter = Object.freeze({
  ...derivedCanvasEditAdapter,
  transportInputSchema: canvasEditInputSchema,
  parseCall(args) {
    const { leaseHandle, projectId, ...semanticArgs } = args;
    const semanticInput = canvasWriteSemanticInputSchema.parse(semanticArgs);
    return {
      semanticInput,
      transport: { ...semanticArgs, leaseHandle, ...(projectId ? { projectId } : {}) },
    };
  },
});

const canvasMaintenanceMcpInput = contractModelSchema("delete_canvas_nodes", canvasDeletePiInputSchema).partial().extend({
  ...leaseField, operation: z.enum(["delete_canvas_nodes", "undo_canvas_delete"]),
  confirmation: z.boolean().optional(), undoToken: z.string().trim().min(1).optional(),
}).strict();
const canvasMaintenanceTransportSchema = immutableSchemaSnapshot(transportSchemaFromZod(canvasMaintenanceMcpInput, { label: "canvasMaintenance" }));
export const CANVAS_MAINTENANCE_MCP_ADAPTER: McpCapabilityAdapter = Object.freeze({
  contract: CANVAS_DELETE_CAPABILITY,
  authority: Object.freeze({ kind: "project_session", requiredScope: CANVAS_DELETE_CAPABILITY.requiredScope }),
  port: Object.freeze({ kind: "canvas", access: "write" }),
  transportInputSchema: canvasMaintenanceTransportSchema,
  outputSchema: canvasDeleteResultSchema,
  parseCall(args) {
    const input = canvasMaintenanceMcpInput.parse(args);
    const { leaseHandle, projectId, ...transport } = input;
    const semantic = input.operation === "delete_canvas_nodes"
      ? canvasDeleteSemanticInputSchema.parse({ operation: input.operation, nodeIds: input.nodeIds, ...(input.reason ? { reason: input.reason } : {}) })
      : { operation: input.operation, undoToken: input.undoToken };
    return { semanticInput: semantic, transport: { leaseHandle, ...(projectId ? { projectId } : {}), ...transport } };
  },
});
export const DOCUMENT_READ_MCP_ADAPTER: McpCapabilityAdapter = derivedAdapter(DOCUMENT_READ_CAPABILITY, {
  authority: { kind: "project_session", requiredScope: DOCUMENT_READ_CAPABILITY.requiredScope },
  port: { kind: "document", access: "read" },
  outputSchema: documentReadResultSchema,
});
export const DOCUMENT_EDIT_MCP_ADAPTER: McpCapabilityAdapter = derivedAdapter(DOCUMENT_WRITE_CAPABILITY, {
  authority: { kind: "project_session", requiredScope: DOCUMENT_WRITE_CAPABILITY.requiredScope },
  port: { kind: "document", access: "write" },
  outputSchema: documentWriteResultSchema,
});

const MCP_SAFE_ADAPTERS = new Set<McpCapabilityAdapter>([
  CANVAS_READ_MCP_ADAPTER, CANVAS_EDIT_MCP_ADAPTER, CANVAS_MAINTENANCE_MCP_ADAPTER,
  DOCUMENT_READ_MCP_ADAPTER, DOCUMENT_EDIT_MCP_ADAPTER, TIMELINE_READ_MCP_ADAPTER, TIMELINE_EDIT_MCP_ADAPTER, EXPORT_JOB_MCP_ADAPTER, MEDIA_QUERY_MCP_ADAPTER,
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
]);
