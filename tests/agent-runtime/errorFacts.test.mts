import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import type { NomiModelConfig, RuntimeErrorFacts } from '../../electron/harness/runtime/runtimePort.js';
import { createErrorFacts } from '../../electron/harness/runtime/pi/errorFacts.mjs';

const model: NomiModelConfig = { kind: 'openai-compatible', providerId: 'nomi-review', modelId: 'review-model',
  baseURL: 'http://localhost/v1', authType: 'api-key', apiKey: 'SYNTHETIC_NOMI_REVIEW_API_KEY' };

async function capture(response: Response, config = model, signal?: AbortSignal) {
  const records: RuntimeErrorFacts[] = [];
  const observed = await createErrorFacts(config).fetch(async () => response, (fact) => records.push(fact))(
    'http://localhost/v1/chat/completions', { signal });
  return { observed, records };
}

for (const credential of ['api-key', 'header'] as const) {
  test(`${credential} redaction sees past the raw body cutoff without changing the SDK response`, async () => {
    const secret = `SYNTHETIC_NOMI_REVIEW_${credential === 'api-key' ? 'API_KEY' : 'HEADER_SECRET'}`;
    const content = 'x'.repeat(8180) + secret + ' trailing provider context';
    const response = new Response(content, { status: 401 });
    const config = credential === 'api-key' ? { ...model, apiKey: secret }
      : { ...model, headers: { 'x-nomi-review': secret } };
    const { observed, records } = await capture(response, config);
    assert.equal(observed, response);
    assert.equal(records[0].body?.slice(8180), '[redacted]');
    assert.equal(records[0].body?.length, 8190);
    assert.doesNotMatch(JSON.stringify(records), /SYNTHETIC_NO/);
    assert.equal(await observed.text(), content, 'the SDK receives its complete original body');
  });
}

test('multibyte secrets split across response chunks are fully redacted at the byte boundary', async () => {
  const secret = '秘钥🔐_SYNTHETIC_BOUNDARY_TOKEN';
  const prefix = '界'.repeat(2726) + 'xx';
  const content = prefix + secret + ' trailing provider context';
  const bytes = Buffer.from(content);
  const cuts = [0, 8181, 8184, 8188, 8193, bytes.length];
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (let index = 1; index < cuts.length; index += 1) controller.enqueue(bytes.subarray(cuts[index - 1], cuts[index]));
    controller.close();
  } }), { status: 401 });
  const { observed, records } = await capture(response, { ...model, apiKey: secret });
  assert.equal(records[0].body?.slice(prefix.length), '[redacted]');
  assert.equal(records[0].body?.slice(0, prefix.length), prefix);
  assert.doesNotMatch(JSON.stringify(records), /秘钥|SYNTHETIC_BOUNDARY/);
  assert.equal(await observed.text(), content);
});

test('body observation keeps its byte cap without emitting a cut UTF-8 character', async () => {
  const response = new Response('x'.repeat(8191) + '界tail', { status: 500 });
  const { records } = await capture(response);
  assert.equal(records[0].body?.length, 8191);
  assert.doesNotMatch(records[0].body ?? '', /�/);
});

test('an endless error body is read only through a bounded secret lookahead', { timeout: 1000 }, async (t) => {
  let pulls = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    pulls += 1;
    controller.enqueue(Buffer.alloc(256, 'x'));
  } }), { status: 500 });
  t.after(() => response.body?.cancel());
  const { records } = await capture(response);
  assert.equal(records[0].body?.length, 8192);
  assert.match(records[0].body ?? '', /^x+$/);
  const maximumChunks = Math.ceil((8192 + Buffer.byteLength(model.apiKey!) - 1) / 256);
  assert.ok(pulls <= maximumChunks + 3, 'allow only bounded lookahead and stream prefetch, never drain the body');
});

test('abort interrupts a stalled secret lookahead without publishing partial error facts', { timeout: 1000 }, async (t) => {
  let waiting!: () => void;
  const readPending = new Promise<void>((resolve) => { waiting = resolve; });
  let pulls = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    pulls += 1;
    if (pulls === 1) controller.enqueue(Buffer.from('x'.repeat(8180) + model.apiKey!.slice(0, 12)));
    else { waiting(); return new Promise<void>(() => {}); }
  } }), { status: 401 });
  t.after(() => response.body?.cancel());
  const controller = new AbortController();
  const pending = capture(response, model, controller.signal);
  await readPending;
  await setImmediate();
  controller.abort();
  const { observed, records } = await pending;
  assert.equal(observed, response);
  assert.equal(records.length, 0);
});

test('a shorter API key cannot expose the suffix of a longer configured header secret', async () => {
  const apiKey = 'REVIEW_SHARED';
  const header = `${apiKey}_HEADER_SECRET`;
  const response = new Response(`ordinary ${header} trailing`, { status: 401 });
  const { records } = await capture(response, { ...model, apiKey, headers: { 'x-nomi-review': header } });
  assert.equal(records[0].body, 'ordinary [redacted] trailing');
  assert.doesNotMatch(JSON.stringify(records), /SHARED|HEADER_SECRET/);
});
