import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RuntimeErrorFacts } from '../../electron/harness/runtime/runtimePort.js';
import { createErrorFacts } from '../../electron/harness/runtime/pi/errorFacts.mjs';
import { runAgentTurn } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import { createRuntimeFixture } from './httpFixture.mjs';

const model = { kind: 'openai-compatible' as const, providerId: 'network-test', modelId: 'test-model',
  baseURL: 'https://network.invalid/v1', authType: 'api-key' as const, apiKey: 'SYNTHETIC_NETWORK_SECRET',
  headers: { 'X-Gateway-Key': 'SYNTHETIC_GATEWAY_SECRET' } };

function connectFailure() {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error('Connect Timeout Error (timeout: 10000ms)'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
  });
}

test('records the original transport cause before the SDK discards it, and rethrows the same failure', async () => {
  const records: RuntimeErrorFacts[] = [];
  const original = connectFailure();
  const fetch = createErrorFacts(model).fetch(async () => { throw original; }, (record) => records.push(record));
  await assert.rejects(fetch('https://user:pass@network.invalid/v1/chat/completions?key=hidden#private'),
    (error) => error === original);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'network');
  assert.equal('code' in records[0] && records[0].code, 'UND_ERR_CONNECT_TIMEOUT');
  assert.match(records[0].message, /10000ms/);
  assert.equal(records[0].url, 'https://network.invalid/v1/chat/completions');
  assert.equal(records[0].status, undefined);
  assert.doesNotMatch(JSON.stringify(records), /user:pass|hidden|private/);
});

test('network facts redact configured secrets and embedded URL credentials before bounding messages', async () => {
  const records: RuntimeErrorFacts[] = [];
  const error = new TypeError('fetch failed', { cause: Object.assign(new Error(
    `Could not reach https://user:pass@network.invalid/path?token=OTHER_SECRET#private ${'x'.repeat(8140)}${model.apiKey} ${model.headers['X-Gateway-Key']}`,
  ), { code: 'ECONNREFUSED' }) });
  await assert.rejects(createErrorFacts(model).fetch(async () => { throw error; }, (record) => records.push(record))(
    new Request('https://network.invalid/v1/chat/completions?request-secret=OTHER_SECRET'),
  ));
  assert.equal(records[0]?.kind, 'network');
  assert.ok(records[0].message.length <= 8192);
  assert.doesNotMatch(JSON.stringify(records), /SYNTHETIC_|OTHER_SECRET|user:pass|#private|request-secret/);
});

test('caller cancellation does not produce a retryable network failure', async () => {
  const records: RuntimeErrorFacts[] = [];
  const controller = new AbortController();
  const error = connectFailure();
  const fetch = createErrorFacts(model).fetch(async () => { controller.abort(); throw error; }, (record) => records.push(record));
  await assert.rejects(fetch(new Request('https://network.invalid/v1', { signal: controller.signal })), (actual) => actual === error);
  assert.deepEqual(records, []);
});

test('cyclic nested causes do not prevent a bounded network fact or change thrown identity', async () => {
  const records: RuntimeErrorFacts[] = [];
  const cause = Object.assign(new Error('DNS lookup failed'), { code: 'ENOTFOUND', cause: undefined as unknown });
  const error = new TypeError('fetch failed', { cause });
  cause.cause = error;
  await assert.rejects(createErrorFacts(model).fetch(async () => { throw error; }, (record) => records.push(record))(
    'https://network.invalid/v1',
  ), (actual) => actual === error);
  assert.equal(records[0]?.kind, 'network');
  assert.equal('code' in records[0] && records[0].code, 'ENOTFOUND');
  assert.ok(records[0].message.length < 200);
});

test('invalid request construction is not falsely reported as a connection failure', async () => {
  const records: RuntimeErrorFacts[] = [];
  const error = new TypeError('Cannot convert argument to a ByteString');
  await assert.rejects(createErrorFacts(model).fetch(async () => { throw error; }, (record) => records.push(record))(
    'https://network.invalid/v1',
  ), (actual) => actual === error);
  assert.notEqual(records[0]?.kind, 'network');
});

for (const kind of ['openai-compatible', 'openai-responses', 'anthropic'] as const) {
  test(`${kind}: real pi SDK preserves connection facts without retrying or inventing an HTTP status`, async (t) => {
    const { request, http } = await createRuntimeFixture(t, []);
    request.model = { ...request.model, kind };
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw connectFailure(); };
    t.after(() => { globalThis.fetch = originalFetch; });
    const result = await runAgentTurn(request, { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }) });
    assert.equal(result.status, 'error');
    assert.equal(result.error?.kind, 'network');
    assert.equal(result.error && 'code' in result.error && result.error.code, 'UND_ERR_CONNECT_TIMEOUT');
    assert.match(result.error?.message ?? '', /10000ms/);
    assert.match(result.error?.url ?? '', /127\.0\.0\.1/);
    assert.equal(result.error?.status, undefined);
    assert.equal(calls, 1);
    assert.equal(http.requests.length, 0);
  });
}
