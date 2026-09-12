import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createRequire } from 'node:module';
import { rmSync, readFileSync } from 'node:fs';
import { estimateTokens } from '@earendil-works/pi-agent-core';
import { formatAvailableModelsForPrompt } from '../../electron/shared/agentCapabilities/availableModels.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLaneFixture } from './laneFixture.mjs';
import { createLaneNativeAssembly } from '../../electron/agentLane/laneNativeAssembly.mjs';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import type { LaneComposerContext } from '../../electron/shared/agentLane/laneDesktopContracts.js';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = path.resolve(`.tmp/lane-context-input-${process.pid}.cjs`);
buildSync({ entryPoints: [path.resolve('electron/agentLane/laneDesktopInput.ts')], outfile: bundle,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
after(() => rmSync(bundle, { force: true }));
const { createDesktopLaneInput } = require(bundle);
const model = { modelKey: 'MiniMax-H3', modelAlias: null, vendor: 'fixture', label: 'MiniMax H3', kind: 'video' as const,
  defaultModeId: 't2v', modes: [{ modeId: 't2v', vendorTerm: '文生视频', intent: '', hint: '', slots: [],
    params: [{ key: 'resolution', type: 'select' as const, label: '分辨率', options: [{ value: '768P', label: '768P' }, { value: '2K', label: '2K' }] }] }] };

test('C59 stable catalog is in system context; user turns contain only catalog changes', async (t) => {
  const fixture = await createLaneFixture(t, Array.from({ length: 3 }, () => ({ type: 'text' as const, text: '好的' })));
  const previous = { settings: process.env.NOMI_SETTINGS_DIR, projects: process.env.NOMI_PROJECTS_DIR };
  process.env.NOMI_SETTINGS_DIR = path.join(fixture.projectDir, 'settings');
  process.env.NOMI_PROJECTS_DIR = path.join(fixture.projectDir, 'projects');
  t.after(() => {
    if (previous.settings === undefined) delete process.env.NOMI_SETTINGS_DIR; else process.env.NOMI_SETTINGS_DIR = previous.settings;
    if (previous.projects === undefined) delete process.env.NOMI_PROJECTS_DIR; else process.env.NOMI_PROJECTS_DIR = previous.projects;
  });
  let context: LaneComposerContext = { approvalPolicy: { mode: 'safe-auto', spend: 'confirm' }, availableModels: [model] };
  const input = createDesktopLaneInput({ projectId: 'budget-fixture', capture: () => context, activate: () => {},
    model: () => ({ model: { modelKey: 'chosen-model' }, kind: 'openai-compatible' }) });
  const lane = await fixture.openLane({ ...fixture.options, input });
  await lane.execute({ kind: 'prompt', text: '把这份文稿拆成分镜' });
  await lane.execute({ kind: 'prompt', text: '第 1 镜试拍一下' });
  const messages = (n: number) => (fixture.http.requests[n]!.body as { messages: Array<{ role: string; content: unknown }> }).messages;
  assert.match(JSON.stringify(messages(0).filter(m => m.role === 'system')), /MiniMax-H3/);
  assert.match(JSON.stringify(messages(0).filter(m => m.role === 'system')), /768P/);
  assert.match(JSON.stringify(messages(0).filter(m => m.role === 'system')), /modelKey\/modeId 不能留空/);
  assert.match(JSON.stringify(messages(0).filter(m => m.role === 'system')), /用户点名 t2v 就听用户/);
  assert.deepEqual(messages(0).filter(m => m.role === 'system'), messages(1).filter(m => m.role === 'system'));
  assert.doesNotMatch(JSON.stringify(messages(1).filter(m => m.role === 'user')), /MiniMax-H3/);
  context = { ...context, availableModels: [{ ...model, modelKey: 'New-Video' }] };
  await lane.execute({ kind: 'prompt', text: '重新拆一遍' });
  assert.match(JSON.stringify(messages(2).filter(m => m.role === 'user').at(-1)), /New-Video/);
  assert.match(JSON.stringify(messages(2).filter(m => m.role === 'user').at(-1)), /MiniMax-H3/);
});

test('C58 resident read loads a Skill but refuses project files without coding', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const skillRoot = path.join(fixture.projectDir, 'skills', 'storyboard');
  await mkdir(skillRoot, { recursive: true });
  await mkdir(path.join(fixture.projectDir, 'src'));
  await writeFile(path.join(skillRoot, 'SKILL.md'), '---\nname: storyboard\ndescription: Split a manuscript\n---\nUse eight shots.');
  await writeFile(path.join(fixture.projectDir, 'src', 'secret.ts'), 'project data');
  const native = await createLaneNativeAssembly({ projectDir: fixture.projectDir, trustedSkillRoots: [skillRoot], bashTimeoutMs: 5000,
    sandbox: { active: true, operations: { exec: async () => { throw new Error('not used'); } }, close: async () => {} } });
  assert.ok(native.activeToolNames().includes('read'), 'read must be resident before any group switch');
  const read = native.tools.find(tool => tool.name === 'read')!;
  const call = (file: string) => read.execute('read-skill', { path: file } as never, (() => {}) as never, undefined, {} as never, BACKGROUND_CONTEXT);
  const loaded = await call(path.join(skillRoot, 'SKILL.md'));
  assert.match(JSON.stringify(loaded.content), /Use eight shots/);
  assert.ok((loaded.details as { skill?: unknown }).skill);
  await assert.rejects(call('src/secret.ts'), /coding|Skill/);
});

test('C61 native compaction uses the cost budget even with a million-token model window', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'text', text: '第 1 镜的节点 id 是 node-opening。' + '历史材料。'.repeat(18000), usage: { input: 81000, output: 100 } },
    { type: 'text', text: '任务摘要：第 1 镜 = node-opening，已建节点待试拍。', usage: { input: 1200, output: 40 } },
    { type: 'text', text: '任务摘要：第 1 镜 = node-opening。' },
    { type: 'text', text: '继续第 1 镜。' },
  ]);
  const lane = await fixture.openLane({ ...fixture.options, model: { ...fixture.options.model, contextWindow: 1000000 } });
  await lane.execute({ kind: 'prompt', text: '建第 1 镜，保留它的引用。' });
  await lane.execute({ kind: 'prompt', text: '第 1 镜继续。' });
  assert.equal(fixture.http.requests.length, 4, 'An upstream summary request must precede the second assistant call');
  const last = JSON.stringify(fixture.http.requests.at(-1)?.body.messages);
  assert.match(last, /node-opening/);
  assert.match(last, /任务摘要/);
  const { readdir, readFile } = await import('node:fs/promises');
  const root = path.join(fixture.projectDir, '.nomi', 'agent-sessions');
  const files = await readdir(root, { recursive: true });
  const rows = (await Promise.all(files.filter(file => file.endsWith('.jsonl')).map(file => readFile(path.join(root, file), 'utf8'))))
    .flatMap(text => text.trim().split('\n').flatMap(line => { const row = JSON.parse(line); return Array.isArray(row) ? row : [row]; }));
  assert.ok(rows.some(row => row.type === 'compaction'), 'Actual pi compaction entry, not just rewritten request text');
});


test('C59 the 24 recorded user turns reduce total input by 60 percent and add under 2k tokens per turn', async (t) => {
  const recorded = JSON.parse(readFileSync(path.resolve('tests/agent-runtime/fixtures/lane-context-20260909.json'), 'utf8'));
  const fixture = await createLaneFixture(t, recorded.turns.map(() => ({ type: 'text', text: '收到。' })));
  const previous = { settings: process.env.NOMI_SETTINGS_DIR, projects: process.env.NOMI_PROJECTS_DIR };
  process.env.NOMI_SETTINGS_DIR = path.join(fixture.projectDir, 'settings');
  process.env.NOMI_PROJECTS_DIR = path.join(fixture.projectDir, 'projects');
  t.after(() => {
    if (previous.settings === undefined) delete process.env.NOMI_SETTINGS_DIR; else process.env.NOMI_SETTINGS_DIR = previous.settings;
    if (previous.projects === undefined) delete process.env.NOMI_PROJECTS_DIR; else process.env.NOMI_PROJECTS_DIR = previous.projects;
  });
  const context: LaneComposerContext = { approvalPolicy: { mode: 'safe-auto', spend: 'confirm' }, availableModels: recorded.models,
    model: { vendorKey: 'fixture', modelKey: 'chosen-model' } };
  const input = createDesktopLaneInput({ projectId: 'replay', capture: () => context, activate: () => {},
    model: () => ({ model: { modelKey: 'chosen-model' }, kind: 'openai-compatible' }) });
  const lane = await fixture.openLane({ ...fixture.options, input });
  for (const text of recorded.turns) await lane.execute({ kind: 'prompt', text });
  const tokens = (content: string) => estimateTokens({ role: 'user', content, timestamp: 0 });
  const catalog = formatAvailableModelsForPrompt(recorded.models);
  const bodies = fixture.http.requests.map(r => r.body as { messages: Array<{ role: string; content: string }> });
  const system = bodies[0]!.messages.find(m => m.role === 'system')!.content;
  const index = system.slice(system.indexOf('可用模型索引'));
  assert.ok(tokens(index) < 2000, 'actual 89-model discovery index must fit the catalog budget');
  let before = 0, after = 0, lastSize = 0;
  const added: number[] = [];
  for (const body of bodies) {
    assert.equal(body.messages.find(m => m.role === 'system')!.content, system);
    const size = tokens(JSON.stringify(body));
    after += size;
    added.push(size - lastSize);
    lastSize = size;
    const legacy = { ...body, messages: body.messages.map(message => ({ ...message, content: message.role === 'user'
      ? message.content + '\n\n' + catalog : message.role === 'system' ? message.content.replace(index, '') : message.content })) };
    before += tokens(JSON.stringify(legacy));
  }
  assert.equal(bodies.length, 24);
  assert.ok(after <= before * 0.4, `before=${before}, after=${after}`);
  // Fixed tool guidance is measured by schema/prefix probes, not charged as newly added user context.
  assert.ok(added.slice(1).every(value => value < 2000), JSON.stringify(added));
  assert.ok(tokens(index + recorded.turns[0]) < 2000);
  t.diagnostic(JSON.stringify({ method: 'pi estimateTokens on real loopback request bodies; legacy catalog projection reconstructed',
    turns: 24, before, after, reduction: 1 - after / before, indexTokens: tokens(index), newInputTokens: added }));
});

test('C58 real loopback loads the installed Skill before any coding request and refuses src', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const root = path.join(fixture.projectDir, 'skills', 'storyboard');
  await mkdir(root, { recursive: true });
  await mkdir(path.join(fixture.projectDir, 'src'));
  const body = '---\nname: storyboard\ndescription: Split manuscripts into shots\n---\nSkill loaded from its canonical package.';
  const filePath = path.join(root, 'SKILL.md');
  await writeFile(filePath, body);
  await writeFile(path.join(fixture.projectDir, 'src', 'fixture.ts'), 'MUST_NOT_REACH_MODEL');
  fixture.http.push(
    { type: 'tool', calls: [{ id: 'skill-read', name: 'read', arguments: { path: filePath } }] },
    { type: 'tool', calls: [{ id: 'src-read', name: 'read', arguments: { path: 'src/fixture.ts' } }] },
    { type: 'text', text: '技能已加载，项目源码访问已拒绝。' },
  );
  const { LANE_MODEL_TOOL_CATALOG } = await import('../../electron/agentLane/laneToolCatalog.js');
  const { bindLaneTool } = await import('../../electron/agentLane/laneRuntimePort.js');
  const lane = await fixture.openLane({ ...fixture.options,
    tools: LANE_MODEL_TOOL_CATALOG.map(spec => bindLaneTool(spec, async () => { throw new Error('No domain call expected'); })),
    native: { settingsRoot: path.join(fixture.projectDir, 'settings'), skills: [{ name: 'storyboard', directoryName: 'storyboard',
      filePath, body, description: 'Split manuscripts into shots', manifest: null, origin: 'user', audience: 'internal',
      packageVersion: 'nomi-skill-v1', contentHash: 'fixture' }] },
  });
  await lane.execute({ kind: 'prompt', text: '拆成分镜' });
  const last = JSON.stringify(fixture.http.requests.at(-1)?.body);
  assert.match(last, /Skill loaded from its canonical package/);
  assert.doesNotMatch(last, /MUST_NOT_REACH_MODEL/);
  assert.match(last, /outside this project or its permitted read-only Skill packages/);
  const results = lane.projection().parts.filter(part => part.kind === 'tool-result');
  assert.ok(JSON.stringify(results).includes('storyboard'));
});

test('C59 on-demand models returns every mode contract and follows the latest catalog', async () => {
  const { createLaneModelRead } = await import('../../electron/agentLane/laneModelRead.mjs');
  let entries = [model, { ...model, modelKey: 'Second-Video', modes: [...model.modes,
    { ...model.modes[0]!, modeId: 'first', params: [{ key: 'resolution', type: 'select' as const, label: '分辨率',
      options: [{ value: '1080P', label: '1080P' }] }] }] }];
  const tool = createLaneModelRead(() => entries);
  const full = await tool.execute('full', { kind: 'models' });
  assert.equal(JSON.parse(full.content[0]!.text).models.length, 2);
  const narrowed = await tool.execute('narrow', { kind: 'models', modelKey: 'Second-Video' });
  assert.match(narrowed.content[0]!.text, /1080P/);
  assert.doesNotMatch(narrowed.content[0]!.text, /MiniMax-H3/);
  entries = [];
  assert.deepEqual(JSON.parse((await tool.execute('new', { kind: 'models' })).content[0]!.text), { models: [] });
  assert.deepEqual(JSON.parse((await tool.execute('invalid', { kind: 'files' })).content[0]!.text), { models: [] });
});

test('C61 configured cost thresholds retain the real small-window safety margin and reject invalid budgets', async () => {
  const { laneCompactionSettings } = await import('../../electron/agentLane/laneContextBudget.mjs');
  const { shouldCompact } = await import('@earendil-works/pi-agent-core');
  for (const window of [128000, 1000000]) {
    const settings = laneCompactionSettings(window, 40000);
    assert.equal(shouldCompact(40000, window, settings), false);
    assert.equal(shouldCompact(40001, window, settings), true);
  }
  const small = laneCompactionSettings(32000);
  assert.ok(shouldCompact(25000, 32000, small));
  for (const invalid of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => laneCompactionSettings(128000, invalid));
});

test('C58 reopening an older lane adds resident read without requiring a group request', async (t) => {
  const fixture = await createLaneFixture(t, [{ type: 'text', text: '继续。' }]);
  const first = await fixture.openLane(fixture.options);
  const sessionId = first.sessionId;
  await first.close();
  const { LANE_MODEL_TOOL_CATALOG } = await import('../../electron/agentLane/laneToolCatalog.js');
  const { bindLaneTool } = await import('../../electron/agentLane/laneRuntimePort.js');
  const restored = await fixture.openLane({ ...fixture.options, sessionId,
    tools: LANE_MODEL_TOOL_CATALOG.map(spec => bindLaneTool(spec, async () => ({ ok: true, text: 'empty' }))),
    native: { settingsRoot: path.join(fixture.projectDir, 'settings'), skills: [] },
  });
  await restored.execute({ kind: 'prompt', text: '继续' });
  const tools = fixture.http.requests[0]!.body.tools as Array<{ function: { name: string } }>;
  assert.ok(tools.some(tool => tool.function.name === 'read'));
  assert.ok(tools.some(tool => tool.function.name === 'nomi_request_tools'));
});

test('C58 skill-only reads reject symlink escapes and allow project reads only after coding activation', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const { symlink } = await import('node:fs/promises');
  const root = path.join(fixture.projectDir, 'skill');
  await mkdir(root);
  await writeFile(path.join(fixture.projectDir, 'private.txt'), 'project contents');
  await symlink(path.join(fixture.projectDir, 'private.txt'), path.join(root, 'SKILL.md'));
  const native = await createLaneNativeAssembly({ projectDir: fixture.projectDir, trustedSkillRoots: [root], bashTimeoutMs: 5000,
    sandbox: { active: true, operations: { exec: async () => { throw new Error('not used'); } }, close: async () => {} } });
  const { openLaneSession } = await import('../../electron/agentLane/laneSession.mjs');
  const { AgentHarness } = await import('@earendil-works/pi-agent-core');
  const { createModels } = await import('@earendil-works/pi-ai');
  const session = await openLaneSession({ projectDir: fixture.projectDir, laneName: 'main' }, BACKGROUND_CONTEXT);
  const { createNomiProvider } = await import('../../electron/agentLane/laneModelProvider.mjs');
  const configured = await createNomiProvider(fixture.options.model, globalThis.fetch);
  const models = createModels({ credentials: configured.credentials });
  models.setProvider(configured.provider);
  const { harness } = await AgentHarness.create({ session: session.session, models, model: configured.model, tools: native.tools }, BACKGROUND_CONTEXT);
  fixture.after(async () => { await harness.close(BACKGROUND_CONTEXT); await session.release(BACKGROUND_CONTEXT); });
  native.bindActiveTools(await harness.lane('main', BACKGROUND_CONTEXT));
  const call = (name: string, args: unknown) => native.tools.find(tool => tool.name === name)!
    .execute('fixture', args as never, (() => {}) as never, undefined, {} as never, BACKGROUND_CONTEXT);
  await assert.rejects(call('read', { path: path.join(root, 'SKILL.md') }), /outside/);
  await assert.rejects(call('read', { path: 'private.txt' }), /outside/);
  await call('nomi_request_tools', { group: 'coding' });
  assert.match(JSON.stringify(await call('read', { path: 'private.txt' })), /project contents/);
});
