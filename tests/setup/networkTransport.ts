import { vi } from 'vitest';

// Domain unit tests already own their HTTP fixtures through global fetch. They
// do not start Electron or apply real user proxy preferences. Transport tests
// explicitly unmock appFetch; the cold Electron regression uses real modules.
// This fixture isolates existing business assertions; it proves no real route.
vi.mock('../../electron/appFetch', () => ({
  appFetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args),
}));
