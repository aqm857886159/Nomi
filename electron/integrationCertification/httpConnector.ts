import { authHeaders, authQueryParams, buildHttpRequest, type BuiltRequest } from "../ai/requestPipeline";
import { buildModelListRequests, fetchModelList } from "../ai/onboarding/modelListProbe";
import { readCatalog } from "../catalog/catalogStore";
import { decryptApiKeyRecord } from "../catalog/secrets";
import { mergeHeadersCaseInsensitive } from "../jsonUtils";
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

export type HttpConnectorPrimitives = Pick<
  ProviderAdapterService,
  "register" | "start" | "getRun" | "latestRun" | "cancel" | "listRuns" | "resumeInterrupted" | "certificationChildRunRef" | "certificationSourceVendorKey"
>;

export type HttpExistingCertificationStart = {
  vendorKey: string;
  models: ExistingConnectionModel[];
  certification: CertificationContractBinding;
};

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
      return fetchModelList(input.providerKind, input.baseUrl, headers, input.signal, { query });
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
  ) {
    this.existing = existingActions || defaultExistingActions(primitives);
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
