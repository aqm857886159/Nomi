import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { runAgentTurn } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import { createRuntimeFixture } from './httpFixture.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDYQAAAAASUVORK5CYII=', 'base64');
const pdf = Buffer.from('%PDF-1.7\nNomi actual document content.\n%%EOF');

for (const kind of ['anthropic', 'openai-responses'] as const) {
  test(`${kind}: two turns retain real image/PDF/history but inject only the current full work snapshot`, async (t) => {
    const { request, http } = await createRuntimeFixture(t, [
      { type: 'tool', calls: [{ id: 'read-one', name: 'read_shot', arguments: {} }] },
      { type: 'text', text: 'The first reference is approved.' },
      { type: 'text', text: 'The revised shot is approved.' },
    ]);
    request.model = { ...request.model, kind };
    request.tools = [{ name: 'read_shot', description: 'Read current shot.', schema: z.object({}) }];
    request.user = { durableText: 'Use the reference.\nActual extracted document text.',
      currentContextText: 'FIRST_WHOLE_CANVAS_STATE', images: [{ data: png, mimeType: 'image/png' }],
      pdfs: [{ fileName: 'reference.pdf', data: pdf }] };
    let hosts = 0;
    const hooks = { emit: () => {}, awaitToolConfirmation: async () => {
      hosts += 1; return { ok: true as const, result: 'READ_SHOT_APPROVED' };
    } };
    const first = await runAgentTurn(request, hooks);
    assert.equal(first.status, 'finished');
    for (const call of http.requests) {
      assert.match(JSON.stringify(call.body), /FIRST_WHOLE_CANVAS_STATE/);
      assert.match(JSON.stringify(call.body), new RegExp(pdf.toString('base64')));
      assert.match(JSON.stringify(call.body), new RegExp(png.toString('base64').replace(/[+]/g, '\\+')));
    }
    assert.doesNotMatch(first.snapshot ?? '', /FIRST_WHOLE_CANVAS_STATE/);
    assert.match(first.snapshot ?? '', /Actual extracted document text/);
    request.snapshot = first.snapshot;
    request.user = { durableText: 'Use the reference.', currentContextText: 'SECOND_WHOLE_CANVAS_STATE' };
    const second = await runAgentTurn(request, hooks);
    assert.equal(second.status, 'finished');
    const wire = JSON.stringify(http.requests[2].body);
    assert.doesNotMatch(wire, /FIRST_WHOLE_CANVAS_STATE/);
    assert.match(wire, /SECOND_WHOLE_CANVAS_STATE/);
    assert.match(wire, /READ_SHOT_APPROVED/);
    assert.match(wire, new RegExp(pdf.toString('base64')));
    assert.match(wire, new RegExp(png.toString('base64').replace(/[+]/g, '\\+')));
    assert.equal(hosts, 1, 'snapshot restore never replays approved tools');
    assert.doesNotMatch(second.snapshot ?? '', /WHOLE_CANVAS_STATE/);
    assert.match(second.snapshot ?? '', /The revised shot is approved/);
  });
}

test('same durable text on an older user message does not receive the new transient work snapshot', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'text', text: 'First.' }, { type: 'text', text: 'Second.' },
  ]);
  request.user = { durableText: 'Continue.', currentContextText: 'OLD_FULL_WORK' };
  const hooks = { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true as const }) };
  const first = await runAgentTurn(request, hooks);
  request.snapshot = first.snapshot;
  request.user = { durableText: 'Continue.', currentContextText: 'NEW_FULL_WORK' };
  await runAgentTurn(request, hooks);
  const users = (http.requests[1].body.messages as Array<{ role: string; content: unknown }>).filter((item) => item.role === 'user');
  assert.equal(users.length, 2);
  assert.equal(JSON.stringify(users[0]).includes('NEW_FULL_WORK'), false);
  assert.equal(JSON.stringify(users[1]).includes('NEW_FULL_WORK'), true);
  assert.equal(JSON.stringify(http.requests[1].body).includes('OLD_FULL_WORK'), false);
});

test('a restored user with the same timestamp and text never receives the current transient context', async (t) => {
  t.mock.method(Date, 'now', () => 1_700_000_000_000);
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'text', text: 'First.' }, { type: 'text', text: 'Second.' },
  ]);
  request.user = { durableText: 'Continue.', currentContextText: 'OLD_SAME_MILLISECOND_WORK' };
  const hooks = { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true as const }) };
  const first = await runAgentTurn(request, hooks);
  assert.equal(first.status, 'finished');
  request.snapshot = first.snapshot;
  request.user.currentContextText = 'CURRENT_SAME_MILLISECOND_WORK';
  const second = await runAgentTurn(request, hooks);
  assert.equal(second.status, 'finished');
  const users = (http.requests[1].body.messages as Array<{ role: string; content: unknown }>).filter((item) => item.role === 'user');
  assert.equal(users.length, 2);
  assert.doesNotMatch(JSON.stringify(users[0]), /CURRENT_SAME_MILLISECOND_WORK/);
  assert.match(JSON.stringify(users[1]), /CURRENT_SAME_MILLISECOND_WORK/);
  assert.doesNotMatch(JSON.stringify(http.requests[1].body), /OLD_SAME_MILLISECOND_WORK/);
  assert.doesNotMatch(second.snapshot ?? '', /SAME_MILLISECOND_WORK/);
});

test('unsupported generic-compatible native PDF is rejected before model dispatch', async (t) => {
  const { request, http } = await createRuntimeFixture(t, []);
  request.user.pdfs = [{ fileName: 'reference.pdf', data: pdf }];
  const result = await runAgentTurn(request, { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }) });
  assert.equal(result.status, 'error');
  assert.match(result.error?.message ?? '', /unsupported/i);
  assert.equal(http.requests.length, 0);
});
