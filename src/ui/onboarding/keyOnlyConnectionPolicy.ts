/**
 * The backend is the only authority that can decide whether a saved key is
 * enabled.  The renderer only chooses the next screen from that returned
 * state and the immutable credential mode projected by the catalog.
 */
export type KeyOnlyCredentialMode = 'direct-key' | 'certification'

export type KeyOnlySaveOutcome = 'connected' | 'needs-verification' | 'rejected'

export function resolveKeyOnlySaveOutcome(
  credentialMode: KeyOnlyCredentialMode,
  enabled: boolean,
): KeyOnlySaveOutcome {
  if (credentialMode === 'direct-key') return enabled ? 'connected' : 'rejected'
  return 'needs-verification'
}
