import { z } from "zod";
import type { ZodTypeAny } from "zod";
import { GENERATION_RECONCILE_OUTCOMES } from "../../capabilityCore/mcpGenerationTools";
import { timelineEditPlanSchema } from "../../shared/agentCapabilities/timelineRead";

export type SemanticToolDescriptor = Readonly<{
  name: `nomi_${string}`;
  version: number;
  intent: string;
  capabilityRefs: readonly string[];
  inputSchema: ZodTypeAny;
  outputSchema: ZodTypeAny;
  sideEffect: "none" | "proposal" | "external";
  execution: "parallel" | "sequential";
  risk: "read" | "project_write" | "paid_external";
  disclosure: "eager" | "deferred";
  availability: Readonly<{ phases: readonly string[]; requiredScopes: readonly string[] }>;
}>;

type HostOnlyTransition = Readonly<{
  name: string;
  capabilityRefs: readonly string[];
  reason: string;
}>;

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

const createFields = {
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
} as const;

const operationId = z.string().trim().min(1);

export const generationPlanInputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("context") }).strict(),
  z.object({ operation: z.literal("create"), ...createFields }).strict(),
  z.object({ operation: z.literal("patch"), operationId, patch: candidatePatch }).strict(),
  z.object({ operation: z.literal("preview"), operationId }).strict(),
]);

export const generationStatusInputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("read"), operationId }).strict(),
  z.object({ operation: z.literal("cancel"), operationId }).strict(),
  z.object({ operation: z.literal("reconcile"), operationId, outcome: z.enum(GENERATION_RECONCILE_OUTCOMES) }).strict(),
]);

const descriptorDefaults = {
  version: 1,
  sideEffect: "proposal" as const,
  execution: "sequential" as const,
  disclosure: "eager" as const,
  availability: { phases: ["generation"], requiredScopes: ["project:bound"] },
};

const generationDescriptors = [
  {
    ...descriptorDefaults,
    name: "nomi_generation_plan" as const,
    intent: "Form and revise one editable generation plan, then preview its proposed execution.",
    capabilityRefs: ["generation.context.read", "generation.plan"],
    inputSchema: generationPlanInputSchema,
    outputSchema: z.unknown(),
    risk: "project_write" as const,
  },
  {
    ...descriptorDefaults,
    name: "nomi_generation_status" as const,
    intent: "Read or reconcile the state and artifacts of one generation operation, or request a controlled cancellation.",
    capabilityRefs: ["generation.run.read", "generation.control"],
    inputSchema: generationStatusInputSchema,
    outputSchema: z.unknown(),
    risk: "read" as const,
  },
] as const satisfies readonly SemanticToolDescriptor[];

const editingDescriptors = [
  {
    version: 1,
    name: "nomi_timeline_read" as const,
    intent: "Read the current timeline or a bounded frame range without changing the project.",
    capabilityRefs: ["timeline.read"],
    inputSchema: z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("read") }).strict(),
      z.object({ operation: z.literal("range"), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }).strict(),
    ]),
    outputSchema: z.unknown(),
    sideEffect: "none" as const,
    execution: "parallel" as const,
    risk: "read" as const,
    disclosure: "eager" as const,
    availability: { phases: ["editing"], requiredScopes: ["timeline:read"] },
  },
  {
    version: 1,
    name: "nomi_timeline_edit" as const,
    intent: "Preview, apply, or undo one revision-guarded timeline edit plan through Host approval.",
    capabilityRefs: ["timeline.read", "timeline.write"],
    inputSchema: z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("preview"), plan: timelineEditPlanSchema }).strict(),
      z.object({ operation: z.literal("apply"), plan: timelineEditPlanSchema }).strict(),
      z.object({ operation: z.literal("undo"), undoToken: z.string().trim().min(1), expectedRevision: z.string().trim().min(1), reason: z.string().trim().max(300).optional() }).strict(),
    ]),
    outputSchema: z.unknown(),
    sideEffect: "proposal" as const,
    execution: "sequential" as const,
    risk: "project_write" as const,
    disclosure: "eager" as const,
    availability: { phases: ["editing"], requiredScopes: ["timeline:read", "timeline:write"] },
  },
  {
    version: 1,
    name: "nomi_export_job" as const,
    intent: "Inspect or verify an export job receipt; starting and cancelling exports remain Host-only.",
    capabilityRefs: ["export.read", "export.write"],
    inputSchema: z.object({ operation: z.enum(["status", "verify"]), jobId: z.string().trim().min(1) }).strict(),
    outputSchema: z.unknown(),
    sideEffect: "none" as const,
    execution: "parallel" as const,
    risk: "read" as const,
    disclosure: "eager" as const,
    availability: { phases: ["editing"], requiredScopes: ["export:read"] },
  },
  {
    version: 1,
    name: "nomi_media_query" as const,
    intent: "Query project media, technical metadata, source usage, or waveform data without changing the project.",
    capabilityRefs: ["asset.read"],
    inputSchema: z.object({ operation: z.enum(["list", "get", "inspect", "search", "source_range", "waveform"]), assetId: z.string().trim().min(1).optional(), query: z.string().max(200).optional(), kinds: z.array(z.enum(["image", "video", "audio"])).max(3).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
    outputSchema: z.unknown(),
    sideEffect: "none" as const,
    execution: "parallel" as const,
    risk: "read" as const,
    disclosure: "deferred" as const,
    availability: { phases: ["editing"], requiredScopes: ["asset:read"] },
  },
] as const satisfies readonly SemanticToolDescriptor[];

/** Host/UI transitions are wire contracts, never model-authored tools. */
export const GENERATION_HOST_ONLY_TRANSITIONS: readonly HostOnlyTransition[] = Object.freeze([
  { name: "nomi_request_generation_gate", capabilityRefs: ["generation.gate"], reason: "Host policy creates the user confirmation card." },
  { name: "nomi_start_generation", capabilityRefs: ["generation.gate"], reason: "Host starts the approved effect after receipt settlement." },
  { name: "nomi_decide_generation_gate", capabilityRefs: ["generation.gate"], reason: "Only a verified Host/UI receipt can decide the gate." },
]);

export const modelToolSurfaceManifest = Object.freeze({
  version: "m2-generation-editing-v1",
  generation: Object.freeze(generationDescriptors),
  editing: Object.freeze(editingDescriptors),
});

const modelSurface = [...modelToolSurfaceManifest.generation, ...modelToolSurfaceManifest.editing];
const modelNames = new Set<string>(modelSurface.map(({ name }) => name));
if (modelNames.size !== modelSurface.length) throw new Error("Duplicate semantic model tool");
for (const transition of GENERATION_HOST_ONLY_TRANSITIONS) {
  if (modelNames.has(transition.name)) throw new Error(`Host-only transition leaked into model surface: ${transition.name}`);
}
