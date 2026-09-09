import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { JsonlSessionRepo } from '@earendil-works/pi-agent-core/harness/session';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import { createLaneFileSystem } from '../../electron/agentLane/laneFileSystem.mjs';
import { deriveLaneTrace } from '../../electron/agentLane/laneTrace.mjs';

test('official pi 0.85.1 conformance messages survive native JSONL reopen and trace derivation', async () => {
  const fixture = JSON.parse(await readFile(resolve('tests/fixtures/standard-formats/pi-session/conformance-messages.json'), 'utf8')) as {
    upstreamVersion: string; messages: AgentMessage[];
  };
  assert.match(fixture.upstreamVersion, /0\.85\.1/);
  await mkdir('.tmp', { recursive: true });
  const projectDir = await mkdtemp(resolve('.tmp/trace-official-format-'));
  const repo = new JsonlSessionRepo({ fileSystem: createLaneFileSystem(projectDir), sessionsRoot: join(projectDir, 'sessions') });
  const context = BACKGROUND_CONTEXT;
  try {
    const session = await repo.create({ cwd: projectDir }, context);
    const branch = await session.createBranch('main', null, context);
    for (const message of fixture.messages) await branch.appendMessage(message, context);
    const metadata = session.metadata;
    await session.close(context);
    const original = await readFile(metadata.path, 'utf8');
    assert.equal(JSON.parse(original.split('\n')[0]).v, 4);
    const reopened = await repo.open(metadata, context);
    const entries = await reopened.findEntries({ order: 'asc' }, context);
    assert.deepEqual(entries.filter(entry => entry.type === 'message').map(entry => entry.message), fixture.messages);
    const rows = deriveLaneTrace(entries, reopened.metadata.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].prompt, 'child');
    assert.equal(rows[0].response, 'stop');
    assert.deepEqual(rows[0].models, [{ provider: 'anthropic', model: 'claude-sonnet-4-5' }]);
    assert.equal(rows[0].tools[0].name, 'read');
    assert.equal(rows[0].tools[0].toolCallId, 'call');
    assert.equal(rows[0].tools[0].durationMs, null);
    assert.equal(rows[0].estimatedCostUsd, null);
    assert.equal(await readFile(metadata.path, 'utf8'), original, 'deriving a view must not rewrite the native source');
    await reopened.close(context);
  } finally {
    await repo.close(context);
    await rm(projectDir, { recursive: true, force: true });
  }
});
