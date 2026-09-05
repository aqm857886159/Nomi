import crypto from "node:crypto";

// MCP URL-mode elicitation, credential half (spec 2025-11-25 · client/elicitation §URL Mode).
//
// Why this exists: an external MCP host (Claude Code / Codex) driving `nomi_integration` reaches a
// step that needs a provider API key. The spec forbids asking for it in form mode — "Servers MUST NOT
// use form mode elicitation to request sensitive information such as passwords, API keys" — and
// requires URL mode instead, so the secret never transits the MCP client or the model context.
//
// This module owns ONLY the one-time ticket: mint → resolve (render the page) → redeem (accept the
// key exactly once). It holds no key, ever: `redeem` hands back the session identity, and the caller
// writes through the existing trusted credential path (IntegrationSessionService.saveCredential).
//
// Cross-process note: the ticket is minted by whichever Nomi process executes the integration session
// (the open GUI when one is live, otherwise the headless stdio server). That process is also the one
// serving the page and holding the session, so the key never crosses a process boundary either.
// The MCP protocol layer learns the outcome by polling `integration.get` for credentialStatus, not
// by listening to this store — see mcpProtocol.ts.

export type CredentialElicitationDisplay = {
  /** Provider display name shown on the page. Never a secret. */
  name: string;
  /** Read-only base URL echoed on the page so the user can see who they are handing the key to. */
  baseUrl: string;
  authType: string;
};

export type CredentialElicitationDescriptor = {
  elicitationId: string;
  sessionId: string;
  expiresAt: string;
  display: CredentialElicitationDisplay;
};

/** What the MCP protocol layer needs to build an `elicitation/create` (mode: "url") request. */
export type CredentialElicitationTicket = CredentialElicitationDescriptor & { url: string };

export const CREDENTIAL_ELICITATION_PATH = "/integration-credential";
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_TICKETS = 32;

type StoredTicket = CredentialElicitationDescriptor & { token: string; expiresAtMs: number; redeemed: boolean };

export type CredentialElicitationStore = {
  /**
   * Mint a single-use ticket. Returns null when this process has no loopback origin yet — the caller
   * then degrades to the durable in-app handoff rather than inventing a URL that resolves nowhere.
   */
  mint(input: { sessionId: string; display: CredentialElicitationDisplay }): CredentialElicitationTicket | null;
  /** Non-consuming lookup for rendering the page. A GET must never burn the ticket (spec: clients MUST NOT prefetch, but a browser preload still happens). */
  resolve(token: unknown): CredentialElicitationDescriptor | null;
  /** Consume the ticket. Exactly one successful save per mint. */
  redeem(token: unknown): CredentialElicitationDescriptor | null;
  /** Test only: current live ticket count. */
  size(): number;
};

export function createCredentialElicitationStore(deps: {
  /** This process's loopback HTTP origin (http://127.0.0.1:<port>), or '' when no local server is up. */
  originResolver: () => string;
  now?: () => number;
  ttlMs?: number;
}): CredentialElicitationStore {
  const tickets = new Map<string, StoredTicket>();
  const now = deps.now || (() => Date.now());
  const ttlMs = deps.ttlMs && deps.ttlMs > 0 ? deps.ttlMs : DEFAULT_TTL_MS;

  const sweep = (): void => {
    const current = now();
    for (const [token, ticket] of tickets) {
      if (ticket.redeemed || ticket.expiresAtMs <= current) tickets.delete(token);
    }
    // Bounded even if nothing ever expires: drop the oldest insertions first.
    while (tickets.size > MAX_TICKETS) {
      const oldest = tickets.keys().next();
      if (oldest.done) break;
      tickets.delete(oldest.value);
    }
  };

  const live = (token: unknown): StoredTicket | null => {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
    sweep();
    const ticket = tickets.get(token);
    if (!ticket || ticket.redeemed || ticket.expiresAtMs <= now()) return null;
    return ticket;
  };

  const project = (ticket: StoredTicket): CredentialElicitationDescriptor => ({
    elicitationId: ticket.elicitationId,
    sessionId: ticket.sessionId,
    expiresAt: ticket.expiresAt,
    display: { ...ticket.display },
  });

  return {
    mint(input) {
      const origin = deps.originResolver();
      if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return null;
      sweep();
      // Drop any earlier ticket for the same session: re-asking must invalidate the previous page.
      for (const [token, ticket] of tickets) {
        if (ticket.sessionId === input.sessionId) tickets.delete(token);
      }
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAtMs = now() + ttlMs;
      const stored: StoredTicket = {
        token,
        elicitationId: crypto.randomUUID(),
        sessionId: input.sessionId,
        expiresAtMs,
        expiresAt: new Date(expiresAtMs).toISOString(),
        display: { ...input.display },
        redeemed: false,
      };
      tickets.set(token, stored);
      // The URL carries only an opaque, single-use, short-lived token — no key, no PII, and it is not
      // pre-authenticated against any protected resource (spec §Safe URL Handling, server rules 1 & 2).
      return { ...project(stored), url: `${origin}${CREDENTIAL_ELICITATION_PATH}?t=${token}` };
    },
    resolve(token) {
      const ticket = live(token);
      return ticket ? project(ticket) : null;
    },
    redeem(token) {
      const ticket = live(token);
      if (!ticket) return null;
      ticket.redeemed = true;
      tickets.delete(ticket.token);
      return project(ticket);
    },
    size() {
      sweep();
      return tickets.size;
    },
  };
}

/**
 * open_credentials adds the one-time credential page when this process could mint one. The URL holds
 * only an opaque single-use token — no key, no PII, not pre-authenticated against anything (MCP spec
 * 2025-11-25 §Safe URL Handling). The MCP protocol layer turns it into a URL-mode elicitation, and
 * strips it again before anything reaches the model.
 *
 * Minting happens at the dispatch seam rather than inside IntegrationSessionService for one reason
 * that matters: this code runs in whichever process actually owns the session (the open GUI when one
 * is live, otherwise the headless stdio server), and that same process serves the page and writes the
 * key. The secret therefore never crosses a process boundary either.
 */
export function withCredentialElicitationTicket<
  T extends { id?: unknown; kind?: unknown; config?: { name?: unknown; baseUrl?: unknown; authType?: unknown } },
>(projection: T, store: CredentialElicitationStore = getCredentialElicitationStore()): T & { credentialEntry?: CredentialElicitationTicket } {
  const baseUrl = typeof projection?.config?.baseUrl === "string" ? projection.config.baseUrl : "";
  if (projection?.kind !== "http-api-provider" || !baseUrl || typeof projection.id !== "string") return projection;
  const ticket = store.mint({
    sessionId: projection.id,
    display: {
      name: typeof projection.config?.name === "string" ? projection.config.name : "",
      baseUrl,
      authType: typeof projection.config?.authType === "string" ? projection.config.authType : "bearer",
    },
  });
  return ticket ? { ...projection, credentialEntry: ticket } : projection;
}

let singleton: CredentialElicitationStore | null = null;
let processOrigin = "";

/**
 * Publish this process's loopback origin. Called by whichever host started the 127.0.0.1 server
 * (rpcServer in the GUI, the preview server in the stdio host). A late or absent call simply means
 * `mint` returns null and the flow degrades to the durable in-app handoff — never a broken URL.
 * Read through a resolver rather than captured at construction, so start order cannot matter.
 */
export function setCredentialElicitationOrigin(origin: string | null): void {
  processOrigin = origin && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ? origin : "";
}

/** Process-wide store. One per process, shared by the session service (mint) and the HTTP route (redeem). */
export function getCredentialElicitationStore(): CredentialElicitationStore {
  return (singleton ||= createCredentialElicitationStore({ originResolver: () => processOrigin }));
}

/** Test seam only — resets the process singleton and published origin. */
export function resetCredentialElicitationStoreForTests(): void {
  singleton = null;
  processOrigin = "";
}
