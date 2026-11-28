import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { openLaneSession } from '../../electron/agentLane/laneSession.mjs';
import { deriveLaneTrace } from '../../electron/agentLane/laneTrace.mjs';

test('conformance messages survive SessionManager v3 JSONL reopen and trace derivation without rewriting disk', async () => {
  const fixture = JSON.parse(await readFile(resolve('tests/fixtures/standard-formats/pi-session/conformance-messages.json'), 'utf8')) as {
    upstreamVersion: string; messages: AgentMessage[];
  };
  await mkdir('.tmp', { recursive: true });
  const projectDir = await mkdtemp(resolve('.tmp/trace-official-format-'));
  try {
    const opened = await openLaneSession({ projectDir, laneName: 'main' });
    for (const message of fixture.messages) await opened.session.appendMessage(message);
    const sessionPath = opened.session.metadata.path;
    const sessionId = opened.sessionId;
    await opened.release();

    const original = await readFile(sessionPath, 'utf8');
    const header = JSON.parse(original.split('\n')[0]!);
    assert.equal(header.type, 'session');
    assert.equal(header.version, 3);

    const reopened = await openLaneSession({ projectDir, laneName: 'main', sessionId });
    const entries = reopened.session.entries();
    assert.deepEqual(entries.filter(entry => entry.type === 'message').map(entry => entry.message), fixture.messages);
    const rows = deriveLaneTrace(entries, reopened.sessionId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.prompt, 'child');
    assert.equal(rows[0]!.response, 'stop');
    assert.deepEqual(rows[0]!.models, [{ provider: 'anthropic', model: 'claude-sonnet-4-5' }]);
    assert.equal(rows[0]!.tools[0]!.name, 'read');
    assert.equal(rows[0]!.tools[0]!.toolCallId, 'call');
    assert.equal(rows[0]!.tools[0]!.durationMs, null);
    assert.equal(rows[0]!.estimatedCostUsd, null);
    assert.equal(await readFile(sessionPath, 'utf8'), original, 'deriving a view must not rewrite the native source');
    await reopened.release();
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});
