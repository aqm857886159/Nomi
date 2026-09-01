import { z } from "zod";
import type { AgentToolDescriptor } from "./agentToolCatalog";
import { GENERATION_RECONCILE_OUTCOMES } from "../../capabilityCore/mcpGenerationTools";

const reference = z.object({
  assetId: z.string().trim().min(1),
  contentHash: z.string().trim().min(1),
  version: z.number().int().min(1),
  kind: z.enum(["image", "video", "audio"]).optional(),
  role: z.enum(["character", "first_frame", "last_frame", "reference", "audio"]).optional(),
}).strict();

const candidatePatch = z.object({
  prompt: z.string().optional(),
  taskKind: z.enum(["text_to_image", "image_edit", "text_to_video", "image_to_video"]).optional(),
  moduleId: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  mode: z.string().optional(),
  modeId: z.string().optional(),
  variantId: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
  references: z.array(reference).optional(),
}).strict();

const operationCreate = z.object({
  prompt: z.string().trim().min(1).optional(),
  taskKind: z.enum(["text_to_image", "image_edit", "text_to_video", "image_to_video"]).optional(),
  moduleId: z.string().trim().min(1).optional(),
  providerId: z.string().trim().min(1).optional(),
  modelId: z.string().trim().min(1).optional(),
  mode: z.string().trim().min(1).optional(),
  modeId: z.string().trim().min(1).optional(),
  variantId: z.string().trim().min(1).optional(),
  parameters: z.record(z.unknown()).optional(),
  references: z.array(reference).optional(),
  candidate: z.record(z.unknown()).optional(),
  shots: z.array(z.object({
    shotId: z.string().trim().min(1).optional(),
    role: z.enum(["anchor", "shot"]).optional(),
    included: z.boolean().optional(),
    candidate: z.record(z.unknown()).optional(),
    prompt: z.string().trim().min(1).optional(),
    taskKind: z.enum(["text_to_image", "image_edit", "text_to_video", "image_to_video"]).optional(),
    modelId: z.string().trim().min(1).optional(),
    mode: z.string().trim().min(1).optional(),
    modeId: z.string().trim().min(1).optional(),
    variantId: z.string().trim().min(1).optional(),
    parameters: z.record(z.unknown()).optional(),
    references: z.array(reference).optional(),
  }).strict()).optional(),
  scriptText: z.string().trim().min(1).optional(),
}).strict();

const operationId = z.object({ operationId: z.string().trim().min(1) }).strict();
const plan = operationId.extend({ patch: candidatePatch });
const reconcile = operationId.extend({ outcome: z.enum(GENERATION_RECONCILE_OUTCOMES) });

/**
 * Model-facing generation vocabulary. Project and lease fields deliberately
 * stay out of these schemas: the resident Host injects the verified binding.
 * `nomi_decide_generation_gate` is intentionally not projected; receipt
 * exchange belongs to the one Nomi confirmation card, not model-authored JSON.
 */
export const generationToolDescriptors: Readonly<Record<string, AgentToolDescriptor>> = Object.freeze({
  nomi_get_generation_context: {
    name: "nomi_get_generation_context",
    description: "读取当前项目可用的图片、视频模型、模式、参数和参考素材；不花费额度。",
    parameters: z.object({}).strict(),
  },
  nomi_operation_create: {
    name: "nomi_operation_create",
    description: "创建可编辑的生成计划。通常只需提供 prompt；模型、模式和默认参数从 Nomi 设置读取，不会提交或花费额度。分钟级/成片请求会自动先走剧本→分镜→片段计划；也可显式传 scriptText 或 shots。",
    parameters: operationCreate,
  },
  nomi_submit_generation_plan: {
    name: "nomi_submit_generation_plan",
    description: "修改生成计划中的提示词、模型、模式、参考图或参数；只保存草稿，不提交供应商。",
    parameters: plan,
  },
  nomi_preview_execution: {
    name: "nomi_preview_execution",
    description: "展示即将使用的模型、模式、参数、参考素材和预计费用；不会调用供应商。",
    parameters: operationId,
  },
  nomi_request_generation_gate: {
    name: "nomi_request_generation_gate",
    description: "打开一张简短的 Nomi 确认卡。用户确认后才会产生付费任务；用户拒绝或修改都不会提交。",
    parameters: operationId,
  },
  nomi_start_generation: {
    name: "nomi_start_generation",
    description: "在用户确认计划后开始生成，并返回真实任务、产物和状态；不会重复提交已存在的任务。",
    parameters: operationId,
  },
  nomi_operation_read: {
    name: "nomi_operation_read",
    description: "读取生成计划、任务、产物和当前状态。",
    parameters: operationId,
  },
  nomi_cancel_generation: {
    name: "nomi_cancel_generation",
    description: "取消尚未提交的生成计划，或请求对已提交任务进入可核账的取消流程。",
    parameters: operationId,
  },
  nomi_reconcile_generation: {
    name: "nomi_reconcile_generation",
    description: "核对供应商提交结果；结果未知时只做核账，不会盲目重提。",
    parameters: reconcile,
  },
});
