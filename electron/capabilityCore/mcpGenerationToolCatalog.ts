/**
 * 语义 MCP 生成工具的声明式目录。从 mcpGenerationTools.ts 抽出（R9 巨壳拆分）。
 *
 * 这里是纯契约：工具名、描述、入参 schema，以及把 MCP 入参折成方法调用的 build。它随
 * 「对外暴露什么工具」而变，不随 handler 的实现而变，所以单独成文件。handler、operation
 * store 与派发逻辑仍住 mcpGenerationTools.ts。
 *
 * GENERATION_RECONCILE_OUTCOMES 刻意留在 mcpGenerationTools.ts：它是被登记的语义词表 owner，
 * 还有两个外部使用者（modelToolSurfaceManifest.ts、generationTransportAdapters.ts）。搬动它
 * 会挪走词表 site，那是另一件事，不该混进一次结构搬迁。
 */
import { GENERATION_RECONCILE_OUTCOMES } from "./mcpGenerationTools";

const gstr = (value: unknown): string => (typeof value === "string" ? value : "");

const OPERATION_PLAN_SHARED_FIELDS = {
  projectId: { type: "string" },
  prompt: { type: "string", description: "单镜目标；无 candidate 时用默认模型创建草稿。" },
  taskKind: { type: "string", enum: ["text_to_image", "image_edit", "text_to_video", "image_to_video"] },
  moduleId: { type: "string" },
  providerId: { type: "string" },
  modelId: { type: "string" },
  mode: { type: "string" },
  modeId: { type: "string" },
  variantId: { type: "string" },
  parameters: { type: "object" },
  references: { type: "array" },
  candidate: { type: "object", description: "单镜完整 candidate。" },
  shots: {
    type: "array",
    description: "多镜逐镜计划；可含 shotId、role(anchor/shot)、included 和 candidate。",
    items: {
      type: "object",
      properties: {
        shotId: { type: "string" },
        role: { type: "string", enum: ["anchor", "shot"] },
        included: { type: "boolean" },
        candidate: { type: "object" },
      },
      required: ["candidate"],
      additionalProperties: false,
    },
  },
  scriptText: { type: "string", description: "多镜剧本/分镜文本；服务端生成逐镜提示词、模型/模式建议和锚声明。" },
} as const;

/** create（无 operationId）用的 candidate/shots/scriptText 字段拷贝（build 里透传）。 */
function buildOperationCreateParams(args: Record<string, unknown>): Record<string, unknown> {
  return {
    projectId: args.projectId,
    leaseHandle: args.leaseHandle,
    ...(typeof args.prompt === "string" ? { prompt: args.prompt } : {}),
    ...(typeof args.taskKind === "string" ? { taskKind: args.taskKind } : {}),
    ...(typeof args.moduleId === "string" ? { moduleId: args.moduleId } : {}),
    ...(typeof args.providerId === "string" ? { providerId: args.providerId } : {}),
    ...(typeof args.modelId === "string" ? { modelId: args.modelId } : {}),
    ...(typeof args.mode === "string" ? { mode: args.mode } : {}),
    ...(typeof args.modeId === "string" ? { modeId: args.modeId } : {}),
    ...(typeof args.variantId === "string" ? { variantId: args.variantId } : {}),
    ...(args.parameters && typeof args.parameters === "object" && !Array.isArray(args.parameters) ? { parameters: args.parameters } : {}),
    ...(Array.isArray(args.references) ? { references: args.references } : {}),
    ...(args.candidate !== undefined ? { candidate: args.candidate } : {}),
    ...(Array.isArray(args.shots) ? { shots: args.shots } : {}),
    ...(typeof args.scriptText === "string" ? { scriptText: args.scriptText } : {}),
  };
}

export const MCP_GENERATION_TOOL_CATALOG = [
  {
    // T5 · 起/改一份可编辑的生成草稿（不提交、不花额度）。无 operationId=新建(create)；有 operationId+patch=改(plan)。
    name: "nomi_operation_plan",
    title: "起/改一份可编辑的生成草稿（单镜 prompt / 多镜 shots / 剧本 scriptText 三选一）；不提交、不花额度。",
    description: "创建/编辑生成草稿；不提交、不花额度。无 operationId=新建（prompt 单镜，分钟级/成片自动拟剧本分镜）；带 operationId+patch=编辑。",
    inputSchema: {
      type: "object",
      properties: {
        leaseHandle: { type: "string" },
        operationId: { type: "string", description: "缺省新建；给出则配合 patch 编辑。" },
        ...OPERATION_PLAN_SHARED_FIELDS,
        patch: { type: "object", description: "有 operationId 时的定点修改。" },
      },
      required: ["leaseHandle"],
      additionalProperties: false,
    },
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
    title: "预览草稿将用的模型/模式/参数/参考与不支持字段 + 定价；不调用模型、不封存。",
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
    title: "单次生成的付费确认门：request 发起真人确认挑战 / decide 提交客户端已完成的确认凭据。",
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
    title: "在计划已封存且确认有效后开始单次生成；提交只走统一 Runtime Adapter。",
    description: "计划封存且确认有效后生成；经统一 Runtime Adapter 提交，replay 幂等。",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, leaseHandle: { type: "string" }, operationId: { type: "string" }, receiptId: { type: "string" }, receiptToken: { type: "string" } },
      required: ["leaseHandle", "operationId"],
      additionalProperties: false,
    },
    method: "nomi_start_generation",
    build: (args: Record<string, unknown>) => ({ projectId: args.projectId, leaseHandle: args.leaseHandle, operationId: args.operationId, receiptId: args.receiptId, receiptToken: args.receiptToken }),
  },
  {
    // T9 · 控制单次生成：cancel 取消草稿 / reconcile 核对提交状态（未知结果不盲目重提）。
    name: "nomi_operation_control",
    title: "控制单次生成：cancel 取消草稿 / reconcile 核对提交状态（未知结果不盲目重提）。",
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
