import { describe, expect, it } from 'vitest';
import { networkFailureDetails, redactNetworkMessage, safeNetworkUrl } from './networkErrorDetails';

describe('shared network diagnostics', () => {
  it.each(['ENOTFOUND', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ERR_TLS_CERT_ALTNAME_INVALID'])(
    'reads %s through aggregate causes without matching SDK class names', (code) => {
      const error = new TypeError('fetch failed', { cause: new AggregateError([
        new Error('unrelated'), Object.assign(new Error('original cause'), { code }),
      ]) });
      expect(networkFailureDetails(error)).toEqual({ code, message: `${code}: original cause` });
    });

  it('does not inspect a large aggregate after the diagnostic traversal budget is full', () => {
    let reads = 0;
    const errors = Array.from({ length: 40 }, () => new Error('unused'));
    for (let index = 0; index < errors.length; index += 1) Object.defineProperty(errors, index, {
      get: () => { reads += 1; return new Error('unused'); },
    });
    const cause = { cause: new Error('last'), errors };
    const error = { message: 'fetch failed', cause, errors: Array.from({ length: 10 }, () => new Error('other')) };
    expect(networkFailureDetails(error)).toEqual({ message: 'fetch failed' });
    expect(reads).toBe(0);
  });

  it('ignores malformed diagnostic getters and non-network programming errors', () => {
    expect(networkFailureDetails({ get code() { throw new Error('bad getter'); } })).toBeUndefined();
    expect(networkFailureDetails(new TypeError('Cannot convert argument to a ByteString'))).toBeUndefined();
  });

  it('strips URL credentials and redacts longest secrets before limiting output', () => {
    expect(safeNetworkUrl('https://user:password@fixture.invalid/v1?a=secret#private')).toBe('https://fixture.invalid/v1');
    expect(redactNetworkMessage('https://user:password@fixture.invalid/v1?a=secret#private LONG_KEY_SUFFIX',
      ['LONG_KEY', 'LONG_KEY_SUFFIX'])).toBe('https://fixture.invalid/v1 «redacted»');
    expect(redactNetworkMessage(`${'x'.repeat(250)}LONG_KEY_SUFFIX`, ['LONG_KEY_SUFFIX'], 256)).not.toContain('LONG');
  });
});
