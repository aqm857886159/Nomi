import crypto from "node:crypto";

import type { ResolvedModule } from "./moduleRegistry";
import type { ParameterField } from "./moduleManifest";

export const EXECUTION_CONTRACT_SCHEMA_VERSION = 1 as const;

export type PlanAssetReference = {
  assetId: string;
  contentHash: string;
  version: number;
  kind?: "image" | "video" | "audio";
  role?: "character" | "first_frame" | "last_frame" | "reference" | "audio";
};

export type PlanCandidate = {
  candidateId: string;
  revision: number;
  moduleId: string;
  providerId: string;
  modelId: string;
  variantId?: string;
  /** Stable source-archetype mode id (for example `firstlast` or `omni`).
   * The transport `mode` remains the catalog task kind; keeping both prevents
   * several modes that share one task kind from being silently conflated. */
  modeId?: string;
  /** Provider wire model derived from the selected variant/mode. This is an
   * internal, validated projection; callers must not invent it. */
  transportModelId?: string;
  mode: string;
  prompt: string;
  parameters: Record<string, unknown>;
  references: PlanAssetReference[];
  sealedContractHash?: string;
};

export type DroppedField = { path: string; reason: "unsupported_parameter" | "invalid_parameter" };

export type ExecutionContractV1 = {
  schemaVersion: typeof EXECUTION_CONTRACT_SCHEMA_VERSION;
  candidateId: string;
  candidateRevision: number;
  moduleId: string;
  moduleVersion: string;
  providerId: string;
  modelId: string;
  variantId?: string;
  modeId?: string;
  transportModelId?: string;
  mode: string;
  prompt: string;
  parameters: Record<string, unknown>;
  references: PlanAssetReference[];
  contractHash: string;
  warnings: string[];
  droppedFields: DroppedField[];
};

export class ContractCompilationError extends Error {
  readonly code = "contract_invalid" as const;

  constructor(message: string) {
    super(message);
    this.name = "ContractCompilationError";
  }
}

export class NewDraftRequiredError extends Error {
  readonly code = "new_draft_required" as const;

  constructor() {
    super("new_draft_required: the sealed generation must remain unchanged; edit a new draft");
    this.name = "NewDraftRequiredError";
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ContractCompilationError("Contract values must contain finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  throw new ContractCompilationError("Contract values must be JSON serializable");
}

function hashContract(value: Omit<ExecutionContractV1, "contractHash" | "warnings" | "droppedFields">): string {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function parameterMatches(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
    case "enum": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "object": return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    default: return false;
  }
}

function compileParameters(candidate: PlanCandidate, module: ResolvedModule): { parameters: Record<string, unknown>; warnings: string[]; droppedFields: DroppedField[] } {
  const parameters: Record<string, unknown> = {};
  const warnings: string[] = [];
  const droppedFields: DroppedField[] = [];
  for (const [key, value] of Object.entries(candidate.parameters)) {
    const field = module.parameterSchema[key];
    if (!field) {
      droppedFields.push({ path: `parameters.${key}`, reason: "unsupported_parameter" });
      warnings.push(`参数 ${key} 不被 ${module.providerId}/${module.modelId} 支持，已从合同中移除`);
      continue;
    }
    if (!parameterMatches(field.type, value) || (field.enum && !field.enum.some((option) => Object.is(option, value)))) {
      droppedFields.push({ path: `parameters.${key}`, reason: "invalid_parameter" });
      throw new ContractCompilationError(`参数 parameters.${key} 不符合当前模型的声明`);
    }
    parameters[key] = value;
  }
  for (const [key, field] of Object.entries(module.parameterSchema)) {
    if (field.required && !(key in parameters)) throw new ContractCompilationError(`缺少必填参数 parameters.${key}`);
  }
  return { parameters, warnings, droppedFields };
}

export type ExecutionContractCompileOptions = {
  /** Optional source-backed parameter projection (for example a selected video variant). */
  parameterSchema?: Record<string, ParameterField>;
};

export function compileExecutionContract(
  candidate: PlanCandidate,
  registry: { resolve(input: { moduleId: string; providerId: string; modelId: string; mode: string }): ResolvedModule },
  options: ExecutionContractCompileOptions = {},
): ExecutionContractV1 {
  if (!Number.isInteger(candidate.revision) || candidate.revision < 1) throw new ContractCompilationError("Candidate revision must be a positive integer");
  if (!candidate.prompt.trim()) throw new ContractCompilationError("Prompt is required");
  if (candidate.variantId !== undefined && !candidate.variantId.trim()) throw new ContractCompilationError("Variant id must not be empty");
  if (candidate.modeId !== undefined && !candidate.modeId.trim()) throw new ContractCompilationError("Mode id must not be empty");
  if (candidate.transportModelId !== undefined && !candidate.transportModelId.trim()) throw new ContractCompilationError("Transport model id must not be empty");
  if (candidate.sealedContractHash) throw new NewDraftRequiredError();
  const module = registry.resolve({ moduleId: candidate.moduleId, providerId: candidate.providerId, modelId: candidate.modelId, mode: candidate.mode });
  if (candidate.references.length > (module.assetInputSchema.references?.max ?? Number.MAX_SAFE_INTEGER)) {
    throw new ContractCompilationError("参考素材数量超过当前模式支持的上限");
  }
  const effectiveModule = options.parameterSchema ? { ...module, parameterSchema: options.parameterSchema } : module;
  const { parameters, warnings, droppedFields } = compileParameters(candidate, effectiveModule);
  const semantic = {
    schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
    candidateId: candidate.candidateId,
    candidateRevision: candidate.revision,
    moduleId: module.moduleId,
    moduleVersion: module.version,
    providerId: module.providerId,
    modelId: module.modelId,
    ...(candidate.variantId ? { variantId: candidate.variantId.trim() } : {}),
    ...(candidate.modeId ? { modeId: candidate.modeId.trim() } : {}),
    ...(candidate.transportModelId ? { transportModelId: candidate.transportModelId.trim() } : {}),
    mode: module.mode,
    prompt: candidate.prompt,
    parameters,
    references: candidate.references.map((reference) => ({ ...reference })),
  } satisfies Omit<ExecutionContractV1, "contractHash" | "warnings" | "droppedFields">;
  return { ...semantic, contractHash: hashContract(semantic), warnings, droppedFields };
}

export function applyPlanCandidatePatch(candidate: PlanCandidate, patch: Partial<Omit<PlanCandidate, "candidateId" | "revision">>): PlanCandidate {
  if (candidate.sealedContractHash) throw new NewDraftRequiredError();
  const next = {
    ...structuredClone(candidate),
    ...structuredClone(patch),
    revision: candidate.revision + 1,
    parameters: patch.parameters ? structuredClone(patch.parameters) : structuredClone(candidate.parameters),
    references: patch.references ? structuredClone(patch.references) : structuredClone(candidate.references),
  };
  // `transportModelId` is a derived wire projection, never a user-editable
  // field. A provider/model/mode/variant edit invalidates the old projection;
  // the semantic normalizer will derive a fresh value before sealing.
  const identityChanged = patch.providerId !== undefined
    || patch.modelId !== undefined
    || patch.variantId !== undefined
    || patch.mode !== undefined
    || patch.modeId !== undefined;
  if (identityChanged) delete next.transportModelId;
  else if (candidate.transportModelId) next.transportModelId = candidate.transportModelId;
  else delete next.transportModelId;
  return next;
}
