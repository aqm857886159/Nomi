import { z } from "zod";
import type { CapabilityContract } from "./capabilityContract";

const input = z.record(z.unknown());
const output = z.unknown();

/**
 * Generation Strategy Resolver 的输入形状 —— **模型可见 schema 的单一生成点**（K1 / §7 岔路 3 方案 A）。
 *
 * 字段名与 `shared/videoCapabilities/planResolver.PlanShotInput` 一一对应。上一版把同一份 zod
 * 内联写在 `electron/harness/tools/modelToolSurfaceManifest.ts` 里，同时在
 * `generationTransportAdapters.ts` 手写了一条 name→capability 链——那正是阶段 2/5 要删的并行版（P1）。
 * 契约在这里之后：MCP 面（K3 dispatcher）与内部面（阶段 2 的 toolProjection）都从这一份派生，
 * 谁都不再自己抄一遍字段表。
 */
export const generationResolveInputSchema = z.object({
  shots: z.array(z.object({
    id: z.string().trim().min(1),
    durationSec: z.number().finite().nonnegative(),
    sceneAnchorId: z.string().trim().min(1).optional(),
    anchorIds: z.array(z.string().trim().min(1)).optional(),
    modelKey: z.string().trim().min(1).optional(),
    modeId: z.string().trim().min(1).optional(),
    params: z.record(z.unknown()).optional(),
    beatNote: z.string().max(300).optional(),
  }).strict()).min(1).max(40),
  goals: z.object({ allowAdvisoryMerge: z.boolean().optional() }).strict().optional(),
}).strict();

export type GenerationResolveInput = z.infer<typeof generationResolveInputSchema>;

/**
 * Semantic generation tools are registered here only for capability
 * projection/Skill shrink-only checks. Their execution still belongs to the
 * main-process generation Host adapter; this registry never calls a provider.
 */
export const GENERATION_CONTEXT_READ_CAPABILITY = {
  id: "generation.context.read",
  version: 1,
  aliases: { pi: "list_models", method: "nomi_get_generation_context" },
  inputSchema: input,
  outputSchema: output,
  effect: "read",
  effectClass: "reversible_local",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "context:read",
  targetKind: "generation",
} as const satisfies CapabilityContract<unknown, unknown>;

export const GENERATION_PLAN_CAPABILITY = {
  id: "generation.plan",
  version: 1,
  aliases: { pi: "draft_shots" },
  // `generate` 出卡；`nomi_generation_plan` 是传输层（generationTransportAdapters）的方法名。
  // dispatcher 的方法名住 `method` surface：模型永远看不见它们，但 `resolveCapabilityAlias` 仍认。
  additionalAliases: Object.freeze({ pi: Object.freeze(["generate"]), method: Object.freeze(["nomi_generation_plan", "nomi_operation_create", "nomi_submit_generation_plan", "nomi_preview_execution"]) }),
  inputSchema: input,
  outputSchema: output,
  effect: "reversible_write",
  effectClass: "reversible_local",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "generation:plan",
  targetKind: "generation",
} as const satisfies CapabilityContract<unknown, unknown>;

/**
 * `resolve` = 无状态的执行计划预演：按真实模型档案校验/钳值每一镜，并给出合并/拆条建议。
 * 不落 durable operation、不 seal、不触发生成、不花钱 —— 所以它是唯一一个不要求项目租赁凭证的
 * generation 能力（GUI 窄 IPC 也是无 lease 进来的）。effect=read 就是这件事的机器判据。
 */
export const GENERATION_RESOLVE_CAPABILITY = {
  id: "generation.resolve",
  version: 1,
  aliases: { method: "nomi_resolve_generation_plan" },
  inputSchema: generationResolveInputSchema,
  outputSchema: output,
  effect: "read",
  effectClass: "reversible_local",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "generation:plan",
  targetKind: "generation",
} as const satisfies CapabilityContract<unknown, unknown>;

export const GENERATION_GATE_CAPABILITY = {
  id: "generation.gate",
  version: 1,
  aliases: { method: "nomi_request_generation_gate" },
  // 付费门的三个相位是**同一个能力**的三个别名，不是三个能力：request 发确认挑战、
  // decide 提交客户端已完成的凭据、start 在收据结清后真正提交。阶段 5a 之前 decide
  // 只以字符串字面量活在 `generationDispatcher.ts` 的路由表和 `modelToolSurfaceManifest.ts`
  // 那张手写的三行名单里——契约上查不到它，于是「付费边界上有哪些名字」只能靠手抄。
  additionalAliases: { method: Object.freeze(["nomi_start_generation", "nomi_decide_generation_gate"]) },
  inputSchema: input,
  outputSchema: output,
  effect: "paid",
  effectClass: "spend",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "generation:submit",
  targetKind: "generation",
} as const satisfies CapabilityContract<unknown, unknown>;

export const GENERATION_RUN_READ_CAPABILITY = {
  id: "generation.run.read",
  version: 1,
  // 模型可见的 `nomi_generation_status` 归 `generation.control`（它能 cancel），`read` 这一支经
  // `operationCapabilityIds` 回到这里；本契约自己只有 dispatcher 方法名（审计 M4 的修法）。
  aliases: { pi: "check_job", method: "nomi_operation_read" },
  inputSchema: input,
  outputSchema: output,
  effect: "read",
  effectClass: "reversible_local",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "generation:read",
  targetKind: "generation",
} as const satisfies CapabilityContract<unknown, unknown>;

export const GENERATION_CONTROL_CAPABILITY = {
  id: "generation.control",
  version: 1,
  aliases: { method: "nomi_generation_status" },
  additionalAliases: { method: Object.freeze(["nomi_cancel_generation", "nomi_reconcile_generation"]) },
  inputSchema: input,
  outputSchema: output,
  effect: "reversible_write",
  effectClass: "reversible_local",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "generation:control",
  targetKind: "generation",
} as const satisfies CapabilityContract<unknown, unknown>;

export const GENERATION_CAPABILITIES = Object.freeze([
  GENERATION_CONTEXT_READ_CAPABILITY,
  GENERATION_PLAN_CAPABILITY,
  GENERATION_RESOLVE_CAPABILITY,
  GENERATION_GATE_CAPABILITY,
  GENERATION_RUN_READ_CAPABILITY,
  GENERATION_CONTROL_CAPABILITY,
] as const);
