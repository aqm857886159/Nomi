// MCP elicitation wire, both modes in one place (spec 2025-11-25 · client/elicitation).
//
//  · form mode  — `elicitation/create` with `requestedSchema`. Structured data comes back through the
//    client, so it is for confirmations and non-sensitive fields only.
//  · url mode   — `elicitation/create` with `mode: "url"` + `elicitationId` + `url`. The interaction
//    happens out of band; the client only consents to opening the URL and never sees the data. The
//    spec is explicit that secrets (passwords, API keys, tokens) MUST use this mode and MUST NOT use
//    form mode. Nomi's credential handoff is built on it — see mcpCredentialElicitation.ts.
//
// Capability shape (2025-11-25 §Capabilities): `capabilities.elicitation` present means the client can
// elicit; an EMPTY object means form mode only. URL mode requires an explicit `url` member. A server
// MUST NOT send a mode the client did not declare, which is why the two flags are separate here.
//
// (2026-07-28 moves the same two modes onto the multi-round-trip `InputRequiredResult` envelope and
// drops `elicitationId`. Nomi negotiates 2025-11-25 as its highest version — see SUPPORTED_PROTOCOL_
// VERSIONS in mcpProtocol.ts — so this file speaks the 2025-11-25 shape.)

export type ElicitationAction = 'accept' | 'decline' | 'cancel' | 'timeout'

export type ElicitationClient = {
  /** Boolean confirmation in form mode. `supported:false` = the client cannot ask anyone. */
  booleanConfirm(
    input: { message: string; title: string; description: string },
    signal?: AbortSignal,
  ): Promise<{ supported: boolean; confirmed?: boolean; action?: ElicitationAction; attestation?: unknown }>
  /**
   * URL mode. Resolves to the user's consent decision only — completion of the out-of-band work is
   * observed elsewhere (Nomi polls the owning session), exactly as the spec describes: "The response
   * with action: accept indicates that the user has consented to the interaction. It does not mean
   * that the interaction is complete."
   */
  requestUrl(
    input: { elicitationId: string; url: string; message: string },
    signal?: AbortSignal,
  ): Promise<{ supported: boolean; action?: ElicitationAction }>
  /** `notifications/elicitation/complete` — tells the client the out-of-band interaction finished. */
  notifyComplete(elicitationId: string): void
}

const normalizeAction = (raw: unknown): ElicitationAction =>
  raw === 'accept' || raw === 'decline' || raw === 'cancel' ? raw : 'cancel'

export function createElicitationClient(deps: {
  sendServerRequest: (method: string, params: unknown, timeoutMs?: number, signal?: AbortSignal) => Promise<unknown>
  send: (message: unknown) => void
  /** Getters, not snapshots: both are only known after `initialize`. */
  supportsElicitation: () => boolean
  supportsUrlElicitation: () => boolean
  timeoutMs?: number
}): ElicitationClient {
  const timeoutMs = deps.timeoutMs ?? 300000
  return {
    async booleanConfirm(input, signal) {
      if (!deps.supportsElicitation()) return { supported: false }
      try {
        const res = (await deps.sendServerRequest('elicitation/create', {
          message: input.message,
          requestedSchema: {
            type: 'object',
            properties: {
              confirm: { type: 'boolean', title: input.title, description: input.description },
            },
            required: ['confirm'],
          },
        }, timeoutMs, signal)) as { action?: string; content?: { confirm?: boolean; attestation?: unknown; confirmationAttestation?: unknown } } | null
        // 三态：accept / decline / cancel。只有明确 accept + confirm=true 才能跨过服务端边界。
        return {
          supported: true,
          confirmed: res?.action === 'accept' && res?.content?.confirm === true,
          action: normalizeAction(res?.action),
          attestation: res?.content?.attestation ?? res?.content?.confirmationAttestation,
        }
      } catch (error) {
        if (signal?.aborted) throw error
        // 超时/异常 → 当作未确认（不死等、不偷偷花钱）。
        return { supported: true, confirmed: false, action: 'timeout' }
      }
    },
    async requestUrl(input, signal) {
      // Sending a url-mode request to a form-only client is a spec violation, and the client is
      // required to answer -32602. Never send it.
      if (!deps.supportsUrlElicitation()) return { supported: false }
      try {
        const res = (await deps.sendServerRequest('elicitation/create', {
          mode: 'url',
          elicitationId: input.elicitationId,
          url: input.url,
          message: input.message,
        }, timeoutMs, signal)) as { action?: string } | null
        return { supported: true, action: normalizeAction(res?.action) }
      } catch (error) {
        if (signal?.aborted) throw error
        return { supported: true, action: 'timeout' }
      }
    },
    notifyComplete(elicitationId) {
      deps.send({ jsonrpc: '2.0', method: 'notifications/elicitation/complete', params: { elicitationId } })
    },
  }
}

/**
 * Read the client's declared elicitation modes from an `initialize` capabilities object.
 * Empty `elicitation: {}` is backwards-compatible shorthand for form mode only.
 */
export function readElicitationCapability(capabilities: unknown): { form: boolean; url: boolean } {
  const elicitation = (capabilities as Record<string, unknown> | undefined)?.elicitation
  if (!elicitation || typeof elicitation !== 'object') return { form: false, url: false }
  const modes = elicitation as Record<string, unknown>
  const url = Boolean(modes.url && typeof modes.url === 'object')
  // A client declaring only `url` supports url; one declaring nothing (or `form`) supports form.
  return { form: !url || Boolean(modes.form), url }
}
