import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { createLaneNativeAssembly } from '../../electron/agentLane/laneNativeAssembly.mjs';
import { createLaneSkillIndexSource, discoverSkillRecords } from '../../electron/agentLane/laneSkillCatalog.mjs';
import { openLaneSession } from '../../electron/agentLane/laneSession.mjs';
import { LANE_MODEL_TOOL_CATALOG, LANE_NATIVE_TOOL_CATALOG } from '../../electron/agentLane/laneToolCatalog.js';
import { bindLaneTool } from '../../electron/agentLane/laneRuntimePort.js';
import { createLaneFixture } from './laneFixture.mjs';
import { laneToolMenu } from '../../electron/agentLane/laneToolGroups.mjs';
import { LANE_CODING_TOOL_NAMES } from '../../electron/agentLane/laneCodingTools.mjs';
import type { SkillRecord } from '../../electron/skills/skillStore.js';
import { openProbeLane, PROBE_CONTEXT } from './stage3ProbeHarness.mjs';

const sandbox = { active: true, operations: { exec: async () => { throw new Error('bash not used'); } }, close: async () => undefined };

test('the real harness activates deferred native tools on a tool result and preserves them on reopen', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'unlock', name: 'nomi_request_tools', arguments: { group: 'coding' } }] },
    { type: 'tool', calls: [{ id: 'read', name: 'read', arguments: { path: 'fixture.txt' } }] },
    { type: 'text', text: 'Read the fixture.' },
  ]);
  await writeFile(path.join(fixture.projectDir, 'fixture.txt'), 'native fixture content');
  const native = await createLaneNativeAssembly({ projectDir: fixture.projectDir, sandbox, bashTimeoutMs: 5_000 });
  assert.ok(native.promptSections.snippets.some((line) => line.startsWith('read:')));
  assert.ok(native.promptSections.snippets.some((line) => line.startsWith('bash:')));
  const domainSpecs = LANE_MODEL_TOOL_CATALOG.map((spec) => bindLaneTool(spec, async () => {
    throw new Error('The native fixture must never call a domain tool.');
  }));
  async function open(sessionId?: string) {
    const probe = await openProbeLane(fixture, {
      ...fixture.options,
      systemPrompt: 'Native fixture.',
      tools: domainSpecs,
    }, sessionId ? { sessionId } : {});
    const baseTools = await probe.harness.getTools();
    await probe.harness.setTools([...baseTools, ...native.tools]);
    await probe.lane.setActiveTools([...native.activeToolNames()]);
    native.bindActiveTools(probe.session);
    return probe;
  }
  const first = await open();
  const grep = native.tools.find(tool => tool.name === 'grep')!;
  await assert.rejects(grep.execute('locked-grep', { pattern: 'fixture' } as never), /Request coding/);
  assert.equal((await first.lane.getActiveTools(PROBE_CONTEXT)).length, native.activeToolNames().length);
  const result = await first.lane.prompt('Read fixture.txt', undefined, PROBE_CONTEXT);
  assert.equal(result.ok, true);
  assert.equal((await first.lane.getActiveTools(PROBE_CONTEXT)).length, native.activeToolNames().length);
  const bodies = fixture.http.requests.map((request) => request.body as { tools?: Array<{ function?: { name?: string } }>; messages?: unknown });
  assert.equal(bodies[0]?.tools?.length, native.activeToolNames().length);
  assert.ok(bodies[0]?.tools?.some((tool) => tool.function?.name === 'read'));
  assert.ok(bodies[1]?.tools?.some((tool) => tool.function?.name === 'read'));
  assert.match(JSON.stringify(bodies[2]?.messages), /native fixture content/);
  const sessionId = first.sessionId;
  await first.close();

  const second = await open(sessionId);
  assert.equal((await second.lane.getActiveTools(PROBE_CONTEXT)).length, native.activeToolNames().length);
  const request = native.tools.find(tool => tool.name === 'nomi_request_tools')!;
  await request.execute('models', { group: 'models' } as never);
  const read = native.tools.find(tool => tool.name === 'read')!;
  assert.match(JSON.stringify(await read.execute('restored-read', { path: 'fixture.txt' } as never)), /native fixture content/);
  assert.equal((await second.lane.findEntries({ type: 'custom', customType: 'nomi.coding-access' }, PROBE_CONTEXT)).length, 1);
});

test('request tools only resolves registered groups and does not grant file write permissions', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const native = await createLaneNativeAssembly({ projectDir: fixture.projectDir, sandbox, bashTimeoutMs: 5_000,
    deferredGroups: [{ name: 'media', toolNames: ['nomi_media_fixture'] }] });
  const request = native.tools.find((tool) => tool.name === 'nomi_request_tools')!;
  const call = (args: unknown) => request.execute('call', args as never);
  await assert.rejects(call({ group: 'unregistered' }), /registered group/);
  await assert.rejects(call({ groups: ['media'] }), /registered group/,
    '一次只切一个组：数组形状不再是合法参数');
  const result = await call({ group: 'media' });
  assert.equal('addedToolNames' in (result as object), false);
  assert.equal(native.effects.write, 'reversible_local');
  assert.equal(native.activeToolNames().length, new Set([...laneToolMenu().activeToolNames, ...LANE_CODING_TOOL_NAMES, ...LANE_NATIVE_TOOL_CATALOG.map((spec) => spec.name), 'nomi_media_fixture']).size, 'No local activation truth duplicates pi state.');
  await assert.rejects(createLaneNativeAssembly({ projectDir: fixture.projectDir, sandbox, bashTimeoutMs: 5_000,
    deferredGroups: [{ name: 'escape', toolNames: ['read'] }] }), /Duplicate deferred tool/);
});

test('the lane index is a projection of the pi-loaded catalog and never duplicates skill content', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const root = path.join(fixture.projectDir, 'installed');
  await mkdir(path.join(root, 'demo', 'scripts'), { recursive: true });
  const body = '---\nname: demo\ndescription: Demonstrate a skill\ndisable-model-invocation: true\n---\nFixture body.';
  await writeFile(path.join(root, 'demo', 'SKILL.md'), body);
  const records: readonly SkillRecord[] = (await discoverSkillRecords([{ path: root, origin: 'user' }])).records;
  const installed = await createLaneSkillIndexSource(() => records).refresh();
  assert.equal(installed.entries.length, 1);
  assert.equal(installed.entries[0]?.requiresCodingTools, true);
  assert.equal(installed.entries[0]?.disableModelInvocation, true);
  assert.deepEqual(installed.trustedSkillRoots, [path.join(root, 'demo')]);
  assert.ok(!('body' in installed.entries[0]!) && !('content' in installed.entries[0]!), 'Index never duplicates skill content.');
});

test('pi seconds are converted once to the Nomi millisecond execution budget', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const observed: Array<number | undefined> = [];
  const native = await createLaneNativeAssembly({ projectDir: fixture.projectDir, bashTimeoutMs: 5_000,
    sandbox: { active: true, close: async () => undefined, operations: { exec: async (_command, _cwd, options) => {
      observed.push(options.timeout); return { exitCode: 0 };
    } } } });
  const session = await openLaneSession({ projectDir: fixture.projectDir, laneName: 'main' });
  fixture.after(async () => { await session.release(); });
  native.bindActiveTools(session.session);
  await native.unlockCoding();
  const bash = native.tools.find((tool) => tool.name === 'bash')!;
  for (const timeout of [2, 100, undefined]) {
    await bash.execute('seconds', { command: 'echo fixture', ...(timeout === undefined ? {} : { timeout }) } as never);
  }
  assert.deepEqual(observed, [2_000, 5_000, 5_000]);
});
