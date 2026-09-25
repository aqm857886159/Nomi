import { z } from "zod";
import type { CapabilityContract } from "./capabilityContract";
import { generationPlanInputSchema, generationStatusInputSchema } from "./generationPlanSchemas";
import type { PlanShotInput } from "../videoCapabilities/planResolver";

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
    // 与 modelKey 成对的供应商（632677d15 起分镜镜头的模型身份是一对）。这里曾经没有它，而对象是 `.strict()`：
    // 渲染层每一个记了供应商的视频镜都被判 generation_input_invalid，面板报「执行计划检查失败」，
    // 生成前的时长闸因此整个放行（0.22.0 回归）。下面的逐键对账让这种漂移变成编译错误。
    modelVendor: z.string().trim().min(1).optional(),
    modeId: z.string().trim().min(1).optional(),
    params: z.record(z.unknown()).optional(),
    beatNote: z.string().max(300).optional(),
  }).strict()).min(1).max(40),
  goals: z.object({ allowAdvisoryMerge: z.boolean().optional() }).strict().optional(),
}).strict();

export type GenerationResolveInput = z.infer<typeof generationResolveInputSchema>;

/** schema 里的一镜——与 `PlanShotInput` 逐键相等（下面两条编译期守卫）。 */
export type GenerationResolveShotInput = GenerationResolveInput["shots"][number];

// 逐键对账（编译期，两个方向）：`PlanShotInput` 是引擎的输入类型、渲染层投影（storyboardPlanToPlanShotInputs）
// 按它产出；这份 schema 是主进程的接受集合，而且是 `.strict()`。两边各写一份字段表，只要有一边多一个键：
//  · 类型有、schema 没有 → 渲染层合法地带上它，主进程整份拒收（本条回归的形状）；
//  · schema 有、类型没有 → 模型能传、引擎不读，静默丢。
// 互相赋值的守卫看不见缺席的可选键（两个方向都能赋值），所以这里按键比。
type MissingKeys<TFrom, TInto> = Exclude<keyof TFrom, keyof TInto>;
type AssertNoMissingKeys<T extends never> = T;
type _PlanShotInputKeysAccepted = AssertNoMissingKeys<MissingKeys<PlanShotInput, GenerationResolveShotInput>>;
type _SchemaShotKeysOnPlanShotInput = AssertNoMissingKeys<MissingKeys<GenerationResolveShotInput, PlanShotInput>>;

/**
 * 生成域**方法名的唯一声明**（宿主/dispatcher 的方法词表，模型永远看不见）。
 *
 * 三个消费者都从这一份派生，谁都不再手抄：契约的 `method` surface（下面各契约的 `aliases` /
 * `additionalAliases`）、`generationTransportAdapters` 的路由白名单（`GENERATION_METHOD_NAMES`）、
 * `agentLane/laneVerbTransport` 的动词→方法翻译（按 `GenerationMethodName` 字面量类型收窄）。
 * 根因合同 2026-09-11-agent-generation-second-door：#777 曾在翻译层手写 `nomi_generation_plan`、在适配器
 * 手写一份九元素数组，两份各自演化，翻出来的名字不在白名单里 → 整组生成动词恒 `generation_surface_unavailable`。
 * 少一边改名，现在是 `tsc` 红，不是运行期静默。
 */
export const GENERATION_METHODS = Object.freeze({
  /** 语义入口：`operation` 判别（context / create / patch / present / preview）。 */
  plan: "nomi_generation_plan",
  /** 语义入口：`operation` 判别（read / cancel / reconcile）。 */
  status: "nomi_generation_status",
  context: "nomi_get_generation_context",
  create: "nomi_operation_create",
  patch: "nomi_submit_generation_plan",
  /** `generate` 动词：把草稿的报价卡摆到用户面前（草稿不变，只翻 `cardHidden`）。 */
  present: "nomi_present_generation_plan",
  preview: "nomi_preview_execution",
  resolve: "nomi_resolve_generation_plan",
  gateRequest: "nomi_request_generation_gate",
  gateDecide: "nomi_decide_generation_gate",
  start: "nomi_start_generation",
  read: "nomi_operation_read",
  cancel: "nomi_cancel_generation",
  reconcile: "nomi_reconcile_generation",
} as const);
export type GenerationMethodName = (typeof GENERATION_METHODS)[keyof typeof GENERATION_METHODS];
export const GENERATION_METHOD_NAMES: ReadonlySet<GenerationMethodName> = Object.freeze(new Set(Object.values(GENERATION_METHODS)));
export function isGenerationMethodName(name: string): name is GenerationMethodName {
  return GENERATION_METHOD_NAMES.has(name as GenerationMethodName);
}

/**
 * Semantic generation tools are registered here only for capability
 * projection/Skill shrink-only checks. Their execution still belongs to the
 * main-process generation Host adapter; this registry never calls a provider.
 */
export const GENERATION_CONTEXT_READ_CAPABILITY = {
  id: "generation.context.read",
  version: 1,
  aliases: { pi: "list_models", method: GENERATION_METHODS.context },
  inputSchema: z.record(z.unknown()), // pi 收 kind/modelId，MCP 收项目租赁信封；拆能力前没有同一份输入。
  outputSchema: z.unknown(), // list_models 的 models 与 MCP 项目上下文是两种返回；按 09-19 裁决留待拆能力，动词独立声明。
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
  // `draft_shots` 建草稿（create / patch，卡先藏着）、`generate` 出卡（present）；`GENERATION_METHODS.plan` 是
  // 传输层（generationTransportAdapters）的语义入口方法名。dispatcher 的方法名住 `method` surface：模型永远
  // 看不见它们，但 `resolveCapabilityAlias` 仍认。
  additionalAliases: Object.freeze({
    pi: Object.freeze(["generate"]),
    method: Object.freeze([GENERATION_METHODS.plan, GENERATION_METHODS.create, GENERATION_METHODS.patch, GENERATION_METHODS.present, GENERATION_METHODS.preview]),
  }),
  inputSchema: generationPlanInputSchema,
  outputSchema: z.unknown(), // create/patch/present/preview 各有返回；GenerationOperation/ExecutionContractV1 尚无运行时结果 schema，待 owner 提供后复用。
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
  aliases: { method: GENERATION_METHODS.resolve },
  inputSchema: generationResolveInputSchema,
  outputSchema: z.unknown(), // resolvePlanAdvisory 投影 GenerationResolutionResult（仅 TS 类型）；待 resolver 声明运行时结果 schema。
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
  aliases: { method: GENERATION_METHODS.gateRequest },
  // 付费门的三个相位是**同一个能力**的三个别名，不是三个能力：request 发确认挑战、
  // decide 提交客户端已完成的凭据、start 在收据结清后真正提交。阶段 5a 之前 decide
  // 只以字符串字面量活在 `generationDispatcher.ts` 的路由表和 `modelToolSurfaceManifest.ts`
  // 那张手写的三行名单里——契约上查不到它，于是「付费边界上有哪些名字」只能靠手抄。
  additionalAliases: { method: Object.freeze([GENERATION_METHODS.start, GENERATION_METHODS.gateDecide]) },
  inputSchema: z.record(z.unknown()), // request/decide/start 的租赁与收据由 dispatcher 分相校验，尚无共同运行时入参 schema；待该 owner 提供。
  outputSchema: z.unknown(), // approvalReceipt 的挑战/凭据及 start 注入结果只有 TS 类型；待三相结果 owner 声明 schema，不能借计划结果冒充。
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
  aliases: { pi: "check_job", method: GENERATION_METHODS.read },
  inputSchema: generationStatusInputSchema.options[0],
  outputSchema: z.unknown(), // read 返回 GenerationOperation（含封存契约/授权），productionRunTypes 不是该投影的运行时 schema；待 operation owner 提供。
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
  aliases: { method: GENERATION_METHODS.status },
  additionalAliases: { method: Object.freeze([GENERATION_METHODS.cancel, GENERATION_METHODS.reconcile]) },
  inputSchema: generationStatusInputSchema,
  outputSchema: z.unknown(), // cancel 返回 operation，reconcile 可由宿主注入；待两支声明运行时结果 schema，不能复用导出 job 回执。
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
