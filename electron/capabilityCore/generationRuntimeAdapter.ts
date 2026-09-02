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
  modeId?: string;
  transportModelId?: string;
  mode: string;
  prompt: string;
  parameters: Record<string, unknown>;
  references: ExecutionContractV1["references"];
  contractHash: string;
  idempotencyKey: string;
  requestFingerprint: string;
  executionBinding: ProductionExecutionBinding;
};

/**
 * Stable, provider-visible request input. Runtime fencing and envelope fields
 * deliberately stay out of this shape so a restart cannot change the payload
 * the user approved.
 */
export type GenerationProviderRequestInputV1 = Omit<
  ResolvedTaskRequestV1,
  "requestFingerprint" | "executionBinding"
>;

export type GenerationProviderCapabilities = {
  submitIdempotency: boolean;
  query: boolean;
  reconcile: boolean;
  cancel: boolean;
  /** Provider-owned extraction of a terminal task into downloadable outputs. */
  materialize?: boolean;
};

export type GenerationProviderOutput = {
  kind: "image" | "video" | "audio" | "model3d";
  url: string;
  contentType?: string;
  fileName?: string;
  providerOutputId?: string;
  /** Optional provider-owned still for video review; it is materialized locally before projection. */
  thumbnailUrl?: string;
};

export type GenerationProviderMaterializationResult = {
  outputs: readonly GenerationProviderOutput[];
  raw?: unknown;
};

export type GenerationProvider = {
  providerId: string;
  capabilities: GenerationProviderCapabilities;
  buildRequest: (input: GenerationProviderRequestInputV1) => unknown;
  submit: (request: unknown, idempotencyKey: string) => Promise<{ providerTaskId: string; raw?: unknown }>;
  query?: (providerTaskId: string) => Promise<{ status: string; raw?: unknown }>;
  reconcile?: (input: { idempotencyKey: string; providerTaskId?: string }) => Promise<{ disposition: GenerationProviderReconcileDisposition; providerTaskId?: string; raw?: unknown }>;
  materialize?: (input: { providerTaskId: string; raw?: unknown }) => Promise<GenerationProviderMaterializationResult>;
  cancel?: (providerTaskId: string) => Promise<{ disposition: Exclude<GenerationProviderCancelDisposition, "unsupported">; raw?: unknown }>;
};

/**
 * Optional provider-local submission hook.  The public `submit` contract stays
 * intentionally narrow (it receives only the approved wire payload), while a
 * provider that has endpoint semantics not representable in that payload can
 * also consume the sealed semantic input.  This is a structural/duck-typed
 * extension so existing providers do not need to change their implementation.
 */
type ContextualGenerationProvider = GenerationProvider & {
  submitWithContext?: (
    request: unknown,
    idempotencyKey: string,
    input: GenerationProviderRequestInputV1,
  ) => Promise<{ providerTaskId: string; raw?: unknown }>;
};

export type GenerationProviderTaskState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";

export type GenerationProviderQueryResult = {
  state: GenerationProviderTaskState;
  providerStatus: string;
  raw?: unknown;
};

export type GenerationProviderReconcileDisposition = "found" | "not_found" | "indeterminate";

export type GenerationProviderReconcileResult = {
  disposition: GenerationProviderReconcileDisposition;
  providerTaskId?: string;
  /** Provider could answer, but did not establish a terminal/known state. */
  status?: string;
  raw?: unknown;
};

export type GenerationProviderCancelDisposition = "unsupported" | "requested" | "confirmed" | "already_terminal" | "too_late";

export type GenerationProviderCancelResult = {
  disposition: GenerationProviderCancelDisposition;
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

const PROVIDER_TASK_STATE_BY_STATUS: Readonly<Record<string, GenerationProviderTaskState>> = {
  queued: "queued",
  pending: "queued",
  submitted: "queued",
  created: "queued",
  waiting: "queued",
  processing: "running",
  running: "running",
  in_progress: "running",
  "in-progress": "running",
  generating: "running",
  succeeded: "succeeded",
  success: "succeeded",
  completed: "succeeded",
  complete: "succeeded",
  done: "succeeded",
  failed: "failed",
  error: "failed",
  rejected: "failed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

export function normalizeGenerationProviderTaskState(providerStatus: string): GenerationProviderTaskState {
  return PROVIDER_TASK_STATE_BY_STATUS[providerStatus.trim().toLowerCase()] ?? "unknown";
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
    ...(contract.modeId ? { modeId: contract.modeId } : {}),
    ...(contract.transportModelId ? { transportModelId: contract.transportModelId } : {}),
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

function providerInput(request: ResolvedTaskRequestV1): GenerationProviderRequestInputV1 {
  const { requestFingerprint: _requestFingerprint, executionBinding: _executionBinding, ...stable } = request;
  return stable;
}

function stableRequestFor(
  contract: ExecutionContractV1,
  providerIdempotencyKey: string,
): GenerationProviderRequestInputV1 {
  const idempotencyKey = providerIdempotencyKey.trim();
  if (!idempotencyKey) throw new GenerationRuntimeBindingError("Provider idempotency key is required");
  return {
    moduleId: contract.moduleId,
    providerId: contract.providerId,
    modelId: contract.modelId,
    ...(contract.variantId ? { variantId: contract.variantId } : {}),
    ...(contract.modeId ? { modeId: contract.modeId } : {}),
    ...(contract.transportModelId ? { transportModelId: contract.transportModelId } : {}),
    mode: contract.mode,
    prompt: contract.prompt,
    parameters: structuredClone(contract.parameters),
    references: structuredClone(contract.references),
    contractHash: contract.contractHash,
    idempotencyKey,
  };
}

export function createGenerationRuntimeAdapter(deps: { providers: readonly GenerationProvider[] }) {
  const providers = new Map<string, GenerationProvider>();
  for (const provider of deps.providers) {
    if (providers.has(provider.providerId)) throw new Error(`Duplicate generation provider: ${provider.providerId}`);
    providers.set(provider.providerId, provider);
  }

  function prepareAuthorization(input: {
    contract: ExecutionContractV1;
    providerIdempotencyKey: string;
  }): Readonly<{
    providerRequest: unknown;
    providerRequestHash: string;
  }> {
    const request = stableRequestFor(input.contract, input.providerIdempotencyKey);
    const provider = providers.get(request.providerId);
    if (!provider) throw new GenerationProviderCapabilityError(request.providerId, ["registered_provider"]);
    assertGenerationProviderCanSubmit(provider);
    const first = provider.buildRequest(structuredClone(request));
    const second = provider.buildRequest(structuredClone(request));
    const firstHash = productionGenerationPayloadHash(first);
    if (productionGenerationPayloadHash(second) !== firstHash) {
      throw new GenerationProviderRequestError("Provider buildRequest must be deterministic before approval");
    }
    return Object.freeze({ providerRequest: structuredClone(first), providerRequestHash: firstHash });
  }

  function prepare(input: { contract: ExecutionContractV1; binding: ProductionExecutionBinding }): Readonly<{
    request: ResolvedTaskRequestV1;
    providerRequest: unknown;
    providerRequestHash: string;
  }> {
    const request = resolveExecutionContract(input.contract, input.binding);
    const stableInput = providerInput(request);
    const prepared = prepareAuthorization({
      contract: input.contract,
      providerIdempotencyKey: stableInput.idempotencyKey,
    });
    return Object.freeze({ request, ...prepared });
  }

  async function submit(input: {
    contract: ExecutionContractV1;
    binding: ProductionExecutionBinding;
    expectedProviderRequestHash: string;
    preparedProviderRequest?: unknown;
  }): Promise<{ providerTaskId: string; raw?: unknown; request: ResolvedTaskRequestV1; providerRequestHash: string }> {
    const request = resolveExecutionContract(input.contract, input.binding);
    const provider = providers.get(request.providerId);
    if (!provider) throw new GenerationProviderCapabilityError(request.providerId, ["registered_provider"]);
    assertGenerationProviderCanSubmit(provider);
    const providerRequest = input.preparedProviderRequest === undefined
      ? provider.buildRequest(structuredClone(providerInput(request)))
      : structuredClone(input.preparedProviderRequest);
    assertProductionGenerationPayloadHash(providerRequest, input.expectedProviderRequestHash);
    const contextualProvider = provider as ContextualGenerationProvider;
    const result = contextualProvider.submitWithContext
      ? await contextualProvider.submitWithContext(
        providerRequest,
        request.idempotencyKey,
        structuredClone(providerInput(request)),
      )
      : await provider.submit(providerRequest, request.idempotencyKey);
    if (!result.providerTaskId.trim()) throw new Error("Provider returned an empty task id");
    return { ...result, request, providerRequestHash: productionGenerationPayloadHash(providerRequest) };
  }

  async function query(input: { providerId: string; providerTaskId: string }): Promise<GenerationProviderQueryResult> {
    const providerTaskId = input.providerTaskId.trim();
    if (!providerTaskId) throw new Error("Provider task id is required for query");
    const provider = providers.get(input.providerId);
    if (!provider) throw new GenerationProviderCapabilityError(input.providerId, ["registered_provider"]);
    if (!provider.query || !provider.capabilities.query) throw new GenerationProviderObservationError(input.providerId, "query");
    const result = await provider.query(providerTaskId);
    const providerStatus = typeof result.status === "string" ? result.status.trim() : "";
    if (!providerStatus) return { state: "unknown", providerStatus: "unknown", ...(result.raw === undefined ? {} : { raw: result.raw }) };
    return {
      state: normalizeGenerationProviderTaskState(providerStatus),
      providerStatus,
      ...(result.raw === undefined ? {} : { raw: result.raw }),
    };
  }

  async function reconcile(input: { providerId: string; idempotencyKey: string; providerTaskId?: string }): Promise<GenerationProviderReconcileResult> {
    const provider = providers.get(input.providerId);
    if (!provider) throw new GenerationProviderCapabilityError(input.providerId, ["registered_provider"]);
    if (!provider.reconcile || !provider.capabilities.reconcile) throw new GenerationProviderObservationError(input.providerId, "reconcile");
    const existingProviderTaskId = input.providerTaskId?.trim();
    const result = await provider.reconcile({ idempotencyKey: input.idempotencyKey, ...(existingProviderTaskId ? { providerTaskId: existingProviderTaskId } : {}) });
    if (!["found", "not_found", "indeterminate"].includes(result.disposition)) throw new Error("Provider returned an invalid reconciliation disposition");
    const providerTaskId = result.providerTaskId?.trim() || existingProviderTaskId;
    if (result.disposition === "found" && !providerTaskId) throw new Error("Provider reconciliation found a task without returning its id");
    return {
      disposition: result.disposition,
      ...(providerTaskId ? { providerTaskId } : {}),
      ...(result.raw === undefined ? {} : { raw: result.raw }),
    };
  }

  async function cancel(input: { providerId: string; providerTaskId: string }): Promise<GenerationProviderCancelResult> {
    const providerTaskId = input.providerTaskId.trim();
    if (!providerTaskId) throw new Error("Provider task id is required for cancellation");
    const provider = providers.get(input.providerId);
    if (!provider) throw new GenerationProviderCapabilityError(input.providerId, ["registered_provider"]);
    if (!provider.cancel || !provider.capabilities.cancel) return { disposition: "unsupported" };
    const result = await provider.cancel(providerTaskId);
    if (!["requested", "confirmed", "already_terminal", "too_late"].includes(result.disposition)) {
      throw new Error("Provider returned an invalid cancellation disposition");
    }
    return { disposition: result.disposition, ...(result.raw === undefined ? {} : { raw: result.raw }) };
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
      if (!output || !["image", "video", "audio", "model3d"].includes(output.kind) || typeof output.url !== "string" || !output.url.trim()) {
        throw new Error("Provider materialization returned an invalid output");
      }
    }
    return result;
  }

  return { prepareAuthorization, prepare, submit, query, reconcile, cancel, materialize };
}
