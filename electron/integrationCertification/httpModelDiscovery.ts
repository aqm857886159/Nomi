import { authHeaders } from "../ai/requestPipeline";
import { extractVendorExtraHeaders, readCatalog, normalizeProviderKind } from "../catalog/catalogStore";
import { deriveVendorKeyFromBaseUrl } from "../catalog/catalogCommit";
import { desktopT } from "../i18n";
import type { AiSdkProviderKind } from "../catalog/types";
import type { ConnectionCertificationService } from "./service";
import type { IntegrationCandidate, IntegrationSession } from "./integrationSession";

/** Discover MCP candidates at the main-process boundary using only the saved credential. */
export async function discoverHttpCandidates(input: {
  session: IntegrationSession;
  certification: ConnectionCertificationService;
  credentialResolver?: (session: IntegrationSession) => string | undefined;
}): Promise<IntegrationCandidate[]> {
  const { session } = input;
  if (!session.config.baseUrl) throw new Error(desktopT("integration.discoveryMissingBaseUrl"));
  const apiKey = input.credentialResolver?.(session) || "";
  if (!apiKey) throw new Error(desktopT("integration.discoveryMissingCredential"));
  const providerKind = normalizeProviderKind(session.config.providerKind) as AiSdkProviderKind;
  const authType = session.config.authType || (providerKind === "anthropic" ? "x-api-key" : "bearer");
  const vendorKey = deriveVendorKeyFromBaseUrl(session.config.baseUrl);
  const vendor = readCatalog().vendors.find((candidate) => candidate.key === vendorKey);
  try {
    const candidates = await input.certification.discoverHttpModels({
      baseUrl: session.config.baseUrl,
      providerKind,
      authType,
      apiKey,
      ...(session.config.authHeader ? { authHeader: session.config.authHeader } : {}),
      ...(session.config.authQueryParam ? { authQueryParam: session.config.authQueryParam } : {}),
      headers: {
        ...authHeaders(authType, apiKey, session.config.authHeader),
        ...(vendor ? extractVendorExtraHeaders(vendor) || {} : {}),
      },
    });
    return candidates as IntegrationCandidate[];
  } catch (error) {
    const code = error instanceof Error ? error.message : "model_discovery_unknown";
    const reason = code.replace(/^model_discovery_/, "");
    const message = reason === "unsupported"
      ? desktopT("integration.discoveryUnsupported")
      : reason === "auth"
        ? desktopT("integration.discoveryAuthFailed")
        : desktopT("integration.discoveryFailed", { reason });
    throw new Error(message, { cause: error });
  }
}

export function applyDiscoveredCandidates(session: IntegrationSession, candidates: IntegrationCandidate[]): void {
  session.candidates = structuredClone(candidates);
  session.selections = [];
  session.unresolvedFields = candidates.length ? [] : [{ key: "models", reasonCode: "no_models_returned" }];
  session.stage = candidates.length ? "needs_selection" : "needs_input";
  session.blockingReason = candidates.length ? undefined : { code: "model_discovery_empty" };
}

export async function discoverAndPersistHttpCandidates<T>(input: {
  session: IntegrationSession;
  owner: string;
  expectedRevision: unknown;
  certification: ConnectionCertificationService;
  credentialResolver?: (session: IntegrationSession) => string | undefined;
  now: () => string;
  persist: () => void;
  project: () => T;
}): Promise<T> {
  if (input.session.ownerClientId !== input.owner) throw new Error("Integration session owner mismatch");
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== input.session.revision)
    throw new Error("Integration session revision is stale");
  const discovered = await discoverHttpCandidates(input);
  applyDiscoveredCandidates(input.session, discovered);
  input.session.revision += 1;
  input.session.updatedAt = input.now();
  input.persist();
  return input.project();
}
