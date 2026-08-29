import type { ProductionExecutionBinding } from "../productionRun/productionExecutionBinding";
import {
  assertProductionGenerationPayloadHash,
  productionGenerationPayloadHash,
} from "../productionRun/productionGenerationAuthorization";
import type { ExecutionContractV1 } from "./executionContract";
import { assertGenerationProviderCanSubmit } from "./generationProviderCapabilities";

export type ResolvedTaskRequestV1 = {
  moduleId: string;
  providerId: string;
  modelId: string;
  variantId?: string;
  mode: string;
  prompt: string;
  parameters: Record<string, unknown>;
  references: ExecutionContractV1["references"];
  contractHash: string;
  idempotencyKey: string;
  requestFingerprint: string;
  executionBinding: ProductionExecutionBinding;
};

export type GenerationProviderCapabilities = {
  submitIdempotency: boolean;
  query: boolean;
  reconcile: boolean;
  cancel: boolean;
  /** Provider-owned extraction of a terminal task into downloadable outputs. */
  materialize?: boolean;
};

export type GenerationProviderOutput = {
  kind: "image" | "video" | "audio";
  url: string;
  contentType?: string;
  fileName?: string;
  providerOutputId?: string;
};

export type GenerationProviderMaterializationResult = {
  outputs: readonly GenerationProviderOutput[];
  raw?: unknown;
};

export type GenerationProvider = {
  providerId: string;
  capabilities: GenerationProviderCapabilities;
  buildRequest: (input: ResolvedTaskRequestV1) => unknown;
  submit: (request: unknown, idempotencyKey: string) => Promise<{ providerTaskId: string; raw?: unknown }>;
  query?: (providerTaskId: string) => Promise<{ status: string; raw?: unknown }>;
  reconcile?: (input: { idempotencyKey: string; providerTaskId?: string }) => Promise<{ found: boolean; providerTaskId?: string; raw?: unknown }>;
  materialize?: (input: { providerTaskId: string; raw?: unknown }) => Promise<GenerationProviderMaterializationResult>;
  cancel?: (providerTaskId: string) => Promise<{ status: "cancelled_remote" | "too_late" | "detached"; raw?: unknown }>;
};

export type GenerationProviderQueryResult = {
  status: string;
  raw?: unknown;
};

export type GenerationProviderReconcileResult = {
  found: boolean;
  providerTaskId?: string;
  raw?: unknown;
};

export class GenerationProviderCapabilityError extends Error {
  readonly code = "provider_capability_missing" as const;

  constructor(providerId: string, missing: string[]) {
    super(`Provider ${providerId} lacks required recovery capabilities: ${missing.join(", ")}`);
    this.name = "GenerationProviderCapabilityError";
  }
}

export class GenerationRuntimeBindingError extends Error {
  readonly code = "execution_binding_mismatch" as const;

  constructor(message: string) {
    super(message);
    this.name = "GenerationRuntimeBindingError";
  }
}

export class GenerationProviderRequestError extends Error {
  readonly code = "provider_request_unstable" as const;

  constructor(message: string) {
    super(message);
    this.name = "GenerationProviderRequestError";
  }
}

export class GenerationProviderObservationError extends Error {
  readonly code = "provider_observation_unsupported" as const;

  constructor(providerId: string, operation: "query" | "reconcile" | "materialize") {
    super(`Provider ${providerId} does not expose ${operation} for recovery`);
    this.name = "GenerationProviderObservationError";
  }
}

export function assertGenerationProviderCapabilities(provider: GenerationProvider): void {
  const missing = (["submitIdempotency", "query", "reconcile", "cancel"] as const)
    .filter((capability) => !provider.capabilities[capability]);
  if (missing.length > 0) throw new GenerationProviderCapabilityError(provider.providerId, missing);
}

export function resolveExecutionContract(contract: ExecutionContractV1, binding: ProductionExecutionBinding): ResolvedTaskRequestV1 {
  if (contract.contractHash !== binding.contractHash) throw new GenerationRuntimeBindingError("Contract hash does not match the sealed execution binding");
  if (contract.providerId !== binding.providerNamespace) throw new GenerationRuntimeBindingError("Provider namespace does not match the sealed execution binding");
  return {
    moduleId: contract.moduleId,
    providerId: contract.providerId,
    modelId: contract.modelId,
    ...(contract.variantId ? { variantId: contract.variantId } : {}),
    mode: contract.mode,
    prompt: contract.prompt,
    parameters: structuredClone(contract.parameters),
    references: structuredClone(contract.references),
    contractHash: contract.contractHash,
    idempotencyKey: binding.providerIdempotencyKey,
    requestFingerprint: binding.requestFingerprint,
    executionBinding: structuredClone(binding),
  };
}

export function createGenerationRuntimeAdapter(deps: { providers: readonly GenerationProvider[] }) {
  const providers = new Map<string, GenerationProvider>();
  for (const provider of deps.providers) {
    if (providers.has(provider.providerId)) throw new Error(`Duplicate generation provider: ${provider.providerId}`);
    providers.set(provider.providerId, provider);
  }

  function prepare(input: { contract: ExecutionContractV1; binding: ProductionExecutionBinding }): Readonly<{
    request: ResolvedTaskRequestV1;
    providerRequest: unknown;
    providerRequestHash: string;
  }> {
    const request = resolveExecutionContract(input.contract, input.binding);
    const provider = providers.get(request.providerId);
    if (!provider) throw new GenerationProviderCapabilityError(request.providerId, ["registered_provider"]);
    assertGenerationProviderCanSubmit(provider);
    const first = provider.buildRequest(structuredClone(request));
    const second = provider.buildRequest(structuredClone(request));
    const firstHash = productionGenerationPayloadHash(first);
    if (productionGenerationPayloadHash(second) !== firstHash) {
      throw new GenerationProviderRequestError("Provider buildRequest must be deterministic before approval");
    }
    return Object.freeze({ request, providerRequest: structuredClone(first), providerRequestHash: firstHash });
  }

  async function submit(input: {
    contract: ExecutionContractV1;
    binding: ProductionExecutionBinding;
    expectedProviderRequestHash?: string;
  }): Promise<{ providerTaskId: string; raw?: unknown; request: ResolvedTaskRequestV1; providerRequestHash: string }> {
    const prepared = prepare(input);
    if (input.expectedProviderRequestHash) {
      assertProductionGenerationPayloadHash(prepared.providerRequest, input.expectedProviderRequestHash);
    }
    const provider = providers.get(prepared.request.providerId)!;
    const result = await provider.submit(prepared.providerRequest, prepared.request.idempotencyKey);
    if (!result.providerTaskId.trim()) throw new Error("Provider returned an empty task id");
    return { ...result, request: prepared.request, providerRequestHash: prepared.providerRequestHash };
  }

  async function query(input: { providerId: string; providerTaskId: string }): Promise<GenerationProviderQueryResult> {
    const providerTaskId = input.providerTaskId.trim();
    if (!providerTaskId) throw new Error("Provider task id is required for query");
    const provider = providers.get(input.providerId);
    if (!provider) throw new GenerationProviderCapabilityError(input.providerId, ["registered_provider"]);
    if (!provider.query || !provider.capabilities.query) throw new GenerationProviderObservationError(input.providerId, "query");
    return provider.query(providerTaskId);
  }

  async function reconcile(input: { providerId: string; idempotencyKey: string; providerTaskId?: string }): Promise<GenerationProviderReconcileResult> {
    const provider = providers.get(input.providerId);
    if (!provider) throw new GenerationProviderCapabilityError(input.providerId, ["registered_provider"]);
    if (!provider.reconcile || !provider.capabilities.reconcile) throw new GenerationProviderObservationError(input.providerId, "reconcile");
    return provider.reconcile({ idempotencyKey: input.idempotencyKey, ...(input.providerTaskId?.trim() ? { providerTaskId: input.providerTaskId.trim() } : {}) });
  }

  async function materialize(input: { providerId: string; providerTaskId: string; raw?: unknown }): Promise<GenerationProviderMaterializationResult> {
    const providerTaskId = input.providerTaskId.trim();
    if (!providerTaskId) throw new Error("Provider task id is required for materialization");
    const provider = providers.get(input.providerId);
    if (!provider) throw new GenerationProviderCapabilityError(input.providerId, ["registered_provider"]);
    if (!provider.materialize || provider.capabilities.materialize !== true) throw new GenerationProviderObservationError(input.providerId, "materialize");
    const result = await provider.materialize({ providerTaskId, raw: input.raw });
    if (!Array.isArray(result.outputs)) throw new Error("Provider materialization returned invalid outputs");
    for (const output of result.outputs) {
      if (!output || !["image", "video", "audio"].includes(output.kind) || typeof output.url !== "string" || !output.url.trim()) {
        throw new Error("Provider materialization returned an invalid output");
      }
    }
    return result;
  }

  return { prepare, submit, query, reconcile, materialize };
}
