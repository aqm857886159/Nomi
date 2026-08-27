import { describe, expect, it } from 'vitest';
import type { RuntimeErrorFacts } from '../harness/runtime/runtimePort';
import { parseVendorErrorFromMessage } from '../../src/workbench/generationCanvas/runner/vendorErrorIpc';
import { describeRuntimeError } from './runtimeVendorError';

describe('pi transport error classification', () => {
  it('maps connection failure into the existing network contract, not a generic provider failure', () => {
    const error: RuntimeErrorFacts = { kind: 'network', message: 'fetch failed: UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error (timeout: 10000ms)',
      code: 'UND_ERR_CONNECT_TIMEOUT', url: 'https://fixture.invalid/v1/chat/completions' };
    const structured = parseVendorErrorFromMessage(describeRuntimeError(error, 'provider'));
    expect(structured).toMatchObject({ vendorKey: 'provider', category: 'network', retryable: true,
      url: 'https://fixture.invalid/v1/chat/completions', upstreamMsg: expect.stringContaining('UND_ERR_CONNECT_TIMEOUT') });
    expect(structured).not.toHaveProperty('httpStatus');
  });

  it.each([[401, 'auth'], [429, 'quota'], [500, 'server']] as const)('keeps HTTP %s separate from network errors', (status, category) => {
    const structured = parseVendorErrorFromMessage(describeRuntimeError({ kind: 'http', status,
      message: `HTTP ${status}`, body: '{"error":{"message":"upstream reason"}}' }, 'provider'));
    expect(structured).toMatchObject({ httpStatus: status, category });
  });

  it('does not turn caller cancellation into a retryable vendor error', () => {
    const message = describeRuntimeError({ kind: 'abort', message: 'User cancelled' }, 'provider');
    expect(message).toBe('User cancelled');
    expect(parseVendorErrorFromMessage(message)).toBeNull();
  });
});
