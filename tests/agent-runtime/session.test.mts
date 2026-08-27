import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { createControlledSession, type ControlledSessionOptions } from '../../electron/harness/runtime/pi/session.mjs';
import type { NomiModelConfig } from '../../electron/harness/runtime/pi/model.mjs';
import type { HostToolResult } from '../../electron/harness/runtime/pi/tools.mjs';
import { createHttpFixture, type FixtureReply } from './httpFixture.mjs';

async function sessionFactory() {
  return createControlledSession;
}

async function sandbox(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'nomi-pi-session-'));
  const cwd = join(root, 'project');
  const agentDir = join(root, 'agent');
  await Promise.all([mkdir(cwd), mkdir(agentDir)]);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, cwd, agentDir };
}

async function setup(t: TestContext, replies: FixtureReply[], extra: Partial<ControlledSessionOptions> = {}) {
  const paths = await sandbox(t);
  const http = await createHttpFixture(replies);
  t.after(http.close);
  const create = await sessionFactory();
  const controlled = await create({ ...paths, systemPrompt: 'Only Nomi controls this conversation.',
    model: { kind: 'openai-compatible', providerId: 'nomi-local', modelId: 'chosen-model',
      baseURL: http.baseURL, authType: 'api-key', apiKey: 'nomi-literal-key' }, ...extra });
  t.after(controlled.dispose);
  return { ...paths, http, ...controlled };
}

function contentText(messages: AgentSession['messages']) {
  return messages.map((message) => 'content' in message
    ? JSON.stringify(message.content) : '').join('\n');
}

test('real SDK sends only the exact Nomi model, headers, prompt and explicit tool', async (t) => {
  const http = await createHttpFixture([
    { type: 'tool', calls: [{ id: 'call-one', name: 'nomi_echo', arguments: { value: ' hello ' } }] },
    { type: 'text', text: 'Nomi result received.' },
  ]);
  t.after(http.close);
  const paths = await sandbox(t);
  let executions = 0;
  const create = await sessionFactory();
  const controlled = await create({ ...paths, systemPrompt: 'NOMI_SYSTEM_ONLY',
    model: { kind: 'openai-compatible', providerId: 'nomi-exact', modelId: 'exact/model-v7',
      baseURL: http.baseURL, authType: 'api-key', apiKey: '${NOMI_NOT_AN_ENV_KEY}',
      headers: { 'x-nomi-marker': '!must-stay-literal', 'x-nomi-env': '${NOMI_NOT_AN_ENV_HEADER}' } },
    tools: [{ name: 'nomi_echo', description: 'Return the approved Nomi result.',
      schema: z.object({ value: z.string() }).transform(({ value }) => ({ normalized: value.trim() })),
      execute: async (args: unknown) => {
        assert.deepEqual(args, { normalized: 'hello' });
        executions += 1;
        return { status: 'ok', content: [{ type: 'text', text: 'approved-result' }] };
      } }],
  });
  t.after(controlled.dispose);
  assert.deepEqual(controlled.session.getActiveToolNames(), ['nomi_echo']);
  assert.equal(controlled.session.agent.toolExecution, 'sequential');
  await controlled.session.prompt('Echo hello using the tool.');
  assert.equal(executions, 1);
  assert.equal(http.requests.length, 2);
  const [first, second] = http.requests;
  assert.equal(first.path, '/v1/chat/completions');
  assert.equal(first.body.model, 'exact/model-v7');
  assert.equal(first.headers.authorization, 'Bearer ${NOMI_NOT_AN_ENV_KEY}');
  assert.equal(first.headers['x-nomi-marker'], '!must-stay-literal');
  assert.equal(first.headers['x-nomi-env'], '${NOMI_NOT_AN_ENV_HEADER}');
  assert.deepEqual((first.body.messages as Array<unknown>)[0], { role: 'system', content: 'NOMI_SYSTEM_ONLY' });
  const wireTools = first.body.tools as Array<{ function: { name: string; parameters: unknown } }>;
  assert.deepEqual(wireTools.map((tool) => tool.function.name), ['nomi_echo']);
  assert.match(JSON.stringify(wireTools[0].function.parameters), /"value"/);
  assert.match(JSON.stringify(second.body.messages), /approved-result/);
  assert.match(contentText(controlled.session.messages), /Nomi result received/);
});

test('auth:none has no Authorization header on the real HTTP request', async (t) => {
  const http = await createHttpFixture([{ type: 'text', text: 'No authentication needed.' }]);
  t.after(http.close);
  const paths = await sandbox(t);
  const create = await sessionFactory();
  const controlled = await create({ ...paths, systemPrompt: 'Nomi only.',
    model: { kind: 'openai-compatible', providerId: 'nomi-keyless', modelId: 'keyless-model',
      baseURL: http.baseURL, authType: 'none', apiKey: 'must-not-leak',
      headers: { AUTHORIZATION: 'Bearer must-not-leak-either', 'x-nomi': 'retained' } } });
  t.after(controlled.dispose);
  await controlled.session.prompt('Hello.');
  assert.equal(http.requests.length, 1);
  assert.equal(http.requests[0].headers.authorization, undefined);
  assert.equal(http.requests[0].headers['x-nomi'], 'retained');
  assert.equal(JSON.stringify(http.requests).includes('must-not-leak'), false);
  assert.deepEqual(await controlled.modelRuntime.listCredentials(), []);
});

test('no disk instructions, settings, credentials, models, skills or extensions are loaded', async (t) => {
  const paths = await sandbox(t);
  const marker = join(paths.root, 'extension-was-loaded');
  for (const directory of [paths.cwd, paths.agentDir, join(paths.cwd, '.pi')]) {
    await mkdir(join(directory, 'skills', 'injected'), { recursive: true });
    await mkdir(join(directory, 'extensions'), { recursive: true });
    await Promise.all([
      writeFile(join(directory, 'AGENTS.md'), 'DISK_AGENT_INJECTION'),
      writeFile(join(directory, 'SYSTEM.md'), 'DISK_SYSTEM_INJECTION'),
      writeFile(join(directory, 'APPEND_SYSTEM.md'), 'DISK_APPEND_INJECTION'),
      writeFile(join(directory, 'auth.json'), '{ malformed auth'),
      writeFile(join(directory, 'models.json'), '{ malformed models'),
      writeFile(join(directory, 'settings.json'), '{ malformed settings'),
      writeFile(join(directory, 'skills', 'injected', 'SKILL.md'),
        '---\nname: injected\ndescription: injected disk skill\n---\nDISK_SKILL_INJECTION'),
      writeFile(join(directory, 'extensions', 'injected.js'),
        `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'loaded');export default ()=>{};`),
    ]);
  }
  const http = await createHttpFixture([{ type: 'text', text: 'Isolated.' }]);
  t.after(http.close);
  const create = await sessionFactory();
  const controlled = await create({ ...paths, systemPrompt: 'ONLY_NOMI',
    model: { kind: 'openai-compatible', providerId: 'isolation', modelId: 'isolation',
      baseURL: http.baseURL, authType: 'api-key', apiKey: 'explicit-key' } });
  t.after(controlled.dispose);
  await controlled.session.prompt('Hello.');
  assert.deepEqual(controlled.session.getActiveToolNames(), []);
  assert.deepEqual(controlled.session.resourceLoader.getAgentsFiles().agentsFiles, []);
  assert.deepEqual(controlled.session.resourceLoader.getSkills().skills, []);
  assert.deepEqual(controlled.session.resourceLoader.getExtensions().extensions, []);
  assert.equal(JSON.stringify(http.requests).includes('DISK_'), false);
  assert.equal(http.requests[0].headers.authorization, 'Bearer explicit-key');
  assert.match(contentText(controlled.session.messages), /Isolated/);
  await assert.rejects(access(marker));
  assert.equal(await readFile(join(paths.agentDir, 'auth.json'), 'utf8'), '{ malformed auth');
});

test('singleShot has an empty allowlist even when a malicious response requests a registered tool', async (t) => {
  let executions = 0;
  const controlled = await setup(t, [
    { type: 'tool', calls: [
      { id: 'malicious', name: 'nomi_write', arguments: {} },
      { id: 'builtin', name: 'write', arguments: { path: 'must-not-exist.txt', content: 'unsafe' } },
    ] },
    { type: 'text', text: 'No tool ran.' },
  ], { singleShot: true, tools: [{ name: 'nomi_write', description: 'Write an approved item.',
    schema: z.object({}), execute: async () => {
      executions += 1;
      return { status: 'ok', content: [{ type: 'text', text: 'must not happen' }] };
    } }] });
  await controlled.session.prompt('Do not execute tools.');
  assert.equal(executions, 0);
  assert.deepEqual(controlled.session.getActiveToolNames(), []);
  assert.ok(!controlled.http.requests[0].body.tools ||
    (controlled.http.requests[0].body.tools as unknown[]).length === 0);
  assert.equal(controlled.session.messages.find((message) => message.role === 'toolResult')?.isError, true);
  await assert.rejects(access(join(controlled.cwd, 'must-not-exist.txt')));
});

test('schema failure never reaches the host; correction preserves preprocess and transform', async (t) => {
  const seen: unknown[] = [];
  const controlled = await setup(t, [
    { type: 'tool', calls: [{ id: 'invalid', name: 'nomi_frames', arguments: { frames: 'invalid' } }] },
    { type: 'tool', calls: [{ id: 'corrected', name: 'nomi_frames', arguments: { frames: 'auto' } }] },
    { type: 'text', text: 'Corrected.' },
  ], { tools: [{ name: 'nomi_frames', description: 'Set an approved frame count.',
    schema: z.object({ frames: z.preprocess((value) => value === 'auto' ? 24 : value, z.number().int().positive()) })
      .transform(({ frames }) => ({ frameCount: frames })),
    execute: async (args: unknown) => {
      seen.push(args);
      return { status: 'ok', content: [{ type: 'text', text: 'frame-count-24' }] };
    } }] });
  await controlled.session.prompt('Set frames.');
  assert.deepEqual(seen, [{ frameCount: 24 }]);
  const results = controlled.session.messages.filter((message) => message.role === 'toolResult');
  assert.equal(results.length, 2);
  assert.equal(results[0].isError, true);
  assert.equal(results[1].isError, false);
  assert.match(JSON.stringify(controlled.http.requests[1].body.messages), /frames/);
  assert.match(JSON.stringify(controlled.http.requests[2].body.messages), /frame-count-24/);
});

test('host denial is a model-visible error and does not invoke a second executor', async (t) => {
  let hostRequests = 0;
  const controlled = await setup(t, [
    { type: 'tool', calls: [{ id: 'denied', name: 'nomi_denied', arguments: {} }] },
    { type: 'text', text: 'Understood: denied.' },
  ], { tools: [{ name: 'nomi_denied', description: 'Wait for host approval.', schema: z.object({}),
    execute: async () => {
      hostRequests += 1;
      return { status: 'denied', message: 'Nomi denied this write.' };
    } }] });
  await controlled.session.prompt('Request a write.');
  const result = controlled.session.messages.find((message) => message.role === 'toolResult');
  assert.equal(result?.isError, true);
  assert.match(JSON.stringify(controlled.http.requests[1].body.messages), /Nomi denied this write/);
  assert.equal(controlled.http.requests.length, 2);
  assert.equal(hostRequests, 1);
});

test('synchronous host failures release every abort listener across repeated real SDK tool calls', async (t) => {
  const signals = new Set<AbortSignal>();
  const listenersBefore: number[] = [];
  const listenersAfter: number[] = [];
  let calls = 0;
  const controlled = await setup(t, [
    { type: 'tool', calls: Array.from({ length: 12 }, (_, index) => ({
      id: `sync-failure-${index}`, name: 'nomi_sync_failure', arguments: {},
    })) },
    { type: 'text', text: 'The host errors were received.' },
  ], { tools: [{ name: 'nomi_sync_failure', description: 'Report a synchronous host failure.',
    schema: z.object({}), execute: (_args: unknown, { signal }: { signal: AbortSignal }) => {
      calls += 1;
      signals.add(signal);
      throw new Error('Synchronous Nomi host failure');
    } }] });
  const beforeToolCall = controlled.session.agent.beforeToolCall!;
  controlled.session.agent.beforeToolCall = (context, signal) => {
    assert.ok(signal);
    listenersBefore.push(getEventListeners(signal, 'abort').length);
    return beforeToolCall(context, signal);
  };
  const afterToolCall = controlled.session.agent.afterToolCall;
  controlled.session.agent.afterToolCall = async (context, signal) => {
    assert.ok(signal);
    listenersAfter.push(getEventListeners(signal, 'abort').length);
    return afterToolCall?.(context, signal);
  };
  await controlled.session.prompt('Run the approved calls.');
  assert.equal(calls, 12);
  assert.equal(signals.size, 1);
  const results = controlled.session.messages.filter((message) => message.role === 'toolResult');
  assert.equal(results.length, 12);
  assert.ok(results.every((result) => result.isError));
  assert.equal(controlled.http.requests.length, 2);
  assert.match(JSON.stringify(controlled.http.requests[1].body.messages), /Synchronous Nomi host failure/);
  assert.equal(listenersAfter.length, 12);
  assert.deepEqual(listenersAfter, listenersBefore, 'each host call must restore its existing listener count');
});

test('a pre-aborted host signal never dispatches the validated public SDK tool', async (t) => {
  let calls = 0;
  const cancelled = new AbortController();
  cancelled.abort();
  const controlled = await setup(t, [
    { type: 'tool', calls: [{ id: 'pre-aborted', name: 'nomi_pre_aborted', arguments: {} }] },
    { type: 'text', text: 'No host effect was dispatched.' },
  ], { tools: [{ name: 'nomi_pre_aborted', description: 'Must not run after cancellation.',
    schema: z.object({}), execute: async () => {
      calls += 1;
      return { status: 'ok', content: [{ type: 'text', text: 'must not run' }] };
    } }] });
  const validate = controlled.session.agent.beforeToolCall!;
  let checked = false;
  controlled.session.agent.beforeToolCall = async (context, signal) => {
    await validate(context, signal);
    const tool = controlled.session.agent.state.tools.find((candidate) => candidate.name === context.toolCall.name);
    assert.ok(tool);
    await assert.rejects(tool.execute(context.toolCall.id, context.args, cancelled.signal), /Nomi tool cancelled/);
    checked = true;
    return { block: true, reason: 'The host operation was already cancelled.' };
  };
  await controlled.session.prompt('Check the cancelled call.');
  assert.equal(checked, true);
  assert.equal(calls, 0);
  assert.equal(getEventListeners(cancelled.signal, 'abort').length, 0);
});

test('a late host rejection after stop is consumed without another terminal event', async (t) => {
  let hostStarted!: () => void;
  const started = new Promise<void>((resolve) => { hostStarted = resolve; });
  let rejectLate!: (error: Error) => void;
  const hostResult = new Promise<HostToolResult>((_resolve, reject) => { rejectLate = reject; });
  let hostSignal: AbortSignal | undefined;
  let calls = 0;
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => { unhandled.push(error); };
  process.on('unhandledRejection', onUnhandled);
  t.after(() => { process.off('unhandledRejection', onUnhandled); });
  const controlled = await setup(t, [
    { type: 'tool', calls: [{ id: 'late-rejection', name: 'nomi_late_rejection', arguments: {} }] },
  ], { tools: [{ name: 'nomi_late_rejection', description: 'Wait for a host result that can reject late.',
    schema: z.object({}), execute: (_args: unknown, { signal }: { signal: AbortSignal }) => {
      calls += 1;
      hostSignal = signal;
      hostStarted();
      return hostResult;
    } }] });
  const events: string[] = [];
  controlled.session.subscribe((event) => { events.push(event.type); });
  const run = controlled.session.prompt('Wait for the host result.');
  await started;
  await controlled.stop();
  await run;
  assert.ok(hostSignal);
  assert.equal(getEventListeners(hostSignal, 'abort').length, 0);
  const beforeLate = JSON.stringify(controlled.session.messages);
  // Do not attach a test catch to hostResult: only the real adapter may consume it.
  rejectLate(new Error('Late rejected Nomi host result'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(unhandled, []);
  assert.equal(JSON.stringify(controlled.session.messages), beforeLate);
  assert.equal(calls, 1);
  assert.equal(events.filter((event) => event === 'agent_end').length, 1);
  assert.equal(events.filter((event) => event === 'tool_execution_end').length, 1);
  assert.equal(controlled.http.requests.length, 1);
});

test('stop settles a waiting host result once and ignores late completion', { timeout: 5000 }, async (t) => {
  let hostStarted!: () => void;
  const started = new Promise<void>((resolve) => { hostStarted = resolve; });
  let release!: (value: HostToolResult) => void;
  const hostResult = new Promise<HostToolResult>((resolve) => { release = resolve; });
  let calls = 0;
  let hostSignal: AbortSignal | undefined;
  const controlled = await setup(t, [
    { type: 'tool', calls: [{ id: 'waiting', name: 'nomi_wait', arguments: {} }] },
  ], { tools: [{ name: 'nomi_wait', description: 'Wait for the Nomi executor.', schema: z.object({}),
    execute: async (_args: unknown, context: { signal: AbortSignal }) => {
      calls += 1;
      hostSignal = context.signal;
      hostStarted();
      return hostResult;
    } }] });
  const events: string[] = [];
  controlled.session.subscribe((event) => { events.push(event.type); });
  const run = controlled.session.prompt('Wait for approval.');
  await started;
  await controlled.session.followUp('This queued message must be cleared on stop.');
  assert.equal(controlled.session.pendingMessageCount, 1);
  await controlled.stop();
  await run;
  assert.equal(hostSignal?.aborted, true);
  assert.equal(controlled.session.isIdle, true);
  assert.equal(controlled.session.pendingMessageCount, 0);
  assert.equal(calls, 1);
  assert.equal(events.filter((event) => event === 'agent_end').length, 1);
  assert.equal(events.filter((event) => event === 'tool_execution_end').length, 1);
  const beforeLate = JSON.stringify(controlled.session.messages);
  release({ status: 'ok', content: [{ type: 'text', text: 'late-must-not-appear' }] });
  await hostResult;
  await Promise.resolve();
  assert.equal(JSON.stringify(controlled.session.messages), beforeLate);
  assert.equal(calls, 1);
  assert.equal(events.filter((event) => event === 'agent_end').length, 1);
  assert.equal(controlled.http.requests.length, 1);
});

test('missing model identity and unsupported no-auth protocols reject without fallback', async (t) => {
  const paths = await sandbox(t);
  const create = await sessionFactory();
  const invalidModels: NomiModelConfig[] = [
    { kind: 'openai-compatible', providerId: '', modelId: 'x', baseURL: 'http://127.0.0.1:1/v1', authType: 'none' },
    { kind: 'openai-compatible', providerId: 'x', modelId: '', baseURL: 'http://127.0.0.1:1/v1', authType: 'none' },
    { kind: 'anthropic', providerId: 'x', modelId: 'x', baseURL: 'http://127.0.0.1:1/v1', authType: 'none' },
    { kind: 'openai-responses', providerId: 'x', modelId: 'x', baseURL: 'http://127.0.0.1:1/v1', authType: 'none' },
  ];
  for (const model of invalidModels) {
    await assert.rejects(create({ ...paths, systemPrompt: 'Nomi.', model }), /model|provider|auth/i);
  }
});

for (const kind of ['openai-compatible', 'openai-responses', 'anthropic'] as const) {
  test(`${kind} sends the exact endpoint and preserves existing no-explicit-output-cap behavior`, async (t) => {
    const paths = await sandbox(t);
    const http = await createHttpFixture([{ type: 'text', text: `${kind} worked.` }]);
    t.after(http.close);
    const controlled = await createControlledSession({ ...paths, systemPrompt: 'Nomi protocol test.',
      model: { kind, providerId: `nomi-${kind}`, modelId: 'exact-choice',
        baseURL: http.baseURL.replace('/v1', '/proxy/v1'), authType: 'api-key', apiKey: 'explicit-key' } });
    t.after(controlled.dispose);
    await controlled.session.prompt('Hello.');
    assert.equal(http.requests.length, 1);
    const request = http.requests[0];
    const expectedPath = kind === 'anthropic' ? '/proxy/v1/messages'
      : kind === 'openai-responses' ? '/proxy/v1/responses' : '/proxy/v1/chat/completions';
    assert.equal(new URL(request.path, http.baseURL).pathname, expectedPath);
    assert.equal(request.body.model, 'exact-choice');
    assert.equal(request.headers[kind === 'anthropic' ? 'x-api-key' : 'authorization'],
      kind === 'anthropic' ? 'explicit-key' : 'Bearer explicit-key');
    assert.match(contentText(controlled.session.messages), new RegExp(`${kind} worked`));
    // Current @ai-sdk/anthropic 1.2.12 defaults its mandatory max_tokens to 4096.
    assert.equal(request.body.max_tokens, kind === 'anthropic' ? 4096 : undefined);
    assert.equal(request.body.max_completion_tokens, undefined);
    assert.equal(request.body.max_output_tokens, undefined);
  });
  test(`${kind} preserves an explicit output cap and temperature without SDK clamping`, async (t) => {
    const paths = await sandbox(t);
    const http = await createHttpFixture([{ type: 'text', text: 'Explicit settings preserved.' }]);
    t.after(http.close);
    const model = { kind, providerId: `nomi-explicit-${kind}`, modelId: 'chosen',
      baseURL: http.baseURL, authType: 'api-key' as const, apiKey: 'key',
      contextWindow: 4096, maxOutputTokens: 777, temperature: 0.25 };
    const controlled = await createControlledSession({ ...paths, systemPrompt: 'Nomi.', model });
    t.after(controlled.dispose);
    await controlled.session.prompt('Hello.');
    const body = http.requests[0].body;
    assert.equal(body[kind === 'openai-responses' ? 'max_output_tokens' : 'max_tokens'], 777);
    assert.equal(body.max_completion_tokens, undefined);
    assert.equal(body.temperature, 0.25);
  });
}

test('Anthropic retains a custom gateway base path that does not end in v1', async (t) => {
  const paths = await sandbox(t);
  const http = await createHttpFixture([{ type: 'text', text: 'Exact custom gateway.' }]);
  t.after(http.close);
  const controlled = await createControlledSession({ ...paths, systemPrompt: 'Nomi.',
    model: { kind: 'anthropic', providerId: 'custom-anthropic', modelId: 'custom',
      baseURL: http.baseURL.replace('/v1', '/tenant/anthropic'), authType: 'api-key', apiKey: 'key' } });
  t.after(controlled.dispose);
  await controlled.session.prompt('Hello.');
  assert.equal(new URL(http.requests[0].path, http.baseURL).pathname, '/tenant/anthropic/messages');
  assert.match(contentText(controlled.session.messages), /Exact custom gateway/);
});

test('Zod validates original input before pi numeric coercion can authorize a host effect', async (t) => {
  const seen: unknown[] = [];
  const controlled = await setup(t, [
    { type: 'tool', calls: [{ id: 'string', name: 'nomi_number', arguments: { count: '24' } }] },
    { type: 'tool', calls: [{ id: 'number', name: 'nomi_number', arguments: { count: 24 } }] },
    { type: 'text', text: 'Correct type.' },
  ], { tools: [{ name: 'nomi_number', description: 'An exact numeric count.',
    schema: z.object({ count: z.number() }), execute: async (args: unknown) => {
      seen.push(args);
      return { status: 'ok', content: [{ type: 'text', text: 'number received' }] };
    } }] });
  await controlled.session.prompt('Use a number.');
  assert.deepEqual(seen, [{ count: 24 }]);
  const results = controlled.session.messages.filter((message) => message.role === 'toolResult');
  assert.equal(results[0].isError, true);
  assert.equal(results[1].isError, false);
});

test('Zod strip semantics accept unknown fields then remove them before the host runs', async (t) => {
  const seen: unknown[] = [];
  const controlled = await setup(t, [
    { type: 'tool', calls: [{ id: 'strip', name: 'nomi_strip', arguments: { value: 'keep', extra: 'discard' } }] },
    { type: 'text', text: 'Done.' },
  ], { tools: [{ name: 'nomi_strip', description: 'Keep the supported field.',
    schema: z.object({ value: z.string() }), execute: async (args: unknown) => {
      seen.push(args);
      return { status: 'ok', content: [{ type: 'text', text: 'stripped' }] };
    } }] });
  await controlled.session.prompt('Use the tool.');
  assert.deepEqual(seen, [{ value: 'keep' }]);
});

test('the public payload hook preserves profile temperature and extra request fields', async (t) => {
  const controlled = await setup(t, [{ type: 'text', text: 'Profile honored.' }]);
  let hookCalls = 0;
  controlled.session.agent.onPayload = (payload) => {
    hookCalls += 1;
    return { ...(payload as Record<string, unknown>), temperature: 1, enable_thinking: false };
  };
  await controlled.session.prompt('Run with the Nomi-selected profile.');
  assert.equal(controlled.http.requests[0].body.temperature, 1);
  assert.equal(controlled.http.requests[0].body.enable_thinking, false);
  assert.equal(hookCalls, 1);
});

test('explicit SDK stream options retain the per-request output cap used by summaries', async (t) => {
  const controlled = await setup(t, [{ type: 'text', text: 'Bounded summary-style request.' }]);
  const sdkStream = controlled.session.agent.streamFunction;
  controlled.session.agent.streamFunction = (model, context, options) =>
    sdkStream(model, context, { ...options, maxTokens: 333 });
  await controlled.session.prompt('Use the explicit per-request cap.');
  assert.equal(controlled.http.requests[0].body.max_tokens, 333);
});

test('two tools from one assistant response execute serially at the host boundary', async (t) => {
  const order: string[] = [];
  let active = 0;
  let peak = 0;
  const controlled = await setup(t, [
    { type: 'tool', calls: [
      { id: 'first', name: 'nomi_serial', arguments: { value: 'first' } },
      { id: 'second', name: 'nomi_serial', arguments: { value: 'second' } },
    ] }, { type: 'text', text: 'Both approved results received.' },
  ], { tools: [{ name: 'nomi_serial', description: 'Run an already approved operation.',
    schema: z.object({ value: z.string() }), execute: async ({ value }: { value: string }) => {
      active += 1;
      peak = Math.max(peak, active);
      order.push(`start:${value}`);
      await new Promise<void>((resolve) => setImmediate(resolve));
      order.push(`end:${value}`);
      active -= 1;
      return { status: 'ok', content: [{ type: 'text', text: value }] };
    } }] });
  await controlled.session.prompt('Execute the approved pair.');
  assert.equal(peak, 1);
  assert.deepEqual(order, ['start:first', 'end:first', 'start:second', 'end:second']);
});

test('immediate stop cancels the compact startup race before its HTTP request begins', { timeout: 5000 }, async (t) => {
  const controlled = await setup(t, []);
  controlled.session.settingsManager.applyOverrides({
    compaction: { enabled: false, keepRecentTokens: 100, reserveTokens: 1024 },
  });
  controlled.sessionManager.appendMessage({ role: 'user', content: 'Earlier approved idea '.repeat(300), timestamp: 1 });
  controlled.sessionManager.appendMessage({ role: 'user', content: 'Current approved idea '.repeat(300), timestamp: 2 });
  const leaf = controlled.sessionManager.getLeafId();
  const run = controlled.session.compact();
  const rejected = assert.rejects(run, /cancel|abort/i);
  await controlled.stop();
  await rejected;
  assert.equal(controlled.session.isCompacting, false);
  assert.equal(controlled.sessionManager.getLeafId(), leaf);
  assert.equal(controlled.http.requests.length, 0);
});

test('stop also waits for branch-summary cancellation without switching the selected leaf', { timeout: 5000 }, async (t) => {
  const controlled = await setup(t, []);
  const target = controlled.sessionManager.appendMessage({ role: 'user', content: 'First idea.', timestamp: 1 });
  controlled.sessionManager.appendMessage({ role: 'user', content: 'Later approved idea '.repeat(300), timestamp: 2 });
  const leaf = controlled.sessionManager.getLeafId();
  const run = controlled.session.navigateTree(target, { summarize: true });
  const rejected = assert.rejects(run, /abort|cancel/i);
  await controlled.stop();
  await rejected;
  assert.equal(controlled.session.isCompacting, false);
  assert.equal(controlled.sessionManager.getLeafId(), leaf);
  assert.equal(controlled.http.requests.length, 0);
});

test('provider authentication errors do not trigger a fallback model or hidden retries', async (t) => {
  const controlled = await setup(t, [{ type: 'error', status: 401, message: 'Fixture key rejected.' }]);
  await controlled.session.prompt('Hello.');
  assert.equal(controlled.http.requests.length, 1);
  assert.equal(controlled.http.requests[0].body.model, 'chosen-model');
  const result = controlled.session.messages.at(-1);
  assert.equal(result?.role, 'assistant');
  if (result?.role === 'assistant') {
    assert.equal(result.stopReason, 'error');
    assert.match(result.errorMessage ?? '', /Fixture key rejected/);
  }
});

test('immediate stop settles prompt preflight without a late request or history write, then permits a fresh prompt', async (t) => {
  const controlled = await setup(t, [{ type: 'text', text: 'Only the fresh prompt may receive this.' }]);
  const run = controlled.session.prompt('Cancel this prompt before it starts.');
  const settled = run.catch((error: unknown) => error);
  await controlled.stop();
  const stoppedEntries = JSON.stringify(controlled.sessionManager.getEntries());
  await settled;
  assert.equal(controlled.http.requests.length, 0, 'a stopped preflight must never reach HTTP');
  assert.equal(JSON.stringify(controlled.sessionManager.getEntries()), stoppedEntries,
    'a stopped preflight must never append history after stop resolves');
  assert.equal(controlled.session.isIdle, true);
  await controlled.session.prompt('This is the fresh prompt.');
  assert.equal(controlled.http.requests.length, 1);
  assert.match(JSON.stringify(controlled.http.requests[0].body), /This is the fresh prompt/);
  assert.doesNotMatch(JSON.stringify(controlled.http.requests[0].body), /Cancel this prompt before it starts/);
  assert.match(contentText(controlled.session.messages), /Only the fresh prompt may receive this/);
});

test('immediate dispose settles prompt preflight and permanently rejects new prompts', async (t) => {
  const controlled = await setup(t, [{ type: 'text', text: 'LATE_RESPONSE_AFTER_DISPOSE' }]);
  const run = controlled.session.prompt('Cancel this prompt by disposing immediately.');
  const settled = run.catch((error: unknown) => error);
  await controlled.dispose();
  const disposedEntries = JSON.stringify(controlled.sessionManager.getEntries());
  await settled;
  assert.equal(controlled.http.requests.length, 0, 'a disposed preflight must never reach HTTP');
  assert.equal(JSON.stringify(controlled.sessionManager.getEntries()), disposedEntries);
  await assert.rejects(controlled.session.prompt('A disposed session cannot start again.'), /disposed/i);
  assert.equal(controlled.http.requests.length, 0);
});

test('stop called by the public preflight callback wins before the SDK launches the turn', async (t) => {
  const controlled = await setup(t, [{ type: 'text', text: 'LATE_RESPONSE_AFTER_PREFLIGHT_STOP' }]);
  let stop: Promise<void> | undefined;
  let readyCallbacks = 0;
  const run = controlled.session.prompt('Stop at the public preflight boundary.', {
    preflightResult: (ready) => {
      if (ready) {
        readyCallbacks += 1;
        stop = controlled.stop();
      }
    },
  });
  const settled = run.catch((error: unknown) => error);
  await settled;
  assert.ok(stop);
  await stop;
  assert.equal(readyCallbacks, 1);
  assert.equal(controlled.http.requests.length, 0);
  assert.equal(controlled.session.isIdle, true);
});
