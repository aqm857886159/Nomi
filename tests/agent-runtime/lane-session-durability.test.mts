// Agent lane · 会话落盘的三条**看不见的**保证：谁能读它、谁在持有它、它怎么被替换。
import assert from 'node:assert/strict';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';

import { LANE_READ_TOOL_TIMEOUT_MS } from '../../electron/shared/agentLane/laneToolContract.js';
import { LANE_DIR_MODE, LANE_FILE_MODE } from '../../electron/agentLane/laneFileSystem.mjs';
import { upgradeV4SessionFileIfNeeded } from '../../electron/agentLane/laneSessionV4Migration.mjs';
import { laneSessionsRoot } from '../../electron/agentLane/laneSession.mjs';
import { createDocumentLaneTools } from '../../electron/agentLane/laneDocumentTools.js';
import type { LaneToolDescriptor } from '../../electron/agentLane/laneRuntimePort.js';
import { createDocumentPort, createLaneFixture, FIXTURE_DESCRIBE } from './laneFixture.mjs';

const ONE_TURN = [
  { type: 'tool' as const, calls: [{ id: 'call-read', name: 'read_script', arguments: {} }] },
  { type: 'text' as const, text: 'Read it.' },
];

const mode = async (path: string) => (await stat(path)).mode & 0o777;

/** 盘上那一个 jsonl 会话文件。断言权限之前先证明**确实有**一个文件——否则「空 == 空」。 */
async function theSessionFile(projectDir: string): Promise<{ root: string; slug: string; file: string }> {
  const root = laneSessionsRoot(projectDir);
  const slugs = await readdir(root);
  assert.equal(slugs.length, 1, 'exactly one slug directory');
  const slug = join(root, slugs[0]!);
  const files = (await readdir(slug)).filter((name) => name.endsWith('.jsonl'));
  assert.equal(files.length, 1, 'exactly one jsonl session file');
  return { root, slug, file: join(slug, files[0]!) };
}

test('the transcript is owner-only on disk — it holds the user’s manuscript, not just metadata', async (t) => {
  const previousUmask = process.umask(0o022);
  t.after(() => { process.umask(previousUmask); });

  const fixture = await createLaneFixture(t, [...ONE_TURN]);
  const lane = await fixture.openLane(fixture.options);
  await lane.execute({ kind: 'prompt', text: 'Read the document.' });
  await lane.close();

  const { root, slug, file } = await theSessionFile(fixture.projectDir);
  assert.equal(await mode(file), LANE_FILE_MODE, 'the session jsonl is 0o600');
  assert.equal(await mode(slug), LANE_DIR_MODE, 'the slug directory is 0o700');
  assert.equal(await mode(root), LANE_DIR_MODE, 'the sessions root is 0o700');

  const unhardened = join(slug, 'control.jsonl');
  await writeFile(unhardened, 'x');
  assert.equal(await mode(unhardened), 0o644,
    'without the hardening a write in this very directory is world-readable — that is what default fs writes ship');
});

test('atomic same-directory upgrade replaces a v4 session in place at 0o600 without leaving sibling staging files', async (t) => {
  const previousUmask = process.umask(0o022);
  t.after(() => { process.umask(previousUmask); });

  const fixture = await createLaneFixture(t, []);
  const target = join(fixture.projectDir, 'published.jsonl');
  await writeFile(
    target,
    `${JSON.stringify({ v: 4, kind: 'header', id: 'session-atomic', cwd: '/nomi-lane/main', createdAt: 1700000000000 })}\n`,
    { mode: 0o644 },
  );
  const upgraded = await upgradeV4SessionFileIfNeeded(target, 'main');
  assert.equal(upgraded, true);
  assert.equal(await mode(target), LANE_FILE_MODE);
  assert.equal(JSON.parse((await readFile(target, 'utf8')).split('\n')[0]!).version, 3);
  const siblings = (await readdir(fixture.projectDir)).filter((name) => name.includes('.v3-upgrade-'));
  assert.deepEqual(siblings, []);
});

test('every atomic publish stages its temp file as a sibling — no staging file remains after close', async (t) => {
  const fixture = await createLaneFixture(t, [...ONE_TURN]);
  const lane = await fixture.openLane(fixture.options);
  await lane.execute({ kind: 'prompt', text: 'Read the document.' });
  await lane.close();

  const { slug } = await theSessionFile(fixture.projectDir);
  const strays = (await readdir(slug)).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(strays, [], 'a published session leaves no staging file behind');
});

test('one session has exactly one owner: a second open in this process is refused, not silently duplicated', async (t) => {
  const fixture = await createLaneFixture(t, [...ONE_TURN]);
  const first = await fixture.openLane(fixture.options);

  await assert.rejects(() => fixture.openLane({ ...fixture.options, sessionId: first.sessionId }),
    /already has an owner/, 'the second opener is turned away with the reason, not handed a second writer');

  const sibling = await fixture.openLane({ ...fixture.options, laneName: 'research' });
  assert.notEqual(sibling.sessionId, first.sessionId);

  await assert.rejects(() => fixture.openLane(fixture.options), /already has an owner/);
});

test('the owner is released on close — a reopened history is not permanently locked out', async (t) => {
  const fixture = await createLaneFixture(t, [...ONE_TURN]);
  const first = await fixture.openLane(fixture.options);
  const { sessionId } = first;
  await first.close();

  const reopened = await fixture.openLane({ ...fixture.options, sessionId });
  assert.equal(reopened.sessionId, sessionId);
});

test('a failed assembly hands the session back — the next open does not meet a ghost owner', async (t) => {
  const fixture = await createLaneFixture(t, [...ONE_TURN]);
  const duplicated = [...createDocumentLaneTools(createDocumentPort())];
  const clash = duplicated[0] as LaneToolDescriptor;
  await assert.rejects(() => fixture.openLane({ ...fixture.options, tools: [clash, clash] }), /duplicate/i);

  const lane = await fixture.openLane(fixture.options);
  assert.ok(lane.sessionId);
});

test('G-02 · a tool failure throws, so pi records an errored result instead of a successful one', async (t) => {
  const message = 'The document is locked by another window; ask the user to close it and try again.';
  const failing: LaneToolDescriptor = {
    contractId: 'document.read',
    name: 'always_fails',
    description: 'A tool that always reports a failure, used to prove failures are not recorded as successes.',
    promptSnippet: 'always report a failure.', nextAction: 'none', describe: FIXTURE_DESCRIBE,
    effect: 'read',
    execution: { timeoutMs: LANE_READ_TOOL_TIMEOUT_MS },
    schema: z.object({}).strict(),
    examples: [{ when: 'Call it with no arguments:', arguments: {} }],
    execute: async () => ({ ok: false, failure: { code: 'document_locked', message, nextAction: 'Ask the user to close the other window.' } }),
  };
  const succeeding: LaneToolDescriptor = { ...failing, name: 'always_succeeds', execute: async () => ({ ok: true, text: message }) };

  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'bad', name: 'always_fails', arguments: {} }] },
    { type: 'tool', calls: [{ id: 'good', name: 'always_succeeds', arguments: {} }] },
    { type: 'text', text: 'Done.' },
  ]);
  const lane = await fixture.openLane({ ...fixture.options, tools: [failing, succeeding] });
  await lane.execute({ kind: 'prompt', text: 'Try both.' });

  const results = lane.projection().parts.filter((part) => part.kind === 'tool-result');
  const bad = results.find((part) => part.toolCallId === 'bad');
  const good = results.find((part) => part.toolCallId === 'good');

  assert.ok(bad?.isError, 'a failure lands as an errored result — returning a failure object would land as a success');
  assert.match(bad.text, /locked by another window/, 'the actionable sentence reaches the model, not an error code');
  assert.equal(good?.isError, false);
  assert.equal(good.text, message);
});
