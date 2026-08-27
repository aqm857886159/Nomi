import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { z } from 'zod';
import { addPdfContext, installNativePdfBridge } from '../../electron/harness/runtime/pi/attachments.mjs';
import { createControlledSession, type ControlledSessionOptions } from '../../electron/harness/runtime/pi/session.mjs';
import { exportSnapshot, importSnapshot } from '../../electron/harness/runtime/pi/snapshot.mjs';
import { createHttpFixture } from './httpFixture.mjs';

const pdfBytes = Buffer.from('%PDF-1.7\nNomi native reference bytes\n%%EOF');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDYQAAAAASUVORK5CYII=';
async function sandbox(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'nomi-pi-context-'));
  const cwd = join(root, 'project');
  const agentDir = join(root, 'agent');
  const scratch = join(root, 'scratch');
  await Promise.all([mkdir(cwd), mkdir(agentDir), mkdir(scratch)]);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, cwd, agentDir, scratch };
}
function parts(value: unknown, types: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap((item) => parts(item, types));
  if (value === null || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [...(typeof record.type === 'string' && types.includes(record.type) ? [record] : []),
    ...Object.values(record).flatMap((item) => parts(item, types))];
}
function pdfPayloads(value: unknown): string[] {
  return parts(value, ['document', 'input_file']).map((part) => part.type === 'document'
    ? String((part.source as Record<string, unknown>).data)
    : String(part.file_data).replace('data:application/pdf;base64,', ''));
}

for (const kind of ['anthropic', 'openai-responses'] as const) {
  test(`${kind}: native PDF and image survive a tool turn and full-session restore`, async (t) => {
    const paths = await sandbox(t);
    const http = await createHttpFixture([
      { type: 'tool', calls: [{ id: 'reference-1', name: 'read_shot', arguments: { shot: 2 } }] },
      { type: 'text', text: 'Approved reference read.' },
      { type: 'text', text: 'Continued with the same reference.' },
      { type: 'text', text: 'Two distinct references.' },
      { type: 'text', text: 'Another thread without attachments.' },
    ]);
    t.after(http.close);
    let executions = 0;
    const options: ControlledSessionOptions = { ...paths, systemPrompt: 'NOMI_CONTEXT_ONLY',
      model: { kind, providerId: `nomi-${kind}`, modelId: 'chosen-model', baseURL: http.baseURL,
        authType: 'api-key', apiKey: 'local-fixture-key' },
      tools: [{ name: 'read_shot', description: 'Read the current shot without modifying it.',
        schema: z.object({ shot: z.number() }), execute: async (args) => {
          assert.equal(args.shot, 2);
          executions += 1;
          return { status: 'ok', content: [{ type: 'text', text: 'SHOT_2_APPROVED' }],
            details: { projectId: 'fixture-project', revision: 7 } };
        } }],
    };
    const first = await createControlledSession(options);
    t.after(first.dispose);
    installNativePdfBridge(first.session);
    await addPdfContext(first.session, [{ fileName: 'reference.pdf', data: pdfBytes }]);
    await first.session.prompt('Read shot 2 using the native reference.', { images: [{ type: 'image', mimeType: 'image/png', data: png }] });
    assert.equal(executions, 1);
    assert.equal(http.requests.length, 2);
    for (const request of http.requests) {
      assert.deepEqual(pdfPayloads(request.body), [pdfBytes.toString('base64')]);
      assert.equal(JSON.stringify(request.body).includes('[nomi-pdf:'), false);
      assert.equal(parts(request.body, ['image', 'input_image']).length, 1);
    }
    const snapshot = exportSnapshot(first.session);
    const manager = await importSnapshot(snapshot, { cwd: paths.cwd, tempRoot: paths.scratch });
    const continued = await createControlledSession({ ...options, sessionManager: manager });
    t.after(continued.dispose);
    installNativePdfBridge(continued.session);
    await continued.session.prompt('Continue without rerunning the approved tool.');
    assert.equal(executions, 1, 'restoring context must never replay a side effect');
    assert.deepEqual(pdfPayloads(http.requests[2].body), [pdfBytes.toString('base64')]);
    assert.match(JSON.stringify(http.requests[2].body), /SHOT_2_APPROVED/);
    assert.deepEqual(await readdir(paths.scratch), []);
    const result = continued.session.messages.at(-1);
    assert.equal(result?.role, 'assistant');
    if (result?.role === 'assistant') {
      assert.equal(result.stopReason, 'stop');
      assert.equal(result.usage.totalTokens, 14);
    }
    const secondPdf = Buffer.from('%PDF-1.7\nDifferent bytes, same filename\n%%EOF');
    await addPdfContext(continued.session, [{ fileName: 'reference.pdf', data: secondPdf }]);
    await continued.session.prompt('Compare the two references.');
    assert.deepEqual(pdfPayloads(http.requests[3].body), [pdfBytes.toString('base64'), secondPdf.toString('base64')]);
    const other = await createControlledSession(options);
    t.after(other.dispose);
    installNativePdfBridge(other.session);
    await other.session.prompt('No attachments in this conversation.');
    assert.deepEqual(pdfPayloads(http.requests[4].body), []);
    assert.equal(executions, 1);
  });
}

test('compatible supports images but rejects unsupported native PDF before any model request', async (t) => {
  const paths = await sandbox(t);
  const http = await createHttpFixture([{ type: 'text', text: 'Image received.' }]);
  t.after(http.close);
  const controlled = await createControlledSession({ ...paths, systemPrompt: 'Nomi image task.',
    model: { kind: 'openai-compatible', providerId: 'nomi-image', modelId: 'image-model',
      baseURL: http.baseURL, authType: 'none' } });
  t.after(controlled.dispose);
  installNativePdfBridge(controlled.session);
  await assert.rejects(addPdfContext(controlled.session, [{ fileName: 'unsupported.pdf', data: pdfBytes }]), /unsupported/i);
  assert.equal(http.requests.length, 0);
  await controlled.session.prompt('Describe this image.', { images: [{ type: 'image', mimeType: 'image/png', data: png }] });
  const images = parts(http.requests[0].body, ['image_url']);
  assert.equal(images.length, 1);
  assert.equal((images[0].image_url as Record<string, unknown>).url, `data:image/png;base64,${png}`);
  assert.deepEqual(pdfPayloads(http.requests[0].body), []);
});

test('real SDK compaction keeps its summary prompt, usage and boundary across a fresh session', async (t) => {
  const paths = await sandbox(t);
  const summary = '## Goal\nCoffee advert.\n## Key Decisions\nKeep approved shot 2 and warm morning light.';
  const http = await createHttpFixture([
    { type: 'tool', calls: [{ id: 'approved-2', name: 'read_shot', arguments: {} }] },
    { type: 'text', text: 'The earlier reference is approved.' },
    { type: 'text', text: 'The current direction is retained.' },
    { type: 'text', text: summary },
    { type: 'text', text: 'Resumed after compaction.' },
  ]);
  t.after(http.close);
  let executions = 0;
  const options: ControlledSessionOptions = { ...paths, systemPrompt: 'NOMI_NORMAL_TURN',
    model: { kind: 'openai-compatible', providerId: 'nomi-compact', modelId: 'chosen-model',
      baseURL: http.baseURL, authType: 'api-key', apiKey: 'fixture-key' },
    tools: [{ name: 'read_shot', description: 'Read approved shot.', schema: z.object({}), execute: async () => {
      executions += 1;
      return { status: 'ok', content: [{ type: 'text', text: 'APPROVED_SHOT_2' }] };
    } }],
  };
  const controlled = await createControlledSession(options);
  t.after(controlled.dispose);
  controlled.session.settingsManager.applyOverrides({ compaction: { enabled: false, keepRecentTokens: 200, reserveTokens: 1024 } });
  await controlled.session.prompt(`Original brief: ${'warm coffee morning '.repeat(400)}`);
  await controlled.session.prompt(`Current shot stays unchanged: ${'keep the approved cut '.repeat(80)}`);
  const before = controlled.sessionManager.getEntries();
  const compacted = await controlled.session.compact('Keep all approved creative decisions.');
  assert.match(compacted.summary, /Keep approved shot 2/);
  assert.equal(compacted.usage?.totalTokens, 14);
  const summaryRequest = http.requests[3].body;
  const summaryMessages = summaryRequest.messages as Array<{ role: string; content: unknown }>;
  assert.notEqual(summaryMessages[0].content, 'NOMI_NORMAL_TURN', 'normal-turn prompt must not overwrite the SDK summarizer');
  assert.match(JSON.stringify(summaryMessages[0].content), /summar/i);
  assert.match(JSON.stringify(summaryRequest), /APPROVED_SHOT_2/);
  assert.equal(summaryRequest.max_tokens, 819, 'keep the SDK summary budget, not a normal-turn default');
  assert.equal(parts(summaryRequest.tools, ['function']).length, 0);
  assert.equal(controlled.sessionManager.getEntries().length, before.length + 1);
  const manager = await importSnapshot(exportSnapshot(controlled.session), { cwd: paths.cwd, tempRoot: paths.scratch });
  assert.deepEqual(manager.buildSessionContext(), controlled.sessionManager.buildSessionContext());
  const resumed = await createControlledSession({ ...options, sessionManager: manager });
  t.after(resumed.dispose);
  await resumed.session.prompt('Continue using the approved decisions.');
  assert.equal(executions, 1);
  assert.match(JSON.stringify(http.requests[4].body), /Keep approved shot 2/);
  assert.match(JSON.stringify(http.requests[4].body), /Current shot stays unchanged/);
  assert.equal(http.requests.length, 5);
});

test('stop cancels an in-flight real compaction request without appending a late summary', { timeout: 8000 }, async (t) => {
  const paths = await sandbox(t);
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  const server = createServer(async (request, response) => {
    for await (const chunk of request) assert.ok(chunk);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.flushHeaders();
    requestStarted();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const controlled = await createControlledSession({ ...paths, systemPrompt: 'Nomi.',
    model: { kind: 'openai-compatible', providerId: 'nomi-stop-summary', modelId: 'chosen-model',
      baseURL: `http://127.0.0.1:${address.port}/v1`, authType: 'api-key', apiKey: 'fixture-key' } });
  t.after(controlled.dispose);
  controlled.session.settingsManager.applyOverrides({ compaction: { enabled: false, keepRecentTokens: 100, reserveTokens: 1024 } });
  controlled.sessionManager.appendMessage({ role: 'user', content: 'Earlier idea '.repeat(300), timestamp: 1 });
  controlled.sessionManager.appendMessage({ role: 'user', content: 'Current idea '.repeat(300), timestamp: 2 });
  const original = exportSnapshot(controlled.session);
  const run = controlled.session.compact();
  const rejected = assert.rejects(run, /cancel|abort/i);
  await started;
  assert.equal(controlled.session.isCompacting, true);
  await controlled.stop();
  assert.equal(controlled.session.isCompacting, false, 'stop resolves only once summary state settles');
  await rejected;
  assert.equal(exportSnapshot(controlled.session), original);
});
