import { vi } from 'vitest';
import { withCredentialRedirectPolicy } from '../../electron/credentialRedirectPolicy';
import { handOffToNetwork } from '../../electron/outboundDispatchEvidence';

// Domain unit tests already own their HTTP fixtures through global fetch. They
// do not start Electron or apply real user proxy preferences. Transport tests
// explicitly unmock appFetch; the cold Electron regression uses real modules.
// This fixture isolates existing business assertions; it proves no real route.
// The credential redirect rule is applied here too (same owner function as the
// real entry), so domain tests do not run under a looser policy than production.
// Every request is also handed off through the same dispatch ledger as the real entry: a paid submission
// that reached the network must never be read as "never left the machine" just because a test replaced the transport.
vi.mock('../../electron/appFetch', () => ({
  appFetch: (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
    handOffToNetwork(input, init, () => globalThis.fetch(input, withCredentialRedirectPolicy(input, init))),
}));
