// 生成家族的动词声明：`nomi_generation_plan` / `nomi_generation_status`（执行那一半住
// `electron/capabilityCore/generationTransportAdapters.ts`），以及模型目录读 `nomi_read`
// （执行那一半住 `electron/agentLane/laneNativeAssembly.mts`，按 `availableModels` 解析）。
//
// `nomi_generation_plan` 今天是**唯一**会把付费确认卡摆到用户面前的门（09-10 拍板：草稿建即落画布、
// 付费卡 = 介入槽一张卡；`generationTransportAdapters.ts` 给 Run 打 `origin.host="nomi"`），所以它的
// `nextAction` 是 `user_sees_spend_card`——后果句由表派生，旧描述里那句
// "This host cannot preview or start paid generation"（审计 M2/M3）从此写不出来。
import { z } from "zod";

import { flattenDiscriminatedUnion } from "../flatModelInput";
import { generationPlanSchemaForHost, generationStatusInputSchema, GENERATION_CREATE_EXAMPLE } from "../generationPlanSchemas";
import { modelArgumentTolerance } from "../modelArgumentTolerance";
import type { VerbDeclaration } from "../verbDeclaration";

const GENERATION_GUIDELINES = Object.freeze([
  "Identifiers for generation (moduleId, providerId, modelId, mode, modeId) must be copied from a context read or from nomi_read; inventing one is the single most common way a generation call fails.",
]);

/** `nomi_read` 的模型可见 schema（与原 TypeBox 定义逐字段相同：target 只认 models，modelKey 可选收窄）。 */
const modelReadSchema = z.object({
  target: z.enum(["models"]).describe("Only models is supported; the tool reads the user's connected model catalog."),
  modelKey: z.string().optional().describe("Optional catalog key to narrow the result to one model."),
}).strict();

export function generationVerbs(): VerbDeclaration[] {
  const plan: VerbDeclaration = {
    name: "nomi_generation_plan",
    contractId: "generation.plan",
    effect: "reversible_local",
    nextAction: "user_sees_spend_card",
    internalGroup: "generation",
    profiles: ["internal"],
    profileReason: "mcpHandwrittenTransport",
    effectGroups: ["canvas-node-creation"],
    operationCapabilityIds: { context: "generation.context.read", create: "generation.plan", patch: "generation.plan" },
    describe: {
      does: "Create or revise one generation draft for an image, video, audio or 3D shot the user described.",
      useWhen: "Use it whenever the user asks to generate, make, draw, render, regenerate or restyle any media, including a single image. operation context first reads what models, modes and parameters this project actually offers (taskKind narrows it, scope full returns details); operation create turns a described shot into a draft node on the canvas; operation patch revises a draft you already created.",
      notWhen: "Do not use nomi_canvas_write to make media — it only arranges canvas objects and a node it creates for media stays empty. Do not use nomi_storyboard_write for one described shot; use it only when the user asked for a whole storyboard. Do not use start_production_run for a concrete image or video request, and do not use materialize_production_storyboard to put shots on the canvas unless they come from an approved production artifact. To check or cancel a draft that is already running use nomi_generation_status.",
      params: "Identifiers (moduleId, providerId, modelId, mode) must be copied from a context read or from nomi_read. For create, pass either a candidate or shots plus scriptText; for patch, pass the operationId returned by create and the fields to change.",
    },
    promptGuidelines: GENERATION_GUIDELINES,
    schema: flattenDiscriminatedUnion(generationPlanSchemaForHost({ preview: false }), { name: "generation plan" }),
    examples: [{ when: "Create a draft (use identifiers from context):", arguments: GENERATION_CREATE_EXAMPLE }],
    prepareArguments: modelArgumentTolerance({ arrayFields: ["shots", "references"], objectFields: ["candidate", "parameters", "patch"] }),
  };

  const status: VerbDeclaration = {
    name: "nomi_generation_status",
    contractId: "generation.control",
    effect: "reversible_local",
    nextAction: "none",
    internalGroup: "generation",
    profiles: ["internal"],
    profileReason: "mcpHandwrittenTransport",
    effectGroups: ["job-status-cancel"],
    operationCapabilityIds: { read: "generation.run.read", cancel: "generation.control", reconcile: "generation.control" },
    describe: {
      does: "Read, cancel, or reconcile one generation operation started from the canvas.",
      useWhen: "Use it when the user asks whether a generation is done, what it cost, or to stop it; read the status before cancelling or reconciling.",
      notWhen: "Do not use it for a production run — anything started with start_production_run is read with get_production_run and controlled with control_production_run. Do not use it to create or change a draft (nomi_generation_plan). Never retry unknown provider work or resubmit a draft from here.",
      params: "operationId comes from the nomi_generation_plan create result; reconcile also needs outcome (found or not_found) after you checked the provider yourself.",
    },
    promptGuidelines: GENERATION_GUIDELINES,
    schema: flattenDiscriminatedUnion(generationStatusInputSchema, { name: "generation status" }),
    examples: [{ when: "Read the current task:", arguments: { operation: "read", operationId: "run-1" } }],
    prepareArguments: modelArgumentTolerance({}),
  };

  return [plan, status];
}

function modelCatalogVerb(): VerbDeclaration {
  return {
    name: "nomi_read",
    contractId: "generation.context.read",
    effect: "read",
    nextAction: "none",
    internalGroup: "models",
    profiles: ["internal"],
    profileReason: "mcpHandwrittenTransport",
    describe: {
      does: "Read the connected model catalog: every model's modes, parameters and reference slots.",
      useWhen: "Use it before choosing a modelKey, a parameter or a reference edge for a shot, and when the user asks which models can do something.",
      notWhen: "Do not use it to create a draft (nomi_generation_plan) or to read what is on the canvas (nomi_canvas_read). It cannot connect a model or take an API key.",
      params: "target must be models; modelKey optionally narrows the catalog to one model before you pick parameters or references.",
    },
    promptGuidelines: GENERATION_GUIDELINES,
    schema: modelReadSchema,
    examples: [{ when: "List every connected model:", arguments: { target: "models" } }],
    prepareArguments: modelArgumentTolerance({}),
  };
}

/** 模型目录读——单独导出，因为它在目录里排最后（`models` 组曾由原生装配层追加在末尾）。 */
export function modelCatalogVerbs(): VerbDeclaration[] {
  return [modelCatalogVerb()];
}
