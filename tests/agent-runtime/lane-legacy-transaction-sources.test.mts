import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { stableProjectAgentJson } from '../../electron/shared/legacyAgentJson.js';
import { migrateLaneLegacy } from '../../electron/agentLane/laneLegacyMigration.mjs';
import { openLaneHistory } from '../../electron/agentLane/laneHistory.mjs';
import { openLaneSession } from '../../electron/agentLane/laneSession.mjs';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import { createLaneFixture } from './laneFixture.mjs';

const binding = { projectId: 'fixture', immutableProjectUuid: '12345678-1234-4234-8234-123456789abc', projectGeneration: 1 };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const labels = { summaryPrefix: 'Legacy summary: ', unverifiedToolResult: 'Legacy outcome unverified.' };
function sources(projectDir: string) {
  const timestamp = '2026-09-08T00:00:00.000Z';
  const data = { header: { type: 'session', version: 3, id: 'legacy', timestamp, cwd: '/legacy' },
    entries: [
      { type: 'message', id: 'first', parentId: null, timestamp,
        message: { role: 'user', content: 'first', timestamp: 999 } },
      { type: 'message', id: 'second', parentId: 'first', timestamp,
        message: { role: 'user', content: 'second', timestamp: 1 } },
    ], leafId: 'second' };
  const state = { binding, hostRevision: 0, commandLedgerHighWater: 0, threads: [{ threadId: 'thread' }], items: [
    { threadId: 'thread', kind: 'user', text: 'first', createdAt: '2099-01-01' },
    { threadId: 'thread', kind: 'tool', capability: { id: 'legacy.read' }, status: 'done', text: 'historical' },
    { threadId: 'thread', kind: 'assistant', text: 'second', createdAt: '2000-01-01' },
  ] };
  const host = { schemaVersion: 1, binding, hostRevision: 0, state,
    commandLedger: { highWater: 0, byteOffset: 0, headChecksum: digest('nomi-project-agent-command-ledger:v1\0empty') } };
  return [
    { name: 'pi-snapshot', file: join(projectDir, '.nomi', 'agent-thread-context-v1.json'), parts: 2, items: 2,
      value: { format: 'nomi.pi-work-context', version: 1, piVersion: '0.85.1', data, sha256: digest(JSON.stringify(data)) } },
    { name: 'host-snapshot', file: join(projectDir, 'project-agent-host', `project-agent.${binding.immutableProjectUuid}.g1`, 'snapshot-v1.json'),
      parts: 4, items: 3, value: { ...host, checksum: digest(stableProjectAgentJson(host)) } },
    { name: 'agent-chat-v2', file: join(projectDir, '.nomi', 'agent-session.json'), parts: 2, items: 2,
      value: { sessions: { history: [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'second' }] } } },
  ];
}

test('three source files complete archive/import/cold reopen in array order without any network requests', async t => {
  for (let index = 0; index < 3; index++) await t.test(`source ${index}`, async st => {
    const fx = await createLaneFixture(st, [
      { type: 'tool', calls: [{ id: 'new-read', name: 'read_script', arguments: {} }] },
      { type: 'text', text: 'continued' },
    ]);
    const source = sources(fx.projectDir)[index];
    fs.mkdirSync(join(fx.projectDir, '.nomi'), { recursive: true }); fs.mkdirSync(join(source.file, '..'), { recursive: true });
    const bytes = Buffer.from(JSON.stringify(source.value)); fs.writeFileSync(source.file, bytes);
    const options = { projectDir: fx.projectDir, userDataDir: fx.projectDir, binding, locale: 'en' as const, labels: () => labels };
    // Host stop is exactly between its synthetic tool call and result.
    if (source.name === 'host-snapshot') {
      let appends = 0;
      await assert.rejects(() => migrateLaneLegacy({ ...options, checkpoint: async stage => {
        if (stage === 'append' && ++appends === 3) throw new Error('half-tool-pair');
      } }), /half-tool-pair/);
      assert.deepEqual(fs.readFileSync(source.file), bytes);
    }
    const result = await migrateLaneLegacy(options);
    assert.equal(result.sourceItems, source.items); assert.equal(result.parts, source.parts);
    const manifest = JSON.parse(fs.readFileSync(join(fx.projectDir, '.nomi', 'lane-legacy-migration.json'), 'utf8'));
    assert.deepEqual(fs.readFileSync(join(fx.projectDir, '.nomi', 'legacy-archive', manifest.transactionId, `${source.name}.json`)), bytes);
    assert.equal(fs.existsSync(source.file), false);
    const lane = await openLaneHistory({ projectDir: fx.projectDir, laneName: manifest.targets[0].laneName });
    try {
      const projection = lane.projection();
      assert.equal(projection.parts.length, source.parts);
      assert.deepEqual(projection.parts.filter(part => part.kind === 'user' || part.kind === 'assistant-text').map(part => part.text), ['first', 'second']);
      assert.equal(projection.legacy?.missingToolArguments, source.name === 'host-snapshot');
    } finally { await lane.close(); }
    assert.equal(fx.http.requests.length, 0);
    const continued = await fx.openLane({ ...fx.options, laneName: manifest.targets[0].laneName });
    await continued.execute({ kind: 'prompt', text: 'Read the current document.' });
    assert.equal(fx.http.requests.length, 2);
    const firstRequest = fx.http.requests[0].body as { tools?: Array<{ function?: { name?: string } }> };
    assert.ok(firstRequest.tools?.some(tool => tool.function?.name === 'read_script'));
    assert.ok(continued.projection().parts.some(part => part.kind === 'tool-result' && part.toolCallId === 'new-read' && !part.isError));
    await continued.close();
    const again = await fx.openLane({ ...fx.options, laneName: manifest.targets[0].laneName });
    assert.equal(again.projection().legacy?.arrayOrder, source.name === 'host-snapshot');
    await again.close();
    assert.equal(fx.http.requests.length, 2);
  });
});

test('reserved migration session refuses a preexisting foreign session without overwriting it', async t => {
  const fx = await createLaneFixture(t, []); const lane = await fx.openLane({ ...fx.options, laneName: 'occupied' });
  const sessionId = lane.sessionId; await lane.close();
  await assert.rejects(() => openLaneSession({ projectDir: fx.projectDir, laneName: 'occupied',
    createSessionId: '22345678-1234-4234-8234-123456789abc' }, BACKGROUND_CONTEXT), /legacy-target-session-conflict/);
  const cold = await openLaneHistory({ projectDir: fx.projectDir, laneName: 'occupied' });
  try { assert.equal(cold.sessionId, sessionId); } finally { await cold.close(); }
});
