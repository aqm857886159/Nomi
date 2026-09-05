import { authHeaders } from "../ai/requestPipeline";
import { normalizeProviderKind } from "../catalog/catalogStore";
import { desktopT } from "../i18n";
import type { AiSdkProviderKind } from "../catalog/types";
import { getCredentialElicitationStore } from "./credentialElicitation";
import type { CredentialElicitationHttpDeps } from "./credentialElicitationHttp";
import { getIntegrationSessionService } from "./integrationSession";
import { getConnectionCertificationService } from "./service";

// Real wiring for the credential page: the store, the trusted credential writer, and the live probe
// behind its "test connection" button. Kept apart from credentialElicitationHttp.ts so the HTTP layer
// (including its no-key-in-any-response guarantee) stays unit-testable without the whole main process.

/**
 * Both hosts (GUI rpcServer, headless stdio server) mount the same routes with these deps. The write
 * goes through IntegrationSessionService.saveCredential as owner "nomi" — the identical trusted path
 * the in-app credential dialog uses, so encryption, catalog staging and promotion rules are unchanged.
 */
export function createRuntimeCredentialElicitationHttpDeps(): CredentialElicitationHttpDeps {
  const sessionConfig = (sessionId: string) => {
    const session = getIntegrationSessionService().get(sessionId);
    const config = session.config as {
      baseUrl?: string;
      providerKind?: string;
      authType?: string;
      authHeader?: string;
      authQueryParam?: string;
    };
    if (!config.baseUrl) throw new Error(desktopT("integration.discoveryMissingBaseUrl"));
    return { session, config };
  };
  return {
    store: getCredentialElicitationStore(),
    saveCredential: (sessionId, apiKey) => {
      // Read the revision at write time: the page is open across an unknown span of user time, and
      // saveCredential enforces an exact revision match.
      const current = getIntegrationSessionService().get(sessionId);
      getIntegrationSessionService().saveCredential(sessionId, current.revision, "nomi", apiKey);
    },
    testCredential: async (sessionId, apiKey) => {
      const { config } = sessionConfig(sessionId);
      const providerKind = normalizeProviderKind(config.providerKind) as AiSdkProviderKind;
      const authType = (config.authType || (providerKind === "anthropic" ? "x-api-key" : "bearer")) as
        Parameters<typeof authHeaders>[0];
      const candidates = await getConnectionCertificationService().discoverHttpModels({
        baseUrl: config.baseUrl as string,
        providerKind,
        authType,
        apiKey,
        ...(config.authHeader ? { authHeader: config.authHeader } : {}),
        ...(config.authQueryParam ? { authQueryParam: config.authQueryParam } : {}),
        headers: authHeaders(authType, apiKey, config.authHeader),
      });
      return Array.isArray(candidates) ? candidates.length : 0;
    },
  };
}
