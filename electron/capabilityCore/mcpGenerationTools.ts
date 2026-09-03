import crypto from "node:crypto";
import {
  applyPlanCandidatePatch,
  compileExecutionContract,
  type ExecutionContractV1,
  type PlanCandidate,
} from "./executionContract";
import {
  buildMultiShotGateProjection,
  deriveShotPrice,
  assertKnownShotPrice,
  type ModelPricing,
  type MultiShotGateProjection,
  type ShotPrice,
} from "../productionRun/shotPricing";
import {
  createMultiShotCreateHelpers,
  type AssertReferencesResolvable,
  type GenerationOperationDraftShot,
  type GenerationSealMultiShot,
  type StoryboardPlanResult,
} from "./mcpGenerationMultiShot";
import {
  candidateHasCharacterReference,
  candidatesForCurrentVideoModel,
  modelSupportsReferenceImage,
  normalizedModelIdentity,
  normalizeVideoCandidate,
  shotDurationSeconds,
  videoCandidateForPlan,
  videoParameterSchema,
  videoRecommendationInput,
} from "./mcpGenerationVideoResolve";
import type { ModuleRegistry } from "./moduleRegistry";
import type { ProjectLeaseV2 } from "./projectLease";
import type { ProductionGenerationAuthorizationEnvelopeV1 } from "../productionRun/productionGenerationAuthorization";
import {
  classifyGenerationProviderCapabilities,
  type GenerationProviderCapabilityProfile,
} from "./generationProviderCapabilities";
import { GenerationProviderCapabilityError } from "./generationRuntimeAdapter";
import type {
  VideoGenerationRecommendationInput,
  VideoGenerationRecommendationResult,
  VideoModelCandidate,
} from "../shared/videoCapabilities/recommendation";
import { effectiveVideoModes } from "../shared/videoCapabilities/recommendation";
import type { GenerationDefaultTaskKind } from "../settings/generationModelDefaultsContract";
import { semanticCandidateFromParams } from "./semanticGenerationCandidate";
import { projectGenerationOperationPreview } from "./mcpGenerationPreview";
export const GENERATION_RECONCILE_OUTCOMES = ["found", "not_found"] as const;

const gstr = (value: unknown): string => (typeof value === "string" ? value : "");

// J06 — 诚实 ETA：冷启动给区间（low/high），不再硬编 40/180s 点值。
// 历史 P50/P90 落盘后可切 etaBasis='historical'；当前全部为 coldstart。
// 基线（APIMart 生产 2026-09-03）：video 4-10min / image 10-60s / audio 15-90s。
const COLDSTART_ETA_BY_KIND: Record<string, { low: number; high: number }> = {
  video: { low: 240, high: 600 }, image: { low: 10, high: 60 },
  audio: { low: 15, high: 90 },  model3d: { low: 120, high: 300 },
};
/** J06 — shotCount × kind → { waitSeconds, waitSecondsHigh, etaBasis }. */
export function coldstartEtaForGate(outputKinds: readonly string[], shotCount: number): { waitSeconds: number; waitSecondsHigh: number; etaBasis: 'coldstart' } {
  const primaryKind = outputKinds.find((k) => k === "video") ?? outputKinds[0] ?? "image";
  const { low, high } = COLDSTART_ETA_BY_KIND[primaryKind] ?? { low: 120, high: 360 };
  return { waitSeconds: Math.round(low * shotCount), waitSecondsHigh: Math.round(high * shotCount), etaBasis: "coldstart" as const };
}

/**
 * The semantic MCP surface is deliberately data-only.  These tools are the
 * same vocabulary a GUI adapter uses; neither the catalog nor this handler
 * knows a vendor-specific parameter or calls a provider.
 *
 * 面收敛（surface-16-collapse）：generation-operation 的 8 步 CRUD + get_context 塌成 5 个贴生命周期的工具。
 * get_context 收进 nomi_read（target=generation_context）不在此。收敛只在 catalog 层：build 按 phase/action 分派
 * 到**原 method 字面量**（能力核 handler 的 capability 分支逐字不动，付费 seam 一行不碰）；多态工具带
 * resolveMethod(args)→内部路由键（SEMANTIC_GENERATION_ROUTES 据此选 capability）。
 */

// —— 生成草稿三入口字段（prompt 单镜 / shots 逐镜 / scriptText 剧本），create 与 patch 共用形状 ——
const OPERATION_PLAN_SHARED_FIELDS = {
  projectId: { type: "string" },
  prompt: { type: "string", description: "单镜自然语言目标；省略 candidate 时由设置中的默认模型创建草稿。" },
  taskKind: { type: "string", enum: ["text_to_image", "image_edit", "text_to_video", "image_to_video"] },
  moduleId: { type: "string" },
  providerId: { type: "string" },
  modelId: { type: "string" },
  mode: { type: "string" },
  modeId: { type: "string" },
  variantId: { type: "string" },
  parameters: { type: "object" },
  references: { type: "array" },
  candidate: { type: "object", description: "单镜：一份完整的生成 candidate。" },
  shots: {
    type: "array",
    description: "多镜：逐镜计划。每项含可选 shotId/role(anchor 形象参考|shot 视频镜)/included(试拍/分批)，与一份完整 candidate。",
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
  scriptText: { type: "string", description: "多镜：剧本/分镜文本，服务端拟镜出镜表（每镜提示词 + 建议模型/模式 + 锚声明）。" },
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
    description: "创建或编辑一份生成草稿；不提交、不花额度。无 operationId=新建（普通 prompt 单镜，分钟级/成片自动拟剧本分镜）；给 operationId+patch=改现有草稿。",
    inputSchema: {
      type: "object",
      properties: {
        leaseHandle: { type: "string" },
        operationId: { type: "string", description: "缺省=新建草稿；给了则连同 patch 改现有草稿。" },
        ...OPERATION_PLAN_SHARED_FIELDS,
        patch: { type: "object", description: "给了 operationId 时：对现有草稿的定点修改。" },
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
    description: "预览将使用的模型、模式、参数和参考素材，并显示不支持字段与定价；不调用模型。未知价诚实显示，不伪造 0。",
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
    description: "按 phase 处理单次生成付费门：request 封存计划并算 maximumCost、发确认挑战（不提交模型）；decide 提交客户端确认凭据（裸 confirm/approved 不被接受）。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        leaseHandle: { type: "string" },
        operationId: { type: "string" },
        phase: { type: "string", enum: ["request", "decide"], description: "request 发起确认挑战；decide 提交收据。" },
        attempt: { type: "integer", minimum: 1, description: "phase=decide：确认尝试序号。" },
        receiptId: { type: "string", description: "phase=decide：确认收据 id。" },
        receiptToken: { type: "string", description: "phase=decide：确认收据 token。" },
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
    description: "在计划已封存且确认有效后开始生成；提交只走统一 Runtime Adapter（replay 幂等）。",
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
    description: "按 action 控制单次生成：cancel 取消尚未提交的草稿（已提交只进入可核账取消流程）；reconcile 核对提交状态（配 outcome，未知结果不盲目重提）。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        leaseHandle: { type: "string" },
        operationId: { type: "string" },
        action: { type: "string", enum: ["cancel", "reconcile"] },
        outcome: { type: "string", enum: [...GENERATION_RECONCILE_OUTCOMES], description: "action=reconcile 必填：found 供应商侧查到提交 / not_found 没查到。" },
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
export type GenerationOperationState = "draft" | "sealed" | "cancelled" | "submitted";

/**
 * P4 S4: one shot within a multi-shot operation, projected for the MCP surface. `role` distinguishes
 * anchor (identity image) from video shot; `included` drives 试拍/分批. Present only when the operation's
 * plan has shots[]; a single-shot operation omits `shots` entirely (byte-identical to today).
 */
export type GenerationOperationShot = Readonly<{
  shotId: string;
  role?: "anchor" | "shot";
  included?: boolean;
  candidate: PlanCandidate;
  contract?: ExecutionContractV1;
}>;

// P4 S6.5: the multi-shot create/seal shapes live in mcpGenerationMultiShot.ts (the entrance's home; keeps
// this shell under the 800-line gate). Re-exported so downstream imports stay on mcpGenerationTools.
export type { GenerationOperationDraftShot, GenerationSealMultiShot, StoryboardShotDraft, StoryboardPlanResult } from "./mcpGenerationMultiShot";

export type GenerationOperation = Readonly<{
  operationId: string;
  projectId: string;
  candidate: PlanCandidate;
  state: GenerationOperationState;
  contract?: ExecutionContractV1;
  approvedReceiptId?: string;
  /** P4 S4: multi-shot entries (anchors + video shots). Absent = single-shot (today's flat path). */
  shots?: ReadonlyArray<GenerationOperationShot>;
  planHash?: string;
  planVersion?: number;
  authorizationEnvelope?: ProductionGenerationAuthorizationEnvelopeV1;
  authorizationDigest?: string;
  authorizationGateId?: string;
  updatedAt: string;
}>;

export type GenerationAuthorizationPreparation = Readonly<{
  envelope: ProductionGenerationAuthorizationEnvelopeV1;
  authorizationDigest: string;
}>;

export type GenerationOperationStore = {
  // P4 S6.5: `shots` seeds a multi-shot draft (anchor + video shots). Absent → single-shot (unchanged).
  create(input: { operationId: string; projectId: string; candidate: PlanCandidate; now: string; origin?: { host: string; actorId?: string }; shots?: ReadonlyArray<GenerationOperationDraftShot> }): GenerationOperation | Promise<GenerationOperation>;
  read(projectId: string, operationId: string): GenerationOperation | null | Promise<GenerationOperation | null>;
  patch(projectId: string, operationId: string, patch: Partial<Omit<PlanCandidate, "candidateId" | "revision">>, now: string): GenerationOperation | Promise<GenerationOperation>;
  // P4 S6.5: `multiShot` seals per-shot sub-contracts + planHash (reducer freezes the whole batch). Absent
  // → single-shot seal of the one top-level contract (byte-identical to today).
  seal(projectId: string, operationId: string, contract: ExecutionContractV1, now: string, multiShot?: GenerationSealMultiShot, authorization?: GenerationAuthorizationPreparation): GenerationOperation | Promise<GenerationOperation>;
  cancel(projectId: string, operationId: string, now: string): GenerationOperation | Promise<GenerationOperation>;
  /** P4 S4 试拍首镜: invalidate the waiting authority and return a narrowed plan to draft for re-seal. */
  trialNarrow?(projectId: string, operationId: string, now: string): GenerationOperation | Promise<GenerationOperation>;
};

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return value;
}

/** Test/fixture store only. Production wiring must supply a Run-owned durable store. */
export function createInMemoryGenerationOperationStore(): GenerationOperationStore {
  const operations = new Map<string, GenerationOperation>();
  const keyFor = (projectId: string, operationId: string) => `${projectId}:${operationId}`;
  const read = (projectId: string, operationId: string) => operations.get(keyFor(projectId, operationId)) ?? null;
  return {
    create(input) {
      const key = keyFor(input.projectId, input.operationId);
      if (operations.has(key)) throw new Error(`Generation operation already exists: ${input.operationId}`);
      const operation = freeze({
        operationId: input.operationId,
        projectId: input.projectId,
        candidate: structuredClone(input.candidate),
        state: "draft" as const,
        // P4 S6.5: seed draft shots (candidate/role/included, no sub-contract). Single-shot omits shots.
        ...(input.shots && input.shots.length > 0
          ? { shots: input.shots.map((shot) => ({ shotId: shot.shotId, ...(shot.role ? { role: shot.role } : {}), ...(shot.included !== undefined ? { included: shot.included } : {}), candidate: structuredClone(shot.candidate) })) }
          : {}),
        updatedAt: input.now,
      });
      operations.set(key, operation);
      return operation;
    },
    read,
    patch(projectId, operationId, patch, now) {
      const current = read(projectId, operationId);
      if (!current) throw new Error(`Generation operation not found: ${operationId}`);
      if (current.state !== "draft") throw new Error("new_draft_required: edit a new generation draft");
      const candidate = applyPlanCandidatePatch(current.candidate, patch);
      const next = freeze({ ...current, candidate, updatedAt: now });
      operations.set(keyFor(projectId, operationId), next);
      return next;
    },
    seal(projectId, operationId, contract, now, multiShot, authorization) {
      const current = read(projectId, operationId);
      if (!current) throw new Error(`Generation operation not found: ${operationId}`);
      if (current.state === "sealed" && current.contract?.contractHash === contract.contractHash) return current;
      if (current.state !== "draft") throw new Error("Generation operation is not editable");
      const next = freeze({
        ...current,
        candidate: { ...current.candidate, sealedContractHash: contract.contractHash },
        contract,
        state: "sealed" as const,
        // P4 S6.5: freeze the multi-shot bundle (per-shot sub-contracts + plan hash) exactly as the durable
        // reducer does. The gate projection reads these; a single-shot seal omits them (unchanged).
        ...(multiShot ? { shots: multiShot.shots.map((shot) => ({ ...shot, candidate: { ...shot.candidate } })), planHash: multiShot.planHash } : {}),
        ...(authorization
          ? {
              authorizationEnvelope: structuredClone(authorization.envelope),
              authorizationDigest: authorization.authorizationDigest,
              authorizationGateId: authorization.envelope.gateId,
              planHash: authorization.authorizationDigest,
            }
          : {}),
        updatedAt: now,
      });
      operations.set(keyFor(projectId, operationId), next);
      return next;
    },
    cancel(projectId, operationId, now) {
      const current = read(projectId, operationId);
      if (!current) throw new Error(`Generation operation not found: ${operationId}`);
      if (current.state === "submitted") throw new Error("Submitted generation cannot be cancelled as a draft");
      const next = freeze({ ...current, state: "cancelled" as const, updatedAt: now });
      operations.set(keyFor(projectId, operationId), next);
      return next;
    },
  };
}

export type GenerationPlanningHandlerDependencies = {
  registry: Pick<ModuleRegistry, "resolve"> & Partial<Pick<ModuleRegistry, "snapshot">>;
  operations: GenerationOperationStore;
  now?: () => string;
  context?: (input: { projectId: string; lease: ProjectLeaseV2 }) => unknown | Promise<unknown>;
  /**
   * Recovery capabilities are descriptive only. This resolver answers the
   * separate question of whether an executable adapter + credential exists for
   * the selected provider/model. Keeping that seam separate means a provider
   * without native recovery is still allowed to submit normally.
   */
  providerReadiness?: (input: {
    providerId: string;
    modelId: string;
    moduleId: string;
    mode: string;
  }) => { providerReady: boolean; missingForSubmit?: string[] };
  videoModelCandidates?: readonly VideoModelCandidate[];
  /** Catalog-backed saved defaults used when scriptText leaves model fields unset. */
  defaultModelForTaskKind?: (taskKind: GenerationDefaultTaskKind) => {
    moduleId: string;
    providerId: string;
    modelId: string;
    mode: string;
  } | undefined;
  recommendVideoGeneration?: (
    input: VideoGenerationRecommendationInput,
    candidates: readonly VideoModelCandidate[],
  ) => VideoGenerationRecommendationResult;
  /**
   * P4 S2: resolve the catalog pricing row for a provider/model identity (candidate.providerId maps
   * to the catalog vendorKey). preview derives per-shot single prices from it; gate_request feeds the
   * derived amount into the receipt's maximumCost (replacing the ¥0 placeholder). Omitted → preview
   * reports the price as unknown and gate_request blocks until a catalog price
   * is available; an unknown price is never represented as a zero ceiling.
   */
  resolveModelPricing?: (providerId: string, modelId: string) => ModelPricing | undefined;
  /**
   * P4 S6.5 `scriptText` 入口: turn a script into a shot list (the storyboard planner — an LLM拟稿). Called
   * only when `create` is given `scriptText` instead of `shots`. Returns per-shot declarations the handler
   * maps into draft shots. Omitted → the `scriptText` entrance is unavailable (throws a human error). Kept
   * as a seam (not inlined) so the zero-credit E2E stubs a fixed board and only the `plan` entrance runs真.
   */
  planStoryboard?: (input: {
    projectId: string;
    scriptText: string;
    minimumShots?: number;
    targetDurationSeconds?: number;
  }) => StoryboardPlanResult | Promise<StoryboardPlanResult>;
  /**
   * P4 §5.1.4 锚复用授权面: 校验 create 里引用的参考素材（复用锚 = 已有资产作 character 参考）存在且属于本项目。
   * 单镜与多镜 create 都过它（一个入口两路都堵，P2 通用性）。抛人话 Error 即拒。Omitted → 不校验（向后兼容）。
   */
  assertReferencesResolvable?: AssertReferencesResolvable;
  prepareAuthorization?: (input: {
    lease: ProjectLeaseV2;
    operation: GenerationOperation;
    contract: ExecutionContractV1;
    multiShot?: GenerationSealMultiShot;
  }) => GenerationAuthorizationPreparation | Promise<GenerationAuthorizationPreparation>;
  start?: (operation: GenerationOperation, lease: ProjectLeaseV2) => unknown | Promise<unknown>;
  reconcile?: (operation: GenerationOperation, outcome: "found" | "not_found", lease: ProjectLeaseV2) => unknown | Promise<unknown>;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function candidateFrom(value: unknown): PlanCandidate {
  const raw = record(value, "generation candidate");
  const references = Array.isArray(raw.references) ? raw.references : [];
  if (typeof raw.candidateId !== "string" || !raw.candidateId.trim()) throw new Error("Candidate id is required");
  if (typeof raw.moduleId !== "string" || typeof raw.providerId !== "string" || typeof raw.modelId !== "string" || typeof raw.mode !== "string") throw new Error("Candidate module, provider, model and mode are required");
  if (typeof raw.prompt !== "string") throw new Error("Candidate prompt is required");
  if (!Number.isInteger(raw.revision) || Number(raw.revision) < 1) throw new Error("Candidate revision must be a positive integer");
  if (raw.variantId !== undefined && (typeof raw.variantId !== "string" || !raw.variantId.trim())) throw new Error("Candidate variant id must be a non-empty string");
  if (raw.modeId !== undefined && (typeof raw.modeId !== "string" || !raw.modeId.trim())) throw new Error("Candidate mode id must be a non-empty string");
  return {
    candidateId: raw.candidateId.trim(), revision: Number(raw.revision), moduleId: raw.moduleId.trim(), providerId: raw.providerId.trim(), modelId: raw.modelId.trim(), ...(typeof raw.variantId === "string" ? { variantId: raw.variantId.trim() } : {}), ...(typeof raw.modeId === "string" ? { modeId: raw.modeId.trim() } : {}), mode: raw.mode.trim(), prompt: raw.prompt,
    parameters: record(raw.parameters ?? {}, "candidate parameters"),
    references: references.map((reference, index) => {
      const item = record(reference, `candidate reference ${index}`);
      if (typeof item.assetId !== "string" || typeof item.contentHash !== "string" || !Number.isInteger(item.version)) throw new Error(`Invalid candidate reference ${index}`);
      const kind = item.kind;
      const role = item.role;
      if (kind !== undefined && kind !== "image" && kind !== "video" && kind !== "audio") throw new Error(`Invalid candidate reference kind ${index}`);
      if (role !== undefined && role !== "character" && role !== "first_frame" && role !== "last_frame" && role !== "reference" && role !== "audio") throw new Error(`Invalid candidate reference role ${index}`);
      return {
        assetId: item.assetId,
        contentHash: item.contentHash,
        version: Number(item.version),
        ...(kind === undefined ? {} : { kind }),
        ...(role === undefined ? {} : { role }),
      };
    }),
  };
}

const RECOVERY_CAPABILITIES = ["submitIdempotency", "query", "reconcile", "cancel"] as const;

type ProviderReadiness = {
  providerReady: boolean;
  providerCapabilityProfile: GenerationProviderCapabilityProfile;
  recoveryNotice: string;
  providerCapabilitiesMissing: string[];
  missingForSubmit: string[];
};

function recoveryNotice(profile: GenerationProviderCapabilityProfile): string {
  if (profile === "full_recovery") return "可正常生成；异常时 Nomi 可以继续查询并恢复。";
  if (profile === "observe_only") return "可正常生成；如果提交结果不确定，需要到供应商核对任务，Nomi 不会自动重提。";
  return "可正常生成；如果提交结果不确定，需要你到供应商核对后再决定，Nomi 不会自动重提。";
}

function resolveProviderReadiness(
  deps: Pick<GenerationPlanningHandlerDependencies, "registry" | "providerReadiness">,
  candidate: PlanCandidate,
): ProviderReadiness {
  const resolved = deps.registry.resolve({ moduleId: candidate.moduleId, providerId: candidate.providerId, modelId: candidate.modelId, mode: candidate.mode });
  const providerCapabilitiesMissing = RECOVERY_CAPABILITIES.filter((capability) => !resolved.capabilities[capability]);
  const adapterReadiness = deps.providerReadiness?.({
    providerId: resolved.providerId,
    modelId: resolved.modelId,
    moduleId: resolved.moduleId,
    mode: resolved.mode,
  }) ?? { providerReady: true };
  return {
    providerReady: adapterReadiness.providerReady,
    providerCapabilityProfile: classifyGenerationProviderCapabilities(resolved.capabilities),
    recoveryNotice: recoveryNotice(classifyGenerationProviderCapabilities(resolved.capabilities)),
    providerCapabilitiesMissing,
    missingForSubmit: adapterReadiness.missingForSubmit ?? [],
  };
}

export function createGenerationPlanningHandler(deps: GenerationPlanningHandlerDependencies) {
  const now = deps.now ?? (() => new Date().toISOString());
  // P4 S2: derive a candidate's real per-shot price from the catalog pricing. Unknown (never a
  // fabricated 0) when there is no resolver, no pricing row, disabled pricing, or no base cost.
  const priceForCandidate = (candidate: PlanCandidate): ShotPrice =>
    deriveShotPrice({ candidate, resolvePricing: (providerId, modelId) => deps.resolveModelPricing?.(providerId, modelId) });

  /** Human "provider · model（mode）" string for the card — the renderer never re-joins provider/model. */
  const providerModelText = (candidate: PlanCandidate): string => {
    const label = deps.videoModelCandidates ? videoCandidateForPlan(candidate, deps.videoModelCandidates)?.videoCandidate.label : undefined;
    const model = label || candidate.modelId;
    return candidate.mode ? `${candidate.providerId} · ${model}（${candidate.mode}）` : `${candidate.providerId} · ${model}`;
  };

  // P4 S6.5 生产入口: the multi-shot create/seal helpers (resolveCreateShots + sealMultiShotFor) live in
  // mcpGenerationMultiShot.ts; wire them with this handler's shared derivations (all single source of truth).
  const { resolveCreateShots, sealMultiShotFor } = createMultiShotCreateHelpers({
    registry: deps.registry,
    videoModelCandidates: deps.videoModelCandidates,
    ...(deps.planStoryboard ? { planStoryboard: deps.planStoryboard } : {}),
    parsers: { candidateFrom, record },
    normalizeVideoCandidate: (candidate) => normalizeVideoCandidate(candidate, deps.videoModelCandidates),
    videoParameterSchema: (candidate) => videoParameterSchema(candidate, deps.videoModelCandidates),
    priceForCandidate,
    effectiveVideoModes,
    ...(deps.defaultModelForTaskKind ? { defaultModelForTaskKind: deps.defaultModelForTaskKind } : {}),
    ...(deps.assertReferencesResolvable ? { assertReferencesResolvable: deps.assertReferencesResolvable } : {}),
  });

  /**
   * P4 S4 — build the real multi-shot display.shots (the ASSEMBLY the S3a card was waiting on;
   * mcpGenerationTools.ts:616 "scales once shots[] is threaded through"). Projects the operation's
   * INCLUDED video shots (anchors ride separately as chips) into the serializable gate projection using
   * the same S2 pricing/degradation single source of truth. Returns undefined for a single-shot op.
   */
  const multiShotGateProjectionFor = (operation: GenerationOperation): MultiShotGateProjection | undefined => {
    if (!operation.shots || operation.shots.length === 0) return undefined;
    const includedVideo = operation.shots.filter((shot) => shot.role !== "anchor" && shot.included !== false);
    const anchors = operation.shots.filter((shot) => shot.role === "anchor" && shot.included !== false);
    if (includedVideo.length === 0) return undefined;
    const normalized = (candidate: PlanCandidate) => normalizeVideoCandidate(candidate, deps.videoModelCandidates);
    const durationValues = includedVideo.map((shot) => shotDurationSeconds(normalized(shot.candidate)));
    const totalDurationSeconds = durationValues.every((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
      ? durationValues.reduce((sum, value) => sum + value, 0)
      : undefined;
    return buildMultiShotGateProjection({
      shots: includedVideo.map((shot) => {
        const candidate = normalized(shot.candidate);
        return {
          shotId: shot.shotId,
          sceneOneLiner: candidate.prompt.slice(0, 120),
          providerModelText: providerModelText(candidate),
          candidate,
          durationSeconds: shotDurationSeconds(candidate),
          hasCharacter: candidateHasCharacterReference(candidate),
          supportsReferenceImage: modelSupportsReferenceImage(candidate, deps.videoModelCandidates),
        };
      }),
      resolvePricing: (providerId, modelId) => deps.resolveModelPricing?.(providerId, modelId),
      currency: "CNY",
      ...(operation.planVersion !== undefined ? { planVersion: operation.planVersion } : {}),
      ...(operation.planHash ? { planHash: operation.planHash } : {}),
      specs: {
        shotCount: includedVideo.length,
        ...(totalDurationSeconds === undefined ? {} : { durationSeconds: totalDurationSeconds }),
      },
      anchorChips: anchors.map((anchor) => ({ label: normalized(anchor.candidate).prompt.slice(0, 40), price: priceForCandidate(normalized(anchor.candidate)) })),
    });
  };

  return async (input: { capability: string; params: Record<string, unknown>; lease?: ProjectLeaseV2; origin?: { host: string; actorId?: string } }): Promise<unknown> => {
    if (!input.lease) throw new Error("A verified project lease is required");
    const params = input.params;
    if (input.capability === "context") {
      if (deps.context) return deps.context({ projectId: input.lease.projectId, lease: input.lease });
      const providerProfiles = (deps.registry.snapshot?.() ?? []).flatMap((manifest) => manifest.providers.map((provider) => ({
        providerId: provider.providerId,
        modelIds: provider.models.map((model) => model.modelId),
        modes: [...new Set(provider.models.flatMap((model) => model.modes))],
        capabilities: provider.models.map((model) => ({ modelId: model.modelId, ...model.capabilities })),
      })));
      const projectVideoModes = (videoCandidate: VideoModelCandidate) => effectiveVideoModes(videoCandidate).map((mode) => ({
        id: mode.id,
        intent: mode.intent,
        vendorTerm: mode.vendorTerm,
        transportTaskKind: mode.transportTaskKind,
        references: mode.slots.map((slot) => ({ kind: slot.kind, min: slot.min, max: slot.max, label: slot.label })),
        parameters: mode.params.map((parameter) => ({ key: parameter.key, type: parameter.type, options: parameter.options })),
      }));
      const videoModels = (deps.videoModelCandidates ?? []).map((videoCandidate) => ({
        providerId: videoCandidate.provider,
        modelId: videoCandidate.modelKey,
        label: videoCandidate.label,
        archetypeId: videoCandidate.archetype.id,
        ...(videoCandidate.variantId ? { variantId: videoCandidate.variantId } : {}),
        variants: (videoCandidate.variantChoices ?? []).map((variant) => ({
          ...variant,
          modes: projectVideoModes({ ...videoCandidate, variantId: variant.id }),
        })),
        modes: projectVideoModes(videoCandidate),
      }));
      return {
        projectId: input.lease.projectId,
        immutableProjectUuid: input.lease.immutableProjectUuid,
        projectGeneration: input.lease.projectGeneration,
        providerProfiles,
        ...(videoModels.length ? { videoModels } : {}),
        nextAction: "create",
      };
    }
    const operationId = typeof params.operationId === "string" && params.operationId.trim() ? params.operationId.trim() : `op-${crypto.randomUUID()}`;
    if (input.capability === "create") {
      // P4 S6.5 生产入口: a multi-shot draft is created from `shots` (client gives每镜 plan) or `scriptText`
      // (storyboard planner 拟稿). Both land the same durable draft.shots that S1 patch/preview address and
      // gate_request seals. Neither `shots` nor `scriptText` → single-shot (today, byte-identical).
      const draftShots = await resolveCreateShots(input.lease.projectId, params);
      if (draftShots) {
        const normalizedShots = draftShots.map((shot) => ({ ...shot, candidate: normalizeVideoCandidate(shot.candidate, deps.videoModelCandidates) }));
        // 顶层 candidate = 第一个 shot 的 candidate (reducer seal 硬要顶层 contract 匹配顶层 draft candidate,
        // productionRunReducer.ts generation.seal). 与 S4 e2e setup 同构 (top = shots[0]).
        const operation = await deps.operations.create({ operationId, projectId: input.lease.projectId, candidate: normalizedShots[0].candidate, shots: normalizedShots, now: now(), origin: input.origin });
        return { operation, nextAction: "preview" };
      }
      // A natural-language create request only needs `prompt`.  Keep the
      // explicit candidate path intact, but compile the short path at this
      // boundary so the model never has to invent internal candidate IDs or
      // provider wiring (the previous behavior surfaced as a false refusal).
      const singleCandidate = semanticCandidateFromParams({
        operationId,
        params,
        candidateFrom,
        ...(deps.defaultModelForTaskKind ? { defaultModelForTaskKind: deps.defaultModelForTaskKind } : {}),
        ...(deps.registry.snapshot ? { registry: deps.registry } : {}),
      });
      // P4 §5.1.4 锚复用授权面（单镜同守，P2 通用性）：单镜引用外来/不存在资产也当场拒——references 有三个入口，
      // 单镜 candidate 是其一，不能只堵多镜。多镜路已在 resolveCreateShots 内校验过。
      if (deps.assertReferencesResolvable && singleCandidate.references.length > 0) {
        deps.assertReferencesResolvable(input.lease.projectId, singleCandidate.references);
      }
      const operation = await deps.operations.create({ operationId, projectId: input.lease.projectId, candidate: normalizeVideoCandidate(singleCandidate, deps.videoModelCandidates), now: now(), origin: input.origin });
      return { operation, nextAction: "preview" };
    }
    const current = await deps.operations.read(input.lease.projectId, operationId);
    if (!current) throw new Error(`Generation operation not found: ${operationId}`);
    if (input.capability === "plan") {
      const rawPatch = record(params.patch, "generation patch") as Partial<Omit<PlanCandidate, "candidateId" | "revision">>;
      // The wire model is a derived projection. Never accept it from an MCP
      // caller; it is recomputed from the selected archetype mode/variant.
      const { transportModelId: _ignoredTransportModelId, ...userPatch } = rawPatch;
      const nextProviderId = typeof userPatch.providerId === "string" ? userPatch.providerId : current.candidate.providerId;
      const nextModelId = typeof userPatch.modelId === "string" ? userPatch.modelId : current.candidate.modelId;
      const modelChanged = normalizedModelIdentity(nextProviderId) !== normalizedModelIdentity(current.candidate.providerId)
        || normalizedModelIdentity(nextModelId) !== normalizedModelIdentity(current.candidate.modelId);
      const modeChanged = typeof userPatch.mode === "string" && normalizedModelIdentity(userPatch.mode) !== normalizedModelIdentity(current.candidate.mode);
      const mergedCandidate = {
        ...current.candidate,
        ...userPatch,
        ...(modelChanged && userPatch.variantId === undefined ? { variantId: undefined } : {}),
        ...((modelChanged || modeChanged) && userPatch.modeId === undefined ? { modeId: undefined } : {}),
        parameters: userPatch.parameters ?? current.candidate.parameters,
        references: userPatch.references ?? current.candidate.references,
      } as PlanCandidate;
      const normalizedCandidate = normalizeVideoCandidate(mergedCandidate, deps.videoModelCandidates);
      const normalizedPatch = {
        ...userPatch,
        ...(normalizedCandidate.variantId ? { variantId: normalizedCandidate.variantId } : { variantId: undefined }),
        ...(normalizedCandidate.modeId ? { modeId: normalizedCandidate.modeId } : { modeId: undefined }),
      };
      const operation = await deps.operations.patch(input.lease.projectId, operationId, normalizedPatch, now());
      // J05 — 模型/模式切换时返回 changeset，让调用方知道哪些字段被静默重置。
      const changeset = (modelChanged || modeChanged) ? {
        modelChanged, modeChanged,
        ...(modelChanged && userPatch.variantId === undefined && current.candidate.variantId ? { clearedVariantId: current.candidate.variantId } : {}),
        ...((modelChanged || modeChanged) && userPatch.modeId === undefined && current.candidate.modeId ? { clearedModeId: current.candidate.modeId } : {}),
        previousModel: `${current.candidate.providerId}/${current.candidate.modelId}`,
        nextModel: `${nextProviderId}/${nextModelId}`,
      } : undefined;
      return { operation, nextAction: "preview", ...(changeset ? { changeset } : {}) };
    }
    if (input.capability === "preview") {
      const candidate = normalizeVideoCandidate(current.candidate, deps.videoModelCandidates);
      const contract = compileExecutionContract(candidate, deps.registry, { parameterSchema: videoParameterSchema(candidate, deps.videoModelCandidates) });
      const readiness = resolveProviderReadiness(deps, candidate);
      const resolved = deps.registry.resolve({
        moduleId: candidate.moduleId,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        mode: candidate.mode,
      });
      const recommendationInput = resolved.outputKinds.includes("video")
        ? videoRecommendationInput(candidate)
        : null;
      const recommendation = recommendationInput && deps.recommendVideoGeneration && deps.videoModelCandidates
        ? deps.recommendVideoGeneration(recommendationInput, candidatesForCurrentVideoModel(candidate, deps.videoModelCandidates))
        : undefined;
      // P4 S2: this is a pure, provider-free projection; multi-shot plans use
      // every included video row and single-shot keeps the legacy one-row shape.
      const projection = projectGenerationOperationPreview(current, candidate, deps);
      return {
        operationId,
        candidateRevision: current.candidate.revision,
        contract,
        ...(recommendation ? { recommendation } : {}),
        pricing: projection,
        providerReady: readiness.providerReady,
        providerCapabilityProfile: readiness.providerCapabilityProfile,
        recoveryNotice: readiness.recoveryNotice,
        ...(readiness.providerCapabilitiesMissing.length ? { providerCapabilitiesMissing: readiness.providerCapabilitiesMissing } : {}),
        // Keep the established action vocabulary for renderer/MCP clients;
        // an unknown price remains visible in `pricing.total` and the gate
        // itself fails closed with `generation_pricing_unknown`.
        ...(readiness.providerReady ? { nextAction: "request_gate" } : { nextAction: "provider_configure" }),
      };
    }
    if (input.capability === "gate_request") {
      const candidate = normalizeVideoCandidate(current.candidate, deps.videoModelCandidates);
      const contract = compileExecutionContract(candidate, deps.registry, { parameterSchema: videoParameterSchema(candidate, deps.videoModelCandidates) });
      const readiness = resolveProviderReadiness(deps, candidate);
      if (!readiness.providerReady) throw new GenerationProviderCapabilityError(contract.providerId, readiness.missingForSubmit.length ? readiness.missingForSubmit : ["configured_provider"]);
      const gateResolved = deps.registry.resolve({ moduleId: candidate.moduleId, providerId: candidate.providerId, modelId: candidate.modelId, mode: candidate.mode }); // J06
      // P4 S6.5: a multi-shot draft seals its per-shot sub-contracts + planHash (built from the draft
      // shots) alongside the top-level contract. `sealMultiShotFor` compiles each included shot's contract
      // and the plan hash; the store forwards them to the reducer (which freezes the batch + hard cap). A
      // single-shot draft passes no bundle (byte-identical to today). Top contract = shots[0]'s contract
      // (顶层 candidate = shots[0].candidate), so the reducer's top-level match holds.
      const multiShotSeal = current.state === "draft" ? sealMultiShotFor(current) : undefined;
      // Preview may honestly show an unknown price, but a paid gate may never
      // turn that unknown into a zero ceiling or an approval prompt. Check all
      // included shots before any durable seal/authorization write so the
      // failure is atomic and the user receives an actionable pricing error.
      if (multiShotSeal) {
        for (const shot of multiShotSeal.shotPrices ?? []) {
          assertKnownShotPrice(shot.price, shot.shotId);
        }
      }
      const price = priceForCandidate(candidate);
      if (!multiShotSeal) assertKnownShotPrice(price, candidate.candidateId);
      const authorization = current.state === "draft" && deps.prepareAuthorization
        ? await deps.prepareAuthorization({ lease: input.lease, operation: current, contract, ...(multiShotSeal ? { multiShot: multiShotSeal } : {}) })
        : undefined;
      const sealed = current.state === "draft"
        ? await deps.operations.seal(input.lease.projectId, operationId, contract, now(), multiShotSeal, authorization)
        : current;
      // P4 S2: the receipt's cost ceiling is the known derived price. Unknown
      // pricing was rejected above and can never become a fabricated ¥0.
      const expiresAt = new Date(Date.parse(now()) + 10 * 60 * 1000).toISOString();
      // P4 S4: for a multi-shot operation, build the real display.shots (the S3a card's data) and use the
      // PLAN-LEVEL cost as the receipt ceiling. A single-shot op omits `shots` → flat card, unchanged.
      const multiShot = multiShotGateProjectionFor(sealed);
      if (multiShot) {
        const knownSubtotal = multiShot.shots.reduce((sum, shot) => (shot.price.known ? sum + shot.price.amount : sum), 0)
          + (multiShot.anchorChips ?? []).reduce((sum, chip) => (chip.price.known ? sum + chip.price.amount : sum), 0);
        return {
          operation: sealed,
          operationId,
          projectId: input.lease.projectId,
          // A multi-shot receipt is keyed on the PLAN hash (covers the whole batch — §1).
          contractHash: sealed.authorizationDigest ?? sealed.planHash ?? contract.contractHash,
          model: `${contract.providerId}/${contract.modelId}`,
          referenceCount: contract.references.length,
          costScope: sealed.authorizationEnvelope?.costScope ?? `generation.multi-shot:${operationId}`,
          maximumCost: sealed.authorizationEnvelope?.budget.maximum ?? knownSubtotal,
          costKnown: multiShot.shots.every((shot) => shot.price.known),
          currency: "CNY",
          expiresAt,
          shotSummary: multiShot.shots[0]?.sceneOneLiner ?? contract.prompt.slice(0, 120),
          // The full projection rides here → dispatcher threads it into the MAC-signed challenge display.shots.
          // hardLimit = the estimated plan total (the natural ceiling shown on the card); the scheduler
          // enforces the real cap = min(this, policy.maxSpend) at reserve time (§3.3).
          shots: { ...multiShot, hardLimit: knownSubtotal, ...coldstartEtaForGate(gateResolved.outputKinds, multiShot.shots.length || 1), frozenItems: ["shots", "models", "references", "price"], expiresAt }, // J06 诚实 ETA
          providerReady: readiness.providerReady,
          providerCapabilityProfile: readiness.providerCapabilityProfile,
          recoveryNotice: readiness.recoveryNotice,
          ...(readiness.providerCapabilitiesMissing.length ? { providerCapabilitiesMissing: readiness.providerCapabilitiesMissing } : {}),
          nextAction: "confirm",
        };
      }
      return {
        operation: sealed,
        operationId,
        projectId: input.lease.projectId,
        contractHash: sealed.authorizationDigest ?? contract.contractHash,
        model: `${contract.providerId}/${contract.modelId}`,
        referenceCount: contract.references.length,
        costScope: sealed.authorizationEnvelope?.costScope ?? `generation.single-shot:${operationId}`,
        maximumCost: sealed.authorizationEnvelope?.budget.maximum ?? (price.known ? price.amount : 0),
        costKnown: price.known,
        currency: "CNY",
        expiresAt,
        shotSummary: contract.prompt.slice(0, 120),
        providerReady: readiness.providerReady,
        providerCapabilityProfile: readiness.providerCapabilityProfile,
        recoveryNotice: readiness.recoveryNotice,
        ...(readiness.providerCapabilitiesMissing.length ? { providerCapabilitiesMissing: readiness.providerCapabilitiesMissing } : {}),
        nextAction: "confirm",
      };
    }
    if (input.capability === "gate_decide") {
      throw new Error("Generation gate decisions must use the Run-owned authorization seam");
    }
    if (input.capability === "start") {
      // The Host gate adapter starts immediately after the verified receipt is
      // committed. A model may still issue its explicit start tool on the next
      // turn; treat that replay as an observation instead of attempting a
      // second provider submission.
      if (current.state === "submitted") return { operation: current, operationId, nextAction: "observe" };
      if (current.state !== "sealed" || !current.contract || !current.approvedReceiptId) throw new Error("Confirm the generation plan before starting");
      return deps.start?.(current, input.lease) ?? { operationId, state: current.state, nextAction: "provider_not_configured" };
    }
    if (input.capability === "cancel") return { operation: await deps.operations.cancel(input.lease.projectId, operationId, now()), nextAction: "create" };
    if (input.capability === "reconcile") {
      const outcome = params.outcome === "found" || params.outcome === "not_found" ? params.outcome : null;
      if (!outcome) throw new Error("Reconciliation outcome is required");
      return deps.reconcile?.(current, outcome, input.lease) ?? { operationId, outcome, nextAction: outcome === "found" ? "observe" : "manual_review" };
    }
    if (input.capability === "read" || input.capability === "events" || input.capability === "steer") return { operation: current, nextAction: current.state === "draft" ? "preview" : "observe" };
    throw new Error(`Unsupported semantic generation capability: ${input.capability}`);
  };
}
