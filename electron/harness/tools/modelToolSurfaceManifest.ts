import { z } from "zod";
import type { ZodTypeAny } from "zod";
import { GENERATION_RECONCILE_OUTCOMES } from "../../capabilityCore/mcpGenerationTools";

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

/** Host/UI transitions are wire contracts, never model-authored tools. */
export const GENERATION_HOST_ONLY_TRANSITIONS: readonly HostOnlyTransition[] = Object.freeze([
  { name: "nomi_request_generation_gate", capabilityRefs: ["generation.gate"], reason: "Host policy creates the user confirmation card." },
  { name: "nomi_start_generation", capabilityRefs: ["generation.gate"], reason: "Host starts the approved effect after receipt settlement." },
  { name: "nomi_decide_generation_gate", capabilityRefs: ["generation.gate"], reason: "Only a verified Host/UI receipt can decide the gate." },
]);

export const modelToolSurfaceManifest = Object.freeze({
  version: "m2-generation-v1",
  generation: Object.freeze(generationDescriptors),
});

const modelNames = new Set<string>(modelToolSurfaceManifest.generation.map(({ name }) => name));
if (modelNames.size !== modelToolSurfaceManifest.generation.length) throw new Error("Duplicate semantic model tool");
for (const transition of GENERATION_HOST_ONLY_TRANSITIONS) {
  if (modelNames.has(transition.name)) throw new Error(`Host-only transition leaked into model surface: ${transition.name}`);
}
