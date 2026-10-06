/**
 * 语义 MCP 生成工具的声明式目录。从 mcpGenerationTools.ts 抽出（R9 巨壳拆分）。
 *
 * 这里是纯契约：工具名、描述、入参 schema，以及把 MCP 入参折成方法调用的 build。它随
 * 「对外暴露什么工具」而变，不随 handler 的实现而变，所以单独成文件。handler、operation
 * store 与派发逻辑仍住 mcpGenerationTools.ts。
 *
 * Reconciliation vocabulary is owned by shared/agentCapabilities/generationPlanSchemas.
 */
import { z } from "zod";
import { toPublishedJsonSchema } from "../shared/agentCapabilities/modelVisibleJsonSchema";
import { generationPlanInputSchema, GENERATION_RECONCILE_OUTCOMES } from "../shared/agentCapabilities/generationPlanSchemas";
import {
  assertPaidBoundaryExternalSurface,
  paidBoundaryAnnotations,
} from "../shared/agentCapabilities/paidBoundary";

const gstr = (value: unknown): string => (typeof value === "string" ? value : "");

// Assemble the complete envelope before publication: recursive references remain relative
// to the final tool root, and every semantic field retains its canonical lane owner.
const generationTransportSchema = generationPlanInputSchema.options[1].omit({ operation: true, newPlan: true }).extend({
  leaseHandle: z.string(),
  projectId: z.string().optional(),
  operationId: z.string().describe("缺省新建；给出则配合 patch 编辑。").optional(),
  vendor: z.string().describe("providerId alias from nomi_read(target=models).").optional(),
  modelKey: z.string().describe("modelId alias from nomi_read(target=models).").optional(),
  patch: generationPlanInputSchema.options[2].shape.patch.optional(),
});
const { $schema: _dialect, ...generationInputSchema } = toPublishedJsonSchema(generationTransportSchema);

/**
 * 对外 `nomi_operation_plan` 的 create 分支：**字段名单从宿主 schema 取，不在这里抄第二份。**
 *
 * 2026-09-18 之前这里是 22 行逐字段拷贝（`prompt` / `taskKind` / `moduleId` / … 一个一个 `typeof` 判断
 * 再透传）。它与内部面的对照表、宿主自己的 `inherited` 一起，让**同一条 rename 有过三份实现**；更要命的
 * 是 `createFields` 每加一个字段，这里就**静默**少传一个——编译得过、测试全绿，只有外部宿主在下一次
 * 付费运行里用一次失败告诉你。内部面那一份已经在同一条分支上被投影取代（`verbs/verbProjections.ts`），
 * 这是同一手法的外部面同胞。
 *
 * **对外已发布的字段名一个都不改**：`vendor` / `modelKey` 是读侧别名，`operationId` / `undoToken` 是
 * 对外契约，动它们就是在改别人已经写好的调用。别名归一仍然保留，只是同样变成一张声明表。
 */
// `newPlan` 只对文稿方案有意义（同一请求里另起一份），外部宿主没有文稿方案，所以不发布它。
const CREATE_BRANCH_SCHEMA = generationPlanInputSchema.options[1].omit({ operation: true, newPlan: true });
const CREATE_FIELD_NAMES: readonly string[] = Object.freeze(Object.keys(CREATE_BRANCH_SCHEMA.shape));

/** 读侧别名 → 写侧 canonical 名。canonical 名字优先；两个都给时别名被忽略（与改动前逐字相同）。 */
const READ_SIDE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  vendor: "providerId",
  modelKey: "modelId",
});

function buildOperationCreateParams(args: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = { projectId: args.projectId, leaseHandle: args.leaseHandle };
  for (const field of CREATE_FIELD_NAMES) {
    if (args[field] !== undefined) params[field] = args[field];
  }
  for (const [alias, canonical] of Object.entries(READ_SIDE_ALIASES)) {
    if (params[canonical] === undefined && args[alias] !== undefined) params[canonical] = args[alias];
  }
  return params;
}

export const MCP_GENERATION_TOOL_CATALOG = [
  {
    // T5 · 起/改一份可编辑的生成草稿（不提交、不花额度）。无 operationId=新建(create)；有 operationId+patch=改(plan)。
    name: "nomi_operation_plan",
    title: "编辑生成草稿",
    description: "创建/编辑生成草稿；不提交、不花额度。无 operationId=新建（prompt 单镜，分钟级/成片自动拟剧本分镜）；带 operationId+patch=编辑。",
    inputSchema: generationInputSchema,
    // create（无 operationId）→ nomi_operation_create；patch（有 operationId）→ nomi_submit_generation_plan。
    method: "nomi_operation_create",
    resolveMethod: (args: Record<string, unknown>): string =>
      gstr(args.operationId) ? "nomi_submit_generation_plan" : "nomi_operation_create",
    build: (args: Record<string, unknown>) =>
      gstr(args.operationId)
        ? { projectId: args.projectId, leaseHandle: args.leaseHandle, operationId: args.operationId, patch: args.patch }
        : buildOperationCreateParams(args),
  },
  {
    // T6 · 预览草稿将用的模型/模式/参数/参考 + 定价；不调用模型、不封存（RO，编译预演相位）。
    name: "nomi_operation_preview",
    title: "预览生成方案与价格",
    description: "预览模型、模式、参数、参考、不支持字段与定价；不调用模型，未知价不显示为 0。",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, leaseHandle: { type: "string" }, operationId: { type: "string" } },
      required: ["leaseHandle", "operationId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true as const },
    method: "nomi_preview_execution",
    build: (args: Record<string, unknown>) => ({ projectId: args.projectId, leaseHandle: args.leaseHandle, operationId: args.operationId }),
  },
  {
    // T7 · 单次生成付费确认门（两相，phase 参数）。request 发起真人确认挑战 / decide 提交客户端已完成的凭据。
    // 付费 seam（assertKnownShotPrice fail-closed / receipt MAC / gate_decide 抛错走 Run-owned seam）原地不动在 handler。
    name: "nomi_operation_gate",
    title: "确认生成费用",
    description: "付费门：request 封存计划、计算 maximumCost 并发确认挑战（不提交）；decide 提交客户端确认凭据；不接受裸 confirm/approved。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        leaseHandle: { type: "string" },
        operationId: { type: "string" },
        phase: { type: "string", enum: ["request", "decide"], description: "request 发挑战；decide 提交收据。" },
        attempt: { type: "integer", minimum: 1, description: "phase=decide 的尝试序号。" },
        receiptId: { type: "string", description: "phase=decide 的收据 id。" },
        receiptToken: { type: "string", description: "phase=decide 的收据 token。" },
      },
      required: ["leaseHandle", "operationId", "phase"],
      additionalProperties: false,
    },
    // 注解**派生**自付费契约的 `effectClass:"spend"`，不在这里手写（阶段 5a：以前一个注解都没带，
    // 而漏标不会报错——宿主因此把一次花钱的调用当成和一次读一样普通）。
    annotations: paidBoundaryAnnotations(),
    method: "nomi_request_generation_gate",
    resolveMethod: (args: Record<string, unknown>): string => (gstr(args.phase) === "decide" ? "nomi_decide_generation_gate" : "nomi_request_generation_gate"),
    build: (args: Record<string, unknown>) =>
      gstr(args.phase) === "decide"
        ? { projectId: args.projectId, leaseHandle: args.leaseHandle, operationId: args.operationId, attempt: args.attempt, receiptId: args.receiptId, receiptToken: args.receiptToken }
        : { projectId: args.projectId, leaseHandle: args.leaseHandle, operationId: args.operationId },
  },
  {
    // T8 · 在计划已封存且确认有效后开始单次生成（$ 提交）。前置 approvedReceiptId 有效，与 T7 分家（形状约束3）。
    name: "nomi_operation_execute",
    title: "执行已确认的生成",
    description: "计划封存且确认有效后生成；经统一 Runtime Adapter 提交，replay 幂等。",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, leaseHandle: { type: "string" }, operationId: { type: "string" }, receiptId: { type: "string" }, receiptToken: { type: "string" } },
      required: ["leaseHandle", "operationId"],
      additionalProperties: false,
    },
    annotations: paidBoundaryAnnotations(),
    method: "nomi_start_generation",
    build: (args: Record<string, unknown>) => ({ projectId: args.projectId, leaseHandle: args.leaseHandle, operationId: args.operationId, receiptId: args.receiptId, receiptToken: args.receiptToken }),
  },
  {
    // T9 · 控制单次生成：cancel 取消草稿 / reconcile 核对提交状态（未知结果不盲目重提）。
    name: "nomi_operation_control",
    title: "取消或核对生成任务",
    description: "cancel 取消未提交草稿（已提交进入可核账取消）；reconcile 核对提交状态，未知结果不重提。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        leaseHandle: { type: "string" },
        operationId: { type: "string" },
        action: { type: "string", enum: ["cancel", "reconcile"] },
        outcome: { type: "string", enum: [...GENERATION_RECONCILE_OUTCOMES], description: "action=reconcile 必填：found 查到提交 / not_found 未查到。" },
      },
      required: ["leaseHandle", "operationId", "action"],
      additionalProperties: false,
    },
    method: "nomi_cancel_generation",
    resolveMethod: (args: Record<string, unknown>): string =>
      gstr(args.action) === "reconcile" ? "nomi_reconcile_generation" : "nomi_cancel_generation",
    build: (args: Record<string, unknown>) =>
      gstr(args.action) === "reconcile"
        ? { projectId: args.projectId, leaseHandle: args.leaseHandle, operationId: args.operationId, outcome: args.outcome }
        : { projectId: args.projectId, leaseHandle: args.leaseHandle, operationId: args.operationId },
  },
] as const;

// 装配期闸（R28）：付费边界上的每个别名都必须被一个带 `destructiveHint` 的对外工具认领，
// 反过来任何路由到付费别名的工具都必须带上它。判据住 `paidBoundary.ts`（唯一那处），
// 这里只是把目录交给它核。加第二个 `effect:"paid"` 契约而忘了对外接线 → App 起不来，
// 而不是像阶段 5a 之前那样安静地少一条防线。
assertPaidBoundaryExternalSurface(
  MCP_GENERATION_TOOL_CATALOG.map((tool) => ({
    name: tool.name,
    routedMethods: [
      tool.method,
      // 多态工具按 phase/action 分支路由（`resolveMethod`）。分支目标同样在付费边界上时，
      // 它一样要被核到——所以这里把两个可能的分支都实喂一次，而不是只报静态的 `method`。
      ...("resolveMethod" in tool
        ? (["request", "decide", "cancel", "reconcile"] as const).map((branch) =>
          (tool as { resolveMethod: (args: Record<string, unknown>) => string })
            .resolveMethod({ phase: branch, action: branch }))
        : []),
    ],
    ...("annotations" in tool ? { annotations: tool.annotations } : {}),
  })),
);
