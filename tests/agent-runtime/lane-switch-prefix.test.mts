import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createLaneFixture } from './laneFixture.mjs';
import { LANE_MODEL_TOOL_CATALOG, LANE_DEFERRED_TOOL_CATALOG } from '../../electron/agentLane/laneToolCatalog.js';
import { bindLaneTool } from '../../electron/agentLane/laneRuntimePort.js';

test('B1c 24-turn loopback keeps the tool and system prefix after switching groups', async t => {
  const fixture = await createLaneFixture(t, []);
  const recorded = JSON.parse(await readFile(path.resolve('tests/agent-runtime/fixtures/lane-context-20260909.json'), 'utf8'));
  const groups = ['production', 'timeline', 'media', 'generation'];
  const lane = await fixture.openLane({ ...fixture.options,
    tools: [...LANE_MODEL_TOOL_CATALOG, ...LANE_DEFERRED_TOOL_CATALOG].map(spec =>
      bindLaneTool(spec, async () => ({ ok: true, text: 'Isolated domain fixture.' }))),
    native: { settingsRoot: path.join(fixture.projectDir, 'settings'), skills: [] },
  });
  for (let index = 0; index < 24; index++) {
    fixture.http.push(
      { type: 'tool', calls: [{ id: `switch-${index}`, name: 'nomi_request_tools', arguments: { group: groups[index % groups.length] } }] },
      { type: 'text', text: '收到。' },
    );
    await lane.execute({ kind: 'prompt', text: recorded.turns[index] });
  }
  assert.equal(fixture.http.requests.length, 48);
  const prefixes = fixture.http.requests.map(({ body }) => ({
    tools: body.tools,
    system: (body.messages as Array<{ role: string }>).filter(message => message.role === 'system'),
  }));
  for (const prefix of prefixes.slice(1)) assert.deepEqual(prefix, prefixes[0]);
  t.diagnostic('24 recorded user turns, 24 actual group requests, 48 real HTTP requests; tool and system prefixes identical.');
});

test('B1c legacy coding menu restores file access without granting it to a locked history', async t => {
  const { openLaneSession } = await import('../../electron/agentLane/laneSession.mjs');
  const { writeFile } = await import('node:fs/promises');
  const { LANE_CODING_TOOL_NAMES } = await import('../../electron/agentLane/laneCodingTools.mjs');
  const { laneToolMenu } = await import('../../electron/agentLane/laneToolGroups.mjs');
  for (const previouslyUnlocked of [false, true]) {
    const fixture = await createLaneFixture(t, [
      { type: 'tool', calls: [{ id: 'read-restored', name: 'read', arguments: { path: 'private.txt' } }] },
      { type: 'text', text: 'Read receipt checked.' },
    ]);
    await writeFile(path.join(fixture.projectDir, 'private.txt'), 'LEGACY_CODING_CONTENT');
    const old = await openLaneSession({ projectDir: fixture.projectDir, laneName: 'main' });
    await old.session.appendCustomEntry('nomi.ui.active-tools', {
      names: [...new Set([...laneToolMenu().activeToolNames, ...(previouslyUnlocked ? LANE_CODING_TOOL_NAMES : [])])],
    });
    await old.release();
    const lane = await fixture.openLane({ ...fixture.options, sessionId: old.sessionId,
      tools: LANE_MODEL_TOOL_CATALOG.map(spec => bindLaneTool(spec, async () => ({ ok: true, text: '' }))),
      native: { settingsRoot: path.join(fixture.projectDir, 'settings'), skills: [] },
    });
    await lane.execute({ kind: 'prompt', text: 'Read the project file.' });
    assert.equal(JSON.stringify(fixture.http.requests.at(-1)?.body).includes('LEGACY_CODING_CONTENT'), previouslyUnlocked);
    assert.equal(lane.projection().parts.some(part => part.kind === 'tool-result' && part.isError), !previouslyUnlocked);
  }
});
