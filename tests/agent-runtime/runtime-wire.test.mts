import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAgentTurn } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import { createRuntimeFixture } from './httpFixture.mjs';

for (const kind of ['openai-compatible', 'openai-responses', 'anthropic'] as const) {
  for (const status of [401, 429, 500]) {
    test(`${kind} HTTP ${status}: preserves bounded plain status/body/url facts without a retry`, async (t) => {
      const { request, http } = await createRuntimeFixture(t, [{ type: 'error', status, message: `Nomi wire ${status}` }]);
      request.model = { ...request.model, kind };
      const result = await runAgentTurn(request, { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }) });
      assert.equal(result.status, 'error');
      assert.equal(result.error?.kind, 'http');
      assert.equal(result.error?.status, status);
      assert.match(result.error?.body ?? '', new RegExp(`Nomi wire ${status}`));
      assert.match(result.error?.url ?? '', /127\.0\.0\.1/);
      assert.equal(http.requests.length, 1);
      assert.equal('headers' in result.error!, false);
      assert.doesNotMatch(JSON.stringify(result.error), /fixture-key/);
    });
  }

  test(`${kind}: plain Nomi profile callback adjusts the real payload and cache tokens are not doubled`, async (t) => {
    const { request, http } = await createRuntimeFixture(t, [{ type: 'text', text: 'Accounted.',
      usage: { input: 10, output: 7, cacheRead: 3, cacheWrite: kind === 'anthropic' ? 2 : 0, reasoning: 2 } }]);
    request.model = { ...request.model, kind, maxOutputTokens: 40000, temperature: 0.2 };
    let profiles = 0;
    const result = await runAgentTurn(request, { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }),
      onPayload: (body) => { profiles += 1; return { ...body, nomi_profile_applied: true }; } });
    assert.equal(profiles, 1);
    assert.equal(http.requests[0].body.nomi_profile_applied, true);
    assert.equal(http.requests[0].body[kind === 'openai-responses' ? 'max_output_tokens' : 'max_tokens'], 40000);
    assert.equal(http.requests[0].body.temperature, 0.2);
    const promptTokens = kind === 'anthropic' ? 15 : 13;
    // `reasoningTokens` 是 2026-09-06 新增的字段：供应商**报了**才有（哪怕报的是 0），
    // 没报就整个字段不存在。面板据此决定「推理」那一行渲不渲染——`?? 0` 会把
    // 「这家没说」印成「思考了 0 个 token」，两件完全不同的事。
    // 三家里只有两家在报文里给了 reasoning 明细，anthropic 那条路没有——于是它那份 usage
    // 里**根本没有这个字段**。这正是想要的语义，也是这条断言最值钱的地方：
    // 面板据此决定「推理」那一行渲不渲染，`?? 0` 会把「这家没说」印成「思考了 0 个 token」。
    const reportsReasoning = kind !== 'anthropic';
    assert.deepEqual(result.usage, {
      promptTokens, completionTokens: 7, cachedPromptTokens: 3, totalTokens: promptTokens + 7,
      ...(reportsReasoning ? { reasoningTokens: 2 } : {}),
    });
    assert.equal('reasoningTokens' in result.usage, reportsReasoning);
    assert.equal('cost' in result.usage, false, 'the SDK placeholder cost zero is not an actual price');
  });
}

test('captured HTTP bodies and messages redact configured secrets and do not retain unbounded bodies or URL queries', async (t) => {
  const { request } = await createRuntimeFixture(t, [
    { type: 'error', status: 401, message: `echoed fixture-key ${'x'.repeat(20_000)}` },
  ]);
  request.model.baseURL += '?key=fixture-key';
  const result = await runAgentTurn(request, { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }) });
  assert.equal(result.error?.kind, 'http');
  assert.ok((result.error?.body?.length ?? Infinity) <= 8192);
  assert.ok((result.error?.message.length ?? Infinity) <= 8192);
  assert.doesNotMatch(JSON.stringify(result.error), /fixture-key/);
  assert.doesNotMatch(result.error?.url ?? '', /\?/);
});

for (const credential of ['api-key', 'header'] as const) {
  test(`an echoed ${credential} crossing the HTTP fact boundary is redacted before truncation`, async (t) => {
    const secret = `SYNTHETIC_NOMI_REVIEW_${credential === 'api-key' ? 'API_KEY' : 'HEADER_SECRET'}`;
    const jsonPrefix = '{"error":{"message":"';
    const { request } = await createRuntimeFixture(t, [
      { type: 'error', status: 401, message: 'x'.repeat(8180 - Buffer.byteLength(jsonPrefix)) + secret },
    ]);
    if (credential === 'api-key') request.model.apiKey = secret;
    else request.model.headers = { 'x-nomi-review': secret };
    const result = await runAgentTurn(request, { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }) });
    assert.equal(result.error?.kind, 'http');
    assert.equal(result.error?.body?.slice(8180), '[redacted]');
    assert.doesNotMatch(JSON.stringify(result.error), /SYNTHETIC_NO/);
    assert.ok((result.error?.body?.length ?? Infinity) <= 8192);
    assert.ok((result.error?.message.length ?? Infinity) <= 8192);
  });
}
