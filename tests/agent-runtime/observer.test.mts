import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEvent,
  type AssistantMessageEventStream } from '@earendil-works/pi-ai';
import { observeNativeStream, type NativeClock } from '../../electron/harness/runtime/pi/observeStream.mjs';

const message = (text = 'Ready'): AssistantMessage => ({ role: 'assistant', content: [{ type: 'text', text }],
  api: 'openai-completions', provider: 'fixture', model: 'chosen', stopReason: 'stop', timestamp: 1,
  usage: { input: 10, output: 4, cacheRead: 2, cacheWrite: 1, totalTokens: 17,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

class Clock implements NativeClock {
  now = 0;
  timers = new Map<object, { at: number; callback: () => void }>();
  set(callback: () => void, milliseconds: number) {
    const token = {};
    this.timers.set(token, { at: this.now + milliseconds, callback });
    return token;
  }
  clear(timer: unknown) { this.timers.delete(timer as object); }
  advance(milliseconds: number) {
    this.now += milliseconds;
    for (const [token, timer] of this.timers) {
      if (timer.at <= this.now) { this.timers.delete(token); timer.callback(); }
    }
  }
}

function observed(upstream: AssistantMessageEventStream, clock = new Clock()) {
  const events: AssistantMessageEvent[] = [];
  const results: AssistantMessage[] = [];
  const output = observeNativeStream(() => upstream, { clock, firstResponseMs: 90, idleMs: 120,
    onEvent: (event) => events.push(event), onResult: (result) => results.push(result) });
  return { output, events, results, clock };
}

test('one native pump observes prebuffered start and completes a result-only summary consumer', async () => {
  const upstream = createAssistantMessageEventStream();
  const final = message();
  upstream.push({ type: 'start', partial: final });
  upstream.push({ type: 'done', reason: 'stop', message: final });
  const { output, events, results, clock } = observed(upstream);
  assert.equal(await output.result(), final);
  assert.deepEqual(events.map((event) => event.type), ['start', 'done']);
  assert.deepEqual(results, [final]);
  assert.equal(output.result(), output.result(), 'result() is one stable completion promise');
  assert.equal(clock.timers.size, 0);
});

test('ordinary async iteration receives each native event once and retains the original error message', async () => {
  const upstream = createAssistantMessageEventStream();
  const final = { ...message(), stopReason: 'error' as const, errorMessage: 'Provider failed' };
  upstream.push({ type: 'start', partial: final });
  upstream.push({ type: 'error', reason: 'error', error: final });
  const { output, events, results } = observed(upstream);
  const iterated: AssistantMessageEvent[] = [];
  for await (const event of output) iterated.push(event);
  assert.deepEqual(events, iterated);
  assert.equal(await output.result(), final);
  assert.deepEqual(results, [final]);
});

test('first-response timeout wakes iterator and result consumers without a fabricated assistant', async () => {
  const upstream = createAssistantMessageEventStream();
  const { output, events, results, clock } = observed(upstream);
  assert.equal(clock.timers.size, 1, 'first response is watched before upstream progress');
  const rejected = assert.rejects(output.result(), /first.response/i);
  const end = output[Symbol.asyncIterator]().next();
  clock.advance(90);
  await rejected;
  assert.equal((await end).done, true);
  assert.deepEqual(events, []);
  assert.deepEqual(results, []);
  assert.equal(clock.timers.size, 0);
});

test('native activity resets idle and terminal output clears the timer before an arbitrarily long approval', async () => {
  const upstream = createAssistantMessageEventStream();
  const { output, clock } = observed(upstream);
  assert.equal(clock.timers.size, 1);
  const final = message();
  upstream.push({ type: 'start', partial: final });
  await setImmediate();
  clock.advance(100);
  upstream.push({ type: 'text_delta', contentIndex: 0, delta: 'Ready', partial: final });
  await setImmediate();
  clock.advance(100);
  upstream.push({ type: 'done', reason: 'stop', message: final });
  await output.result();
  assert.equal(clock.timers.size, 0);
  clock.advance(5 * 60_000);
  assert.equal(await output.result(), final);
});

test('idle timeout rejects a result-only consumer after native activity stops', async () => {
  const upstream = createAssistantMessageEventStream();
  const { output, clock } = observed(upstream);
  assert.equal(clock.timers.size, 1);
  upstream.push({ type: 'start', partial: message() });
  await setImmediate();
  const rejected = assert.rejects(output.result(), /idle/i);
  clock.advance(120);
  await rejected;
  assert.equal(clock.timers.size, 0);
});

for (const phase of ['delegate', 'iterator', 'next', 'result'] as const) {
  test(`native ${phase} throw rejects the stable completion and wakes consumers`, async () => {
    const upstream = createAssistantMessageEventStream();
    const expected = new Error(`Original ${phase} failure`);
    if (phase === 'iterator') upstream[Symbol.asyncIterator] = () => { throw expected; };
    if (phase === 'next') upstream[Symbol.asyncIterator] = () => ({
      next: () => Promise.reject(expected), [Symbol.asyncIterator]() { return this; },
    });
    if (phase === 'result') { upstream.end(); upstream.result = () => Promise.reject(expected); }
    const clock = new Clock();
    const output = observeNativeStream(() => {
      if (phase === 'delegate') throw expected;
      return upstream;
    }, { clock, firstResponseMs: 90, idleMs: 120 });
    await assert.rejects(output.result(), (error) => error === expected);
    assert.equal((await output[Symbol.asyncIterator]().next()).done, true);
    assert.equal(clock.timers.size, 0);
  });
}

test('end(originalResult) without a terminal event forwards the same original result', async () => {
  const upstream = createAssistantMessageEventStream();
  const final = message('Ended without a done event.');
  upstream.end(final);
  const { output, events, results, clock } = observed(upstream);
  assert.equal(await output.result(), final);
  assert.deepEqual(events, []);
  assert.deepEqual(results, [final]);
  assert.equal(clock.timers.size, 0);
});

test('end without a result cannot leave the result-only consumer permanently pending', async () => {
  const upstream = createAssistantMessageEventStream();
  upstream.end();
  const { output, clock } = observed(upstream);
  await setImmediate();
  const rejected = assert.rejects(output.result(), /first.response/i);
  clock.advance(90);
  await rejected;
  assert.equal(clock.timers.size, 0);
});

test('pre-abort dispatches no delegate; an uncooperative iterator return cannot delay abort', async () => {
  const cancelled = new AbortController();
  cancelled.abort(new Error('Pre-cancelled'));
  let delegated = 0;
  const before = observeNativeStream(() => {
    delegated += 1;
    return createAssistantMessageEventStream();
  }, { signal: cancelled.signal, firstResponseMs: 90, idleMs: 120 });
  await assert.rejects(before.result(), /Pre-cancelled/);
  assert.equal(delegated, 0);

  const controller = new AbortController();
  const clock = new Clock();
  const upstream = createAssistantMessageEventStream();
  let returned = 0;
  upstream[Symbol.asyncIterator] = () => ({
    next: () => new Promise(() => {}),
    return: () => { returned += 1; return new Promise(() => {}); },
    [Symbol.asyncIterator]() { return this; },
  });
  const output = observeNativeStream(() => upstream, { clock, signal: controller.signal, firstResponseMs: 90, idleMs: 120 });
  await setImmediate();
  const rejected = assert.rejects(output.result(), /Abort/);
  controller.abort();
  await rejected;
  assert.equal(returned, 1);
  assert.equal(clock.timers.size, 0);
});

test('abort wins a just-resolved next() and suppresses all late events and usage', async () => {
  const controller = new AbortController();
  const upstream = createAssistantMessageEventStream();
  const events: AssistantMessageEvent[] = [];
  const results: AssistantMessage[] = [];
  const clock = new Clock();
  const output = observeNativeStream(() => upstream, { clock, signal: controller.signal, firstResponseMs: 90, idleMs: 120,
    onEvent: (event) => events.push(event), onResult: (result) => results.push(result) });
  await setImmediate();
  const final = message();
  upstream.push({ type: 'start', partial: final });
  const rejected = assert.rejects(output.result(), /Abort/);
  controller.abort();
  upstream.push({ type: 'done', reason: 'stop', message: final });
  await rejected;
  await setImmediate();
  assert.deepEqual(events, []);
  assert.deepEqual(results, []);
  assert.equal(clock.timers.size, 0);
});

test('a delayed delegate cannot attach a pump or forward buffered output after abort', async () => {
  const controller = new AbortController();
  const upstream = createAssistantMessageEventStream();
  let release!: (stream: AssistantMessageEventStream) => void;
  const pending = new Promise<AssistantMessageEventStream>((resolve) => { release = resolve; });
  const events: AssistantMessageEvent[] = [];
  const output = observeNativeStream(() => pending, { signal: controller.signal, firstResponseMs: 90, idleMs: 120,
    onEvent: (event) => events.push(event) });
  const rejected = assert.rejects(output.result(), /Abort/);
  controller.abort();
  release(upstream);
  upstream.push({ type: 'done', reason: 'stop', message: message() });
  await rejected;
  await setImmediate();
  assert.deepEqual(events, []);
});
