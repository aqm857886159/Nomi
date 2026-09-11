import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { AgentHarness } from '@earendil-works/pi-agent-core';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import { createModels } from '@earendil-works/pi-ai';
import { createLaneNativeAssembly } from '../../electron/agentLane/laneNativeAssembly.mjs';
import { createLaneInstalledSkills } from '../../electron/agentLane/laneInstalledSkills.mjs';
import { createNomiProvider } from '../../electron/agentLane/laneModelProvider.mjs';
import { openLaneSession } from '../../electron/agentLane/laneSession.mjs';
import { createLaneTools } from '../../electron/agentLane/laneTools.mjs';
import { LANE_MODEL_TOOL_CATALOG } from '../../electron/agentLane/laneToolCatalog.js';
import { bindLaneTool } from '../../electron/agentLane/laneRuntimePort.js';
import { createLaneFixture } from './laneFixture.mjs';
import type { SkillRecord } from '../../electron/skills/skillStore.js';

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
  const configured = await createNomiProvider(fixture.options.model, globalThis.fetch);
  const models = createModels({ credentials: configured.credentials });
  models.setProvider(configured.provider);
  const domain = createLaneTools(LANE_MODEL_TOOL_CATALOG.map((spec) => bindLaneTool(spec, async () => {
    throw new Error('The native fixture must never call a domain tool.');
  })));
  const ctx = BACKGROUND_CONTEXT;
  async function open(sessionId?: string) {
    const session = await openLaneSession({ projectDir: fixture.projectDir, laneName: 'main', sessionId }, ctx);
    const { harness } = await AgentHarness.create<undefined>({
      session: session.session, models, model: configured.model, systemPrompt: 'Native fixture.',
      tools: [...domain, ...native.tools], activeToolNames: [...native.activeToolNames()],
    }, ctx);
    const lane = await harness.lane('main', ctx);
    native.bindActiveTools(lane);
    return { ...session, harness, lane };
  }
  const first = await open();
  const grep = native.tools.find(tool => tool.name === 'grep')!;
  await assert.rejects(grep.execute('locked-grep', { pattern: 'fixture' } as never,
    (() => undefined) as never, undefined, {} as never, ctx), /Request coding/);
  assert.equal((await first.lane.getActiveTools(ctx)).length, native.activeToolNames().length);
  const result = await first.lane.prompt('Read fixture.txt', undefined, ctx);
  assert.equal(result.ok, true);
  assert.equal((await first.lane.getActiveTools(ctx)).length, native.activeToolNames().length);
  const bodies = fixture.http.requests.map((request) => request.body as { tools?: Array<{ function?: { name?: string } }>; messages?: unknown });
  assert.equal(bodies[0]?.tools?.length, native.activeToolNames().length);
  assert.ok(bodies[0]?.tools?.some((tool) => tool.function?.name === 'read'));
  assert.ok(bodies[1]?.tools?.some((tool) => tool.function?.name === 'read'));
  assert.match(JSON.stringify(bodies[2]?.messages), /native fixture content/);
  const sessionId = first.sessionId;
  await first.harness.close(ctx);
  await first.session.close(ctx);
  await first.release(ctx);
  const second = await open(sessionId);
  t.after(async () => { await second.harness.close(ctx); await second.session.close(ctx); await second.release(ctx); });
  assert.equal((await second.lane.getActiveTools(ctx)).length, native.activeToolNames().length);
  const request = native.tools.find(tool => tool.name === 'nomi_request_tools')!;
  await request.execute('models', { group: 'models' } as never, (() => undefined) as never, undefined, {} as never, ctx);
  const read = native.tools.find(tool => tool.name === 'read')!;
  assert.match(JSON.stringify(await read.execute('restored-read', { path: 'fixture.txt' } as never,
    (() => undefined) as never, undefined, {} as never, ctx)), /native fixture content/);
  assert.equal((await second.lane.findEntries({ type: 'custom', customType: 'nomi.coding-access' }, ctx)).length, 1);

});

test('request tools only resolves registered groups and does not grant file write permissions', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const native = await createLaneNativeAssembly({ projectDir: fixture.projectDir, sandbox, bashTimeoutMs: 5_000,
    deferredGroups: [{ name: 'media', toolNames: ['nomi_media_fixture'] }] });
  const request = native.tools.find((tool) => tool.name === 'nomi_request_tools')!;
  const call = (args: unknown) => request.execute('call', args as never, (() => undefined) as never, undefined, {} as never, BACKGROUND_CONTEXT);
  await assert.rejects(call({ group: 'unregistered' }), /registered group/);
  await assert.rejects(call({ groups: ['media'] }), /registered group/,
    '一次只切一个组：数组形状不再是合法参数');
  const result = await call({ group: 'media' });
  assert.equal(result.addedToolNames, undefined);
  assert.equal(native.effects.write, 'reversible_local');
  assert.equal(native.activeToolNames().length, 20, 'No local activation truth duplicates pi state.');
  await assert.rejects(createLaneNativeAssembly({ projectDir: fixture.projectDir, sandbox, bashTimeoutMs: 5_000,
    deferredGroups: [{ name: 'escape', toolNames: ['read'] }] }), /Duplicate deferred tool/);
});

test('trusted SkillRecord conversion keeps the existing parser and reads only package metadata', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const root = path.join(fixture.projectDir, 'installed', 'demo');
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  const body = '---\nname: demo\ndescription: Demonstrate a skill\n---\nFixture body.';
  const filePath = path.join(root, 'SKILL.md');
  await writeFile(filePath, body);
  const record: SkillRecord = { name: 'demo', directoryName: 'demo', filePath, description: 'Demonstrate a skill', body,
    manifest: null, disableModelInvocation: true, origin: 'user', audience: 'internal', packageVersion: 'nomi-skill-v1', contentHash: 'fixture' };
  const installed = await createLaneInstalledSkills([record]);
  assert.equal(installed.skills.length, 1);
  assert.equal(installed.skills[0]?.requiresCodingTools, true);
  assert.equal(installed.skills[0]?.disableModelInvocation, true);
  assert.equal(installed.trustedSkillRoots.length, 1);
  assert.ok(!('body' in installed.skills[0]!), 'Index never duplicates skill content.');
});

test('pi seconds are converted once to the Nomi millisecond execution budget', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const observed: Array<number | undefined> = [];
  const native = await createLaneNativeAssembly({ projectDir: fixture.projectDir, bashTimeoutMs: 5_000,
    sandbox: { active: true, close: async () => undefined, operations: { exec: async (_command, _cwd, options) => {
      observed.push(options.timeout); return { exitCode: 0 };
    } } } });
  const configured = await createNomiProvider(fixture.options.model, globalThis.fetch);
  const models = createModels({ credentials: configured.credentials });
  models.setProvider(configured.provider);
  const session = await openLaneSession({ projectDir: fixture.projectDir, laneName: 'main' }, BACKGROUND_CONTEXT);
  const { harness } = await AgentHarness.create({ session: session.session, models, model: configured.model, tools: native.tools }, BACKGROUND_CONTEXT);
  fixture.after(async () => { await harness.close(BACKGROUND_CONTEXT); await session.release(BACKGROUND_CONTEXT); });
  native.bindActiveTools(await harness.lane('main', BACKGROUND_CONTEXT));
  await native.unlockCoding(BACKGROUND_CONTEXT);
  const bash = native.tools.find((tool) => tool.name === 'bash')!;
  for (const timeout of [2, 100, undefined]) {
    await bash.execute('seconds', { command: 'echo fixture', ...(timeout === undefined ? {} : { timeout }) } as never,
      (() => undefined) as never, undefined, {} as never, BACKGROUND_CONTEXT);
  }
  assert.deepEqual(observed, [2_000, 5_000, 5_000]);
});
