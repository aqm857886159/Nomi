import { authHeaders, authQueryParams, buildHttpRequest, type BuiltRequest } from "../ai/requestPipeline";
import { buildModelListRequests, fetchModelList } from "../ai/onboarding/modelListProbe";
import { readCatalog } from "../catalog/catalogStore";
import { decryptApiKeyRecord } from "../catalog/secrets";
import { mergeHeadersCaseInsensitive } from "../jsonUtils";
import { guessModelKind } from "../catalog/modelKindHeuristic";
import type { AiSdkProviderKind, BillingModelKind } from "../catalog/types";
import { isPrivateHost } from "../hardenedFetch";
import {
  createExistingConnectionActions,
  type ExistingConnectionActions,
  type ExistingConnectionModel,
  type ExistingConnectionStartResult,
} from "../providerAdapter/existingConnection";
import {
  getProviderAdapterService,
  type ProviderAdapterService,
  type ProviderAdapterStartInput,
} from "../providerAdapter/service";
import type { ProviderAdapterRegisterInput, ProviderAdapterRegistration, ProviderAdapterRun } from "../providerAdapter/types";
import type { CertificationChildRunRef, CertificationContractBinding } from "./types";
import {
  probeLocalAiExternalRuntime,
  type LocalAiExternalProbeInput,
} from "../localRuntime/localAiExternalProbe";
import type { LocalRuntimeDescriptor } from "../localRuntime/localRuntimeDescriptor";

export type HttpConnectorPrimitives = Pick<
  ProviderAdapterService,
  "register" | "start" | "getRun" | "latestRun" | "cancel" | "deleteRun" | "listRuns" | "resumeInterrupted" | "certificationChildRunRef" | "certificationSourceVendorKey"
>;

export type HttpExistingCertificationStart = {
  vendorKey: string;
  models: ExistingConnectionModel[];
  certification: CertificationContractBinding;
};

export type HttpLocalRuntimeProbeInput = Pick<
  LocalAiExternalProbeInput,
  "baseUrl" | "apiKey" | "authScope" | "signal"
> & {
  providerKind: "openai-compatible" | "openai-responses" | "anthropic";
  authType: "none" | "bearer" | "x-api-key" | "query";
  authHeader?: string;
};

type LocalRuntimeProbe = typeof probeLocalAiExternalRuntime;

export type HttpDiscoveryInput = {
  baseUrl: string;
  providerKind: AiSdkProviderKind;
  authType: "none" | "bearer" | "x-api-key" | "query";
  apiKey: string;
  authHeader?: string;
  authQueryParam?: string;
  headers: Record<string, string>;
  proxyUrl?: string;
  search?: string;
};

function localAiAuthHeader(input: HttpLocalRuntimeProbeInput): LocalAiExternalProbeInput["authHeader"] {
  const declared = String(input.authHeader || "").trim().toLowerCase();
  if (declared === "authorization" || declared === "x-api-key" || declared === "xi-api-key") return declared;
  if (input.authType === "bearer") return "authorization";
  if (input.authType === "x-api-key") return "x-api-key";
  return undefined;
}

export function buildHttpDiscoveryRequests(input: {
  baseUrl: string;
  providerKind: "openai-compatible" | "openai-responses" | "anthropic";
  authType: "none" | "bearer" | "x-api-key" | "query";
  apiKey: string;
  authHeader?: string;
  authQueryParam?: string;
      headers: Record<string, string>;
}): BuiltRequest[] {
  return buildModelListRequests(input);
}

export function buildHttpProductionRequest(input: Parameters<typeof buildHttpRequest>[0]): BuiltRequest {
  return buildHttpRequest(input);
}

function defaultExistingActions(service: HttpConnectorPrimitives): ExistingConnectionActions {
  return createExistingConnectionActions({
    readCatalog,
    decryptApiKey: decryptApiKeyRecord,
    async fetchModels(input) {
      const headers = mergeHeadersCaseInsensitive(
        input.providerKind === "anthropic" ? { "anthropic-version": "2023-06-01" } : {},
        authHeaders(input.authType, input.apiKey, input.authHeader),
        input.headers,
      );
      const query = authQueryParams(input.authType, input.apiKey, input.authQueryParam);
      return fetchModelList(input.providerKind, input.baseUrl, headers, input.signal, { query, proxyUrl: input.proxyUrl });
    },
    startAdapter: ({ vendorKey, ...input }) => service.start({ ...input, catalogVendorKey: vendorKey }),
    getAdapterRun: (runId) => service.getRun(runId),
    getCertificationSourceVendorKey: (runId) => service.certificationSourceVendorKey(runId),
  });
}

export class HttpProviderConnector {
  private readonly existing: ExistingConnectionActions;

  constructor(
    private readonly primitives: HttpConnectorPrimitives = getProviderAdapterService(),
    existingActions?: ExistingConnectionActions,
    private readonly localRuntimeProbe: LocalRuntimeProbe = probeLocalAiExternalRuntime,
  ) {
    this.existing = existingActions || defaultExistingActions(primitives);
  }

  async probeExternalLocalRuntime(input: HttpLocalRuntimeProbeInput): Promise<LocalRuntimeDescriptor | null> {
    if (input.providerKind !== "openai-compatible") return null;
    const authHeader = localAiAuthHeader(input);
    return this.localRuntimeProbe({
      baseUrl: input.baseUrl,
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      ...(authHeader ? { authHeader } : {}),
      ...(input.authScope ? { authScope: input.authScope } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  async discoverModels(input: HttpDiscoveryInput) {
    let localRuntime: LocalRuntimeDescriptor | null = null;
    try {
      const parsedBaseUrl = new URL(input.baseUrl);
      if (input.providerKind === "openai-compatible" && isPrivateHost(parsedBaseUrl.hostname)) {
        localRuntime = await this.probeExternalLocalRuntime({
          baseUrl: input.baseUrl,
          providerKind: input.providerKind,
          authType: input.authType,
          apiKey: input.apiKey,
          ...(input.authHeader ? { authHeader: input.authHeader } : {}),
          authScope: input.apiKey ? "user" : undefined,
        });
      }
    } catch {
      // Local runtime probing is an enhancement; the canonical remote model
      // list probe remains authoritative when it cannot be reached.
    }
    if (localRuntime && (localRuntime.identity === "confirmed" || localRuntime.version)) {
      if (localRuntime.health === "unauthorized") throw new Error("model_discovery_auth");
      const candidates = localRuntime.capabilities.flatMap((capability) => {
        const guessed = guessModelKind(capability.modelId) as BillingModelKind;
        const textCapable = capability.outputs.includes("text") || (capability.outputs.length === 0 && guessed === "text");
        return textCapable ? [{ modelKey: capability.modelId, label: capability.modelId, kind: "text" as const, modes: ["chat"], evidence: ["runtime" as const], classification: "supported" as const, estimatedCalls: 1 }] : [];
      });
      const filtered = input.search ? candidates.filter((candidate) => `${candidate.modelKey} ${candidate.label}`.toLowerCase().includes(input.search!.toLowerCase())) : candidates;
      if (filtered.length || localRuntime.capabilities.length === 0) return filtered;
    }
    const result = await fetchModelList(input.providerKind, input.baseUrl, input.headers, new AbortController().signal, {
      query: authQueryParams(input.authType, input.apiKey, input.authQueryParam),
      ...(input.proxyUrl ? { proxyUrl: input.proxyUrl } : {}),
    });
    if (!result.ok) throw new Error(`model_discovery_${result.failureKind || "unknown"}`);
    const all = result.models.map((modelKey) => {
      const kind = guessModelKind(modelKey) as BillingModelKind;
      const modes = kind === "text" ? ["chat"] : kind === "image" ? ["text_to_image"] : kind === "video" ? ["text_to_video"] : kind === "audio" ? ["text_to_audio"] : [];
      return { modelKey, label: modelKey, kind, modes, evidence: ["remote" as const], classification: modes.length ? ("supported" as const) : ("unavailable" as const), estimatedCalls: Math.max(1, modes.length) };
    });
    return input.search ? all.filter((candidate) => `${candidate.modelKey} ${candidate.label}`.toLowerCase().includes(input.search!.toLowerCase())) : all;
  }

  configure(input: ProviderAdapterRegisterInput): ProviderAdapterRegistration {
    return this.primitives.register(input);
  }

  start(input: ProviderAdapterStartInput): Promise<ProviderAdapterRun> {
    return this.primitives.start(input);
  }

  get(runId: string): ProviderAdapterRun | undefined {
    return this.primitives.getRun(runId);
  }

  latest(vendorKey: string): ProviderAdapterRun | undefined {
    return this.primitives.latestRun(vendorKey);
  }

  cancel(runId: string): ProviderAdapterRun | undefined {
    return this.primitives.cancel(runId);
  }

  deleteRun(runId: string): ProviderAdapterRun | undefined {
    return this.primitives.deleteRun(runId);
  }

  list(options: { vendorKey?: string; activeOnly?: boolean; limit?: number } = {}): ProviderAdapterRun[] {
    return this.primitives.listRuns(options);
  }

  childRunRef(runId: string): CertificationChildRunRef | undefined {
    return this.primitives.certificationChildRunRef(runId);
  }

  listExistingModels(vendorKey: string) {
    return this.existing.listModels({ vendorKey });
  }

  startExisting(input: HttpExistingCertificationStart): Promise<ExistingConnectionStartResult> {
    return this.existing.start(input);
  }

  retryExisting(input: { runId: string; modelKey?: string; certification: CertificationContractBinding }): Promise<ExistingConnectionStartResult> {
    return this.existing.retry(input);
  }

  resumeInterrupted(): void {
    this.primitives.resumeInterrupted();
  }
}
